// public/src/shared/quizManifest.js
// =============================================================================
// Loads the quiz manifest — DB-only. Queries Supabase for `quizzes`,
// `courses`, and `folders` directly, then reconstructs each quiz's
// subject/subfolder placement by walking course_id → course row and
// folder_id → parent_folder_id chain. Apart from the last-good snapshot
// cache described below, nothing here reads a local file or a bundled/
// static manifest.
//
// Manifest shape
// ──────────────
// { subjects: [ { id, name, education_type, faculty?, year?, term?, quizzes: [...] } ] }
//
// For backward compatibility, getManifest() also returns a `categoryTree`
// object (keyed by subject/subfolder name) that index.js uses for
// navigation, and an `examList` flat array.
//
// Caching
// ───────
// Cached in memory for the lifetime of the page.
// Call invalidateManifestCache() after an admin upload or delete.
// =============================================================================

import { generateQuizId } from "./quizId.js";
import { ensureSharedSupabaseClient } from "./supabaseClientRegistry.js";
import { SUPABASE_URL } from "./public-config.js";

let cached = null;

// Upper bound for how long the home page will wait for Supabase before giving
// up and showing the retry/error state. Supabase outages in front of
// CloudFlare can manifest as requests that simply HANG (never resolve, never
// reject) — without this bound the skeleton loader would spin forever.
const MANIFEST_FETCH_TIMEOUT_MS = 15000;

// ── Local last-good snapshot (resilience fallback) ───────────────────────────
// When the live manifest fetch fails — Supabase outage, dropped gateway, slow
// network — the home page falls back to this localStorage snapshot of the
// last successful load so returning users still see the course catalog
// instead of an error/skeleton. Only the lightweight metadata needed to
// render the catalog is stored (never the full quiz `data` blob, which can
// be megabytes); quiz content itself still requires a live fetch.
const MANIFEST_CACHE_KEY = "bq_manifest_cache_v1";
// Hard upper bound for the serialized snapshot — comfortably below
// localStorage's ~5 MB per-origin quota so it can never evict other app
// keys when saving.
const MANIFEST_CACHE_MAX_BYTES = 2_500_000;
// When a usable snapshot already exists we don't need to wait the full
// 15 s for a dead Supabase: give the live fetch a short grace period, then
// fall back to the snapshot immediately.
const CACHE_FALLBACK_FAST_TIMEOUT_MS = 5000;

// Races a promise against a hard deadline so a hung network request (e.g.
// Cloudflare 522 / connection timeout against Supabase) can never wedge the
// home page on the skeleton indefinitely.
function withTimeout(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `[${label || "request"}] Timed out after ${ms}ms`,
          ),
        ),
      ms,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// ── Local snapshot persistence ────────────────────────────────────────────────

/** Stores the last-good catalog (slimmed: quiz metadata only, no quiz bodies). */
function saveManifestCache({ quizzes, courses, folders }) {
  try {
    if (typeof localStorage === "undefined") return;
    const slimQuizzes = (quizzes || []).map((q) => ({
      id: q.id,
      course_id: q.course_id,
      folder_id: q.folder_id,
      title: q.title,
      password: q.password,
      meta: q.data?.meta,
      stats: q.data?.stats,
    }));
    const payload = JSON.stringify({
      v: 1,
      project: SUPABASE_URL,
      savedAt: new Date().toISOString(),
      quizzes: slimQuizzes,
      courses,
      folders,
    });
    if (payload.length > MANIFEST_CACHE_MAX_BYTES) {
      console.warn("[quizManifest] Manifest snapshot too large to cache — skipping.");
      return;
    }
    localStorage.setItem(MANIFEST_CACHE_KEY, payload);
  } catch (err) {
    console.warn("[quizManifest] Could not save manifest snapshot:", err);
  }
}

/**
 * Loads the last-good catalog snapshot, or null if absent/invalid/stale.
 * The snapshot stores raw rows under a "slim" shape (meta/stats hoisted to
 * the row top level instead of nested inside `data`), which buildSubjects()
 * handles transparently via its `row.data ?? row` normalization.
 */
function tryRestoreManifestCache() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(MANIFEST_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || data.project !== SUPABASE_URL) return null;
    if (
      !Array.isArray(data.courses) ||
      !Array.isArray(data.folders) ||
      !Array.isArray(data.quizzes)
    ) {
      return null;
    }
    return data;
  } catch (err) {
    // Corrupt snapshot — discard it so it can't wedge future loads.
    try { localStorage.removeItem(MANIFEST_CACHE_KEY); } catch (_) {}
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the merged manifest.  Result is cached after the first call.
 *
 * @returns {Promise<{ subjects: Subject[], categoryTree: CategoryTree, examList: Exam[] }>}
 */
export async function getManifest() {
  if (cached) return cached;

  // If a usable snapshot already exists, fail fast on the live fetch so an
  // outage is served from cache in ~5 s instead of after the full 15 s.
  const snapshot = tryRestoreManifestCache();
  const liveTimeout = snapshot
    ? CACHE_FALLBACK_FAST_TIMEOUT_MS
    : MANIFEST_FETCH_TIMEOUT_MS;

  let fromCache = false;
  let subjects;
  try {
    const { quizzes, courses, folders } = await fetchDbManifest(liveTimeout);
    saveManifestCache({ quizzes, courses, folders });
    subjects = await buildSubjects(quizzes, courses, folders);
  } catch (err) {
    if (!snapshot) throw err;
    console.warn(
      "[quizManifest] Live manifest failed — serving last-good snapshot:",
      err,
    );
    subjects = await buildSubjects(
      snapshot.quizzes,
      snapshot.courses,
      snapshot.folders,
    );
    fromCache = true;
  }

  const { categoryTree, examList } = buildCompatStructures(subjects);
  cached = { subjects, categoryTree, examList, fromCache };
  return cached;
}

/**
 * Clears the in-memory cache so the next getManifest() re-fetches both sources.
 */
export function invalidateManifestCache() {
  cached = null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Queries Supabase directly for the raw `quizzes`, `courses`, and `folders`
 * rows (public SELECT is allowed by each table's RLS policy) and returns
 * them unshaped — buildSubjects() turns them into the compatibility
 * manifest. Kept in this module (rather than a shared helper) since it's
 * the only caller. See CHANGELOG for why this moved off a serverless
 * function (Vercel Hobby's 12-function cap).
 *
 * @param {number} [timeoutMs] - upper bound for the whole fetch (defaults
 *   to MANIFEST_FETCH_TIMEOUT_MS); callers with a snapshot fallback pass a
 *   shorter budget so an outage is served from cache fast.
 */
async function fetchDbManifest(timeoutMs = MANIFEST_FETCH_TIMEOUT_MS) {
  const supabase = await ensureSharedSupabaseClient();
  if (!supabase) throw new Error("Supabase client unavailable");

  const [{ data: quizzes, error: quizzesError }, { data: courses, error: coursesError }, { data: folders, error: foldersError }] = await withTimeout(
    Promise.all([
      supabase
        .from("quizzes")
        .select("id, course_id, folder_id, title, data, password")
        .order("created_at", { ascending: true }),
      supabase
        .from("courses")
        .select("id, name, education_type, college, year, term")
        .order("name", { ascending: true }),
      supabase
        .from("folders")
        .select("id, course_id, name, parent_folder_id")
        .order("name", { ascending: true }),
    ]),
    timeoutMs,
    "quiz manifest",
  );

  if (quizzesError) throw quizzesError;
  if (coursesError) throw coursesError;
  if (foldersError) throw foldersError;

  return { quizzes, courses, folders };
}

/**
 * Shapes raw quiz/course/folder rows into the { subjects: [...] } manifest.
 * Works for BOTH live Supabase rows (quiz `data` JSON with meta/stats keys)
 * and slimmed snapshot rows from saveManifestCache() (meta/stats hoisted to
 * the row top level) — see the `row.data ?? row` normalization below.
 */
async function buildSubjects(quizzes, courses, folders) {
  const courseById = new Map((courses || []).map((course) => [course.id, course]));
  const folderById = new Map((folders || []).map((folder) => [folder.id, folder]));

  function getFolderSegments(folderId, courseId) {
    const segments = [];
    const visited = new Set();
    let currentId = folderId;

    while (currentId) {
      if (visited.has(currentId)) {
        throw new Error(`Folder cycle detected at ${currentId}`);
      }
      visited.add(currentId);

      const folder = folderById.get(currentId);
      if (!folder || folder.course_id !== courseId) {
        throw new Error(`Folder ${currentId} does not belong to course ${courseId}`);
      }
      segments.unshift(folder.name);
      currentId = folder.parent_folder_id;
    }

    return segments;
  }

  const subjectsMap = new Map();

  for (const row of quizzes || []) {
    const course = courseById.get(row.course_id);
    if (!course) {
      console.warn(`[quizManifest] Quiz ${row.id} has no valid course_id`);
      continue;
    }

    let folderSegments;
    try {
      folderSegments = getFolderSegments(row.folder_id, row.course_id);
    } catch (error) {
      console.warn(`[quizManifest] ${error.message}`);
      continue;
    }

    if (!subjectsMap.has(course.id)) {
      const subject = {
        id: course.id,
        name: course.name,
        education_type: course.education_type,
        quizzes: [],
      };
      if (course.education_type === "University" && course.college) {
        subject.faculty = course.college;
      }
      if (course.year != null) subject.year = course.year;
      if (course.term != null) subject.term = course.term;
      subjectsMap.set(course.id, subject);
    }

    const subjectEntry = subjectsMap.get(course.id);
    // Live rows nest meta/stats inside the `data` JSON column; slimmed
    // snapshot rows hoist them to the row top level — support both.
    const quizMeta = row.data?.meta || row.meta || {};
    const quizStats = row.data?.stats || row.stats || {};

    const quizEntry = {
      id: quizMeta.id || (await generateQuizId(String(row.id))),
      dbId: row.id,
      title: quizMeta.title || row.title,
      folderSegments,
      questionCount: quizStats.questionCount ?? 0,
      questionTypes: quizStats.questionTypes ?? [],
      education_type: course.education_type,
    };

    if (quizMeta.description) quizEntry.description = quizMeta.description;
    if (quizMeta.author_id) quizEntry.author_id = quizMeta.author_id;
    if (row.password) quizEntry.password = row.password;
    if (quizMeta.source) quizEntry.source = quizMeta.source;
    if (quizMeta.createdAt) quizEntry.createdAt = quizMeta.createdAt;

    subjectEntry.quizzes.push(quizEntry);
  }

  return { subjects: Array.from(subjectsMap.values()) };
}

/**
 * Builds backward-compatible `categoryTree` and `examList` from subjects.
 *
 * categoryTree shape expected by index.js:
 *   { [subjectName]: { id, name, faculty, year, term, path, parent, subcategories, exams } }
 *
 * Each quiz's `folderSegments` (walked from folder_id's parent chain in
 * buildSubjects()) is used to reconstruct nested subfolder nodes.
 *
 * @param {Subject[]} subjects
 * @returns {{ categoryTree: object, examList: object[] }}
 */
function buildCompatStructures(subjects) {
  const categoryTree = {};
  const examList = [];

  for (const subject of subjects) {
    const key = subject.name;

    if (!categoryTree[key]) {
      categoryTree[key] = {
        key: key,
        id: subject.id,
        name: subject.name,
        faculty: subject.faculty,
        education_type: subject.education_type,
        ...(subject.year != null && { year: String(subject.year) }),
        ...(subject.term != null && { term: String(subject.term) }),
        path: [subject.name],
        parent: null,
        subcategories: [],
        exams: [],
        source: subject.source,
      };
    }

    for (const quiz of subject.quizzes ?? []) {
      let folderSegments = Array.isArray(quiz.folderSegments)
        ? quiz.folderSegments
        : [];
      let examCategoryKey = key;

      if (folderSegments.length > 0) {
        let currentParentKey = key;
        let currentPathArr = [...categoryTree[key].path];

        for (const segment of folderSegments) {
          const subKey = `${currentParentKey}/${segment}`;
          currentPathArr.push(segment);

          if (!categoryTree[subKey]) {
            categoryTree[subKey] = {
              key: subKey,
              name: segment,
              path: [...currentPathArr],
              parent: currentParentKey,
              subcategories: [],
              exams: [],
              education_type: subject.education_type,
            };
            if (!categoryTree[currentParentKey].subcategories.includes(subKey)) {
              categoryTree[currentParentKey].subcategories.push(subKey);
            }
          }
          currentParentKey = subKey;
        }
        examCategoryKey = currentParentKey;
      }

      const examEntry = {
        id: quiz.id,
        dbId: quiz.dbId,
        title: quiz.title,
        education_type: quiz.education_type || subject.education_type,
        createdAt: quiz.createdAt,
        category: examCategoryKey,
        questionCount: quiz.questionCount,
        questionTypes: quiz.questionTypes,
        ...(quiz.description && { description: quiz.description }),
        ...(quiz.author && { author: quiz.author }),
        ...(quiz.author_email && { author_email: quiz.author_email }),
        ...(quiz.source && { source: quiz.source }),
        ...(quiz.password && { password: quiz.password }),
      };

      categoryTree[examCategoryKey].exams.push(examEntry);
      examList.push(examEntry);
    }
  }

  examList.sort((a, b) => (a.category + a.id).localeCompare(b.category + b.id));

  return { categoryTree, examList };
}
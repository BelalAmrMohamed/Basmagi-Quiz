// public/src/shared/quizManifest.js
// =============================================================================
// Loads and merges the local static manifest with the live DB manifest.
//
// Sources
// ───────
// 1. LOCAL  /data/quiz-manifest.json  — built by generate-quiz-manifest.js,
//    bundled with the site at deploy time. Fast, always available offline.
//
// 2. DB     /api/quiz-manifest        — Vercel function that queries Supabase
//    and returns newly-uploaded quizzes in the same shape as the local file.
//    May be unavailable (network error, Supabase down, etc.).
//
// Manifest shape (new)
// ────────────────────
// { generatedAt, dataRoot, subjects: [ { id, name, faculty, year, term, quizzes: [...] } ] }
//
// Merge rules
// ───────────
// • Both fetches run in parallel (Promise.allSettled).
// • LOCAL wins on ID collision for both subjects and quizzes.
// • DB-only subjects/quizzes are appended after local ones.
//
// For backward compatibility, getManifest() also returns a `categoryTree`
// object (keyed by subject name) that index.js uses for navigation.
//
// Caching
// ───────
// Cached in memory for the lifetime of the page.
// Call invalidateManifestCache() after an admin upload.
// =============================================================================

import { extractFolderSegmentsFromQuizPath, parseDbPath, buildCourseKey, buildSubjectManifestEntry } from "./quizPath.js";
import { generateQuizId } from "./quizId.js";
import { ensureSharedSupabaseClient } from "./supabaseClientRegistry.js";

const LOCAL_MANIFEST_URL = new URL(
  "../../data/quiz-manifest.json",
  import.meta.url,
).href;

let cached = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the merged manifest.  Result is cached after the first call.
 *
 * @returns {Promise<{ subjects: Subject[], categoryTree: CategoryTree, examList: Exam[] }>}
 */
export async function getManifest() {
  if (cached) return cached;
  cached = await fetchAndMerge();
  return cached;
}

/**
 * Clears the in-memory cache so the next getManifest() re-fetches both sources.
 */
export function invalidateManifestCache() {
  cached = null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function fetchAndMerge() {
  const [localResult, dbResult] = await Promise.allSettled([
    fetchJson(LOCAL_MANIFEST_URL),
    fetchDbManifest(),
  ]);

  const local =
    localResult.status === "fulfilled" ? localResult.value : { subjects: [] };

  const db =
    dbResult.status === "fulfilled" ? dbResult.value : { subjects: [] };

  if (dbResult.status === "rejected") {
    console.warn(
      "[quizManifest] DB manifest unavailable — showing local quizzes only.",
      dbResult.reason,
    );
  }

  const mergedSubjects = mergeSubjects(local.subjects ?? [], db.subjects ?? []);

  // Build categoryTree + examList for backward compatibility with index.js
  const { categoryTree, examList } = buildCompatStructures(mergedSubjects);

  return { subjects: mergedSubjects, categoryTree, examList };
}

/**
 * Client-side equivalent of the old /api/quiz-manifest Vercel function —
 * queries Supabase directly (public SELECT is allowed by the `quizzes`
 * table's RLS policy) and shapes the rows into the same
 * { subjects: [...] } structure the local manifest uses. Kept in this
 * module (rather than a shared helper) since it's the only caller.
 * See CHANGELOG for why this moved off a serverless function (Vercel
 * Hobby's 12-function cap).
 */
async function fetchDbManifest() {
  const supabase = await ensureSharedSupabaseClient();
  if (!supabase) throw new Error("Supabase client unavailable");

  const { data, error } = await supabase
    .from("quizzes")
    .select(
      "id, path, filename, title, category, subject, subfolder, data, education_type, password",
    )
    .order("category", { ascending: true });

  if (error) throw error;

  const subjectsMap = new Map();

  for (const row of data) {
    let rawPath = row.path;
    let parsed = parseDbPath(rawPath, row.filename);

    if (!parsed) {
      if (row.education_type === "University") {
        rawPath = `University/${row.path}`;
        parsed = parseDbPath(rawPath, row.filename);
      }
      if (!parsed) {
        console.warn(`[quizManifest] Unrecognized path: ${row.path}`);
        continue;
      }
    }

    const education_type = row.education_type || parsed.education_type;
    parsed.education_type = education_type;

    const courseKey = buildCourseKey(parsed);

    if (!subjectsMap.has(courseKey)) {
      subjectsMap.set(courseKey, await buildSubjectManifestEntry(parsed, []));
    }

    const subjectEntry = subjectsMap.get(courseKey);
    const examRelPath = `quizzes/${row.path}/${row.filename}`;
    const examFetchPath = `/api/quiz-data?path=${encodeURIComponent(examRelPath)}`;

    const quizMeta = row.data?.meta || {};
    const quizStats = row.data?.stats || {};

    const quizEntry = {
      id: quizMeta.id || (await generateQuizId(examRelPath)),
      dbId: row.id,
      title: quizMeta.title || row.title,
      path: examFetchPath,
      questionCount: quizStats.questionCount ?? 0,
      questionTypes: quizStats.questionTypes ?? [],
      education_type,
      dbSource: "db",
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
 * Merges two subjects arrays.
 * Subjects are matched by `id`. For matching subjects, their quizzes arrays
 * are merged (local first, no duplicate IDs).
 * DB-only subjects are appended.
 *
 * @param {Subject[]} local
 * @param {Subject[]} db
 * @returns {Subject[]}
 */
function mergeSubjects(local, db) {
  // Deep-clone local so we never mutate the original
  const merged = JSON.parse(JSON.stringify(local));
  const seenIds = new Map(merged.map((s) => [s.id, s]));

  for (const dbSubject of db) {
    if (seenIds.has(dbSubject.id)) {
      // Merge quizzes into the existing local subject
      const localSubject = seenIds.get(dbSubject.id);
      const seenQuizIds = new Set(localSubject.quizzes.map((q) => q.id));
      for (const quiz of dbSubject.quizzes ?? []) {
        if (!seenQuizIds.has(quiz.id)) {
          seenQuizIds.add(quiz.id);
          localSubject.quizzes.push(quiz);
        }
      }
    } else {
      // Brand-new subject from DB
      merged.push(dbSubject);
      seenIds.set(dbSubject.id, dbSubject);
    }
  }

  return merged;
}

/**
 * Builds backward-compatible `categoryTree` and `examList` from subjects.
 *
 * categoryTree shape expected by index.js:
 *   { [subjectName]: { id, name, faculty, year, term, path, parent, subcategories, exams } }
 *
 * Since the new manifest flattens subfolders, we reconstruct subfolder nodes
 * from quiz paths when a quiz's path reveals a subfolder segment.
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
      let folderSegments = [];
      try {
        const extracted = extractFolderSegmentsFromQuizPath(quiz.path);
        folderSegments = extracted.folderSegments || [];
      } catch (_) {}

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
        title: quiz.title,
        path: quiz.path,
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
        ...(quiz.dbSource === "db" ? { dbSource: "db" } : {}),
      };

      categoryTree[examCategoryKey].exams.push(examEntry);
      examList.push(examEntry);
    }
  }

  examList.sort((a, b) => (a.category + a.id).localeCompare(b.category + b.id));

  return { categoryTree, examList };
}

/**
 * Thin fetch wrapper that throws on non-OK responses.
 */
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status} ${url}`);
  return res.json();
}
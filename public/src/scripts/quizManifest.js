// public/src/scripts/quizManifest.js
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

const LOCAL_MANIFEST_URL = new URL(
  "../../data/quiz-manifest.json",
  import.meta.url,
).href;

const DB_MANIFEST_URL = "/api/quiz-manifest";

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
    fetchJson(DB_MANIFEST_URL),
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
        id: subject.id,
        name: subject.name,
        faculty: subject.faculty,
        year: String(subject.year),
        term: String(subject.term),
        path: [subject.name],
        parent: null,
        subcategories: [],
        exams: [],
        source: subject.source,
      };
    }

    for (const quiz of subject.quizzes ?? []) {
      // Determine if this quiz is inside a subfolder by inspecting its path.
      //
      // Local quiz paths (relative):
      //   "../../data/quizzes/College/Year/Term/Subject/[Subfolder/]file.json"
      //
      // DB quiz paths (encoded query parameter):
      //   "/api/quiz-data?path=quizzes%2FCollege%2FYear%2FTerm%2FSubject%2F[Subfolder%2F]file.json"
      //
      // Fix (Bug 1): decode the `path` query-parameter value for DB paths so
      // the canonical regex can match `/`-separated segments correctly.
      // Local paths have no `?` and are left untouched.
      let folderSegments = [];
      try {
        let rawPath = quiz.path;

        // Isolate and decode the `path` query-parameter for DB URLs.
        const qIdx = rawPath.indexOf("?");
        if (qIdx !== -1) {
          const params = new URLSearchParams(rawPath.slice(qIdx + 1));
          const pathParam = params.get("path");
          if (pathParam) rawPath = decodeURIComponent(pathParam);
        }

        // Extract the canonical part: "quizzes/College/Year/Term/Subject/..."
        const canonicalMatch = rawPath.match(
          /quizzes\/[^/]+\/\d+\/\d+\/[^/]+\/(.+)/,
        );
        if (canonicalMatch) {
          const rest = canonicalMatch[1]; // e.g., "SubfolderName/file.json" or just "file.json"
          const segments = rest.split("/");
          if (segments.length > 1) {
            folderSegments = segments.slice(0, -1);
          }
        }
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
              name: segment,
              path: [...currentPathArr],
              parent: currentParentKey,
              subcategories: [],
              exams: [],
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
        createdAt: quiz.createdAt,
        category: examCategoryKey,
        questionCount: quiz.questionCount,
        questionTypes: quiz.questionTypes,
        ...(quiz.description && { description: quiz.description }),
        ...(quiz.author && { author: quiz.author }),
        ...(quiz.source && { source: quiz.source }),
        // Preserve the "db" marker so index.js can show the "قاعدة البيانات" badge
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

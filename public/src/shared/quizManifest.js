// public/src/shared/quizManifest.js
// =============================================================================
// Loads and merges the local static manifest with the live DB manifest.
//
// Sources
// ───────
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

import { generateQuizId } from "./quizId.js";
import { ensureSharedSupabaseClient } from "./supabaseClientRegistry.js";

let cached = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the merged manifest.  Result is cached after the first call.
 *
 * @returns {Promise<{ subjects: Subject[], categoryTree: CategoryTree, examList: Exam[] }>}
 */
export async function getManifest() {
  if (cached) return cached;
  const { subjects } = await fetchDbManifest();
  const { categoryTree, examList } = buildCompatStructures(subjects);
  cached = { subjects, categoryTree, examList };
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
 * Queries Supabase directly and shapes rows into the compatibility manifest.
 * queries Supabase directly (public SELECT is allowed by the `quizzes`
 * table's RLS policy) and shapes the rows into the
 * { subjects: [...] } structure used by the client. Kept in this
 * module (rather than a shared helper) since it's the only caller.
 * See CHANGELOG for why this moved off a serverless function (Vercel
 * Hobby's 12-function cap).
 */
async function fetchDbManifest() {
  const supabase = await ensureSharedSupabaseClient();
  if (!supabase) throw new Error("Supabase client unavailable");

  const [{ data: quizzes, error: quizzesError }, { data: courses, error: coursesError }, { data: folders, error: foldersError }] = await Promise.all([
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
  ]);

  if (quizzesError) throw quizzesError;
  if (coursesError) throw coursesError;
  if (foldersError) throw foldersError;

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
    const quizMeta = row.data?.meta || {};
    const quizStats = row.data?.stats || {};

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
 * Merges two subjects arrays.
 * Subjects are matched by `id`. For matching subjects, their quizzes arrays
 * are merged (local first, no duplicate IDs).
 * DB-only subjects are appended.
 *
 * @param {Subject[]} local
 * @param {Subject[]} db
 * @returns {Subject[]}
 */
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


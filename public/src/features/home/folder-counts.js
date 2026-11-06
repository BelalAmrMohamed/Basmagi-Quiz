// =============================================================================
// public/src/features/home/folder-counts.js
// Pure counting + Arabic formatting for the «محتواي» folder/course card subtext
// ("مجلدان · 3 امتحانات · درس واحد · دفتران"). Notebooks used to be skipped, so a
// folder holding only notebooks read "فارغ". No DOM / storage imports: unit-tested.
// =============================================================================

/**
 * Recursively count all subfolders, quizzes, lessons and notebooks inside a folder or course.
 * @param {object[]} userQuizzes
 * @param {string} folderId
 * @returns {{ subfolderCount: number, quizCount: number, lessonCount: number, notebookCount: number }}
 */
export function getFolderContentsCount(userQuizzes, folderId) {
  let subfolderCount = 0;
  let quizCount = 0;
  let lessonCount = 0;
  let notebookCount = 0;
  const seen = new Set();

  function walk(currentId) {
    if (seen.has(currentId)) return; // defensive: never loop on a corrupt parent cycle
    seen.add(currentId);
    const children = userQuizzes.filter(
      (q) =>
        (q.meta?.parentId || null) === currentId &&
        // Drafts are never shown in the tree (see getChildren), so they must not be counted either.
        q.meta?.type !== "draft" &&
        q.meta?.type !== "draft-lesson",
    );
    for (const child of children) {
      const type = child.meta?.type;
      if (type === "folder" || type === "course") {
        subfolderCount++;
        walk(child.id || child.meta?.id);
      } else if (type === "lesson") {
        lessonCount++;
      } else if (type === "notebook") {
        notebookCount++;
      } else {
        quizCount++;
      }
    }
  }

  walk(folderId);
  return { subfolderCount, quizCount, lessonCount, notebookCount };
}

function arabicCount(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/**
 * Format the folder / quiz / lesson / notebook counts in natural Arabic with proper plural rules.
 * @returns {string} "فارغ" only when every count is zero
 */
export function formatFolderAndQuizCount(subfolderCount, quizCount, lessonCount = 0, notebookCount = 0) {
  if (!subfolderCount && !quizCount && !lessonCount && !notebookCount) return "فارغ";
  const parts = [];
  if (subfolderCount > 0) parts.push(arabicCount(subfolderCount, "مجلد واحد", "مجلدان", "مجلدات", "مجلد"));
  if (quizCount > 0) parts.push(arabicCount(quizCount, "امتحان واحد", "امتحانان", "امتحانات", "امتحان"));
  if (lessonCount > 0) parts.push(arabicCount(lessonCount, "درس واحد", "درسان", "دروس", "درس"));
  if (notebookCount > 0) parts.push(arabicCount(notebookCount, "دفتر واحد", "دفتران", "دفاتر", "دفتر"));
  return parts.join(" · ");
}

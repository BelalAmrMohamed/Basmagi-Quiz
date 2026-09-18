// ============================================================================
// public/src/features/home/course-count.js
// COURSE ITEM COUNT — recursive exam-count for category cards
// ============================================================================

import { getCategoryTree } from "./app-state.js";
import { getFromStorage } from "../../shared/storage-helpers.js";
import { isRowReachable } from "./user-quizzes-folders.js";

let cache = new WeakMap();

/**
 * Clears the memoized counts. Not required for correctness (see above) but
 * available for callers that want an explicit, deterministic reset.
 */
export function resetCourseItemCountCache() {
  cache = new WeakMap();
}

/**
 * Recursively count only the actual quiz/exam leaves under a category node.
 * Subfolders are never counted as quizzes themselves — we recurse into them.
 *
 * Example:
 *   Course (3 exams) + SubA (4 exams) + SubB (4 exams)  →  11  (not 5)
 */
export function getCourseItemCount(category) {
  if (!category) return 0;
  if (cache.has(category)) return cache.get(category);

  // Direct exams on this node
  let count = Array.isArray(category.exams) ? category.exams.length : 0;

  // Recurse into sub-categories — add their quiz counts, NOT +1 per folder
  if (Array.isArray(category.subcategories)) {
    const categoryTree = getCategoryTree();
    for (const subKey of category.subcategories) {
      const sub = categoryTree?.[subKey];
      if (sub) count += getCourseItemCount(sub);
    }
  }

  cache.set(category, count);
  return count;
}

/**
 * Drops "orphaned" rows from a flat user_quizzes array — rows that aren't
 * genuinely reachable from a root (parentId === null) node.
 *
 * @param {Array} userQuizzes - raw entries from the "user_quizzes" key
 * @returns {Array} only the rows genuinely reachable from a root node
 */
function pruneOrphanedRows(userQuizzes) {
  const rows = userQuizzes || [];
  const byId = new Map(
    rows.map((row) => [row?.id || row?.meta?.id, row]).filter(([id]) => id),
  );
  return rows.filter((row) => isRowReachable(row, rows, byId));
}

/**
 * Breaks down the flat "user_quizzes" localStorage array into counts of
 * quizzes / folders / courses (by meta.type — entries without a meta.type
 * are plain quizzes). Used for the "امتحاناتك" root card, whose subtext
 * previously just used the array's raw .length and labeled everything as
 * "exams", even when the list actually contained folders/courses too.
 *
 * Orphaned rows (see pruneOrphanedRows above) are excluded before counting,
 * so a partially-cascaded delete can't inflate these numbers past what's
 * actually visible in the "امتحاناتك" view.
 *
 * @param {Array} userQuizzes - raw entries from the "user_quizzes" key
 * @returns {{quizCount: number, folderCount: number, courseCount: number, total: number}}
 */
export function getUserQuizzesBreakdown(userQuizzes) {
  let quizCount = 0;
  let folderCount = 0;
  let courseCount = 0;
  for (const row of pruneOrphanedRows(userQuizzes)) {
    if (row?.meta?.type === "course") courseCount += 1;
    else if (row?.meta?.type === "folder") folderCount += 1;
    else quizCount += 1;
  }
  return {
    quizCount,
    folderCount,
    courseCount,
    total: quizCount + folderCount + courseCount,
  };
}

/** Small internal Arabic-pluralization helper for a (singular, dual, plural,
 * plural11plus) label set: 1 → singular, 2 → dual, 3-10 → "N plural", 11+ →
 * "N plural11plus". */
function pluralizeArabic(count, singular, dual, plural, plural11Plus = plural) {
  if (count === 1) return singular;
  if (count === 2) return dual;
  if (count <= 10) return `${count} ${plural}`;
  return `${count} ${plural11Plus}`;
}

/**
 * Arabic subtext for the "امتحاناتك" root card. Only counts actual quizzes
 * (not folders/courses) — the card's full breakdown (quizzes/courses/
 * folders) is already shown in its dropdown menu (see root-view.js), so the
 * subtext line just needs the headline "N امتحان" figure a user expects from
 * every other card on this page, not a repeat of the whole breakdown.
 */
export function formatUserQuizzesBreakdown({ quizCount, folderCount, courseCount, total }) {
  if (total === 0) return "لا يوجد محتوى بعد";
  if (quizCount === 0) {
    // Edge case: only folders/courses, no quizzes yet directly visible in
    // the count — still say something rather than a blank "0 امتحان".
    return "لا يوجد امتحانات بعد";
  }
  return pluralizeArabic(quizCount, "امتحان واحد", "امتحانان", "امتحانات", "امتحان");
}

export function formatArabicQuestionCount(count) {
  if (!count || count === 0) return "لا أسئلة";
  if (count === 1) return "سؤال واحد";
  if (count === 2) return "سؤالين";
  if (count >= 3 && count <= 10) return `${count} أسئلة`;
  return `${count} سؤال`;
}

/**
 * Soft localStorage size ceiling for the "user_quizzes" key, in bytes.
 * localStorage generally caps around 5–10MB total (across every key on the
 * origin, not just this one), so this is deliberately conservative — a
 * warning well before writes actually start failing, not a hard technical
 * limit. See getUserQuizzesStorageWarning() below.
 */
const USER_QUIZZES_STORAGE_WARNING_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * Checks the raw serialized size of the "user_quizzes" localStorage value
 * and returns a warning message once it's large enough to be a real risk —
 * either of hitting the browser's storage quota (writes silently start
 * failing past that point) or of just being unusually bloated (accumulated
 * orphan rows from a past bug — see A6 in the restriction/rules plan).
 *
 * Deliberately a *soft* ceiling with no automatic action taken — see
 * deleteAllUserQuizzes()'s doc comment for why an automatic cleanup
 * heuristic is the wrong call for real user data. This just surfaces the
 * number so the user can decide (export via exportUserQuizzesAsJson(),
 * manually delete some items, or reach for "حذف الكل").
 *
 * @param {string} [rawValue] - the raw JSON string as stored; re-reads from
 *   storage if omitted.
 * @returns {{warn: boolean, bytes: number, message?: string}}
 */
export function getUserQuizzesStorageWarning(rawValue) {
  const raw = rawValue ?? getFromStorage("user_quizzes", "[]");
  const bytes = new Blob([raw]).size;
  if (bytes < USER_QUIZZES_STORAGE_WARNING_BYTES) {
    return { warn: false, bytes };
  }
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return {
    warn: true,
    bytes,
    message: `حجم بيانات "امتحاناتك" أصبح كبيراً (${mb} ميجابايت) وقد يتسبب ذلك في مشاكل عند الحفظ لاحقاً. يمكنك تصدير نسخة احتياطية أو حذف بعض العناصر غير المستخدمة.`,
  };
}

/**
 * Exports the raw "user_quizzes" localStorage value as a downloadable JSON
 * file, named with today's date so repeated exports don't overwrite each
 * other in the user's downloads folder.
 *
 * Added per Part D of the restriction/rules plan: investigating this key
 * previously required opening devtools and manually running
 * `copy(localStorage.getItem('user_quizzes'))` — this gives every user (not
 * just ones comfortable with devtools) a one-click way to get the same data
 * out, both as a debugging aid and as a manual backup before a destructive
 * action like "حذف الكل" (deleteAllUserQuizzes in user-quizzes-folders.js).
 */
export function exportUserQuizzesAsJson() {
  const raw = getFromStorage("user_quizzes", "[]");
  // Re-serialize with indentation for human readability rather than
  // exporting the raw single-line storage string as-is — this file is meant
  // to be opened and inspected, not just round-tripped back in.
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // If it somehow isn't valid JSON, export the raw string as a fallback
    // rather than throwing away the export entirely.
  }
  const blob = new Blob([pretty], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `my-quizzes-backup-${dateStamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Patches the already-rendered "امتحاناتك" card's subtext in place, instead
 * of waiting for the next full renderRootCategories() call (root-view.js).
 *
 * Lives here (rather than in root-view.js, which creates the card) so both
 * category-view.js and exam-card.js can call it after their own copy
 * handlers without creating a circular import with root-view.js.
 */
export function refreshUserQuizzesCard() {
  const card = document.querySelector(
    '.grid-container .category-card[data-user-quizzes-card="true"]',
  );
  if (!card) return;
  const subtextEl = card.querySelector(".card-text p");
  if (!subtextEl) return;
  const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  const breakdown = getUserQuizzesBreakdown(userQuizzes);
  subtextEl.textContent = formatUserQuizzesBreakdown(breakdown);
}
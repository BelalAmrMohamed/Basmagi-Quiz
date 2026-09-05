// ============================================================================
// public/src/features/home/course-count.js
// COURSE ITEM COUNT — recursive exam-count for category cards
// ============================================================================
// PERF FIX: the original getCourseItemCount() walked the entire subtree under
// a category from scratch on every call, with no caching. renderRootCategories()
// and renderCategory() each call this once per card, on every render — so for
// a catalog with deep nesting, opening the home page re-walked the same
// subtrees repeatedly per frame. This is very likely the performance issue
// flagged by the app's own boot-sequence diagnostic ("psst — this is the
// perf issue we're hunting").
//
// Fix: memoize per category object using a WeakMap. A WeakMap (rather than a
// Map keyed by category.key) is used because not every category object that
// flows through this function reliably carries a `.key` property — some
// callers pass plain nodes straight out of `categoryTree[k]`, others spread
// `{ key, ...category }` copies (see initializeSearchManager). Keying by
// object identity works for both without relying on that field, and still
// naturally invalidates itself: a fresh manifest load produces entirely new
// category objects, so old entries simply become unreachable and are
// garbage-collected — no manual cache-clearing required.
//
// resetCourseItemCountCache() is kept as a no-op-safe explicit reset for
// callers that want a hard guarantee (e.g. tests), but normal manifest
// reloads don't need to call it.

import { getCategoryTree } from "./app-state.js";

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
 * Breaks down the flat "user_quizzes" localStorage array into counts of
 * quizzes / folders / courses (by meta.type — entries without a meta.type
 * are plain quizzes). Used for the "امتحاناتك" root card, whose subtext
 * previously just used the array's raw .length and labeled everything as
 * "exams", even when the list actually contained folders/courses too.
 *
 * @param {Array} userQuizzes - raw entries from the "user_quizzes" key
 * @returns {{quizCount: number, folderCount: number, courseCount: number, total: number}}
 */
export function getUserQuizzesBreakdown(userQuizzes) {
  let quizCount = 0;
  let folderCount = 0;
  let courseCount = 0;
  for (const row of userQuizzes || []) {
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

/** Small internal Arabic-pluralization helper for a (singular, dual,
 * plural) label set: 1 → singular, 2 → dual, 3-10 → "N plural" (e.g. "11
 * امتحانات" was wrong — that reading only holds for 3-10), 11+ → "N
 * singular" (Arabic reverts to the singular/tamyiz form after 10, e.g. "11
 * امتحان" not "11 امتحانات"). */
function pluralizeArabic(count, singular, dual, plural) {
  if (count === 1) return singular;
  if (count === 2) return dual;
  if (count >= 3 && count <= 10) return `${count} ${plural}`;
  // 11+: Arabic counted nouns drop back to the singular form.
  const singularNoun = singular.replace(/ (واحد|واحدة)$/, "");
  return `${count} ${singularNoun}`;
}

/**
 * Arabic subtext for the FACE of the "امتحاناتك" root card — quizzes only,
 * e.g. "8 امتحانات". Deliberately does NOT include the course/folder counts:
 * those are already one tap away in this same card's dropdown (the
 * .root-quizzes-breakdown block in root-view.js), so repeating the full
 * breakdown on the card face itself just reads as a single confusing "N
 * امتحانات" total that doesn't match the actual quiz count.
 */
export function formatUserQuizzesCardSubtext({ quizCount, total }) {
  if (total === 0) return "لا يوجد محتوى بعد";
  if (quizCount === 0) return "لا يوجد امتحانات بعد";
  return pluralizeArabic(quizCount, "امتحان واحد", "امتحانان", "امتحانات");
}

export function formatArabicQuestionCount(count) {
  if (!count || count === 0) return "لا أسئلة";
  if (count === 1) return "سؤال واحد";
  if (count === 2) return "سؤالين";
  if (count >= 3 && count <= 10) return `${count} أسئلة`;
  return `${count} سؤال`;
}
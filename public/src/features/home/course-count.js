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

export function formatArabicQuestionCount(count) {
  if (!count || count === 0) return "لا أسئلة";
  if (count === 1) return "سؤال واحد";
  if (count === 2) return "سؤالين";
  if (count >= 3 && count <= 10) return `${count} أسئلة`;
  return `${count} سؤال`;
}

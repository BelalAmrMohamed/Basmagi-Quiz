// =============================================================================
// api/user-profile/_levelMath.js
// Level formula for regular (non-admin) users, driven by
// user_profiles.passed_quizzes_count. Kept separate from admin_users'
// level formula (api/admin-stats.js) intentionally — the two populations
// (admins vs anonymous users) have different progression curves and no
// shared row, so there's no reason to couple them.
//
// Formula: every 3 passed quizzes = +1 level, starting at level 1, capped
// at 50 to keep the number sane. Simple and easy to reason about; revisit
// once real usage data exists.
// =============================================================================

const QUIZZES_PER_LEVEL = 3;
const MAX_LEVEL = 50;

/**
 * @param {number} passedQuizzesCount
 * @returns {number} 1-based level, capped at MAX_LEVEL
 */
export function computeLevel(passedQuizzesCount) {
  const count = Math.max(0, Number(passedQuizzesCount) || 0);
  const level = 1 + Math.floor(count / QUIZZES_PER_LEVEL);
  return Math.min(level, MAX_LEVEL);
}

export const LEVEL_10_THRESHOLD_QUIZZES = (10 - 1) * QUIZZES_PER_LEVEL; // 27

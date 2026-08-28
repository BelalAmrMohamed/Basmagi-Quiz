// =============================================================================
// public/src/components/ai-agent/ai-agent-suggested-prompts.js
// Default "quick prompt" chips shown above the chat input before the user
// sends their first message — one tap fills + sends that exact text. Mirrors
// ai-agent-default-prompts.js's pattern: home page is a static list, result
// page is a function since good suggestions there depend on the actual
// attempt (see buildResultSuggestedPrompts).
// =============================================================================

export const HOME_PAGE_SUGGESTED_PROMPTS = [
  "أنت تقدر تعمل إيه؟",
  "عايز اعرف امتحاناتي الحالية",
  "شوف آخر إمتحان عملته وراجع ورايا لو فيه أي أخطاء.",
];

/**
 * @param {object} summary - same shape as resultSummaryForAI in result.js
 * @returns {string[]}
 */
export function buildResultSuggestedPrompts(summary) {
  const prompts = ["إيه هي أخطائي؟", "اركز على إيه في المذاكرة عشان أحسن من مستوايا؟"];

  if (Array.isArray(summary?.questions) && summary.questions.length) {
    prompts.push("اشرحلي أول سؤال غلطت فيه");
  }
  if (typeof summary?.percentage === "number" && summary.percentage < 50) {
    prompts.push("أنا مذاكر صح ولا لأ؟");
  }

  return prompts;
}
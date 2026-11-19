// =============================================================================
// api/ai-agent/_botLoop.js
// Limits for the Telegram bot's tool-calling loop (bot.js).
//
// The real limit of a bot request is the function's maxDuration (60 s), not a
// small round-trip count. So the loop is bounded by a TIME BUDGET: no new tool
// round starts after TOOL_LOOP_TIME_BUDGET_MS, and a high round ceiling only
// guards against a runaway model. When either limit is hit the loop does one
// last "wrap-up" call with tool calling switched off, so the user still gets an
// answer that summarises what was done instead of an error.
// =============================================================================

/** Hard ceiling on model round-trips per request (runaway guard only). */
export const MAX_TOOL_LOOPS = 12;

/** Stop starting new tool rounds after this long (maxDuration is 60 s). */
export const TOOL_LOOP_TIME_BUDGET_MS = 45_000;

/**
 * @param {{ loop: number, startedAt: number, now?: number }} p
 * @returns {"continue" | "wrapup"} "wrapup" = make the last call without tools.
 */
export function toolLoopPhase({ loop, startedAt, now = Date.now() }) {
  if (loop >= MAX_TOOL_LOOPS - 1) return "wrapup";
  if (loop > 0 && now - startedAt >= TOOL_LOOP_TIME_BUDGET_MS) return "wrapup";
  return "continue";
}

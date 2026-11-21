// =============================================================================
// public/src/components/ai-agent/ai-agent-panel-options.js
// DOM-free helpers for the per-pageKey cached chat panel (see ai-agent.js).
//
// A chat panel is cached per pageKey and built from the options of whoever
// opens it FIRST. The attach launcher ("Ask AI" on a card) opens the "home"
// panel with a deliberately small tool set; if it got there first, the real
// «محتواي» FAB later reused that panel and every create_* call hit the
// launcher's handler ("Unknown attachment tool"), and no suggested prompts
// were shown. resolvePanelOptions() makes the PAGE options always win.
// =============================================================================

/** Options a cached panel may have refreshed by a later open. */
export const LIVE_PANEL_OPTION_KEYS = [
  "contextPrompt",
  "contextSummary",
  "defaultSystemPrompt",
  "enableTools",
  "toolNames",
  "onToolCall",
  "suggestedPrompts",
  "placeholder",
];

/**
 * @param {boolean} panelExists
 * @param {object} incoming - options of the open request; `launcher: true`
 *   marks the attach launcher's minimal, transient options.
 * @returns {object|null} options to apply to the EXISTING panel, or null when
 *   nothing should change (no panel yet, or a launcher must not downgrade it).
 */
export function resolvePanelOptions(panelExists, incoming) {
  if (!panelExists || !incoming || incoming.launcher === true) return null;
  const next = {};
  for (const key of LIVE_PANEL_OPTION_KEYS) {
    if (incoming[key] !== undefined) next[key] = incoming[key];
  }
  return Object.keys(next).length ? next : null;
}

/**
 * Error for a tool this panel's handler cannot run. It cannot be fixed by
 * changing arguments, so the agent loop must not auto-retry it.
 * @param {string} toolName
 */
export function createUnsupportedToolError(toolName) {
  const err = new Error(`Unsupported tool in this chat: ${toolName}`);
  err.nonRetryable = true;
  err.userMessage = "هذه الأداة غير متاحة في هذه المحادثة الحالية. افتح الباشــمبصمج من صفحة «محتواي» لاستخدامها.";
  err.agentMessage = `الأداة ${toolName} غير متاحة في هذه المحادثة (ليست مشكلة مؤقتة ولا مشكلة في المعاملات). لا تعد المحاولة؛ أخبر المستخدم بوضوح أن هذه الأداة غير متاحة هنا وأنه يمكنه فتح الباشــمبصمج من صفحة «محتواي» لاستخدامها.`;
  return err;
}

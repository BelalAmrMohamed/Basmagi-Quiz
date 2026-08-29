// =============================================================================
// public/src/components/ai-agent/ai-agent.js
// Modular "AI Helper" widget — two tabs (Chat / Settings), shown inside a
// modal opened from a floating action button (FAB), rather than inlined
// into the page's DOM. Framework-free, self-contained, and page-agnostic:
// pass everything it needs via the `options` object rather than reaching
// for globals, so the same createAIAgentFab() call works from both the
// "إمتحاناتك" view (user-quizzes-view.js) and result.html.
//
// Usage:
//   import { createAIAgentFab } from "../../components/ai-agent/ai-agent.js";
//   const fab = createAIAgentFab({
//     contextPrompt: "المستخدم يسأل عن نتيجة امتحان مادة الفيزياء...", // optional
//     placeholder: "اسأل عن نتيجتك...", // optional
//   });
//   someContainer.appendChild(fab);
//
// Requires the host page to link ai-agent.css (see download-quiz-modal.css
// for the existing pattern of a static <link> tag per page) and to already
// have the shared .modal-overlay/.modal-card base rules (index.css) loaded
// — every page in this app does, since download-quiz-modal relies on them
// too.
// =============================================================================

import { createChatPanel } from "./ai-agent-chat.js";
import { createSettingsPanel } from "./ai-agent-settings.js";
import { createHistoryPanel } from "./ai-agent-history.js";

const CHAT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const SETTINGS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const HISTORY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>`;
const CLOSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const SPARKLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>`;

/**
 * Builds the tabbed widget content (Chat + Settings) — the part that lives
 * inside the modal card. Kept separate from the FAB/modal chrome so it can
 * still be embedded directly if a future page wants that instead.
 * @param {object} [options]
 * @returns {HTMLElement}
 */
function buildWidgetContent(options = {}) {
  const widget = document.createElement("div");
  widget.className = "ai-agent-widget";

  const tabs = document.createElement("div");
  tabs.className = "ai-agent-tabs";

  const chatTabBtn = document.createElement("button");
  chatTabBtn.type = "button";
  chatTabBtn.className = "ai-agent-tab-btn active";
  chatTabBtn.innerHTML = `${CHAT_ICON_SVG}<span>المحادثة</span>`;

  const historyTabBtn = document.createElement("button");
  historyTabBtn.type = "button";
  historyTabBtn.className = "ai-agent-tab-btn";
  historyTabBtn.innerHTML = `${HISTORY_ICON_SVG}<span>السابقة</span>`;

  const settingsTabBtn = document.createElement("button");
  settingsTabBtn.type = "button";
  settingsTabBtn.className = "ai-agent-tab-btn";
  settingsTabBtn.innerHTML = `${SETTINGS_ICON_SVG}<span>الإعدادات</span>`;

  tabs.appendChild(chatTabBtn);
  tabs.appendChild(historyTabBtn);
  tabs.appendChild(settingsTabBtn);
  widget.appendChild(tabs);

  const chatPanel = createChatPanel(options);
  chatPanel.classList.add("active");

  // Selecting a past conversation: load it into the (single, reused) chat
  // panel instance and switch back to the Chat tab — mirrors how e.g.
  // ChatGPT's history sidebar reopens a thread into the same chat view
  // rather than spawning a separate one.
  const historyPanel = createHistoryPanel({
    pageKey: options.pageKey,
    onSelect: (conversation) => {
      chatPanel.loadConversation(conversation);
      activateTab(chatTabBtn, chatPanel);
    },
  });

  const settingsPanel = createSettingsPanel(options);

  widget.appendChild(chatPanel);
  widget.appendChild(historyPanel);
  widget.appendChild(settingsPanel);

  function activateTab(tabBtn, panel) {
    [chatTabBtn, historyTabBtn, settingsTabBtn].forEach((b) => b.classList.remove("active"));
    [chatPanel, historyPanel, settingsPanel].forEach((p) => p.classList.remove("active"));
    tabBtn.classList.add("active");
    panel.classList.add("active");
  }

  chatTabBtn.addEventListener("click", () => activateTab(chatTabBtn, chatPanel));
  historyTabBtn.addEventListener("click", () => {
    activateTab(historyTabBtn, historyPanel);
    historyPanel.refresh();
  });
  settingsTabBtn.addEventListener("click", () => activateTab(settingsTabBtn, settingsPanel));

  return widget;
}

function openAIAgentModal(options) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay ai-agent-modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "aiAgentModalTitle");

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card ai-agent-modal-card";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <h2 id="aiAgentModalTitle">${SPARKLE_ICON_SVG} البشــمبصمج</h2>
    <button type="button" class="close-btn ai-agent-modal-close" aria-label="إغلاق">${CLOSE_ICON_SVG}</button>
  `;

  modalCard.appendChild(header);
  modalCard.appendChild(buildWidgetContent(options));
  modal.appendChild(modalCard);

  modal.querySelector(".ai-agent-modal-close").onclick = () => modal.remove();

  document.body.appendChild(modal);

  // Escape-to-close, mirroring the pattern other modals in this app use.
  const onKeydown = (e) => {
    if (e.key === "Escape") {
      modal.remove();
      document.removeEventListener("keydown", onKeydown);
    }
  };
  document.addEventListener("keydown", onKeydown);
}

/**
 * Creates the floating action button that opens the AI Helper modal.
 * Mount this once per page (e.g. appended to the view container) rather
 * than inlining the widget itself into the page flow.
 * @param {object} [options]
 * @param {string} [options.contextPrompt]
 * @param {string} [options.placeholder]
 * @param {"home"|"result"|"create"} [options.pageKey] - keys per-page system-prompt storage
 * @param {string} [options.defaultSystemPrompt] - page-specific default system prompt
 * @param {boolean} [options.enableTools] - whether the chat may call tools (e.g. create_quiz)
 * @param {string[]} [options.toolNames] - which tool names to offer when
 *   enableTools is true (see ai-agent-chat.js's toolNames doc); omit for
 *   the original create/edit/delete default
 * @param {(toolCall: {name: string, input: object}) => (string|Promise<string>)} [options.onToolCall] -
 *   may be async (see ai-agent-chat.js's fuller doc) — awaited before its
 *   return value is shown as the tool-result chat bubble.
 * @param {Array<object>} [options.contextSummary]
 * @returns {HTMLElement} the FAB button element
 */
export function createAIAgentFab(options = {}) {
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "ai-agent-fab";
  fab.setAttribute("aria-label", "افتح البشــمبصمج");
  fab.title = "البشــمبصمج";
  fab.innerHTML = SPARKLE_ICON_SVG;
  fab.addEventListener("click", () => openAIAgentModal(options));
  return fab;
}

// Kept for callers that genuinely want the tabbed widget embedded inline
// rather than behind a FAB/modal (e.g. a future dedicated "AI Helper" page).
export { buildWidgetContent as createAIAgentWidget };
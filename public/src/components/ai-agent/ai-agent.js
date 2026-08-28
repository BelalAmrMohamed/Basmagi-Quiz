// =============================================================================
// public/src/components/ai-agent/ai-agent.js
// Modular "AI Helper" widget — two tabs (Chat / Settings). Framework-free,
// self-contained, and page-agnostic: pass everything it needs via the
// `options` object rather than reaching for globals, so the same
// createAIAgentWidget() call works from both the "إمتحاناتك" view
// (user-quizzes-view.js) and result.html.
//
// Usage:
//   import { createAIAgentWidget } from "../../components/ai-agent/ai-agent.js";
//   const widget = createAIAgentWidget({
//     contextPrompt: "المستخدم يسأل عن نتيجة امتحان مادة الفيزياء...", // optional
//     placeholder: "اسأل عن نتيجتك...", // optional
//   });
//   someContainer.appendChild(widget);
//
// Requires the host page to link ai-agent.css (see download-quiz-modal.css
// for the existing pattern of a static <link> tag per page).
// =============================================================================

import { createChatPanel } from "./ai-agent-chat.js";
import { createSettingsPanel } from "./ai-agent-settings.js";

const CHAT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const SETTINGS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

/**
 * @param {object} [options]
 * @param {string} [options.contextPrompt] - forwarded to the chat panel as
 *   extra context (e.g. quiz result summary) prepended to every request.
 * @param {string} [options.placeholder] - chat input placeholder text.
 * @returns {HTMLElement}
 */
export function createAIAgentWidget(options = {}) {
  const widget = document.createElement("div");
  widget.className = "ai-agent-widget";

  const tabs = document.createElement("div");
  tabs.className = "ai-agent-tabs";

  const chatTabBtn = document.createElement("button");
  chatTabBtn.type = "button";
  chatTabBtn.className = "ai-agent-tab-btn active";
  chatTabBtn.innerHTML = `${CHAT_ICON_SVG}<span>المحادثة</span>`;

  const settingsTabBtn = document.createElement("button");
  settingsTabBtn.type = "button";
  settingsTabBtn.className = "ai-agent-tab-btn";
  settingsTabBtn.innerHTML = `${SETTINGS_ICON_SVG}<span>الإعدادات</span>`;

  tabs.appendChild(chatTabBtn);
  tabs.appendChild(settingsTabBtn);
  widget.appendChild(tabs);

  const chatPanel = createChatPanel(options);
  chatPanel.classList.add("active");

  const settingsPanel = createSettingsPanel();

  widget.appendChild(chatPanel);
  widget.appendChild(settingsPanel);

  function activateTab(tabBtn, panel) {
    [chatTabBtn, settingsTabBtn].forEach((b) => b.classList.remove("active"));
    [chatPanel, settingsPanel].forEach((p) => p.classList.remove("active"));
    tabBtn.classList.add("active");
    panel.classList.add("active");
  }

  chatTabBtn.addEventListener("click", () => activateTab(chatTabBtn, chatPanel));
  settingsTabBtn.addEventListener("click", () => activateTab(settingsTabBtn, settingsPanel));

  return widget;
}

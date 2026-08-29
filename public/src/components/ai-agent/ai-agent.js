// =============================================================================
// public/src/components/ai-agent/ai-agent.js
// Modular "AI Helper" widget — three tabs (Chat / History / Settings), shown
// inside a modal opened from a floating action button (FAB), rather than
// inlined into the page's DOM. Framework-free, self-contained, and
// page-agnostic: pass everything it needs via the `options` object rather
// than reaching for globals, so the same createAIAgentFab() call works from
// both the "إمتحاناتك" view (user-quizzes-view.js) and result.html.
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
//
// DESKTOP LAYOUT: on wide viewports (see the ai-agent-desktop-layout class
// toggled below via a matchMedia listener, and the >=901px rules in
// ai-agent.css) the modal grows and gains a left-hand sidebar — New Chat,
// Copy Conversation, a short list of recent conversations, and a "Show all
// history" button that jumps to the full History tab. Mobile keeps the
// original tabbed layout unchanged; the sidebar is simply hidden there and
// the same three tab buttons remain the only navigation.
// =============================================================================

import { createChatPanel } from "./ai-agent-chat.js";
import { createSettingsPanel } from "./ai-agent-settings.js";
import { createHistoryPanel } from "./ai-agent-history.js";
import { listConversations } from "./ai-agent-history-idb.js";

const CHAT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const SETTINGS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const HISTORY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>`;
const CLOSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const SPARKLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>`;
const NEW_CHAT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M12 7v6" /><path d="M9 10h6" /></svg>`;
const COPY_CONVO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>`;
const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

// Matches the >=901px breakpoint in ai-agent.css's desktop-layout rules —
// kept as a named constant here so the JS toggle and the CSS media query
// can never silently drift apart from each other.
const DESKTOP_BREAKPOINT_QUERY = "(min-width: 901px)";

/**
 * Builds the tabbed widget content (Chat + History + Settings) — the part
 * that lives inside the modal card. Kept separate from the FAB/modal
 * chrome so it can still be embedded directly if a future page wants that
 * instead.
 * @param {object} [options]
 * @returns {HTMLElement}
 */
function buildWidgetContent(options = {}, existingChatPanel = null) {
  const widget = document.createElement("div");
  widget.className = "ai-agent-widget";

  const pageKey = options.pageKey || "default";

  // ── Tabs (mobile nav; also used as the section switcher on desktop) ──
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

  // ── Body wrapper: sidebar (desktop only) + the three panels ──
  // A separate flex row from `tabs` above so the desktop sidebar can sit
  // beside the panels without needing to also stretch the tab strip.
  const body = document.createElement("div");
  body.className = "ai-agent-body";
  widget.appendChild(body);

  // `chatPanelSlot` is a one-element indirection layer so branching (see
  // handleBranch below, wired to the Edit-user-prompt flow in
  // ai-agent-chat.js) can swap in a genuinely new chat panel instance —
  // with its own fresh conversationId/history — without this whole widget
  // needing to be torn down and rebuilt. Everything that needs "the
  // current chat panel" (tab-switching, History tab's onSelect, the
  // sidebar's New Chat/Copy Conversation buttons) reads
  // chatPanelSlot.current rather than closing over one fixed panel
  // reference, since that reference itself changes on a branch.
  const chatPanelSlot = {
    current:
      existingChatPanel || createChatPanel({ ...options, onBranchConversation: handleBranch }),
  };
  chatPanelSlot.current.classList.add("active");

  const historyPanel = createHistoryPanel({
    pageKey,
    // Selecting a past conversation: load it into the (single, reused)
    // chat panel instance and switch back to the Chat tab — mirrors how
    // e.g. ChatGPT's history sidebar reopens a thread into the same chat
    // view rather than spawning a separate one.
    onSelect: (conversation) => {
      chatPanelSlot.current.loadConversation(conversation);
      activateTab(chatTabBtn, chatPanelSlot.current);
    },
  });

  const settingsPanel = createSettingsPanel({
    ...options,
    // Lets the Chat tab's placeholder/input-disabled state react
    // immediately when the user saves or clears their own API key (or
    // changes their model — see ai-agent-settings.js's modelSelect
    // listener, which also fires this) here, rather than only updating on
    // the next full modal open (see the panel-reuse cache in
    // openAIAgentModal below, which is what makes "the same chat panel
    // instance" meaningful across tab switches).
    onKeyChanged: () => {
      if (typeof chatPanelSlot.current.refreshAvailability === "function") {
        chatPanelSlot.current.refreshAvailability();
      }
    },
  });

  body.appendChild(chatPanelSlot.current);
  body.appendChild(historyPanel);
  body.appendChild(settingsPanel);

  function activateTab(tabBtn, panel) {
    [chatTabBtn, historyTabBtn, settingsTabBtn].forEach((b) => b.classList.remove("active"));
    [chatPanelSlot.current, historyPanel, settingsPanel].forEach((p) => {
      // Guard against a stale reference to a panel that's already been
      // replaceChild'd out by handleBranch below — classList.remove on a
      // detached node is harmless, but the .active class matters only for
      // nodes actually still in `body`.
      if (p) p.classList.remove("active");
    });
    tabBtn.classList.add("active");
    panel.classList.add("active");
  }

  chatTabBtn.addEventListener("click", () => activateTab(chatTabBtn, chatPanelSlot.current));
  historyTabBtn.addEventListener("click", () => {
    activateTab(historyTabBtn, historyPanel);
    historyPanel.refresh();
    refreshSidebarRecents();
  });
  settingsTabBtn.addEventListener("click", () => activateTab(settingsTabBtn, settingsPanel));

  /**
   * Handles Submit from the Edit-user-prompt flow (see
   * enterEditMode/onBranchConversation in ai-agent-chat.js): spins up a
   * brand new chat panel instance seeded with the branch's truncated
   * history, swaps it into both this widget's DOM (replacing the old chat
   * panel node) and the module-level per-pageKey cache (so it's what
   * reopening the AI Helper later reuses), and switches to the Chat tab
   * to show it — a NEW panel rather than the existing one, since the
   * whole point of branching is a separate conversation that leaves the
   * one being edited from untouched (see ai-agent-chat.js's own
   * onBranchConversation doc for the full rationale).
   * @param {{messages: Array<object>, createdAt: number}} branch
   */
  function handleBranch(branch) {
    const newPanel = createChatPanel({ ...options, onBranchConversation: handleBranch });
    body.replaceChild(newPanel, chatPanelSlot.current);
    chatPanelSlot.current = newPanel;
    chatPanelSlot.current.classList.add("active");
    setChatPanelForPageKey(pageKey, newPanel);
    newPanel.loadBranch(branch);
    activateTab(chatTabBtn, newPanel);
    refreshSidebarRecents();
  }

  // ── Desktop sidebar ──
  // Hidden entirely on mobile via CSS (see .ai-agent-sidebar's display:none
  // below >=901px in ai-agent.css) — built unconditionally here rather
  // than gated on a JS viewport check so a resize across the breakpoint
  // (e.g. rotating a tablet, or a desktop window being resized) doesn't
  // need this whole widget rebuilt, just a CSS reflow.
  const sidebar = document.createElement("div");
  sidebar.className = "ai-agent-sidebar";

  const sidebarNewChatBtn = document.createElement("button");
  sidebarNewChatBtn.type = "button";
  sidebarNewChatBtn.className = "ai-agent-sidebar-btn";
  sidebarNewChatBtn.innerHTML = `${NEW_CHAT_ICON_SVG}<span>محادثة جديدة</span>`;
  sidebarNewChatBtn.addEventListener("click", () => {
    chatPanelSlot.current.startNewConversation();
    activateTab(chatTabBtn, chatPanelSlot.current);
  });

  const sidebarCopyBtn = document.createElement("button");
  sidebarCopyBtn.type = "button";
  sidebarCopyBtn.className = "ai-agent-sidebar-btn";
  sidebarCopyBtn.innerHTML = `${COPY_CONVO_ICON_SVG}<span>نسخ المحادثة</span>`;
  sidebarCopyBtn.addEventListener("click", async () => {
    // Delegates to the chat panel's own export logic rather than
    // re-implementing transcript-building here — see `.exportConversation`
    // exposed by createChatPanel() in ai-agent-chat.js, which is the same
    // routine the corner "export chat" icon button uses.
    if (typeof chatPanelSlot.current.exportConversation !== "function") return;
    const ok = await chatPanelSlot.current.exportConversation();
    if (ok) {
      const original = sidebarCopyBtn.innerHTML;
      sidebarCopyBtn.innerHTML = `${CHECK_ICON_SVG}<span>تم النسخ</span>`;
      sidebarCopyBtn.classList.add("ai-agent-sidebar-btn--copied");
      setTimeout(() => {
        sidebarCopyBtn.innerHTML = original;
        sidebarCopyBtn.classList.remove("ai-agent-sidebar-btn--copied");
      }, 1500);
    }
  });

  sidebar.appendChild(sidebarNewChatBtn);
  sidebar.appendChild(sidebarCopyBtn);

  const sidebarRecentsLabel = document.createElement("div");
  sidebarRecentsLabel.className = "ai-agent-sidebar-label";
  sidebarRecentsLabel.textContent = "محادثات حديثة";
  sidebar.appendChild(sidebarRecentsLabel);

  const sidebarRecentsList = document.createElement("div");
  sidebarRecentsList.className = "ai-agent-sidebar-recents";
  sidebar.appendChild(sidebarRecentsList);

  const sidebarShowAllBtn = document.createElement("button");
  sidebarShowAllBtn.type = "button";
  sidebarShowAllBtn.className = "ai-agent-sidebar-btn ai-agent-sidebar-show-all";
  sidebarShowAllBtn.innerHTML = `${HISTORY_ICON_SVG}<span>عرض كل السجل</span>`;
  sidebarShowAllBtn.addEventListener("click", () => {
    activateTab(historyTabBtn, historyPanel);
    historyPanel.refresh();
  });
  sidebar.appendChild(sidebarShowAllBtn);

  // A short (5-item) recent-conversations list, independent of the full
  // History tab's own list — same underlying IDB store (ai-agent-history-idb.js),
  // just capped and re-rendered on a lighter cadence (only when something
  // in this session could plausibly have changed it: after a send, a
  // branch, or opening the History tab) rather than on every render.
  async function refreshSidebarRecents() {
    let conversations = [];
    try {
      conversations = await listConversations(pageKey);
    } catch (err) {
      console.error("[ai-agent] failed to load recent conversations for sidebar:", err);
      sidebarRecentsList.innerHTML = "";
      return;
    }
    sidebarRecentsList.innerHTML = "";
    conversations.slice(0, 5).forEach((conv) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ai-agent-sidebar-recent-item";
      item.textContent = conv.title;
      item.title = conv.title;
      item.addEventListener("click", () => {
        chatPanelSlot.current.loadConversation(conv);
        activateTab(chatTabBtn, chatPanelSlot.current);
      });
      sidebarRecentsList.appendChild(item);
    });
    if (!conversations.length) {
      const empty = document.createElement("div");
      empty.className = "ai-agent-sidebar-recents-empty";
      empty.textContent = "لا توجد محادثات بعد";
      sidebarRecentsList.appendChild(empty);
    }
  }
  refreshSidebarRecents();

  widget.insertBefore(sidebar, body);

  return widget;
}

// Per-pageKey cache of the live chat panel instance, so the "current chat"
// (in-progress or just-loaded-from-history conversation) survives closing
// and reopening the AI Helper modal, as long as the user hasn't left the
// page/site. Deliberately module-level (outside any single modal's DOM/
// closures) rather than tied to the modal element itself, since the modal
// is fully destroyed (`modal.remove()`) on every close — see
// openAIAgentModal below. In-memory only (not sessionStorage): cleared on
// an actual page reload, which matches the literal "didn't leave the
// page" requirement without the extra complexity of serializing/restoring
// chat DOM state across reloads.
const chatPanelsByPageKey = new Map();

function getOrCreateChatPanel(options) {
  const key = options.pageKey || "default";
  let chatPanel = chatPanelsByPageKey.get(key);
  if (!chatPanel) {
    chatPanel = createChatPanel(options);
    chatPanelsByPageKey.set(key, chatPanel);
  }
  return chatPanel;
}

// Lets handleBranch() (see buildWidgetContent above) swap the cached panel
// for a given pageKey to the freshly-created branch panel, so a later
// modal close+reopen resumes from the branch, not from the (now
// superseded) panel it was created from.
function setChatPanelForPageKey(key, chatPanel) {
  chatPanelsByPageKey.set(key || "default", chatPanel);
}

// Tracks whether a modal is currently open, per FAB instance, so a second
// click on the FAB (or a stray listener firing twice) can't stack a second
// overlay on top of the first — see createAIAgentFab below, which hides
// the FAB itself for the same reason.
function openAIAgentModal(options, fab) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay ai-agent-modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "aiAgentModalTitle");

  let desktopMql = null;
  function onDesktopChange(e) {
    modalCard.classList.toggle("ai-agent-desktop-layout", e.matches);
  }

  function closeModal() {
    modal.remove();
    document.removeEventListener("keydown", onKeydown);
    if (desktopMql && typeof desktopMql.removeEventListener === "function") {
      desktopMql.removeEventListener("change", onDesktopChange);
    }
    // Restore the FAB now that there's no modal for it to duplicate.
    if (fab) fab.style.display = "";
  }

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
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
  modalCard.appendChild(buildWidgetContent(options, getOrCreateChatPanel(options)));
  modal.appendChild(modalCard);

  modal.querySelector(".ai-agent-modal-close").onclick = closeModal;

  // Desktop-layout toggle — a class on the modal card, not a hardcoded
  // assumption, so ai-agent.css's own >=901px media query stays the single
  // source of truth for the actual pixel breakpoint (DESKTOP_BREAKPOINT_QUERY
  // just needs to reasonably agree with it) while this class additionally
  // lets any JS-side behavior key off the same signal without re-deriving
  // it from window.innerWidth on every interaction. Kept live via a
  // matchMedia listener (not computed once at open time) so resizing an
  // already-open modal across the breakpoint reflows correctly.
  if (typeof window.matchMedia === "function") {
    desktopMql = window.matchMedia(DESKTOP_BREAKPOINT_QUERY);
    modalCard.classList.toggle("ai-agent-desktop-layout", desktopMql.matches);
    if (typeof desktopMql.addEventListener === "function") {
      desktopMql.addEventListener("change", onDesktopChange);
    }
  }

  document.body.appendChild(modal);

  // Escape-to-close, mirroring the pattern other modals in this app use.
  const onKeydown = (e) => {
    if (e.key === "Escape") closeModal();
  };
  document.addEventListener("keydown", onKeydown);

  // Hide the FAB while its modal is open — clicking it again while a modal
  // is already up previously opened a second, stacked modal on top of the
  // first (no open-state check existed at all). Hiding is simpler than a
  // toggle/focus-existing approach and avoids ever having two overlays in
  // the DOM at once.
  if (fab) fab.style.display = "none";
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
  fab.addEventListener("click", () => openAIAgentModal(options, fab));
  return fab;
}

// Kept for callers that genuinely want the tabbed widget embedded inline
// rather than behind a FAB/modal (e.g. a future dedicated "AI Helper" page).
export { buildWidgetContent as createAIAgentWidget };
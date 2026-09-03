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
// The following three mirror side-menu.js's own collapsed-favicon/
// collapse-button icons exactly (same paths, same lucide icons:
// panel-right-open / panel-left / panel-left-open) — see side-menu.css's
// .sidebar-favicon/.sidebar-collapse-btn hover-crossfade rules, which
// .ai-agent-sidebar-favicon/.ai-agent-sidebar-collapse-btn in ai-agent.css
// replicate for these same three icons.
const SIDEBAR_EXPAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ai-agent-sidebar-expand-icon" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/></svg>`;
const SIDEBAR_COLLAPSE_DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-default"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/></svg>`;
const SIDEBAR_COLLAPSE_HOVER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-hover" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/></svg>`;

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
function buildWidgetContent(options = {}, existingChatPanel = null, branchHandlerRef = null) {
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
  historyTabBtn.innerHTML = `${HISTORY_ICON_SVG}<span>السجل</span>`;

  const settingsTabBtn = document.createElement("button");
  settingsTabBtn.type = "button";
  settingsTabBtn.className = "ai-agent-tab-btn";
  settingsTabBtn.innerHTML = `${SETTINGS_ICON_SVG}<span>الإعدادات</span>`;

  tabs.appendChild(chatTabBtn);
  tabs.appendChild(historyTabBtn);
  tabs.appendChild(settingsTabBtn);
  widget.appendChild(tabs);

  // ── Row wrapper: sidebar (desktop only) + .ai-agent-body ──
  // A separate flex row from `tabs` above so the desktop sidebar can sit
  // beside the panels without the tab strip also being pulled into that
  // row. BUG FIX: previously `sidebar` was inserted as a sibling of
  // `body` directly under `.ai-agent-widget` (itself always
  // flex-direction:column), and the row-reverse rule meant to lay them
  // out side by side was mistakenly applied to `.ai-agent-body` — which
  // only wraps the three PANELS, not the sidebar, so it had no sidebar to
  // lay out next to and did nothing. Sidebar and body ended up stacking
  // vertically like any other column children, with the panels' own
  // fixed max-height leaving a large gap below the sidebar in a much
  // taller desktop modal. `row` (this new wrapper) is the actual node
  // that becomes a flex row on desktop (see .ai-agent-desktop-layout
  // .ai-agent-row in ai-agent.css) — sidebar and body are its only two
  // children, so reversing IT lays them out side by side correctly.
  const row = document.createElement("div");
  row.className = "ai-agent-row";
  widget.appendChild(row);

  const body = document.createElement("div");
  body.className = "ai-agent-body";
  row.appendChild(body);

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
      existingChatPanel ||
      createChatPanel({
        ...options,
        onBranchConversation: handleBranch,
        onHistoryChanged: refreshHistoryHighlights,
      }),
  };
  chatPanelSlot.current.classList.add("active");

  // See getOrCreateChatPanel's own onBranchConversation-forwarding
  // comment below: a REUSED existingChatPanel was built on some earlier
  // modal open, whose onHistoryChanged (if any) closes over that open's
  // now-stale historyPanel/refreshSidebarRecents. Point the same
  // per-pageKey ref this widget forwards onBranchConversation through at
  // THIS open's refreshHistoryHighlights too, so a save from a reused
  // panel still reaches the currently-open modal's history/sidebar.
  if (branchHandlerRef) branchHandlerRef.onHistoryChanged = refreshHistoryHighlights;

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
    // Always reads chatPanelSlot.current (not a fixed panel reference)
    // so this stays correct across handleBranch swapping in a new panel
    // instance — see the chatPanelSlot doc comment above.
    getActiveConversationId: () =>
      typeof chatPanelSlot.current.getConversationId === "function"
        ? chatPanelSlot.current.getConversationId()
        : null,
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

  // Re-renders both places a saved conversation can show up (the full
  // History tab list and the desktop sidebar's short recents list) so
  // their "currently active" highlight (see ai-agent-history.js's
  // getActiveConversationId / refreshSidebarRecents below) follows
  // whatever the Chat tab has open right now. Passed as chat panels'
  // onHistoryChanged — fired after every save, new-chat, and
  // loadConversation (see ai-agent-chat.js) — rather than only on tab
  // clicks, so the highlight in an already-open History tab (desktop
  // layout keeps the sidebar visible alongside it) doesn't go stale
  // mid-conversation.
  function refreshHistoryHighlights() {
    historyPanel.refresh();
    refreshSidebarRecents();
    refreshCopyButtonState();
  }

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
    refreshHistoryHighlights();
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
    const newPanel = createChatPanel({
      ...options,
      // BUG FIX: this used to pass `handleBranch` directly, which bakes a
      // closure over THIS modal-open's `body`/`chatPanelSlot` straight
      // into the panel's DOM-attached listener. That's fine for the rest
      // of this same modal session, but this panel is also cached via
      // setChatPanelForPageKey below and can be reused as `existingChatPanel`
      // on a LATER modal reopen — at which point `body` here has already
      // been removed (closeModal()'s modal.remove()) and a brand new one
      // exists in the new buildWidgetContent() call. Editing a message a
      // second time then ran the STALE handleBranch against the old,
      // detached `body`, throwing "the node to be replaced is not a child
      // of this node" from replaceChild, while the new modal's own sidebar
      // — never told about the branch — kept its original modelBarEl in
      // place, leaving two `.ai-agent-chat-model-select` bars on screen.
      // Routing through the same per-pageKey forwarding proxy every other
      // cached panel uses (see getOrCreateChatPanel) fixes both: the proxy
      // always calls whichever handleBranch the CURRENTLY open modal most
      // recently registered (see the branchHandlerRef.current assignment
      // right after this function), never a stale one.
      onBranchConversation: branchHandlerRef
        ? (b) => branchHandlerRef.current?.(b)
        : handleBranch,
      onHistoryChanged: refreshHistoryHighlights,
    });
    body.replaceChild(newPanel, chatPanelSlot.current);
    chatPanelSlot.current = newPanel;
    chatPanelSlot.current.classList.add("active");
    setChatPanelForPageKey(pageKey, newPanel);
    newPanel.loadBranch(branch);
    activateTab(chatTabBtn, newPanel);
    relocateModelBar();
    refreshHistoryHighlights();
  }

  // See buildWidgetContent's own onBranchConversation doc above: if this
  // widget was built around an `existingChatPanel` reused from
  // getOrCreateChatPanel(), that panel's onBranchConversation was set to
  // a forwarding proxy (branchHandlerRef) at creation time, since the
  // real handleBranch() couldn't exist yet back then. Point that proxy
  // at the real thing now that it does — this only matters for the very
  // first panel of a pageKey; every panel created after this point (via
  // handleBranch itself) already gets the real function directly.
  if (branchHandlerRef) branchHandlerRef.current = handleBranch;

  // ── Desktop sidebar ──
  // Hidden entirely on mobile via CSS (see .ai-agent-sidebar's display:none
  // below >=901px in ai-agent.css) — built unconditionally here rather
  // than gated on a JS viewport check so a resize across the breakpoint
  // (e.g. rotating a tablet, or a desktop window being resized) doesn't
  // need this whole widget rebuilt, just a CSS reflow.
  const sidebar = document.createElement("div");
  sidebar.className = "ai-agent-sidebar";

  // Retractable/extendable using the same mechanism as the app's Main
  // Side-Menu (see side-menu.js): a persisted boolean toggled via a
  // `collapsed` class + CSS width-variable swap. Mirrors side-menu.js's
  // three-element header exactly, not just its single collapse button:
  // (1) a collapsed-rail favicon button (own logo, shown only while
  // collapsed — clicking it expands), (2) an expanded-only header row
  // with the full wordmark + name (shown only while expanded, purely
  // decorative/branding — same as .sidebar-logo, not a click target),
  // and (3) an expanded-only collapse button inside that header row.
  // Uses its own localStorage key so it never collides with, or gets
  // overridden by, the main side-menu's persisted state — the two panels
  // are independent of one another.
  const AI_AGENT_SIDEBAR_STORAGE_KEY = "ai_agent_sidebar_expanded";
  let sidebarCollapsed;
  try {
    sidebarCollapsed = localStorage.getItem(AI_AGENT_SIDEBAR_STORAGE_KEY) === "false";
  } catch {
    sidebarCollapsed = false;
  }

  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "ai-agent-sidebar-header";

  // (1) Collapsed-rail favicon — logo image + expand icon as two
  // siblings inside one button, crossfaded on hover via CSS (see
  // .ai-agent-sidebar-favicon-img / .ai-agent-sidebar-expand-icon in
  // ai-agent.css) — exactly side-menu.css's .sidebar-favicon pattern:
  // default state shows the logo, hover/focus swaps to the expand icon.
  // Only visible while collapsed (CSS); acts as the expand trigger.
  const sidebarFaviconBtn = document.createElement("button");
  sidebarFaviconBtn.type = "button";
  sidebarFaviconBtn.className = "ai-agent-sidebar-favicon";
  sidebarFaviconBtn.setAttribute("aria-label", "توسيع الشريط الجانبي");
  sidebarFaviconBtn.title = "توسيع الشريط الجانبي";
  sidebarFaviconBtn.innerHTML =
    '<img src="/assets/images/el-bash-mebasmag--no-bg.png" alt="الباشــمبصمج" class="ai-agent-sidebar-favicon-img">' +
    SIDEBAR_EXPAND_ICON_SVG;

  // (2) Expanded header: full logo/name + (3) the collapse button —
  // grouped exactly like .sidebar-header/.sidebar-brand-link/
  // .sidebar-logo/.sidebar-collapse-btn in the main menu. The logo here
  // is presentational branding, not a link (the AI agent panel isn't a
  // page to navigate away to), so it's a plain div, not an <a>.
  const sidebarBrand = document.createElement("div");
  sidebarBrand.className = "ai-agent-sidebar-brand";
  sidebarBrand.innerHTML =
    '<img src="/assets/images/el-bash-mebasmag--no-bg.png" alt="" class="ai-agent-sidebar-brand-img"><span class="ai-agent-sidebar-brand-name">الباشــمبصمج</span>';

  // Collapse button: two icon siblings (default "panel-left" / hover
  // "panel-left-open" — same lucide icons and same crossfade mechanism
  // side-menu.css uses for #sidebarCollapseBtn) rather than one static
  // icon, matching the requested hover behavior exactly.
  const sidebarCollapseBtn = document.createElement("button");
  sidebarCollapseBtn.type = "button";
  sidebarCollapseBtn.className = "ai-agent-sidebar-collapse-btn";
  sidebarCollapseBtn.setAttribute("aria-label", "طي الشريط الجانبي");
  sidebarCollapseBtn.title = "طي الشريط الجانبي";
  sidebarCollapseBtn.innerHTML = SIDEBAR_COLLAPSE_DEFAULT_ICON_SVG + SIDEBAR_COLLAPSE_HOVER_ICON_SVG;

  sidebarHeader.append(sidebarFaviconBtn, sidebarBrand, sidebarCollapseBtn);

  function applySidebarCollapsedState(collapsed) {
    sidebarCollapsed = collapsed;
    sidebar.classList.toggle("ai-agent-sidebar--collapsed", collapsed);
    sidebarCollapseBtn.setAttribute("aria-label", collapsed ? "توسيع الشريط الجانبي" : "طي الشريط الجانبي");
    sidebarCollapseBtn.title = collapsed ? "توسيع الشريط الجانبي" : "طي الشريط الجانبي";
    try {
      localStorage.setItem(AI_AGENT_SIDEBAR_STORAGE_KEY, String(!collapsed));
    } catch {
      // Non-fatal — collapse state just won't persist across reloads.
    }
  }

  sidebarCollapseBtn.addEventListener("click", () => {
    applySidebarCollapsedState(!sidebarCollapsed);
  });
  // The favicon IS the dedicated expand trigger while collapsed (CSS
  // hides it entirely once expanded, same as .sidebar-favicon) — no
  // extra whole-rail click listener needed on top of it (see the
  // "double resize" fix note on applySidebarCollapsedState's callers:
  // that extra listener was the second, redundant toggle path).
  sidebarFaviconBtn.addEventListener("click", () => {
    applySidebarCollapsedState(false);
  });

  sidebar.appendChild(sidebarHeader);
  applySidebarCollapsedState(sidebarCollapsed);

  const sidebarNewChatBtn = document.createElement("button");
  sidebarNewChatBtn.type = "button";
  sidebarNewChatBtn.className = "ai-agent-sidebar-btn";
  sidebarNewChatBtn.innerHTML = `${NEW_CHAT_ICON_SVG}<span>محادثة جديدة</span>`;
  sidebarNewChatBtn.addEventListener("click", () => {
    chatPanelSlot.current.startNewConversation();
    activateTab(chatTabBtn, chatPanelSlot.current);
    refreshCopyButtonState();
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
    if (sidebarCopyBtn.disabled) return;
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

  // Disables (visually + functionally) the "نسخ المحادثة" button whenever
  // the active panel has no messages yet — a brand new/empty chat has
  // nothing to copy. Reuses panel.hasMessages() (ai-agent-chat.js), the
  // same history.length signal that already drives the corner "new
  // chat"/"export chat" icon buttons' own visibility, so this stays in
  // sync with them for free. Called from refreshHistoryHighlights (fired
  // after every send/new-chat/loadConversation/branch — see that
  // function's own doc comment) plus once below at initial mount, rather
  // than needing a dedicated push callback threaded through every panel.
  function refreshCopyButtonState() {
    const hasMessages =
      typeof chatPanelSlot.current.hasMessages === "function"
        ? chatPanelSlot.current.hasMessages()
        : true;
    sidebarCopyBtn.disabled = !hasMessages;
    sidebarCopyBtn.classList.toggle("ai-agent-sidebar-btn--disabled", !hasMessages);
  }
  refreshCopyButtonState();

  sidebar.appendChild(sidebarNewChatBtn);
  sidebar.appendChild(sidebarCopyBtn);

  // ── Model selector slot ──
  // Holds whichever chat panel's own `.modelBarEl` (see createChatPanel
  // in ai-agent-chat.js) is currently active, moved here from its default
  // spot above the chat panel's input row — see the "Sidebar Integration"
  // requirement: the bar used to render full-panel-width above the input
  // row, which read as an oversized dropdown in the wrong place. A slot
  // (rather than reparenting once) because branching (handleBranch below)
  // swaps in a brand NEW panel with its OWN new modelBarEl each time —
  // relocateModelBar() re-does the move whenever the active panel changes.
  const modelBarSlot = document.createElement("div");
  modelBarSlot.className = "ai-agent-sidebar-model-slot";
  sidebar.appendChild(modelBarSlot);

  function relocateModelBar() {
    const bar = chatPanelSlot.current?.modelBarEl;
    if (bar && bar.parentElement !== modelBarSlot) {
      modelBarSlot.appendChild(bar);
    }
  }
  relocateModelBar();

  const sidebarRecentsLabel = document.createElement("div");
  sidebarRecentsLabel.className = "ai-agent-sidebar-label";
  sidebarRecentsLabel.textContent = "محادثات سابقة";
  sidebar.appendChild(sidebarRecentsLabel);

  const sidebarRecentsList = document.createElement("div");
  sidebarRecentsList.className = "ai-agent-sidebar-recents";
  sidebar.appendChild(sidebarRecentsList);

  // The sidebar previously duplicated "show full history" as its own
  // button (.ai-agent-sidebar-show-all) alongside the tab strip's own
  // .ai-agent-tab-btn (السابقة) — same destination, so it was pure
  // redundancy on desktop. Removed; the tab button is the one way in.
  //
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
    const activeId =
      typeof chatPanelSlot.current.getConversationId === "function"
        ? chatPanelSlot.current.getConversationId()
        : null;

    sidebarRecentsList.innerHTML = "";
    conversations.slice(0, 5).forEach((conv) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ai-agent-sidebar-recent-item";
      // Mirrors the History tab's own active highlight (see
      // ai-agent-history.js) — same underlying data, so both lists
      // should agree on which conversation is currently open.
      if (activeId && conv.id === activeId) {
        item.classList.add("ai-agent-sidebar-recent-item--active");
        item.setAttribute("aria-current", "true");
      }
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

  row.insertBefore(sidebar, body);

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

// One forwarding ref per pageKey, created together with that pageKey's
// first chat panel and reused for the panel's entire lifetime (including
// across modal close+reopen) — see getOrCreateChatPanel's own comment.
// Deliberately a SEPARATE map from chatPanelsByPageKey (rather than e.g.
// bundling {panel, ref} into one entry) so existing reads of
// chatPanelsByPageKey.get(key) elsewhere don't need to change shape.
const branchHandlerRefsByPageKey = new Map();

function getOrCreateChatPanel(options) {
  const key = options.pageKey || "default";
  let chatPanel = chatPanelsByPageKey.get(key);
  if (!chatPanel) {
    // BUG FIX: this used to call createChatPanel(options) with no
    // onBranchConversation at all, so the very FIRST panel ever created
    // for a pageKey (i.e. what every fresh modal open — mobile or
    // desktop — actually renders) never got the Edit-user-prompt
    // callback, and appendMessage()'s addEditButton is only invoked when
    // onBranchConversation is truthy (see ai-agent-chat.js) — so the pen
    // icon silently never appeared until AFTER a branch had already
    // happened once (branch panels are built via handleBranch, which did
    // pass it directly). The real handleBranch() closure doesn't exist
    // yet at panel-creation time (it's defined inside buildWidgetContent,
    // which runs once per modal OPEN, well after this) — worse, it's
    // rebuilt fresh on every single reopen (new `body`/`chatTabBtn`
    // closure vars each time), while this panel instance is cached and
    // reused across reopens. So onBranchConversation forwards through a
    // ref keyed by pageKey (not a fresh one per call) — buildWidgetContent
    // repoints ref.current at its own freshly-built handleBranch on every
    // open (see its own comment), and this panel's closure always calls
    // whatever the current ref.current is, so it never ends up calling a
    // handleBranch left over from an already-closed modal instance.
    let ref = branchHandlerRefsByPageKey.get(key);
    if (!ref) {
      ref = { current: null };
      branchHandlerRefsByPageKey.set(key, ref);
    }
    chatPanel = createChatPanel({
      ...options,
      onBranchConversation: (branch) => ref.current?.(branch),
      // Same forwarding trick as onBranchConversation just above, for the
      // History tab/sidebar active-highlight refresh (see
      // buildWidgetContent's own comment on branchHandlerRef.onHistoryChanged):
      // this panel is cached and can outlive the modal instance that
      // created it, so it must always call whichever modal is CURRENTLY
      // open's refresh function, not one captured at creation time.
      onHistoryChanged: () => ref.onHistoryChanged?.(),
    });
    chatPanelsByPageKey.set(key, chatPanel);
  }
  return chatPanel;
}

function getBranchHandlerRef(pageKey) {
  const key = pageKey || "default";
  let ref = branchHandlerRefsByPageKey.get(key);
  if (!ref) {
    ref = { current: null };
    branchHandlerRefsByPageKey.set(key, ref);
  }
  return ref;
}

function getChatPanelForPageKey(key) {
  return chatPanelsByPageKey.get(key || "default") || null;
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
  const cachedChat = getChatPanelForPageKey(options.pageKey);
  if (cachedChat && !cachedChat.isGenerating?.()) {
    cachedChat.clearTyping?.();
  }

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
    const activeChat = getChatPanelForPageKey(options.pageKey);
    if (activeChat && !activeChat.isGenerating?.()) {
      activeChat.clearTyping?.();
    }
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
    <h2 id="aiAgentModalTitle"><img src="/assets/images/el-bash-mebasmag--no-bg.png" alt="" class="ai-agent-logo" aria-hidden="true"> الباشــمبصمج</h2>
    <button type="button" class="close-btn ai-agent-modal-close" aria-label="إغلاق">${CLOSE_ICON_SVG}</button>
  `;

  // See getOrCreateChatPanel's own doc comment: this ref (one per
  // pageKey, persisted across modal close+reopen) lets the cached chat
  // panel forward Edit-user-prompt submissions to the CURRENT modal
  // instance's handleBranch() closure — buildWidgetContent repoints
  // ref.current at its own freshly-built handleBranch below, every time
  // this function runs.
  const branchHandlerRef = getBranchHandlerRef(options.pageKey);

  modalCard.appendChild(header);
  modalCard.appendChild(
    buildWidgetContent(options, getOrCreateChatPanel(options), branchHandlerRef)
  );
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
  fab.setAttribute("aria-label", "افتح الباشــمبصمج");
  fab.title = "الباشــمبصمج";
  fab.innerHTML = `<img src="/assets/images/el-bash-mebasmag--no-bg.png" alt="" class="ai-agent-fab-logo" aria-hidden="true">`;
  fab.addEventListener("click", () => openAIAgentModal(options, fab));
  return fab;
}

// Kept for callers that genuinely want the tabbed widget embedded inline
// rather than behind a FAB/modal (e.g. a future dedicated "AI Helper" page).
export { buildWidgetContent as createAIAgentWidget };
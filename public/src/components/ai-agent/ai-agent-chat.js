// =============================================================================
// public/src/components/ai-agent/ai-agent-chat.js
// Chat tab: conversation state, sending messages to /api/ai-agent/chat,
// and rendering the message list. Self-contained — takes everything it
// needs via createChatPanel(options) so it can be mounted from either the
// "امتحاناتك" view or result.html with different contextual system prompts.
// =============================================================================

import { renderMarkdown, _processByLine } from "../../shared/markdown.js";
import { getSelectedProvider, getSelectedModel, getModelsForProvider, setSelectedModel, getOwnKey, getSystemPrompt, applyResponseLanguage, isAiHelperAvailable } from "./ai-agent-settings.js";
import { getUserToken } from "../../shared/userLevel.js";
import { isAdminAuthenticated, getToken as getAdminToken } from "../../shared/adminAuth.js";
import { saveConversation, deriveConversationTitle } from "./ai-agent-history-idb.js";
// PHASE 3c: reuses the same anchored-popover engine already used for the
// history sidebar's per-item "⋮" menu (ai-agent-history.js) and the exam
// cards' own ⋮ menu — per the plan's explicit instruction not to invent a
// third distinct dropdown-menu visual style in this codebase.
import { openExamDropdownMenu, closeAllExamDropdownMenus } from "../../features/home/exam-dropdown-menu.js";
import { positionExamDropdownMenu } from "../../features/home/floating-position.js";
import { listRecentUserItems, resolveUserItemById } from "./ai-agent-item-lookup.js";

// Safety cap on how many tool-driven rounds resendLastUserTurn() will
// chain in a single agent turn (see its `agentDepth` param) before giving
// up and surfacing an error instead of continuing to recurse. Guards
// against a model that keeps requesting tools every round — without this,
// that would recurse (and keep hitting the network) indefinitely with no
// way for the user to tell it apart from genuine progress.
const MAX_AGENT_DEPTH = 8;
const CHAT_INPUT_MAX_HEIGHT = 120;

// Icons for the two visual states of the "assistant is working" indicator
// (see showTyping) — a sparkle/spark glyph for plain "thinking"
// generation, and a wrench for "running a tool", so the two states are
// distinguishable at a glance rather than only by reading the label text.
const TYPING_THINKING_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>';
const TYPING_TOOL_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/></svg>';
const TYPING_STOP_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>';

/**
 * Reads a File into a bare base64 string (no "data:...;base64," prefix —
 * the backend/provider adapters expect raw base64, see api/ai-agent/chat.js).
 * @param {File} file
 * @returns {Promise<string>}
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * @param {object} options
 * @param {string|(() => string)} [options.contextPrompt] - optional context
 *   text prepended as the first outgoing user-role message (e.g. the
 *   create-quiz page's live "here's what's currently on this page" blurb).
 *   Distinct from the system prompt below. Pass a function, not a static
 *   string, whenever the underlying state can change during the panel's
 *   lifetime — resolved fresh on every send (see sendMessage below), same
 *   rationale as contextSummary's function form just below.
 * @param {Array<object>|(() => Array<object>)} [options.contextSummary] -
 *   lightweight per-item summaries (e.g. {title, questionCount, types}) —
 *   ONLY for the home page's specific "list of saved quizzes" rendering
 *   (see the hardcoded amتحانات-المستخدم-الحالية template in sendMessage
 *   below); a page with a single/different-shaped state to describe should
 *   use contextPrompt (a plain string) instead, not force its data into
 *   this array-of-objects shape. Folded into the same one-off context
 *   message as contextPrompt, read fresh before EVERY send — pass a
 *   function here, not a static array, whenever the underlying data can
 *   change during the panel's lifetime (edits, a reset, a tool call
 *   mutating it, or simply time passing since the page loaded). A plain
 *   array is only safe for data that's genuinely fixed for the panel's
 *   whole lifetime. Static-array support is kept for backward
 *   compatibility with existing callers; new callers whose summary can go
 *   stale should pass a function.
 * @param {string} [options.placeholder] - input placeholder text.
 * @param {"home"|"result"} [options.pageKey] - keys per-page system-prompt storage.
 * @param {string} [options.defaultSystemPrompt] - page-specific default system prompt.
 * @param {boolean} [options.enableTools] - whether the chat may call tools (e.g. create_quiz).
 * @param {string[]} [options.toolNames] - which tool names to request from
 *   the backend when enableTools is true (see api/ai-agent/_tools.js /
 *   chat.js's TOOLS_BY_NAME). Omit to get the original default set
 *   (create_quiz, edit_quiz, delete_quiz) — pages offering a different
 *   set (e.g. the create-quiz editor's edit_quiz + reset_quiz_page) must
 *   pass this explicitly.
 * @param {(toolCall: {name: string, input: object}) => (string|Promise<string>)} [options.onToolCall] -
 *   invoked (and awaited) when the assistant calls a tool; the actual
 *   localStorage write happens here, supplied per-page. May be async —
 *   e.g. to show the app's own confirmation dialog (_confirm() in
 *   notifications.js) for a destructive action before proceeding, rather
 *   than a blocking native window.confirm(). Never passed on pages with
 *   enableTools unset, so this branch is unreachable there.
 * @param {string[]} [options.suggestedPrompts] - "quick prompt" chips shown
 *   above the input before the first message is sent; tapping one fills +
 *   sends it immediately.
 * @param {boolean} [options.enableFileUpload] - shows an attach-file button
 *   next to the input. One file at a time (v1) — see AI_HELPER_IMPROVEMENT_PLAN.md
 *   Task 3. Supported today: images, PDF (sent natively to Google/Claude),
 *   and .docx (text-extracted server-side, works with any provider).
 * @param {() => void} [options.onHistoryChanged] - called after a
 *   conversation is saved, so the History tab (if open/rendered already)
 *   can refresh its list without polling.
 * @param {(branch: {messages: Array<object>, createdAt: number}) => void} [options.onBranchConversation] -
 *   called when the user edits-and-resubmits a past user prompt (see the
 *   pen-icon Edit button next to a user message's Copy button below).
 *   Receives the conversation history truncated up to and including the
 *   edited prompt (with its content replaced by the edited text) — the
 *   caller (ai-agent.js) is responsible for actually starting a brand new
 *   chat panel/session from that branch, since this panel intentionally
 *   never mutates its own conversationId/history for an edit: the
 *   original conversation must stay exactly as it was in the user's
 *   history (see the Edit button's own inline comment for the full
 *   rationale).
 * @returns {HTMLElement} the chat panel root element — also carries a
 *   `.loadConversation(conversation)` method (see bottom of this function)
 *   that the History tab calls when the user picks a past conversation.
 */
export function createChatPanel(options = {}) {
  const {
    contextPrompt = "",
    placeholder = "اسأل أي سؤال عن الامتحان...",
    pageKey = "default",
    defaultSystemPrompt = "",
    enableTools = false,
    toolNames = null,
    onToolCall = null,
    contextSummary = null,
    suggestedPrompts = [],
    enableFileUpload = false,
    onHistoryChanged = null,
    onBranchConversation = null,
  } = options;

  // Identifies this conversation in IndexedDB across its whole lifetime —
  // generated once per panel instance (i.e. once per "new chat"), reused
  // for every save so saveConversation() overwrites the same record rather
  // than creating a new one per turn. Reassigned wholesale by
  // loadConversation() below when the user opens a past conversation.
  let conversationId = crypto.randomUUID();
  let conversationCreatedAt = Date.now();

  const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // keep in sync with api/ai-agent/chat.js
  const ACCEPTED_ATTACHMENT_TYPES =
    "image/jpeg,image/png,image/gif,image/webp,application/pdf,.docx," +
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  // PHASE 3/2a: the backend (api/ai-agent/chat.js's MAX_ATTACHMENTS_PER_MESSAGE)
  // still enforces one FILE per message — this cap is client-side UX only
  // (how many tiles the row will hold), covering a mix of a file + any
  // number of platform-item attachments (quiz/course/folder references,
  // which cost the backend a text-context expansion, not a binary upload,
  // so they aren't bound by the same 1-file limit).
  const MAX_PENDING_ATTACHMENTS = 6;

  /**
   * PHASE 2a attachment-model refactor: was a single `pendingAttachment`
   * object; now an array so a FILE attachment (existing: user-picked/
   * dropped, base64-encoded — shape: {kind:"file", mimeType, base64, name})
   * and PLATFORM-ITEM attachments (new: a reference to a quiz/course/folder
   * already on the platform/local storage, NOT re-uploaded — shape:
   * {kind:"quiz"|"course"|"folder", id, title, source:"platform"|"local"})
   * can coexist. Phase 2's entry points (openAIAgentWithAttachment, see
   * ai-agent-attach-launcher.js) push platform-item attachments in here;
   * Phase 4's `/`/`@` menu will do the same for multi-attach. Only ever
   * populated with at most one FILE at a time (backend limit, see above)
   * but any number of platform-item entries.
   * @type {Array<{kind: "file", mimeType: string, base64: string, name: string} | {kind: "quiz"|"course"|"folder", id: string, title: string, source: "platform"|"local"}>}
   */
  let pendingAttachments = [];

  /** @type {Array<{role: "user"|"assistant", content: string}>} */
  const history = [];

  /** @type {AbortController | null} */
  let currentAbortController = null;
  let isGenerating = false;
  let sessionExecutedTools = new Set();
  let attachmentToolHandler = null;

  const panel = document.createElement("div");
  panel.className = "ai-agent-panel ai-agent-chat-panel";

  // Desktop-only model selector (Task 4: "Include the Model Selector
  // setting on desktops on the chat tab"). Hidden entirely on mobile via
  // CSS (see .ai-agent-chat-model-bar's display:none below >=901px in
  // ai-agent.css) — the Settings tab remains the only place to change the
  // model there, same as before this feature existed. Reads/writes the
  // exact same storage as the Settings tab's own model select (see
  // ai-agent-settings.js), so a change made from either place is
  // reflected in both without extra plumbing between them.
  const modelBar = document.createElement("div");
  modelBar.className = "ai-agent-chat-model-bar";

  const modelBarSelect = document.createElement("select");
  modelBarSelect.className = "ai-agent-chat-model-select";
  modelBarSelect.id = "ai-agent-chat-model-select";
  modelBarSelect.name = "ai-agent-chat-model-select";
  modelBarSelect.setAttribute("aria-label", "اختر النموذج");

  // Model selection only makes sense when the request will actually use
  // it — i.e. the user has saved their own API key. On the platform-key
  // path every request shares the same rotated Google AI Studio
  // free-tier keys (see api/ai-agent/chat.js), which always forces the
  // lightest default server-side regardless of what's sent — so letting
  // the dropdown look interactive there is actively misleading, on top of
  // inviting a client that could otherwise be tricked into requesting a
  // heavier model. Disabled (not hidden) so it's still visible as a
  // preview of what an own key would unlock.
  function refreshModelBarAvailability() {
    const { hasKey } = getOwnKey();
    modelBarSelect.disabled = !hasKey;
    modelBarSelect.title = hasKey
      ? ""
      : "اختيار النموذج متاح فقط عند استخدام مفتاح API الخاص بك";
  }

  function refreshModelBarOptions() {
    const provider = getSelectedProvider();
    modelBarSelect.innerHTML = "";
    const models = getModelsForProvider(provider);
    models.forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      modelBarSelect.appendChild(opt);
    });
    // getSelectedModel() returns "" (meaning "use the provider's own
    // default") whenever no model has been explicitly saved yet — but ""
    // never matches any <option>'s value, which left the select rendering
    // with nothing visibly chosen. Fall back to the first (lightest/
    // default) model in the list so there's always a real, visible
    // selection, exactly matching what the backend actually uses in that
    // unset case.
    modelBarSelect.value = getSelectedModel() || (models[0] && models[0].value) || "";
    refreshModelBarAvailability();
  }
  refreshModelBarOptions();

  modelBarSelect.addEventListener("change", () => {
    setSelectedModel(getSelectedProvider(), modelBarSelect.value);
  });

  modelBar.appendChild(modelBarSelect);
  panel.appendChild(modelBar);
  // Exposed so ai-agent.js can relocate this node into the desktop
  // sidebar (see the "Sidebar Integration" requirement — the model bar
  // used to render above the input row instead, full chat-panel width,
  // which read as an oversized dropdown sitting in the wrong place
  // entirely). Left appended to `panel` above as the DEFAULT position
  // (mobile, or any embedding that doesn't move it) — ai-agent.js moving
  // it elsewhere is an explicit opt-in, not a requirement for this
  // module to work standalone.
  panel.modelBarEl = modelBar;

  const messagesEl = document.createElement("div");
  messagesEl.className = "ai-agent-chat-messages";
  panel.appendChild(messagesEl);

  /**
   * Builds the plain-text "أنت: ... / البشمبصمج: ..." transcript and
   * copies it to the clipboard — shared by the in-panel corner export
  * button (the desktop sidebar's "نسخ المحادثة"
   * button (see ai-agent.js, which calls panel.exportConversation()
   * directly rather than needing to reach into this panel's DOM to click
   * the corner button programmatically).
   * @returns {Promise<boolean>} whether the copy succeeded
   */
  async function exportTranscript() {
    if (!history.length) return false;
    // تول-result entries get their own "🔧 النظام:" label so they read as
    // distinct from a normal assistant reply, matching how they're
    // visually distinguished (muted/system style) in the live chat and in
    // the History tab's re-render (see loadConversation above).
    const transcript = history
      .map((m) => {
        const label = m.type === "tool-result" ? "🔧 النظام" : m.role === "user" ? "أنت" : "البشمبصمج";
        return `${label}: ${m.content}`;
      })
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(transcript);
      return true;
    } catch (err) {
      console.error("[ai-agent-chat] export-chat clipboard write failed:", err);
      return false;
    }
  }
  panel.exportConversation = exportTranscript;

  // Suggestion chips — only meaningful before the conversation starts.
  // renderSuggestions() (re)builds them; called once up front here, and
  // again from startNewConversation() so a fresh chat gets its chips back
  // — they were previously only ever built once per panel instance and
  // permanently removed on first send, so pressing "new chat" left the
  // fresh conversation without any, unlike actually reopening the AI
  // Helper. removeSuggestions() is what runs on first send (and at the
  // top of loadConversation) to clear them for an in-progress/loaded
  // conversation.
  let suggestionsEl = null;

  function removeSuggestions() {
    if (suggestionsEl) {
      suggestionsEl.remove();
      suggestionsEl = null;
    }
  }

  function renderSuggestions() {
    removeSuggestions();
    if (!Array.isArray(suggestedPrompts) || !suggestedPrompts.length) return;

    suggestionsEl = document.createElement("div");
    suggestionsEl.className = "ai-agent-suggestions";
    suggestedPrompts.forEach((prompt) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ai-agent-suggestion-chip";
      chip.textContent = prompt;
      chip.addEventListener("click", () => {
        if (sendBtn.disabled) return;
        textarea.value = prompt;
        sendMessage();
      });
      suggestionsEl.appendChild(chip);
    });
    // Always insert right before inputRow (declared further down, but this
    // function is never called until after inputRow exists — see the
    // initial renderSuggestions() call below it) so re-rendering the chips
    // from startNewConversation() puts them back in the same spot rather
    // than appending after the input row.
    panel.insertBefore(suggestionsEl, inputRow);
  }

  // PHASE 3 icons for the attachment tiles — a generic file glyph (used for
  // any file attachment that isn't an image; images get a real thumbnail
  // instead, built in buildAttachmentTile below) and one glyph per
  // platform-item kind, reusing the same shapes the rest of the app already
  // uses for quizzes/courses/folders (see user-quiz-card.js/
  // user-quizzes-folders.js's 📝/📚/📁-style conventions) so a tile reads
  // as "the same kind of thing" wherever it shows up, not a new icon set
  // invented just for this popover.
  const ATTACHMENT_FILE_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/></svg>';
  const ATTACHMENT_QUIZ_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
  const ATTACHMENT_COURSE_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  const ATTACHMENT_FOLDER_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
  const ATTACHMENT_REMOVE_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  /**
   * Shared by both saveConversation() call sites in resendLastUserTurn()
   * (after a normal turn, and after a tool-result) — maps in-memory
   * `history` (which can carry base64 file data + platform-item objects
   * in `attachments`) down to the lightweight persisted shape IndexedDB
   * actually stores. Only `attachmentName` (a single display label)
   * survives a save — same "v1: one file at a time" persisted shape as
   * before Phase 2a/3, just now also covering a platform-item's `.title`
   * as a fallback source for that label, so a quiz/course/folder-only
   * opener (no file) still gets a sensible chip on reload and a sensible
   * derived history title (see deriveConversationTitle's own matching
   * fallback in ai-agent-history-idb.js).
   * @param {Array<object>} historyToPersist
   */
  function toPersistedMessages(historyToPersist) {
    return historyToPersist.map(({ role, content, attachments, type }) => {
      const firstLabel = attachments?.[0]?.name || attachments?.[0]?.title;
      return {
        role,
        content,
        ...(type ? { type } : {}),
        ...(firstLabel ? { attachmentName: firstLabel } : {}),
      };
    });
  }

  /**
   * PHASE 2b (adapted, see toWireMessage's own comment on why this runs
   * client-side rather than server-side): turns one platform-item
   * attachment into a labeled block of context text the model can reason
   * about. Relies on `att.summary` — a plain-text blurb the launcher
   * (ai-agent-attach-launcher.js) already built from the quiz/course/
   * folder data it had on hand at attach time (this module deliberately
   * doesn't import quiz-schema/storage helpers itself, to stay a
   * self-contained "takes everything via options/attachments" component
   * per its own header comment) — falls back to just the title if no
   * summary was supplied (e.g. a server-hosted course whose quiz list
   * isn't loaded client-side at attach time).
   * @param {{kind: "quiz"|"course"|"folder", title: string, summary?: string}} att
   */
  function expandPlatformAttachment(att) {
    const kindLabelAr = { quiz: "اختبار", course: "مادة", folder: "مجلد" }[att.kind] || att.kind;
    const body = att.payload
      ? JSON.stringify(att.payload)
      : att.summary || "(لا تفاصيل إضافية متاحة عن هذا العنصر)";
    return `[مرفق ${kindLabelAr}: ${att.title}]\n${body}`;
  }

  function iconForAttachment(att) {
    if (att.kind === "quiz") return ATTACHMENT_QUIZ_ICON_SVG;
    if (att.kind === "course") return ATTACHMENT_COURSE_ICON_SVG;
    if (att.kind === "folder") return ATTACHMENT_FOLDER_ICON_SVG;
    return ATTACHMENT_FILE_ICON_SVG;
  }

  function labelForAttachment(att) {
    return att.kind === "file" ? att.name : att.title;
  }

  /**
   * Builds one square tile (~64-72px, per Phase 3b) for a single pending
   * attachment — an image file gets a real thumbnail (base64 data URL,
   * already in memory from handlePickedFile), everything else gets an
   * icon matching its kind (see iconForAttachment). Shared by
   * renderAttachmentChips below.
   * @param {object} att - one entry from pendingAttachments
   * @param {number} index - its index, so the remove button can splice
   *   the exact right entry back out (attachments have no stable id of
   *   their own — index is stable for the tile's lifetime since
   *   pendingAttachments is only ever mutated by a full re-render here).
   */
  function buildAttachmentTile(att, index) {
    const tile = document.createElement("div");
    tile.className = `ai-agent-attachment-tile ai-agent-attachment-tile--${att.kind}`;
    tile.title = labelForAttachment(att) || "";

    const preview = document.createElement("div");
    preview.className = "ai-agent-attachment-tile-preview";
    if (att.kind === "file" && att.mimeType && att.mimeType.startsWith("image/") && att.base64) {
      const img = document.createElement("img");
      img.className = "ai-agent-attachment-tile-thumb";
      img.src = `data:${att.mimeType};base64,${att.base64}`;
      img.alt = "";
      preview.appendChild(img);
    } else {
      preview.innerHTML = iconForAttachment(att);
    }
    tile.appendChild(preview);

    const nameSpan = document.createElement("span");
    nameSpan.className = "ai-agent-attachment-tile-name";
    nameSpan.textContent = labelForAttachment(att) || "";
    tile.appendChild(nameSpan);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ai-agent-attachment-tile-remove";
    removeBtn.setAttribute("aria-label", "إزالة المرفق");
    removeBtn.innerHTML = ATTACHMENT_REMOVE_ICON_SVG;
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      pendingAttachments.splice(index, 1);
      renderAttachmentChips();
    });
    tile.appendChild(removeBtn);

    return tile;
  }

  // PHASE 3b: attachment tiles now render INSIDE the bordered input
  // container itself (a row above the textarea line), not as a sibling
  // element sitting above the whole input row — was
  // `panel.insertBefore(attachmentChipEl, inputRow)`; now appended into
  // `attachmentTilesRow`, which itself lives inside `inputRow` (see
  // inputRow assembly below). Built lazily/emptied-and-rebuilt on every
  // call, same as the old single-chip version, just N tiles instead of 0-1.
  let attachmentTilesRow = null;
  function renderAttachmentChips() {
    if (attachmentTilesRow) {
      attachmentTilesRow.remove();
      attachmentTilesRow = null;
    }
    if (!pendingAttachments.length) {
      // Clearing the last attachment can drop the last reason Send was
      // visible (an attachment alone, with no typed text, is still
      // something to send — see updateSendBtnVisibility's own
      // pendingAttachments check) — re-sync so removing it can hide Send
      // again when the text field is also empty.
      if (typeof updateSendBtnVisibility === "function") updateSendBtnVisibility();
      return;
    }

    attachmentTilesRow = document.createElement("div");
    attachmentTilesRow.className = "ai-agent-attachment-tiles-row";
    pendingAttachments.forEach((att, i) => {
      attachmentTilesRow.appendChild(buildAttachmentTile(att, i));
    });
    // inputRow exists by the time this can ever actually be called with a
    // non-empty pendingAttachments (nothing populates it before the input
    // row is built), so insert as its first child — above the
    // textarea/button line, per Phase 3b.
    inputRow.insertBefore(attachmentTilesRow, inputRow.firstChild);
    if (typeof updateSendBtnVisibility === "function") updateSendBtnVisibility();
  }

  const inputRow = document.createElement("div");
  inputRow.className = "ai-agent-chat-input-row";

  let fileInput = null;
  // PHASE 3c: the standalone paperclip button is gone — replaced by
  // moreBtn's popover menu below (see "more" menu section), whose first
  // item triggers the exact same fileInput.click() this used to do
  // directly. attachBtn itself no longer exists as an element; fileInput
  // still does, since something has to host the native file picker.
  let moreBtn = null;

  /**
   * Shared by both the "more" menu's "إرفاق ملف" item and drag-and-drop
   * (see the panel-level drop listener below) — validates and reads a
   * single File into a `kind:"file"` pendingAttachments entry. The backend
   * still enforces one FILE per message (see MAX_ATTACHMENTS_PER_MESSAGE
   * in api/ai-agent/chat.js), so a second file pick/drop replaces any
   * existing FILE entry — but does NOT touch platform-item entries
   * (quiz/course/folder, see Phase 2a), which aren't subject to that limit.
   * @param {File} file
   */
  async function handlePickedFile(file) {
    if (!file) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      appendError("حجم الملف كبير جدًا (الحد الأقصى 4 ميجابايت).");
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      pendingAttachments = pendingAttachments.filter((a) => a.kind !== "file");
      pendingAttachments.push({
        kind: "file",
        mimeType: file.type || "application/octet-stream",
        base64,
        name: file.name,
      });
      renderAttachmentChips();
    } catch (err) {
      console.error("[ai-agent-chat] failed to read file:", err);
      appendError("تعذرت قراءة الملف. حاول مرة أخرى.");
    }
  }

  if (enableFileUpload) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ACCEPTED_ATTACHMENT_TYPES;
    fileInput.hidden = true;

    // PHASE 3c: "more" menu — a generic {icon,label,onClick} popover so
    // future AI Agent features can add entries here without rebuilding it
    // (per the plan's own stated reason for the redesign). Today it has
    // exactly one item ("إرفاق ملف"), wired to the same fileInput.click()
    // the old standalone paperclip button used — moved, not reimplemented.
    // Styled to match the app's other small anchored popovers (see
    // openExamDropdownMenu's .exam-dropdown-menu/.exam-action-btn classes,
    // reused directly rather than inventing a third dropdown visual style —
    // per the plan's own explicit instruction not to).
    moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "ai-agent-more-btn";
    moreBtn.setAttribute("aria-label", "المزيد من الخيارات");
    moreBtn.title = "المزيد";
    moreBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';

    const moreMenuItems = [
      {
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
        label: "إرفاق ملف",
        onClick: () => fileInput.click(),
      },
      {
        // PHASE 4: surfaces the same `/`/`@` trigger-menu attachment
        // picker from inside "more" too — so a user who never notices
        // the `/`/`@` shortcut still has a discoverable way to attach
        // one of their own quizzes/folders/courses (see this file's own
        // header comment for the full trigger-menu rationale). Opens the
        // exact same openTriggerMenu()/closeTriggerMenu() pair the
        // textarea trigger uses, just anchored to the textarea's current
        // caret position (end of the field, since there's no "typed `/`"
        // position to anchor to from a menu click) instead of a
        // freshly-typed trigger character.
        icon: ATTACHMENT_QUIZ_ICON_SVG,
        label: "إرفاق اختبار أو مجلد",
        onClick: () => {
          textarea.focus();
          // Inserts a literal trigger character at the caret rather than
          // opening the menu "bare" — keeps one single invariant true
          // everywhere else in this feature (openTriggerMenu/the `input`
          // handler's re-render branch both assume
          // textarea.value[triggerMenuStart] IS the `/`/`@` that opened
          // the menu) instead of adding a second no-real-character code
          // path that every other function here would also need to
          // special-case.
          const caret = textarea.selectionStart;
          const before = textarea.value.slice(0, caret);
          const after = textarea.value.slice(caret);
          const needsSpace = before.length > 0 && !/\s$/.test(before);
          const insert = (needsSpace ? " " : "") + "/";
          textarea.value = before + insert + after;
          const newCaret = before.length + insert.length;
          textarea.setSelectionRange(newCaret, newCaret);
          updateSendBtnVisibility();
          openTriggerMenu(newCaret - 1);
        },
      },
    ];

    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openExamDropdownMenu(moreBtn, (menu) => {
        moreMenuItems.forEach(({ icon, label, onClick }) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "exam-action-btn";
          item.innerHTML = `${icon}<span>${label}</span>`;
          item.addEventListener("click", (evt) => {
            evt.stopPropagation();
            closeAllExamDropdownMenus();
            onClick();
          });
          menu.appendChild(item);
        });
      });
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = ""; // allow re-picking the same file later
      await handlePickedFile(file);
    });

    // Drag-and-drop onto the whole panel — mirrors the drag-active-class
    // pattern used by wireJsonFileDropZone() in quiz-file-import.js, but
    // generalized to any file type (server already validates/rejects
    // unsupported ones) and routed through the same handlePickedFile()
    // the file-input change handler above uses, so both paths behave
    // identically (size check, base64 read, attachment chip).
    const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

    panel.addEventListener("dragenter", (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      panel.classList.add("ai-agent-drag-over");
    });

    panel.addEventListener("dragover", (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      panel.classList.add("ai-agent-drag-over");
    });

    panel.addEventListener("dragleave", (e) => {
      // Only clear when leaving the panel itself, not entering a child.
      if (e.relatedTarget && panel.contains(e.relatedTarget)) return;
      panel.classList.remove("ai-agent-drag-over");
    });

    panel.addEventListener("drop", async (e) => {
      panel.classList.remove("ai-agent-drag-over");
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      // Still one FILE at a time (backend limit — see handlePickedFile's
      // own comment) — if multiple files are dropped, only the first is
      // used, same as the file-input which has no `multiple` attribute.
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      await handlePickedFile(file);
    });
  }

  const textarea = document.createElement("textarea");
  textarea.className = "ai-agent-chat-input";
  textarea.placeholder = placeholder;
  textarea.rows = 1;
  // "auto" (not a hardcoded "ltr"/"rtl") so the very first line — before
  // any CSS unicode-bidi kicks in visually — still gets a sane base
  // direction/alignment from its own content instead of always starting
  // LTR even for an Arabic-only message.
  textarea.dir = "auto";

  function resizeChatInput() {
    textarea.style.height = "auto";
    const contentHeight = textarea.scrollHeight;
    textarea.style.height = `${Math.min(contentHeight, CHAT_INPUT_MAX_HEIGHT)}px`;
    textarea.style.overflowY = contentHeight > CHAT_INPUT_MAX_HEIGHT ? "auto" : "hidden";
  }

  // Live mic-volume metering for the wave bars (separate from
  // SpeechRecognition, which exposes no amplitude data of its own) — a
  // short-lived AudioContext/AnalyserNode pair opened alongside each
  // dictation session so the bars reflect actual voice level instead of
  // looping a fixed CSS animation regardless of whether the user is
  // speaking. Torn down in stopMicMetering() so no mic stream/AudioContext
  // is left open once dictation ends.
  // IMPORTANT: Declared here (before dictationWaveEl) so waveBarEls.push()
  // called during dictationWaveEl construction does not trigger a TDZ error.
  let audioCtx = null;
  let analyserNode = null;
  let micStream = null;
  let meterRafId = null;
  const waveBarEls = [];

  // Replaces the textarea + attach button (both hidden while dictating —
  // see setDictationUiState) with a live wave/mic animation, so the row
  // reads as "actively listening" rather than a text field that happens
  // to be auto-filling itself. Clicking it behaves exactly like the
  // mic/cancel button (see onMicBtnClick below) — stops dictation and
  // leaves the transcribed text for review — so there are two equally
  // reachable ways to cancel (this element, and the still-visible
  // cancel-shaped mic button) rather than only the small icon button.
  const dictationWaveEl = document.createElement("button");
  dictationWaveEl.type = "button";
  dictationWaveEl.className = "ai-agent-dictation-wave";
  // Hidden until dictation actually starts (toggled alongside the
  // textarea in setDictationUiState below) — otherwise this would sit
  // visible in the input row on every page load.
  dictationWaveEl.hidden = true;
  dictationWaveEl.setAttribute("aria-label", "جارِ الاستماع — اضغط للإلغاء");
  dictationWaveEl.title = "جارِ الاستماع — اضغط للإلغاء";
  dictationWaveEl.innerHTML = `
    <span class="ai-agent-dictation-wave-bars" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span>
    </span>
    <span class="ai-agent-dictation-wave-label">جارِ الاستماع...</span>
  `;
  dictationWaveEl.addEventListener("click", () => {
    stopRecognition();
    textarea.focus();
  });
  waveBarEls.push(
    ...dictationWaveEl.querySelectorAll(".ai-agent-dictation-wave-bars span"),
  );

  /**
   * Opens a mic stream purely for volume metering (independent of, and
   * in parallel with, the SpeechRecognition session — the two APIs don't
   * share access to each other's audio data). Best-effort: if getUserMedia
   * is denied/unavailable, the bars just keep their CSS fallback animation
   * (see @keyframes ai-agent-wave-bounce) instead of breaking dictation.
   */
  async function startMicMetering() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextCtor();
      const source = audioCtx.createMediaStreamSource(micStream);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 64;
      analyserNode.smoothingTimeConstant = 0.6;
      source.connect(analyserNode);

      const data = new Uint8Array(analyserNode.frequencyBinCount);
      // Once real volume data is flowing, hand the bars off to it —
      // removing the CSS keyframe loop so the two animation sources
      // never fight over `transform`.
      dictationWaveEl.classList.add("ai-agent-dictation-wave--live");

      const tick = () => {
        if (!analyserNode) return;
        analyserNode.getByteTimeDomainData(data);
        // Per-bar RMS over a distinct slice of the buffer (rather than one
        // global level applied to all five) so the bars move somewhat
        // independently, still reading as one reactive waveform.
        const sliceSize = Math.floor(data.length / waveBarEls.length);
        waveBarEls.forEach((bar, i) => {
          let sum = 0;
          const start = i * sliceSize;
          const end = start + sliceSize;
          for (let j = start; j < end; j++) {
            const centered = (data[j] - 128) / 128;
            sum += centered * centered;
          }
          const rms = Math.sqrt(sum / sliceSize);
          // 0.15 floor keeps a faint idle bar visible in silence; 3.2 gain
          // and the 1 cap tune how "loud" a normal speaking voice reads.
          const level = Math.min(1, 0.15 + rms * 3.2);
          bar.style.transform = `scaleY(${level.toFixed(3)})`;
        });
        meterRafId = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.error("[ai-agent-chat] Mic metering unavailable:", err);
      audioCtx = null;
      analyserNode = null;
      micStream = null;
    }
  }

  function stopMicMetering() {
    if (meterRafId) cancelAnimationFrame(meterRafId);
    meterRafId = null;
    analyserNode = null;
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    dictationWaveEl.classList.remove("ai-agent-dictation-wave--live");
    waveBarEls.forEach((bar) => {
      bar.style.transform = "";
    });
  }

  // ── Voice dictation (Task 5, Web Speech API) ──
  // Framework-free, native SpeechRecognition — no external library. Built
  // unconditionally (not gated behind enableFileUpload or any other
  // option) since it's a general chat-input affordance every page using
  // this panel should get, same as the textarea itself.
  const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;

  // Firefox has no SpeechRecognition support in its stable channel at
  // all, but on the off chance a future/flagged build exposes the
  // constructor, this still surfaces the accuracy warning — the request
  // is "if Firefox, warn", not "if the API is missing, warn silently".
  const isFirefox = /firefox/i.test(navigator.userAgent || "");

  // Brave ships webkitSpeechRecognition (it's Chromium-based) but its
  // own "Google Services" privacy shield blocks the network request the
  // API makes to Google's speech servers by default — this is a
  // deliberate, permanent Brave setting, not a transient network hiccup,
  // so a "network" error here should skip the auto-retry (below) and go
  // straight to a Brave-specific explanation instead of a generic one.
  // navigator.brave.isBrave() is the official, Brave-exposed feature
  // detect (see brave.com/docs) — resolved once up front since it's
  // async and dictation errors need the answer synchronously by the time
  // they happen.
  let isBraveBrowser = false;
  if (navigator.brave && typeof navigator.brave.isBrave === "function") {
    navigator.brave
      .isBrave()
      .then((result) => {
        isBraveBrowser = !!result;
      })
      .catch(() => {});
  }

  let micBtn = null;
  let firefoxWarningEl = null;
  let recognition = null;
  let isDictating = false;
  // (audioCtx, analyserNode, micStream, meterRafId, waveBarEls are declared
  //  above, before dictationWaveEl, to avoid a TDZ ReferenceError on
  //  waveBarEls.push() during element construction.)
  // Accumulates finalized speech segments across multiple onresult events
  // within one dictation session — SpeechRecognition delivers results
  // incrementally, some marked `isFinal` and some not (interim/in-flight
  // guesses that may still change), so the textarea needs to show
  // finalizedText + the current interim guess, not just the latest event.
  let finalizedText = "";
  // The textarea's own content at the moment dictation started — dictated
  // text is appended after it (not overwriting anything the user already
  // typed), same as how a real dictation feature behaves.
  let baseTextBeforeDictation = "";
  // Guards the one-shot silent retry in recognition.onerror below — reset
  // per dictation session in startDictation() so a later, unrelated
  // session still gets its own single retry rather than being permanently
  // used up by an earlier session's transient failure.
  let hasRetriedAfterNetworkError = false;

  const MIC_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';
  // "Cancel" glyph the mic button swaps to while dictating — a plain X,
  // distinct from the mic icon at a glance, communicating "stop/cancel
  // this" rather than reusing a stop-square or another mic variant that
  // could read as "still recording".
  const CANCEL_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  function composeDictationValue(interim) {
    const finalPart = finalizedText.trim();
    const interimPart = (interim || "").trim();
    const dictated = [finalPart, interimPart].filter(Boolean).join(" ");
    const base = baseTextBeforeDictation.trim();
    return [base, dictated].filter(Boolean).join(base ? " " : "");
  }

  /**
   * Single state machine for the whole input row's dictation mode — NOT
   * two separate labeled buttons swapped in for the mic (a previous
   * version's "إيقاف الإملاء" / "إرسال" pair, since removed per the
   * request to cut labeled-button clutter). Instead, the SAME mic button
   * element transforms in place: its icon/label/handler swap between
   * "start" (mic) and "cancel" (X) depending on `dictating`, and
   * everything else in the row (attach button, suggestions row) hides —
   * except the existing send icon button, which stays visible/active on
   * the far right the whole time, since Send is still how a dictated
   * message actually gets sent (see submitBtn wiring below).
   */
  function setDictationUiState(dictating) {
    isDictating = dictating;
    if (micBtn) {
      micBtn.innerHTML = dictating ? CANCEL_ICON_SVG : MIC_ICON_SVG;
      micBtn.setAttribute("aria-label", dictating ? "إلغاء الإملاء الصوتي" : "بدء الإملاء الصوتي");
      micBtn.title = dictating ? "إلغاء الإملاء" : "إملاء صوتي";
      micBtn.classList.toggle("ai-agent-mic-btn--active", dictating);
    }
    if (moreBtn) moreBtn.hidden = dictating;
    if (suggestionsEl) suggestionsEl.hidden = dictating;
    // The textarea itself is replaced (not just styled) by the wave
    // animation while dictating — it stays in the DOM and keeps
    // receiving the live-transcribed value under the hood (see
    // recognition.onresult below), just visually swapped out, so the
    // moment dictation stops the transcribed text is already sitting in
    // the field ready to review/edit/send with no extra sync step.
    textarea.hidden = dictating;
    dictationWaveEl.hidden = !dictating;
    textarea.classList.toggle("ai-agent-chat-input--dictating", dictating);
    inputRow.classList.toggle("ai-agent-chat-input-row--dictating", dictating);
    // Send stays visible unconditionally WHILE dictating (see this
    // function's own doc comment above), but the moment dictation ends
    // the normal empty-input rule should apply again — re-check here
    // rather than relying on some later `input` event that may never
    // fire if dictation produced no text at all.
    if (typeof updateSendBtnVisibility === "function") updateSendBtnVisibility();
  }

  /**
   * Halts the microphone. Does NOT touch the textarea's current value —
   * callers decide separately whether to leave it for review (mic/cancel
   * button) or immediately submit it (send button), matching the two
   * distinct actions in the spec.
   */
  function stopRecognition() {
    if (recognition) {
      try {
        recognition.stop();
      } catch (err) {
        console.error("[ai-agent-chat] SpeechRecognition stop failed:", err);
      }
    }
    stopMicMetering();
    setDictationUiState(false);
  }

  function startDictation(isRetry = false) {
    if (!SpeechRecognitionCtor || isDictating) return;

    finalizedText = "";
    baseTextBeforeDictation = textarea.value;
    // Fresh retry budget for every genuinely new dictation session (mic
    // press) — only a call made FROM the retry path itself (onerror
    // below) keeps the flag it already set just before calling.
    if (!isRetry) hasRetriedAfterNetworkError = false;

    recognition = new SpeechRecognitionCtor();
    recognition.lang = document.documentElement?.lang === "en" ? "en-US" : "ar-EG";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalizedText = `${finalizedText} ${result[0].transcript}`.trim();
        } else {
          interim += result[0].transcript;
        }
      }
      // Live transcription directly into the chat input field, per the
      // spec — not a separate preview area.
      textarea.value = composeDictationValue(interim);
      resizeChatInput();
    };

    recognition.onerror = (event) => {
      console.error("[ai-agent-chat] SpeechRecognition error:", event.error);
      // "no-speech"/"aborted" are routine (silence timeout, or the user's
      // own Cancel click racing the browser's own stop event) — only
      // surface a visible error for something the user couldn't have
      // caused by simply pausing or stopping normally.
      if (event.error === "no-speech" || event.error === "aborted") {
        stopMicMetering();
        setDictationUiState(false);
        return;
      }
      // Chrome/Brave's SpeechRecognition implementation proxies audio to
      // Google's own speech servers rather than doing recognition
      // on-device — "network" here means THAT round trip failed, not the
      // page's own connection. On most Chromium browsers this is usually
      // a one-off transient hiccup, so retry silently once before
      // bothering the user with an error. On Brave specifically, though,
      // this is Brave's own "Google Services" privacy shield deliberately
      // blocking that request every time — a permanent setting, not a
      // hiccup — so retrying there would just fail identically and delay
      // a message that could instead point straight at the actual cause.
      if (event.error === "network" && !hasRetriedAfterNetworkError && !isBraveBrowser) {
        hasRetriedAfterNetworkError = true;
        stopMicMetering();
        setDictationUiState(false);
        try {
          startDictation(true);
        } catch (err) {
          console.error("[ai-agent-chat] SpeechRecognition retry failed:", err);
        }
        return;
      }
      let message = "تعذر استخدام الإملاء الصوتي. حاول مرة أخرى.";
      if (event.error === "network") {
        message = isBraveBrowser
          ? "الإملاء الصوتي لا يعمل على متصفح Brave افتراضيًا لأن إعداد \"خدمات جوجل\" فيه يحجب الاتصال بخدمة التعرف الصوتي. جرّب متصفحًا آخر (مثل Edge أو Chrome)، أو اكتب رسالتك يدويًا."
          : "تعذر الوصول إلى خدمة التعرف الصوتي (قد يكون بسبب مانع إعلانات أو مشكلة في الاتصال). حاول مرة أخرى أو اكتب رسالتك.";
      }
      appendError(message);
      stopMicMetering();
      setDictationUiState(false);
    };

    recognition.onend = () => {
      // The browser can end the session on its own (silence timeout)
      // without the user clicking anything — make sure the UI still
      // falls back to the idle mic-icon state either way, so the mic
      // button is never stuck showing "cancel" for a session that's
      // already over.
      if (isDictating) {
        stopMicMetering();
        setDictationUiState(false);
      }
    };

    try {
      recognition.start();
      setDictationUiState(true);
      startMicMetering();
    } catch (err) {
      console.error("[ai-agent-chat] SpeechRecognition start failed:", err);
      appendError("تعذر بدء الإملاء الصوتي.");
    }
  }

  /**
   * Click handler for the mic/cancel button — a single element, dispatches
   * by current state rather than being two different buttons (see
   * setDictationUiState's own comment on why). Cancel simply halts the
   * mic and leaves the transcribed text for manual review/edit/send; it
   * does not submit anything itself (Send, on the far right, is the only
   * button that ever submits — see sendBtn's own wiring below).
   */
  function onMicBtnClick() {
    if (isDictating) {
      stopRecognition();
      textarea.focus();
    } else {
      startDictation();
    }
  }

  if (SpeechRecognitionCtor) {
    micBtn = document.createElement("button");
    micBtn.type = "button";
    micBtn.className = "ai-agent-mic-btn";
    micBtn.setAttribute("aria-label", "بدء الإملاء الصوتي");
    micBtn.title = "إملاء صوتي";
    micBtn.innerHTML = MIC_ICON_SVG;
    micBtn.addEventListener("click", onMicBtnClick);
  }

  // Firefox accuracy warning (Task 5.6) — user-agent sniffing is
  // otherwise something to avoid, but there's no capability-based way to
  // detect "dictation exists but is inaccurate on this engine specifically"
  // — that's a qualitative claim about Firefox's speech-recognition
  // backend, not a missing API surface. Shown once, inline, near the
  // input — not a toast/alert, since it's informational rather than
  // blocking. Rendered on load; not tied to SpeechRecognitionCtor being
  // present, in case a Firefox build exposes the constructor while still
  // having the accuracy issue this warns about (see SpeechRecognitionCtor's
  // own comment above).
  if (isFirefox) {
    firefoxWarningEl = document.createElement("div");
    firefoxWarningEl.className = "ai-agent-firefox-warning";
    firefoxWarningEl.textContent =
      "⚠️ الإملاء الصوتي قد يكون غير دقيق على متصفح Firefox — يُفضّل استخدام متصفح آخر (مثل Chrome) لنتائج أفضل.";
  }

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "ai-agent-send-btn";
  sendBtn.setAttribute("aria-label", "إرسال");
  sendBtn.title = "إرسال";
  sendBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 3 9-3 9 19-9Z"/><path d="M6 12h16"/></svg>';

  // Assemble the input row now that every optional piece (more button,
  // mic/cancel button, dictation wave) has been conditionally built
  // above. PHASE 3b: inputRow is now a flex-column of [tiles?, controls]
  // (see .ai-agent-chat-input-row/.ai-agent-chat-input-controls in the
  // CSS) — attachmentTilesRow (built lazily by renderAttachmentChips)
  // inserts itself as inputRow's own first child whenever there's at
  // least one pending attachment; inputControls always holds the
  // horizontal control line below it. DOM order within inputControls:
  // more, textarea, wave, mic/cancel, send — send is deliberately the
  // LAST child so it's the far-right control in this RTL row (first
  // child sits visually on the right in RTL flex; see
  // .ai-agent-chat-input-row's own comment in the CSS), matching "Send
  // Button Position: move the remaining send-btn to the far-right end"
  // from the original request. The wave sits in the textarea's flex slot
  // (see .ai-agent-dictation-wave's flex:1 in the CSS) so it visually
  // replaces it in place rather than appearing as an extra element
  // squeezed in. Only the send button (never more/mic/textarea) stays
  // visible during dictation — see setDictationUiState, which hides
  // moreBtn/textarea but never touches sendBtn.
  const inputControls = document.createElement("div");
  inputControls.className = "ai-agent-chat-input-controls";
  if (moreBtn) inputControls.appendChild(moreBtn);
  inputControls.appendChild(textarea);
  inputControls.appendChild(dictationWaveEl);
  if (micBtn) inputControls.appendChild(micBtn);
  inputControls.appendChild(sendBtn);
  if (fileInput) inputControls.appendChild(fileInput);
  inputRow.appendChild(inputControls);

  // Firefox warning sits above the input row, once, not inside it — it's
  // informational context for the row rather than a control within it.
  if (firefoxWarningEl) panel.appendChild(firefoxWarningEl);
  panel.appendChild(inputRow);

  // inputRow exists now, so it's safe for renderSuggestions() to insert
  // relative to it (see the function's own comment above).
  renderSuggestions();

  function renderEmptyState() {
    // Swap between the normal friendly placeholder and a clear
    // "unavailable" message when the user has neither their own saved API
    // key nor platform access (admin / Level 10+) — computed client-side
    // via isAiHelperAvailable() (ai-agent-settings.js), so this renders
    // correctly on first paint instead of only surfacing as a confusing
    // backend error after the user tries to send a message.
    if (isAiHelperAvailable()) {
      messagesEl.innerHTML = `<div class="ai-agent-msg ai-agent-msg--empty">اسأل الباشــمبصمج عن أي سؤال متعلق بامتحاناتك 👋</div>`;
    } else {
      messagesEl.innerHTML = `<div class="ai-agent-msg ai-agent-msg--empty ai-agent-msg--unavailable">الباشــمبصمج غير متاح حاليًا — يلزم مستوى 10 أو أن تكون مشرفاً. يمكنك استخدامه عن طريق إضافة مفتاح API خاص بك من الإعدادات ⚙️</div>`;
    }
    updateAvailabilityGate();
  }
  renderEmptyState();

  /**
   * Disables the input/send button (rather than leaving them enabled to
   * let the backend error surface as a fallback) whenever the AI Helper
   * is unavailable — avoids a confusing round-trip failure for something
   * already knowable client-side. Re-checked on every render of the empty
   * state (i.e. whenever there are no messages yet) and again whenever
   * the Settings tab changes the saved API key, so switching to Settings,
   * adding a key, and coming back updates this live without needing to
   * reopen the modal.
   */
  function updateAvailabilityGate() {
    const available = isAiHelperAvailable();
    textarea.disabled = !available;
    sendBtn.disabled = !available;
    if (moreBtn) moreBtn.disabled = !available;
    if (typeof updateSendBtnVisibility === "function") updateSendBtnVisibility();
  }

  /**
   * @param {"user"|"assistant"} role
   * @param {string} content
   * @param {Array<{name?: string, title?: string, kind?: string}>} [attachmentsForDisplay] -
   *   when the user sent one or more attachments with this message, their
   *   display labels/kinds — rendered as small chips inside the bubble so
   *   the attachment(s) stay visible in the chat itself (previously only
   *   visible to the AI; the user had no confirmation it was actually
   *   sent, and it silently disappeared from the transcript, including on
   *   reload from history). Assistant messages never carry any; only ever
   *   passed for role === "user". Was a single `attachmentName` string
   *   before Phase 2a/3's array refactor — now a list, since a user
   *   message can carry a file AND platform-item attachments together.
   */
  const COPY_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
  const CHECK_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const EDIT_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
  const SPEAK_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  const SPEAK_STOP_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>';

  /** @type {HTMLButtonElement | null} */
  let activeSpeakBtn = null;

  function stopSpeaking() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        console.error("[ai-agent-chat] speech cancel failed:", e);
      }
    }
    if (activeSpeakBtn) {
      activeSpeakBtn.innerHTML = SPEAK_ICON_SVG;
      activeSpeakBtn.classList.remove("ai-agent-msg-speak-btn--speaking");
      activeSpeakBtn.setAttribute("aria-label", "قراءة الرسالة صوتياً");
      activeSpeakBtn.title = "قراءة صوتية";
      activeSpeakBtn = null;
    }
  }

  function cleanMarkdownForSpeech(text) {
    if (!text) return "";
    return text
      .replace(/```[\s\S]*?```/g, "") // strip code blocks
      .replace(/`([^`]+)`/g, "$1") // inline code
      .replace(/!\[.*?\]\(.*?\)/g, "") // images
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links
      .replace(/^[#*>\s-]+/gm, "") // markdown headers, bullets, blockquotes
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1") // bold/italic
      .replace(/\|/g, " ") // table pipes
      .replace(/\s+/g, " ") // collapse multiple spaces
      .trim();
  }

  /**
   * Adds a Read Aloud (TTS) button to assistant messages only.
   * @param {HTMLElement} controlsEl - the controls row below the bubble
   * @param {string} rawText - raw message text to speak
   */
  function addSpeakButton(controlsEl, rawText) {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !rawText) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ai-agent-msg-speak-btn";
    btn.setAttribute("aria-label", "قراءة الرسالة صوتياً");
    btn.title = "قراءة صوتية";
    btn.innerHTML = SPEAK_ICON_SVG;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();

      if (activeSpeakBtn === btn) {
        stopSpeaking();
        return;
      }

      stopSpeaking();

      const textToSpeak = cleanMarkdownForSpeech(rawText);
      if (!textToSpeak) return;

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      const isArabic = /[\u0600-\u06FF]/.test(textToSpeak);
      utterance.lang = isArabic ? "ar-SA" : "en-US";
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices?.() || [];
      if (isArabic) {
        const arVoice = voices.find((v) => v.lang && (v.lang.startsWith("ar-") || v.lang === "ar"));
        if (arVoice) utterance.voice = arVoice;
      } else {
        const enVoice = voices.find((v) => v.lang && (v.lang.startsWith("en-") || v.lang === "en"));
        if (enVoice) utterance.voice = enVoice;
      }

      utterance.onstart = () => {
        activeSpeakBtn = btn;
        btn.innerHTML = SPEAK_STOP_ICON_SVG;
        btn.classList.add("ai-agent-msg-speak-btn--speaking");
        btn.setAttribute("aria-label", "إيقاف القراءة الصوتية");
        btn.title = "إيقاف القراءة";
      };

      utterance.onend = () => {
        if (activeSpeakBtn === btn) {
          stopSpeaking();
        }
      };

      utterance.onerror = () => {
        if (activeSpeakBtn === btn) {
          stopSpeaking();
        }
      };

      window.speechSynthesis.speak(utterance);
    });

    controlsEl.appendChild(btn);
  }

  /**
   * Adds a small per-message copy button to a rendered bubble, copying the
   * raw source text (the same string appendMessage received — unrendered
   * markdown for assistant messages, plain text for user messages) rather
   * than the rendered HTML, so pasting elsewhere doesn't carry markdown/
   * HTML artifacts the user didn't type. Swaps to a checkmark briefly
   * instead of a separate toast — keeps the feedback right where the user
   * is already looking, and doesn't need a shared notification helper
   * this module doesn't otherwise depend on.
   * @param {HTMLElement} controlsEl - the controls row (below the bubble)
   *   to attach the button to — see appendMessage's `wrap`/`controls`.
   * @param {string} rawText - the exact text to copy.
   */
  function addCopyButton(controlsEl, rawText) {
    if (!rawText) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ai-agent-msg-copy-btn";
    btn.setAttribute("aria-label", "نسخ الرسالة");
    btn.title = "نسخ";
    btn.innerHTML = COPY_ICON_SVG;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(rawText);
        btn.innerHTML = CHECK_ICON_SVG;
        btn.classList.add("ai-agent-msg-copy-btn--copied");
        setTimeout(() => {
          btn.innerHTML = COPY_ICON_SVG;
          btn.classList.remove("ai-agent-msg-copy-btn--copied");
        }, 1500);
      } catch (err) {
        console.error("[ai-agent-chat] clipboard write failed:", err);
      }
    });
    controlsEl.appendChild(btn);
  }

  /**
   * Adds the pen-icon Edit button (Claude-style) to a rendered USER
   * message bubble only — assistant/tool-result messages never get one,
   * since "editing" only makes sense for a prompt the user themselves
   * wrote. Clicking it swaps the bubble's static text for an editable
   * textarea plus إرسال/إلغاء (Submit/Cancel) beneath it.
   *
   * BRANCHING, not in-place editing: this app persists conversations to
   * IndexedDB by a stable `conversationId` (see saveConversation calls in
   * sendMessage), and the History tab lists/reopens past conversations by
   * that same id. Rewriting `history` and `conversationId` in place here
   * would silently mutate — and on the next send, overwrite — the
   * ORIGINAL saved conversation the user might still want to go back to.
   * Instead, on إرسال this fires `onBranchConversation` with the history
   * truncated up to and including the edited prompt (content replaced),
   * and the caller (ai-agent.js) is responsible for spinning up a
   * genuinely new chat panel/session from that branch — mirroring how
   * Claude's own "edit and resubmit" leaves the original thread intact
   * and continues in a new one.
   * @param {HTMLElement} controlsEl - the controls row (below the bubble)
   *   to attach the button to — see appendMessage's `wrap`/`controls`.
   * @param {HTMLElement} bubbleEl - the rendered user-message bubble
   *   itself, passed through to enterEditMode() since that's what
   *   actually gets transformed into the edit textarea.
   * @param {number} historyIndex - this message's index into `history`,
   *   captured at render time so the branch can be built even after later
   *   turns have been appended (history.length has grown since).
   */
  function addEditButton(controlsEl, bubbleEl, historyIndex) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ai-agent-msg-edit-btn";
    btn.setAttribute("aria-label", "تعديل الرسالة");
    btn.title = "تعديل";
    btn.innerHTML = EDIT_ICON_SVG;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      enterEditMode(bubbleEl, historyIndex);
    });
    controlsEl.appendChild(btn);
  }

  /**
   * Transforms a rendered user-message bubble into an editable textarea +
   * إرسال (Submit) / إلغاء (Cancel) controls, per the pen-icon Edit button
   * above. إرسال starts disabled and only enables once the text actually
   * differs from the original — resubmitting an unedited prompt would
   * just create a pointless duplicate branch of the exact same
   * conversation. إلغاء restores the original static bubble unchanged.
   * @param {HTMLElement} el - the message bubble (already in the DOM).
   * @param {number} historyIndex
   */
  function enterEditMode(el, historyIndex) {
    const original = history[historyIndex];
    if (!original) return;
    const originalText = original.content || "";

    // Preserve the bubble's original children (text + copy/edit buttons)
    // so إلغاء can restore them exactly rather than re-rendering from
    // scratch and potentially losing e.g. the attachment chip's markup.
    const savedChildren = Array.from(el.childNodes);
    el.innerHTML = "";
    el.classList.add("ai-agent-msg--editing");
    // Belt-and-suspenders alongside the CSS :has() selector above (see
    // its own comment) — toggles the same widened-wrap behavior via a
    // plain class for any environment where :has() support can't be
    // assumed, rather than relying on :has() alone.
    if (el.parentElement) el.parentElement.classList.add("ai-agent-msg-wrap--editing");

    const textarea = document.createElement("textarea");
    textarea.className = "ai-agent-msg-edit-input";
    textarea.value = originalText;
    textarea.dir = "auto";
    textarea.rows = Math.min(8, Math.max(2, originalText.split("\n").length));
    el.appendChild(textarea);

    const actions = document.createElement("div");
    actions.className = "ai-agent-msg-edit-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ai-agent-msg-edit-cancel";
    cancelBtn.textContent = "إلغاء";

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "ai-agent-msg-edit-submit";
    submitBtn.textContent = "إرسال";
    submitBtn.disabled = true; // enabled only once the text is actually changed

    // DOM order (not CSS) decides visual left/right here, same rationale
    // as sendBtn/textarea in the main input row further down — RTL flex
    // puts the first child on the visual right, so إرسال appears first/
    // on the right (primary action) and إلغاء second/on the left.
    actions.appendChild(submitBtn);
    actions.appendChild(cancelBtn);
    el.appendChild(actions);

    textarea.addEventListener("input", () => {
      submitBtn.disabled = textarea.value.trim() === originalText.trim();
    });

    function exitEditMode() {
      el.classList.remove("ai-agent-msg--editing");
      if (el.parentElement) el.parentElement.classList.remove("ai-agent-msg-wrap--editing");
      el.innerHTML = "";
      savedChildren.forEach((child) => el.appendChild(child));
    }

    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exitEditMode();
    });

    submitBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const editedText = textarea.value.trim();
      if (!editedText || editedText === originalText.trim()) return;
      if (typeof onBranchConversation !== "function") return;

      // Truncate up to AND INCLUDING the edited prompt, with its content
      // replaced — everything the user sent/received after it in this
      // conversation is deliberately dropped from the branch, matching
      // "edit and resubmit" semantics (the point is to redo the
      // conversation from this prompt onward, not append a duplicate).
      const branchMessages = history
        .slice(0, historyIndex)
        .concat([{ ...original, content: editedText }]);

      onBranchConversation({ messages: branchMessages, createdAt: Date.now() });
    });

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function appendMessage(role, content, attachmentsForDisplay, historyIndex) {
    // Wrapper around the bubble itself — copy/edit controls live in this
    // wrapper, BELOW the bubble, rather than inside/on top of it (an
    // earlier version pinned them absolutely inside the bubble's own
    // bottom-right corner, which visually sat "on" the message text; see
    // the request that reverted this). The wrapper shares the bubble's
    // own alignment (flex-start for user/right, flex-end for
    // assistant/left, per .ai-agent-msg--user/--assistant) so the
    // controls end up under the correct edge of the bubble, not
    // full-width under the whole message column.
    const wrap = document.createElement("div");
    wrap.className = `ai-agent-msg-wrap ai-agent-msg-wrap--${role}`;

    const el = document.createElement("div");
    el.className = `ai-agent-msg ai-agent-msg--${role}`;

    if (Array.isArray(attachmentsForDisplay) && attachmentsForDisplay.length) {
      attachmentsForDisplay.forEach((att) => {
        const label = att?.name || att?.title;
        if (!label) return;
        const chip = document.createElement("div");
        chip.className = "ai-agent-msg-attachment";
        chip.innerHTML = iconForAttachment(att.kind ? att : { kind: "file" });
        const nameSpan = document.createElement("span");
        nameSpan.className = "ai-agent-msg-attachment-name";
        nameSpan.textContent = label;
        chip.appendChild(nameSpan);
        el.appendChild(chip);
      });
    }

    if (role === "assistant") {
      el.insertAdjacentHTML("beforeend", renderMarkdown(content));
    } else if (content) {
      // Per-line direction, not one direction for the whole bubble — a
      // message can mix an Arabic line and an English line (e.g. someone
      // pasting a question stem with an English fill-in-the-blank), and
      // each line should align independently rather than the first
      // detected direction dragging the rest of the bubble along with it.
      // _processByLine (markdown.js) already implements exactly this:
      // split on newlines, wrap each in a direction-classed <span
      // class="text-line">, and set the container's own class from the
      // first line so bubble alignment/padding still has a sane base.
      const textEl = document.createElement("div");
      textEl.textContent = content;
      _processByLine(textEl);
      el.appendChild(textEl);
    }

    wrap.appendChild(el);

    // Controls row — copy (+ edit, for user messages) — sits BELOW the
    // bubble as a sibling inside `wrap`, not layered inside/on top of the
    // bubble itself. Only created when there's at least one control to
    // show, so a bubble with neither (e.g. an assistant message that
    // somehow has no copy-able content) doesn't reserve empty space for
    // nothing.
    let controls = null;
    function ensureControls() {
      if (!controls) {
        controls = document.createElement("div");
        controls.className = `ai-agent-msg-controls ai-agent-msg-controls--${role}`;
        wrap.appendChild(controls);
      }
      return controls;
    }

    if (content) {
      addCopyButton(ensureControls(), content);
      if (role === "assistant") {
        addSpeakButton(ensureControls(), content);
      }
    }
    // Edit is only offered for user prompts with real text and a known
    // position in `history` (loadConversation's re-render also supplies
    // this — see below), and only when the caller actually wants
    // branching (onBranchConversation supplied) — otherwise the button
    // would be dead UI on pages that don't opt in.
    if (role === "user" && content && typeof historyIndex === "number" && onBranchConversation) {
      addEditButton(ensureControls(), el, historyIndex);
    }

    if (messagesEl.querySelector(".ai-agent-msg--empty")) {
      messagesEl.innerHTML = "";
    }
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    resetErrorDedup();
    return el;
  }

  // Tracks the most recently appended error bubble and its exact message,
  // so a repeat of the SAME error (e.g. mashing the dictation button on a
  // browser that blocks it — see the Brave "network" error above) updates
  // a small "×N" counter on that one bubble instead of stacking a fresh
  // identical bubble into the chat every time. Reset whenever a
  // DIFFERENT error (or any non-error message) interrupts the run, so the
  // counter only ever reflects a truly unbroken repeat, not "this error
  // happened N times total across the whole conversation".
  let lastErrorEl = null;
  let lastErrorMessage = null;
  let lastErrorCount = 0;

  function appendError(message) {
    if (lastErrorEl && lastErrorMessage === message && lastErrorEl.isConnected) {
      lastErrorCount += 1;
      renderErrorCount();
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }
    const el = document.createElement("div");
    el.className = "ai-agent-msg ai-agent-msg--error";
    const textEl = document.createElement("span");
    textEl.className = "ai-agent-msg-error-text";
    textEl.textContent = message;
    el.appendChild(textEl);
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    lastErrorEl = el;
    lastErrorMessage = message;
    lastErrorCount = 1;
  }

  function renderErrorCount() {
    if (!lastErrorEl) return;
    let countEl = lastErrorEl.querySelector(".ai-agent-msg-error-count");
    if (!countEl) {
      countEl = document.createElement("span");
      countEl.className = "ai-agent-msg-error-count";
      lastErrorEl.appendChild(countEl);
    }
    // "×N" rather than "happened N times" — short enough to sit inline
    // next to the message without pushing it onto its own line, and the
    // multiplication sign reads unambiguously as a repeat count in both
    // Arabic and English UI conventions.
    countEl.textContent = `×${lastErrorCount}`;
  }

  // Any OTHER kind of message breaks the "same error repeated back to
  // back" streak that appendError's dedup relies on — the next call to
  // appendError should start a fresh bubble/count, not silently merge
  // into a now-stale one several turns back. appendMessage and
  // appendToolResultMessage both funnel through here so nothing has to
  // remember to call this explicitly at each call site.
  function resetErrorDedup() {
    lastErrorEl = null;
    lastErrorMessage = null;
    lastErrorCount = 0;
  }

  function appendToolResultMessage(text) {
    const el = document.createElement("div");
    el.className = "ai-agent-msg ai-agent-msg--assistant ai-agent-msg--tool-result";
    el.textContent = text;
    if (messagesEl.querySelector(".ai-agent-msg--empty")) {
      messagesEl.innerHTML = "";
    }
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    resetErrorDedup();
  }

  // Human-readable Arabic label per tool name, shown in the typing
  // indicator while that tool is actively running (see the tool loop in
  // resendLastUserTurn below). Mirrors the tool names defined server-side
  // in api/ai-agent/_tools.js — kept as a small local lookup rather than
  // importing that module, since this is presentation-only and the two
  // are already independently versioned across the network boundary.
  const TOOL_DISPLAY_NAMES = {
    create_quiz: "إنشاء اختبار",
    edit_quiz: "تعديل الاختبار",
    delete_quiz: "حذف الاختبار",
    create_folder: "إنشاء مجلد",
    create_course: "إنشاء مادة",
    move_item: "نقل عنصر",
    reset_quiz_page: "إعادة تعيين الصفحة",
  };

  function describeToolCall(toolCall) {
    return TOOL_DISPLAY_NAMES[toolCall?.name] || toolCall?.name || "أداة";
  }

  /**
   * Renders the "assistant is working" indicator as a proper bubble
   * (matching .ai-agent-msg's card treatment) with a leading icon rather
   * than bare floating text + dots — the icon switches between a
   * "thinking" glyph and a "tool" glyph (see `kind`) so the two states
   * are distinguishable at a glance, not just by reading the label text.
   * Beyond the animated dots (still always shown, so "something is
   * happening" reads at a glance even before any label resolves), an
   * optional `label` renders as a small text line so the indicator can
   * say *what* the assistant is currently doing — plain generation vs.
   * running a specific tool — instead of being purely decorative.
   * Returns an object exposing `.setLabel(text, kind)` to update the text
   * (and optionally the icon) in place (used once a tool call starts, see
   * resendLastUserTurn's tool loop) and `.remove()` to tear the whole
   * indicator down. `.remove()` is idempotent — calling it more than once
   * (or after the element was already removed) is a no-op, which matters
   * once removal is called from a `finally` block that must run
   * regardless of which path got there.
   * @param {string} [label]
   * @param {"thinking"|"tool"} [kind]
   */
  function abortCurrentTurn(reason = "تم إيقاف الرد بواسطة المستخدم.") {
    if (currentAbortController) {
      try {
        currentAbortController.abort();
      } catch {
        // non-fatal
      }
      currentAbortController = null;
    }
    typingController.clear();
    isGenerating = false;
    sendBtn.disabled = false;
    updateAvailabilityGate();
    if (reason) {
      appendToolResultMessage(`⏹️ ${reason}`);
    }
  }

  /**
   * Typing & Status Indicator Controller (Singleton per Chat Panel)
   *
   * Guarantees:
   * 1. Exactly ONE active indicator element in messagesEl at any time.
   * 2. In-place morphing (updating label, tool state, step badge, stop button)
   *    rather than creating and destroying DOM elements on each tool step.
   * 3. Dynamic repositioning: stays at the bottom of messagesEl when new tool
   *    results or assistant messages appear.
   * 4. Guaranteed cleanup: clear() removes all .ai-agent-typing nodes unconditionally,
   *    guarding against any orphaned elements across turns, errors, or closes/reopens.
   */
  const typingController = (function createTypingController() {
    let activeEl = null;
    let iconEl = null;
    let labelEl = null;
    let stepEl = null;
    let timerEl = null;
    let stopBtn = null;
    let timerInterval = null;
    let startTime = 0;
    let onStopCallback = null;

    function formatElapsed(seconds) {
      if (seconds < 60) return `${seconds}ث`;
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}د ${s}ث`;
    }

    function buildElement() {
      const el = document.createElement("div");
      el.className = "ai-agent-typing";

      iconEl = document.createElement("div");
      iconEl.className = "ai-agent-typing-icon";

      const contentEl = document.createElement("div");
      contentEl.className = "ai-agent-typing-content";

      const headerEl = document.createElement("div");
      headerEl.className = "ai-agent-typing-header";

      stepEl = document.createElement("span");
      stepEl.className = "ai-agent-typing-step";

      labelEl = document.createElement("div");
      labelEl.className = "ai-agent-typing-label";

      headerEl.append(stepEl, labelEl);

      const metaEl = document.createElement("div");
      metaEl.className = "ai-agent-typing-meta";

      const dotsEl = document.createElement("div");
      dotsEl.className = "ai-agent-typing-dots";
      dotsEl.innerHTML = "<span></span><span></span><span></span>";

      timerEl = document.createElement("span");
      timerEl.className = "ai-agent-typing-timer";

      metaEl.append(dotsEl, timerEl);
      contentEl.append(headerEl, metaEl);

      stopBtn = document.createElement("button");
      stopBtn.type = "button";
      stopBtn.className = "ai-agent-typing-stop-btn";
      stopBtn.setAttribute("aria-label", "إيقاف الرد");
      stopBtn.title = "إيقاف الرد";
      stopBtn.innerHTML = `${TYPING_STOP_ICON_SVG}<span>إيقاف</span>`;
      stopBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof onStopCallback === "function") {
          onStopCallback();
        }
      });

      el.append(iconEl, contentEl, stopBtn);
      return el;
    }

    function startTimer() {
      if (timerInterval) clearInterval(timerInterval);
      startTime = Date.now();
      if (timerEl) timerEl.textContent = "";
      timerInterval = setInterval(() => {
        if (!timerEl || !activeEl) {
          clearInterval(timerInterval);
          return;
        }
        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        if (elapsedSec >= 1) {
          timerEl.textContent = formatElapsed(elapsedSec);
        }
      }, 1000);
    }

    function stopTimer() {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      if (timerEl) timerEl.textContent = "";
    }

    return {
      show({ label = "جارِ التفكير…", kind = "thinking", step = "", onStop = null } = {}) {
        onStopCallback = onStop;

        if (!activeEl || !activeEl.isConnected) {
          activeEl = buildElement();
          messagesEl.appendChild(activeEl);
          startTimer();
        }

        labelEl.textContent = label;
        if (step) {
          stepEl.textContent = step;
          stepEl.style.display = "";
        } else {
          stepEl.textContent = "";
          stepEl.style.display = "none";
        }

        iconEl.innerHTML = kind === "tool" ? TYPING_TOOL_ICON_SVG : TYPING_THINKING_ICON_SVG;
        activeEl.classList.toggle("ai-agent-typing--tool", kind === "tool");

        if (typeof onStop === "function") {
          stopBtn.style.display = "inline-flex";
        } else {
          stopBtn.style.display = "none";
        }

        messagesEl.scrollTop = messagesEl.scrollHeight;
      },

      moveToBottom() {
        if (activeEl && activeEl.isConnected) {
          messagesEl.appendChild(activeEl);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      },

      clear() {
        stopTimer();
        onStopCallback = null;
        if (activeEl) {
          activeEl.remove();
          activeEl = null;
        }
        messagesEl.querySelectorAll(".ai-agent-typing").forEach((n) => n.remove());
      },

      isActive() {
        return Boolean(activeEl && activeEl.isConnected);
      },
    };
  })();

  function showTyping(label = "جارِ التفكير…", kind = "thinking") {
    typingController.show({ label, kind });
    return {
      setLabel(text, nextKind) {
        typingController.show({ label: text, kind: nextKind || kind });
      },
      remove() {
        typingController.clear();
      },
    };
  }

  /**
   * Shared tail end of both a normal send and a branch's replay: sends
   * `history` (already fully up to date — the new user turn is already
   * pushed and rendered by the caller) to the backend, renders the
   * assistant's reply, persists the conversation, and handles any tool
   * call. Factored out of sendMessage() so panel.loadBranch() above can
   * reuse the exact same request/response/persistence logic for a
   * branched conversation's first turn, rather than re-sending through
   * the DOM (which would re-append a duplicate user bubble that's already
   * rendered).
   * @param {number} [agentDepth] - how many tool-driven rounds deep this
   *   call is (0 for a normal user-initiated send). Incremented on the
   *   recursive continuation after a successful tool call, below, and
   *   capped at MAX_AGENT_DEPTH so a model that keeps requesting tools
   *   every turn can't recurse indefinitely and hang the panel — it gets
   *   a plain error instead once the cap is hit.
   */
  async function resendLastUserTurn(agentDepth = 0) {
    if (agentDepth === 0) {
      currentAbortController = new AbortController();
      isGenerating = true;
      sessionExecutedTools.clear();
    }
    sendBtn.disabled = true;

    typingController.show({
      label: "جارِ التفكير…",
      kind: "thinking",
      onStop: () => abortCurrentTurn("تم إيقاف الرد بواسطة المستخدم."),
    });

    const { key: ownKey, hasKey: hasOwnKey } = getOwnKey();
    const provider = getSelectedProvider();
    const model = getSelectedModel();

    const resolvedContextPrompt =
      typeof contextPrompt === "function" ? contextPrompt() : contextPrompt;
    const resolvedContextSummary =
      typeof contextSummary === "function" ? contextSummary() : contextSummary;
    const summaryText =
      Array.isArray(resolvedContextSummary) && resolvedContextSummary.length
        ? `امتحانات المستخدم الحالية:\n${resolvedContextSummary
            .map((q) => `- ${q.title} (${q.questionCount} سؤال، ${q.types || "غير محدد"})`)
            .join("\n")}`
        : "";
    const combinedContext = [resolvedContextPrompt, summaryText].filter(Boolean).join("\n\n");

    // PHASE 2b adaptation: the plan's own text describes the backend
    // "resolving" a platform-item attachment server-side by id. That
    // doesn't fit how this app actually stores quizzes/courses/folders —
    // they live in the BROWSER's localStorage (see user_quizzes reads
    // throughout public/src/features/home/), not a server DB the backend
    // can look up by id. So resolution happens HERE, client-side, where
    // the full quiz/course/folder data already is — expanded into
    // readable context text and folded into the outgoing message's
    // `content`, distinctly labeled so the model treats it as "the user
    // is asking about THIS specific item" rather than freeform pasted
    // text (same intent as the plan's 2b, adapted to where the data
    // actually lives). The client still renders it as a chip in the UI
    // the whole time (see renderAttachmentChips/appendMessage) — it never
    // disappears from the user's view, exactly as required.
    const toWireMessage = ({ role, content, attachments, type }) => {
      const fileAttachments = (attachments || [])
        .filter((a) => a.kind === "file" || (!a.kind && a.base64))
        .map(({ mimeType, base64, name }) => ({ mimeType, base64, name }));
      const platformAttachments = (attachments || []).filter(
        (a) => a.kind === "quiz" || a.kind === "course" || a.kind === "folder",
      );
      const expandedContext = platformAttachments.length
        ? platformAttachments.map(expandPlatformAttachment).join("\n\n")
        : "";
      const effectiveContent = expandedContext
        ? [content, expandedContext].filter(Boolean).join("\n\n")
        : content;

      if (type === "tool-result") {
        return {
          role: "user",
          content: `[نتيجة أداة]: ${content}\n(توجيه للنظام: تم تنفيذ هذا الإجراء بنجاح وأصبح موجوداً بالفعل. لا تُعد إنشاء أو تكرار نفس العنصر مجدداً، وتابع لتنفيذ بقية خطوات المستخدم إن وُجدت، أو قدم الرد النهائي).`,
          attachments: fileAttachments,
          type,
        };
      }
      return {
        role,
        content: effectiveContent,
        attachments: fileAttachments,
        type,
      };
    };

    const outgoingMessages = combinedContext
      ? [{ role: "user", content: combinedContext }, ...history.map(toWireMessage)]
      : history.map(toWireMessage);

    let authToken = null;
    if (!hasOwnKey) {
      const isAdmin = isAdminAuthenticated();
      const adminToken = isAdmin ? getAdminToken() : null;
      const userToken = isAdmin ? null : await getUserToken();
      authToken = adminToken || userToken;
    }
    const useOwnKeyNow = hasOwnKey && !authToken;

    try {
      const headers = { "Content-Type": "application/json" };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const res = await fetch("/api/ai-agent/chat", {
        method: "POST",
        headers,
        signal: currentAbortController?.signal,
        body: JSON.stringify({
          provider,
          model: model || undefined,
          messages: outgoingMessages,
          useOwnKey: useOwnKeyNow,
          ownKey: useOwnKeyNow ? ownKey : undefined,
          systemPrompt: applyResponseLanguage(
            pageKey,
            getSystemPrompt(pageKey, defaultSystemPrompt),
          ),
          enableTools,
          toolNames: toolNames || undefined,
        }),
      });

      if (currentAbortController?.signal?.aborted) return;

      const data = await res.json().catch(() => ({}));

      if (currentAbortController?.signal?.aborted) return;

      if (!res.ok) {
        console.error(
          `[ai-agent-chat] /api/ai-agent/chat responded ${res.status}:`,
          data,
        );
        const msg = data.detail
          ? `${data.error || "خطأ"}: ${data.detail}`
          : data.error || "حدث خطأ أثناء التواصل مع الباشــمبصمج";
        appendError(msg);
        return;
      }

      if (data.text) {
        appendMessage("assistant", data.text);
        history.push({ role: "assistant", content: data.text });
        typingController.moveToBottom();
      }

      const toolCallsToRun = Array.isArray(data.toolCalls)
        ? data.toolCalls
        : data.toolCall?.name
          ? [data.toolCall]
          : [];

      if (!data.text && toolCallsToRun.length) {
        const toolSummary = toolCallsToRun.map((tc) => describeToolCall(tc)).join("، ");
        history.push({ role: "assistant", content: `[تم استدعاء: ${toolSummary}]` });
      }

      // toPersistedMessages (defined once, near createChatPanel's other
      // helpers below) maps in-memory `history` down to the lightweight
      // shape IndexedDB actually stores.
      try {
        await saveConversation({
          id: conversationId,
          pageKey,
          title: deriveConversationTitle(history),
          createdAt: conversationCreatedAt,
          updatedAt: Date.now(),
          messages: toPersistedMessages(history),
        });
        if (typeof onHistoryChanged === "function") onHistoryChanged();
      } catch (histErr) {
        console.error("[ai-agent-chat] failed to save conversation:", histErr);
      }

      let allToolCallsSucceeded = true;

      function getToolSignature(toolCall) {
        const name = toolCall?.name || "";
        const input = toolCall?.input || {};
        const primary = input.title || input.name || input.itemName || input.currentTitle || "";
        const secondary = input.destinationFolder || input.parentFolder || "";
        return `${name}::${String(primary).trim().toLowerCase()}::${String(secondary).trim().toLowerCase()}`;
      }

      if (toolCallsToRun.length && (typeof onToolCall === "function" || attachmentToolHandler)) {
        const totalTools = toolCallsToRun.length;
        let executedCount = 0;

        for (let i = 0; i < totalTools; i++) {
          if (currentAbortController?.signal?.aborted) {
            allToolCallsSucceeded = false;
            break;
          }
          const toolCall = toolCallsToRun[i];
          const sig = getToolSignature(toolCall);

          if (sessionExecutedTools.has(sig)) {
            console.warn("[ai-agent-chat] Duplicate tool call prevented in loop:", sig);
            continue;
          }
          sessionExecutedTools.add(sig);
          executedCount++;

          const stepLabel = totalTools > 1 ? `خطوة ${i + 1} من ${totalTools}` : "";
          typingController.show({
            label: `جارِ استخدام أداة: ${describeToolCall(toolCall)}`,
            kind: "tool",
            step: stepLabel,
            onStop: () => abortCurrentTurn("تم إيقاف الرد بواسطة المستخدم."),
          });

          try {
            const handler = toolCall?.name === "fetch_attached_quiz" && attachmentToolHandler
              ? attachmentToolHandler
              : onToolCall;
            const resultText = await handler(toolCall);
            if (currentAbortController?.signal?.aborted) {
              allToolCallsSucceeded = false;
              break;
            }
            if (resultText) {
              appendToolResultMessage(resultText);
              history.push({ role: "assistant", type: "tool-result", content: resultText });
              try {
                await saveConversation({
                  id: conversationId,
                  pageKey,
                  title: deriveConversationTitle(history),
                  createdAt: conversationCreatedAt,
                  updatedAt: Date.now(),
                  messages: toPersistedMessages(history),
                });
                if (typeof onHistoryChanged === "function") onHistoryChanged();
              } catch (histErr) {
                console.error("[ai-agent-chat] failed to save conversation (tool result):", histErr);
              }
              typingController.moveToBottom();
            }
          } catch (toolErr) {
            console.error("[ai-agent-chat] onToolCall failed:", toolErr);
            appendError(toolErr?.userMessage || "تعذر تنفيذ العملية. حاول مرة أخرى.");
            allToolCallsSucceeded = false;
            break;
          }
        }

        // If the model returned tool calls but every single one of them was a duplicate that already ran,
        // stop recursion to prevent an infinite loop!
        if (executedCount === 0 && toolCallsToRun.length > 0) {
          console.warn("[ai-agent-chat] All requested tools were duplicates. Halting agent loop.");
          return;
        }
      }

      if (toolCallsToRun.length && allToolCallsSucceeded && !currentAbortController?.signal?.aborted) {
        if (agentDepth + 1 >= MAX_AGENT_DEPTH) {
          appendError(
            "توقف الباشــمبصمج بعد عدد كبير من خطوات الأدوات المتتالية في نفس الطلب. أعد صياغة طلبك أو قسّمه إلى خطوات أصغر.",
          );
          return;
        }
        typingController.show({
          label: "جارِ التفكير…",
          kind: "thinking",
          step: "",
          onStop: () => abortCurrentTurn("تم إيقاف الرد بواسطة المستخدم."),
        });
        await resendLastUserTurn(agentDepth + 1);
        return;
      }
    } catch (err) {
      if (err?.name === "AbortError" || currentAbortController?.signal?.aborted) {
        return;
      }
      console.error("[ai-agent-chat] request failed:", err);
      appendError("تعذر الاتصال بالخادم. حاول مرة أخرى.");
    } finally {
      if (agentDepth === 0) {
        typingController.clear();
        currentAbortController = null;
        isGenerating = false;
        sendBtn.disabled = false;
        updateAvailabilityGate();
      }
    }
  }

  /**
   * Handles a normal user-typed send: validates input, appends the user's
   * own bubble + pushes it into `history`, then hands off to
   * resendLastUserTurn() for the actual network round trip — the same
   * tail end panel.loadBranch() uses for a branched conversation's first
   * turn (see its own doc comment above).
   */
  async function sendMessage() {
    // If dictation is currently active, Send finalizes it — halts the
    // mic and reverts the row to its default state — using whatever text
    // is in the field at this exact moment (the last live-transcribed
    // value), then falls through to the normal send flow below. This is
    // what makes the send button double as the dictation flow's "Submit"
    // action per the spec, without a second dedicated button for it.
    if (isDictating) stopRecognition();

    const text = textarea.value.trim();
    const attachments = pendingAttachments;
    // An attachment with no accompanying text is a valid send (e.g. "just
    // convert this exam", or attaching a quiz and hitting Send with no
    // typed prompt) — only block on genuinely empty input.
    if (!text && !attachments.length) return;

    textarea.value = "";
    textarea.style.height = "auto";
    sendBtn.disabled = true;
    pendingAttachments = [];
    renderAttachmentChips();

    if (suggestionsEl) {
      removeSuggestions();
    }

    const outgoingUserMessage = { role: "user", content: text };
    if (attachments.length) outgoingUserMessage.attachments = attachments;
    // Push BEFORE rendering so the new message's own index (history.length
    // - 1) is known for addEditButton's historyIndex — appendMessage
    // reads history[] by index, not by object identity.
    history.push(outgoingUserMessage);
    appendMessage("user", text, attachments, history.length - 1);
    await resendLastUserTurn();
  }

  sendBtn.addEventListener("click", sendMessage);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Trigger menu is mouse/touch-selection only (see this file's own
      // Phase 4 comment on reduced scope — no keyboard navigation into
      // the list) — but sending the message with the menu still open
      // behind it would look broken, so Enter closes the menu first,
      // same as it would for any other floating popover, rather than
      // sending a half-typed `/query` straight through.
      if (triggerMenuEl) {
        closeTriggerMenu();
        return;
      }
      sendMessage();
    }
  });

  /**
   * Hides the Send button whenever the input is empty (nothing to send)
   * and shows it again the moment there's text — except while dictating,
   * where it must stay visible/available even before any speech has
   * produced text yet (see setDictationUiState's own comment: Send is
   * still how a dictated message gets submitted, so hiding it the
   * instant the mic opens on an empty field would remove the only way to
   * send once something IS dictated). Also skipped while the whole input
   * is disabled (see updateAvailabilityGate) — that state already
   * communicates "can't send" on its own; layering a hidden Send button
   * on top of a disabled textarea would just look broken rather than
   * intentional.
   */
  function updateSendBtnVisibility() {
    if (isDictating || textarea.disabled) {
      sendBtn.hidden = false;
      return;
    }
    sendBtn.hidden = textarea.value.trim().length === 0 && !pendingAttachments.length;
  }

  textarea.addEventListener("input", () => {
    resizeChatInput();
    updateSendBtnVisibility();
    // No manual textarea.style.direction here on purpose. Setting one
    // direction for the *whole field* based on the first strong character
    // is exactly the bug being fixed — a line of Arabic followed by a line
    // of English (or vice versa) would drag both lines the same way. CSS
    // `unicode-bidi: plaintext` (see .ai-agent-chat-input below) makes the
    // browser resolve direction per paragraph/line natively, so each line
    // aligns independently as the user types, and the caret still behaves
    // correctly since we're not fighting it with JS (see the same
    // rationale already documented for INPUT/TEXTAREA in markdown.js).
  });
  updateSendBtnVisibility();

  // ── PHASE 4 (reduced scope): `/`/`@` attachment trigger menu ──
  // Typing `/` or `@` as the FIRST character of a "word" (start of
  // input, or right after whitespace — never mid-word, so e.g. an email
  // address or a path fragment typed elsewhere in the message doesn't
  // pop this open) opens a small anchored list of the user's own
  // recent quizzes/folders/courses (see ai-agent-item-lookup.js's own
  // header comment on why this pulls from a module with no dependency
  // on ai-agent.js). Selecting one calls the same
  // panel.addPendingAttachment used by Phase 2's card/tooltip entry
  // points and Phase 3c's file-upload path, so all three attachment
  // sources render as the same chip afterward.
  //
  // No fuzzy search, no keyboard-arrow navigation, no @-then-server-
  // search for platform courses — per the plan's own explicit
  // "reduced scope" instruction for this phase. Plain substring filter
  // (see listRecentUserItems) against the text typed after the trigger
  // character, mouse/touch selection only.
  let triggerMenuEl = null;
  let triggerMenuStart = -1; // index of the `/`/`@` character in textarea.value

  function closeTriggerMenu() {
    if (!triggerMenuEl) return;
    triggerMenuEl.remove();
    triggerMenuEl = null;
    triggerMenuStart = -1;
    window.removeEventListener("resize", repositionTriggerMenu);
    document.removeEventListener("click", onTriggerMenuOutsideClick);
  }

  function repositionTriggerMenu() {
    if (triggerMenuEl) positionExamDropdownMenu(triggerMenuEl, textarea);
  }

  function onTriggerMenuOutsideClick(e) {
    if (!triggerMenuEl) return;
    if (triggerMenuEl.contains(e.target) || e.target === textarea) return;
    closeTriggerMenu();
  }

  function attachmentIconFor(kind) {
    if (kind === "course") return ATTACHMENT_COURSE_ICON_SVG;
    if (kind === "folder") return ATTACHMENT_FOLDER_ICON_SVG;
    return ATTACHMENT_QUIZ_ICON_SVG;
  }

  /** (Re)renders the trigger menu's item list for the current query text
   * typed after the `/`/`@` character — called on every keystroke while
   * the menu is open, not just once at open time, so the list narrows
   * live as the user keeps typing (unlike openExamDropdownMenu's
   * buildContent, which only runs once — see this file's own note on why
   * this trigger menu manages its own lifecycle instead of reusing that
   * helper directly). */
  function renderTriggerMenuItems(query) {
    if (!triggerMenuEl) return;
    triggerMenuEl.innerHTML = "";

    if (pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
      const full = document.createElement("div");
      full.className = "ai-agent-trigger-menu-empty";
      full.textContent = "تم الوصول للحد الأقصى من المرفقات.";
      triggerMenuEl.appendChild(full);
      return;
    }

    const items = listRecentUserItems(query, 8);
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ai-agent-trigger-menu-empty";
      empty.textContent = query
        ? "لا توجد نتائج مطابقة."
        : "لا توجد اختبارات أو مجلدات محفوظة بعد.";
      triggerMenuEl.appendChild(empty);
      return;
    }

    items.forEach(({ kind, id, title }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "exam-action-btn ai-agent-trigger-menu-item";
      btn.innerHTML = `${attachmentIconFor(kind)}<span>${title}</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const attachment = resolveUserItemById(id);
        if (attachment) {
          pendingAttachments.push(attachment);
          renderAttachmentChips();
          updateSendBtnVisibility();
        }
        // Remove the `/`/`@`+query text the menu was triggered from,
        // same as the platform's own @-mention-style inputs elsewhere
        // consume their trigger text on selection, so it doesn't linger
        // in the message alongside the now-attached chip.
        const before = textarea.value.slice(0, triggerMenuStart);
        const after = textarea.value.slice(textarea.selectionStart);
        textarea.value = before + after;
        textarea.setSelectionRange(before.length, before.length);
        textarea.focus();
        closeTriggerMenu();
      });
      triggerMenuEl.appendChild(btn);
    });
  }

  function openTriggerMenu(startIndex) {
    closeTriggerMenu();
    triggerMenuStart = startIndex;
    triggerMenuEl = document.createElement("div");
    triggerMenuEl.className = "exam-dropdown-menu ai-agent-trigger-menu";
    triggerMenuEl.setAttribute("role", "menu");
    triggerMenuEl.style.visibility = "hidden";
    document.body.appendChild(triggerMenuEl);
    renderTriggerMenuItems("");
    positionExamDropdownMenu(triggerMenuEl, textarea);
    triggerMenuEl.style.visibility = "visible";
    window.addEventListener("resize", repositionTriggerMenu);
    // Deferred one tick — otherwise the very keystroke that opened the
    // menu (`/` or `@`, still bubbling) would immediately trigger this
    // same "outside click" listener and close it right back (a click and
    // a keydown are different event types, so this only matters when the
    // trigger menu is opened via a path that also dispatches a click —
    // defensive, since keydown alone never does, but consistent with how
    // openExamDropdownMenu itself avoids this same race).
    setTimeout(() => document.addEventListener("click", onTriggerMenuOutsideClick), 0);
  }

  textarea.addEventListener("keydown", (e) => {
    // Escape closes the trigger menu first, same priority order as every
    // other dismissible layer in this app (see openExamDropdownMenu's own
    // onKeydown) — without this, Escape would fall through to whatever
    // else listens for it (e.g. closing the whole AI Agent modal) while
    // the user almost certainly just meant to back out of the menu.
    if (e.key === "Escape" && triggerMenuEl) {
      e.stopPropagation();
      closeTriggerMenu();
    }
  });

  textarea.addEventListener("input", () => {
    const caret = textarea.selectionStart;
    const valueBeforeCaret = textarea.value.slice(0, caret);

    if (triggerMenuEl) {
      // Menu already open — recompute the query text between the
      // trigger character and the caret on every keystroke. Closes the
      // menu if the trigger character itself got deleted, the caret
      // moved before it, or a space was typed (ending the "word" the
      // trigger started — matches how @-mentions behave elsewhere).
      if (
        caret <= triggerMenuStart ||
        !"/@".includes(textarea.value[triggerMenuStart] || "")
      ) {
        closeTriggerMenu();
      } else {
        const query = valueBeforeCaret.slice(triggerMenuStart + 1);
        if (/\s/.test(query)) {
          closeTriggerMenu();
        } else {
          renderTriggerMenuItems(query);
          repositionTriggerMenu();
        }
      }
      return;
    }

    // Not open yet — check whether the character just typed at the caret
    // is a trigger character starting a new "word" (start of the field,
    // or preceded by whitespace).
    const lastChar = valueBeforeCaret.slice(-1);
    if (lastChar === "/" || lastChar === "@") {
      const charBeforeTrigger = valueBeforeCaret.slice(-2, -1);
      if (charBeforeTrigger === "" || /\s/.test(charBeforeTrigger)) {
        openTriggerMenu(caret - 1);
      }
    }
  });

  /**
   * Loads a past conversation (from ai-agent-history-idb.js) into this
   * panel: replaces the in-memory `history`, re-renders every message, and
   * takes over that conversation's id so further turns overwrite the same
   * IDB record instead of forking a new one. Called by the History tab
   * (ai-agent-history.js) when the user picks a saved conversation.
   * @param {import("./ai-agent-history-idb.js").Conversation} conversation
   */
  /**
   * Exposes the panel's current conversationId so callers (the History
   * tab and the desktop sidebar's recents list — see ai-agent.js and
   * ai-agent-history.js) can tell which saved conversation, if any, this
   * panel is currently showing and highlight that entry as active.
   * Always current: reads the same `conversationId` binding that
   * loadConversation/startNewConversation/loadBranch reassign in place,
   * rather than a value captured once at panel-creation time.
   * @returns {string}
   */
  panel.getConversationId = function getConversationId() {
    return conversationId;
  };

  /**
   * Whether this panel currently has any messages at all — mirrors the
  * same history.length signal used by the desktop sidebar's own
  * "نسخ المحادثة" button (see ai-agent.js), which
   * can disable itself on an empty/new chat, where there's nothing to
   * copy — same signal, just readable from outside the panel's closure.
   * @returns {boolean}
   */
  panel.hasMessages = function hasMessages() {
    return history.length > 0;
  };

  /**
   * PHASE 2c: lets an outside caller (ai-agent-attach-launcher.js) attach a
   * platform-item (quiz/course/folder reference) to this panel's pending
   * attachments WITHOUT sending anything — the item shows up as a tile the
   * user can still remove or send alongside a prompt, exactly like a
   * user-picked file. Never auto-sends; that stays the user's call (send
   * button / Enter), per the plan's explicit "give the user the ability to
   * remove it or send it with a prompt" requirement.
   * @param {{kind: "quiz"|"course"|"folder", id?: string, title: string, source?: string}} attachment
   */
  panel.addPendingAttachment = function addPendingAttachment(attachment) {
    if (!attachment || !attachment.kind || attachment.kind === "file") return;
    // Avoid duplicate tiles if the same item is attached twice in a row
    // (e.g. the user reopens the same card's "اسأل الباشـمبصمج" button).
    const alreadyPending = pendingAttachments.some(
      (a) => a.kind === attachment.kind && a.id === attachment.id && a.title === attachment.title,
    );
    if (alreadyPending) return;
    if (pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) return;
    pendingAttachments.push(attachment);
    renderAttachmentChips();
  };

  panel.setAttachmentToolHandler = function setAttachmentToolHandler(handler) {
    attachmentToolHandler = typeof handler === "function" ? handler : null;
  };

  panel.loadConversation = function loadConversation(conversation) {
    stopSpeaking();
    typingController.clear();
    removeSuggestions();
    pendingAttachments = [];
    renderAttachmentChips();

    conversationId = conversation.id;
    conversationCreatedAt = conversation.createdAt || Date.now();
    history.length = 0;
    // Reconstruct the `attachments` shape appendMessage/sendMessage expect
    // from the persisted `attachmentName` (see saveConversation call in
    // sendMessage) — no base64 data available after a reload, but the
    // filename is enough to redraw the same chip the user originally saw.
    // A platform-item attachment persists as `attachmentName` too (see
    // deriveConversationTitle/saveConversation's fallback for `.title`) —
    // reconstructed here as a generic `{name}` chip since the original
    // kind isn't preserved across a reload; good enough for display,
    // which is all a reloaded past conversation needs (nothing gets
    // re-sent from history on load).
    history.push(
      ...conversation.messages.map(({ role, content, attachmentName, type }) => ({
        role,
        content,
        ...(type ? { type } : {}),
        ...(attachmentName ? { attachments: [{ name: attachmentName }] } : {}),
      })),
    );

    messagesEl.innerHTML = "";
    if (!history.length) {
      renderEmptyState();
    } else {
      history.forEach((m, i) => {
        if (m.type === "tool-result") {
          appendToolResultMessage(m.content);
        } else {
          appendMessage(m.role, m.content, m.attachments, i);
        }
      });
    }
    // Tells the History tab / sidebar recents which entry is now active
    // (see getConversationId above) so they can re-render their
    // highlight to follow the freshly-loaded conversation.
    if (typeof onHistoryChanged === "function") onHistoryChanged();
  };

  /**
   * Starts a fresh conversation in this same panel instance: clears
   * in-memory state and mints a new id so the next turn creates a new IDB
  * record rather than continuing the previous one. Also restores the
  * suggestion chips (see
   * renderSuggestions()) — a fresh conversation should look the same as
   * one starting from freshly opening the AI Helper, chips included, not
   * a chat stuck without them for the rest of the panel's lifetime.
   */
  panel.startNewConversation = function startNewConversation() {
    stopSpeaking();
    typingController.clear();
    conversationId = crypto.randomUUID();
    conversationCreatedAt = Date.now();
    history.length = 0;
    renderAttachmentChips();
    messagesEl.innerHTML = "";
    renderEmptyState();
    renderSuggestions();
    // A new (unsaved) conversationId means no history entry should show
    // as active anymore — refresh the highlight to reflect that.
    if (typeof onHistoryChanged === "function") onHistoryChanged();
  };


  /**
   * Seeds this (freshly-created, empty) panel with a branched history from
   * another panel's edited-prompt Submit action (see onBranchConversation/
   * enterEditMode above) and immediately sends it — mirrors how a real new
   * turn is sent, just with pre-existing prior messages instead of a
   * blank slate. Always mints a brand new conversationId (never reuses
   * the source panel's), so this becomes its own separate IDB record,
   * leaving the original conversation the user branched from completely
   * untouched in their history. Must only be called on a panel that has
   * never sent anything yet (a new panel instance, per ai-agent.js's
   * branching flow) — calling it on a panel with existing history would
   * silently discard that history via the `history.length = 0` below.
   * @param {{messages: Array<object>, createdAt?: number}} branch
   */
  panel.loadBranch = function loadBranch(branch) {
    const branchMessages = Array.isArray(branch?.messages) ? branch.messages : [];
    if (!branchMessages.length) return;

    stopSpeaking();
    typingController.clear();
    removeSuggestions();
    conversationId = crypto.randomUUID();
    conversationCreatedAt = branch.createdAt || Date.now();
    history.length = 0;
    history.push(...branchMessages);

    messagesEl.innerHTML = "";
    history.forEach((m, i) => {
      if (m.type === "tool-result") {
        appendToolResultMessage(m.content);
      } else {
        appendMessage(m.role, m.content, m.attachments, i);
      }
    });

    // Re-send the last (edited) prompt to actually get a fresh AI reply
    // for it — resendLastUserTurn() below does the network round trip
    // using the same code path sendMessage() uses, just skipping the
    // "append a new user bubble" step since it's already rendered above.
    resendLastUserTurn();
  };

  /**
   * Re-checks AI Helper eligibility and refreshes both the input's
   * enabled/disabled state and — if the conversation is still empty — the
   * placeholder label. Called by ai-agent.js when the Settings tab saves
   * or clears an API key, so switching from Settings back to Chat (in the
   * same modal-open session, thanks to B7's panel reuse) reflects the
   * change immediately rather than needing a fresh page load.
   */
  panel.refreshAvailability = function refreshAvailability() {
    updateAvailabilityGate();
    refreshModelBarOptions();
    if (history.length === 0) renderEmptyState();
  };

  panel.clearTyping = function clearTyping() {
    typingController.clear();
  };

  panel.abortGeneration = function abortGeneration() {
    abortCurrentTurn("تم إيقاف الرد.");
  };

  panel.isGenerating = function isGeneratingStatus() {
    return isGenerating;
  };

  panel.stopSpeaking = function stopSpeakingAction() {
    stopSpeaking();
  };

  return panel;
}
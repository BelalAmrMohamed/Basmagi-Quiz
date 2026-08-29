// =============================================================================
// public/src/components/ai-agent/ai-agent-chat.js
// Chat tab: conversation state, sending messages to /api/ai-agent/chat,
// and rendering the message list. Self-contained — takes everything it
// needs via createChatPanel(options) so it can be mounted from either the
// "إمتحاناتك" view or result.html with different contextual system prompts.
// =============================================================================

import { renderMarkdown, _processByLine } from "../../shared/markdown.js";
import { getSelectedProvider, getSelectedModel, getModelsForProvider, setSelectedModel, getOwnKey, getSystemPrompt, applyResponseLanguage, isAiHelperAvailable } from "./ai-agent-settings.js";
import { getUserToken } from "../../shared/userLevel.js";
import { isAdminAuthenticated, getToken as getAdminToken } from "../../shared/adminAuth.js";
import { saveConversation, deriveConversationTitle } from "./ai-agent-history-idb.js";

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

  /** @type {{mimeType: string, base64: string, name: string} | null} */
  let pendingAttachment = null;

  /** @type {Array<{role: "user"|"assistant", content: string}>} */
  const history = [];

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

  // "New chat" — a small floating icon button in the corner of the message
  // list (not a full header row; it only needs to be there when there's
  // actually something to leave behind). Hidden whenever the current
  // conversation has no messages yet — a brand new chat, or right after
  // pressing this same button — since starting a new chat from an already
  // empty one is a no-op the user shouldn't be invited to reach for.
  // updateNewChatVisibility() (called after every state change: send,
  // loadConversation, startNewConversation) keeps this in sync.
  const newChatBtn = document.createElement("button");
  newChatBtn.type = "button";
  newChatBtn.className = "ai-agent-corner-btn ai-agent-new-chat-btn";
  newChatBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M12 7v6" /><path d="M9 10h6" /></svg>';
  newChatBtn.title = "بدء محادثة جديدة";
  newChatBtn.setAttribute("aria-label", "بدء محادثة جديدة");
  newChatBtn.hidden = true;
  newChatBtn.addEventListener("click", () => panel.startNewConversation());
  panel.appendChild(newChatBtn);

  // "Export chat" — grouped right next to "New chat" (same corner, same
  // icon-button shape via the shared .ai-agent-corner-btn class) since
  // both are chat-lifecycle actions on the current conversation. Copies a
  // plain-text transcript (both user prompts and AI answers, including
  // tool-result system lines — see history's `type: "tool-result"`
  // entries) to the clipboard; same visibility rule as newChatBtn (hidden
  // until there's at least one message to export).
  /**
   * Builds the plain-text "أنت: ... / البشمبصمج: ..." transcript and
   * copies it to the clipboard — shared by the in-panel corner export
   * button (exportChatBtn below) and the desktop sidebar's "نسخ المحادثة"
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

  const exportChatBtn = document.createElement("button");
  exportChatBtn.type = "button";
  exportChatBtn.className = "ai-agent-corner-btn ai-agent-export-chat-btn";
  exportChatBtn.innerHTML =
   '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>';
  exportChatBtn.title = "نسخ المحادثة";
  exportChatBtn.setAttribute("aria-label", "نسخ المحادثة");
  exportChatBtn.hidden = true;
  exportChatBtn.addEventListener("click", async () => {
    const ok = await exportTranscript();
    if (!ok) return;
    const original = exportChatBtn.innerHTML;
    exportChatBtn.innerHTML = CHECK_ICON_SVG;
    exportChatBtn.classList.add("ai-agent-corner-btn--copied");
    setTimeout(() => {
      exportChatBtn.innerHTML = original;
      exportChatBtn.classList.remove("ai-agent-corner-btn--copied");
    }, 1500);
  });
  panel.appendChild(exportChatBtn);

  function updateNewChatVisibility() {
    newChatBtn.hidden = history.length === 0;
    exportChatBtn.hidden = history.length === 0;
  }


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

  // Pending-attachment chip — shown above the input row once a file is
  // picked, until it's sent or removed. Built lazily since it's only ever
  // needed on pages with enableFileUpload.
  let attachmentChipEl = null;
  function renderAttachmentChip() {
    if (attachmentChipEl) {
      attachmentChipEl.remove();
      attachmentChipEl = null;
    }
    if (!pendingAttachment) return;

    attachmentChipEl = document.createElement("div");
    attachmentChipEl.className = "ai-agent-attachment-chip";
    const nameSpan = document.createElement("span");
    nameSpan.className = "ai-agent-attachment-chip-name";
    nameSpan.textContent = pendingAttachment.name;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ai-agent-attachment-chip-remove";
    removeBtn.setAttribute("aria-label", "إزالة الملف");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      pendingAttachment = null;
      renderAttachmentChip();
    });
    attachmentChipEl.appendChild(nameSpan);
    attachmentChipEl.appendChild(removeBtn);
    panel.insertBefore(attachmentChipEl, inputRow);
  }

  const inputRow = document.createElement("div");
  inputRow.className = "ai-agent-chat-input-row";

  let fileInput = null;
  let attachBtn = null;

  /**
   * Shared by both the paperclip button's file picker and drag-and-drop
   * (see the panel-level drop listener below) — validates and reads a
   * single File into pendingAttachment. A second drop/pick while one is
   * already pending simply replaces it (v1 is one file at a time, see
   * AI_HELPER_IMPROVEMENT_PLAN.md Task 3).
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
      pendingAttachment = {
        mimeType: file.type || "application/octet-stream",
        base64,
        name: file.name,
      };
      renderAttachmentChip();
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

    attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.className = "ai-agent-attach-btn";
    attachBtn.setAttribute("aria-label", "إرفاق ملف");
    attachBtn.title = "إرفاق ملف";
    attachBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

    attachBtn.addEventListener("click", () => fileInput.click());
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
      // v1 is one file at a time (see AI_HELPER_IMPROVEMENT_PLAN.md Task 3)
      // — if multiple files are dropped, only the first is used, same as
      // the file-input which has no `multiple` attribute.
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
    if (attachBtn) attachBtn.hidden = dictating;
    if (suggestionsEl) suggestionsEl.hidden = dictating;
    textarea.classList.toggle("ai-agent-chat-input--dictating", dictating);
    inputRow.classList.toggle("ai-agent-chat-input-row--dictating", dictating);
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
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    };

    recognition.onerror = (event) => {
      console.error("[ai-agent-chat] SpeechRecognition error:", event.error);
      // "no-speech"/"aborted" are routine (silence timeout, or the user's
      // own Cancel click racing the browser's own stop event) — only
      // surface a visible error for something the user couldn't have
      // caused by simply pausing or stopping normally.
      if (event.error === "no-speech" || event.error === "aborted") {
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
      setDictationUiState(false);
    };

    recognition.onend = () => {
      // The browser can end the session on its own (silence timeout)
      // without the user clicking anything — make sure the UI still
      // falls back to the idle mic-icon state either way, so the mic
      // button is never stuck showing "cancel" for a session that's
      // already over.
      if (isDictating) setDictationUiState(false);
    };

    try {
      recognition.start();
      setDictationUiState(true);
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

  // Assemble the input row now that every optional piece (attach button,
  // mic/cancel button) has been conditionally built above. DOM order:
  // attach, textarea, mic/cancel, send — send is deliberately the LAST
  // child so it's the far-right control in this RTL row (first child
  // sits visually on the right in RTL flex; see .ai-agent-chat-input-row's
  // own comment in the CSS), matching "Send Button Position: move the
  // remaining send-btn to the far-right end" from the request. Only the
  // send button (never attach/mic) stays visible during dictation — see
  // setDictationUiState, which hides attachBtn but never touches sendBtn.
  if (attachBtn) inputRow.appendChild(attachBtn);
  inputRow.appendChild(textarea);
  if (micBtn) inputRow.appendChild(micBtn);
  inputRow.appendChild(sendBtn);
  if (fileInput) inputRow.appendChild(fileInput);

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
      messagesEl.innerHTML = `<div class="ai-agent-msg ai-agent-msg--empty">اسأل البشــمبصمج عن أي سؤال متعلق بامتحاناتك 👋</div>`;
    } else {
      messagesEl.innerHTML = `<div class="ai-agent-msg ai-agent-msg--empty ai-agent-msg--unavailable">البشــمبصمج غير متاح حاليًا — يلزم مستوى 10 أو أن تكون مشرفاً. يمكنك استخدامه عن طريق إضافة مفتاح API خاص بك من الإعدادات ⚙️</div>`;
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
    if (attachBtn) attachBtn.disabled = !available;
  }

  /**
   * @param {"user"|"assistant"} role
   * @param {string} content
   * @param {string} [attachmentName] - when the user sent a file with this
   *   message, its original filename — rendered as a small chip inside the
   *   bubble so the attachment is visible in the chat itself (previously
   *   it was only visible to the AI; the user had no confirmation it was
   *   actually sent, and it silently disappeared from the transcript,
   *   including on reload from history). Assistant messages never carry
   *   one; only ever passed for role === "user".
   */
  const COPY_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
  const CHECK_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const EDIT_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';

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

  function appendMessage(role, content, attachmentName, historyIndex) {
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

    if (attachmentName) {
      const chip = document.createElement("div");
      chip.className = "ai-agent-msg-attachment";
      chip.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
      const nameSpan = document.createElement("span");
      nameSpan.className = "ai-agent-msg-attachment-name";
      nameSpan.textContent = attachmentName;
      chip.appendChild(nameSpan);
      el.appendChild(chip);
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

    if (content) addCopyButton(ensureControls(), content);
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
    return el;
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
  }

  function appendError(message) {
    const el = document.createElement("div");
    el.className = "ai-agent-msg ai-agent-msg--error";
    el.textContent = message;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    const el = document.createElement("div");
    el.className = "ai-agent-typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
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
   */
  async function resendLastUserTurn() {
    sendBtn.disabled = true;
    const typingEl = showTyping();
    const { key: ownKey, hasKey: hasOwnKey } = getOwnKey();
    const provider = getSelectedProvider();
    const model = getSelectedModel();

    // Fold contextPrompt / contextSummary into the same one-off context
    // message, prepended before the real conversation history — not a
    // fake system turn, just plain context text the model reads once per
    // send.
    //
    // Both are resolved fresh HERE, on every send, rather than once when
    // the panel was created — each may be a function precisely so this
    // stays live (see their JSDoc above). Without this, a page whose
    // context legitimately changes mid-session (quiz edited, page reset,
    // a tool call mutating state) would keep sending the assistant a
    // snapshot from whenever the panel was first mounted, on every later
    // message — including the first message of a brand new chat opened
    // afterward, since a static value captured at panel-creation time
    // never updates.
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

    const outgoingMessages = combinedContext
      ? [{ role: "user", content: combinedContext }, ...history]
      : history;

    // Prefer the user's own saved key when present — if they went to the
    // trouble of saving one, that's an explicit signal to use it, and it
    // also avoids a pointless /api/user-profile/identify round trip. Only
    // fall back to platform access (admin token, or an auto-minted
    // Level 10+ user token) when no own key is saved.
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

      const data = await res.json().catch(() => ({}));
      typingEl.remove();

      if (!res.ok) {
        console.error(
          `[ai-agent-chat] /api/ai-agent/chat responded ${res.status}:`,
          data,
        );
        const msg = data.detail
          ? `${data.error || "خطأ"}: ${data.detail}`
          : data.error || "حدث خطأ أثناء التواصل مع البشــمبصمج";
        appendError(msg);
        return;
      }

      if (data.text) {
        appendMessage("assistant", data.text);
        history.push({ role: "assistant", content: data.text });
      }

      // Persist after every successful turn (not just tool calls) — cheap
      // at this scale (one small IDB write per turn), and means a
      // conversation is never lost to a refresh/close mid-chat. Only saved
      // once there's at least one assistant reply in it, so an empty
      // "opened the panel, never sent anything" session never creates a
      // history entry.
      try {
        await saveConversation({
          id: conversationId,
          pageKey,
          title: deriveConversationTitle(history),
          createdAt: conversationCreatedAt,
          updatedAt: Date.now(),
          // Keep the attachment's filename (a few bytes) but drop the
          // base64 payload itself (see comment on Task 5's summary in the
          // history-idb module — full attachment data would bloat
          // IndexedDB fast). This is enough for a reopened "convert this
          // exam" conversation to still show which file was sent, even
          // though the file content itself isn't available anymore.
          messages: history.map(({ role, content, attachments, type }) => ({
            role,
            content,
            ...(type ? { type } : {}),
            ...(attachments?.[0]?.name ? { attachmentName: attachments[0].name } : {}),
          })),
        });
        if (typeof onHistoryChanged === "function") onHistoryChanged();
      } catch (histErr) {
        // Non-fatal — history is a convenience feature, never block the
        // actual chat on a storage failure.
        console.error("[ai-agent-chat] failed to save conversation:", histErr);
      }

      if (data.toolCall?.name && typeof onToolCall === "function") {
        try {
          // Awaited (not fire-and-forget) — onToolCall may need to show
          // the app's own async confirmation dialog (_confirm() in
          // notifications.js) for destructive actions, rather than a
          // blocking native window.confirm(). There is nothing here that
          // actually requires a synchronous return; this whole function
          // is already async, so awaiting is free and lets tool handlers
          // use the same in-app confirm UI as the rest of the app.
          const resultText = await onToolCall(data.toolCall);
          if (resultText) {
            appendToolResultMessage(resultText);
            // Tool-result bubbles (e.g. "🗑️ تم مسح الصفحة بالكامل.") were
            // previously DOM-only — appended to messagesEl above but never
            // pushed into `history`, so the saveConversation call further
            // up (which runs BEFORE onToolCall, from the plain text/turn
            // data) never captured them, and they vanished the moment the
            // conversation was reopened from the History tab. Recorded
            // here as a distinct `type: "tool-result"` entry (not a
            // regular "assistant" turn) so loadConversation/appendMessage
            // below can tell it apart and re-render it with the same
            // muted tool-result styling it has live, and re-saved so this
            // turn's history record actually reflects what the user saw.
            history.push({ role: "assistant", type: "tool-result", content: resultText });
            try {
              await saveConversation({
                id: conversationId,
                pageKey,
                title: deriveConversationTitle(history),
                createdAt: conversationCreatedAt,
                updatedAt: Date.now(),
                messages: history.map(({ role, content, attachments, type }) => ({
                  role,
                  content,
                  ...(type ? { type } : {}),
                  ...(attachments?.[0]?.name ? { attachmentName: attachments[0].name } : {}),
                })),
              });
              if (typeof onHistoryChanged === "function") onHistoryChanged();
            } catch (histErr) {
              console.error("[ai-agent-chat] failed to save conversation (tool result):", histErr);
            }
          }
        } catch (toolErr) {
          console.error("[ai-agent-chat] onToolCall failed:", toolErr);
          appendError(toolErr?.userMessage || "تعذر تنفيذ العملية. حاول مرة أخرى.");
        }
      }
    } catch (err) {
      typingEl.remove();
      console.error("[ai-agent-chat] request failed:", err);
      appendError("تعذر الاتصال بالخادم. حاول مرة أخرى.");
    } finally {
      updateAvailabilityGate();
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
    const attachment = pendingAttachment;
    // A file with no accompanying text is a valid send (e.g. "just convert
    // this exam") — only block on genuinely empty input.
    if (!text && !attachment) return;

    textarea.value = "";
    textarea.style.height = "auto";
    sendBtn.disabled = true;
    pendingAttachment = null;
    renderAttachmentChip();

    if (suggestionsEl) {
      removeSuggestions();
    }

    const outgoingUserMessage = { role: "user", content: text };
    if (attachment) outgoingUserMessage.attachments = [attachment];
    // Push BEFORE rendering so the new message's own index (history.length
    // - 1) is known for addEditButton's historyIndex — appendMessage
    // reads history[] by index, not by object identity.
    history.push(outgoingUserMessage);
    appendMessage("user", text, attachment?.name, history.length - 1);
    updateNewChatVisibility();

    await resendLastUserTurn();
  }

  sendBtn.addEventListener("click", sendMessage);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
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

  /**
   * Loads a past conversation (from ai-agent-history-idb.js) into this
   * panel: replaces the in-memory `history`, re-renders every message, and
   * takes over that conversation's id so further turns overwrite the same
   * IDB record instead of forking a new one. Called by the History tab
   * (ai-agent-history.js) when the user picks a saved conversation.
   * @param {import("./ai-agent-history-idb.js").Conversation} conversation
   */
  panel.loadConversation = function loadConversation(conversation) {
    removeSuggestions();
    pendingAttachment = null;
    renderAttachmentChip();

    conversationId = conversation.id;
    conversationCreatedAt = conversation.createdAt || Date.now();
    history.length = 0;
    // Reconstruct the `attachments` shape appendMessage/sendMessage expect
    // from the persisted `attachmentName` (see saveConversation call in
    // sendMessage) — no base64 data available after a reload, but the
    // filename is enough to redraw the same chip the user originally saw.
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
          appendMessage(m.role, m.content, m.attachments?.[0]?.name, i);
        }
      });
    }
    updateNewChatVisibility();
  };

  /**
   * Starts a fresh conversation in this same panel instance: clears
   * in-memory state and mints a new id so the next turn creates a new IDB
   * record rather than continuing the previous one. Wired to the floating
   * "new chat" icon button (see newChatBtn above) — that button hides
   * itself once the conversation is empty, so this never fires on an
   * already-empty chat. Also restores the suggestion chips (see
   * renderSuggestions()) — a fresh conversation should look the same as
   * one starting from freshly opening the AI Helper, chips included, not
   * a chat stuck without them for the rest of the panel's lifetime.
   */
  panel.startNewConversation = function startNewConversation() {
    conversationId = crypto.randomUUID();
    conversationCreatedAt = Date.now();
    history.length = 0;
    pendingAttachment = null;
    renderAttachmentChip();
    messagesEl.innerHTML = "";
    renderEmptyState();
    renderSuggestions();
    updateNewChatVisibility();
  };

  updateNewChatVisibility();

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
        appendMessage(m.role, m.content, m.attachments?.[0]?.name, i);
      }
    });
    updateNewChatVisibility();

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

  return panel;
}
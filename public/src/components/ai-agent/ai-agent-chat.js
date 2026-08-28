// =============================================================================
// public/src/components/ai-agent/ai-agent-chat.js
// Chat tab: conversation state, sending messages to /api/ai-agent/chat,
// and rendering the message list. Self-contained — takes everything it
// needs via createChatPanel(options) so it can be mounted from either the
// "إمتحاناتك" view or result.html with different contextual system prompts.
// =============================================================================

import { renderMarkdown, _processByLine } from "../../shared/markdown.js";
import { getSelectedProvider, getOwnKey, getSystemPrompt, applyResponseLanguage } from "./ai-agent-settings.js";
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
 * @param {string} [options.contextPrompt] - optional context text prepended
 *   as the first outgoing user-role message (e.g. a summary of the user's
 *   quizzes on the home page). Distinct from the system prompt below.
 * @param {string} [options.placeholder] - input placeholder text.
 * @param {"home"|"result"} [options.pageKey] - keys per-page system-prompt storage.
 * @param {string} [options.defaultSystemPrompt] - page-specific default system prompt.
 * @param {boolean} [options.enableTools] - whether the chat may call tools (e.g. create_quiz).
 * @param {(toolCall: {name: string, input: object}) => void} [options.onToolCall] -
 *   invoked when the assistant calls a tool; the actual localStorage write
 *   happens here, supplied per-page. Never passed on pages with enableTools
 *   unset, so this branch is unreachable there.
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
    onToolCall = null,
    contextSummary = null,
    suggestedPrompts = [],
    enableFileUpload = false,
    onHistoryChanged = null,
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
  newChatBtn.className = "ai-agent-new-chat-btn";
  newChatBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  newChatBtn.title = "بدء محادثة جديدة";
  newChatBtn.setAttribute("aria-label", "بدء محادثة جديدة");
  newChatBtn.hidden = true;
  newChatBtn.addEventListener("click", () => panel.startNewConversation());
  panel.appendChild(newChatBtn);

  function updateNewChatVisibility() {
    newChatBtn.hidden = history.length === 0;
  }

  // Suggestion chips — only meaningful before the conversation starts;
  // removed from the DOM (not just hidden) once the first message is sent
  // so they never come back for this panel instance.
  let suggestionsEl = null;
  if (Array.isArray(suggestedPrompts) && suggestedPrompts.length) {
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
    panel.appendChild(suggestionsEl);
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

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "ai-agent-send-btn";
  sendBtn.textContent = "إرسال";

  if (attachBtn) inputRow.appendChild(attachBtn);
  inputRow.appendChild(textarea);
  inputRow.appendChild(sendBtn);
  panel.appendChild(inputRow);
  if (fileInput) panel.appendChild(fileInput);

  function renderEmptyState() {
    messagesEl.innerHTML = `<div class="ai-agent-msg ai-agent-msg--empty">اسأل البشــمبصمج عن أي سؤال متعلق بامتحاناتك 👋</div>`;
  }
  renderEmptyState();

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
  function appendMessage(role, content, attachmentName) {
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

    if (messagesEl.querySelector(".ai-agent-msg--empty")) {
      messagesEl.innerHTML = "";
    }
    messagesEl.appendChild(el);
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

  async function sendMessage() {
    const text = textarea.value.trim();
    const attachment = pendingAttachment;
    // A file with no accompanying text is a valid send (e.g. "just convert
    // this exam") — only block on genuinely empty input.
    if (!text && !attachment) return;

    const { key: ownKey, hasKey: hasOwnKey } = getOwnKey();
    const provider = getSelectedProvider();

    textarea.value = "";
    textarea.style.height = "auto";
    sendBtn.disabled = true;
    pendingAttachment = null;
    renderAttachmentChip();

    if (suggestionsEl) {
      suggestionsEl.remove();
      suggestionsEl = null;
    }

    appendMessage("user", text, attachment?.name);
    const outgoingUserMessage = { role: "user", content: text };
    if (attachment) outgoingUserMessage.attachments = [attachment];
    history.push(outgoingUserMessage);
    updateNewChatVisibility();

    const typingEl = showTyping();

    // Fold contextSummary (a lightweight list of the user's quizzes, home
    // page only) into the same one-off context message contextPrompt
    // already uses, prepended before the real conversation history — not
    // a fake system turn, just plain context text the model reads once.
    const summaryText =
      Array.isArray(contextSummary) && contextSummary.length
        ? `امتحانات المستخدم الحالية:\n${contextSummary
            .map((q) => `- ${q.title} (${q.questionCount} سؤال، ${q.types || "غير محدد"})`)
            .join("\n")}`
        : "";
    const combinedContext = [contextPrompt, summaryText].filter(Boolean).join("\n\n");

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
          messages: outgoingMessages,
          useOwnKey: useOwnKeyNow,
          ownKey: useOwnKeyNow ? ownKey : undefined,
          systemPrompt: applyResponseLanguage(
            pageKey,
            getSystemPrompt(pageKey, defaultSystemPrompt),
          ),
          enableTools,
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
          messages: history.map(({ role, content, attachments }) => ({
            role,
            content,
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
          const resultText = onToolCall(data.toolCall);
          if (resultText) appendToolResultMessage(resultText);
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
      sendBtn.disabled = false;
    }
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
    if (suggestionsEl) {
      suggestionsEl.remove();
      suggestionsEl = null;
    }
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
      ...conversation.messages.map(({ role, content, attachmentName }) => ({
        role,
        content,
        ...(attachmentName ? { attachments: [{ name: attachmentName }] } : {}),
      })),
    );

    messagesEl.innerHTML = "";
    if (!history.length) {
      renderEmptyState();
    } else {
      history.forEach((m) => appendMessage(m.role, m.content, m.attachments?.[0]?.name));
    }
    updateNewChatVisibility();
  };

  /**
   * Starts a fresh conversation in this same panel instance: clears
   * in-memory state and mints a new id so the next turn creates a new IDB
   * record rather than continuing the previous one. Wired to the floating
   * "new chat" icon button (see newChatBtn above) — that button hides
   * itself once the conversation is empty, so this never fires on an
   * already-empty chat.
   */
  panel.startNewConversation = function startNewConversation() {
    conversationId = crypto.randomUUID();
    conversationCreatedAt = Date.now();
    history.length = 0;
    pendingAttachment = null;
    renderAttachmentChip();
    messagesEl.innerHTML = "";
    renderEmptyState();
    updateNewChatVisibility();
  };

  updateNewChatVisibility();

  return panel;
}
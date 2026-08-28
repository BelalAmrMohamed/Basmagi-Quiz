// =============================================================================
// public/src/components/ai-agent/ai-agent-chat.js
// Chat tab: conversation state, sending messages to /api/ai-agent/chat,
// and rendering the message list. Self-contained — takes everything it
// needs via createChatPanel(options) so it can be mounted from either the
// "إمتحاناتك" view or result.html with different contextual system prompts.
// =============================================================================

import { renderMarkdown, detectDirection } from "../../shared/markdown.js";
import { getSelectedProvider, getOwnKey, getSystemPrompt, applyResponseLanguage } from "./ai-agent-settings.js";
import { getUserToken } from "../../shared/userLevel.js";
import { isAdminAuthenticated, getToken as getAdminToken } from "../../shared/adminAuth.js";

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
 * @returns {HTMLElement} the chat panel root element
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
  } = options;

  /** @type {Array<{role: "user"|"assistant", content: string}>} */
  const history = [];

  const panel = document.createElement("div");
  panel.className = "ai-agent-panel ai-agent-chat-panel";

  const messagesEl = document.createElement("div");
  messagesEl.className = "ai-agent-chat-messages";
  panel.appendChild(messagesEl);

  const inputRow = document.createElement("div");
  inputRow.className = "ai-agent-chat-input-row";

  const textarea = document.createElement("textarea");
  textarea.className = "ai-agent-chat-input";
  textarea.placeholder = placeholder;
  textarea.rows = 1;
  textarea.dir = "ltr";

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "ai-agent-send-btn";
  sendBtn.textContent = "إرسال";

  inputRow.appendChild(textarea);
  inputRow.appendChild(sendBtn);
  panel.appendChild(inputRow);

  function renderEmptyState() {
    messagesEl.innerHTML = `<div class="ai-agent-msg ai-agent-msg--empty">اسأل المساعد الذكي عن أي سؤال متعلق بامتحاناتك 👋</div>`;
  }
  renderEmptyState();

  function appendMessage(role, content) {
    const el = document.createElement("div");
    el.className = `ai-agent-msg ai-agent-msg--${role}`;
    if (role === "assistant") {
      el.innerHTML = renderMarkdown(content);
    } else {
      el.textContent = content;
      el.classList.add(detectDirection(content) === "rtl" ? "text-rtl" : "text-ltr");
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
    if (!text) return;

    const { key: ownKey, hasKey: hasOwnKey } = getOwnKey();
    const provider = getSelectedProvider();

    textarea.value = "";
    textarea.style.height = "auto";
    sendBtn.disabled = true;

    appendMessage("user", text);
    history.push({ role: "user", content: text });

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
          : data.error || "حدث خطأ أثناء التواصل مع المساعد الذكي";
        appendError(msg);
        return;
      }

      if (data.text) {
        appendMessage("assistant", data.text);
        history.push({ role: "assistant", content: data.text });
      }

      if (data.toolCall?.name === "create_quiz" && typeof onToolCall === "function") {
        try {
          const title = onToolCall(data.toolCall) || data.toolCall.input?.title || "";
          appendToolResultMessage(`✅ تم إنشاء الإمتحان: ${title}`);
        } catch (toolErr) {
          console.error("[ai-agent-chat] onToolCall failed:", toolErr);
          appendError("تعذر إنشاء الإمتحان. حاول مرة أخرى.");
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
    textarea.style.direction = detectDirection(textarea.value) === "rtl" ? "rtl" : "ltr";
  });

  return panel;
}
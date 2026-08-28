// =============================================================================
// public/src/components/ai-agent/ai-agent-chat.js
// Chat tab: conversation state, sending messages to /api/ai-agent/chat,
// and rendering the message list. Self-contained — takes everything it
// needs via createChatPanel(options) so it can be mounted from either the
// "إمتحاناتك" view or result.html with different contextual system prompts.
// =============================================================================

import { renderMarkdown } from "../../shared/markdown.js";
import { getSelectedProvider, getOwnKey } from "./ai-agent-settings.js";
import { getUserToken } from "../../shared/userLevel.js";
import { isAdminAuthenticated, getToken as getAdminToken } from "../../shared/adminAuth.js";

/**
 * @param {object} options
 * @param {string} [options.contextPrompt] - optional system-style context
 *   prepended to the conversation (e.g. quiz result summary on result.html).
 * @param {string} [options.placeholder] - input placeholder text.
 * @returns {HTMLElement} the chat panel root element
 */
export function createChatPanel(options = {}) {
  const { contextPrompt = "", placeholder = "اسأل أي سؤال عن الامتحان..." } = options;

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
    }
    if (messagesEl.querySelector(".ai-agent-msg--empty")) {
      messagesEl.innerHTML = "";
    }
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
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

    const outgoingMessages = contextPrompt
      ? [{ role: "user", content: contextPrompt }, ...history]
      : history;

    // Prefer platform-provided keys when the caller qualifies (verified
    // admin, or a Level 10+ regular user) — falls back to the user's own
    // key if they've saved one, and the server rejects with a clear error
    // if neither applies (own key required).
    const isAdmin = isAdminAuthenticated();
    const adminToken = isAdmin ? getAdminToken() : null;
    const userToken = isAdmin ? null : await getUserToken();
    const authToken = adminToken || userToken;

    try {
      const headers = { "Content-Type": "application/json" };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const res = await fetch("/api/ai-agent/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider,
          messages: outgoingMessages,
          useOwnKey: !authToken && hasOwnKey,
          ownKey: !authToken && hasOwnKey ? ownKey : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      typingEl.remove();

      if (!res.ok) {
        if (res.status === 403 && hasOwnKey) {
          // Platform access denied but the user has their own key saved —
          // retry once using it instead of surfacing the 403 to them.
          try {
            const retryRes = await fetch("/api/ai-agent/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider,
                messages: outgoingMessages,
                useOwnKey: true,
                ownKey,
              }),
            });
            const retryData = await retryRes.json().catch(() => ({}));
            if (retryRes.ok) {
              appendMessage("assistant", retryData.text || "");
              history.push({ role: "assistant", content: retryData.text || "" });
              return;
            }
            appendError(retryData.error || "حدث خطأ أثناء التواصل مع المساعد الذكي");
            return;
          } catch (retryErr) {
            console.error("[ai-agent-chat] own-key retry failed:", retryErr);
            appendError("تعذر الاتصال بالخادم. حاول مرة أخرى.");
            return;
          }
        }
        appendError(data.error || "حدث خطأ أثناء التواصل مع المساعد الذكي");
        return;
      }

      appendMessage("assistant", data.text || "");
      history.push({ role: "assistant", content: data.text || "" });
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
  });

  return panel;
}

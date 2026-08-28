// =============================================================================
// public/src/components/ai-agent/ai-agent-history.js
// "المحادثات السابقة" (previous chats) tab — lists saved conversations for
// the current page (see ai-agent-history-idb.js for the pageKey scoping
// rationale), lets the user reopen one into the Chat tab, or delete it.
// =============================================================================

import {
  listConversations,
  deleteConversation,
} from "./ai-agent-history-idb.js";

const TRASH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

function formatRelativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `منذ ${diffHr} ساعة`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `منذ ${diffDay} يوم`;
  return new Date(timestamp).toLocaleDateString("ar-EG");
}

/**
 * @param {object} options
 * @param {"home"|"result"} [options.pageKey]
 * @param {(conversation: import("./ai-agent-history-idb.js").Conversation) => void} options.onSelect -
 *   called when the user picks a conversation to reopen; the caller (see
 *   ai-agent.js) is responsible for switching to the Chat tab and calling
 *   chatPanel.loadConversation(conversation).
 * @returns {HTMLElement & {refresh: () => Promise<void>}}
 */
export function createHistoryPanel(options = {}) {
  const { pageKey = "default", onSelect } = options;

  const panel = document.createElement("div");
  panel.className = "ai-agent-panel ai-agent-history-panel";

  const list = document.createElement("div");
  list.className = "ai-agent-history-list";
  panel.appendChild(list);

  async function refresh() {
    list.innerHTML = `<div class="ai-agent-history-loading">جارِ التحميل...</div>`;
    let conversations = [];
    try {
      conversations = await listConversations(pageKey);
    } catch (err) {
      console.error("[ai-agent-history] failed to load conversations:", err);
      list.innerHTML = `<div class="ai-agent-history-empty">تعذر تحميل المحادثات السابقة.</div>`;
      return;
    }

    if (!conversations.length) {
      list.innerHTML = `<div class="ai-agent-history-empty">لا توجد محادثات سابقة بعد.</div>`;
      return;
    }

    list.innerHTML = "";
    conversations.forEach((conv) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ai-agent-history-item";

      const textCol = document.createElement("div");
      textCol.className = "ai-agent-history-item-text";

      const titleEl = document.createElement("div");
      titleEl.className = "ai-agent-history-item-title";
      titleEl.textContent = conv.title;

      const timeEl = document.createElement("div");
      timeEl.className = "ai-agent-history-item-time";
      timeEl.textContent = formatRelativeTime(conv.updatedAt || conv.createdAt || Date.now());

      textCol.appendChild(titleEl);
      textCol.appendChild(timeEl);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ai-agent-history-item-delete";
      deleteBtn.setAttribute("aria-label", "حذف المحادثة");
      deleteBtn.innerHTML = TRASH_ICON_SVG;
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await deleteConversation(conv.id);
          refresh();
        } catch (err) {
          console.error("[ai-agent-history] failed to delete conversation:", err);
        }
      });

      item.appendChild(textCol);
      item.appendChild(deleteBtn);
      item.addEventListener("click", () => {
        if (typeof onSelect === "function") onSelect(conv);
      });

      list.appendChild(item);
    });
  }

  panel.refresh = refresh;
  return panel;
}
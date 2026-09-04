// =============================================================================
// public/src/components/ai-agent/ai-agent-history.js
// "المحادثات السابقة" (previous chats) tab — lists saved conversations for
// the current page (see ai-agent-history-idb.js for the pageKey scoping
// rationale), lets the user reopen one into the Chat tab, or delete/rename/
// pin it.
//
// PHASE 6: this is now also reused as the desktop/mobile sidebar's own
// full-height list renderer (see ai-agent.js) — the sidebar no longer has
// its own separate short "recents" implementation. Nothing in this file
// needed to change for that reuse beyond what Phase 5 already added below;
// createHistoryPanel() was already self-contained and page-agnostic.
// =============================================================================

import {
  listConversations,
  deleteConversation,
  renameConversation,
  setPinned,
  displayTitleFor,
} from "./ai-agent-history-idb.js";
import { openExamDropdownMenu } from "../../features/home/exam-dropdown-menu.js";
import { detectDirection } from "../../shared/markdown.js";
import { _confirm } from "../notifications/notifications.js";

const TRASH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const MORE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>`;
const RENAME_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>`;
// Filled-pin / outline-pin — swapped per conv.pinned so the same menu row
// reads as "طي/تثبيت" correctly regardless of current state, same idea as
// TOOL_DISPLAY_NAMES-style small lookups elsewhere in this component set.
const PIN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
const UNPIN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2l20 20"/><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h6"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H9.5"/></svg>`;

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
 * @param {() => string} [options.getActiveConversationId] - returns the
 *   currently-open chat panel's conversationId (see
 *   ai-agent-chat.js's panel.getConversationId), so the matching entry
 *   in this list can be marked with an "active" style. Read fresh on
 *   every refresh() rather than passed once, since the active
 *   conversation can change (new chat, branch, reopen) without this
 *   panel itself re-rendering on its own.
 * @returns {HTMLElement & {refresh: () => Promise<void>}}
 */
export function createHistoryPanel(options = {}) {
  const { pageKey = "default", onSelect, getActiveConversationId } = options;

  const panel = document.createElement("div");
  panel.className = "ai-agent-panel ai-agent-history-panel";

  const list = document.createElement("div");
  list.className = "ai-agent-history-list";
  panel.appendChild(list);

  /**
   * PHASE 5: swaps a history item's title text for an inline `<input>`,
   * committing via renameConversation() on Enter/blur and reverting (no
   * write) on Escape — mirrors the lightweight inline-rename pattern
   * already used for folders (see renameItem in user-quizzes-folders.js)
   * rather than a separate modal/prompt() for something this small.
   * @param {HTMLElement} titleEl
   * @param {import("./ai-agent-history-idb.js").Conversation} conv
   */
  function enterRenameMode(titleEl, conv) {
    const currentTitle = displayTitleFor(conv);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ai-agent-history-item-rename-input";
    input.value = currentTitle;
    input.dir = detectDirection(currentTitle);

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;
    async function commit() {
      if (settled) return;
      settled = true;
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        try {
          await renameConversation(conv.id, newTitle);
        } catch (err) {
          console.error("[ai-agent-history] failed to rename conversation:", err);
        }
      }
      refresh();
    }
    function cancel() {
      if (settled) return;
      settled = true;
      refresh();
    }

    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", commit);
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  /**
   * PHASE 5: the per-item "⋮" menu — حذف / إعادة تسمية / تثبيت·إلغاء
   * التثبيت. Reuses openExamDropdownMenu (exam-dropdown-menu.js), the same
   * anchored-dropdown engine showUserQuizActionsOverlay already relies on
   * elsewhere in the app, rather than introducing a third distinct
   * dropdown-menu visual style into the codebase.
   * @param {HTMLElement} triggerBtn
   * @param {import("./ai-agent-history-idb.js").Conversation} conv
   * @param {HTMLElement} titleEl
   */
  function openItemMenu(triggerBtn, conv, titleEl) {
    openExamDropdownMenu(triggerBtn, (menu, closeMenu) => {
      const pinOpt = document.createElement("button");
      pinOpt.type = "button";
      pinOpt.className = "exam-action-btn";
      pinOpt.innerHTML = conv.pinned
        ? `${UNPIN_ICON_SVG}<span>إلغاء التثبيت</span>`
        : `${PIN_ICON_SVG}<span>تثبيت</span>`;
      pinOpt.onclick = async (e) => {
        e.stopPropagation();
        closeMenu();
        try {
          await setPinned(conv.id, !conv.pinned);
        } catch (err) {
          console.error("[ai-agent-history] failed to toggle pin:", err);
        }
        refresh();
      };
      menu.appendChild(pinOpt);

      const renameOpt = document.createElement("button");
      renameOpt.type = "button";
      renameOpt.className = "exam-action-btn";
      renameOpt.innerHTML = `${RENAME_ICON_SVG}<span>إعادة تسمية</span>`;
      renameOpt.onclick = (e) => {
        e.stopPropagation();
        closeMenu();
        enterRenameMode(titleEl, conv);
      };
      menu.appendChild(renameOpt);

      const deleteOpt = document.createElement("button");
      deleteOpt.type = "button";
      deleteOpt.className = "exam-action-btn exam-action-btn--danger";
      deleteOpt.innerHTML = `${TRASH_ICON_SVG}<span>حذف المحادثة</span>`;
      deleteOpt.onclick = async (e) => {
        e.stopPropagation();
        if (!(await _confirm("هل أنت متأكد من حذف هذه المحادثة؟"))) return;
        closeMenu();
        try {
          await deleteConversation(conv.id);
          refresh();
        } catch (err) {
          console.error("[ai-agent-history] failed to delete conversation:", err);
        }
      };
      menu.appendChild(deleteOpt);
    });
  }

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

    const activeId =
      typeof getActiveConversationId === "function" ? getActiveConversationId() : null;

    list.innerHTML = "";
    conversations.forEach((conv) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ai-agent-history-item";
      // Highlights whichever saved conversation the Chat tab currently
      // has open, so switching to السجل shows at a glance which thread
      // is live — mirrors how the desktop sidebar's recents list does
      // the same (see ai-agent.js's refreshSidebarRecents).
      if (activeId && conv.id === activeId) {
        item.classList.add("ai-agent-history-item--active");
        item.setAttribute("aria-current", "true");
      }
      if (conv.pinned) {
        item.classList.add("ai-agent-history-item--pinned");
      }

      const textCol = document.createElement("div");
      textCol.className = "ai-agent-history-item-text";

      const displayTitle = displayTitleFor(conv);
      const titleEl = document.createElement("div");
      titleEl.className = "ai-agent-history-item-title";
      titleEl.textContent = displayTitle;
      // PHASE 5: per-item direction, not a blanket rtl on the whole list —
      // a title can be an English-typed prompt even in an otherwise
      // Arabic-first UI (see detectDirection's own doc: first strong
      // character wins). Applied to the title only, not the whole item,
      // so the pin/time/menu chrome around it stays laid out per the
      // list's own RTL flow regardless of this one title's language.
      titleEl.dir = detectDirection(displayTitle);

      const timeEl = document.createElement("div");
      timeEl.className = "ai-agent-history-item-time";
      timeEl.textContent = formatRelativeTime(conv.updatedAt || conv.createdAt || Date.now());

      textCol.appendChild(titleEl);
      textCol.appendChild(timeEl);

      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "ai-agent-history-item-more";
      moreBtn.setAttribute("aria-label", "خيارات المحادثة");
      moreBtn.innerHTML = MORE_ICON_SVG;
      moreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openItemMenu(moreBtn, conv, titleEl);
      });

      item.appendChild(textCol);
      item.appendChild(moreBtn);
      item.addEventListener("click", () => {
        if (typeof onSelect === "function") onSelect(conv);
      });

      list.appendChild(item);
    });
  }

  panel.refresh = refresh;
  return panel;
}
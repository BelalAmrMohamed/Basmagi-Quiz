// =============================================================================
// public/src/components/ai-agent/ai-agent-item-lookup.js
// Pure data-lookup helpers for user-created quizzes/folders/courses
// (`user_quizzes` in localStorage) — split out of
// ai-agent-attach-launcher.js so it has ZERO dependency on ai-agent.js
// (openAIAgentModal/getChatPanelForPageKey). ai-agent-chat.js's own header
// comment explicitly says it stays a self-contained "takes everything via
// options/attachments" component and doesn't import quiz-schema/storage
// helpers directly — but Phase 4's `/`/`@` menu genuinely needs to list
// these items from inside the chat panel itself. Routing that need through
// ai-agent-attach-launcher.js (which imports ai-agent.js, which imports
// createChatPanel from ai-agent-chat.js) would close a real three-file
// import cycle; this module breaks that by holding only the pure lookup
// logic, with no path back to ai-agent.js at all.
//
// ai-agent-attach-launcher.js re-uses these same helpers (see its own
// resolveUserItemAttachment, now a thin wrapper around
// resolveUserItemById here) rather than duplicating the lookup logic.
// =============================================================================

import { getFromStorage } from "../../shared/storage-helpers.js";
import { qz } from "../../features/home/quiz-schema.js";
import { getFolderContentsCount } from "../../features/home/user-quizzes-folders.js";

/**
 * Reads the flat user_quizzes array from localStorage. Failure-safe (bad
 * JSON, storage unavailable) — callers degrade to an empty list rather
 * than throwing.
 * @returns {object[]}
 */
export function readUserQuizzes() {
  try {
    return JSON.parse(getFromStorage("user_quizzes", "[]")) || [];
  } catch {
    return [];
  }
}

/**
 * Builds a compact plain-text summary for a single quiz — question count
 * per type, so the assistant has something concrete to reason about
 * without the full question/answer payload inlined into the conversation.
 * @param {object} quiz - a user_quizzes entry (meta/stats/questions shape)
 * @returns {string}
 */
export function summarizeQuiz(quiz) {
  const count = qz(quiz, "count") || quiz.questions?.length || 0;
  const type = qz(quiz, "type");
  const description = qz(quiz, "description");
  const parts = [`عدد الأسئلة: ${count}`];
  if (type) parts.push(`النوع: ${type}`);
  if (description) parts.push(`الوصف: ${description}`);
  return parts.join(" — ");
}

/**
 * Builds a compact summary for a folder/course — how many quizzes and
 * subfolders it contains, recursively (see getFolderContentsCount).
 * @param {object[]} userQuizzes
 * @param {string} folderId
 * @returns {string}
 */
export function summarizeFolder(userQuizzes, folderId) {
  const { subfolderCount, quizCount } = getFolderContentsCount(userQuizzes, folderId);
  const parts = [];
  if (quizCount) parts.push(`${quizCount} اختبار`);
  if (subfolderCount) parts.push(`${subfolderCount} مجلد فرعي`);
  return parts.length ? `يحتوي على: ${parts.join(" و")}` : "مجلد فارغ حاليًا";
}

/**
 * Resolves a user-created quiz/folder/course id into the
 * {kind, id, title, summary, source} shape panel.addPendingAttachment
 * expects. Returns null if the id can't be found (e.g. a stale reference).
 * @param {string} id
 * @param {object[]} [userQuizzes] - pass a pre-fetched list to avoid a
 *   redundant localStorage read when a caller (see listRecentUserItems)
 *   already has one on hand.
 * @returns {{kind: "quiz"|"course"|"folder", id: string, title: string, summary: string, source: "local"} | null}
 */
export function resolveUserItemById(id, userQuizzes = readUserQuizzes()) {
  const item = userQuizzes.find((q) => (q.meta?.id || q.id) === id);
  if (!item) return null;

  const title = qz(item, "title") || item.meta?.title || "بدون عنوان";
  const metaType = item.meta?.type;
  const kind = metaType === "folder" || metaType === "course" ? metaType : "quiz";
  const summary =
    kind === "quiz" ? summarizeQuiz(item) : summarizeFolder(userQuizzes, id);

  return { kind, id, title, summary, source: "local" };
}

/**
 * PHASE 4 (reduced scope, per the plan's own instruction): lists items for
 * the `/`/`@` attachment menu and the "more" popover's own list — most
 * recently created first, capped, no fuzzy search/entity indexing. Plain
 * substring `query` filter only (case-insensitive), applied when the user
 * has typed something after the trigger character.
 * @param {string} [query] - free-text filter typed after `/`/`@`; matched
 *   against the item's title, case-insensitively. Empty/omitted returns
 *   the most recent items unfiltered.
 * @param {number} [limit=8]
 * @returns {Array<{kind: "quiz"|"course"|"folder", id: string, title: string, summary: string, source: "local"}>}
 */
export function listRecentUserItems(query = "", limit = 8) {
  const userQuizzes = readUserQuizzes();
  const q = query.trim().toLowerCase();

  const items = userQuizzes
    .map((item) => {
      const id = item.meta?.id || item.id;
      if (!id) return null;
      const title = qz(item, "title") || item.meta?.title || "بدون عنوان";
      if (q && !title.toLowerCase().includes(q)) return null;
      const metaType = item.meta?.type;
      const kind = metaType === "folder" || metaType === "course" ? metaType : "quiz";
      return {
        kind,
        id,
        title,
        // Summary built lazily (resolveUserItemById) only for the item
        // actually picked — building it for every item in a possibly
        // large list on every keystroke would be wasted work for a menu
        // that only ever shows 8 of them.
        createdAt: item.meta?.createdAt || 0,
      };
    })
    .filter(Boolean);

  // Most-recently-created first — "recent items" per the plan's reduced
  // scope, not alphabetical or folder-tree order.
  items.sort((a, b) => {
    const at = Date.parse(a.createdAt) || 0;
    const bt = Date.parse(b.createdAt) || 0;
    return bt - at;
  });

  return items.slice(0, limit);
}
// =============================================================================
// public/src/components/ai-agent/ai-agent-history-idb.js
// IndexedDB store for AI Helper chat history. Deliberately a separate
// database from quiz-idb.js's BasmagiQuizDB — chat transcripts have their
// own lifecycle/growth pattern (many small writes over time, unrelated to
// quiz data), so keeping them in a dedicated DB avoids coupling their
// schemas or version-bump timing to the quiz store's.
//
// Conversations are scoped per pageKey ("home" | "result") — a home-page
// chat about browsing quizzes and a result-page chat analyzing one specific
// attempt are different enough contexts that mixing them into a single
// unified list would just make the list noisier to scan, and pageKey is
// already the same scoping key the system prompt/response-language
// settings use (see ai-agent-settings.js).
// =============================================================================

const HISTORY_DB_NAME = "BasmagiAIAgentHistoryDB";
const HISTORY_DB_VERSION = 1;
const CONVERSATIONS_STORE = "conversations";

function openHistoryIDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        const store = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: "id" });
        store.createIndex("by-pageKey", "pageKey", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          `IndexedDB open failed (${HISTORY_DB_NAME} v${HISTORY_DB_VERSION}): ${request.error?.message || "unknown error"}`,
        ),
      );
  });
}

/**
 * @typedef {object} Conversation
 * @property {string} id
 * @property {"home"|"result"} pageKey
 * @property {string} title - derived from the first user message, truncated
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {Array<{role: "user"|"assistant", content: string, type?: "tool-result"}>} messages
 */

/**
 * Saves (creates or overwrites) a conversation. Called once per turn from
 * ai-agent-chat.js — cheap enough at this scale that no batching/debounce
 * is needed.
 * @param {Conversation} conversation
 */
export async function saveConversation(conversation) {
  const db = await openHistoryIDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readwrite");
      tx.objectStore(CONVERSATIONS_STORE).put(conversation);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("saveConversation transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("saveConversation transaction aborted"));
    });
  } finally {
    db.close();
  }
}

/**
 * Lists all conversations for a given page, most recently updated first.
 * @param {"home"|"result"} pageKey
 * @returns {Promise<Conversation[]>}
 */
export async function listConversations(pageKey) {
  const db = await openHistoryIDB();
  try {
    const results = await new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readonly");
      const index = tx.objectStore(CONVERSATIONS_STORE).index("by-pageKey");
      const request = index.getAll(IDBKeyRange.only(pageKey));
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("listConversations request failed"));
    });
    return results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } finally {
    db.close();
  }
}

/**
 * @param {string} id
 */
export async function deleteConversation(id) {
  const db = await openHistoryIDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readwrite");
      tx.objectStore(CONVERSATIONS_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("deleteConversation transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("deleteConversation transaction aborted"));
    });
  } finally {
    db.close();
  }
}

/**
 * Derives a short display title from the first user message in a
 * conversation — same idea as how chat products title new threads.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {string}
 */
export function deriveConversationTitle(messages) {
  const firstUserMsg = messages.find((m) => m.role === "user");
  const text = (firstUserMsg?.content || "").trim();
  if (!text) {
    // Attachment-only first message (e.g. "just convert this exam", no
    // accompanying text) — fall back to the filename instead of a generic
    // "untitled" label, so the history list still gives a useful hint at
    // a glance about what the conversation was about.
    const attachmentName = firstUserMsg?.attachments?.[0]?.name;
    return attachmentName ? `📎 ${attachmentName}` : "محادثة بدون عنوان";
  }
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}
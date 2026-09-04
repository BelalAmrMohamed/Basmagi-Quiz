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
 * @property {string} [manualTitle] - set via renameConversation(); when
 *   present, preferred over `title` for display (see listConversations'
 *   callers) so re-deriving from the first message on a later save never
 *   silently clobbers a user's rename.
 * @property {boolean} [pinned] - PHASE 5: sorted first by listConversations
 *   below. Absent on records written before this field existed — treated
 *   as `false` wherever it's read (IndexedDB is schemaless per-record, so
 *   there's no migration to run; a fresh `pinned: false` is just written
 *   on the next save of any older record).
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
    // PHASE 5: every turn calls saveConversation with a freshly-built
    // object (id/pageKey/title/createdAt/updatedAt/messages only — see
    // ai-agent-chat.js) that knows nothing about `manualTitle`/`pinned`.
    // A plain `put()` of that object would silently erase a user's rename
    // or pin on the very next turn, since put() fully overwrites the
    // record rather than merging fields. Read the existing record first
    // (inside the same transaction) and carry its manualTitle/pinned
    // forward whenever the incoming object doesn't explicitly specify
    // them — callers that DO know about these fields (renameConversation/
    // setPinned above) always pass them explicitly, so this only ever
    // fills a gap, never overrides an intentional value.
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readwrite");
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const getRequest = store.get(conversation.id);
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        const merged = {
          pinned: false,
          ...(existing ? { pinned: existing.pinned, manualTitle: existing.manualTitle } : {}),
          ...conversation,
        };
        // `manualTitle: undefined` can end up on `merged` above when
        // neither `existing` nor `conversation` set it — IndexedDB stores
        // that as an explicit undefined value rather than omitting the
        // key, which is harmless to read back (displayTitleFor treats
        // both the same) but tidier to just not write.
        if (merged.manualTitle === undefined) delete merged.manualTitle;
        store.put(merged);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("saveConversation transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("saveConversation transaction aborted"));
    });
  } finally {
    db.close();
  }
}

/**
 * Reads one conversation record by id, or null if it doesn't exist.
 * Shared helper for renameConversation/setPinned below, which both need
 * to read-modify-write a single field without the caller re-supplying
 * the entire conversation.
 * @param {string} id
 * @returns {Promise<Conversation|null>}
 */
async function getConversation(id) {
  const db = await openHistoryIDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readonly");
      const request = tx.objectStore(CONVERSATIONS_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("getConversation request failed"));
    });
  } finally {
    db.close();
  }
}

/**
 * PHASE 5: sets (or clears, if newTitle is empty) a manual display title
 * for a conversation — see the `manualTitle` field doc on the Conversation
 * typedef above for why this is a separate field from `title` rather than
 * overwriting it directly.
 * @param {string} id
 * @param {string} newTitle
 */
export async function renameConversation(id, newTitle) {
  const conversation = await getConversation(id);
  if (!conversation) return;
  const trimmed = (newTitle || "").trim();
  if (trimmed) {
    conversation.manualTitle = trimmed;
  } else {
    delete conversation.manualTitle;
  }
  await saveConversation(conversation);
}

/**
 * PHASE 5: toggles a conversation's pinned state — pinned conversations
 * sort first in listConversations() below.
 * @param {string} id
 * @param {boolean} pinned
 */
export async function setPinned(id, pinned) {
  const conversation = await getConversation(id);
  if (!conversation) return;
  conversation.pinned = Boolean(pinned);
  await saveConversation(conversation);
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
    // PHASE 5: pinned conversations first, then by updatedAt (as before)
    // within each group — a record from before `pinned` existed reads as
    // `undefined`, treated the same as `false` here.
    return results.sort((a, b) => {
      const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pinDiff !== 0) return pinDiff;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
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
    // accompanying text) — fall back to the attachment's display label
    // instead of a generic "untitled" label, so the history list still
    // gives a useful hint at a glance about what the conversation was
    // about. Covers both a file attachment (`.name`) and, per Phase 2a's
    // platform-item attachment refactor, a quiz/course/folder reference
    // (`.title`) — a quiz-only opener with no typed prompt still gets a
    // sensible history title instead of "محادثة بدون عنوان".
    const firstAttachment = firstUserMsg?.attachments?.[0];
    const label = firstAttachment?.name || firstAttachment?.title;
    return label ? `📎 ${label}` : "محادثة بدون عنوان";
  }
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/**
 * PHASE 5: the title to actually show for a conversation — a manual
 * rename (see renameConversation) always wins over the auto-derived
 * `title`, so saveConversation()'s every-turn re-derivation (see
 * ai-agent-chat.js) never silently overwrites what the user typed.
 * @param {Conversation} conversation
 * @returns {string}
 */
export function displayTitleFor(conversation) {
  return conversation?.manualTitle || conversation?.title || "محادثة بدون عنوان";
}
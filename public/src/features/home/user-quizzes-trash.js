// ============================================================================
// public/src/features/home/user-quizzes-trash.js
// LOCAL ("امتحاناتك") TRASH — client-side soft-delete for the localStorage-only
// user_quizzes tree. See docs/plans/Admin actions and deletion flow for
// quizzes.md §4 for the full design rationale; this is that section's Step 8.
//
// There is no server table backing "امتحاناتك" at all (it's pure
// localStorage), so this trash is a second bucket — a new "user_quizzes_trash"
// key — rather than a server-side soft-delete flag. That also means there is
// no cron/job runner to enforce retention: expiry is enforced lazily, via
// sweepExpiredUserQuizzesTrash(), called once whenever the trash is opened
// (mirrors the server's own "vacuum on access" pattern for consistency, see
// plan §2's purge-expired action).
//
// Storage shape — an array of entries:
//   { batchId: string, items: [{ id, meta, stats, questions, ... }, ...],
//     deletedAt: ISOString, expiresAt: ISOString, label: string }
// One entry per delete action (a single quiz, or a folder/course plus every
// descendant it dragged with it via expandSelectionWithDescendants), so a
// cascaded delete restores or purges as one unit instead of N loose rows.
// `label` is the human-readable name shown in the trash panel — computed once
// at delete time rather than re-derived at render time, so it survives even
// if the underlying item's title can't be looked up any other way.
// ============================================================================

import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { hasSameLevelCollision } from "./user-quizzes-folders.js";

const TRASH_KEY = "user_quizzes_trash";
const RETENTION_SETTING_KEY = "user_quizzes_trash_retention_days";
const DEFAULT_RETENTION_DAYS = 30;

/** Local retention setting (days), editable from the trash panel — a plain
 * localStorage value rather than baked into every entry, so changing it only
 * affects newly-trashed items going forward (mirrors the server side's
 * `trash_retention_days` being read at trash time, not retroactively
 * rewriting existing rows' `expiresAt`). */
export function getTrashRetentionDays() {
    const raw = getFromStorage(RETENTION_SETTING_KEY, String(DEFAULT_RETENTION_DAYS));
    const days = Number(raw);
    return Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_RETENTION_DAYS;
}

export function setTrashRetentionDays(days) {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
        return { ok: false, reason: "مدة الاحتفاظ يجب أن تكون بين 1 و 365 يوماً." };
    }
    setInStorage(RETENTION_SETTING_KEY, String(n));
    return { ok: true };
}

function readTrash() {
    try {
        const parsed = JSON.parse(getFromStorage(TRASH_KEY, "[]"));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeTrash(entries) {
    setInStorage(TRASH_KEY, JSON.stringify(entries));
}

/**
 * Moves a set of full row snapshots into the trash as one batch. Caller is
 * responsible for having already removed them from `user_quizzes` (mirrors
 * how deleteFolder()/deleteUserQuiz() already read-modify-write that key
 * themselves) — this only appends to the trash bucket.
 * @param {object[]} items - full row snapshots (meta/stats/questions intact,
 *   including cascaded descendants for a folder/course batch)
 * @param {string} label - human-readable name for the trash panel
 * @returns {string} the batchId, so a caller could reference it (not
 *   currently needed, but keeps parity with the server's batch_id return)
 */
export function moveToTrash(items, label) {
    if (!items || !items.length) return null;
    const retentionDays = getTrashRetentionDays();
    const now = Date.now();
    const batchId = crypto.randomUUID();
    const entry = {
        batchId,
        items,
        deletedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + retentionDays * 24 * 60 * 60 * 1000).toISOString(),
        label,
    };
    const trash = readTrash();
    trash.push(entry);
    writeTrash(trash);
    return batchId;
}

/**
 * Lazy sweep — drops any trash entry whose expiresAt has passed. Called on
 * every trash-panel open (see openLocalTrashPanel below) and is otherwise a
 * no-op cost the rest of the app never pays, since nothing else reads this
 * key. Mirrors the server's purge-expired action, but with no media-storage
 * cleanup step needed (localStorage entries don't reference remote storage
 * objects the way shared/uploaded quizzes can).
 * @returns {number} how many entries were purged
 */
export function sweepExpiredUserQuizzesTrash() {
    const trash = readTrash();
    const now = Date.now();
    const kept = trash.filter((entry) => new Date(entry.expiresAt).getTime() > now);
    if (kept.length !== trash.length) writeTrash(kept);
    return trash.length - kept.length;
}

export function listTrashEntries() {
    sweepExpiredUserQuizzesTrash();
    // Newest deletion first — matches the admin trash panel's ordering.
    return readTrash().slice().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
}

function findEntry(trash, batchId) {
    return trash.find((e) => e.batchId === batchId) || null;
}

/**
 * Restores one trashed batch back into `user_quizzes`.
 *
 * Parent resolution: every item in the batch keeps its original
 * `meta.parentId`. If that parent still exists in `user_quizzes` (i.e. it
 * wasn't itself part of this trashed batch and wasn't separately deleted),
 * items restore right back where they were. If the *root* item of the batch
 * (the one whose parent is outside the batch — for a single quiz that's
 * simply itself) had a parentId that no longer resolves to anything live,
 * it's re-parented to root instead — mirroring the server side's "restore to
 * root if the original parent was permanently purged" fallback (plan §2).
 * Every other item in the batch keeps pointing at its original parentId
 * within the batch, since those relationships are restored together.
 *
 * Name collisions at the restored level are resolved with an auto-suffix
 * ("(2)", "(3)", ...), consistent with the existing collision-avoidance
 * convention used elsewhere in user-quizzes-folders.js, rather than blocking
 * the restore outright.
 *
 * @param {string} batchId
 * @returns {{ok: boolean, restored?: number, reason?: string}}
 */
export function restoreTrashBatch(batchId) {
    const trash = readTrash();
    const entry = findEntry(trash, batchId);
    if (!entry) return { ok: false, reason: "لم يتم العثور على العنصر في سلة المهملات." };

    const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
    const liveIds = new Set(userQuizzes.map((q) => q.id || q.meta?.id).filter(Boolean));
    const batchIds = new Set(entry.items.map((it) => it.id || it.meta?.id).filter(Boolean));

    entry.items.forEach((item) => {
        if (!item.meta) return;
        const originalParentId = item.meta.parentId || null;
        // Only re-root items whose parent is neither still live in user_quizzes
        // NOR another item being restored in this same batch (that relationship
        // is restored intact regardless of whether the parent also currently
        // exists elsewhere).
        const parentStillResolvable =
            originalParentId === null || liveIds.has(originalParentId) || batchIds.has(originalParentId);
        item.meta.parentId = parentStillResolvable ? originalParentId : null;

        // Auto-suffix on same-level collision, checked against the *current*
        // userQuizzes array as it's being built up (so two items in the same
        // batch restoring to the same level, or a name reused since deletion,
        // both get resolved rather than silently colliding).
        let title = item.meta.title || "";
        let suffix = 1;
        while (
            hasSameLevelCollision(userQuizzes, {
                type: item.meta.type || "quiz",
                title,
                parentId: item.meta.parentId,
                excludeId: item.id || item.meta.id,
            })
        ) {
            suffix += 1;
            title = `${item.meta.title || ""} (${suffix})`;
        }
        item.meta.title = title;

        userQuizzes.push(item);
    });

    setInStorage("user_quizzes", JSON.stringify(userQuizzes));

    const remaining = trash.filter((e) => e.batchId !== batchId);
    writeTrash(remaining);

    return { ok: true, restored: entry.items.length };
}

/** Permanently deletes one trashed batch (no restore possible afterward). */
export function purgeTrashBatch(batchId) {
    const trash = readTrash();
    const entry = findEntry(trash, batchId);
    if (!entry) return { ok: false, reason: "لم يتم العثور على العنصر في سلة المهملات." };
    writeTrash(trash.filter((e) => e.batchId !== batchId));
    return { ok: true };
}

/** Empties the entire local trash — used by the panel's "إفراغ السلة". */
export function purgeAllTrash() {
    const count = readTrash().length;
    writeTrash([]);
    return { ok: true, purged: count };
}

/** Total count across all trashed batches (every item, not just batches) —
 * used to badge the "سلة المهملات" entry point and decide whether to show
 * the panel's "إفراغ السلة" action at all. */
export function getTrashItemCount() {
    return listTrashEntries().reduce((sum, e) => sum + (e.items?.length || 0), 0);
}
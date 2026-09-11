// =============================================================================
// api/_itemActions.js
// Small shared validators for the move-item/rename-item admin actions.
//
// canPlaceItemServer mirrors public/src/features/home/user-quizzes-folders.js's
// canPlaceItem() invariant ("courses are always top-level; nothing may be
// moved into a course except directly") — ported server-side per the plan's
// explicit instruction not to trust the client-side check alone. Keep both
// in sync if the placement rule ever changes.
// =============================================================================

/**
 * @param {"quiz"|"folder"|"course"} itemType
 * @param {string|null} targetFolderId
 * @returns {{ ok: boolean, error?: string }}
 */
export function canPlaceItemServer(itemType, targetFolderId) {
    if (itemType === "course" && targetFolderId !== null) {
        return {
            ok: false,
            error: "المواد تبقى في المستوى الرئيسي دائماً ولا يمكن نقلها داخل مجلد.",
        };
    }
    return { ok: true };
}

/**
 * Basic sanity checks for a new item name (rename/create). Same-level
 * collision protection is NOT done here as a pre-check query (that would
 * race against a concurrent rename/move to the same name) — folders and
 * courses already have DB-level uniqueness constraints
 * (folders_unique_name_per_parent, courses_unique_slot /
 * courses_canonical_unique_slot — see supabase/migrations/
 * 20260901195646_courses_and_folders.sql and
 * 20260904000000_colleges.sql), and the callers in api/admin.js
 * (handleRenameItem, handleMoveItem) catch the resulting 23505
 * unique_violation and turn it into a friendly error instead of a generic
 * 500. Quizzes have no such constraint and still allow duplicate titles at
 * the same level, unchanged from before.
 * @param {unknown} name
 * @returns {{ ok: boolean, error?: string, clean?: string }}
 */
export function validateItemName(name) {
    const clean = String(name || "").trim();
    if (!clean) return { ok: false, error: "الاسم مطلوب." };
    if (clean.length > 200) return { ok: false, error: "الاسم طويل جداً (الحد الأقصى 200 حرف)." };
    return { ok: true, clean };
}
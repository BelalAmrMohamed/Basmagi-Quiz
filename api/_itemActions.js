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
 * Basic sanity checks for a new item name (rename/create). Full uniqueness
 * enforcement (same-level collision) is intentionally NOT duplicated here —
 * unlike the localStorage side, the shared/Supabase area has no
 * client-maintained in-memory collision index to reuse, and a DB unique
 * constraint would be the more idiomatic place for that; for now a
 * duplicate name at the same level is allowed (mirrors quizzes today, where
 * duplicate titles are already possible).
 * @param {unknown} name
 * @returns {{ ok: boolean, error?: string, clean?: string }}
 */
export function validateItemName(name) {
    const clean = String(name || "").trim();
    if (!clean) return { ok: false, error: "الاسم مطلوب." };
    if (clean.length > 200) return { ok: false, error: "الاسم طويل جداً (الحد الأقصى 200 حرف)." };
    return { ok: true, clean };
}
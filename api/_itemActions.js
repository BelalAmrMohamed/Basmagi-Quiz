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
 * @param {"quiz"|"lesson"|"folder"|"course"} itemType
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
    // Lessons follow the exact same placement rule as quizzes: can go
    // directly under a course (targetFolderId === null) or under any
    // folder, never top-level-only like a course. No extra check needed
    // beyond the course guard above — falls through to the ok:true below,
    // same as "quiz" already does.
    return { ok: true };
}

/**
 * Basic sanity checks for a new item name (rename/create). Same-level
 * collision protection for folders/courses is NOT done here as a pre-check
 * query (that would race against a concurrent rename/move to the same
 * name) — they already have DB-level uniqueness constraints
 * (folders_unique_name_per_parent, courses_unique_slot /
 * courses_canonical_unique_slot — see supabase/migrations/
 * 20260901195646_courses_and_folders.sql and
 * 20260904000000_colleges.sql), and the callers in api/admin.js
 * (handleRenameItem, handleMoveItem) catch the resulting 23505
 * unique_violation and turn it into a friendly error instead of a generic
 * 500. Quizzes have no such constraint — see hasQuizNameCollision below,
 * which callers that write a quiz's title/placement (handleRenameItem,
 * handleUpdateQuiz, handleMoveItem) now use instead.
 * @param {unknown} name
 * @returns {{ ok: boolean, error?: string, clean?: string }}
 */
export function validateItemName(name) {
    const clean = String(name || "").trim();
    if (!clean) return { ok: false, error: "الاسم مطلوب." };
    if (clean.length > 200) return { ok: false, error: "الاسم طويل جداً (الحد الأقصى 200 حرف)." };
    return { ok: true, clean };
}

/**
 * Same-level naming rule for quizzes (see docs/amtihanatak-naming-rule-audit.md),
 * enforced at the app layer since — unlike folders/courses —
 * `quizzes` has no matching DB uniqueness constraint to lean on. Used by
 * every path that can leave a quiz with a new title at a given placement:
 * handleRenameItem (title change, same placement), handleUpdateQuiz (title
 * change via edit, same placement), and handleMoveItem (same title, new
 * placement).
 *
 * This is a pre-check query, not a constraint, so — unlike the 23505
 * branches for folders/courses — it can race against a concurrent
 * rename/move landing on the same name between the check and the write.
 * Accepted here: the local "امتحاناتك" side has the same race (a plain
 * array read-modify-write, no locking) and it's never been a practical
 * problem, since two admins concurrently renaming into the exact same
 * title at the exact same spot is a vanishingly rare collision to begin
 * with — a real fix would need a partial unique index (title normalized,
 * scoped to course_id/folder_id), which is a schema change the audit's
 * fix plan deliberately keeps out of scope for now.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ courseId: string, folderId: string|null, title: string, excludeId?: string }} params
 * @returns {Promise<boolean>} true if another quiz already occupies this name at this spot
 */
export async function hasQuizNameCollision(supabase, { courseId, folderId, title, excludeId = null }) {
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle || !courseId) return false;

    let query = supabase
        .from("quizzes")
        .select("id")
        .eq("course_id", courseId)
        .ilike("title", normalizedTitle);

    query = folderId ? query.eq("folder_id", folderId) : query.is("folder_id", null);
    if (excludeId) query = query.neq("id", excludeId);

    const { data, error } = await query.limit(1);
    if (error) {
        console.error("[hasQuizNameCollision] lookup failed:", error.message);
        return false; // fail open — a lookup error shouldn't block a legitimate write
    }
    return Boolean(data && data.length);
}

/**
 * Same-level naming rule for lessons, mirroring hasQuizNameCollision above
 * exactly (same-course, same-folder-scope, `ilike` on title, and the same
 * pre-check-not-constraint race-condition caveat documented on that
 * function applies identically here — not re-litigated).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ courseId: string, folderId: string|null, title: string, excludeId?: string }} params
 * @returns {Promise<boolean>} true if another lesson already occupies this name at this spot
 */
export async function hasLessonNameCollision(supabase, { courseId, folderId, title, excludeId = null }) {
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle || !courseId) return false;

    let query = supabase
        .from("lessons")
        .select("id")
        .eq("course_id", courseId)
        .ilike("title", normalizedTitle);

    query = folderId ? query.eq("folder_id", folderId) : query.is("folder_id", null);
    if (excludeId) query = query.neq("id", excludeId);

    const { data, error } = await query.limit(1);
    if (error) {
        console.error("[hasLessonNameCollision] lookup failed:", error.message);
        return false; // fail open — a lookup error shouldn't block a legitimate write
    }
    return Boolean(data && data.length);
}
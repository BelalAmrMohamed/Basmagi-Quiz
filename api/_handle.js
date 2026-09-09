// =============================================================================
// api/_handle.js
// Shared helpers for admin_users.handle: slug rules + collision-safe
// claiming. Used by:
//   - api/auth.js       (auto-generates a default handle on first login)
//   - api/admin.js       (lets an admin/dev edit their own handle)
// Centralized here so both call sites agree on what a "valid" handle looks
// like and use the exact same race-safe claim logic — previously only
// auth.js had this, which would have made it easy for a hand-rolled
// "edit handle" endpoint to drift from the signup rules (e.g. different
// length cap, no collision retry) and hand out a handle that collides
// with an existing user's after both requests race past a naive check.
// =============================================================================

const MIN_HANDLE_LENGTH = 3;
const MAX_HANDLE_LENGTH = 30;

// Lowercase letters, digits, underscore, hyphen only — same character set
// auth.js's original ensureHandle() stripped down to, kept unchanged so
// existing handles (and links already shared as /@handle) stay valid.
const HANDLE_CHARS_RE = /^[a-z0-9_-]+$/;

/**
 * Normalizes a raw handle candidate: lowercase, strip disallowed
 * characters, cap length. Does NOT check length/emptiness — call
 * validateHandleFormat() on the result before using it.
 *
 * @param {string} raw
 * @returns {string}
 */
export function slugifyHandle(raw) {
    return String(raw || "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, MAX_HANDLE_LENGTH);
}

/**
 * Validates a handle that's already been through slugifyHandle (or was
 * typed directly by a user editing their own handle). Returns a
 * { valid, message } pair — message is a user-facing Arabic string,
 * matching the rest of this codebase's error responses.
 *
 * @param {string} handle
 * @returns {{valid: boolean, message: string}}
 */
export function validateHandleFormat(handle) {
    if (!handle || typeof handle !== "string") {
        return { valid: false, message: "الرجاء إدخال معرّف صالح" };
    }
    if (handle.length < MIN_HANDLE_LENGTH) {
        return {
            valid: false,
            message: `المعرّف قصير جداً (الحد الأدنى ${MIN_HANDLE_LENGTH} أحرف)`,
        };
    }
    if (handle.length > MAX_HANDLE_LENGTH) {
        return {
            valid: false,
            message: `المعرّف طويل جداً (الحد الأقصى ${MAX_HANDLE_LENGTH} حرف)`,
        };
    }
    if (!HANDLE_CHARS_RE.test(handle)) {
        return {
            valid: false,
            message:
                "المعرّف يجب أن يحتوي فقط على أحرف إنجليزية صغيرة وأرقام و - و _",
        };
    }
    return { valid: true, message: "" };
}

/**
 * Attempts to claim `candidateHandle` for `adminId`, retrying with a
 * numeric suffix (candidate2, candidate3, ...) on collision — same
 * check-then-write-then-retry-on-23505 dance as the original
 * auth.js::ensureHandle, generalized to take an already-validated base
 * candidate instead of always deriving one from an email.
 *
 * Race-safety: the SELECT below is a courtesy check to skip suffixes that
 * are obviously taken; the real guarantee is the DB's unique constraint
 * on admin_users.handle, so a 23505 on the UPDATE always falls through to
 * the next suffix rather than being treated as a hard failure.
 *
 * @param {object} supabase - Supabase client (service role — writes)
 * @param {string} adminId - admin_users.id making the claim
 * @param {string} baseSlug - already-validated/slugified base handle
 * @param {number} maxAttempts
 * @returns {Promise<{handle: string|null, error: string|null}>}
 *   error is a user-facing Arabic string on failure, null on success.
 */
export async function claimHandle(
    supabase,
    adminId,
    baseSlug,
    maxAttempts = 5,
) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = attempt === 0 ? baseSlug : `${baseSlug}${attempt + 1}`;

        const { data: existing } = await supabase
            .from("admin_users")
            .select("id")
            .ilike("handle", candidate)
            .maybeSingle();

        // Already ours (e.g. re-saving the same handle unchanged) — fine.
        if (existing && existing.id !== adminId) continue;

        const { data: updated, error: updateErr } = await supabase
            .from("admin_users")
            .update({ handle: candidate })
            .eq("id", adminId)
            .select("handle")
            .maybeSingle();

        if (!updateErr && updated) return { handle: updated.handle, error: null };

        // 23505 = unique_violation: someone else won the race for this exact
        // candidate between our check and our write. Try the next suffix.
        if (updateErr && updateErr.code !== "23505") {
            console.error("[_handle] Failed to persist handle:", updateErr);
            return { handle: null, error: "تعذر حفظ المعرّف، حاول مجدداً" };
        }
    }

    return {
        handle: null,
        error: "هذا المعرّف مستخدم بالفعل، جرّب معرّفاً آخر",
    };
}
// =============================================================================
// api/_trash.js
// Shared helpers for the soft-delete/trash/restore/purge flow (shared,
// Supabase-backed quizzes/folders/courses area only — NOT the localStorage
// "/#my-quizzes" trash, which is entirely client-side).
//
// Used by:
//   - api/college-quiz.js (quiz soft-delete via handleDeleteQuiz)
//   - api/admin.js (trash-list / trash-restore / trash-empty / trash-settings /
//     delete-folder / delete-course / move-item / rename-item actions)
//
// See docs/plans/Admin actions and deletion flow for quizzes.md and the
// trash_items/admin_settings migration
// (supabase/migrations/20260910120000_trash_items.sql) for the full design
// rationale (snapshot table instead of a deleted_at column, batch_id
// cascade grouping, lazy purge-on-access instead of a cron job, etc).
// =============================================================================

const STORAGE_BUCKET = "quiz-media";

// A quiz's media URLs live inline in its question objects
// (question.image / question.audio / question.video), as public Supabase
// Storage URLs of the form:
//   https://<project>.supabase.co/storage/v1/object/public/quiz-media/<key>
// This matches exactly how create-quiz.js's uploadMediaFile() constructs
// them (see storagePath = `${mediaType}s/${uid}/${Date.now()}-${random}.${ext}`
// then client.storage.from("quiz-media").getPublicUrl(storagePath)).
const STORAGE_URL_MARKER = `/storage/v1/object/public/${STORAGE_BUCKET}/`;

/**
 * Extracts the Supabase Storage object key from a public quiz-media URL.
 * Returns null for anything that isn't a quiz-media public URL (external
 * links, data URIs, etc. are left alone — nothing to clean up for those).
 * @param {unknown} url
 * @returns {string|null}
 */
function extractStorageKey(url) {
    if (typeof url !== "string" || !url) return null;
    const idx = url.indexOf(STORAGE_URL_MARKER);
    if (idx === -1) return null;
    const key = url.slice(idx + STORAGE_URL_MARKER.length);
    // Strip any query string (?token=... etc.) some Supabase URL variants add.
    const qIdx = key.indexOf("?");
    return qIdx === -1 ? key : key.slice(0, qIdx);
}

/**
 * Walks a quiz's stored `data` JSONB blob (the same shape validated by
 * _validateQuiz.js: { meta, stats, questions }) and collects every
 * quiz-media storage key referenced by its questions.
 * @param {object} quizData
 * @returns {string[]} deduplicated storage keys
 */
export function collectQuizMediaKeys(quizData) {
    const keys = new Set();
    const questions = Array.isArray(quizData?.questions) ? quizData.questions : [];
    for (const q of questions) {
        for (const field of ["image", "audio", "video"]) {
            const key = extractStorageKey(q?.[field]);
            if (key) keys.add(key);
        }
    }
    return Array.from(keys);
}

/**
 * Permanently deletes every quiz-media storage object referenced by a list
 * of quiz snapshots. Best-effort: logs and continues on failure rather than
 * blocking the purge of the trash_items row itself (a stray orphaned
 * storage object is a much smaller problem than a trash row that can never
 * be emptied because of a transient storage API error).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object[]} quizDataList - array of `data` JSONB blobs (one per quiz)
 */
export async function purgeQuizMedia(supabase, quizDataList) {
    const allKeys = new Set();
    for (const data of quizDataList) {
        for (const key of collectQuizMediaKeys(data)) allKeys.add(key);
    }
    if (allKeys.size === 0) return;

    try {
        const { error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove(Array.from(allKeys));
        if (error) {
            console.error("[trash] media cleanup failed:", error.message);
        }
    } catch (err) {
        console.error("[trash] media cleanup threw:", err.message || err);
    }
}

/**
 * The 3-tier authorization check already proven out in college-quiz.js's
 * handleDeleteQuiz, generalized to any item that carries `uploaded_by`/
 * `created_by` + `education_type` fields (quizzes use uploaded_by; folders/
 * courses use created_by).
 *
 * @param {{isOwner?: boolean, allowed_scopes?: string[]}} adminPayload - decoded JWT
 * @param {string|null} adminId - resolved admin_users.id of the caller
 * @param {{creatorId?: string|null, educationType?: string|null}} item
 * @returns {boolean}
 */
export function isAuthorizedForItem(adminPayload, adminId, { creatorId, educationType }) {
    if (adminPayload?.isOwner) return true;
    if (adminId && creatorId && creatorId === adminId) return true;
    if (adminPayload?.allowed_scopes && educationType) {
        if (adminPayload.allowed_scopes.includes(educationType)) return true;
    }
    return false;
}

/**
 * Resolves the caller's admin_users.id from their JWT email. Mirrors the
 * identical lookup already duplicated in college-quiz.js and upload-quiz.js.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{email?: string}} adminPayload
 * @returns {Promise<string|null>}
 */
export async function resolveAdminId(supabase, adminPayload) {
    if (!adminPayload?.email) return null;
    const { data } = await supabase
        .from("admin_users")
        .select("id")
        .eq("email", adminPayload.email)
        .maybeSingle();
    return data?.id || null;
}

/**
 * Reads the current trash_retention_days setting, falling back to the
 * column default (30) if the singleton row is somehow missing.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<number>}
 */
export async function getTrashRetentionDays(supabase) {
    const { data } = await supabase
        .from("admin_settings")
        .select("trash_retention_days")
        .eq("id", true)
        .maybeSingle();
    return data?.trash_retention_days ?? 30;
}

/**
 * Computes an expires_at ISO timestamp `retentionDays` from now.
 * @param {number} retentionDays
 * @returns {string}
 */
export function computeExpiresAt(retentionDays) {
    const ms = Date.now() + retentionDays * 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString();
}

/**
 * Lazy "vacuum on access" sweep: deletes every trash_items row past its
 * expires_at, purging associated quiz media first. There is no cron runner
 * in this project (see plan doc §2's purge-expired note), so this is called
 * opportunistically from trash-list (and could be from any other
 * trash-related action) rather than on a schedule.
 *
 * Best-effort and silent on failure — a failed sweep just means expired
 * rows stay around a little longer until the next successful call; it must
 * never block the actual request that triggered it.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function sweepExpiredTrash(supabase) {
    try {
        const nowIso = new Date().toISOString();
        const { data: expired, error } = await supabase
            .from("trash_items")
            .select("id, item_type, snapshot")
            .lt("expires_at", nowIso)
            .limit(200); // bounded batch per sweep so one huge backlog can't stall a request

        if (error || !expired || expired.length === 0) return;

        const quizSnapshots = expired
            .filter((row) => row.item_type === "quiz")
            .map((row) => row.snapshot?.data)
            .filter(Boolean);

        await purgeQuizMedia(supabase, quizSnapshots);

        const ids = expired.map((row) => row.id);
        await supabase.from("trash_items").delete().in("id", ids);
    } catch (err) {
        console.error("[trash] sweepExpiredTrash failed:", err.message || err);
    }
}

/**
 * Cascade-collects every folder/quiz nested (to any depth) under a given
 * folder or course, so a folder/course delete can trash the whole subtree
 * in one batch. Returns raw rows (not yet snapshotted) grouped by type.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{courseId?: string, folderId?: string}} scope - exactly one of these
 * @returns {Promise<{folders: object[], quizzes: object[]}>}
 */
export async function collectCascadeItems(supabase, { courseId, folderId }) {
    const folders = [];
    const quizzes = [];

    // Breadth-first walk of the folder tree under the given root (course or
    // a specific folder). folder_id/parent_folder_id are the only edges we
    // need to walk; course_id lets us grab all course-level quizzes/folders
    // in one query up front when starting from a course.
    let frontierFolderIds = [];

    if (courseId) {
        const { data: topFolders } = await supabase
            .from("folders")
            .select("id, course_id, parent_folder_id, name, created_by")
            .eq("course_id", courseId)
            .is("parent_folder_id", null);
        (topFolders || []).forEach((f) => folders.push(f));
        frontierFolderIds = (topFolders || []).map((f) => f.id);

        const { data: topQuizzes } = await supabase
            .from("quizzes")
            .select("*")
            .eq("course_id", courseId)
            .is("folder_id", null);
        (topQuizzes || []).forEach((q) => quizzes.push(q));
    } else if (folderId) {
        frontierFolderIds = [folderId];
    }

    while (frontierFolderIds.length > 0) {
        const { data: childFolders } = await supabase
            .from("folders")
            .select("id, course_id, parent_folder_id, name, created_by")
            .in("parent_folder_id", frontierFolderIds);

        const { data: childQuizzes } = await supabase
            .from("quizzes")
            .select("*")
            .in("folder_id", frontierFolderIds);

        (childQuizzes || []).forEach((q) => quizzes.push(q));

        const nextIds = (childFolders || []).map((f) => f.id);
        (childFolders || []).forEach((f) => folders.push(f));
        frontierFolderIds = nextIds;
    }

    // When starting directly from a folder (not a course), that folder's own
    // direct quizzes also need collecting — the loop above only walks
    // *descendant* folders' quizzes, starting one level down.
    if (folderId) {
        const { data: directQuizzes } = await supabase
            .from("quizzes")
            .select("*")
            .eq("folder_id", folderId);
        (directQuizzes || []).forEach((q) => quizzes.push(q));
    }

    return { folders, quizzes };
}
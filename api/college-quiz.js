// =============================================================================
// api/college-quiz.js
// Consolidated endpoint. Two unrelated small handlers merged by HTTP method
// (they never overlapped in method, so routing needs no extra param).
// Routed via vercel.json rewrites so client paths are unchanged:
//   GET    /api/colleges     -> /api/college-quiz  (list colleges)
//   DELETE /api/delete-quiz  -> /api/college-quiz  (soft-delete a quiz, admin only)
//
// ── GET (was api/colleges.js) ────────────────────────────────────────────────
// GET /api/college-quiz?education_type=University|Primary|Middle|High
// Public. Lists active colleges for the given education type.
//
// ── DELETE (was api/delete-quiz.js) ──────────────────────────────────────────
// DELETE /api/college-quiz
// Headers: Authorization: Bearer <admin token>
// Body:    { id: string }
// Authenticated endpoint — validates JWT then SOFT-deletes the quiz: writes
// a full-row snapshot into trash_items, then removes the live row. Fully
// reversible via POST /api/admin?action=trash-restore until purged (either
// explicitly via action=trash-empty, or automatically once past
// admin_settings.trash_retention_days — see api/_trash.js). Media files are
// left untouched at this stage; they're only cleaned up at purge time.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { requireAdmin, applyCors, handleAuthError } from "./_middleware.js";
import { resolveAdminId, isAuthorizedForItem, getTrashRetentionDays, computeExpiresAt } from "./_trash.js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
);

async function handleListColleges(req, res) {
    const educationType = String(req.query?.education_type || "University");
    if (!/^(University|Primary|Middle|High)$/.test(educationType)) {
        return res.status(400).json({ error: "Invalid education type" });
    }

    const { data, error } = await supabase
        .from("colleges")
        .select("id, education_type, name, year_count, terms")
        .eq("education_type", educationType)
        .eq("is_active", true)
        .order("name", { ascending: true });

    if (error) {
        console.error("[colleges] list failed:", error.message);
        return res.status(500).json({ error: "Failed to fetch colleges" });
    }

    return res.status(200).json({ colleges: data || [] });
}

async function handleDeleteQuiz(req, res) {
    let adminPayload;
    try {
        adminPayload = requireAdmin(req);
    } catch (err) {
        if (handleAuthError(err, res)) return;
        return res.status(401).json({ error: "غير مصرح" });
    }

    const { id } = req.body || {};
    if (!id) {
        return res.status(400).json({ error: "معرف الامتحان مطلوب" });
    }

    const adminId = await resolveAdminId(supabase, adminPayload);

    // The client sends the 8-char quiz meta ID (e.g. "LUREG6TI"), which lives
    // inside the JSONB `data` column at `data.meta.id` — NOT the Supabase row UUID.
    // Select * so the full row can be snapshotted into trash_items verbatim.
    const { data: quiz, error: fetchErr } = await supabase
        .from("quizzes")
        .select("*")
        .filter("data->meta->>id", "eq", id)
        .maybeSingle();

    if (fetchErr || !quiz) {
        return res.status(404).json({ error: "الامتحان غير موجود" });
    }

    const isAuthorized = isAuthorizedForItem(adminPayload, adminId, {
        creatorId: quiz.uploaded_by,
        educationType: quiz.education_type,
    });

    if (!isAuthorized) {
        return res.status(403).json({ error: "ليس لديك صلاحية لحذف هذا الامتحان" });
    }

    // Soft delete: snapshot the full row into trash_items first, then remove
    // the live row. A batch of one — see supabase/migrations/20260910120000_trash_items.sql
    // for why every trash row (solo or cascaded) always gets a batch_id.
    const retentionDays = await getTrashRetentionDays(supabase);
    const { error: trashErr } = await supabase.from("trash_items").insert({
        item_type: "quiz",
        original_id: quiz.id,
        snapshot: quiz,
        parent_folder_id: quiz.folder_id || null,
        course_id: quiz.course_id || null,
        education_type: quiz.education_type || null,
        deleted_by: adminId,
        expires_at: computeExpiresAt(retentionDays),
    });

    if (trashErr) {
        console.error("[delete-quiz] Failed to write trash snapshot:", trashErr.message);
        return res.status(500).json({ error: "فشل نقل الامتحان إلى سلة المهملات. حاول مجددًا." });
    }

    const { error: deleteErr } = await supabase
        .from("quizzes")
        .delete()
        .eq("id", quiz.id);

    if (deleteErr) {
        console.error("[delete-quiz] Supabase error:", deleteErr.message);
        // The trash row was already written, so nothing is lost — but leaving
        // the live row in place too would mean it's now visible in both
        // places at once. Roll back the trash row so we fail cleanly instead
        // of leaving a confusing duplicated state.
        await supabase.from("trash_items").delete().eq("original_id", quiz.id).eq("item_type", "quiz");
        return res.status(500).json({ error: "فشل حذف الامتحان. حاول مجددًا." });
    }

    // Decrement admin's upload count if they were the uploader
    if (quiz.uploaded_by) {
        try {
            await supabase.rpc("decrement_uploaded_quizzes", { p_admin_id: quiz.uploaded_by });
        } catch (rpcErr) {
            console.error("Failed to call decrement_uploaded_quizzes RPC:", rpcErr.message || rpcErr);
        }
    }

    return res.status(200).json({ success: true, trashed: true });
}

export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(200).end();

    if (req.method === "GET") return handleListColleges(req, res);
    if (req.method === "DELETE") return handleDeleteQuiz(req, res);

    return res.status(405).json({ error: "Method not allowed" });
}
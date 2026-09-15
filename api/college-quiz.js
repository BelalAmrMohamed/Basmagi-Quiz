// =============================================================================
// api/college-quiz.js
// Consolidated endpoint. Three unrelated small handlers merged to stay under
// Vercel Hobby's 12-function cap (see docs/plans/SEO-GEO-plan.md, Appendix A).
// Routed via vercel.json rewrites so client paths are unchanged:
//   GET      /api/colleges     -> /api/college-quiz  (list colleges)
//   DELETE   /api/delete-quiz  -> /api/college-quiz  (soft-delete a quiz, admin only)
//   GET/POST /api/reports      -> /api/college-quiz  (question reports)
//
// Dispatch is by HTTP method first, then (for GET, which is shared by
// colleges-list and reports-list) by the presence of report-only query params.
// None of the three ever collide: colleges-list only ever receives
// education_type; reports-list always sends ids/scope/status/countOnly.
//
// ── GET colleges (was api/colleges.js) ───────────────────────────────────────
// GET /api/college-quiz?education_type=University|Primary|Middle|High
// Public. Lists active colleges for the given education type.
//
// ── DELETE quiz (was api/delete-quiz.js) ─────────────────────────────────────
// DELETE /api/college-quiz
// Headers: Authorization: Bearer <admin token>
// Body:    { id: string }
// Authenticated endpoint — validates JWT then SOFT-deletes the quiz: writes
// a full-row snapshot into trash_items, then removes the live row. Fully
// reversible via POST /api/admin?action=trash-restore until purged (either
// explicitly via action=trash-empty, or automatically once past
// admin_settings.trash_retention_days — see api/_trash.js). Media files are
// left untouched at this stage; they're only cleaned up at purge time.
//
// ── GET/POST reports (was api/reports.js) ────────────────────────────────────
// GET  /api/college-quiz?ids=uuid1,uuid2 (Public for user report status lookup)
// GET  /api/college-quiz?scope=my|all&status=pending|resolved|dismissed|all[&countOnly=true] (Admin only)
// POST /api/college-quiz (action: "submit") (Public, rate limited)
// POST /api/college-quiz (action: "resolve") (Admin only)
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { requireAdmin, applyCors, handleAuthError } from "./_middleware.js";
import { resolveAdminId, isAuthorizedForItem, getTrashRetentionDays, computeExpiresAt } from "./_trash.js";
import { isRateLimited } from "./_rateLimit.js";
import { notifySearchEngines } from "./_seoNotify.js";
import { quizUrl } from "./_urls.js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
);

const reportSubmitLog = new Map();
const REPORT_SUBMIT_RATE_LIMIT = 10; // requests per minute for public submission

const isValidUUID = (uuid) =>
    typeof uuid === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid.trim());

// ── Colleges ─────────────────────────────────────────────────────────────────

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

// ── Delete quiz ──────────────────────────────────────────────────────────────

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

    // Optional SEO/GEO log signal (plan §7.2: "a delete isn't an add" —
    // IndexNow has no delete verb, so this only affects the log line; the
    // sitemap/feed/llms-full simply stop listing the URL once regenerated).
    if (!quiz.password) {
        notifySearchEngines({ remove: [quizUrl(id)], reason: "delete-quiz" });
    }

    return res.status(200).json({ success: true, trashed: true });
}

// ── Reports: GET ─────────────────────────────────────────────────────────────

async function handleGetReports(req, res) {
    const { ids, scope = "all", status = "pending", countOnly = "false" } = req.query;

    // 1. Public lookup for normal users by report IDs (from their localStorage history)
    if (ids) {
        const idArray = String(ids)
            .split(",")
            .map((s) => s.trim())
            .filter(isValidUUID);

        if (idArray.length === 0) {
            return res.status(200).json({ reports: [] });
        }

        // Limit to 100 IDs per request for safety
        const clampedIds = idArray.slice(0, 100);

        const { data, error } = await supabase
            .from("reports")
            .select("id, quiz_id, question_index, reason, status, created_at, resolved_at, quizzes ( title, path, data )")
            .in("id", clampedIds)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("[reports] User status lookup error:", error.message);
            return res.status(500).json({ error: "فشل جلب حالة البلاغات" });
        }

        return res.status(200).json({ reports: data || [] });
    }

    // 2. Admin Reports Query
    let adminPayload;
    try {
        adminPayload = requireAdmin(req);
    } catch (err) {
        if (handleAuthError(err, res)) return;
        return res.status(401).json({ error: "غير مصرح" });
    }

    let adminId = null;
    if (adminPayload?.email) {
        const { data: adminData } = await supabase
            .from("admin_users")
            .select("id")
            .eq("email", adminPayload.email)
            .maybeSingle();

        if (adminData) {
            adminId = adminData.id;
        }
    }

    // Handle "my" scope: filter by quizzes uploaded by this admin
    let myQuizIds = null;
    if (scope === "my") {
        if (!adminId) {
            return countOnly === "true"
                ? res.status(200).json({ count: 0 })
                : res.status(200).json({ reports: [] });
        }

        const { data: adminQuizzes, error: quizError } = await supabase
            .from("quizzes")
            .select("id")
            .eq("uploaded_by", adminId);

        if (quizError) {
            return res.status(500).json({ error: "فشل جلب امتحانات المشرف" });
        }

        myQuizIds = (adminQuizzes || []).map((q) => q.id);

        if (myQuizIds.length === 0) {
            return countOnly === "true"
                ? res.status(200).json({ count: 0 })
                : res.status(200).json({ reports: [] });
        }
    }

    // Build the query
    if (countOnly === "true") {
        let countQuery = supabase
            .from("reports")
            .select("*", { count: "exact", head: true });

        if (status && status !== "all") {
            countQuery = countQuery.eq("status", status);
        }
        if (myQuizIds !== null) {
            countQuery = countQuery.in("quiz_id", myQuizIds);
        }

        const { count, error } = await countQuery;
        if (error) {
            return res.status(500).json({ error: "فشل جلب عدد البلاغات" });
        }
        return res.status(200).json({ count: count || 0 });
    }

    // List reports with quiz info joined
    let query = supabase
        .from("reports")
        .select("*, quizzes ( id, title, path, data, uploaded_by )");

    if (status && status !== "all") {
        query = query.eq("status", status);
    }
    if (myQuizIds !== null) {
        query = query.in("quiz_id", myQuizIds);
    }

    query = query.order("created_at", { ascending: false });

    const { data, error } = await query;
    if (error) {
        console.error("[reports] Fetch error:", error.message);
        return res.status(500).json({ error: "فشل جلب البلاغات" });
    }

    return res.status(200).json({ reports: data || [] });
}

// ── Reports: POST ────────────────────────────────────────────────────────────

async function handlePostReports(req, res) {
    const { action, ...payload } = req.body || {};

    // 1. Submit Report (Public)
    if (action === "submit") {
        const ip =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.socket?.remoteAddress ||
            "unknown";

        if (isRateLimited(ip, REPORT_SUBMIT_RATE_LIMIT, reportSubmitLog)) {
            return res.status(429).json({ error: "طلبات كثيرة جدًا، حاول لاحقًا" });
        }

        const { quiz_id, question_index, reason } = payload;

        if (!quiz_id || !isValidUUID(quiz_id)) {
            return res.status(400).json({ error: "معرف الامتحان غير صالح" });
        }
        if (typeof question_index !== "number" || question_index < 0) {
            return res.status(400).json({ error: "رقم السؤال غير صالح" });
        }
        if (!reason || typeof reason !== "string" || reason.trim() === "") {
            return res.status(400).json({ error: "سبب البلاغ مطلوب" });
        }

        const { data, error } = await supabase
            .from("reports")
            .insert({
                quiz_id,
                question_index,
                reason: reason.trim(),
                status: "pending",
            })
            .select("id, quiz_id, question_index, reason, status, created_at")
            .single();

        if (error) {
            console.error("[reports] Insert error:", error.message);
            return res.status(500).json({ error: "فشل تقديم البلاغ. حاول مجددًا." });
        }

        return res.status(201).json({ success: true, report: data });
    }

    // 2. Resolve Report (Admin Only)
    if (action === "resolve") {
        let adminPayload;
        try {
            adminPayload = requireAdmin(req);
        } catch (err) {
            if (handleAuthError(err, res)) return;
            return res.status(401).json({ error: "غير مصرح" });
        }

        const { report_id, status } = payload;

        if (!report_id || !isValidUUID(report_id)) {
            return res.status(400).json({ error: "معرف البلاغ غير صالح" });
        }
        if (status !== "resolved" && status !== "dismissed") {
            return res.status(400).json({ error: "حالة غير صالحة" });
        }

        // Fetch admin ID
        let adminId = null;
        if (adminPayload?.email) {
            const { data: adminData } = await supabase
                .from("admin_users")
                .select("id")
                .eq("email", adminPayload.email)
                .maybeSingle();

            if (adminData) {
                adminId = adminData.id;
            }
        }

        const { error } = await supabase
            .from("reports")
            .update({
                status,
                resolved_by_admin_id: adminId,
                resolved_at: new Date().toISOString(),
            })
            .eq("id", report_id);

        if (error) {
            console.error("[reports] Update error:", error.message);
            return res.status(500).json({ error: "فشل تحديث حالة البلاغ." });
        }

        return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "إجراء غير صالح" });
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
// GET is shared by colleges-list and reports-list. They're told apart by
// query shape: reports-list always sends one of ids/scope/status/countOnly;
// colleges-list never does (it only ever sends education_type, if anything).

function isReportsGet(req) {
    const q = req.query || {};
    return (
        q.ids !== undefined ||
        q.scope !== undefined ||
        q.status !== undefined ||
        q.countOnly !== undefined
    );
}

export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(200).end();

    if (req.method === "GET") {
        return isReportsGet(req) ? handleGetReports(req, res) : handleListColleges(req, res);
    }
    if (req.method === "DELETE") return handleDeleteQuiz(req, res);
    if (req.method === "POST") return handlePostReports(req, res);

    return res.status(405).json({ error: "Method not allowed" });
}
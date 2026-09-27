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
import { requireAdmin, requireUserProfile, applyCors, handleAuthError } from "./_middleware.js";
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
const lessonCommentSubmitLog = new Map();
const LESSON_COMMENT_RATE_LIMIT = 8;
const lessonCommentReactionLog = new Map();
const LESSON_COMMENT_REACTION_RATE_LIMIT = 20;
const lessonCommentReportLog = new Map();
const LESSON_COMMENT_REPORT_RATE_LIMIT = 5;
const lessonCommentWriteLog = new Map(); // edit/delete
const LESSON_COMMENT_WRITE_RATE_LIMIT = 15;

const LESSON_COMMENT_PAGE_SIZE = 20;
const LESSON_COMMENT_SORTS = new Set(["newest", "most_reacted", "most_discussed"]);

function clientIp(req) {
    return (
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        "unknown"
    );
}

// Publicly displayed author label. There is no student login/display name
// (see 20260926120000_lesson_comments_community.sql) — commenters are shown
// as "Student" or, when several distinct profiles appear in one thread,
// "Student #n" assigned by first-appearance order within that thread so the
// same person keeps the same label across a render, without ever exposing
// the actual profile id to the client.
function buildAuthorLabels(rows) {
    const order = [];
    const seen = new Map();
    for (const row of rows) {
        const key = row.user_profile_id || `anon:${row.id}`; // no profile = always its own anonymous label
        if (!seen.has(key)) {
            seen.set(key, order.length);
            order.push(key);
        }
    }
    return (row) => {
        const key = row.user_profile_id || `anon:${row.id}`;
        const idx = seen.get(key);
        return order.length > 1 ? `Student #${idx + 1}` : "Student";
    };
}

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

// Shape a raw lesson_comments row (+ its reaction rows) for public output.
// Soft-deleted comments keep their id/parent_id/reply-count/reactions so the
// thread structure survives, but their body/author label are replaced with
// a tombstone — never returned to the client.
function shapePublicComment(row, { reactionCounts, myReactionIds, authorLabelFor, replyCounts }) {
    const isDeleted = !!row.deleted_at;
    return {
        id: row.id,
        parent_id: row.parent_id,
        created_at: row.created_at,
        edited_at: row.edited_at,
        deleted: isDeleted,
        body: isDeleted ? null : row.body,
        author: isDeleted ? null : authorLabelFor(row),
        is_mine: !isDeleted && !!row.__isMine,
        reaction_count: reactionCounts.get(row.id) || 0,
        reacted_by_me: myReactionIds ? myReactionIds.has(row.id) : false,
        reply_count: replyCounts.get(row.id) || 0,
    };
}

async function fetchReactionCounts(commentIds) {
    const counts = new Map();
    if (!commentIds.length) return counts;
    const { data, error } = await supabase
        .from("lesson_comment_reactions")
        .select("comment_id")
        .in("comment_id", commentIds);
    if (error) return counts; // best-effort — a count failure shouldn't break the list
    for (const row of data || []) counts.set(row.comment_id, (counts.get(row.comment_id) || 0) + 1);
    return counts;
}

async function fetchMyReactionIds(commentIds, profileId) {
    if (!profileId || !commentIds.length) return new Set();
    const { data, error } = await supabase
        .from("lesson_comment_reactions")
        .select("comment_id")
        .eq("user_profile_id", profileId)
        .in("comment_id", commentIds);
    if (error) return new Set();
    return new Set((data || []).map((r) => r.comment_id));
}

// ── Lesson comments: GET (public thread) ────────────────────────────────────

async function handleGetLessonCommentsPublic(req, res) {
    const lessonId = req.query?.lessonId;
    if (!isValidUUID(lessonId)) return res.status(400).json({ error: "معرف الدرس غير صالح" });

    const sort = LESSON_COMMENT_SORTS.has(req.query?.sort) ? req.query.sort : "newest";
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const offset = (page - 1) * LESSON_COMMENT_PAGE_SIZE;

    // Best-effort caller identity — used only to mark "is_mine" / "reacted_by_me".
    // Never required: anonymous viewers can still read the public thread.
    let profileId = null;
    try {
        profileId = requireUserProfile(req).profileId;
    } catch (_) {
        /* anonymous read is fine */
    }

    // Permalink: return one comment (plus its parent for context, if it's a
    // reply) regardless of sort/page, so a shared link always resolves.
    const permalinkId = req.query?.commentId;
    if (permalinkId) {
        if (!isValidUUID(permalinkId)) return res.status(400).json({ error: "معرف التعليق غير صالح" });
        const { data: target, error: targetErr } = await supabase
            .from("lesson_comments")
            .select("id, body, created_at, edited_at, deleted_at, parent_id, user_profile_id, lesson_id, status")
            .eq("id", permalinkId)
            .eq("lesson_id", lessonId)
            .maybeSingle();
        if (targetErr || !target) return res.status(404).json({ error: "التعليق غير موجود" });
        // Only a resolved, non-deleted comment is linkable — never leak a
        // pending or removed one just because someone has its id/URL.
        if (target.deleted_at || target.status !== "resolved") return res.status(404).json({ error: "التعليق غير متاح" });

        let parent = null;
        if (target.parent_id) {
            const { data: parentRow } = await supabase
                .from("lesson_comments")
                .select("id, body, created_at, edited_at, deleted_at, parent_id, user_profile_id")
                .eq("id", target.parent_id)
                .maybeSingle();
            parent = parentRow || null;
        }
        const ids = [target.id, ...(parent ? [parent.id] : [])];
        const reactionCounts = await fetchReactionCounts(ids);
        const myReactionIds = await fetchMyReactionIds(ids, profileId);
        const replyCounts = new Map(); // not needed for a single-comment permalink view
        const authorLabelFor = buildAuthorLabels(parent ? [parent, target] : [target]);
        target.__isMine = profileId && target.user_profile_id === profileId;
        const shapedTarget = shapePublicComment(target, { reactionCounts, myReactionIds, authorLabelFor, replyCounts });
        const shapedParent = parent
            ? shapePublicComment({ ...parent, __isMine: profileId && parent.user_profile_id === profileId }, { reactionCounts, myReactionIds, authorLabelFor, replyCounts })
            : null;
        return res.status(200).json({ comment: shapedTarget, parent: shapedParent });
    }

    // Top-level, resolved, non-deleted comments only — replies are nested
    // under each and fetched separately (bounded by nesting depth of 1).
    let topQuery = supabase
        .from("lesson_comments")
        .select("id, body, created_at, edited_at, deleted_at, parent_id, user_profile_id", { count: "exact" })
        .eq("lesson_id", lessonId)
        .eq("status", "resolved")
        .is("parent_id", null);

    if (sort === "newest") {
        topQuery = topQuery.order("created_at", { ascending: false });
    } else {
        // most_reacted / most_discussed need reaction/reply counts, which
        // aren't columns on lesson_comments — sort in JS after fetching a
        // bounded window (newest-first cap) rather than a heavier SQL join,
        // consistent with this table's current no-ORM raw-query style.
        topQuery = topQuery.order("created_at", { ascending: false }).limit(500);
    }
    if (sort === "newest") {
        topQuery = topQuery.range(offset, offset + LESSON_COMMENT_PAGE_SIZE - 1);
    }

    const { data: topRows, error: topErr, count } = await topQuery;
    if (topErr) return res.status(500).json({ error: "فشل جلب النقاش" });

    let pageTopRows = topRows || [];
    let totalCount = count || 0;

    if (sort !== "newest") {
        const topIds = pageTopRows.map((r) => r.id);
        const [reactionCounts, replyCountsRaw] = await Promise.all([
            fetchReactionCounts(topIds),
            (async () => {
                if (!topIds.length) return new Map();
                const { data } = await supabase.from("lesson_comments").select("parent_id").in("parent_id", topIds).eq("status", "resolved").is("deleted_at", null);
                const m = new Map();
                for (const r of data || []) m.set(r.parent_id, (m.get(r.parent_id) || 0) + 1);
                return m;
            })(),
        ]);
        pageTopRows = [...pageTopRows].sort((a, b) => {
            const av = sort === "most_reacted" ? reactionCounts.get(a.id) || 0 : replyCountsRaw.get(a.id) || 0;
            const bv = sort === "most_reacted" ? reactionCounts.get(b.id) || 0 : replyCountsRaw.get(b.id) || 0;
            if (bv !== av) return bv - av;
            return new Date(b.created_at) - new Date(a.created_at);
        });
        totalCount = pageTopRows.length;
        pageTopRows = pageTopRows.slice(offset, offset + LESSON_COMMENT_PAGE_SIZE);
    }

    const topIds = pageTopRows.map((r) => r.id);
    let replyRows = [];
    if (topIds.length) {
        const { data, error: replyErr } = await supabase
            .from("lesson_comments")
            .select("id, body, created_at, edited_at, deleted_at, parent_id, user_profile_id")
            .in("parent_id", topIds)
            .eq("status", "resolved")
            .order("created_at", { ascending: true });
        if (replyErr) return res.status(500).json({ error: "فشل جلب الردود" });
        replyRows = data || [];
    }

    const allRows = [...pageTopRows, ...replyRows];
    const allIds = allRows.map((r) => r.id);
    const [reactionCounts, myReactionIds] = await Promise.all([
        fetchReactionCounts(allIds),
        fetchMyReactionIds(allIds, profileId),
    ]);
    const replyCounts = new Map();
    for (const reply of replyRows) replyCounts.set(reply.parent_id, (replyCounts.get(reply.parent_id) || 0) + 1);

    const authorLabelFor = buildAuthorLabels(allRows);
    for (const row of allRows) row.__isMine = profileId && row.user_profile_id === profileId;

    const shapedTop = pageTopRows.map((row) => ({
        ...shapePublicComment(row, { reactionCounts, myReactionIds, authorLabelFor, replyCounts }),
        replies: replyRows
            .filter((r) => r.parent_id === row.id)
            .map((r) => shapePublicComment(r, { reactionCounts, myReactionIds, authorLabelFor, replyCounts })),
    }));

    return res.status(200).json({
        comments: shapedTop,
        page,
        pageSize: LESSON_COMMENT_PAGE_SIZE,
        totalCount,
        hasMore: offset + shapedTop.length < totalCount,
        sort,
    });
}

// ── Lesson comments: GET (admin moderation queue) ───────────────────────────

async function handleGetLessonCommentsAdmin(req, res) {
    try {
        requireAdmin(req);
    } catch (err) {
        if (handleAuthError(err, res)) return;
        return res.status(401).json({ error: "غير مصرح" });
    }
    const requestedStatus = ["pending", "resolved", "dismissed", "all"].includes(req.query?.status) ? req.query.status : "pending";
    let query = supabase
        .from("lesson_comments")
        .select("id, body, created_at, status, lesson_id, parent_id, lessons ( title )")
        .order("created_at", { ascending: false });
    if (requestedStatus !== "all") query = query.eq("status", requestedStatus);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: "فشل جلب أسئلة الدروس" });

    const rows = data || [];
    // Replies show their parent's snippet so moderators aren't reviewing a
    // reply with zero context (see plan decision: replies reuse the exact
    // same pending/resolve queue, no separate admin UI).
    const parentIds = [...new Set(rows.filter((r) => r.parent_id).map((r) => r.parent_id))];
    let parentSnippets = new Map();
    if (parentIds.length) {
        const { data: parents } = await supabase.from("lesson_comments").select("id, body").in("id", parentIds);
        parentSnippets = new Map((parents || []).map((p) => [p.id, p.body.slice(0, 140)]));
    }
    const comments = rows.map((r) => ({
        ...r,
        is_reply: !!r.parent_id,
        parent_snippet: r.parent_id ? parentSnippets.get(r.parent_id) || null : null,
    }));
    return res.status(200).json({ comments });
}

// ── Lesson comments: dispatch ────────────────────────────────────────────────

async function handleLessonComments(req, res) {
    if (req.method === "GET") {
        if (req.query?.lessonComments === "admin") return handleGetLessonCommentsAdmin(req, res);
        return handleGetLessonCommentsPublic(req, res);
    }

    const { action, lesson_id: lessonId, body, comment_id: commentId, parent_id: parentId, status, reason } = req.body || {};

    // 1. Submit a top-level comment or a reply (public, rate-limited).
    if (action === "submit-lesson-comment") {
        const ip = clientIp(req);
        if (isRateLimited(ip, LESSON_COMMENT_RATE_LIMIT, lessonCommentSubmitLog)) return res.status(429).json({ error: "طلبات كثيرة جدًا، حاول لاحقًا" });
        if (!isValidUUID(lessonId) || typeof body !== "string" || !body.trim() || body.trim().length > 2000) {
            return res.status(400).json({ error: "اكتب سؤالاً صالحاً لا يزيد عن 2000 حرف." });
        }

        let profileId = null;
        try {
            profileId = requireUserProfile(req).profileId;
        } catch (_) {
            /* allow anonymous submission — pre-Phase-4 behavior, ownership is simply absent */
        }

        let resolvedParentId = null;
        if (parentId !== undefined && parentId !== null) {
            if (!isValidUUID(parentId)) return res.status(400).json({ error: "معرف التعليق الأصلي غير صالح" });
            const { data: parent, error: parentErr } = await supabase
                .from("lesson_comments")
                .select("id, lesson_id, parent_id, deleted_at")
                .eq("id", parentId)
                .maybeSingle();
            if (parentErr || !parent || parent.deleted_at) return res.status(400).json({ error: "التعليق الأصلي غير موجود" });
            if (parent.lesson_id !== lessonId) return res.status(400).json({ error: "لا يمكن الرد على تعليق من درس آخر" });
            if (parent.parent_id) return res.status(400).json({ error: "لا يمكن الرد على رد" }); // one level of nesting only
            resolvedParentId = parent.id;
        }

        const { data, error } = await supabase
            .from("lesson_comments")
            .insert({
                lesson_id: lessonId,
                body: body.trim(),
                parent_id: resolvedParentId,
                user_profile_id: profileId,
            })
            .select("id, created_at, status, parent_id")
            .single();
        if (error) return res.status(500).json({ error: "تعذر إرسال السؤال." });
        return res.status(201).json({ comment: data });
    }

    // 2. Toggle a reaction (public, requires a verified device profile).
    if (action === "react-lesson-comment") {
        const ip = clientIp(req);
        if (isRateLimited(ip, LESSON_COMMENT_REACTION_RATE_LIMIT, lessonCommentReactionLog)) return res.status(429).json({ error: "طلبات كثيرة جدًا، حاول لاحقًا" });
        let profileId;
        try {
            profileId = requireUserProfile(req).profileId;
        } catch (err) {
            if (handleAuthError(err, res)) return;
            return res.status(401).json({ error: "غير مصرح" });
        }
        if (!isValidUUID(commentId)) return res.status(400).json({ error: "معرف التعليق غير صالح" });

        const { data: comment } = await supabase.from("lesson_comments").select("id, status, deleted_at").eq("id", commentId).maybeSingle();
        if (!comment || comment.status !== "resolved" || comment.deleted_at) return res.status(404).json({ error: "التعليق غير متاح" });

        const { data: existing } = await supabase
            .from("lesson_comment_reactions")
            .select("id")
            .eq("comment_id", commentId)
            .eq("user_profile_id", profileId)
            .maybeSingle();

        if (existing) {
            const { error: delErr } = await supabase.from("lesson_comment_reactions").delete().eq("id", existing.id);
            if (delErr) return res.status(500).json({ error: "تعذر تحديث التفاعل." });
            return res.status(200).json({ success: true, reacted: false });
        }
        const { error: insErr } = await supabase.from("lesson_comment_reactions").insert({ comment_id: commentId, user_profile_id: profileId });
        if (insErr) {
            // Unique constraint race (double-click) — treat as already-reacted, not an error.
            if (insErr.code === "23505") return res.status(200).json({ success: true, reacted: true });
            return res.status(500).json({ error: "تعذر تحديث التفاعل." });
        }
        return res.status(200).json({ success: true, reacted: true });
    }

    // 3. Edit own comment (server-verified ownership).
    if (action === "edit-lesson-comment") {
        const ip = clientIp(req);
        if (isRateLimited(ip, LESSON_COMMENT_WRITE_RATE_LIMIT, lessonCommentWriteLog)) return res.status(429).json({ error: "طلبات كثيرة جدًا، حاول لاحقًا" });
        let profileId;
        try {
            profileId = requireUserProfile(req).profileId;
        } catch (err) {
            if (handleAuthError(err, res)) return;
            return res.status(401).json({ error: "غير مصرح" });
        }
        if (!isValidUUID(commentId) || typeof body !== "string" || !body.trim() || body.trim().length > 2000) {
            return res.status(400).json({ error: "نص غير صالح" });
        }
        const { data: comment } = await supabase.from("lesson_comments").select("id, user_profile_id, deleted_at").eq("id", commentId).maybeSingle();
        if (!comment || comment.deleted_at) return res.status(404).json({ error: "التعليق غير موجود" });
        if (!comment.user_profile_id || comment.user_profile_id !== profileId) return res.status(403).json({ error: "لا يمكنك تعديل تعليق غيرك" });

        const { error } = await supabase
            .from("lesson_comments")
            .update({ body: body.trim(), edited_at: new Date().toISOString() })
            .eq("id", commentId);
        if (error) return res.status(500).json({ error: "تعذر تعديل التعليق." });
        return res.status(200).json({ success: true });
    }

    // 4. Delete own comment (soft delete, server-verified ownership) — or
    //    admin moderation delete, reusing the same action with an admin token.
    if (action === "delete-lesson-comment") {
        const ip = clientIp(req);
        if (isRateLimited(ip, LESSON_COMMENT_WRITE_RATE_LIMIT, lessonCommentWriteLog)) return res.status(429).json({ error: "طلبات كثيرة جدًا، حاول لاحقًا" });
        if (!isValidUUID(commentId)) return res.status(400).json({ error: "معرف التعليق غير صالح" });

        let isOwner = false;
        try {
            const { profileId } = requireUserProfile(req);
            const { data: comment } = await supabase.from("lesson_comments").select("user_profile_id").eq("id", commentId).maybeSingle();
            isOwner = !!comment?.user_profile_id && comment.user_profile_id === profileId;
        } catch (_) {
            /* not a user-profile token — fall through to admin check */
        }

        if (!isOwner) {
            try {
                requireAdmin(req);
            } catch (err) {
                if (handleAuthError(err, res)) return;
                return res.status(403).json({ error: "لا يمكنك حذف تعليق غيرك" });
            }
        }

        const { error } = await supabase.from("lesson_comments").update({ deleted_at: new Date().toISOString() }).eq("id", commentId);
        if (error) return res.status(500).json({ error: "تعذر حذف التعليق." });
        return res.status(200).json({ success: true });
    }

    // 5. Report a comment (public, rate-limited).
    if (action === "report-lesson-comment") {
        const ip = clientIp(req);
        if (isRateLimited(ip, LESSON_COMMENT_REPORT_RATE_LIMIT, lessonCommentReportLog)) return res.status(429).json({ error: "طلبات كثيرة جدًا، حاول لاحقًا" });
        if (!isValidUUID(commentId)) return res.status(400).json({ error: "معرف التعليق غير صالح" });
        if (!reason || typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) {
            return res.status(400).json({ error: "سبب البلاغ مطلوب" });
        }
        const { data: comment } = await supabase.from("lesson_comments").select("id").eq("id", commentId).maybeSingle();
        if (!comment) return res.status(404).json({ error: "التعليق غير موجود" });

        let profileId = null;
        try {
            profileId = requireUserProfile(req).profileId;
        } catch (_) {
            /* anonymous reports allowed */
        }

        const { error } = await supabase.from("lesson_comment_reports").insert({ comment_id: commentId, user_profile_id: profileId, reason: reason.trim() });
        if (error) return res.status(500).json({ error: "تعذر إرسال البلاغ." });
        return res.status(201).json({ success: true });
    }

    // 6. Resolve/dismiss a comment — top-level or reply, same queue (admin only).
    if (action === "resolve-lesson-comment") {
        try {
            requireAdmin(req);
        } catch (err) {
            if (handleAuthError(err, res)) return;
            return res.status(401).json({ error: "غير مصرح" });
        }
        if (!isValidUUID(commentId) || !["resolved", "dismissed"].includes(status)) return res.status(400).json({ error: "طلب غير صالح" });
        const { error } = await supabase.from("lesson_comments").update({ status, resolved_at: new Date().toISOString() }).eq("id", commentId);
        if (error) return res.status(500).json({ error: "تعذر تحديث السؤال." });
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

    // Both the public reader (`true`) and the moderation queue (`admin`)
    // use this handler.  Checking only `true` let the admin GET fall through
    // to the unrelated reports listing because it also carries `status`.
    if (req.query?.lessonComments) return handleLessonComments(req, res);

    if (req.method === "GET") {
        return isReportsGet(req) ? handleGetReports(req, res) : handleListColleges(req, res);
    }
    if (req.method === "DELETE") return handleDeleteQuiz(req, res);
    if (req.method === "POST") {
        const lessonCommentActions = new Set([
            "submit-lesson-comment",
            "react-lesson-comment",
            "edit-lesson-comment",
            "delete-lesson-comment",
            "report-lesson-comment",
            "resolve-lesson-comment",
        ]);
        return lessonCommentActions.has(req.body?.action)
            ? handleLessonComments(req, res)
            : handlePostReports(req, res);
    }

    return res.status(405).json({ error: "Method not allowed" });
}
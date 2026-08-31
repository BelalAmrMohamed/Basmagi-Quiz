// =============================================================================
// api/reports.js
// Unified endpoint for question reports.
//
// GET /api/reports?ids=uuid1,uuid2 (Public for user report status lookup)
// GET /api/reports?scope=my|all&status=pending|resolved|dismissed|all[&countOnly=true] (Admin only)
// POST /api/reports (action: "submit") (Public, rate limited)
// POST /api/reports (action: "resolve") (Admin only)
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { applyCors, requireAdmin, handleAuthError } from "./_middleware.js";
import { isRateLimited } from "./_rateLimit.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const reportSubmitLog = new Map();
const REPORT_SUBMIT_RATE_LIMIT = 10; // requests per minute for public submission

const isValidUUID = (uuid) =>
  typeof uuid === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid.trim());

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET: Reports ────────────────────────────────────────────────────────────
  if (req.method === "GET") {
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
        return res.status(500).json({ error: "فشل جلب اختبارات المشرف" });
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

  // ── POST: Submit or Resolve ────────────────────────────────────────────────
  if (req.method === "POST") {
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
        return res.status(400).json({ error: "معرف الاختبار غير صالح" });
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

  return res.status(405).json({ error: "Method not allowed" });
}

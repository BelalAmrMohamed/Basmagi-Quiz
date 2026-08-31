// =============================================================================
// api/reports.js
// Unified endpoint for question reports to save Vercel serverless function count.
//
// GET /api/reports?status=pending[&countOnly=true] (Admin only)
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
const REPORT_SUBMIT_RATE_LIMIT = 5; // requests per minute for public submission

const isValidUUID = (uuid) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET: List Reports (Admin Only) ──────────────────────────────────────────
  if (req.method === "GET") {
    let adminPayload;
    try {
      adminPayload = requireAdmin(req);
    } catch (err) {
      if (handleAuthError(err, res)) return;
      return res.status(401).json({ error: "غير مصرح" });
    }

    const { status = "pending", countOnly = "false" } = req.query;

    if (countOnly === "true") {
      const { count, error } = await supabase
        .from("reports")
        .select("*", { count: "exact", head: true })
        .eq("status", status);

      if (error) {
        return res.status(500).json({ error: "فشل جلب عدد البلاغات" });
      }
      return res.status(200).json({ count });
    }

    // List reports with quiz info joined
    const { data, error } = await supabase
      .from("reports")
      .select("*, quizzes ( title, path )")
      .eq("status", status)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: "فشل جلب البلاغات" });
    }

    return res.status(200).json({ reports: data });
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

      const { error } = await supabase
        .from("reports")
        .insert({
          quiz_id,
          question_index,
          reason: reason.trim(),
          status: "pending",
        });

      if (error) {
        console.error("[reports] Insert error:", error.message);
        return res.status(500).json({ error: "فشل تقديم البلاغ. حاول مجددًا." });
      }

      return res.status(201).json({ success: true });
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

      if (!report_id || typeof report_id !== "number") {
        return res.status(400).json({ error: "معرف البلاغ مطلوب" });
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

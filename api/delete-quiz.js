// =============================================================================
// api/delete-quiz.js
// Authenticated endpoint — validates JWT then deletes quiz from Supabase.
//
// DELETE /api/delete-quiz
// Headers: Authorization: Bearer <token>
// Body:    { id: string }
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { requireAdmin, applyCors, handleAuthError } from "./_middleware.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "DELETE") return res.status(405).end();

  let adminPayload;
  try {
    adminPayload = requireAdmin(req);
  } catch (err) {
    if (handleAuthError(err, res)) return;
    return res.status(401).json({ error: "غير مصرح" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: "معرف الاختبار مطلوب" });
  }

  // Fetch admin profile to get ID
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

  // The client sends the 8-char quiz meta ID (e.g. "LUREG6TI"), which lives
  // inside the JSONB `data` column at `data.meta.id` — NOT the Supabase row UUID.
  const { data: quiz, error: fetchErr } = await supabase
    .from("quizzes")
    .select("id, uploaded_by, education_type")
    .filter("data->meta->>id", "eq", id)
    .maybeSingle();

  if (fetchErr || !quiz) {
    return res.status(404).json({ error: "الاختبار غير موجود" });
  }

  // Authorization checks
  let isAuthorized = adminPayload.isOwner; // 1. Is Super Owner?

  if (!isAuthorized && adminId && quiz.uploaded_by === adminId) {
    isAuthorized = true; // 2. Is original uploader? (Option B)
  }

  if (!isAuthorized && adminPayload.allowed_scopes && quiz.education_type) {
    if (adminPayload.allowed_scopes.includes(quiz.education_type)) {
      isAuthorized = true; // 3. Is within allowed domains? (Option C)
    }
  }

  if (!isAuthorized) {
    return res.status(403).json({ error: "ليس لديك صلاحية لحذف هذا الاختبار" });
  }

  const { error: deleteErr } = await supabase
    .from("quizzes")
    .delete()
    .eq("id", quiz.id);

  if (deleteErr) {
    console.error("[delete-quiz] Supabase error:", deleteErr.message);
    return res.status(500).json({ error: "فشل حذف الاختبار. حاول مجددًا." });
  }

  // Decrement admin's upload count if they were the uploader
  if (quiz.uploaded_by) {
    try {
      await supabase.rpc("decrement_uploaded_quizzes", { p_admin_id: quiz.uploaded_by });
    } catch (rpcErr) {
      console.error("Failed to call decrement_uploaded_quizzes RPC:", rpcErr.message || rpcErr);
    }
  }

  return res.status(200).json({ success: true });
}

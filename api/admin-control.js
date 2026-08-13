// =============================================================================
// api/admin-control.js
// Owner-only endpoint for managing platform admins.
//
// GET  → returns { admins, platformStats }
// POST → actions: add_admin | remove_admin
//
// NOTE: The "change_code" / access-code actions were removed in v6.1.
// =============================================================================
import { applyCors, requireAdmin, handleAuthError } from "./_middleware.js";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();

  let payload;
  try {
    payload = requireAdmin(req);
  } catch (err) {
    if (handleAuthError(err, res)) return;
    return res.status(500).json({ error: "Internal server error" });
  }

  // Only owners can access this API.
  if (!payload.isOwner) {
    return res.status(403).json({ error: "You do not have owner privileges" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { method } = req;

  // ── GET: list admins + platform stats ────────────────────────────────────────
  if (method === "GET") {
    const { data: admins, error: adminsError } = await supabase
      .from("admin_users")
      .select("id, email, created_at, added_by, allowed_scopes")
      .order("created_at", { ascending: false });

    if (adminsError) {
      return res.status(500).json({ error: "Failed to fetch data" });
    }

    // Platform stats — quiz & category counts from the quizzes table.
    const { count: quizCount } = await supabase
      .from("quizzes")
      .select("id", { count: "exact", head: true });

    const { data: catData } = await supabase
      .from("quizzes")
      .select("category");

    const uniqueCategories = new Set((catData || []).map((r) => r.category));

    return res.status(200).json({
      admins: admins || [],
      platformStats: {
        totalQuizzes: quizCount ?? 0,
        totalCategories: uniqueCategories.size,
        totalAdmins: (admins || []).length,
        ownerEmail: payload.email,
      },
    });
  }

  // ── POST: admin management actions ───────────────────────────────────────────
  if (method === "POST") {
    const { action } = req.body;

    if (action === "add_admin") {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });

      const { data, error } = await supabase
        .from("admin_users")
        .insert([{ email: email.toLowerCase(), added_by: payload.email }])
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          return res.status(400).json({ error: "Admin already exists" });
        }
        return res.status(500).json({ error: "Failed to add admin" });
      }

      return res.status(200).json({ admin: data });
    }

    if (action === "remove_admin") {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });

      const { error } = await supabase
        .from("admin_users")
        .delete()
        .eq("email", email.toLowerCase());

      if (error) {
        return res.status(500).json({ error: "Failed to remove admin" });
      }

      return res.status(200).json({ success: true });
    }

    if (action === "update_scopes") {
      const { email, scopes } = req.body;
      if (!email || !Array.isArray(scopes)) {
        return res.status(400).json({ error: "Email and valid scopes array are required" });
      }

      const { data, error } = await supabase
        .from("admin_users")
        .update({ allowed_scopes: scopes })
        .eq("email", email.toLowerCase())
        .select("allowed_scopes")
        .single();

      if (error) {
        return res.status(500).json({ error: "Failed to update admin scopes" });
      }

      return res.status(200).json({ success: true, allowed_scopes: data.allowed_scopes });
    }

    return res.status(400).json({ error: "Invalid action" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

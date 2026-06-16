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

  // Only owners can access this API
  if (!payload.isOwner) {
    return res.status(403).json({ error: "You do not have owner privileges" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { method } = req;

  if (method === "GET") {
    // 1. Get all admins
    const { data: admins, error: adminsError } = await supabase
      .from("admin_users")
      .select("id, email, created_at, added_by")
      .order("created_at", { ascending: false });

    // 2. Get current access code setting
    const { data: setting, error: settingError } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ADMIN_SECRET")
      .single();

    if (adminsError || settingError) {
      return res.status(500).json({ error: "Failed to fetch data" });
    }

    return res.status(200).json({
      admins: admins || [],
      accessCode: setting?.value || "Not set"
    });
  }

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
        if (error.code === '23505') { // Unique violation
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

    if (action === "change_code") {
      const { newCode } = req.body;
      if (!newCode || newCode.length < 4) {
        return res.status(400).json({ error: "Access code must be at least 4 characters long" });
      }

      const { error } = await supabase
        .from("app_settings")
        .upsert({
          key: "ADMIN_SECRET",
          value: newCode,
          updated_by: payload.email,
          updated_at: new Date().toISOString()
        });

      if (error) {
        return res.status(500).json({ error: "Failed to change access code" });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Invalid action" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

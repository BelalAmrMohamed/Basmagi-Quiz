// =============================================================================
// api/auth.js
// Admin sign-in endpoint — Supabase Token (email/OAuth) only.
//
// POST /api/auth
// Body:         { supabaseToken: string }
// Success 200:  { token: string }
// Failure 401:  { error: string }
// Failure 403:  { error: string }  (authenticated but not an admin)
//
// NOTE: The legacy "adminId" / access-code path was removed in v6.1.
//       Only Admin-Email-Only OAuth authentication is supported.
// =============================================================================

import jwt from "jsonwebtoken";
import { applyCors } from "./_middleware.js";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { supabaseToken } = req.body || {};

  if (!supabaseToken) {
    return res.status(400).json({
      error:
        "يرجى تسجيل الدخول باستخدام البريد الإلكتروني أو Google/GitHub.",
    });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Verify the Supabase access token and get the authenticated user.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(supabaseToken);

  if (error || !user || !user.email) {
    return res.status(401).json({ error: "فشل التحقق من الحساب" });
  }

  const userEmail = user.email.toLowerCase();

  // Check if the user is an owner (env-configured emails).
  const ownerEmails = (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e);

  let isAuthorized = ownerEmails.includes(userEmail);

  // If not owner, check if the user is an admin in the database.
  if (!isAuthorized) {
    const { data: adminData } = await supabase
      .from("admin_users")
      .select("email")
      .eq("email", userEmail)
      .single();

    if (adminData) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    return res
      .status(403)
      .json({ error: "هذا الحساب ليس لديه صلاحيات المشرف" });
  }

  // Issue a short-lived JWT.
  const token = jwt.sign(
    {
      role: "admin",
      email: userEmail,
      isOwner: ownerEmails.includes(userEmail),
    },
    process.env.JWT_SECRET,
    { expiresIn: "4h", algorithm: "HS256" }
  );

  return res.status(200).json({ token });
}

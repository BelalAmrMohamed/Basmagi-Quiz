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

/**
 * Generates a URL-safe default handle from an admin's email local-part
 * (e.g. "belalamrofficial@gmail.com" -> "belalamrofficial"), resolves any
 * collision by appending a numeric suffix, persists it on the admin_users
 * row, and returns the handle that ended up stored.
 *
 * Best-effort: if anything here fails (race with another request, unique
 * constraint still conflicting, etc.) we log and return null rather than
 * failing the whole sign-in — a missing handle just means the "shareable
 * link" UI stays hidden, which is not worth blocking login over.
 *
 * @param {object} supabase - initialized Supabase client (service role)
 * @param {string} adminId - admin_users.id to update
 * @param {string} email - lowercased email to derive the slug from
 * @returns {Promise<string|null>}
 */
async function ensureHandle(supabase, adminId, email) {
  const localPart = email.split("@")[0] || "admin";
  const baseSlug =
    localPart
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 30) || "admin";

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? baseSlug : `${baseSlug}${attempt + 1}`;

    // Only claim the handle if it's still actually free — avoids clobbering
    // a handle someone else grabbed between our check and this write.
    const { data: existing } = await supabase
      .from("admin_users")
      .select("id")
      .ilike("handle", candidate)
      .maybeSingle();

    if (existing && existing.id !== adminId) continue; // taken by someone else, try next suffix

    const { data: updated, error: updateErr } = await supabase
      .from("admin_users")
      .update({ handle: candidate })
      .eq("id", adminId)
      .select("handle")
      .maybeSingle();

    if (!updateErr && updated) return updated.handle;

    // 23505 = unique_violation: someone else won the race for this exact
    // candidate between our check and our write. Try the next suffix.
    if (updateErr && updateErr.code !== "23505") {
      console.error("[auth] Failed to persist default handle:", updateErr);
      return null;
    }
  }

  console.error("[auth] Could not find a free default handle for", email);
  return null;
}

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
  let adminHandle = null;
  const { data: adminData } = await supabase
    .from("admin_users")
    .select("id, email, handle")
    .eq("email", userEmail)
    .maybeSingle();

  if (adminData) {
    if (!isAuthorized) isAuthorized = true;
    adminHandle = adminData.handle;

    // Back-fill a default handle for admins/devs who don't have one yet.
    // Historically nothing ever wrote a handle on account creation, so
    // existing rows can have handle = NULL — this left the profile page's
    // "shareable link" section permanently empty for them. Generate one
    // from the email's local part on first login after this fix ships,
    // and persist it so it only needs to happen once per account.
    if (!adminHandle) {
      adminHandle = await ensureHandle(supabase, adminData.id, userEmail);
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
      handle: adminHandle,
      isOwner: ownerEmails.includes(userEmail),
    },
    process.env.JWT_SECRET,
    { expiresIn: "4h", algorithm: "HS256" }
  );

  return res.status(200).json({ token });
}
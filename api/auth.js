// =============================================================================
// api/auth.js
// Admin sign-in endpoint.
//
// POST /api/auth
// Body:         { adminId: string } OR { supabaseToken: string }
// Success 200:  { token: string }
// Failure 401:  { error: string }
// =============================================================================

import jwt from "jsonwebtoken";
import { createHash, timingSafeEqual } from "crypto";
import { applyCors } from "./_middleware.js";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  // Note: applyCors now takes (req, res) to support multi-origin reflection
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { adminId, supabaseToken } = req.body || {};

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // 1. Supabase Token Auth
  if (supabaseToken) {
    const { data: { user }, error } = await supabase.auth.getUser(supabaseToken);
    
    if (error || !user || !user.email) {
      return res.status(401).json({ error: "فشل التحقق من الحساب" });
    }
    
    const userEmail = user.email.toLowerCase();

    // Check if user is an owner
    const ownerEmails = (process.env.OWNER_EMAILS || "")
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(e => e);
      
    let isAuthorized = ownerEmails.includes(userEmail);

    // If not owner, check if user is an admin in the database
    if (!isAuthorized) {
      const { data: adminData } = await supabase
        .from('admin_users')
        .select('email')
        .eq('email', userEmail)
        .single();
        
      if (adminData) {
        isAuthorized = true;
      }
    }
      
    if (!isAuthorized) {
      return res.status(403).json({ error: "هذا الحساب ليس لديه صلاحيات المشرف" });
    }
    
    // Issue a short-lived JWT
    const token = jwt.sign(
      { role: "admin", email: userEmail, isOwner: ownerEmails.includes(userEmail) },
      process.env.JWT_SECRET,
      { expiresIn: "4h", algorithm: "HS256" }
    );

    return res.status(200).json({ token });
  }

  // 2. Secret Key Auth
  if (!adminId || typeof adminId !== "string" || adminId.length > 500) {
    setTimeout(
      () => res.status(400).json({ error: "فشل تسجيل الدخول" }),
      300,
    );
    return;
  }

  // Fetch the expected ADMIN_SECRET from the database
  const { data: settingData, error: settingError } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'ADMIN_SECRET')
    .single();

  const expectedSecret = settingData?.value || process.env.ADMIN_SECRET || "";

  // Timing-safe comparison — prevents brute-force timing oracles.
  const provided = createHash("sha256").update(adminId.trim()).digest();
  const expected = createHash("sha256")
    .update(expectedSecret)
    .digest();

  let authorized = false;
  try {
    authorized = timingSafeEqual(provided, expected);
  } catch (_) {
    authorized = false;
  }

  if (!authorized) {
    // Uniform 300ms delay regardless of reason — attacker learns nothing
    setTimeout(
      () => res.status(401).json({ error: "فشل تسجيل الدخول" }),
      300,
    );
    return;
  }

  // Issue a short-lived JWT
  const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, {
    expiresIn: "4h",
    algorithm: "HS256",
  });

  return res.status(200).json({ token });
}

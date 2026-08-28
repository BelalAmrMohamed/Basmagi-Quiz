// =============================================================================
// api/user-profile/identify.js
// POST /api/user-profile/identify
// Body:        { deviceId: string }  // client-generated UUID, persisted in
//              localStorage (see public/src/shared/userLevel.js)
// Success 200: { token: string, currentLevel: number, passedQuizzesCount: number }
// Failure 400/500: { error: string }
//
// Creates the user_profiles row on first call for a given deviceId (level
// 1, 0 passed quizzes), or fetches the existing one. Either way, mints a
// short-lived JWT (role: "user") whose `current_level` claim is what
// api/ai-agent/chat.js trusts for the Level 10+ gate — it is ALWAYS read
// from the database here, never from anything the client sent, so a
// forged deviceId only gets a fresh level-1 profile, not an elevated one.
// =============================================================================

import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import { applyCors } from "../_middleware.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_TTL = "2h";

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { deviceId } = req.body || {};
  if (!deviceId || typeof deviceId !== "string" || !UUID_RE.test(deviceId)) {
    return res.status(400).json({ error: "معرّف جهاز غير صالح" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  );

  try {
    let { data: profile, error: fetchErr } = await supabase
      .from("user_profiles")
      .select("id, device_id, passed_quizzes_count, current_level")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (fetchErr) {
      console.error("[user-profile/identify] fetch error:", fetchErr);
      return res.status(500).json({ error: "خطأ في الخادم" });
    }

    if (!profile) {
      const { data: created, error: insertErr } = await supabase
        .from("user_profiles")
        .insert({ device_id: deviceId })
        .select("id, device_id, passed_quizzes_count, current_level")
        .single();

      if (insertErr) {
        // Race: another request created it between our SELECT and INSERT.
        // Re-fetch rather than fail outright.
        if (insertErr.code === "23505") {
          const { data: refetched } = await supabase
            .from("user_profiles")
            .select("id, device_id, passed_quizzes_count, current_level")
            .eq("device_id", deviceId)
            .maybeSingle();
          profile = refetched;
        } else {
          console.error("[user-profile/identify] insert error:", insertErr);
          return res.status(500).json({ error: "خطأ في الخادم" });
        }
      } else {
        profile = created;
      }
    }

    if (!profile) {
      return res.status(500).json({ error: "تعذر إنشاء أو جلب الملف الشخصي" });
    }

    const token = jwt.sign(
      {
        role: "user",
        profileId: profile.id,
        current_level: profile.current_level,
      },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: TOKEN_TTL },
    );

    return res.status(200).json({
      token,
      currentLevel: profile.current_level,
      passedQuizzesCount: profile.passed_quizzes_count,
    });
  } catch (err) {
    console.error("[user-profile/identify] unexpected error:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
}

// =============================================================================
// api/user-profile/sync-progress.js
// POST /api/user-profile/sync-progress
// Headers:     Authorization: Bearer <user JWT from /api/user-profile/identify>
// Body:        { passed: boolean }   // true if the just-finished quiz was passed
// Success 200: { currentLevel: number, passedQuizzesCount: number, token: string }
// Failure 401/500: { error: string }
//
// Called client-side after a quiz result is shown (see
// public/src/shared/userLevel.js::reportQuizResult), so passed_quizzes_count
// — and therefore current_level — advances over time based on real usage
// rather than a client-asserted number. Returns a freshly-minted token
// with the updated level claim so the frontend can swap it in immediately
// without a second round trip through /identify.
//
// NOTE: this still trusts the client's `passed: boolean` for a given call —
// there's no server-side verification that a quiz was actually completed
// honestly (that would require quiz-taking to move server-side entirely,
// out of scope here). This is a soft progress signal, not an anti-cheat
// system; treat the Level 10+ gate as a light throttle, not a hard wall.
// =============================================================================

import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import { applyCors } from "../_middleware.js";
import { computeLevel } from "./_levelMath.js";

const TOKEN_TTL = "2h";

function verifyUserToken(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const token = authHeader.slice(7).trim();
  if (!token) throw new Error("UNAUTHORIZED");

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    if (err.name === "TokenExpiredError") throw new Error("TOKEN_EXPIRED");
    throw new Error("UNAUTHORIZED");
  }
  if (payload.role !== "user" || !payload.profileId) throw new Error("UNAUTHORIZED");
  return payload;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let payload;
  try {
    payload = verifyUserToken(req);
  } catch (err) {
    if (err.message === "TOKEN_EXPIRED") {
      return res.status(401).json({ error: "انتهت صلاحية الجلسة، أعد المحاولة" });
    }
    return res.status(401).json({ error: "غير مصرح" });
  }

  const { passed } = req.body || {};

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  );

  try {
    const { data: profile, error: fetchErr } = await supabase
      .from("user_profiles")
      .select("id, passed_quizzes_count")
      .eq("id", payload.profileId)
      .maybeSingle();

    if (fetchErr || !profile) {
      console.error("[user-profile/sync-progress] fetch error:", fetchErr);
      return res.status(500).json({ error: "خطأ في الخادم" });
    }

    const nextCount = passed
      ? profile.passed_quizzes_count + 1
      : profile.passed_quizzes_count;
    const nextLevel = computeLevel(nextCount);

    const { data: updated, error: updateErr } = await supabase
      .from("user_profiles")
      .update({
        passed_quizzes_count: nextCount,
        current_level: nextLevel,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.profileId)
      .select("passed_quizzes_count, current_level")
      .single();

    if (updateErr) {
      console.error("[user-profile/sync-progress] update error:", updateErr);
      return res.status(500).json({ error: "خطأ في الخادم" });
    }

    const token = jwt.sign(
      {
        role: "user",
        profileId: payload.profileId,
        current_level: updated.current_level,
      },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: TOKEN_TTL },
    );

    return res.status(200).json({
      currentLevel: updated.current_level,
      passedQuizzesCount: updated.passed_quizzes_count,
      token,
    });
  } catch (err) {
    console.error("[user-profile/sync-progress] unexpected error:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
}

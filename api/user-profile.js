// =============================================================================
// api/user-profile.js
// Consolidated endpoint for device-identity + progress sync.
// Routed via vercel.json rewrites so client paths are unchanged:
//   /api/user-profile/identify       -> /api/user-profile?action=identify
//   /api/user-profile/sync-progress  -> /api/user-profile?action=sync-progress
//
// ── action=identify ──────────────────────────────────────────────────────────
// POST /api/user-profile?action=identify
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
//
// ── action=sync-progress ─────────────────────────────────────────────────────
// POST /api/user-profile?action=sync-progress
// Headers:     Authorization: Bearer <user JWT from action=identify>
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
import { applyCors } from "./_middleware.js";
import { computeLevel } from "./user-profile/_levelMath.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

async function handleIdentify(req, res, supabase) {
    const { deviceId } = req.body || {};
    if (!deviceId || typeof deviceId !== "string" || !UUID_RE.test(deviceId)) {
        return res.status(400).json({ error: "معرّف جهاز غير صالح" });
    }

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

async function handleSyncProgress(req, res, supabase) {
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

export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const action = req.query?.action;

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY,
    );

    if (action === "identify") return handleIdentify(req, res, supabase);
    if (action === "sync-progress") return handleSyncProgress(req, res, supabase);

    return res.status(400).json({ error: "Invalid action" });
}
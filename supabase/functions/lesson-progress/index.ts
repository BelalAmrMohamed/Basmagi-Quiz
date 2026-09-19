// =============================================================================
// supabase/functions/lesson-progress/index.ts
// Cross-device sync for lesson completion (docs/plans/lessons-feature-plan.md,
// Phase 4a). The one piece of this whole plan that runs as a Supabase Edge
// Function instead of a Vercel function — see the plan's ground rules on the
// Vercel Hobby 12-function cap, which is already exactly full.
//
// Deployed with `--no-verify-jwt` (see setup note at the bottom of this file):
// the Authorization header here carries THIS APP'S OWN device-identity JWT
// (minted by api/user-profile.js?action=identify, HS256, signed with the
// same JWT_SECRET Vercel uses), not a Supabase Auth JWT. Supabase's default
// gateway-level JWT check would reject it, since it only understands
// Supabase-issued tokens.
//
// Mirrors the identity established by api/user-profile.js exactly — this is
// NOT a second auth scheme. A reader who has never taken a quiz still has a
// device_id + JWT the moment userLevel.js's getUserToken() runs (it mints one
// on first call, lazily), so lesson-only visitors are covered too.
//
// Endpoints (single function, verb + `action` query param dispatch, same
// shape as api/user-profile.js and api/college-quiz.js):
//
//   POST /functions/v1/lesson-progress?action=complete
//     Headers: Authorization: Bearer <user JWT from /api/user-profile/identify>
//     Body:    { lessonId: string, visitedSectionIds: string[], allSectionIds: string[] }
//     Marks the lesson complete for this profile IF every section in
//     allSectionIds is present in visitedSectionIds — the completion rule is
//     re-checked server-side (mirrors isLessonComplete() in
//     public/src/features/home/lesson-progress.js) rather than trusting a
//     bare "mark it done" flag from the client. Idempotent: calling this
//     again for an already-completed lesson is a no-op (200, unchanged).
//     Success 200: { completed: true, completedAt: string }
//     Not yet complete (fewer visited than authored sections): 200 { completed: false }
//
//   GET /functions/v1/lesson-progress?action=list
//     Headers: Authorization: Bearer <user JWT>
//     Success 200: { completedLessonIds: string[] }
//     Used on load to merge server-known completions into the local
//     per-lesson localStorage state on a new device (client decides how to
//     merge — this endpoint only reports truth, it never writes local state).
//
// ⚠️ Never touches user_profiles.passed_quizzes_count / current_level or
// anything under the points/level system. A completely separate table
// (lesson_progress), separate endpoint, no shared code path with quiz
// progress — see the plan's explicit "not wired into points" callout.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import * as jose from "npm:jose@5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Same secret Vercel's JWT_SECRET env var holds — set this identically in
// the Supabase project's Edge Function secrets (`supabase secrets set
// JWT_SECRET=...`), copied from the Vercel env, not regenerated. A mismatch
// here just means every token this function sees looks unauthorized; it
// won't error loudly, so double-check the value if sync silently 401s.
const JWT_SECRET = Deno.env.get("JWT_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies the app's own HS256 device-identity JWT (role: "user",
 * profileId: uuid) — the exact payload shape api/user-profile.js mints.
 * Throws "UNAUTHORIZED" or "TOKEN_EXPIRED", mirroring
 * api/_middleware.js::requireAdmin's error-string convention so the two
 * server halves stay consistent even though this one runs on Deno.
 */
async function verifyUserToken(req: Request): Promise<{ profileId: string }> {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const token = authHeader.slice(7).trim();
  if (!token) throw new Error("UNAUTHORIZED");

  let payload: jose.JWTPayload;
  try {
    const secretKey = new TextEncoder().encode(JWT_SECRET);
    const result = await jose.jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });
    payload = result.payload;
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) throw new Error("TOKEN_EXPIRED");
    throw new Error("UNAUTHORIZED");
  }

  if (payload.role !== "user" || typeof payload.profileId !== "string") {
    throw new Error("UNAUTHORIZED");
  }
  return { profileId: payload.profileId as string };
}

function handleAuthError(err: unknown): Response {
  const message = err instanceof Error ? err.message : "UNAUTHORIZED";
  if (message === "TOKEN_EXPIRED") {
    return json({ error: "انتهت صلاحية الجلسة، أعد المحاولة" }, 401);
  }
  return json({ error: "غير مصرح" }, 401);
}

async function handleComplete(req: Request, supabase: ReturnType<typeof createClient>) {
  let profileId: string;
  try {
    ({ profileId } = await verifyUserToken(req));
  } catch (err) {
    return handleAuthError(err);
  }

  let body: { lessonId?: string; visitedSectionIds?: unknown; allSectionIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "طلب غير صالح" }, 400);
  }

  const { lessonId, visitedSectionIds, allSectionIds } = body;
  if (!lessonId || !UUID_RE.test(lessonId)) {
    return json({ error: "معرف الدرس غير صالح" }, 400);
  }
  if (!Array.isArray(visitedSectionIds) || !Array.isArray(allSectionIds) || allSectionIds.length === 0) {
    return json({ error: "بيانات التقدم غير صالحة" }, 400);
  }

  // Re-derive completion server-side rather than trusting a client-sent
  // `completed: true` — mirrors isLessonComplete() in
  // public/src/features/home/lesson-progress.js exactly (every authored
  // section id must appear in the visited set).
  const visited = new Set(visitedSectionIds.map(String));
  const isComplete = allSectionIds.every((id) => visited.has(String(id)));

  if (!isComplete) {
    return json({ completed: false });
  }

  // Idempotent upsert: a second completion call (e.g. re-visiting an
  // already-finished lesson) just leaves the original completed_at in
  // place rather than erroring or bumping the timestamp.
  const { data: existing } = await supabase
    .from("lesson_progress")
    .select("completed_at")
    .eq("profile_id", profileId)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  if (existing) {
    return json({ completed: true, completedAt: existing.completed_at });
  }

  const { data: inserted, error } = await supabase
    .from("lesson_progress")
    .insert({ profile_id: profileId, lesson_id: lessonId })
    .select("completed_at")
    .single();

  if (error) {
    // 23505: a race with another concurrent request for the same
    // (profile, lesson) pair — treat as success rather than a 500, same
    // reasoning as the identify-race handling in api/user-profile.js.
    if (error.code === "23505") {
      const { data: refetched } = await supabase
        .from("lesson_progress")
        .select("completed_at")
        .eq("profile_id", profileId)
        .eq("lesson_id", lessonId)
        .maybeSingle();
      if (refetched) return json({ completed: true, completedAt: refetched.completed_at });
    }
    console.error("[lesson-progress/complete] insert error:", error.message);
    return json({ error: "خطأ في الخادم" }, 500);
  }

  return json({ completed: true, completedAt: inserted.completed_at });
}

async function handleList(req: Request, supabase: ReturnType<typeof createClient>) {
  let profileId: string;
  try {
    ({ profileId } = await verifyUserToken(req));
  } catch (err) {
    return handleAuthError(err);
  }

  const { data, error } = await supabase
    .from("lesson_progress")
    .select("lesson_id")
    .eq("profile_id", profileId);

  if (error) {
    console.error("[lesson-progress/list] fetch error:", error.message);
    return json({ error: "خطأ في الخادم" }, 500);
  }

  return json({ completedLessonIds: (data || []).map((row) => row.lesson_id) });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  if (req.method === "POST" && action === "complete") return handleComplete(req, supabase);
  if (req.method === "GET" && action === "list") return handleList(req, supabase);

  return json({ error: "Invalid action" }, 400);
});

// ─── Setup (do once) ─────────────────────────────────────────────────────────
// 1. supabase secrets set JWT_SECRET=<same value as Vercel's JWT_SECRET>
// 2. supabase secrets set ALLOWED_ORIGIN=<same value as Vercel's ALLOWED_ORIGIN>
//    (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the
//    platform for every Edge Function — no need to set those manually.)
// 3. supabase functions deploy lesson-progress --no-verify-jwt
//    (--no-verify-jwt is required: this function verifies its own
//    app-issued JWT above; Supabase's gateway-level check only accepts
//    Supabase Auth-issued tokens and would 401 every legitimate request.) 
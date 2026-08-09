// =============================================================================
// api/admin-stats.js
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { requireAdmin, handleAuthError } from "./_middleware.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

// Service-role client, used only for the authenticated write path below.
// Never used for the public GET/read paths — those stay on the anon key
// so RLS keeps governing what's readable, same as render-profile.js.
const supabaseService = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

function getOwnerEmails() {
  return (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// ── POST: write path for the owner's own admin_users row ────────────────────
// Two independent things can be synced here, either together or alone:
//   1. Progress mirror (totalPoints/totalQuizzes/totalBadges/currentLevel) —
//      local (gameEngine/localStorage) is always the source of truth for
//      what's *displayed* on the owner's own dashboard. This just keeps the
//      DB row from being permanently stuck at its seeded/zero values, since
//      visitor view and the leaderboard read from this row.
//   2. avatarUrl — persisted here (rather than a new endpoint, mindful of
//      the Vercel function-count limit) when an admin/dev picks/uploads an
//      avatar via avatarPicker.js. Regular/anonymous users have no DB row
//      to write to, so this only ever applies to authenticated admins.
// Both are scoped to the caller's own JWT email — never trust an id/handle
// from the request body, so one admin can't overwrite another's row.
async function handleSync(req, res) {
  let payload;
  try {
    payload = requireAdmin(req);
  } catch (err) {
    if (handleAuthError(err, res)) return;
    return res.status(401).json({ error: "غير مصرح" });
  }

  const { totalPoints, totalQuizzes, totalBadges, currentLevel, avatarUrl, displayName, activityHeatmap } = req.body || {};

  const hasProgressFields =
    totalPoints !== undefined || totalQuizzes !== undefined ||
    totalBadges !== undefined || currentLevel !== undefined;

  const isFiniteNonNegative = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

  const updates = {};

  if (hasProgressFields) {
    if (
      !isFiniteNonNegative(totalPoints) ||
      !isFiniteNonNegative(totalQuizzes) ||
      !isFiniteNonNegative(totalBadges) ||
      !isFiniteNonNegative(currentLevel)
    ) {
      return res.status(400).json({ error: "Invalid progress payload" });
    }
    updates.total_points = Math.round(totalPoints);
    updates.passed_quizzes = Math.round(totalQuizzes);
    updates.total_badges = Math.round(totalBadges);
    updates.current_level = Math.round(currentLevel);
  }

  if (activityHeatmap !== undefined) {
    if (!isPlainObject(activityHeatmap)) {
      return res.status(400).json({ error: "Invalid activityHeatmap payload" });
    }
    for (const [key, value] of Object.entries(activityHeatmap)) {
      if (
        typeof key !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(key) ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0
      ) {
        return res.status(400).json({ error: "Invalid activityHeatmap payload" });
      }
    }
    updates.activity_heatmap = activityHeatmap;
  }

  if (avatarUrl !== undefined) {
    // avatarEngine.saveAvatar() already validates/compresses before this
    // is ever called — here we just guard against obviously-wrong types
    // and an unbounded payload size reaching the DB.
    if (avatarUrl !== null && (typeof avatarUrl !== "string" || avatarUrl.length > 500000)) {
      return res.status(400).json({ error: "Invalid avatar payload" });
    }
    updates.avatar_url = avatarUrl;
  }

  if (displayName !== undefined) {
    if (displayName !== null && typeof displayName !== "string") {
      return res.status(400).json({ error: "Invalid display_name payload" });
    }
    updates.display_name = displayName;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "Nothing to sync" });
  }

  const normalizedEmail = payload.email.trim().toLowerCase().replace(/[%_\\]/g, "\\$&");
  const { data: updated, error } = await supabaseService
    .from("admin_users")
    .update(updates)
    .ilike("email", normalizedEmail)
    .select("handle")
    .maybeSingle();

  if (error) {
    console.error("[admin-stats] sync write failed", error);
    return res.status(500).json({ error: error.message });
  }
  if (!updated) {
    return res.status(404).json({ error: "Admin not found" });
  }

  return res.status(200).json({ synced: true });
}

export default async function handler(req, res) {
  if (req.method === "POST") {
    return handleSync(req, res);
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const handle = req.query.handle;

  const isLeaderboard = req.query.leaderboard === "true";

  if (isLeaderboard) {
    const { data, error } = await supabase
      .from("admin_users")
      .select("display_name, handle, uploaded_quizzes, current_level")
      .order("uploaded_quizzes", { ascending: false })
      .limit(10);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Shape to match what the client (renderLeaderboard) reads: totalQuizzes
    // and displayName. Returning the raw uploaded_quizzes/display_name column
    // names here previously left entry.totalQuizzes undefined client-side,
    // which threw inside renderLeaderboard's try/catch and silently fell
    // back to a hardcoded mock leaderboard.
    const leaderboard = (data || []).map((row) => ({
      handle: row.handle,
      displayName: row.display_name || null,
      totalQuizzes: row.uploaded_quizzes || 0,
      currentLevel: row.current_level || 1,
    }));

    return res.status(200).json(leaderboard);
  }

  let adminUser = null;

  if (handle) {
    // Find admin id and stats
    const normalizedHandle = handle.trim().toLowerCase().replace(/[%_\\]/g, "\\$&");
    const { data, error } = await supabase
      .from("admin_users")
      .select("id, display_name, total_points, passed_quizzes, total_badges, current_level, handle, email, avatar_url, uploaded_quizzes, activity_heatmap")
      .ilike("handle", normalizedHandle)
      .maybeSingle();
    adminUser = data;
  } else {
    // If no handle provided, try to resolve via JWT Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
        if (payload.email) {
          // admin_users.email is stored as entered (e.g. at signup time), while
          // the JWT's email claim may come from a different casing (OAuth
          // providers, Supabase auth, manual entry, etc). A plain `.eq()` is
          // case-sensitive, so an admin/dev could authenticate successfully
          // yet never resolve a row here -> silent 404 -> no handle shown.
          // Use ilike with an escaped, trimmed, lowercased value for a safe
          // case-insensitive exact match instead.
          const normalizedEmail = payload.email.trim().toLowerCase().replace(/[%_\\]/g, "\\$&");
          const { data, error } = await supabase
            .from("admin_users")
            .select("id, display_name, total_points, passed_quizzes, total_badges, current_level, handle, email, avatar_url, uploaded_quizzes, activity_heatmap")
            .ilike("email", normalizedEmail)
            .maybeSingle();
          adminUser = data;
        }
      } catch (err) {
        console.error("Error decoding token for admin stats", err);
      }
    }
  }

  if (!adminUser) {
    return res.status(404).json({ error: "Admin not found or missing handle parameter" });
  }

  const ownerEmails = getOwnerEmails();
  const isOwner = !!(adminUser.email && ownerEmails.includes(adminUser.email.trim().toLowerCase()));
  // Every row in admin_users is, by schema/naming, an admin — see
  // Database-Schema.sql. Owners are additionally admins.
  const role = "admin";


  // Count quizzes uploaded
  const { count: quizzesCount, error: quizzesErr } = await supabase
    .from("quizzes")
    .select("id", { count: "exact", head: true })
    .eq("uploaded_by", adminUser.id);

  // For reports, we count them based on the quizzes uploaded by this admin
  // Since we don't have a complex view, we can just fetch quiz IDs first, then count reports
  const { data: adminQuizzes } = await supabase
    .from("quizzes")
    .select("id")
    .eq("uploaded_by", adminUser.id);
  
  const quizIds = (adminQuizzes || []).map((q) => q.id);
  
  let reportsCount = 0;
  if (quizIds.length > 0) {
    const { count } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .in("quiz_id", quizIds);
    reportsCount = count || 0;
  }

  const { count: resolvedCount } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("resolved_by_admin_id", adminUser.id);

  return res.status(200).json({
    handle: adminUser.handle,
    // NOTE: email intentionally omitted from this response — this endpoint
    // is reachable by anonymous visitors (visitor-view profile pages), and
    // the RLS SELECT policy on admin_users only restricts rows, not columns,
    // so returning email here would make it enumerable via handle. See
    // handoff notes: "Known follow-up" under the RLS fix.
    uploadedQuizzes: typeof adminUser.uploaded_quizzes !== 'undefined' ? adminUser.uploaded_quizzes : quizzesCount || 0,
    reportsCount: reportsCount,
    resolvedReports: resolvedCount || 0,
    totalPoints: adminUser.total_points || 0,
    totalQuizzes: adminUser.passed_quizzes || 0,
    totalBadges: adminUser.total_badges || 0,
    currentLevel: adminUser.current_level || 1,
    avatarUrl: adminUser.avatar_url || null,
    displayName: adminUser.display_name || null,
    activityHeatmap: adminUser.activity_heatmap || {},
    role,
    isOwner
  });

}
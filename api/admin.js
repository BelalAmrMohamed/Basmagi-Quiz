// =============================================================================
// api/admin.js
// Merged endpoint: admin-control (owner-only admin management) +
// admin-stats (public/admin stats, leaderboard, uploads history, sync).
//
// Routing: admin-control's GET/POST always require an admin JWT and operate
// on { admins, platformStats } / add_admin | remove_admin | update_scopes.
// admin-stats is reachable via query params the control UI never sends
// (?handle=, ?id=, ?leaderboard=true, ?uploads=true) or a POST body without
// an `action` field (progress/avatar/profile sync).
//
// We distinguish the two by:
//   - GET:  ?leaderboard=true | ?uploads=true | ?handle=... | ?id=...
//           → stats. Otherwise (no query, admin JWT) → control.
//   - POST: body has `action` (add_admin/remove_admin/update_scopes)
//           → control. Otherwise → stats sync.
//
// Old paths /api/admin-control and /api/admin-stats are preserved via
// rewrites in vercel.json, so no frontend call sites needed to change.
//
// NOTE: The "change_code" / access-code actions were removed in v6.1.
// =============================================================================
import { applyCors, requireAdmin, handleAuthError } from "./_middleware.js";
import { createClient } from "@supabase/supabase-js";

// ── admin-stats clients ──────────────────────────────────────────────────────
// Public GET/read paths stay on the anon key so RLS keeps governing what's
// readable (same as render-profile.js). Service-role client is used only
// for the authenticated write path in handleStatsSync.
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);
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

function normalizeCollegeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// =============================================================================
// admin-control handlers (owner-only admin management)
// =============================================================================

async function handleControlGet(req, res, payload, supabase) {
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

  const { data: catData } = await supabase.from("quizzes").select("category");

  const uniqueCategories = new Set((catData || []).map((r) => r.category));

  const { data: colleges, error: collegesError } = await supabase
    .from("colleges")
    .select("id, education_type, name, normalized_name, year_count, terms, is_active")
    .order("education_type", { ascending: true })
    .order("name", { ascending: true });

  if (collegesError) {
    return res.status(500).json({ error: "Failed to fetch colleges" });
  }

  return res.status(200).json({
    admins: admins || [],
    colleges: colleges || [],
    platformStats: {
      totalQuizzes: quizCount ?? 0,
      totalCategories: uniqueCategories.size,
      totalAdmins: (admins || []).length,
      ownerEmail: payload.email,
    },
  });
}

async function handleControlPost(req, res, payload, supabase) {
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
      return res
        .status(400)
        .json({ error: "Email and valid scopes array are required" });
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

  if (action === "save_college") {
    const { id, name, education_type = "University", year_count, terms, is_active = true } = req.body;
    const cleanName = String(name || "").trim().replace(/\s+/g, " ");
    const years = Number(year_count);
    const cleanTerms = Array.isArray(terms) ? terms.map(Number).filter(Number.isInteger) : [];

    if (!cleanName || !/^(University|Primary|Middle|High)$/.test(education_type)) {
      return res.status(400).json({ error: "Invalid college data" });
    }
    if (!Number.isInteger(years) || years < 1 || years > 12) {
      return res.status(400).json({ error: "Year count must be between 1 and 12" });
    }
    if (!cleanTerms.length || cleanTerms.some((term) => term < 1 || term > 4)) {
      return res.status(400).json({ error: "Select at least one valid term" });
    }

    const values = {
      name: cleanName,
      normalized_name: normalizeCollegeName(cleanName),
      education_type,
      year_count: years,
      terms: [...new Set(cleanTerms)].sort((a, b) => a - b),
      is_active: Boolean(is_active),
      updated_at: new Date().toISOString(),
    };
    const query = id
      ? supabase.from("colleges").update(values).eq("id", id)
      : supabase.from("colleges").insert({ ...values, created_by: payload.sub || null });
    const { data, error } = await query
      .select("id, education_type, name, normalized_name, year_count, terms, is_active")
      .single();

    if (error) {
      if (error.code === "23505") return res.status(400).json({ error: "A college with this name already exists" });
      return res.status(500).json({ error: "Failed to save college" });
    }
    return res.status(200).json({ college: data });
  }

  if (action === "delete_college") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "College ID is required" });
    const { error } = await supabase
      .from("colleges")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return res.status(500).json({ error: "Failed to deactivate college" });
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: "Invalid action" });
}

async function handleControl(req, res) {
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
    process.env.SUPABASE_SERVICE_KEY,
  );

  if (req.method === "GET") return handleControlGet(req, res, payload, supabase);
  if (req.method === "POST") return handleControlPost(req, res, payload, supabase);

  return res.status(405).json({ error: "Method not allowed" });
}

// =============================================================================
// admin-stats handlers (public/admin stats, leaderboard, uploads, sync)
// =============================================================================

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
async function handleStatsSync(req, res) {
  let payload;
  try {
    payload = requireAdmin(req);
  } catch (err) {
    if (handleAuthError(err, res)) return;
    return res.status(401).json({ error: "غير مصرح" });
  }

  const {
    totalPoints,
    totalQuizzes,
    totalBadges,
    currentLevel,
    avatarUrl,
    thumbnailUrl,
    displayName,
    activityHeatmap,
  } = req.body || {};

  const hasProgressFields =
    totalPoints !== undefined ||
    totalQuizzes !== undefined ||
    totalBadges !== undefined ||
    currentLevel !== undefined;

  const isFiniteNonNegative = (n) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0;
  const isPlainObject = (value) =>
    value && typeof value === "object" && !Array.isArray(value);

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
        return res
          .status(400)
          .json({ error: "Invalid activityHeatmap payload" });
      }
    }
    updates.activity_heatmap = activityHeatmap;
  }

  if (avatarUrl !== undefined) {
    // avatarEngine.saveAvatar() already validates/compresses before this
    // is ever called — here we just guard against obviously-wrong types
    // and an unbounded payload size reaching the DB.
    if (
      avatarUrl !== null &&
      (typeof avatarUrl !== "string" || avatarUrl.length > 500000)
    ) {
      return res.status(400).json({ error: "Invalid avatar payload" });
    }
    updates.avatar_url = avatarUrl;
  }

  if (thumbnailUrl !== undefined) {
    // Same shape/size contract as avatarUrl above: either a processed data
    // URL (avatarEngine.processImageFile, already validated/compressed) or
    // a relative path into public/assets/profile-featured/thumbnails/ (the
    // Featured Thumbnails picker) — both are plain strings well under this
    // cap, so the same guard covers both sources.
    if (
      thumbnailUrl !== null &&
      (typeof thumbnailUrl !== "string" || thumbnailUrl.length > 500000)
    ) {
      return res.status(400).json({ error: "Invalid thumbnail payload" });
    }
    updates.thumbnail_url = thumbnailUrl;
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

  const normalizedEmail = payload.email
    .trim()
    .toLowerCase()
    .replace(/[%_\\]/g, "\\$&");
  const { data: updated, error } = await supabaseService
    .from("admin_users")
    .update(updates)
    .ilike("email", normalizedEmail)
    .select("handle")
    .maybeSingle();

  if (error) {
    console.error("[admin] stats sync write failed", error);
    return res.status(500).json({ error: error.message });
  }
  if (!updated) {
    return res.status(404).json({ error: "Admin not found" });
  }

  return res.status(200).json({ synced: true });
}

async function handleStats(req, res) {
  if (req.method === "POST") {
    return handleStatsSync(req, res);
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = supabaseAnon;
  const handle = req.query.handle;
  const id = req.query.id;

  const isLeaderboard = req.query.leaderboard === "true";

  if (isLeaderboard) {
    const { data, error } = await supabase
      .from("admin_users")
      .select(
        "display_name, handle, uploaded_quizzes, current_level, avatar_url, thumbnail_url, total_points",
      )
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
      avatarUrl: row.avatar_url || null,
      thumbnailUrl: row.thumbnail_url || null,
      totalPoints: row.total_points || 0,
    }));

    return res.status(200).json(leaderboard);
  }

  // ── Uploaded Quizzes History ────────────────────────────────────────────
  // ?uploads=true&handle=X (or Bearer token for the owner's own dashboard).
  // Reuses this route's existing handle/JWT resolution below rather than a
  // dedicated endpoint, mindful of the Vercel function-count limit — same
  // reasoning as avatarUrl/thumbnailUrl sharing the POST path above.
  const isUploads = req.query.uploads === "true";

  let adminUser = null;

  if (id) {
    const { data } = await supabase
      .from("admin_users")
      .select(
        "id, display_name, total_points, passed_quizzes, total_badges, current_level, handle, email, avatar_url, thumbnail_url, uploaded_quizzes, activity_heatmap",
      )
      .eq("id", id)
      .maybeSingle();
    adminUser = data;
  } else if (handle) {
    // Find admin id and stats
    const normalizedHandle = handle
      .trim()
      .toLowerCase()
      .replace(/[%_\\]/g, "\\$&");
    const { data } = await supabase
      .from("admin_users")
      .select(
        "id, display_name, total_points, passed_quizzes, total_badges, current_level, handle, email, avatar_url, thumbnail_url, uploaded_quizzes, activity_heatmap",
      )
      .ilike("handle", normalizedHandle)
      .maybeSingle();
    adminUser = data;
  } else {
    // If no handle provided, try to resolve via JWT Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const payload = JSON.parse(
          Buffer.from(token.split(".")[1], "base64").toString("utf8"),
        );
        if (payload.email) {
          // admin_users.email is stored as entered (e.g. at signup time), while
          // the JWT's email claim may come from a different casing (OAuth
          // providers, Supabase auth, manual entry, etc). A plain `.eq()` is
          // case-sensitive, so an admin/dev could authenticate successfully
          // yet never resolve a row here -> silent 404 -> no handle shown.
          // Use ilike with an escaped, trimmed, lowercased value for a safe
          // case-insensitive exact match instead.
          const normalizedEmail = payload.email
            .trim()
            .toLowerCase()
            .replace(/[%_\\]/g, "\\$&");
          const { data } = await supabase
            .from("admin_users")
            .select(
              "id, display_name, total_points, passed_quizzes, total_badges, current_level, handle, email, avatar_url, thumbnail_url, uploaded_quizzes, activity_heatmap",
            )
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
    return res
      .status(404)
      .json({ error: "Admin not found or missing handle parameter" });
  }

  const ownerEmails = getOwnerEmails();
  const isOwner = !!(
    adminUser.email &&
    ownerEmails.includes(adminUser.email.trim().toLowerCase())
  );
  // Every row in admin_users is, by schema/naming, an admin — see
  // Database-Schema.sql. Owners are additionally admins.
  const role = "admin";

  if (isUploads) {
    // Public (anon-key) read, same as the rest of this GET path — visitor
    // profiles need this too, so no auth gate here beyond resolving which
    // admin's quizzes to list (already done above via handle or JWT).
    const { data: recentQuizzes, error: recentErr } = await supabase
      .from("quizzes")
      .select("id, title, category, subject, path, created_at")
      .eq("uploaded_by", adminUser.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (recentErr) {
      return res.status(500).json({ error: recentErr.message });
    }

    return res.status(200).json({
      handle: adminUser.handle,
      uploads: (recentQuizzes || []).map((q) => ({
        id: q.id,
        title: q.title,
        category: q.category,
        subject: q.subject,
        path: q.path,
        createdAt: q.created_at,
      })),
    });
  }

  // Count quizzes uploaded
  const { count: quizzesCount } = await supabase
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
    uploadedQuizzes:
      typeof adminUser.uploaded_quizzes !== "undefined"
        ? adminUser.uploaded_quizzes
        : quizzesCount || 0,
    reportsCount: reportsCount,
    resolvedReports: resolvedCount || 0,
    totalPoints: adminUser.total_points || 0,
    totalQuizzes: adminUser.passed_quizzes || 0,
    totalBadges: adminUser.total_badges || 0,
    currentLevel: adminUser.current_level || 1,
    avatarUrl: adminUser.avatar_url || null,
    thumbnailUrl: adminUser.thumbnail_url || null,
    displayName: adminUser.display_name || null,
    activityHeatmap: adminUser.activity_heatmap || {},
    role,
    isOwner,
  });
}

// =============================================================================
// Dispatcher
// =============================================================================

const CONTROL_ACTIONS = new Set(["add_admin", "remove_admin", "update_scopes"]);

function isStatsGet(req) {
  const q = req.query || {};
  return (
    q.leaderboard === "true" ||
    q.uploads === "true" ||
    typeof q.handle !== "undefined" ||
    typeof q.id !== "undefined"
  );
}

export default async function handler(req, res) {
  // GET: route by query params — control has none of these.
  if (req.method === "GET") {
    if (isStatsGet(req)) return handleStats(req, res);
    return handleControl(req, res);
  }

  // POST: route by body.action — control uses a fixed action set,
  // everything else (progress/avatar/profile sync) goes to stats.
  if (req.method === "POST") {
    const action = req.body && req.body.action;
    if (CONTROL_ACTIONS.has(action)) return handleControl(req, res);
    return handleStats(req, res);
  }

  if (req.method === "OPTIONS") {
    applyCors(req, res);
    return res.status(200).end();
  }

  return res.status(405).json({ error: "Method not allowed" });
}
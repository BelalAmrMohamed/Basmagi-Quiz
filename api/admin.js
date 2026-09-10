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
import { slugifyHandle, validateHandleFormat, claimHandle } from "./_handle.js";
import {
  resolveAdminId,
  isAuthorizedForItem,
  getTrashRetentionDays,
  computeExpiresAt,
  sweepExpiredTrash,
  purgeQuizMedia,
  collectCascadeItems,
} from "./_trash.js";
import { canPlaceItemServer, validateItemName } from "./_itemActions.js";

const MAX_BIO_LENGTH = 280;

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
// Item-management actions (trash list/restore/empty/settings, folder/course
// soft-delete, move-item, rename-item) — see docs/plans/Admin actions and
// deletion flow for quizzes.md §2.
//
// Unlike handleControl (owner-only), these reuse the exact 3-tier
// authorization already proven out in college-quiz.js's handleDeleteQuiz
// (owner -> creator/uploader -> scope match), generalized to
// folders/courses via isAuthorizedForItem() in api/_trash.js. Only
// trash-settings (retention days) stays owner-only, since it's a
// platform-wide knob, not a per-item action.
// =============================================================================

const ITEM_ACTIONS = new Set([
  "trash-list",
  "trash-restore",
  "trash-empty",
  "trash-settings",
  "delete-folder",
  "delete-course",
  "move-item",
  "rename-item",
]);

async function fetchItemForAuth(supabase, itemType, itemId) {
  if (itemType === "quiz") {
    const { data } = await supabase
      .from("quizzes")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();
    return data ? { row: data, creatorId: data.uploaded_by, educationType: data.education_type } : null;
  }
  if (itemType === "folder") {
    const { data } = await supabase
      .from("folders")
      .select("*, courses:course_id(education_type)")
      .eq("id", itemId)
      .maybeSingle();
    return data
      ? { row: data, creatorId: data.created_by, educationType: data.courses?.education_type || null }
      : null;
  }
  if (itemType === "course") {
    const { data } = await supabase
      .from("courses")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();
    return data ? { row: data, creatorId: data.created_by, educationType: data.education_type } : null;
  }
  return null;
}

// ── action=trash-list ────────────────────────────────────────────────────────
// Lists trash_items, scoped by the caller's allowed_scopes unless they're an
// owner (same scoping semantics as the rest of item-management). Opportunis-
// tically sweeps expired rows first (see sweepExpiredTrash's doc comment for
// why this is a lazy vacuum-on-access rather than a scheduled job).
async function handleTrashList(req, res, adminPayload, adminId, supabase) {
  await sweepExpiredTrash(supabase);

  let query = supabase
    .from("trash_items")
    .select("id, item_type, original_id, snapshot, parent_folder_id, course_id, education_type, batch_id, deleted_by, deleted_at, expires_at")
    .order("deleted_at", { ascending: false });

  if (!adminPayload.isOwner && adminPayload.allowed_scopes?.length) {
    query = query.in("education_type", adminPayload.allowed_scopes);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[admin:trash-list] failed:", error.message);
    return res.status(500).json({ error: "فشل تحميل سلة المهملات." });
  }

  // Non-owner, non-scoped admins (only the "is uploader" tier) only ever see
  // their own trashed items rather than nothing at all — filtered in-memory
  // since "deleted_by = me OR education_type in scopes" isn't a single
  // .in()/.eq() query, and the row count here is bounded/small.
  let visible = data || [];
  if (!adminPayload.isOwner) {
    const hasScopeMatch = (row) =>
      adminPayload.allowed_scopes?.includes(row.education_type);
    visible = visible.filter((row) => row.deleted_by === adminId || hasScopeMatch(row));
  }

  return res.status(200).json({
    items: visible.map((row) => ({
      id: row.id,
      itemType: row.item_type,
      originalId: row.original_id,
      name: row.snapshot?.title || row.snapshot?.name || row.snapshot?.data?.meta?.title || "بدون اسم",
      batchId: row.batch_id,
      deletedBy: row.deleted_by,
      deletedAt: row.deleted_at,
      expiresAt: row.expires_at,
      educationType: row.education_type,
    })),
  });
}

// ── action=trash-restore ─────────────────────────────────────────────────────
// Body: { trashItemId } — restores that item AND every other row sharing its
// batch_id (a cascade-trashed folder/course brings its whole subtree back
// together). Falls back to "restore to root/course-level" when the original
// parent_folder_id/course_id no longer exists (it may itself have been
// purged since).
async function handleTrashRestore(req, res, adminPayload, adminId, supabase) {
  const { trashItemId } = req.body || {};
  if (!trashItemId) return res.status(400).json({ error: "معرف العنصر المطلوب استعادته مفقود." });

  const { data: anchor, error: anchorErr } = await supabase
    .from("trash_items")
    .select("*")
    .eq("id", trashItemId)
    .maybeSingle();

  if (anchorErr || !anchor) return res.status(404).json({ error: "العنصر غير موجود في سلة المهملات." });

  if (!isAuthorizedForItem(adminPayload, adminId, { creatorId: anchor.deleted_by, educationType: anchor.education_type })) {
    return res.status(403).json({ error: "ليس لديك صلاحية لاستعادة هذا العنصر." });
  }

  const { data: batchRows, error: batchErr } = await supabase
    .from("trash_items")
    .select("*")
    .eq("batch_id", anchor.batch_id)
    .order("deleted_at", { ascending: true });

  if (batchErr || !batchRows?.length) return res.status(404).json({ error: "تعذر تحميل عناصر الدفعة." });

  // Restore parent-first: courses, then folders (already ordered by
  // deleted_at, which was itself written parent-before-children by the
  // cascade-delete handlers below), then quizzes.
  const order = { course: 0, folder: 1, quiz: 2 };
  const sorted = [...batchRows].sort((a, b) => order[a.item_type] - order[b.item_type]);

  // Tracks which original ids were actually restored in this pass, so a
  // child whose parent is *also* in this batch can point at it even if the
  // parent's original UUID happens to collide with something else meanwhile
  // (practically never, but keeps the fallback logic simple/explicit).
  const restoredIds = new Set();
  const restoredNames = [];
  const failures = [];

  for (const row of sorted) {
    try {
      if (row.item_type === "course") {
        const snap = { ...row.snapshot };
        const { error } = await supabase.from("courses").insert(snap);
        if (error) throw new Error(error.message);
        restoredIds.add(row.original_id);
        restoredNames.push(snap.name);
      } else if (row.item_type === "folder") {
        const snap = { ...row.snapshot };
        // Fall back to root-of-course if the parent folder no longer exists
        // (purged separately, or genuinely never part of this batch).
        if (snap.parent_folder_id) {
          const parentStillGone = !restoredIds.has(snap.parent_folder_id);
          if (parentStillGone) {
            const { data: parentExists } = await supabase
              .from("folders")
              .select("id")
              .eq("id", snap.parent_folder_id)
              .maybeSingle();
            if (!parentExists) snap.parent_folder_id = null;
          }
        }
        // Fall back to "no course" is not valid (folders require course_id)
        // — if the course itself was purged, skip restoring this folder;
        // its quizzes will fall back the same way below.
        const { data: courseExists } = await supabase
          .from("courses")
          .select("id")
          .eq("id", snap.course_id)
          .maybeSingle();
        if (!courseExists && !restoredIds.has(snap.course_id)) {
          failures.push({ name: snap.name, reason: "المادة الأصلية لم تعد موجودة." });
          continue;
        }
        const { error } = await supabase.from("folders").insert(snap);
        if (error) throw new Error(error.message);
        restoredIds.add(row.original_id);
        restoredNames.push(snap.name);
      } else if (row.item_type === "quiz") {
        const snap = { ...row.snapshot };
        if (snap.folder_id) {
          const parentStillGone = !restoredIds.has(snap.folder_id);
          if (parentStillGone) {
            const { data: folderExists } = await supabase
              .from("folders")
              .select("id")
              .eq("id", snap.folder_id)
              .maybeSingle();
            if (!folderExists) snap.folder_id = null;
          }
        }
        if (snap.course_id) {
          const courseGone = !restoredIds.has(snap.course_id);
          if (courseGone) {
            const { data: courseExists } = await supabase
              .from("courses")
              .select("id")
              .eq("id", snap.course_id)
              .maybeSingle();
            if (!courseExists) {
              failures.push({ name: snap.title, reason: "المادة الأصلية لم تعد موجودة." });
              continue;
            }
          }
        }
        const { error } = await supabase.from("quizzes").insert(snap);
        if (error) throw new Error(error.message);
        restoredIds.add(row.original_id);
        restoredNames.push(snap.title);
        if (snap.uploaded_by) {
          try {
            await supabase.rpc("increment_uploaded_quizzes", { p_admin_id: snap.uploaded_by });
          } catch (rpcErr) {
            console.error("[admin:trash-restore] increment_uploaded_quizzes failed:", rpcErr.message || rpcErr);
          }
        }
      }
    } catch (e) {
      failures.push({ name: row.snapshot?.name || row.snapshot?.title || "?", reason: e.message });
    }
  }

  // Only remove trash_items rows that were actually restored — a failure
  // (e.g. parent course purged) leaves that row in trash so nothing is
  // silently lost.
  const restoredTrashRowIds = sorted
    .filter((row) => restoredIds.has(row.original_id))
    .map((row) => row.id);
  if (restoredTrashRowIds.length) {
    await supabase.from("trash_items").delete().in("id", restoredTrashRowIds);
  }

  return res.status(failures.length && !restoredNames.length ? 500 : 200).json({
    success: restoredNames.length > 0,
    restored: restoredNames.length,
    failed: failures,
  });
}

// ── action=trash-empty ───────────────────────────────────────────────────────
// Body: { trashItemId } (purge one item + its batch) OR { all: true } (purge
// everything in the caller's scope). Permanently deletes trash_items rows
// AND cleans up any associated quiz media.
async function handleTrashEmpty(req, res, adminPayload, adminId, supabase) {
  const { trashItemId, all } = req.body || {};

  if (!trashItemId && !all) {
    return res.status(400).json({ error: "حدد عنصراً للحذف النهائي أو استخدم all لإفراغ السلة." });
  }

  let rowsToPurge = [];

  if (trashItemId) {
    const { data: anchor } = await supabase.from("trash_items").select("*").eq("id", trashItemId).maybeSingle();
    if (!anchor) return res.status(404).json({ error: "العنصر غير موجود في سلة المهملات." });
    if (!isAuthorizedForItem(adminPayload, adminId, { creatorId: anchor.deleted_by, educationType: anchor.education_type })) {
      return res.status(403).json({ error: "ليس لديك صلاحية لحذف هذا العنصر نهائياً." });
    }
    const { data: batchRows } = await supabase.from("trash_items").select("*").eq("batch_id", anchor.batch_id);
    rowsToPurge = batchRows || [anchor];
  } else {
    let query = supabase.from("trash_items").select("*");
    if (!adminPayload.isOwner) {
      if (!adminPayload.allowed_scopes?.length) {
        // A non-owner admin with no scopes and no owned items has nothing
        // they're authorized to bulk-empty — require at least one of those
        // rather than silently purging nothing (which would look like a
        // no-op bug) or everything (a privilege escalation).
        const { data: ownRows } = await supabase.from("trash_items").select("*").eq("deleted_by", adminId);
        rowsToPurge = ownRows || [];
      } else {
        const { data } = await query.in("education_type", adminPayload.allowed_scopes);
        rowsToPurge = data || [];
      }
    } else {
      const { data } = await query;
      rowsToPurge = data || [];
    }
  }

  if (rowsToPurge.length === 0) {
    return res.status(200).json({ success: true, purged: 0 });
  }

  const quizSnapshots = rowsToPurge
    .filter((row) => row.item_type === "quiz")
    .map((row) => row.snapshot?.data)
    .filter(Boolean);
  await purgeQuizMedia(supabase, quizSnapshots);

  const ids = rowsToPurge.map((row) => row.id);
  const { error: deleteErr } = await supabase.from("trash_items").delete().in("id", ids);
  if (deleteErr) {
    console.error("[admin:trash-empty] failed:", deleteErr.message);
    return res.status(500).json({ error: "فشل الحذف النهائي. حاول مجددًا." });
  }

  return res.status(200).json({ success: true, purged: ids.length });
}

// ── action=trash-settings ────────────────────────────────────────────────────
// GET-like (no body beyond action) returns the current retention window;
// providing { retentionDays } updates it. Owner-only — a platform-wide knob,
// not a per-item action.
async function handleTrashSettings(req, res, adminPayload, adminId, supabase) {
  const { retentionDays } = req.body || {};

  if (retentionDays === undefined) {
    const days = await getTrashRetentionDays(supabase);
    return res.status(200).json({ retentionDays: days });
  }

  if (!adminPayload.isOwner) {
    return res.status(403).json({ error: "فقط المالك يمكنه تعديل مدة الاحتفاظ." });
  }

  const days = Number(retentionDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return res.status(400).json({ error: "مدة الاحتفاظ يجب أن تكون بين 1 و 365 يوماً." });
  }

  const { error } = await supabase
    .from("admin_settings")
    .update({ trash_retention_days: days, updated_by: adminId, updated_at: new Date().toISOString() })
    .eq("id", true);

  if (error) {
    console.error("[admin:trash-settings] failed:", error.message);
    return res.status(500).json({ error: "فشل تحديث الإعداد." });
  }

  return res.status(200).json({ success: true, retentionDays: days });
}

// ── action=delete-folder / delete-course ─────────────────────────────────────
// Soft-deletes the folder/course itself AND cascades to every quiz/subfolder
// nested under it (to any depth), all sharing one batch_id so the whole tree
// restores or purges together (see api/_trash.js#collectCascadeItems and the
// migration's batch_id comment).
async function handleDeleteTree(req, res, adminPayload, adminId, supabase, itemType) {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "معرف العنصر مطلوب." });

  const fetched = await fetchItemForAuth(supabase, itemType, id);
  if (!fetched) return res.status(404).json({ error: "العنصر غير موجود." });

  if (!isAuthorizedForItem(adminPayload, adminId, { creatorId: fetched.creatorId, educationType: fetched.educationType })) {
    return res.status(403).json({ error: "ليس لديك صلاحية لحذف هذا العنصر." });
  }

  const { folders, quizzes } =
    itemType === "course"
      ? await collectCascadeItems(supabase, { courseId: id })
      : await collectCascadeItems(supabase, { folderId: id });

  const retentionDays = await getTrashRetentionDays(supabase);
  const expiresAt = computeExpiresAt(retentionDays);
  // One shared batch_id groups the root item + every cascaded descendant so
  // they can be restored (or purged) together as a unit.
  const batchId = crypto.randomUUID();

  const trashRows = [];

  if (itemType === "course") {
    trashRows.push({
      item_type: "course",
      original_id: fetched.row.id,
      snapshot: fetched.row,
      parent_folder_id: null,
      course_id: null,
      education_type: fetched.row.education_type,
      batch_id: batchId,
      deleted_by: adminId,
      expires_at: expiresAt,
    });
  } else {
    trashRows.push({
      item_type: "folder",
      original_id: fetched.row.id,
      snapshot: {
        id: fetched.row.id,
        course_id: fetched.row.course_id,
        parent_folder_id: fetched.row.parent_folder_id,
        name: fetched.row.name,
        icon: fetched.row.icon,
        created_by: fetched.row.created_by,
        created_at: fetched.row.created_at,
        updated_at: fetched.row.updated_at,
      },
      parent_folder_id: fetched.row.parent_folder_id,
      course_id: fetched.row.course_id,
      education_type: fetched.educationType,
      batch_id: batchId,
      deleted_by: adminId,
      expires_at: expiresAt,
    });
  }

  for (const folder of folders) {
    trashRows.push({
      item_type: "folder",
      original_id: folder.id,
      snapshot: folder,
      parent_folder_id: folder.parent_folder_id,
      course_id: folder.course_id,
      education_type: fetched.educationType,
      batch_id: batchId,
      deleted_by: adminId,
      expires_at: expiresAt,
    });
  }

  for (const quiz of quizzes) {
    trashRows.push({
      item_type: "quiz",
      original_id: quiz.id,
      snapshot: quiz,
      parent_folder_id: quiz.folder_id || null,
      course_id: quiz.course_id || null,
      education_type: quiz.education_type || fetched.educationType,
      batch_id: batchId,
      deleted_by: adminId,
      expires_at: expiresAt,
    });
  }

  const { error: insertErr } = await supabase.from("trash_items").insert(trashRows);
  if (insertErr) {
    console.error(`[admin:delete-${itemType}] trash insert failed:`, insertErr.message);
    return res.status(500).json({ error: "فشل نقل العنصر إلى سلة المهملات." });
  }

  // Delete children first (FKs point up: quizzes/folders reference the
  // course/parent folder), then the root item itself.
  const quizIds = quizzes.map((q) => q.id);
  const folderIds = folders.map((f) => f.id);

  if (quizIds.length) {
    const { error } = await supabase.from("quizzes").delete().in("id", quizIds);
    if (error) console.error(`[admin:delete-${itemType}] quiz cascade delete failed:`, error.message);
  }
  if (folderIds.length) {
    // Delete deepest folders first so parent_folder_id FKs never point at an
    // already-deleted row mid-batch — folders were collected breadth-first
    // (parent before child), so deleting in reverse order is child-before-parent.
    const { error } = await supabase.from("folders").delete().in("id", [...folderIds].reverse());
    if (error) console.error(`[admin:delete-${itemType}] folder cascade delete failed:`, error.message);
  }

  const { error: rootDeleteErr } = await supabase.from(itemType === "course" ? "courses" : "folders").delete().eq("id", id);
  if (rootDeleteErr) {
    console.error(`[admin:delete-${itemType}] root delete failed:`, rootDeleteErr.message);
    return res.status(500).json({ error: "فشل حذف العنصر الأساسي بعد نقل محتوياته لسلة المهملات." });
  }

  return res.status(200).json({
    success: true,
    trashed: true,
    cascaded: { folders: folders.length, quizzes: quizzes.length },
  });
}

// ── action=move-item ──────────────────────────────────────────────────────────
// Body: { itemType: 'quiz'|'folder', itemId, targetFolderId, targetCourseId }
// targetFolderId null = move directly under targetCourseId (root of that
// course). Courses themselves are never move-item targets (see
// canPlaceItemServer) — they're always top-level.
async function handleMoveItem(req, res, adminPayload, adminId, supabase) {
  const { itemType, itemId, targetFolderId = null, targetCourseId } = req.body || {};

  if (!itemType || !itemId || !targetCourseId) {
    return res.status(400).json({ error: "بيانات النقل غير مكتملة." });
  }
  if (itemType !== "quiz" && itemType !== "folder") {
    return res.status(400).json({ error: "لا يمكن نقل هذا النوع من العناصر." });
  }

  const placement = canPlaceItemServer(itemType, targetFolderId);
  if (!placement.ok) return res.status(400).json({ error: placement.error });

  const fetched = await fetchItemForAuth(supabase, itemType, itemId);
  if (!fetched) return res.status(404).json({ error: "العنصر غير موجود." });

  if (!isAuthorizedForItem(adminPayload, adminId, { creatorId: fetched.creatorId, educationType: fetched.educationType })) {
    return res.status(403).json({ error: "ليس لديك صلاحية لنقل هذا العنصر." });
  }

  // Confirm the destination actually exists and belongs to the target course
  // (prevents moving a quiz "into" a folder that lives in a different course
  // than targetCourseId claims, which would corrupt the tree).
  const { data: targetCourse } = await supabase.from("courses").select("id").eq("id", targetCourseId).maybeSingle();
  if (!targetCourse) return res.status(404).json({ error: "المادة الوجهة غير موجودة." });

  if (targetFolderId) {
    const { data: targetFolder } = await supabase
      .from("folders")
      .select("id, course_id")
      .eq("id", targetFolderId)
      .maybeSingle();
    if (!targetFolder) return res.status(404).json({ error: "المجلد الوجهة غير موجود." });
    if (targetFolder.course_id !== targetCourseId) {
      return res.status(400).json({ error: "المجلد الوجهة لا ينتمي إلى المادة المحددة." });
    }
  }

  // Prevent moving a folder into its own descendant (would create a cycle).
  if (itemType === "folder" && targetFolderId) {
    let cursor = targetFolderId;
    const seen = new Set();
    while (cursor) {
      if (cursor === itemId) {
        return res.status(400).json({ error: "لا يمكن نقل مجلد إلى داخل نفسه أو أحد مجلداته الفرعية." });
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const { data: parent } = await supabase.from("folders").select("parent_folder_id").eq("id", cursor).maybeSingle();
      cursor = parent?.parent_folder_id || null;
    }
  }

  const table = itemType === "quiz" ? "quizzes" : "folders";
  const updates =
    itemType === "quiz"
      ? { course_id: targetCourseId, folder_id: targetFolderId }
      : { course_id: targetCourseId, parent_folder_id: targetFolderId };

  const { error } = await supabase.from(table).update(updates).eq("id", itemId);
  if (error) {
    console.error("[admin:move-item] failed:", error.message);
    return res.status(500).json({ error: "فشل نقل العنصر." });
  }

  // Moving a folder into a DIFFERENT course must cascade the new course_id
  // to every descendant folder and quiz. The DB consistency triggers
  // (folders_enforce_course_consistency / quizzes_enforce_course_consistency
  // in 20260901195646_courses_and_folders.sql) only fire on the row being
  // written — they would NOT rewrite the moved folder's children, leaving
  // them with a stale course_id (which both breaks "everything in this
  // course" queries and would fail on any later write to those children).
  //
  // collectCascadeItems returns folders breadth-first (parent before child),
  // so each descendant is updated only after its own parent already has the
  // new course_id — updating them one-by-one in that order (rather than a
  // single .in() batch) keeps folders_enforce_course_consistency happy: it
  // re-reads the parent's course_id from the live table on every row write,
  // so a batch with unspecified row order could intermittently trip it.
  if (itemType === "folder") {
    const { folders: childFolders, quizzes: childQuizzes } =
      await collectCascadeItems(supabase, { folderId: itemId });

    for (const childFolder of childFolders) {
      const { error: folderCascadeErr } = await supabase
        .from("folders")
        .update({ course_id: targetCourseId, updated_at: new Date().toISOString() })
        .eq("id", childFolder.id);
      if (folderCascadeErr) {
        console.error("[admin:move-item] folder course cascade failed:", folderCascadeErr.message);
        return res.status(500).json({ error: "فشل نقل المجلدات الفرعية التابعة. حاول مجددًا." });
      }
    }

    const childQuizIds = childQuizzes.map((q) => q.id);
    if (childQuizIds.length) {
      const { error: quizCascadeErr } = await supabase
        .from("quizzes")
        .update({ course_id: targetCourseId })
        .in("id", childQuizIds);
      if (quizCascadeErr) {
        console.error("[admin:move-item] quiz course cascade failed:", quizCascadeErr.message);
        return res.status(500).json({ error: "فشل نقل الامتحانات التابعة. حاول مجددًا." });
      }
    }
  }

  return res.status(200).json({ success: true });
}

// ── action=rename-item ────────────────────────────────────────────────────────
// Body: { itemType: 'quiz'|'folder'|'course', itemId, newName }
// Quizzes are renamed via their `title` column (meta.title inside `data` is
// left as-is — the manifest/render paths read the column, not the JSONB
// field, for title; see quizManifest.js). Folders/courses use `name`.
async function handleRenameItem(req, res, adminPayload, adminId, supabase) {
  const { itemType, itemId, newName } = req.body || {};
  if (!itemType || !itemId) return res.status(400).json({ error: "بيانات إعادة التسمية غير مكتملة." });

  const nameCheck = validateItemName(newName);
  if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });

  const fetched = await fetchItemForAuth(supabase, itemType, itemId);
  if (!fetched) return res.status(404).json({ error: "العنصر غير موجود." });

  if (!isAuthorizedForItem(adminPayload, adminId, { creatorId: fetched.creatorId, educationType: fetched.educationType })) {
    return res.status(403).json({ error: "ليس لديك صلاحية لإعادة تسمية هذا العنصر." });
  }

  if (itemType === "quiz") {
    const updatedData = { ...fetched.row.data, meta: { ...fetched.row.data?.meta, title: nameCheck.clean } };
    const { error } = await supabase
      .from("quizzes")
      .update({ title: nameCheck.clean, data: updatedData })
      .eq("id", itemId);
    if (error) {
      console.error("[admin:rename-item] quiz rename failed:", error.message);
      return res.status(500).json({ error: "فشل إعادة تسمية الامتحان." });
    }
  } else {
    const table = itemType === "folder" ? "folders" : "courses";
    const { error } = await supabase
      .from(table)
      .update({ name: nameCheck.clean, updated_at: new Date().toISOString() })
      .eq("id", itemId);
    if (error) {
      console.error("[admin:rename-item] failed:", error.message);
      return res.status(500).json({ error: "فشل إعادة التسمية." });
    }
  }

  return res.status(200).json({ success: true, name: nameCheck.clean });
}

async function handleItemActions(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let payload;
  try {
    payload = requireAdmin(req);
  } catch (err) {
    if (handleAuthError(err, res)) return;
    return res.status(500).json({ error: "Internal server error" });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const adminId = await resolveAdminId(supabase, payload);
  const { action } = req.body || {};

  if (action === "trash-list") return handleTrashList(req, res, payload, adminId, supabase);
  if (action === "trash-restore") return handleTrashRestore(req, res, payload, adminId, supabase);
  if (action === "trash-empty") return handleTrashEmpty(req, res, payload, adminId, supabase);
  if (action === "trash-settings") return handleTrashSettings(req, res, payload, adminId, supabase);
  if (action === "delete-folder") return handleDeleteTree(req, res, payload, adminId, supabase, "folder");
  if (action === "delete-course") return handleDeleteTree(req, res, payload, adminId, supabase, "course");
  if (action === "move-item") return handleMoveItem(req, res, payload, adminId, supabase);
  if (action === "rename-item") return handleRenameItem(req, res, payload, adminId, supabase);

  return res.status(400).json({ error: "Invalid action" });
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
    bio,
    handle,
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

  // Profile description ("bio") — free text, editable any time from the
  // owner's own dashboard. NULL/empty string clears it (matches the
  // displayName/avatarUrl convention above: explicit null wipes the field
  // rather than being ignored).
  if (bio !== undefined) {
    if (bio !== null && typeof bio !== "string") {
      return res.status(400).json({ error: "Invalid bio payload" });
    }
    const cleanBio = bio === null ? null : bio.trim();
    if (cleanBio && cleanBio.length > MAX_BIO_LENGTH) {
      return res.status(400).json({
        error: `الوصف طويل جداً (الحد الأقصى ${MAX_BIO_LENGTH} حرف)`,
      });
    }
    updates.bio = cleanBio || null;
  }

  // Handle is claimed via claimHandle() below rather than a plain column
  // update — see api/_handle.js. This needs to happen before the generic
  // `updates` write below (or independently, if it's the only field being
  // changed), since it has its own validation/collision-retry path and its
  // own success/failure response shape.
  let claimedHandle;
  if (handle !== undefined) {
    if (handle === null) {
      return res.status(400).json({ error: "لا يمكن حذف المعرّف" });
    }
    const cleanHandle = slugifyHandle(handle);
    const format = validateHandleFormat(cleanHandle);
    if (!format.valid) {
      return res.status(400).json({ error: format.message });
    }

    // requireAdmin() only gives us the email claim, not the row id — fetch
    // it here (cheap, single lookup) since claimHandle needs the admin's
    // own id both to skip "is this candidate already mine" and to scope
    // the UPDATE.
    const normalizedEmailForId = payload.email
      .trim()
      .toLowerCase()
      .replace(/[%_\\]/g, "\\$&");
    const { data: selfRow, error: selfErr } = await supabaseService
      .from("admin_users")
      .select("id")
      .ilike("email", normalizedEmailForId)
      .maybeSingle();

    if (selfErr || !selfRow) {
      return res.status(404).json({ error: "Admin not found" });
    }

    const { handle: newHandle, error: claimErr } = await claimHandle(
      supabaseService,
      selfRow.id,
      cleanHandle,
      // Editing is a single explicit candidate the user typed, not an
      // auto-derived slug — don't silently rename it to "foo3" behind
      // their back. Only retry to recover from the exact-candidate race
      // with another request; a real conflict should be reported so the
      // user can pick a different handle themselves.
      1,
    );
    if (claimErr) {
      return res.status(409).json({ error: claimErr });
    }
    claimedHandle = newHandle;
  }

  if (Object.keys(updates).length === 0 && claimedHandle === undefined) {
    return res.status(400).json({ error: "Nothing to sync" });
  }

  let updatedHandle = claimedHandle;
  if (Object.keys(updates).length > 0) {
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
    if (updatedHandle === undefined) updatedHandle = updated.handle;
  }

  return res.status(200).json({ synced: true, handle: updatedHandle });
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
        "id, display_name, bio, total_points, passed_quizzes, total_badges, current_level, handle, email, avatar_url, thumbnail_url, uploaded_quizzes, activity_heatmap",
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
        "id, display_name, bio, total_points, passed_quizzes, total_badges, current_level, handle, email, avatar_url, thumbnail_url, uploaded_quizzes, activity_heatmap",
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
              "id, display_name, bio, total_points, passed_quizzes, total_badges, current_level, handle, email, avatar_url, thumbnail_url, uploaded_quizzes, activity_heatmap",
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
    bio: adminUser.bio || null,
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

  // POST: route by body.action — control uses a fixed action set, item
  // actions (trash/move/rename/folder-course delete) use their own set,
  // everything else (progress/avatar/profile sync) goes to stats.
  if (req.method === "POST") {
    const action = req.body && req.body.action;
    if (CONTROL_ACTIONS.has(action)) return handleControl(req, res);
    if (ITEM_ACTIONS.has(action)) return handleItemActions(req, res);
    return handleStats(req, res);
  }

  if (req.method === "OPTIONS") {
    applyCors(req, res);
    return res.status(200).end();
  }

  return res.status(405).json({ error: "Method not allowed" });
}
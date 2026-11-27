// =============================================================================
// api/_notifications.js
// Admin notification center: server-side helpers + the endpoints behind the bell.
// Routed through api/admin.js handleItemActions (no new Vercel function).
//
//   notifications-list        -> { items, unread, hasMore }   body: { limit?, before? }
//   notifications-count       -> { unread }                   (cheap; polled every ~60s)
//   notifications-read        -> { ok }                       body: { ids: [uuid] }
//   notifications-read-all    -> { ok }
//   notifications-delete      -> { ok }                       body: { ids: [uuid] }
//   notifications-broadcast   -> { sent }  owner-only         body: { title, body?, href? }
//
// Rows are only created through push_admin_notification() / broadcast_admin_notification()
// (supabase/migrations/20261127120000_admin_notifications.sql), which also do the
// grouping / de-duplication atomically.
// =============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;

export const NOTIFICATION_ACTIONS = new Set([
  "notifications-list",
  "notifications-count",
  "notifications-read",
  "notifications-read-all",
  "notifications-delete",
  "notifications-broadcast",
]);

/** Internal links only: "/reports" is fine, "//evil.com" and "https://..." are not. */
export function safeHref(href) {
  if (typeof href !== "string") return null;
  const h = href.trim();
  return h.length <= 500 && /^\/([^/\\]|$)/.test(h) ? h : null;
}

/**
 * Stores one notification for one admin. NEVER throws: a failed notification must
 * not fail the upload / report / sign-in that triggered it.
 */
export async function pushNotification(supabase, recipientAdminId, n) {
  if (!recipientAdminId || !n || !n.type || !n.title) return null;
  try {
    const { data, error } = await supabase.rpc("push_admin_notification", {
      p_recipient: recipientAdminId,
      p_type: n.type,
      p_title: String(n.title).slice(0, 200),
      p_body: n.body ? String(n.body).slice(0, 1000) : null,
      p_href: safeHref(n.href),
      p_meta: n.meta && typeof n.meta === "object" ? n.meta : {},
      p_group_key: n.groupKey || null,
      p_dedupe_key: n.dedupeKey || null,
    });
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.error("[notifications] push failed:", e?.message || e);
    return null;
  }
}

/**
 * "Your item is live". Uploads of the same kind merge into ONE unread row (group_key),
 * so a 40-file folder upload shows "40 quizzes uploaded", not 40 rows.
 * @param {"quiz"|"lesson"|"notebook"|"youtube"} kind
 */
export async function notifyUpload(supabase, adminId, kind, { title, href } = {}) {
  return pushNotification(supabase, adminId, {
    type: "upload",
    title: title || kind,
    href,
    meta: { kind, itemTitle: title || "" },
    groupKey: `upload:${kind}`,
  });
}

/** One notification for every admin (announcements, storage warnings). Never throws. */
export async function broadcastNotification(supabase, n) {
  if (!n || !n.type || !n.title) return 0;
  try {
    const { data, error } = await supabase.rpc("broadcast_admin_notification", {
      p_type: n.type,
      p_title: String(n.title).slice(0, 200),
      p_body: n.body ? String(n.body).slice(0, 1000) : null,
      p_href: safeHref(n.href),
      p_meta: n.meta && typeof n.meta === "object" ? n.meta : {},
      p_dedupe_key: n.dedupeKey || null,
    });
    if (error) throw error;
    return Number(data) || 0;
  } catch (e) {
    console.error("[notifications] broadcast failed:", e?.message || e);
    return 0;
  }
}

// ── Endpoints ────────────────────────────────────────────────────────────────

const COLUMNS = "id, type, title, body, href, meta, count, read_at, created_at, updated_at";

function cleanIds(ids) {
  return Array.isArray(ids) ? [...new Set(ids.filter((i) => typeof i === "string" && UUID_RE.test(i)))].slice(0, 100) : [];
}

async function unreadCount(supabase, adminId) {
  const { count, error } = await supabase
    .from("admin_notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_admin_id", adminId)
    .is("read_at", null);
  if (error) throw error;
  return count || 0;
}

export async function handleNotificationAction(req, res, action, payload, adminId, supabase) {
  const body = req.body || {};

  try {
    if (action === "notifications-broadcast") {
      if (!payload?.isOwner) return res.status(403).json({ error: "هذه الصلاحية للمالك فقط." });
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const text = typeof body.body === "string" ? body.body.trim() : "";
      const rawHref = typeof body.href === "string" ? body.href.trim() : "";
      if (!title || title.length > 200) return res.status(400).json({ error: "العنوان مطلوب (حتى 200 حرف)." });
      if (text.length > 1000) return res.status(400).json({ error: "النص طويل جدًا (حتى 1000 حرف)." });
      if (rawHref && !safeHref(rawHref)) return res.status(400).json({ error: "الرابط يجب أن يكون مسارًا داخليًا يبدأ بـ /" });
      const sent = await broadcastNotification(supabase, {
        type: "announcement",
        title,
        body: text,
        href: rawHref || null,
        // Fresh key per announcement: two different announcements must both arrive.
        dedupeKey: `announcement:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      });
      return res.status(200).json({ sent });
    }

    // An owner without an admin_users row has no inbox; the bell must not error.
    if (!adminId) {
      if (action === "notifications-list") return res.status(200).json({ items: [], unread: 0, hasMore: false });
      if (action === "notifications-count") return res.status(200).json({ unread: 0 });
      return res.status(200).json({ ok: true });
    }

    if (action === "notifications-count") {
      return res.status(200).json({ unread: await unreadCount(supabase, adminId) });
    }

    if (action === "notifications-list") {
      const limit = Math.min(Math.max(parseInt(body.limit, 10) || PAGE_DEFAULT, 1), PAGE_MAX);
      let q = supabase
        .from("admin_notifications")
        .select(COLUMNS)
        .eq("recipient_admin_id", adminId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);
      if (typeof body.before === "string" && !Number.isNaN(Date.parse(body.before))) {
        q = q.lt("updated_at", body.before);
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      const hasMore = rows.length > limit;
      return res.status(200).json({
        items: hasMore ? rows.slice(0, limit) : rows,
        unread: await unreadCount(supabase, adminId),
        hasMore,
      });
    }

    if (action === "notifications-read") {
      const ids = cleanIds(body.ids);
      if (!ids.length) return res.status(400).json({ error: "لا توجد إشعارات محددة." });
      const { error } = await supabase
        .from("admin_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_admin_id", adminId)
        .in("id", ids)
        .is("read_at", null);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === "notifications-read-all") {
      const { error } = await supabase
        .from("admin_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_admin_id", adminId)
        .is("read_at", null);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === "notifications-delete") {
      const ids = cleanIds(body.ids);
      if (!ids.length) return res.status(400).json({ error: "لا توجد إشعارات محددة." });
      const { error } = await supabase
        .from("admin_notifications")
        .delete()
        .eq("recipient_admin_id", adminId)
        .in("id", ids);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
  } catch (e) {
    console.error(`[admin:${action}] failed:`, e?.message || e);
    return res.status(500).json({ error: "تعذّر تحميل الإشعارات." });
  }

  return res.status(400).json({ error: "Invalid action" });
}

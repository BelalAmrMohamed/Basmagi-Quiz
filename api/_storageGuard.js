// =============================================================================
// api/_storageGuard.js
// Admin-only storage endpoints (routed through api/admin.js handleItemActions, so
// no new Vercel function). Every media upload is RESERVED here before bytes move;
// the reservation is what enforces the global cap and per-file limit.
//   storage-usage                  -> { used, cap, maxFile, warnPct, objects }
//   storage-reserve                -> reserve one object (quiz-media direct uploads)
//   storage-release                -> release reservations (failed upload / aborted publish)
//   notebook-asset-upload-urls     -> reserve + signed upload URLs for a publish run
//   storage-orphans-list / -delete -> unreferenced objects (admin cleanup)
// =============================================================================
import { NOTEBOOK_ASSET_MIME, LIMITS } from "../scripts/lib/content-rules.js";

const BUCKETS = new Set(["notebook-assets", "quiz-media"]);
const SHA_RE = /^[0-9a-f]{64}$/;

const REASONS = {
  file_too_large: "الملف أكبر من الحد المسموح لكل ملف (2MB).",
  cap_reached: "تم الوصول إلى حد تخزين الوسائط. تُحفظ الدفاتر والدروس والاختبارات كنص، لكن لا يمكن رفع وسائط جديدة قبل حذف ملفات غير مستخدمة.",
  empty_file: "الملف فارغ.",
};
const reasonText = (r) => REASONS[r.reason] || "تعذر حجز مساحة التخزين.";

export const STORAGE_ACTIONS = new Set([
  "storage-usage", "storage-reserve", "storage-release",
  "notebook-asset-upload-urls", "storage-orphans-list", "storage-orphans-delete",
]);

function publicUrl(bucket, path) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function handleStorageAction(req, res, action, adminId, supabase) {
  const body = req.body || {};
  try {
    if (action === "storage-usage") {
      const { data, error } = await supabase.rpc("storage_usage");
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (action === "storage-reserve") {
      const { bucket, path, size, kind } = body;
      if (!BUCKETS.has(bucket) || typeof path !== "string" || !path || path.length > 300) return res.status(400).json({ error: "طلب غير صالح." });
      const { data, error } = await supabase.rpc("storage_reserve", { p_bucket: bucket, p_path: path, p_size: Number(size), p_kind: kind || "image", p_owner: String(adminId || "") });
      if (error) throw error;
      if (!data.ok) return res.status(413).json({ error: reasonText(data), reason: data.reason });
      return res.status(200).json(data);
    }

    if (action === "storage-release") {
      const { bucket, paths } = body;
      if (!BUCKETS.has(bucket) || !Array.isArray(paths) || paths.length > 200) return res.status(400).json({ error: "طلب غير صالح." });
      const clean = paths.filter((p) => typeof p === "string" && p.length <= 300);
      const { data, error } = await supabase.rpc("storage_release", { p_bucket: bucket, p_paths: clean });
      if (error) throw error;
      // Also remove the bytes if they were uploaded before the abort.
      if (clean.length) await supabase.storage.from(bucket).remove(clean).catch(() => {});
      return res.status(200).json({ released: data });
    }

    if (action === "notebook-asset-upload-urls") {
      const files = Array.isArray(body.files) ? body.files : null;
      if (!files || files.length < 1 || files.length > LIMITS.notebookAssets) return res.status(400).json({ error: "قائمة الملفات غير صالحة." });
      const out = [];
      const reservedNow = [];
      for (const f of files) {
        const ext = String(f?.path || "").split(".").pop().toLowerCase();
        if (!NOTEBOOK_ASSET_MIME[ext] || NOTEBOOK_ASSET_MIME[ext] !== f.mime || !SHA_RE.test(String(f.sha256 || "")) || !Number.isInteger(f.size)) {
          await rollback(supabase, reservedNow);
          return res.status(400).json({ error: `الملف "${f?.path}" غير مسموح به أو بياناته غير صالحة.` });
        }
        // Content-addressed: identical bytes are stored once and shared between notebooks.
        const path = `${f.sha256}.${ext}`;
        const { data, error } = await supabase.rpc("storage_reserve", { p_bucket: "notebook-assets", p_path: path, p_size: f.size, p_kind: "image", p_owner: String(adminId || "") });
        if (error) { await rollback(supabase, reservedNow); throw error; }
        if (!data.ok) { await rollback(supabase, reservedNow); return res.status(413).json({ error: `${f.path}: ${reasonText(data)}`, reason: data.reason }); }
        const item = { path: f.path, storagePath: path, url: publicUrl("notebook-assets", path), exists: !!data.exists };
        if (!data.exists) {
          reservedNow.push(path);
          const { data: signed, error: sErr } = await supabase.storage.from("notebook-assets").createSignedUploadUrl(path);
          if (sErr) { await rollback(supabase, reservedNow); throw sErr; }
          item.token = signed.token;
        }
        out.push(item);
      }
      return res.status(200).json({ files: out });
    }

    if (action === "storage-orphans-list") {
      const { data, error } = await supabase.rpc("storage_orphans");
      if (error) throw error;
      return res.status(200).json({ orphans: data || [], bytes: (data || []).reduce((n, o) => n + Number(o.size), 0) });
    }

    if (action === "storage-orphans-delete") {
      const { data, error } = await supabase.rpc("storage_orphans");
      if (error) throw error;
      let removed = 0;
      for (const bucket of BUCKETS) {
        const paths = (data || []).filter((o) => o.bucket === bucket).map((o) => o.path);
        if (!paths.length) continue;
        const { error: rErr } = await supabase.storage.from(bucket).remove(paths);
        if (rErr) { console.error("[storage-orphans] remove failed:", rErr.message); continue; }
        await supabase.rpc("storage_release", { p_bucket: bucket, p_paths: paths });
        removed += paths.length;
      }
      return res.status(200).json({ removed });
    }
  } catch (e) {
    console.error(`[admin:${action}] failed:`, e?.message || e);
    return res.status(500).json({ error: "فشلت عملية التخزين." });
  }
  return res.status(400).json({ error: "Invalid action" });
}

async function rollback(supabase, paths) {
  if (!paths.length) return;
  await supabase.rpc("storage_release", { p_bucket: "notebook-assets", p_paths: paths }).catch(() => {});
}

/** Daily cron (Vercel sends `Authorization: Bearer $CRON_SECRET`): removes expired MCP drafts and their temporary files. */
export async function handleCronPurge(req, res, supabase) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });
  try {
    await supabase.from("import_drafts").delete().lt("expires_at", new Date().toISOString());
    const { data, error } = await supabase.rpc("draft_assets_to_purge");
    if (error) throw error;
    const paths = (data || []).map((r) => r.path);
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      await supabase.storage.from("draft-assets").remove(chunk);
      await supabase.rpc("storage_release", { p_bucket: "draft-assets", p_paths: chunk });
    }
    return res.status(200).json({ purged: paths.length });
  } catch (e) {
    console.error("[cron:purge-drafts] failed:", e?.message || e);
    return res.status(500).json({ error: "purge failed" });
  }
}

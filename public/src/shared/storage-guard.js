// =============================================================================
// public/src/shared/storage-guard.js
// Client side of the global media-storage guard (admin only; see api/_storageGuard.js).
// Normal students never upload, so they never reach this file.
// =============================================================================
import { getToken } from "./adminAuth.js";

async function call(body) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || "تعذر تنفيذ العملية."); e.reason = data.reason; throw e; }
  return data;
}

/** Reserves space BEFORE uploading; throws a readable Error when the cap/limit refuses. */
export const reserveStorage = (bucket, path, size, kind = "image") => call({ action: "storage-reserve", bucket, path, size, kind });
/** Frees a reservation (and removes the object if it was uploaded). Never throws. */
export const releaseStorage = (bucket, paths) => call({ action: "storage-release", bucket, paths }).catch(() => null);
export const fetchStorageUsage = () => call({ action: "storage-usage" });
export const listOrphans = () => call({ action: "storage-orphans-list" });
export const deleteOrphans = () => call({ action: "storage-orphans-delete" });
export const requestNotebookUploads = (files) => call({ action: "notebook-asset-upload-urls", files });

const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);

/** Admin-only usage meter; turns into a warning banner from warnPct on. */
export async function mountStorageBanner(el) {
  if (!el) return;
  try {
    const u = await fetchStorageUsage();
    const pct = Math.min(100, Math.round((u.used / u.cap) * 100));
    el.hidden = false;
    el.className = "storage-banner" + (pct >= u.warnPct ? " storage-banner--warn" : "");
    el.textContent = pct >= 100
      ? `مخزن الوسائط ممتلئ (${mb(u.used)}MB من ${mb(u.cap)}MB). الرفع متوقف حتى تحذف ملفات غير مستخدمة.`
      : pct >= u.warnPct
        ? `تنبيه: مخزن الوسائط ${pct}% (${mb(u.used)}MB من ${mb(u.cap)}MB). نظّف الملفات غير المستخدمة قريباً.`
        : `مخزن الوسائط: ${mb(u.used)}MB من ${mb(u.cap)}MB (${pct}%).`;
  } catch { el.hidden = true; }
}

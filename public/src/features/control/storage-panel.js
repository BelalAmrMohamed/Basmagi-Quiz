// Admin-only media storage panel on /control: usage meter + unused-file cleanup.
import { mountStorageBanner, listOrphans, deleteOrphans } from "../../shared/storage-guard.js";
import { isAdminAuthenticated } from "../../shared/adminAuth.js";

const $ = (id) => document.getElementById(id);
const mb = (n) => (n / 1048576).toFixed(1);

async function refresh() { await mountStorageBanner($("storageMeter")); }

async function cleanup() {
  const btn = $("storageCleanBtn");
  btn.disabled = true;
  try {
    const { orphans, bytes } = await listOrphans();
    if (!orphans.length) { $("storageCleanMsg").textContent = "لا توجد ملفات غير مستخدمة."; return; }
    if (!confirm(`سيتم حذف ${orphans.length} ملف غير مستخدم (${mb(bytes)}MB) نهائياً. متابعة؟`)) return;
    const { removed } = await deleteOrphans();
    $("storageCleanMsg").textContent = `تم حذف ${removed} ملف.`;
    await refresh();
  } catch (e) { $("storageCleanMsg").textContent = e.message; }
  finally { btn.disabled = false; }
}

if (isAdminAuthenticated() && $("storageSection")) {
  $("storageSection").hidden = false;
  $("storageCleanBtn").addEventListener("click", cleanup);
  void refresh();
}

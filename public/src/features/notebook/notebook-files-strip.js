// =============================================================================
// public/src/features/notebook/notebook-files-strip.js
// "My files" strip shown above the notebook (reading, new and edit modes): folder sync,
// Google Drive import and Drive backup. Everything is optional and runs in the browser;
// folder-sync.js / google-drive.js are loaded only when the user clicks.
// =============================================================================
import { routeFile, workspaceMime } from "../../shared/runtime-config.js";
import { folderSyncSupported, hasSavedRoot } from "../../shared/folder-sync.js";
import { buildNotebookBundle } from "../../shared/notebook-bundle.js";

const T = {
  en: { folder: "Connect folder", syncNow: "Sync folder", folderOff: "Disconnect folder", drive: "Import from Drive", backup: "Back up to Drive", driveOff: "Disconnect Drive",
    saveFirst: "Save the notebook first to sync its files.", synced: (a, b) => `Folder synced (${a} to folder, ${b} to browser).`, importTitle: "Import from Google Drive", importBtn: "Import", cancel: "Cancel",
    toCells: "→ notebook cells", toWs: "→ workspace files", toBundle: "→ notebook bundle", unsupported: "not supported yet", ifContent: "The notebook already has content:", append: "Append", replace: "Replace",
    done: (n) => `Imported ${n} file(s).`, none: "No importable files selected.", backedUp: "Backed up to Google Drive.", err: "Something went wrong", delBrowser: (n) => `These files were removed from the folder:\n${n}\n\nDelete them from the browser too? (Cancel keeps them)`, delDisk: (n) => `These files were deleted in the browser:\n${n}\n\nDelete them from the folder too? (Cancel keeps them)`, noCode: "Open the notebook editor to import code files." },
  ar: { folder: "ربط مجلد", syncNow: "مزامنة المجلد", folderOff: "فصل المجلد", drive: "استيراد من Drive", backup: "نسخ احتياطي إلى Drive", driveOff: "فصل Drive",
    saveFirst: "احفظ الدفتر أولاً لمزامنة ملفاته.", synced: (a, b) => `تمت المزامنة (${a} إلى المجلد، ${b} إلى المتصفح).`, importTitle: "الاستيراد من Google Drive", importBtn: "استيراد", cancel: "إلغاء",
    toCells: "← خلايا الدفتر", toWs: "← ملفات مساحة العمل", toBundle: "← حزمة دفتر", unsupported: "غير مدعوم حالياً", ifContent: "الدفتر يحتوي على محتوى:", append: "إضافة", replace: "استبدال",
    done: (n) => `تم استيراد ${n} ملف.`, none: "لا توجد ملفات قابلة للاستيراد.", backedUp: "تم النسخ الاحتياطي إلى Google Drive.", err: "حدث خطأ", delBrowser: (n) => `هذه الملفات حُذفت من المجلد:\n${n}\n\nهل تحذفها من المتصفح أيضاً؟ (إلغاء = إبقاؤها)`, delDisk: (n) => `هذه الملفات حُذفت من المتصفح:\n${n}\n\nهل تحذفها من المجلد أيضاً؟ (إلغاء = إبقاؤها)`, noCode: "افتح محرر الدفتر لاستيراد ملفات الكود." },
};

const BACKUP_IDS = "basmagi_drive_backups"; // { workspaceKey: driveFileId } (file ids only)
const readIds = () => { try { return JSON.parse(localStorage.getItem(BACKUP_IDS) || "{}"); } catch { return {}; } };

/**
 * @param {{ before: HTMLElement, lang: "ar"|"en", bridge, getMeta: () => {title,description,source,runtime,language,cells,assets?},
 *           importCode?: (file: File, o: {append: boolean}) => Promise<void>, importBundle?: (file: File) => Promise<void>, hasContent?: () => boolean }} ctx
 */
export function mountFilesStrip(ctx) {
  const t = T[ctx.lang === "ar" ? "ar" : "en"];
  const el = document.createElement("div");
  el.className = "nb-files-strip";
  el.dir = ctx.lang === "ar" ? "rtl" : "ltr";
  const status = Object.assign(document.createElement("span"), { className: "nb-files-status" });
  status.setAttribute("role", "status");
  const say = (m) => { status.textContent = m || ""; };
  const mk = (label, onClick) => { const b = Object.assign(document.createElement("button"), { type: "button", textContent: label }); b.addEventListener("click", async () => { b.disabled = true; try { await onClick(); } catch (e) { say(e?.message === "NOT_CONNECTED" ? "" : `${t.err}: ${e?.message || e}`); } finally { b.disabled = false; } }); return b; };

  // ── folder sync ──
  let folderBtn = null, folderOff = null, syncing = false, timer = null;
  async function runSync({ request }) {
    if (syncing) return;
    const fs = await import("../../shared/folder-sync.js");
    const root = await fs.getRoot({ request });
    if (!root) return;
    if (ctx.bridge.key === "draft") { say(t.saveFirst); return; }
    syncing = true;
    try {
      const m = ctx.getMeta();
      const r = await fs.syncNotebook({
        root, key: ctx.bridge.key, title: m.title, runtime: m.runtime,
        confirmDelete: async (where, names) => confirm((where === "browser" ? t.delBrowser : t.delDisk)(names.join("\n"))),
        onApplied: (files) => ctx.bridge.loadIntoRuntime(files),
      });
      say(t.synced(r.toDisk, r.toBrowser));
    } finally { syncing = false; }
  }
  if (folderSyncSupported()) {
    folderBtn = mk(t.folder, async () => {
      const fs = await import("../../shared/folder-sync.js");
      if (await fs.hasSavedRoot()) { await runSync({ request: true }); return; }
      await fs.pickRoot();
      folderBtn.textContent = t.syncNow; folderOff.hidden = false;
      await runSync({ request: true });
    });
    folderOff = mk(t.folderOff, async () => { await (await import("../../shared/folder-sync.js")).clearRoot(); folderBtn.textContent = t.folder; folderOff.hidden = true; say(""); });
    folderOff.hidden = true;
    el.append(folderBtn, folderOff);
    hasSavedRoot().then((has) => { if (has) { folderBtn.textContent = t.syncNow; folderOff.hidden = false; void runSync({ request: false }).catch(() => {}); } });
    ctx.bridge.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => { if (!folderOff.hidden) void runSync({ request: false }).catch(() => {}); }, 1200); });
  }

  // ── Google Drive ──
  let driveOff = null;
  const ensureDrive = async () => {
    const g = await import("../../shared/google-drive.js");
    if (!g.driveConnected()) { await g.connectDrive(); driveOff.hidden = false; }
    return g;
  };
  const importBtn = mk(t.drive, async () => {
    const g = await ensureDrive();
    const picked = await g.pickDriveFiles();
    if (picked.length) await importDialog(g, picked);
  });
  const backupBtn = mk(t.backup, () => backup({ silent: false }));
  driveOff = mk(t.driveOff, async () => { (await import("../../shared/google-drive.js")).disconnectDrive(); driveOff.hidden = true; say(""); });
  driveOff.hidden = true;

  async function backup({ silent }) {
    const g = silent ? await import("../../shared/google-drive.js") : await ensureDrive();
    if (!g.driveConnected()) return; // auto-backup never opens a popup
    if (ctx.bridge.key === "draft") { if (!silent) say(t.saveFirst); return; }
    const m = ctx.getMeta();
    const { blob, fileName } = await buildNotebookBundle({ ...m, keys: [ctx.bridge.key], assets: m.assets || [] });
    const ids = readIds();
    ids[ctx.bridge.key] = await g.backupToDrive({ blob, fileName, fileId: ids[ctx.bridge.key] });
    try { localStorage.setItem(BACKUP_IDS, JSON.stringify(ids)); } catch { /* ignore */ }
    say(t.backedUp);
  }

  async function importDialog(g, picked) {
    const runtime = ctx.getMeta().runtime;
    const rows = picked.map((f) => ({ f, route: routeFile(runtime, f.name) })).map((r) => ({ ...r, route: r.route === "code" && !ctx.importCode ? "unsupported" : r.route === "bundle" && !ctx.importBundle ? "unsupported" : r.route }));
    const dlg = document.createElement("dialog");
    dlg.className = "nb-files-dialog"; dlg.dir = el.dir;
    const h = Object.assign(document.createElement("h3"), { textContent: t.importTitle });
    const list = document.createElement("div");
    const label = { code: t.toCells, workspace: t.toWs, bundle: t.toBundle, unsupported: t.unsupported };
    const checks = rows.map((r) => {
      const row = document.createElement("label"); row.className = "nb-files-row";
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: r.route !== "unsupported", disabled: r.route === "unsupported" });
      const name = Object.assign(document.createElement("span"), { textContent: `${r.f.name} (${Math.max(1, Math.round(r.f.size / 1024))} KB)` });
      const dest = Object.assign(document.createElement("em"), { textContent: label[r.route] });
      row.append(cb, name, dest); list.append(row); return cb;
    });
    const needsAsk = rows.some((r) => r.route === "code") && ctx.hasContent?.();
    const modeBox = document.createElement("div");
    if (needsAsk) {
      modeBox.className = "nb-files-mode"; modeBox.append(document.createTextNode(`${t.ifContent} `));
      for (const [v, l] of [["append", t.append], ["replace", t.replace]]) {
        const lab = document.createElement("label"); const rb = Object.assign(document.createElement("input"), { type: "radio", name: "nbImpMode", value: v, checked: v === "append" });
        lab.append(rb, document.createTextNode(` ${l} `)); modeBox.append(lab);
      }
    }
    const actions = document.createElement("div"); actions.className = "nb-files-actions";
    const ok = Object.assign(document.createElement("button"), { type: "button", textContent: t.importBtn });
    const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: t.cancel });
    cancel.onclick = () => dlg.close();
    ok.onclick = async () => {
      ok.disabled = true;
      const chosen = rows.filter((_, i) => checks[i].checked);
      if (!chosen.length) { say(t.none); dlg.close(); return; }
      const replace = dlg.querySelector('input[name="nbImpMode"]:checked')?.value === "replace";
      let n = 0, firstCode = true;
      try {
        for (const r of chosen) {
          const blob = await g.downloadDriveFile(r.f.id);
          const file = new File([blob], r.f.name, { type: r.route === "workspace" ? workspaceMime(r.f.name) : blob.type });
          if (r.route === "workspace") await ctx.bridge.addFiles([file]);
          else if (r.route === "code") { await ctx.importCode(file, { append: !(replace && firstCode) && (ctx.hasContent?.() ?? false) }); firstCode = false; }
          else if (r.route === "bundle") await ctx.importBundle(file);
          n++;
        }
        say(t.done(n));
      } catch (e) { say(`${t.err}: ${e?.message || e}`); }
      dlg.close();
    };
    actions.append(ok, cancel);
    dlg.append(h, list, modeBox, actions);
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  el.append(importBtn, backupBtn, driveOff, status);
  ctx.before.before(el);
  window.__nbFilesStrip = { backup: (o) => backup(o || { silent: true }).catch(() => {}) };
  return el;
}

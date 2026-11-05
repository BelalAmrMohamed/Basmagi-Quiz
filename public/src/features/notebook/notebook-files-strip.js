// =============================================================================
// public/src/features/notebook/notebook-files-strip.js
// Folder sync + Google Drive import / backup for notebooks (reading, new and edit modes).
//   * "Import from Drive" and "Back up to Drive" live in the runtime's toolbar menu (.toolbar-menu-items).
//     The runtime is a prebuilt bundle, so the items are injected here and re-injected whenever it re-renders.
//   * The strip above the notebook only holds folder sync, "Disconnect Drive" and a feedback card that says
//     exactly what was done and where (file name + links).
// Everything is optional and runs in the browser; folder-sync.js / google-drive.js load on first click.
// =============================================================================
import { routeFile, workspaceMime } from "../../shared/runtime-config.js";
import { folderSyncSupported, hasSavedRoot } from "../../shared/folder-sync.js";
import { buildNotebookBundle } from "../../shared/notebook-bundle.js";

const ICON = "/assets/images/google-drive-icon.webp";

const T = {
  en: { folder: "Connect folder", syncNow: "Sync folder", folderOff: "Disconnect folder", drive: "Import from Drive", backup: "Back up to Drive", driveOff: "Disconnect Drive",
    saveFirst: "Save the notebook first to sync its files.", synced: (a, b) => `Folder synced (${a} to folder, ${b} to browser).`, importTitle: "Import from Google Drive", importBtn: "Import", cancel: "Cancel",
    toCells: "→ notebook cells", toWs: "→ workspace files", toBundle: "→ notebook bundle", unsupported: "not supported yet", bundleHere: "open /notebook/new to import bundles", ifContent: "The notebook already has content:", append: "Append", replace: "Replace",
    none: "No importable files selected.", err: "Something went wrong", delBrowser: (n) => `These files were removed from the folder:\n${n}\n\nDelete them from the browser too? (Cancel keeps them)`, delDisk: (n) => `These files were deleted in the browser:\n${n}\n\nDelete them from the folder too? (Cancel keeps them)`,
    connecting: "Connecting to Google Drive…", backingUp: "Backing up to Google Drive…", loadingList: "Loading your backups from Google Drive…", importing: "Importing from Google Drive…",
    backedUpTitle: "Backed up to Google Drive", backedUpNew: (n, f) => `Created “${n}” in the “${f}” folder.`, backedUpUpd: (n, f) => `Updated “${n}” in the “${f}” folder.`, openFile: "Open file", openFolder: "Open folder",
    backedUpShort: (n, f) => `Backed up to Drive: “${n}” in “${f}”.`,
    importedTitle: (n) => `Imported ${n} file(s) from Google Drive`, importedFail: (n) => `Could not import: ${n}`, hint: "Your notebook backups on Google Drive:", noBackups: "No backups found yet. Use “Back up to Drive” first, or browse Drive.",
    browse: "Browse other Drive files…", listFail: "Could not list your backups.", noAccess: "Google Drive did not allow reading this file with the connected account. Pick it again using the same Google account you connected.", dismiss: "Dismiss" },
  ar: { folder: "ربط مجلد", syncNow: "مزامنة المجلد", folderOff: "فصل المجلد", drive: "استيراد من Drive", backup: "نسخ احتياطي إلى Drive", driveOff: "فصل Drive",
    saveFirst: "احفظ الدفتر أولاً لمزامنة ملفاته.", synced: (a, b) => `تمت المزامنة (${a} إلى المجلد، ${b} إلى المتصفح).`, importTitle: "الاستيراد من Google Drive", importBtn: "استيراد", cancel: "إلغاء",
    toCells: "← خلايا الدفتر", toWs: "← ملفات مساحة العمل", toBundle: "← حزمة دفتر", unsupported: "غير مدعوم حالياً", bundleHere: "افتح /notebook/new لاستيراد الحزم", ifContent: "الدفتر يحتوي على محتوى:", append: "إضافة", replace: "استبدال",
    none: "لا توجد ملفات قابلة للاستيراد.", err: "حدث خطأ", delBrowser: (n) => `هذه الملفات حُذفت من المجلد:\n${n}\n\nهل تحذفها من المتصفح أيضاً؟ (إلغاء = إبقاؤها)`, delDisk: (n) => `هذه الملفات حُذفت من المتصفح:\n${n}\n\nهل تحذفها من المجلد أيضاً؟ (إلغاء = إبقاؤها)`,
    connecting: "جارٍ الاتصال بـ Google Drive…", backingUp: "جارٍ النسخ الاحتياطي إلى Google Drive…", loadingList: "جارٍ تحميل نسخك الاحتياطية من Google Drive…", importing: "جارٍ الاستيراد من Google Drive…",
    backedUpTitle: "تم النسخ الاحتياطي إلى Google Drive", backedUpNew: (n, f) => `تم إنشاء «${n}» داخل المجلد «${f}».`, backedUpUpd: (n, f) => `تم تحديث «${n}» داخل المجلد «${f}».`, openFile: "فتح الملف", openFolder: "فتح المجلد",
    backedUpShort: (n, f) => `نُسخ احتياطياً إلى Drive: «${n}» داخل «${f}».`,
    importedTitle: (n) => `تم استيراد ${n} ملف من Google Drive`, importedFail: (n) => `تعذّر استيراد: ${n}`, hint: "نسخ دفاترك الاحتياطية على Google Drive:", noBackups: "لا توجد نسخ احتياطية بعد. استخدم «نسخ احتياطي إلى Drive» أولاً أو تصفّح Drive.",
    browse: "تصفّح ملفات أخرى من Drive…", listFail: "تعذّر عرض نسخك الاحتياطية.", noAccess: "لم يسمح Google Drive بقراءة هذا الملف بالحساب المتصل. اخترْه مرة أخرى بنفس حساب Google الذي ربطته.", dismiss: "إغلاق" },
};

const BACKUP_IDS = "basmagi_drive_backups"; // { workspaceKey: driveFileId } (file ids only)
const readIds = () => { try { return JSON.parse(localStorage.getItem(BACKUP_IDS) || "{}"); } catch { return {}; } };
const writeIds = (ids) => { try { localStorage.setItem(BACKUP_IDS, JSON.stringify(ids)); } catch { /* ignore */ } };

/**
 * @param {{ before: HTMLElement, lang: "ar"|"en", bridge, getMeta: () => {title,description,source,runtime,language,cells,assets?},
 *           importCode?: (file: File, o: {append: boolean}) => Promise<void>, importBundle?: (file: File) => Promise<void>, hasContent?: () => boolean }} ctx
 */
export function mountFilesStrip(ctx) {
  const t = T[ctx.lang === "ar" ? "ar" : "en"];
  const el = document.createElement("div");
  el.className = "nb-files-strip";
  el.dir = ctx.lang === "ar" ? "rtl" : "ltr";
  el.hidden = true;
  if (ctx.bridge.key === "draft") { const ids = readIds(); if (ids.draft) { delete ids.draft; writeIds(ids); } } // a brand-new notebook never inherits an older draft's backup file

  // ── feedback card: what was done, and where ──
  const card = document.createElement("div");
  card.className = "nb-files-card"; card.hidden = true; card.setAttribute("role", "status"); card.setAttribute("aria-live", "polite");
  let driveOff = null, folderBtn = null, folderOff = null;
  const refresh = () => { el.hidden = !(folderBtn || (driveOff && !driveOff.hidden) || !card.hidden); };
  /** @param {null|{kind?: "info"|"ok"|"err", title?: string, text?: string, links?: {href: string, label: string}[]}} m */
  const show = (m) => {
    card.replaceChildren();
    if (!m) { card.hidden = true; refresh(); return; }
    card.dataset.kind = m.kind || "info"; card.hidden = false;
    const icon = Object.assign(new Image(), { src: ICON, alt: "", width: 22, height: 22 }); icon.setAttribute("aria-hidden", "true");
    const body = document.createElement("div"); body.className = "nb-files-card-body";
    if (m.title) body.append(Object.assign(document.createElement("strong"), { textContent: m.title }));
    if (m.text) body.append(Object.assign(document.createElement("span"), { textContent: m.text }));
    if (m.links?.length) {
      const row = document.createElement("div"); row.className = "nb-files-card-links";
      for (const l of m.links) row.append(Object.assign(document.createElement("a"), { href: l.href, target: "_blank", rel: "noopener noreferrer", textContent: l.label }));
      body.append(row);
    }
    const x = Object.assign(document.createElement("button"), { type: "button", textContent: "×", title: t.dismiss }); x.setAttribute("aria-label", t.dismiss);
    x.addEventListener("click", () => show(null));
    card.append(icon, body, x); refresh();
  };
  const say = (m) => show(m ? { kind: "info", text: m } : null);
  const fail = (e) => { const m = e?.message; show(m === "NOT_CONNECTED" ? null : { kind: "err", title: t.err, text: String(m || e) }); };
  const mk = (label, onClick) => { const b = Object.assign(document.createElement("button"), { type: "button", textContent: label }); b.addEventListener("click", async () => { b.disabled = true; try { await onClick(); } catch (e) { fail(e); } finally { b.disabled = false; } }); return b; };

  // ── folder sync ──
  let syncing = false, timer = null;
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
      folderBtn.textContent = t.syncNow; folderOff.hidden = false; refresh();
      await runSync({ request: true });
    });
    folderOff = mk(t.folderOff, async () => { await (await import("../../shared/folder-sync.js")).clearRoot(); folderBtn.textContent = t.folder; folderOff.hidden = true; say(""); });
    folderOff.hidden = true;
    el.append(folderBtn, folderOff);
    hasSavedRoot().then((has) => { if (has) { folderBtn.textContent = t.syncNow; folderOff.hidden = false; void runSync({ request: false }).catch(() => {}); } });
    ctx.bridge.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => { if (!folderOff.hidden) void runSync({ request: false }).catch(() => {}); }, 1200); });
  }

  // ── Google Drive ──
  driveOff = mk(t.driveOff, async () => { (await import("../../shared/google-drive.js")).disconnectDrive(); driveOff.hidden = true; say(""); });
  driveOff.hidden = true;
  const ensureDrive = async () => {
    const g = await import("../../shared/google-drive.js");
    if (!g.driveConnected()) { show({ kind: "info", text: t.connecting }); await g.connectDrive(); driveOff.hidden = false; }
    return g;
  };

  /**
   * Backs the notebook up as one .notebook.zip in the "Basmagi Notebooks" Drive folder.
   * @param {{silent?: boolean, key?: string, fromDraft?: boolean}} o
   *   silent: auto-backup after saving, never opens a popup (does nothing unless Drive is already connected)
   *   key / fromDraft: the workspace key to read (a notebook just saved under a new id, whose workspace was renamed from "draft")
   * @returns the Drive file info ({ name, link, folderName, folderLink, created }) or null when nothing was backed up
   */
  async function backup({ silent = false, key, fromDraft = false } = {}) {
    const g = silent ? await import("../../shared/google-drive.js") : await ensureDrive();
    if (!g.driveConnected()) return null;
    const k = key || ctx.bridge.key;
    if (!silent) show({ kind: "info", text: t.backingUp });
    const m = ctx.getMeta();
    const { blob, fileName } = await buildNotebookBundle({ ...m, keys: [k], assets: m.assets || [] });
    const ids = readIds();
    const prev = ids[k] || (fromDraft ? ids.draft : undefined); // a draft that was already backed up keeps the same Drive file once saved
    const r = await g.backupToDrive({ blob, fileName, fileId: prev });
    ids[k] = r.id; if (fromDraft) delete ids.draft;
    writeIds(ids);
    const links = [{ href: r.link, label: t.openFile }, { href: r.folderLink, label: t.openFolder }];
    show({ kind: "ok", title: t.backedUpTitle, text: (r.created ? t.backedUpNew : t.backedUpUpd)(r.name, r.folderName), links });
    return r;
  }

  // ── import dialog: your backups first (token only), Google Picker as an extra ──
  const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
  const when = (iso) => { try { return new Date(iso).toLocaleString(ctx.lang === "ar" ? "ar-EG" : undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; } };
  const rowFor = (f, preChecked) => {
    let route = routeFile(ctx.getMeta().runtime, f.name), why = t.unsupported;
    if (route === "code" && !ctx.importCode) route = "unsupported";
    if (route === "bundle" && !ctx.importBundle) { route = "unsupported"; why = t.bundleHere; }
    return { f, route, why, checked: route !== "unsupported" && !!preChecked };
  };

  async function openImport() {
    const g = await ensureDrive();
    show({ kind: "info", text: t.loadingList });
    let backups = [], listErr = null;
    try { backups = await g.listDriveBackups(); } catch (e) { listErr = e; }
    show(null);
    await importDialog(g, backups.map((f) => rowFor(f, false)), listErr);
  }

  function importDialog(g, initialRows, listErr) {
    const rows = [...initialRows];
    const dlg = document.createElement("dialog");
    dlg.className = "nb-files-dialog"; dlg.dir = el.dir;
    const head = document.createElement("div"); head.className = "nb-files-dialog-head";
    head.append(Object.assign(new Image(), { src: ICON, alt: "", width: 22, height: 22 }), Object.assign(document.createElement("h3"), { textContent: t.importTitle }));
    const hint = Object.assign(document.createElement("p"), { className: "nb-files-hint", textContent: t.hint });
    const list = document.createElement("div"); list.className = "nb-files-list";
    const errLine = Object.assign(document.createElement("p"), { className: "nb-files-err", hidden: true });
    const browse = Object.assign(document.createElement("button"), { type: "button", textContent: t.browse });
    const modeBox = document.createElement("div"); modeBox.className = "nb-files-mode";
    for (const [v, l] of [["append", t.append], ["replace", t.replace]]) {
      const lab = document.createElement("label"); const rb = Object.assign(document.createElement("input"), { type: "radio", name: "nbImpMode", value: v, checked: v === "append" });
      lab.append(rb, document.createTextNode(` ${l} `)); modeBox.append(lab);
    }
    modeBox.prepend(document.createTextNode(`${t.ifContent} `));
    const actions = document.createElement("div"); actions.className = "nb-files-actions";
    const ok = Object.assign(document.createElement("button"), { type: "button", textContent: t.importBtn });
    const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: t.cancel });
    actions.append(ok, cancel);
    const setErr = (m) => { errLine.textContent = m || ""; errLine.hidden = !m; };

    const render = () => {
      list.replaceChildren();
      if (!rows.length) list.append(Object.assign(document.createElement("p"), { className: "nb-files-empty", textContent: listErr ? `${t.listFail} ${listErr.message || ""}` : t.noBackups }));
      for (const r of rows) {
        const row = document.createElement("label"); row.className = "nb-files-row";
        const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: r.checked, disabled: r.route === "unsupported" });
        cb.addEventListener("change", () => { r.checked = cb.checked; });
        const name = document.createElement("span"); name.className = "nb-files-name";
        name.append(Object.assign(document.createElement("b"), { textContent: r.f.name }), Object.assign(document.createElement("small"), { textContent: [r.f.size ? kb(r.f.size) : "", r.f.modifiedTime ? when(r.f.modifiedTime) : ""].filter(Boolean).join(" · ") }));
        const label = { code: t.toCells, workspace: t.toWs, bundle: t.toBundle, unsupported: r.why }[r.route];
        row.append(cb, name, Object.assign(document.createElement("em"), { textContent: label }));
        list.append(row);
      }
      modeBox.hidden = !(rows.some((r) => r.checked && r.route === "code") && ctx.hasContent?.());
      ok.disabled = !rows.some((r) => r.checked);
    };
    list.addEventListener("change", render);

    let picking = false;
    // Google's picker is appended to <body>, which sits UNDER a modal dialog's top layer, so the dialog steps aside while it is open.
    browse.onclick = async () => {
      browse.disabled = true; picking = true; dlg.close(); setErr("");
      try {
        for (const f of await g.pickDriveFiles()) if (!rows.some((r) => r.f.id === f.id)) rows.push(rowFor(f, true));
      } catch (e) { if (e?.message !== "NOT_CONNECTED") setErr(String(e?.message || e)); }
      picking = false; browse.disabled = false; render(); dlg.showModal();
    };
    cancel.onclick = () => dlg.close();
    ok.onclick = async () => {
      const chosen = rows.filter((r) => r.checked && r.route !== "unsupported");
      if (!chosen.length) { say(t.none); dlg.close(); return; }
      ok.disabled = true; setErr("");
      const replace = dlg.querySelector('input[name="nbImpMode"]:checked')?.value === "replace";
      const done = [], failed = [];
      let firstCode = true;
      show({ kind: "info", text: t.importing });
      for (const r of chosen) {
        try {
          const blob = await g.downloadDriveFile(r.f.id);
          const file = new File([blob], r.f.name, { type: r.route === "workspace" ? workspaceMime(r.f.name) : blob.type });
          if (r.route === "workspace") await ctx.bridge.addFiles([file]);
          else if (r.route === "code") { await ctx.importCode(file, { append: !(replace && firstCode) && (ctx.hasContent?.() ?? false) }); firstCode = false; }
          else if (r.route === "bundle") await ctx.importBundle(file);
          done.push(r.f.name);
        } catch (e) { failed.push(/Drive (403|404)/.test(e?.message || "") ? `${r.f.name} — ${t.noAccess}` : `${r.f.name} — ${e?.message || e}`); }
      }
      show({ kind: failed.length ? (done.length ? "info" : "err") : "ok", title: done.length ? t.importedTitle(done.length) : t.err, text: [done.join(", "), failed.length ? t.importedFail(failed.join("; ")) : ""].filter(Boolean).join("\n") });
      dlg.close();
    };
    dlg.append(head, hint, list, errLine, browse, modeBox, actions);
    dlg.addEventListener("close", () => { if (!picking) dlg.remove(); });
    document.body.append(dlg); render(); dlg.showModal();
    return new Promise((res) => dlg.addEventListener("close", () => { if (!picking) res(); }));
  }

  // ── toolbar menu items (inside the runtime's .toolbar-menu-items) ──
  let busy = false;
  const items = [
    { id: "import", label: t.drive, run: openImport },
    { id: "backup", label: t.backup, run: () => backup({ silent: false }) },
  ];
  let queued = false;
  const inject = () => {
    queued = false;
    const menu = ctx.before.querySelector(".toolbar-menu-items");
    if (!menu || menu.querySelector("[data-nb-drive]")) return;
    const frag = document.createDocumentFragment();
    items.forEach((it, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "menuitem"); b.dataset.nbDrive = it.id;
      if (i === 0) b.dataset.nbDriveFirst = "";
      const img = Object.assign(new Image(), { src: ICON, alt: "", width: 18, height: 18 }); img.setAttribute("aria-hidden", "true");
      b.append(img, Object.assign(document.createElement("span"), { textContent: it.label }));
      b.addEventListener("click", async () => {
        b.closest("details")?.removeAttribute("open");
        if (busy) return;
        busy = true;
        try { await it.run(); } catch (e) { fail(e); } finally { busy = false; }
      });
      frag.append(b);
    });
    menu.insertBefore(frag, menu.lastElementChild); // before "Help and shortcuts"
  };
  // The runtime rebuilds its toolbar on mount and on state changes, so the items are re-added whenever they disappear.
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(inject); } }).observe(ctx.before, { childList: true, subtree: true });
  inject();

  el.append(driveOff, card);
  ctx.before.before(el);
  window.__nbFilesStrip = { backup: (o) => backup(o || { silent: true }).catch((e) => { console.warn("[drive] backup failed:", e); return null; }) };
  refresh();
  return el;
}

// /notebook/new and /notebook/edit/<id> — JupyterLab-style notebook editor, open to everyone.
// Loaded on demand by notebook-page.js (readers never download it).
// Cells are edited/run by the notebook runtime in edit mode (assets/notebook-runtime);
// this file owns the details form, validation and saving. Everyone saves to the
// local "My Content" (امتحاناتك). Only an admin arriving with ?draft= (MCP) or
// /notebook/edit/<platform id> publishes through /api/admin.
import { getToken, isAdminAuthenticated } from "../../shared/adminAuth.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { fetchImportDraft, getDraftAssets, consumeImportDraft } from "../../shared/import-draft.js";
import { escapeHtml } from "../home/escape-html.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { normalizeNotebookLang } from "../../shared/notebook-lang.js";
import { loadRuntime } from "../../shared/runtime-loader.js";
import { RUNTIME_CONFIG } from "../../shared/runtime-config.js";
import * as M from "./notebook-editor-model.js";
import { createWorkspaceBridge } from "../../shared/workspace-bridge.js";
import * as wsStore from "../../shared/workspace-store.js";
import { parseNotebookZip } from "../../shared/workspace-zip.js";
import { exportNotebookZip } from "../../shared/notebook-bundle.js";
import { mountStorageBanner } from "../../shared/storage-guard.js";
import { prepareNotebookAssets, rollbackAssets } from "../../shared/notebook-publish-assets.js";
import { referencedNotebookAssets, normalizeNotebookContent } from "../../shared/content-rules.js";
import "./image-tool-window.js";
import "./notebook-output-controls.js";
import "./notebook-menu-controls.js";

const $ = (id) => document.getElementById(id);
let state = M.emptyNotebook();
let editId = null;
let localMode = true; // false only for admin platform publishing
let handle = null; // runtime mount handle
let bridge = null; // workspace (IndexedDB) bridge — files are NOT sent anywhere until an admin publishes
let mountedLang = "";
let mountedRuntime = "";
let dirtyFlag = false;
let saving = false;
const cellToPlain = (c) => ({ type: c.type, source: c.source, ...(typeof c.stdin === "string" ? { stdin: c.stdin } : {}) });

const STR = {
  en: {
    heading: "Create notebook", headingEdit: "Edit notebook", title: "Title", lang: "Notebook language", desc: "Description", src: "Source link (optional)",
    topEyebrow: "NOTEBOOK STUDIO", topDescription: "Shape the notebook details, choose a runtime, then start building cells.",
    detailsKicker: "01 / DETAILS", detailsHeading: "Set up your notebook", formIntro: "Add a clear title and choose how this notebook should be presented.", draftLabel: "Draft details",
    identityHeading: "Notebook details", identityIntro: "Give learners enough context to know what they’ll open.", titleHint: "A concise title makes this notebook easier to find.", descriptionHint: "Describe the topic, goal, or expected starting point.", sourceHint: "Add a reference learners can open for more detail.",
    settingsHeading: "Language and runtime", settingsIntro: "Choose how the notebook reads and which engine runs its code.", languageHint: "Controls notebook text direction and interface language.", runtimeHintMatlab: "Runs in the browser with the MATLAB learning runtime.", runtimeHintCpp: "Runs C++ code using the online compiler service.", runtimeLock: "Locked after save",
    placementHeading: "Publishing location", placementIntro: "Choose where learners will find this notebook.", course: "Course", folder: "Folder", slug: "URL slug", compressTitle: "Optimize notebook images", compressShort: "Compress images to WebP when publishing.", compressHint: "Image names and references are updated automatically.",
    import: "Import .ipynb / .m", save: "Save to My Content", savePlatform: "Save and publish", loading: "Loading editor…",
    saved: "Saved", savedMsg: "The notebook was saved to My Content.", driveDone: (n, f) => `Also backed up to Google Drive: “${n}” in “${f}”.`, publishedMsg: "The notebook was published.",
    fail: "Could not save", problems: (n) => `Fix ${n} problem${n === 1 ? "" : "s"} before saving`, importFail: "Import failed", importNotes: "Import notes",
    loadFail: "Could not load", runtimeFail: "Could not load the notebook editor. Check your connection and reload the page.", dup: "A notebook with this title already exists here. Choose a different title.",
    discard: "You have unsaved changes.", exportZip: "Export .zip", compress: "Compress images to WebP on publish (renames files and updates references)",
    draftAssetsPartial: "Some files attached by Claude could not be downloaded.",
    unusedKept: (n) => `${n} unused file(s) were not uploaded.`, assetFail: "Could not upload the notebook files", zipFail: "Could not read the zip",
  },
  ar: {
    heading: "إنشاء دفتر", headingEdit: "تعديل الدفتر", title: "العنوان", lang: "لغة الدفتر", desc: "الوصف", src: "رابط المصدر (اختياري)",
    topEyebrow: "مساحة الدفاتر", topDescription: "أكمل تفاصيل الدفتر واختر بيئة التشغيل، ثم ابدأ ببناء الخلايا.",
    detailsKicker: "٠١ / التفاصيل", detailsHeading: "إعداد الدفتر", formIntro: "أضف عنواناً واضحاً واختر طريقة عرض هذا الدفتر.", draftLabel: "تفاصيل المسودة",
    identityHeading: "تفاصيل الدفتر", identityIntro: "أضف سياقاً يساعد المتعلمين على معرفة محتوى الدفتر.", titleHint: "يساعد العنوان المختصر على العثور على الدفتر.", descriptionHint: "اشرح الموضوع أو الهدف أو نقطة البداية المتوقعة.", sourceHint: "أضف مرجعاً يمكن للمتعلمين فتحه لمعرفة المزيد.",
    settingsHeading: "اللغة وبيئة التشغيل", settingsIntro: "اختر لغة الدفتر والمحرك الذي يشغّل الشيفرة.", languageHint: "تحدد اتجاه النص ولغة واجهة الدفتر.", runtimeHintMatlab: "يعمل في المتصفح باستخدام بيئة MATLAB التعليمية.", runtimeHintCpp: "يشغّل شيفرة C++ عبر خدمة المترجم على الإنترنت.", runtimeLock: "مقفل بعد الحفظ",
    placementHeading: "مكان النشر", placementIntro: "اختر المكان الذي سيجد فيه المتعلمون هذا الدفتر.", course: "المادة", folder: "المجلد", slug: "معرّف الرابط", compressTitle: "تحسين صور الدفتر", compressShort: "ضغط الصور إلى WebP عند النشر.", compressHint: "سيتم تحديث أسماء الصور ومراجعها تلقائياً.",
    import: "استيراد .ipynb / .m", save: "حفظ في امتحاناتك", savePlatform: "حفظ ونشر", loading: "جاري تحميل المحرر…",
    saved: "تم الحفظ", savedMsg: "تم حفظ الدفتر في «امتحاناتك».", driveDone: (n, f) => `ونُسخ احتياطياً إلى Google Drive: «${n}» داخل «${f}».`, publishedMsg: "تم نشر الدفتر.",
    fail: "تعذر الحفظ", problems: (n) => `أصلح ${n} من المشاكل قبل الحفظ`, importFail: "فشل الاستيراد", importNotes: "ملاحظات الاستيراد",
    loadFail: "تعذر التحميل", runtimeFail: "تعذر تحميل محرر الدفاتر. تحقق من اتصالك وأعد تحميل الصفحة.", dup: "يوجد دفتر بنفس العنوان هنا بالفعل. اختر عنواناً مختلفاً.",
    discard: "لديك تغييرات غير محفوظة.", exportZip: "تصدير .zip", compress: "ضغط الصور إلى WebP عند النشر (يغيّر أسماء الملفات ويحدّث الإشارات إليها)",
    draftAssetsPartial: "تعذر تنزيل بعض الملفات التي أرفقها Claude.",
    unusedKept: (n) => `لم يتم رفع ${n} ملف غير مستخدم.`, assetFail: "تعذر رفع ملفات الدفتر", zipFail: "تعذر قراءة ملف zip",
  },
};
const t = (k, ...a) => { const v = STR[state.language]?.[k] ?? STR.en[k]; return typeof v === "function" ? v(...a) : v; };

const readLocal = () => { try { const a = JSON.parse(localStorage.getItem("user_quizzes") || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };

function saveLocal(payload) {
  const items = readLocal();
  const now = new Date().toISOString();
  const i = editId ? items.findIndex((r) => (r.id || r.meta?.id) === editId && r.meta?.type === "notebook") : -1;
  const dup = items.some((r, k) => k !== i && r.meta?.type === "notebook" && (r.meta?.parentId || null) === (i >= 0 ? items[i].meta?.parentId || null : null)
    && (r.meta?.title || "").trim().toLowerCase() === payload.title.toLowerCase());
  if (dup) return "dup";
  const body = { description: payload.description, source: payload.source, notebook: { runtime: payload.runtime, content: payload.content }, stats: { cellCount: payload.content.cells.length } };
  if (i >= 0) {
    const old = items[i];
    items[i] = { ...old, ...body, meta: { ...old.meta, title: payload.title, description: payload.description, source: payload.source, updatedAt: now } };
  } else {
    editId = `user_notebook_${crypto.randomUUID()}`;
    items.push({ id: editId, meta: { type: "notebook", title: payload.title, parentId: null, createdAt: new Date().toLocaleString("en-US"), updatedAt: now, description: payload.description, source: payload.source, passwordProtected: false },
      stats: body.stats, notebook: body.notebook, passwordHash: null, questions: [] });
  }
  try { localStorage.setItem("user_quizzes", JSON.stringify(items)); } catch { return "تعذّر الحفظ محلياً. قد تكون مساحة التخزين ممتلئة."; }
  return null;
}

const api = (body) => fetch("/api/admin", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
  body: JSON.stringify(body),
}).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));


function applyChrome() {
  const lang = state.language === "ar" ? "ar" : "en";
  const area = $("contentArea");
  area.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  area.setAttribute("lang", lang);
  $("cnbShell").setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  $("cnbShell").setAttribute("lang", lang);
  $("cnbHeading").textContent = editId ? t("headingEdit") : t("heading");
  $("cnbLblCourse").textContent = t("course");
  $("cnbLblFolder").textContent = t("folder");
  $("cnbLblSlug").textContent = t("slug");
  $("cnbLblTitle").textContent = t("title");
  $("cnbLblLang").textContent = t("lang");
  $("cnbLblRuntime").textContent = state.language === "ar" ? "بيئة التشغيل" : "Runtime";
  $("cnbLblDesc").textContent = t("desc");
  $("cnbLblSrc").textContent = t("src");
  $("cnbCompressLbl").textContent = state.language === "ar" ? "ضغط الصور عند النشر" : "Compress images on publish";
  $("cnbCompressRow").hidden = localMode;
  const runtime = $("cnbRuntime").value || state.runtime;
  $("cnbRuntimeCard").dataset.runtime = runtime;
  $("cnbRuntimeLockNote").textContent = t("runtimeLock");
  $("cnbRuntimeLockNote").hidden = !$("cnbRuntime").disabled;
  $("cnbRuntimeCard").classList.toggle("is-locked", $("cnbRuntime").disabled);
  $("cnbSaveLabel").textContent = localMode ? t("save") : t("savePlatform");
  document.title = `${t("heading")} | Basmagi Quiz`;
}

function showIssues(headline, items, kind = "error") {
  const box = $("cnbIssues");
  box.className = "cnb-issues" + (kind === "warn" ? " cnb-issues--warn" : "");
  box.replaceChildren();
  const h = document.createElement("strong");
  h.textContent = headline;
  box.append(h);
  if (items.length) {
    const ul = document.createElement("ul");
    for (const it of items.slice(0, 8)) { const li = document.createElement("li"); li.textContent = it; ul.append(li); }
    if (items.length > 8) { const li = document.createElement("li"); li.textContent = `… +${items.length - 8}`; ul.append(li); }
    box.append(ul);
  }
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
const clearIssues = () => { $("cnbIssues").hidden = true; };

function readMeta() {
  state = { ...state, title: $("cnbTitle").value, description: $("cnbDescription").value, source: $("cnbSource").value, slug: $("cnbSlug").value, runtime: $("cnbRuntime").value, language: $("cnbLanguage").value };
}
function writeMeta() {
  $("cnbTitle").value = state.title; $("cnbDescription").value = state.description; $("cnbSource").value = state.source;
  $("cnbSlug").value = state.slug; $("cnbRuntime").value = state.runtime; $("cnbLanguage").value = state.language;
}
const markDirty = () => { dirtyFlag = true; };

let runtimePromise = null;
async function mountEditor() {
  const runtime = await loadRuntime(state.runtime);
  if (!bridge) bridge = createWorkspaceBridge(editId || "draft", { onWarn: (m) => showNotification("", m, "info"), onChange: markDirty });
  if (handle) { try { handle.destroy(); } catch { /* ignore */ } }
  const host = $("cnbEditor");
  host.replaceChildren();
  host.setAttribute("aria-busy", "false");
  mountedLang = state.language;
  mountedRuntime = state.runtime;
  handle = runtime.mount({
    root: host,
    baseUrl: RUNTIME_CONFIG[state.runtime].base,
    mode: "edit",
    lang: state.language,
    notebook: { id: editId || "draft", title: state.title, schemaVersion: 1, runtime: state.runtime, cells: state.cells.map((c, i) => ({ id: c.id || `cell-${i + 1}`, ...cellToPlain(c) })) },
    onChange: (cells) => { state = { ...state, cells: cells.map(cellToPlain) }; markDirty(); },
    onNotice: (m) => showNotification("", m, "info"),
  });
  void restoreWorkspace();
}

/** Workspace files an MCP draft carries (temporary Storage, signed URLs): copied into the browser workspace. */
async function loadDraftAssets() {
  const list = getDraftAssets();
  if (!list.length || !bridge) return;
  const files = [];
  for (const a of list) {
    try { const res = await fetch(a.url); if (res.ok) files.push(new File([await res.blob()], a.path, { type: a.mime })); } catch { /* skipped */ }
  }
  if (files.length) await bridge.addFiles(files);
  if (files.length < list.length) showNotification("", t("draftAssetsPartial"), "info");
}

/** Re-fills the runtime's virtual folder (runs after every mount; the runtime clears it on mount). */
async function restoreWorkspace() {
  if (!bridge) return;
  await bridge.restore();
  const stored = new Set((await bridge.list()).map((f) => f.path));
  const missing = (state.assets || []).filter((a) => !stored.has(a.path));
  if (missing.length) await bridge.loadManifest(missing);
}


function currentCells() { return handle ? handle.getCells().map(cellToPlain) : state.cells; }

async function save() {
  if (saving) return;
  readMeta();
  state = { ...state, cells: currentCells() };
  const v = M.validateState(state, state.language);
  if (v.errors.length) { showIssues(t("problems", v.errors.length), v.errors); return; }
  clearIssues();
  const payload = M.buildPayload(state);
  saving = true; $("cnbSave").disabled = true;
  try {
    if (localMode) {
      const wasNew = !editId; // saveLocal() assigns editId (module-level) as a side effect, so capture this first
      const err = saveLocal(payload);
      if (err) { showIssues(t("fail"), [err === "dup" ? t("dup") : err]); return; }
      dirtyFlag = false;
      await wsStore.renameWorkspace(bridge?.key || "draft", editId).catch(() => {});
      void consumeImportDraft();
      // Only when Drive is already connected (never opens a popup). Awaited (max 10 s) so the redirect cannot cancel the upload;
      // the workspace now lives under the new id, so the key is passed explicitly (bridge.key is still "draft").
      const drive = await Promise.race([window.__nbFilesStrip?.backup({ silent: true, key: editId, fromDraft: true }), new Promise((r) => setTimeout(() => r(null), 10000))]);
      showNotification(t("saved"), drive ? `${t("savedMsg")} ${t("driveDone", drive.name, drive.folderName)}` : t("savedMsg"), "success");
      // Stay on this page, on the saved notebook — swap the URL from
      // /notebook/new to /notebook/edit/<id> in place (no navigation/reload),
      // and drop the "new notebook" chrome now that it's an existing one.
      if (wasNew) {
        history.replaceState(history.state, "", `/notebook/edit/${encodeURIComponent(editId)}`);
        document.querySelector('.menu-item[href="/notebook/new"]')?.classList.remove("active");
      }
      $("cnbRuntime").disabled = true; applyChrome();
      return;
    }
    let up;
    try { up = await prepareNotebookAssets({ workspaceKey: bridge.key, cells: payload.content.cells, knownAssets: state.assets, compress: $("cnbCompress").checked }); }
    catch (e) { showIssues(t("assetFail"), [e.message]); return; }
    const content = { ...normalizeNotebookContent(up.cells, state.language, state.runtime), ...(up.assets.length ? { assets: up.assets } : {}) };
    const body = { ...payload, content };
    const res = editId
      ? await api({ action: "update-notebook", id: editId, ...body })
      : await api({ action: "create-notebook", ...body, courseId: $("cnbCourse").value, folderId: $("cnbFolder").value || null });
    if (!res.ok) { await rollbackAssets(up.reserved); showIssues(t("fail"), [res.body.error || "Unknown error"]); return; }
    if (up.unused) showNotification("", t("unusedKept", up.unused), "info");
    void consumeImportDraft();
    dirtyFlag = false;
    showNotification(t("saved"), t("publishedMsg"), "success");
    setTimeout(() => { location.href = `/notebook/${encodeURIComponent(res.body.id || editId)}`; }, 700);
  } finally { saving = false; $("cnbSave").disabled = false; }
}

async function loadPlacement() {
  const sb = await ensureSharedSupabaseClient();
  if (!sb) return;
  const [{ data: courses }, { data: folders }] = await Promise.all([
    sb.from("courses").select("id, name").order("name"),
    sb.from("folders").select("id, name, course_id").order("name"),
  ]);
  const cs = $("cnbCourse"), fs = $("cnbFolder");
  cs.innerHTML = (courses || []).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  const fill = () => {
    fs.innerHTML = `<option value="">— مباشرة تحت المادة —</option>` +
      (folders || []).filter((f) => f.course_id === cs.value).map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");
  };
  cs.addEventListener("change", fill);
  fill();
}


/** The ONLY import entry: the runtime's menu "Import…" calls this (.ipynb / .m / .zip bundle). */
async function importFile(f, opts = {}) {
  try {
    if (/\.zip$/i.test(f.name)) {
      const z = await parseNotebookZip(await f.arrayBuffer());
      state = { ...M.notebookFromPayload(z.meta), assets: [], slug: state.slug };
      writeMeta(); applyChrome(); markDirty(); clearIssues();
      await mountEditor();
      await bridge.addFiles(z.files);
      return;
    }
    readMeta(); state = { ...state, cells: currentCells() };
    const r = M.importFileInto(opts.append ? { ...state, cells: [] } : state, f.name, await f.text());
    state = opts.append ? { ...state, cells: [...state.cells, ...r.state.cells] } : r.state; writeMeta(); applyChrome(); markDirty(); clearIssues();
    if (handle && mountedLang === state.language && mountedRuntime === state.runtime) handle.setCells(state.cells); else await mountEditor();
    if (r.warnings.length) showIssues(t("importNotes"), r.warnings, "warn");
  } catch (err) { showIssues(t("importFail"), [err.message]); }
}
window.__mlwebImport = importFile; // set before the runtime mounts so its file picker also accepts .zip

/** @param {string|null} edit notebook id when editing (/notebook/edit/<id>), null when creating (/notebook/new) */
export async function startEditor(edit = null) {
  const params = new URLSearchParams(location.search);
  const admin = isAdminAuthenticated();
  // Published notebooks are edited by admins only; everyone else is sent to the reading page.
  if (edit && !/^user_notebook_/.test(edit) && !admin) { location.replace(`/notebook/${encodeURIComponent(edit)}`); return; }
  if (!document.getElementById("cnbEditorCss")) {
    const l = Object.assign(document.createElement("link"), { id: "cnbEditorCss", rel: "stylesheet", href: "/src/features/notebook/notebook-editor.css" });
    document.head.append(l);
  }
  const editIsLocal = !!edit && /^user_notebook_/.test(edit);
  localMode = !(admin && ((edit && !editIsLocal) || params.get("draft")));
  if (!localMode) { $("cnbPlacementRow").hidden = false; void mountStorageBanner($("cnbStorage")); await loadPlacement(); }
  if (!edit) await wsStore.clearWorkspace("draft").catch(() => {});
  try {
    const draft = await fetchImportDraft("notebook");
    if (draft) state = M.notebookFromPayload(JSON.parse(draft));
    else if (edit && localMode) {
      const row = readLocal().find((r) => (r.id || r.meta?.id) === edit && r.meta?.type === "notebook");
      if (!row) throw new Error("Notebook not found in My Content.");
      state = M.notebookFromPayload({ ...row.notebook, content: row.notebook?.content, title: row.meta?.title, description: row.meta?.description, source: row.meta?.source, slug: "" });
      editId = edit;
    } else if (edit) {
      const r = await api({ action: "get-notebook", id: edit });
      if (!r.ok) throw new Error(r.body.error || "Could not load the notebook.");
      state = M.notebookFromPayload(r.body.notebook); editId = edit;
      $("cnbPlacementRow").hidden = true;
    }
  } catch (err) { showNotification(t("loadFail"), err.message, "error"); }
  writeMeta(); applyChrome();
  $("cnbRuntime").disabled = !!editId;
  applyChrome();
  try { await mountEditor(); } catch { showIssues(t("loadFail"), [t("runtimeFail")]); }
  void loadDraftAssets();
  import("./notebook-files-strip.js").then(({ mountFilesStrip }) => mountFilesStrip({
    before: $("cnbEditor"), lang: "en", bridge,
    getMeta: () => { readMeta(); return { title: state.title.trim() || "notebook", description: state.description, source: state.source, runtime: state.runtime, language: state.language, cells: currentCells(), assets: state.assets }; },
    importCode: (f, o) => importFile(f, o), importBundle: (f) => importFile(f),
    hasContent: () => currentCells().some((c) => String(c.source || "").trim()),
  })).catch((e) => console.warn("[editor] files strip failed:", e));
  dirtyFlag = false;

  $("cnbForm").addEventListener("input", () => { readMeta(); markDirty(); if (!$("cnbIssues").hidden) clearIssues(); });
  $("cnbForm").addEventListener("submit", (e) => e.preventDefault());
  $("cnbRuntime").addEventListener("change", async () => {
    if (editId) return;
    state = { ...state, cells: currentCells() }; readMeta(); applyChrome(); markDirty();
    try { await mountEditor(); showNotification("", state.language === "ar" ? "تم تغيير بيئة التشغيل." : "Runtime changed.", "info"); } catch { showIssues(t("loadFail"), [t("runtimeFail")]); }
  });
  $("cnbLanguage").addEventListener("change", async () => {
    state = { ...state, cells: currentCells() }; readMeta(); applyChrome(); markDirty();
    try { await mountEditor(); } catch { /* shown on next save */ }
  });
  $("cnbSave").addEventListener("click", save);
  // Offered by the runtime's "Export notebook" dialog (zip option) — uses the CURRENT unsaved editor state.
  window.__mlwebExport = {
    zip: async () => {
      try {
        readMeta(); state = { ...state, cells: currentCells() };
        await exportNotebookZip({ title: state.title.trim() || "notebook", description: state.description, source: state.source, runtime: state.runtime, language: state.language, cells: state.cells, keys: [bridge.key], assets: state.assets });
      } catch (e) { showNotification("", e.message || "Export failed", "error"); }
    },
  };
  window.addEventListener("beforeunload", (e) => { if (dirtyFlag) { e.preventDefault(); e.returnValue = t("discard"); } });
}

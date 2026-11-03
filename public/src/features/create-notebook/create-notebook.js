// /create-notebook — JupyterLab-style notebook editor, open to everyone.
// Cells are edited/run by the notebook runtime in edit mode (assets/notebook-runtime);
// this file owns the details form, validation and saving. Everyone saves to the
// local "My Content" (امتحاناتك). Only an admin arriving with ?draft= (MCP) or
// ?edit=<platform id> publishes through /api/admin.
import { getToken, isAdminAuthenticated } from "../../shared/adminAuth.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { fetchImportDraft } from "../../shared/import-draft.js";
import { escapeHtml } from "../home/escape-html.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { normalizeNotebookLang } from "../../shared/notebook-lang.js";
import * as M from "./notebook-editor-model.js";

const RUNTIME_BASE = "/assets/notebook-runtime/";
const $ = (id) => document.getElementById(id);
let state = M.emptyNotebook();
let editId = null;
let localMode = true; // false only for admin platform publishing
let handle = null; // runtime mount handle
let mountedLang = "";
let dirtyFlag = false;
let saving = false;

const STR = {
  en: {
    heading: "Create notebook", headingEdit: "Edit notebook", title: "Title", lang: "Notebook language", desc: "Description", src: "Source link (optional)",
    import: "Import .ipynb / .m", save: "Save to My Content", savePlatform: "Save and publish", loading: "Loading editor…",
    saved: "Saved", savedMsg: "The notebook was saved to My Content.", publishedMsg: "The notebook was published.",
    fail: "Could not save", problems: (n) => `Fix ${n} problem${n === 1 ? "" : "s"} before saving`, importFail: "Import failed", importNotes: "Import notes",
    loadFail: "Could not load", runtimeFail: "Could not load the notebook editor. Check your connection and reload the page.", dup: "A notebook with this title already exists here. Choose a different title.",
    discard: "You have unsaved changes.",
  },
  ar: {
    heading: "إنشاء دفتر", headingEdit: "تعديل الدفتر", title: "العنوان", lang: "لغة الدفتر", desc: "الوصف", src: "رابط المصدر (اختياري)",
    import: "استيراد .ipynb / .m", save: "حفظ في امتحاناتك", savePlatform: "حفظ ونشر", loading: "جاري تحميل المحرر…",
    saved: "تم الحفظ", savedMsg: "تم حفظ الدفتر في «امتحاناتك».", publishedMsg: "تم نشر الدفتر.",
    fail: "تعذر الحفظ", problems: (n) => `أصلح ${n} من المشاكل قبل الحفظ`, importFail: "فشل الاستيراد", importNotes: "ملاحظات الاستيراد",
    loadFail: "تعذر التحميل", runtimeFail: "تعذر تحميل محرر الدفاتر. تحقق من اتصالك وأعد تحميل الصفحة.", dup: "يوجد دفتر بنفس العنوان هنا بالفعل. اختر عنواناً مختلفاً.",
    discard: "لديك تغييرات غير محفوظة.",
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
  $("cnbHeading").textContent = editId ? t("headingEdit") : t("heading");
  $("cnbLblTitle").textContent = t("title");
  $("cnbLblLang").textContent = t("lang");
  $("cnbLblDesc").textContent = t("desc");
  $("cnbLblSrc").textContent = t("src");
  $("cnbImport").textContent = t("import");
  $("cnbSave").textContent = localMode ? t("save") : t("savePlatform");
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
function loadRuntime() {
  if (window.MLWebNotebook?.mount) return Promise.resolve(window.MLWebNotebook);
  if (!runtimePromise) {
    runtimePromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${RUNTIME_BASE}runtime.js`; s.async = true;
      s.onload = () => (window.MLWebNotebook?.mount ? resolve(window.MLWebNotebook) : reject(new Error("runtime missing")));
      s.onerror = () => { runtimePromise = null; reject(new Error("runtime failed to load")); };
      document.head.append(s);
    });
  }
  return runtimePromise;
}

async function mountEditor() {
  const runtime = await loadRuntime();
  if (handle) { try { handle.destroy(); } catch { /* ignore */ } }
  const host = $("cnbEditor");
  host.replaceChildren();
  host.setAttribute("aria-busy", "false");
  mountedLang = state.language;
  handle = runtime.mount({
    root: host,
    baseUrl: RUNTIME_BASE,
    mode: "edit",
    lang: state.language,
    notebook: { id: editId || "draft", title: state.title, schemaVersion: 1, runtime: "matlab", cells: state.cells.map((c, i) => ({ id: c.id || `cell-${i + 1}`, type: c.type, source: c.source })) },
    onChange: (cells) => { state = { ...state, cells: cells.map((c) => ({ type: c.type, source: c.source })) }; markDirty(); },
    onNotice: (m) => showNotification("", m, "info"),
  });
}

function currentCells() { return handle ? handle.getCells().map((c) => ({ type: c.type, source: c.source })) : state.cells; }

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
      const err = saveLocal(payload);
      if (err) { showIssues(t("fail"), [err === "dup" ? t("dup") : err]); return; }
      dirtyFlag = false;
      showNotification(t("saved"), t("savedMsg"), "success");
      setTimeout(() => { location.href = `/notebook/${encodeURIComponent(editId)}?type=user`; }, 700);
      return;
    }
    const res = editId
      ? await api({ action: "update-notebook", id: editId, ...payload })
      : await api({ action: "create-notebook", ...payload, courseId: $("cnbCourse").value, folderId: $("cnbFolder").value || null });
    if (!res.ok) { showIssues(t("fail"), [res.body.error || "Unknown error"]); return; }
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


async function init() {
  const params = new URLSearchParams(location.search);
  const edit = params.get("edit");
  const admin = isAdminAuthenticated();
  const editIsLocal = !!edit && /^user_notebook_/.test(edit);
  localMode = !(admin && ((edit && !editIsLocal) || params.get("draft")));
  if (!localMode) { $("cnbPlacementRow").hidden = false; await loadPlacement(); }
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
  try { await mountEditor(); } catch { showIssues(t("loadFail"), [t("runtimeFail")]); }
  dirtyFlag = false;

  $("cnbForm").addEventListener("input", () => { readMeta(); markDirty(); if (!$("cnbIssues").hidden) clearIssues(); });
  $("cnbForm").addEventListener("submit", (e) => e.preventDefault());
  $("cnbLanguage").addEventListener("change", async () => {
    state = { ...state, cells: currentCells() }; readMeta(); applyChrome(); markDirty();
    try { await mountEditor(); } catch { /* shown on next save */ }
  });
  $("cnbSave").addEventListener("click", save);
  $("cnbImport").onclick = () => $("cnbImportInput").click();
  $("cnbImportInput").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      readMeta(); state = { ...state, cells: currentCells() };
      const r = M.importFileInto(state, f.name, await f.text());
      state = r.state; writeMeta(); applyChrome(); markDirty(); clearIssues();
      if (handle && mountedLang === state.language) handle.setCells(state.cells); else await mountEditor();
      if (r.warnings.length) showIssues(t("importNotes"), r.warnings, "warn");
    } catch (err) { showIssues(t("importFail"), [err.message]); }
    e.target.value = "";
  };
  window.addEventListener("beforeunload", (e) => { if (dirtyFlag) { e.preventDefault(); e.returnValue = t("discard"); } });
}
void init();

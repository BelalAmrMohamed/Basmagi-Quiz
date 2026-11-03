// /create-notebook — admin-only notebook editor. Saves ONLY through /api/admin
// (create-notebook / update-notebook); loads ?draft= (MCP) and ?edit=<id>.
import { getToken, isAdminAuthenticated } from "../../shared/adminAuth.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { fetchImportDraft } from "../../shared/import-draft.js";
import { renderMarkdown } from "../../shared/markdown.js";
import { escapeHtml } from "../home/escape-html.js";
import { showNotification } from "../../components/notifications/notifications.js";
import * as M from "./notebook-editor-model.js";

const $ = (id) => document.getElementById(id);
let state = M.emptyNotebook();
let editId = null;
let reviewed = false;
let localMode = false; // non-admin: notebooks are saved in the browser (امتحاناتك), never published

const readLocal = () => { try { const a = JSON.parse(localStorage.getItem("user_quizzes") || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };

function saveLocal(payload) {
  const items = readLocal();
  const now = new Date().toISOString();
  const i = editId ? items.findIndex((r) => (r.id || r.meta?.id) === editId && r.meta?.type === "notebook") : -1;
  const dup = items.some((r, k) => k !== i && r.meta?.type === "notebook" && (r.meta?.parentId || null) === (i >= 0 ? items[i].meta?.parentId || null : null)
    && (r.meta?.title || "").trim().toLowerCase() === payload.title.toLowerCase());
  if (dup) return "يوجد دفتر بنفس الاسم في هذا المكان بالفعل. اختر اسماً مختلفاً.";
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

function dirty() { reviewed = false; $("cnbPreview").hidden = true; refresh(); }

function refresh() {
  const v = M.validateState(state);
  $("cnbIssues").innerHTML =
    v.errors.map((e) => `<div class="err">❌ ${escapeHtml(e)}</div>`).join("") +
    v.warnings.map((w) => `<div class="warn">⚠️ ${escapeHtml(w)}</div>`).join("") ||
    "<div>✅ لا توجد مشاكل.</div>";
  $("cnbSave").disabled = !(reviewed && !v.errors.length && (localMode || $("cnbCourse").value || editId));
}

function renderCells() {
  const ol = $("cnbCells");
  ol.replaceChildren();
  state.cells.forEach((c, i) => {
    const li = document.createElement("li");
    li.className = "cnb-cell";
    li.innerHTML = `<div class="cnb-cell-bar"><strong>${i + 1}</strong>
      <select data-act="type"><option value="markdown">نص</option><option value="code">كود</option></select>
      <button type="button" data-act="up">↑</button><button type="button" data-act="down">↓</button>
      <button type="button" data-act="del">حذف</button></div>
      <textarea data-type="${c.type}" dir="${c.type === "code" ? "ltr" : "auto"}"></textarea>`;
    li.querySelector("select").value = c.type;
    const ta = li.querySelector("textarea");
    ta.value = c.source;
    ta.addEventListener("input", () => { state = M.setCell(state, i, { source: ta.value }); dirty(); });
    li.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      if (!act || act === "type") return;
      state = act === "del" ? M.deleteCell(state, i) : M.moveCell(state, i, act === "up" ? -1 : 1);
      renderCells(); dirty();
    });
    li.querySelector("select").addEventListener("change", (e) => { state = M.setCell(state, i, { type: e.target.value }); renderCells(); dirty(); });
    ol.append(li);
  });
}

function readMeta() {
  state = { ...state, title: $("cnbTitle").value, description: $("cnbDescription").value, source: $("cnbSource").value, slug: $("cnbSlug").value, runtime: $("cnbRuntime").value };
}
function writeMeta() {
  $("cnbTitle").value = state.title; $("cnbDescription").value = state.description; $("cnbSource").value = state.source;
  $("cnbSlug").value = state.slug; $("cnbRuntime").value = state.runtime;
}

function preview() {
  readMeta();
  const html = state.cells.map((c) => c.type === "code"
    ? `<pre><code>${escapeHtml(c.source)}</code></pre>` : `<div>${renderMarkdown(c.source)}</div>`).join("");
  $("cnbPreview").innerHTML = `<h3>${escapeHtml(state.title)}</h3>${html}`;
  $("cnbPreview").hidden = false;
  reviewed = true; refresh();
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
  cs.addEventListener("change", () => { fill(); refresh(); });
  fill();
}

async function save(e) {
  e.preventDefault();
  readMeta();
  const v = M.validateState(state);
  if (!reviewed || v.errors.length) return;
  const payload = M.buildPayload(state);
  if (localMode) {
    const err = saveLocal(payload);
    if (err) return showNotification("تعذر الحفظ", err, "error");
    showNotification("تم الحفظ", 'تم حفظ الدفتر في "امتحاناتك".', "success");
    setTimeout(() => { location.href = `/notebook/${encodeURIComponent(editId)}?type=user`; }, 800);
    return;
  }
  const res = editId
    ? await api({ action: "update-notebook", id: editId, ...payload })
    : await api({ action: "create-notebook", ...payload, courseId: $("cnbCourse").value, folderId: $("cnbFolder").value || null });
  if (!res.ok) return showNotification("تعذر الحفظ", res.body.error || "خطأ غير معروف", "error");
  showNotification("تم الحفظ", "تم نشر الدفتر.", "success");
  setTimeout(() => { location.href = `/notebook/${encodeURIComponent(res.body.id || editId)}`; }, 800);
}

function applyLocalUi() {
  $("cnbPlacementRow").hidden = true;
  $("cnbSlug").closest("label").hidden = true;
  $("cnbSave").textContent = "حفظ في امتحاناتك";
  $("cnbLead").textContent = "دفتر MATLAB تعليمي يعمل داخل متصفحك (مفسّر بأسلوب MATLAB وليس MATLAB الأصلي). يُحفظ في «امتحاناتك» على جهازك، ويمكنك استيراد ملف .ipynb أو .m. تُنشأ الدفاتر للجميع دائماً.";
}

async function init() {
  // Open to everyone, like create-quiz / create-lesson: notebooks are saved
  // locally in امتحاناتك. The platform-publish path is only used by an admin who
  // arrives with an MCP ?draft= link or edits a published notebook (?edit=<uuid>).
  const params = new URLSearchParams(location.search);
  const edit = params.get("edit");
  const admin = isAdminAuthenticated();
  const editIsLocal = !!edit && /^user_notebook_/.test(edit);
  localMode = !(admin && ((edit && !editIsLocal) || params.get("draft")));
  $("cnbForm").hidden = false;
  if (localMode) applyLocalUi(); else await loadPlacement();
  try {
    const draft = await fetchImportDraft("notebook");
    if (draft) state = M.notebookFromPayload(JSON.parse(draft));
    else if (edit && localMode) {
      const row = readLocal().find((r) => (r.id || r.meta?.id) === edit && r.meta?.type === "notebook");
      if (!row) throw new Error("الدفتر غير موجود في امتحاناتك.");
      state = M.notebookFromPayload({ ...row.notebook, title: row.meta?.title, description: row.meta?.description, source: row.meta?.source, slug: "" });
      editId = edit;
    } else if (edit) {
      const r = await api({ action: "get-notebook", id: edit });
      if (!r.ok) throw new Error(r.body.error || "تعذر تحميل الدفتر.");
      state = M.notebookFromPayload(r.body.notebook); editId = edit;
      $("cnbPlacementRow").hidden = true;
    }
  } catch (err) { showNotification("تعذر التحميل", err.message, "error"); }
  writeMeta(); renderCells(); refresh();
  $("cnbForm").addEventListener("input", (e) => { if (e.target.closest("#cnbCells")) return; readMeta(); dirty(); });
  $("cnbAddMd").onclick = () => { state = M.addCell(state, "markdown"); renderCells(); dirty(); };
  $("cnbAddCode").onclick = () => { state = M.addCell(state, "code"); renderCells(); dirty(); };
  $("cnbImport").onclick = () => $("cnbImportInput").click();
  $("cnbImportInput").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      readMeta();
      const r = M.importFileInto(state, f.name, await f.text());
      state = r.state; writeMeta(); renderCells(); dirty();
      if (r.warnings.length) showNotification("ملاحظات الاستيراد", r.warnings.join("\n"), "warning", 10);
    } catch (err) { showNotification("فشل الاستيراد", err.message, "error"); }
    e.target.value = "";
  };
  $("cnbReview").onclick = preview;
  $("cnbForm").addEventListener("submit", save);
}
void init();

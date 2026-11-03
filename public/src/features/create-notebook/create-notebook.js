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
  $("cnbSave").disabled = !(reviewed && !v.errors.length && ($("cnbCourse").value || editId));
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
  const res = editId
    ? await api({ action: "update-notebook", id: editId, ...payload })
    : await api({ action: "create-notebook", ...payload, courseId: $("cnbCourse").value, folderId: $("cnbFolder").value || null });
  if (!res.ok) return showNotification("تعذر الحفظ", res.body.error || "خطأ غير معروف", "error");
  showNotification("تم الحفظ", "تم نشر الدفتر.", "success");
  setTimeout(() => { location.href = `/notebook/${encodeURIComponent(res.body.id || editId)}`; }, 800);
}

async function init() {
  if (!isAdminAuthenticated()) {
    $("cnbGate").hidden = false;
    $("cnbGate").textContent = "هذه الصفحة للمشرفين فقط. سجّل الدخول كمشرف ثم أعد فتح الرابط.";
    return;
  }
  $("cnbForm").hidden = false;
  await loadPlacement();
  try {
    const draft = await fetchImportDraft("notebook");
    const edit = new URLSearchParams(location.search).get("edit");
    if (draft) state = M.notebookFromPayload(JSON.parse(draft));
    else if (edit) {
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

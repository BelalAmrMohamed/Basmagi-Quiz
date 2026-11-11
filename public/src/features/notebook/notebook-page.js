// =============================================================================
// public/src/features/notebook/notebook-page.js
// /notebook/:slug-or-id — loads a PUBLISHED notebook (notebook_public) and
// mounts the notebook runtime selected by notebook.runtime.
// MATLAB code runs in a Web Worker; C++ code runs through an online compiler. Learner
// edits are autosaved locally by the runtime, scoped by notebook id + schema
// version. Notebooks are unscored (no attempts / points / profile sync).
// =============================================================================
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { parseNotebookRoute, isUuid, prepareNotebook } from "./notebook-data.js";
import { resolveNotebookLang, notebookText } from "../../shared/notebook-lang.js";
import { showNotebookInfoModal } from "../home/notebook-actions.js";
import { createWorkspaceBridge } from "../../shared/workspace-bridge.js";
import { exportNotebookZip } from "../../shared/notebook-bundle.js";
import { loadRuntime } from "../../shared/runtime-loader.js";
import { _prompt } from "../../components/notifications/notifications.js";
import { RUNTIME_CONFIG } from "../../shared/runtime-config.js";
import "./image-tool-window.js";
import "./notebook-output-controls.js";
import "./notebook-menu-controls.js";
import { mountNotebookAgent } from "./notebook-agent.js";

const LOAD_TIMEOUT_MS = 15000;

const $ = (id) => document.getElementById(id);

function showError(message, { retry } = {}) {
  const status = $("notebookStatus");
  $("contentArea").setAttribute("aria-busy", "false");
  status.className = "notebook-status notebook-status--error";
  status.setAttribute("role", "alert");
  status.replaceChildren();
  const text = document.createElement("p");
  text.textContent = message;
  status.append(text);
  if (retry) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notebook-retry";
    btn.textContent = "إعادة المحاولة";
    btn.addEventListener("click", retry);
    status.append(btn);
  }
  const home = document.createElement("a");
  home.href = "/";
  home.className = "notebook-home-link";
  home.textContent = "العودة إلى الصفحة الرئيسية";
  status.append(home);
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchNotebookRow(ref) {
  const supabase = await ensureSharedSupabaseClient();
  if (!supabase) throw new Error("تعذر الاتصال بالخادم.");
  const query = supabase
    .from("notebook_public")
    .select("*");
  const request = isUuid(ref) ? query.eq("id", ref).maybeSingle() : query.eq("slug", ref).maybeSingle();
  const { data, error } = await withTimeout(request, LOAD_TIMEOUT_MS, "انتهت مهلة تحميل الدفتر.");
  if (error) throw new Error("تعذر تحميل الدفتر. حاول مجدداً.");
  return data || null;
}

const cellToPlain = (c) => ({ type: c.type, source: c.source, ...(typeof c.stdin === "string" ? { stdin: c.stdin } : {}), ...(c.challenge && typeof c.challenge === "object" ? { challenge: c.challenge } : {}) });

/** Workspace (browser-only) notebook from امتحاناتك: /notebook/<user_notebook_…>?type=user */
function readLocalNotebookRow(ref) {
  let items;
  try { items = JSON.parse(localStorage.getItem("user_quizzes") || "[]"); } catch { return null; }
  const r = Array.isArray(items) ? items.find((i) => (i.id || i.meta?.id) === ref && i.meta?.type === "notebook") : null;
  if (!r) return null;
  return {
    ...r,
    id: r.id || r.meta?.id,
    title: r.meta?.title,
    description: r.meta?.description,
    runtime: r.notebook?.runtime,
    content: r.notebook?.content,
    language: r.notebook?.language || r.meta?.language || "",
  };
}

function applyPageLang(lang) {
  const area = $("contentArea");
  area.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  area.setAttribute("lang", lang);
  const loadingLabel = $("notebookStatus").querySelector(".notebook-loading-label");
  if (loadingLabel) loadingLabel.textContent = lang === "ar" ? "جاري تجهيز الدفتر…" : "Preparing your notebook…";
}

async function init() {
  const route = parseNotebookRoute(location.pathname, location.search);
  if (route.mode !== "view") return startEditorMode(route);
  const ref = route.ref;
  if (!ref) return showError("رابط الدفتر غير صالح.");

  let row;
  const isLocal = new URLSearchParams(location.search).get("type") === "user" || /^user_notebook_/.test(ref);
  if (isLocal) {
    row = readLocalNotebookRow(ref);
  } else {
    try {
      row = await fetchNotebookRow(ref);
    } catch (e) {
      return showError(e.message || "تعذر تحميل الدفتر.", { retry: init });
    }
  }

  const prepared = prepareNotebook(row);
  if (!prepared.ok) return showError(prepared.message);
  const { notebook } = prepared;
  const lang = resolveNotebookLang(row.language || row.content?.language, notebook);
  applyPageLang(lang);
  const disclaimer = $("notebookDisclaimer");
  disclaimer.textContent = notebookText(lang, "disclaimer", notebook.runtime);
  disclaimer.hidden = false;

  document.title = `${notebook.title} | دفتر تفاعلي | منصة امتحانات بصمجي`;
  const metaDescription = notebook.runtime === "cpp"
    ? "Interactive C++17 notebook. Code is sent to an online compiler to run; an internet connection is required."
    : "دفتر تفاعلي بأسلوب MATLAB يعمل داخل المتصفح على منصة امتحانات بصمجي";
  for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    document.querySelector(selector)?.setAttribute("content", metaDescription);
  }

  let runtime;
  try {
    runtime = await loadRuntime(notebook.runtime);
  } catch {
    return showError(notebookText(lang, "runtimeFailed"), { retry: init });
  }

  let handle;
  try {
    handle = runtime.mount({
      root: $("notebookRoot"),
      baseUrl: RUNTIME_CONFIG[notebook.runtime].base,
      notebook,
      lang,
      onInfo: () => showNotebookInfoModal(row),
      onPrompt: (message, value) => _prompt(message, value, { dismissOnBackdrop: false }),
            onNotice: (message) => window.dispatchEvent(new CustomEvent("notebook:notice", { detail: message })),
    });
  } catch (e) {
    console.error("[notebook-page] mount failed:", e);
    return showError(notebookText(lang, "mountFailed"));
  }
  if (notebook.runtime === "cpp") {
    window.__mlwebImport = async (file) => {
      try {
        if (/\.notebook\.zip$/i.test(file.name)) {
          const { parseNotebookZip } = await import("../../shared/workspace-zip.js");
          const bundle = await parseNotebookZip(await file.arrayBuffer());
          handle?.setCells?.(bundle.meta.content?.cells || bundle.meta.cells || []);
          return;
        }
        const { notebookFromFile } = await import("../../shared/notebook-convert.js");
        const imported = notebookFromFile(file.name, await file.text());
        if (imported.runtime !== notebook.runtime) throw new Error("Choose a C++ source file or C++ Jupyter notebook.");
        handle?.setCells?.(imported.content.cells);
        imported.warnings.forEach((message) => window.dispatchEvent(new CustomEvent("notebook:notice", { detail: message })));
      } catch (error) {
        window.dispatchEvent(new CustomEvent("notebook:notice", { detail: error.message || "Import failed" }));
      }
    };
    window.addEventListener("pagehide", () => { delete window.__mlwebImport; }, { once: true });
  }
  $("notebookStatus").hidden = true;
  $("contentArea").setAttribute("aria-busy", "false");
  const wsKey = isLocal ? ref : `pub_${notebook.id}`;
  mountNotebookAgent({ getHandle: () => handle, notebook, lang });
  window.__mlwebExport = {
    zip: () => exportNotebookZip({
      title: notebook.title, description: notebook.description, source: row.source || row.meta?.source || "", runtime: notebook.runtime, language: lang,
      cells: (handle?.getCells?.() || notebook.cells).map(cellToPlain), keys: [wsKey], assets: notebook.assets,
    }).catch((e) => window.dispatchEvent(new CustomEvent("notebook:notice", { detail: e.message || "Export failed" }))),
  };
  if (!isLocal) addCopyBar({ title: notebook.title, description: notebook.description, source: row.source || "", runtime: notebook.runtime, assets: notebook.assets }, lang, () => (handle?.getCells?.() || notebook.cells).map(cellToPlain), wsKey);
  restoreFiles(wsKey, notebook.assets).then((bridge) => bridge && import("./notebook-files-strip.js").then(({ mountFilesStrip }) => mountFilesStrip({
    before: $("notebookRoot"), lang, bridge,
    getMeta: () => ({ title: notebook.title, description: notebook.description, source: row.source || "", runtime: notebook.runtime, language: lang, cells: (handle?.getCells?.() || notebook.cells).map(cellToPlain), assets: notebook.assets }),
  }))).catch((e) => console.warn("[notebook-page] files strip failed:", e));
}

/** /notebook/new and /notebook/edit/<id>: the editor (and, for admins, publishing) loads on demand. */
async function startEditorMode(route) {
  $("notebookDisclaimer").hidden = true;
  if (route.mode === "edit" && !route.ref) return showError("رابط الدفتر غير صالح.");
  $("notebookStatus").hidden = true;
  $("notebookRoot").hidden = true;
  $("cnbShell").hidden = false;
  $("contentArea").classList.remove("notebook-page-shell");
  $("contentArea").setAttribute("aria-busy", "false");
  document.title = `${route.mode === "new" ? "إنشاء دفتر تفاعلي" : "تعديل دفتر تفاعلي"} | منصة امتحانات بصمجي`;
  document.querySelector('meta[name="robots"]')?.setAttribute("content", "noindex, nofollow");
  document.querySelector('link[rel="canonical"]')?.remove();
  document.querySelector('.menu-item[href="/notebook/new"]')?.classList.add("active");
  const { startEditor } = await import("./notebook-editor.js");
  await startEditor(route.mode === "edit" ? route.ref : null);
}

/**
 * "Edit a copy" for published notebooks (copy lives only in this browser's My
 * Content). Lives inside the runtime's own notebook menu (.toolbar-menu-items)
 * rather than a separate bar above the notebook — the runtime rebuilds that
 * menu on mount and on state changes, so (like notebook-files-strip.js's Drive
 * items) a MutationObserver re-adds the entry whenever it disappears.
 */
function addCopyBar(nb, lang, getCells, wsKey) {
  const label = lang === "ar" ? "تعديل نسخة خاصة بي" : "Edit a copy";
  let busy = false;
  const root = $("notebookRoot");

  const run = async (btn) => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      const { copyNotebookToLocal } = await import("./notebook-copy.js");
      const id = await copyNotebookToLocal({ ...nb, language: lang, cells: getCells(), sourceKey: wsKey });
      location.href = `/notebook/edit/${encodeURIComponent(id)}`;
    } catch (e) {
      busy = false;
      btn.disabled = false;
      window.dispatchEvent(new CustomEvent("notebook:notice", { detail: e.message || "Could not create a copy" }));
    }
  };

  let queued = false;
  const inject = () => {
    queued = false;
    const menu = root.querySelector(".toolbar-menu-items");
    if (!menu || menu.querySelector("[data-nb-edit-copy]")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    btn.dataset.nbEditCopy = "";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      btn.closest("details")?.removeAttribute("open");
      run(btn);
    });
    menu.append(btn);
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(inject); } }).observe(root, { childList: true, subtree: true });
  inject();
}

/** Workspace files: the visitor's own saved files first, then the published manifest (missing names only). */
async function restoreFiles(key, assets) {
  try {
    const bridge = createWorkspaceBridge(key, { onWarn: (m) => window.dispatchEvent(new CustomEvent("notebook:notice", { detail: m })) });
    await bridge.restore();
    const have = new Set((await bridge.list()).map((f) => f.path));
    const missing = (assets || []).filter((a) => !have.has(a.path));
    if (missing.length) await bridge.loadManifest(missing);
    return bridge;
  } catch (e) { console.warn("[notebook-page] workspace restore failed:", e); return null; }
}

void init();

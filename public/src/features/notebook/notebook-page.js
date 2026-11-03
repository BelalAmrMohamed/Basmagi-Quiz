// =============================================================================
// public/src/features/notebook/notebook-page.js
// /notebook/:slug-or-id — loads a PUBLISHED notebook (notebook_public) and
// mounts the browser-only MATLAB-style runtime (assets/notebook-runtime/).
// Learner code runs in a Web Worker and is never sent to a server; learner
// edits are autosaved locally by the runtime, scoped by notebook id + schema
// version. Notebooks are unscored (no attempts / points / profile sync).
// =============================================================================
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { parseNotebookRef, isUuid, prepareNotebook } from "./notebook-data.js";

const RUNTIME_BASE = "/assets/notebook-runtime/";
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
    .select("id, slug, title, description, source, runtime, content, updated_at");
  const request = isUuid(ref) ? query.eq("id", ref).maybeSingle() : query.eq("slug", ref).maybeSingle();
  const { data, error } = await withTimeout(request, LOAD_TIMEOUT_MS, "انتهت مهلة تحميل الدفتر.");
  if (error) throw new Error("تعذر تحميل الدفتر. حاول مجدداً.");
  return data || null;
}

let runtimePromise = null;
function loadRuntime() {
  if (window.MLWebNotebook?.mount) return Promise.resolve(window.MLWebNotebook);
  if (!runtimePromise) {
    runtimePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${RUNTIME_BASE}runtime.js`;
      script.async = true;
      script.onload = () => (window.MLWebNotebook?.mount ? resolve(window.MLWebNotebook) : reject(new Error("runtime missing")));
      script.onerror = () => { runtimePromise = null; reject(new Error("runtime failed to load")); };
      document.head.append(script);
    });
  }
  return runtimePromise;
}

async function init() {
  const ref = parseNotebookRef(location.pathname, location.search);
  if (!ref) return showError("رابط الدفتر غير صالح.");

  let row;
  try {
    row = await fetchNotebookRow(ref);
  } catch (e) {
    return showError(e.message || "تعذر تحميل الدفتر.", { retry: init });
  }

  const prepared = prepareNotebook(row);
  if (!prepared.ok) return showError(prepared.message);
  const { notebook } = prepared;

  document.title = `${notebook.title} | دفتر تفاعلي | منصة امتحانات بصمجي`;
  $("notebookTitle").textContent = notebook.title;
  $("notebookDescription").textContent = notebook.description;
  $("notebookDescription").hidden = !notebook.description;
  $("notebookHeader").hidden = false;

  let runtime;
  try {
    runtime = await loadRuntime();
  } catch {
    return showError("تعذر تحميل بيئة تشغيل الدفتر. تحقق من اتصالك ثم أعد المحاولة.", { retry: init });
  }

  try {
    runtime.mount({
      root: $("notebookRoot"),
      baseUrl: RUNTIME_BASE,
      notebook,
      lang: "ar",
      onNotice: (message) => window.dispatchEvent(new CustomEvent("notebook:notice", { detail: message })),
    });
  } catch (e) {
    console.error("[notebook-page] mount failed:", e);
    return showError("تعذر تشغيل الدفتر في هذا المتصفح.");
  }
  $("notebookStatus").hidden = true;
  $("contentArea").setAttribute("aria-busy", "false");
}

void init();

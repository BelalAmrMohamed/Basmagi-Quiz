// =============================================================================
// public/src/features/notebook/notebook-data.js
// Pure helpers for the /notebook/:slug-or-id page (unit-tested in
// tests/notebook-page.test.js; no DOM, no network).
// =============================================================================
import { checkNotebook, NOTEBOOK_RUNTIMES, NOTEBOOK_SCHEMA_VERSION } from "../../shared/content-rules.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extracts the id/slug from /notebook/<ref> (or ?id=<ref>); null when absent. */
export function parseNotebookRef(pathname, search = "") {
  const m = String(pathname || "").match(/^\/notebook\/([^/?#]+)\/?$/);
  let ref = null;
  if (m) {
    try { ref = decodeURIComponent(m[1]); } catch { ref = m[1]; }
  } else {
    ref = new URLSearchParams(search).get("id");
  }
  ref = (ref || "").trim();
  return ref || null;
}

/**
 * Route of the single notebook page: /notebook/new, /notebook/edit/<id>, /notebook/<ref>.
 * (Vercel rewrites keep the original pathname; ?mode= is only the rewrite target and is honoured too.)
 * @returns {{ mode: "view"|"new"|"edit", ref: string|null }}
 */
export function parseNotebookRoute(pathname, search = "") {
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const path = String(pathname || "");
  if (/^\/notebook\/new\/?$/.test(path)) return { mode: "new", ref: null };
  const e = path.match(/^\/notebook\/edit\/([^/?#]+)\/?$/);
  if (e) return { mode: "edit", ref: dec(e[1]).trim() || null };
  const q = new URLSearchParams(search);
  if (q.get("mode") === "new") return { mode: "new", ref: null };
  if (q.get("mode") === "edit") return { mode: "edit", ref: (q.get("id") || "").trim() || null };
  return { mode: "view", ref: parseNotebookRef(path, search) };
}

export const isUuid = (s) => UUID_RE.test(String(s || ""));

/**
 * Validates a row read from notebook_public before it reaches the runtime.
 * Never throws; returns { ok:true, notebook } or { ok:false, kind, message }.
 *   kind: "unavailable" | "malformed" | "unsupported"
 */
export function prepareNotebook(row) {
  if (!row) return { ok: false, kind: "unavailable", message: "هذا الدفتر غير موجود أو غير متاح للعرض." };
  if (!NOTEBOOK_RUNTIMES.includes(row.runtime)) {
    return { ok: false, kind: "unsupported", message: `بيئة التشغيل "${row.runtime}" غير مدعومة في هذا الإصدار.` };
  }
  const content = row.content;
  if (!content || typeof content !== "object" || content.schemaVersion !== NOTEBOOK_SCHEMA_VERSION) {
    return { ok: false, kind: "malformed", message: "محتوى الدفتر بصيغة غير مدعومة أو تالفة." };
  }
  const check = checkNotebook({ content, runtime: row.runtime }, { contentOnly: true });
  if (check.errors.length) {
    return { ok: false, kind: "malformed", message: "محتوى الدفتر غير صالح: " + check.errors[0].message };
  }
  return {
    ok: true,
    notebook: {
      id: row.id,
      title: String(row.title || ""),
      description: String(row.description || ""),
      schemaVersion: content.schemaVersion,
      language: content.language || "",
      runtime: row.runtime,
      cells: content.cells.map((c, i) => ({ id: c.id || `cell-${i + 1}`, type: c.type, source: c.source, ...(typeof c.stdin === "string" ? { stdin: c.stdin } : {}), ...(c.challenge && typeof c.challenge === "object" ? { challenge: c.challenge } : {}) })),
      // published workspace files [{path,mime,size,sha256,url}], fetched into the virtual folder after mount
      assets: Array.isArray(content.assets) ? content.assets : [],
    },
  };
}

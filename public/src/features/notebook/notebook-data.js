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
  const check = checkNotebook({ content }, { contentOnly: true });
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
      cells: content.cells.map((c, i) => ({ id: c.id || `cell-${i + 1}`, type: c.type, source: c.source })),
    },
  };
}

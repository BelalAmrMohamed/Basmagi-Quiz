// =============================================================================
// public/src/features/create-notebook/notebook-editor-model.js
// Pure state helpers for the /create-notebook editor (unit-tested; no DOM).
// =============================================================================
import { checkNotebook, normalizeNotebookContent, NOTEBOOK_RUNTIMES, formatIssueList } from "../../shared/content-rules.js";
import { notebookFromFile } from "../../shared/notebook-convert.js";

export function emptyNotebook() {
  return { title: "", description: "", source: "", slug: "", runtime: NOTEBOOK_RUNTIMES[0], cells: [{ type: "markdown", source: "" }, { type: "code", source: "" }] };
}

/** Accepts a draft/MCP payload or a published row and returns editor state. */
export function notebookFromPayload(p) {
  const cells = Array.isArray(p?.cells) ? p.cells : Array.isArray(p?.content?.cells) ? p.content.cells : [];
  return {
    title: String(p?.title || ""),
    description: String(p?.description || ""),
    source: /^https?:\/\//i.test(p?.source || "") ? p.source : "",
    slug: String(p?.slug || ""),
    // Never default a missing/unknown runtime here: validation must flag it.
    runtime: typeof p?.runtime === "string" ? p.runtime : "",
    cells: cells.map((c) => ({ id: c.id, type: c.type, source: typeof c.source === "string" ? c.source : "" })),
  };
}

export function addCell(state, type, at = state.cells.length) {
  const cells = state.cells.slice();
  cells.splice(Math.max(0, Math.min(at, cells.length)), 0, { type: type === "code" ? "code" : "markdown", source: "" });
  return { ...state, cells };
}

export function deleteCell(state, index) {
  if (index < 0 || index >= state.cells.length) return state;
  return { ...state, cells: state.cells.filter((_, i) => i !== index) };
}

export function moveCell(state, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= state.cells.length || to < 0 || to >= state.cells.length) return state;
  const cells = state.cells.slice();
  const [c] = cells.splice(index, 1);
  cells.splice(to, 0, c);
  return { ...state, cells };
}

export function setCell(state, index, patch) {
  return { ...state, cells: state.cells.map((c, i) => (i === index ? { ...c, ...patch } : c)) };
}

/** Request body for create-notebook / update-notebook (ids normalized, editor keys dropped). */
export function buildPayload(state) {
  return {
    title: state.title.trim(),
    description: state.description.trim(),
    source: state.source.trim(),
    runtime: state.runtime,
    slug: state.slug.trim() || null,
    content: normalizeNotebookContent(state.cells),
  };
}

/** Same shared rules as the API/MCP: { errors:[msg], warnings:[msg] }. */
export function validateState(state) {
  const check = checkNotebook({ ...state, content: normalizeNotebookContent(state.cells) });
  return { errors: check.errors.map((e) => e.message), warnings: check.warnings.map((w) => w.message), text: formatIssueList(check.errors) };
}

/** Imports a .ipynb/.m file; replaces cells and (if blank) title. Returns { state, warnings }. */
export function importFileInto(state, fileName, text) {
  const r = notebookFromFile(fileName, text);
  return {
    state: { ...state, title: state.title.trim() ? state.title : r.title, runtime: r.runtime, cells: r.content.cells.map((c) => ({ type: c.type, source: c.source })) },
    warnings: r.warnings,
  };
}

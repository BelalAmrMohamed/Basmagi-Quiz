// =============================================================================
// public/src/shared/notebook-export.js
// Pure helpers for notebooks that live in cards (local امتحاناتك rows and
// platform notebook_public rows): normalisation, info, AI-attachment payload,
// and the export formats .ipynb / .m / printable HTML. No DOM, no network.
// =============================================================================
import { resolveNotebookLang } from "./notebook-lang.js";

const strOf = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * Accepts a local row ({id, meta, stats, notebook:{runtime, content}}) or a platform
 * row ({id, slug, title, description, source, runtime, content, created_at, updated_at})
 * and returns the canonical flat notebook.
 */
export function rowToNotebook(row) {
  const local = !!(row && row.meta && row.notebook);
  const content = (local ? row.notebook?.content : row?.content) || {};
  const cells = (Array.isArray(content.cells) ? content.cells : []).map((c, i) => ({
    id: strOf(c?.id) || `cell-${i + 1}`,
    type: c?.type === "code" ? "code" : "markdown",
    source: strOf(c?.source),
    ...(typeof c?.stdin === "string" ? { stdin: c.stdin } : {}),
    ...(c?.challenge && typeof c.challenge === "object" ? { challenge: c.challenge } : {}),
  }));
  const title = strOf(local ? row.meta?.title : row?.title).trim() || "Untitled notebook";
  const description = strOf(local ? row.meta?.description : row?.description).trim();
  return {
    id: strOf(row?.id || row?.meta?.id),
    slug: strOf(row?.slug),
    title,
    description,
    source: strOf(local ? row.meta?.source : row?.source).trim(),
    runtime: strOf(local ? row.notebook?.runtime : row?.runtime) || "matlab",
    language: resolveNotebookLang(content.language, { title, description, cells }),
    createdAt: (local ? row.meta?.createdAt : row?.created_at) || null,
    updatedAt: (local ? row.meta?.updatedAt : row?.updated_at) || null,
    createdBy: local ? null : (row?.created_by || row?.createdBy || null), // platform notebooks only
    local,
    cells,
    assets: Array.isArray(content.assets) ? content.assets : [],
  };
}

export function collectNotebookInfo(row) {
  const nb = rowToNotebook(row);
  const code = nb.cells.filter((c) => c.type === "code");
  const lines = code.reduce((n, c) => n + (c.source ? c.source.split("\n").length : 0), 0);
  return {
    id: nb.id, title: nb.title, description: nb.description, source: nb.source, runtime: nb.runtime, language: nb.language,
    cellCount: nb.cells.length, codeCount: code.length, markdownCount: nb.cells.length - code.length, codeLines: lines,
    createdAt: nb.createdAt, updatedAt: nb.updatedAt, createdBy: nb.createdBy, local: nb.local, slug: nb.slug,
  };
}

export function summarizeNotebook(row) {
  const i = collectNotebookInfo(row);
  return `Interactive MATLAB-style notebook — ${i.cellCount} cells (${i.codeCount} code, ${i.markdownCount} text), language: ${i.language === "ar" ? "Arabic" : "English"}.`;
}

/** What the AI assistant reads: attached through the lesson path, so `content` is returned verbatim. */
export function notebookAttachmentPayload(row) {
  const nb = rowToNotebook(row);
  return {
    description: nb.description,
    passwordProtected: false,
    content: {
      type: "notebook",
      title: nb.title,
      source: nb.source,
      runtime: nb.runtime,
      language: nb.language,
      note: `Executable educational notebook (${runtimeName(nb.runtime)}). Cells are in order; 'code' cells are ${nb.runtime === "cpp" ? "C++" : "MATLAB"} code, 'markdown' cells are explanations.`,
      cells: nb.cells.map((c, i) => ({ n: i + 1, type: c.type, source: c.source, ...(typeof c.stdin === "string" ? { stdin: c.stdin } : {}), ...(c.challenge ? { challenge: c.challenge } : {}) })),
    },
  };
}

const lines = (s) => s.split("\n").map((l, i, a) => (i < a.length - 1 ? l + "\n" : l));

/** Jupyter nbformat 4.5 document (outputs are not stored, so code cells export without outputs). */
export function notebookToIpynb(input) {
  const nb = input?.cells && input?.title !== undefined && !input.meta ? input : rowToNotebook(input);
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      title: nb.title,
      kernelspec: nb.runtime === "cpp" ? { name: "xcpp17", display_name: "C++17", language: "C++" } : { name: "matlab", display_name: "MATLAB (educational subset)", language: "matlab" },
      language_info: nb.runtime === "cpp" ? { name: "C++", file_extension: ".cpp", mimetype: "text/x-c++src" } : { name: "matlab", file_extension: ".m", mimetype: "text/x-matlab" },
      basmagi: { title: nb.title, runtime: nb.runtime, language: nb.language, description: nb.description, source: nb.source },
    },
    cells: nb.cells.map((c, i) => {
      const id = (c.id || `cell-${i + 1}`).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64) || `cell-${i + 1}`;
      return c.type === "code"
        ? { id, cell_type: "code", metadata: { ...(c.stdin !== undefined ? { stdin: c.stdin } : {}), ...(c.challenge ? { challenge: c.challenge } : {}) }, execution_count: null, source: lines(c.source), outputs: [] }
        : { id, cell_type: "markdown", metadata: {}, source: lines(c.source) };
    }),
  };
}

/** Display name of a runtime ("C++" / "MATLAB (educational subset)"). */
export const runtimeName = (runtime) => (runtime === "cpp" ? "C++" : "MATLAB (educational subset)");

/**
 * Everything the notebook is, as one JSON document: title, description, source link, language, runtime and every cell
 * (with its stdin and challenge). It has the same shape the "new notebook" importer reads, so it can be imported again.
 */
export function notebookToJson(input) {
  const nb = input?.cells && input?.title !== undefined && !input.meta ? input : rowToNotebook(input);
  return {
    format: "basmagi-notebook",
    version: 1,
    title: nb.title,
    description: nb.description,
    source: nb.source,
    runtime: nb.runtime,
    language: nb.language,
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
    cells: nb.cells.map((c) => ({
      type: c.type,
      source: c.source,
      ...(typeof c.stdin === "string" ? { stdin: c.stdin } : {}),
      ...(c.challenge ? { challenge: c.challenge } : {}),
    })),
    assets: nb.assets,
  };
}

/** A C++ source file: cells are separated by `//%%` lines; Markdown cells become comments. The runtime's own .cpp import reads this back. */
export function notebookToCppScript(input) {
  const nb = input?.cells && input?.title !== undefined && !input.meta ? input : rowToNotebook(input);
  const out = [`// ${nb.title}`];
  if (nb.description) out.push(...nb.description.split("\n").map((l) => `// ${l}`));
  if (nb.source) out.push(`// Source: ${nb.source}`);
  out.push("// Exported from Basmagi Quiz (C++ notebook).", "");
  for (const c of nb.cells) {
    if (c.type === "code") out.push("//%%", c.source.replace(/\s+$/, ""), "");
    else {
      const text = c.source.replace(/\s+$/, "").split("\n");
      if (!text.some((l) => l.trim())) continue;
      out.push("//%%", ...text.map((l) => (l.trim() ? `// ${l}` : "//")), "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/** A MATLAB script using `%%` sections. Markdown cells become comment sections; code cells are kept verbatim. */
export function notebookToMScript(input) {
  const nb = input?.cells && input?.title !== undefined && !input.meta ? input : rowToNotebook(input);
  const out = [`% ${nb.title}`];
  if (nb.description) out.push(...nb.description.split("\n").map((l) => `% ${l}`));
  if (nb.source) out.push(`% Source: ${nb.source}`);
  out.push("% Exported from Basmagi Quiz (educational MATLAB-style notebook).", "");
  for (const c of nb.cells) {
    if (c.type === "code") {
      out.push("%%", c.source.replace(/\s+$/, ""), "");
    } else {
      const text = c.source.replace(/\s+$/, "").split("\n");
      const first = text.findIndex((l) => l.trim());
      if (first === -1) continue;
      out.push(`%% ${text[first].replace(/^#+\s*/, "").trim()}`);
      for (const l of text.slice(first + 1)) out.push(l.trim() ? `% ${l}` : "%");
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

const escHtml = (s) => strOf(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/**
 * Standalone printable HTML. `renderMarkdown(src) -> html` is injected (the browser
 * renderer in shared/markdown.js) so this stays pure; without it text is escaped.
 */
export function notebookToHtml(input, { renderMarkdown } = {}) {
  const nb = input?.cells && input?.title !== undefined && !input.meta ? input : rowToNotebook(input);
  const rtl = nb.language === "ar";
  const md = (s) => (typeof renderMarkdown === "function" ? renderMarkdown(s) : `<p>${escHtml(s).replace(/\n/g, "<br>")}</p>`);
  let n = 0;
  const body = nb.cells.map((c) => {
    if (c.type === "markdown") return `<section class="md">${md(c.source)}</section>`;
    n += 1;
    return `<section class="code"><span class="prompt">In [${n}]:</span><pre dir="ltr">${escHtml(c.source)}</pre></section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="${nb.language}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(nb.title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
  :root { color-scheme: light; }
  body { font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; color: #1d2433; max-width: 900px; margin: 0 auto; padding: 28px 18px 60px; }
  h1.title { margin: 0 0 4px; font-size: 1.9rem; }
  .desc { color: #5b6475; margin: 0 0 6px; }
  .meta { color: #667085; font-size: .85rem; margin-bottom: 22px; }
  .md img { max-width: 100%; }
  .md pre, .md code { background: #f0f2f7; border-radius: 4px; }
  .md code { padding: 1px 5px; } .md pre { padding: 10px 12px; overflow: auto; direction: ltr; text-align: left; }
  .code { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 8px; margin: 10px 0; direction: ltr; }
  .code .prompt { color: #307fc1; font: 12.5px/1.8 ui-monospace, Menlo, Consolas, monospace; text-align: right; padding-top: 8px; }
  .code pre { margin: 0; padding: 10px 12px; background: #f6f7fb; border: 1px solid #dce2ed; border-radius: 4px; font: 13.5px/1.6 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .md { margin: 8px 0; }
  @media print { body { padding: 0; } .code pre { break-inside: avoid; } h1, h2, h3 { break-after: avoid; } }
</style>
</head>
<body>
<h1 class="title">${escHtml(nb.title)}</h1>
${nb.description ? `<p class="desc">${escHtml(nb.description)}</p>` : ""}
<div class="meta">${nb.source ? `<a href="${escHtml(nb.source)}">${escHtml(nb.source)}</a> · ` : ""}${nb.cells.length} cells · ${runtimeName(nb.runtime)}</div>
${body}
</body>
</html>
`;
}

/** Safe file base name (keeps Arabic letters; strips path/control characters). */
export function safeFileName(title, fallback = "notebook") {
  const s = strOf(title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return s || fallback;
}

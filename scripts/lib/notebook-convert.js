// =============================================================================
// public/src/shared/notebook-convert.js
// Pure, deterministic converters INTO the canonical notebook document
// { schemaVersion: 1, cells: [{ id, type: "markdown"|"code", source }] }.
//
//   • .ipynb  → notebookFromIpynb(text)   Markdown/code cells keep their order.
//   • .m      → notebookFromMScript(text) the script becomes ONE code cell.
//   • compiler lesson files (@id/@title … "%% md" / "%% code")
//             → parseCompilerLesson(text) + compilerLessonToNotebook(lesson)
//             This is a distinct conversion from .ipynb import.
//
// Unsupported material is never silently misrepresented: raw cells, unknown
// cell types and execution outputs are dropped and REPORTED in `warnings`;
// structurally invalid input throws an Error with an actionable (Arabic)
// message. Nothing here executes code.
//
// Used by the create-notebook page, the upload API (via the synced copy in
// scripts/lib/) and scripts/seed-notebooks.mjs. After editing run
// `npm run sync:mcp` (tests fail when a copy is out of sync).
// =============================================================================

const SCHEMA_VERSION = 1;

const toDoc = (cells) => ({
  schemaVersion: SCHEMA_VERSION,
  cells: cells.map((c, i) => ({ id: `cell-${i + 1}`, type: c.type, source: c.source, ...(typeof c.stdin === "string" ? { stdin: c.stdin } : {}), ...(c.challenge && typeof c.challenge === "object" ? { challenge: c.challenge } : {}) })),
});

const normalizeEol = (s) => String(s ?? "").replace(/\r\n?/g, "\n");
const trimBlankEdges = (s) => s.replace(/^\n+|\n+$/g, "");

/**
 * @param {string} text  raw .ipynb JSON
 * @returns {{ content: object, warnings: string[], language: string|null }}
 */
export function notebookFromIpynb(text) {
  let json;
  try {
    json = JSON.parse(String(text ?? ""));
  } catch {
    throw new Error("ملف .ipynb ليس JSON صالحاً.");
  }
  if (!json || typeof json !== "object" || !Array.isArray(json.cells)) {
    throw new Error("ملف .ipynb لا يحتوي مصفوفة cells صالحة.");
  }
  const warnings = [];
  const cells = [];
  let outputsDropped = 0;
  json.cells.forEach((cell, i) => {
    const kind = cell?.cell_type;
    const source = Array.isArray(cell?.source) ? cell.source.join("") : String(cell?.source ?? "");
    if (kind === "markdown") cells.push({ type: "markdown", source: normalizeEol(source) });
    else if (kind === "code") {
      cells.push({ type: "code", source: normalizeEol(source), ...(typeof cell?.metadata?.stdin === "string" ? { stdin: cell.metadata.stdin } : {}), ...(cell?.metadata?.challenge && typeof cell.metadata.challenge === "object" ? { challenge: cell.metadata.challenge } : {}) });
      if (Array.isArray(cell.outputs) && cell.outputs.length) outputsDropped++;
    } else {
      warnings.push(`الخلية ${i + 1}: النوع "${kind}" غير مدعوم وتم تجاهلها.`);
    }
  });
  if (outputsDropped) warnings.push(`تم تجاهل مخرجات التنفيذ في ${outputsDropped} خلية كود (لا تُحفظ المخرجات).`);
  if (!cells.length) throw new Error("لا توجد خلايا Markdown أو كود قابلة للاستيراد في هذا الملف.");

  const language = json.metadata?.language_info?.name || json.metadata?.kernelspec?.language || null;
  const runtime = /^(c\+\+|cpp)$/i.test(String(language || "")) || /cpp|c\+\+/i.test(String(json.metadata?.kernelspec?.name || "")) ? "cpp" : "matlab";
  if (runtime === "matlab" && language && !/^(matlab|octave)$/i.test(String(language))) warnings.push(`لغة الدفتر الأصلية "${language}" ليست MATLAB — سيُعامل المحتوى كـ MATLAB وقد لا يعمل.`);
  return { content: toDoc(cells), warnings, language, runtime };
}

/**
 * A .m script becomes a single code cell (cell-break `%%` markers are kept as
 * ordinary comments so the script is preserved byte-for-byte apart from EOLs).
 * @returns {{ content: object, warnings: string[] }}
 */
export function notebookFromMScript(text) {
  const source = trimBlankEdges(normalizeEol(text));
  if (!source.trim()) throw new Error("ملف .m فارغ.");
  return { content: toDoc([{ type: "code", source }]), warnings: [] };
}

/** Title from a file name: strips directories and the extension. */
export function titleFromFileName(name) {
  return String(name || "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.(ipynb|m|cpp|cc|cxx|h|hpp)$/i, "")
    .replace(/[_]+/g, " ")
    .trim();
}

/**
 * Dispatches by file name. C++ source extensions are imported as one code cell.
 * @returns {{ title: string, runtime: "matlab" | "cpp", content: object, warnings: string[] }}
 */
export function notebookFromFile(fileName, text) {
  if (/\.ipynb$/i.test(fileName)) {
    const r = notebookFromIpynb(text);
    return { title: titleFromFileName(fileName), runtime: r.runtime, content: r.content, warnings: r.warnings };
  }
  if (/\.(cpp|cc|cxx|h|hpp)$/i.test(fileName)) {
    const source = trimBlankEdges(normalizeEol(text)); if (!source.trim()) throw new Error("ملف C++ فارغ.");
    if (/^\/\/\s*%%/m.test(source)) {
      // A file exported from a notebook: `//%%` lines separate the cells; comment-only sections are the text cells.
      const isComment = (x) => x.split("\n").every((l) => /^\s*\/\//.test(l) || !l.trim());
      const parts = source.split(/^\/\/\s*%%.*$/m).map((x) => trimBlankEdges(x));
      if (parts[0] === "" || isComment(parts[0])) parts.shift(); // the header comment (title, description, source) is not a cell
      const cells = parts.filter((x) => x.trim()).map((x) => (isComment(x)
        ? { type: "markdown", source: x.split("\n").map((l) => l.replace(/^\s*\/\/ ?/, "")).join("\n") }
        : { type: "code", source: x }));
      return { title: titleFromFileName(fileName), runtime: "cpp", content: toDoc(cells), warnings: [] };
    }
    return { title: titleFromFileName(fileName), runtime: "cpp", content: toDoc([{ type: "code", source }]), warnings: [] };
  }
  if (/\.m$/i.test(fileName)) {
    const r = notebookFromMScript(text);
    return { title: titleFromFileName(fileName), runtime: "matlab", content: r.content, warnings: r.warnings };
  }
  throw new Error(`نوع الملف غير مدعوم: ${fileName} (المدعوم: .ipynb و .m وملفات C++).`);
}

// ── Compiler lesson files ───────────────────────────────────────────────────

/**
 * Parses a lesson .txt file:
 *   header lines "@key value", then cells introduced by "%% md" / "%% code".
 */
export function parseCompilerLesson(text) {
  const lesson = { id: "", title: "", group: "", files: [], cells: [] };
  let cur = null;
  for (const ln of normalizeEol(text).split("\n")) {
    let m;
    if (!cur && (m = /^@(\w+)\s*(.*)$/.exec(ln))) {
      if (m[1] === "files") lesson.files = m[2].split(/\s+/).filter(Boolean);
      else lesson[m[1]] = m[2].trim();
    } else if ((m = /^%%\s+(md|code)\s*$/.exec(ln))) {
      cur = { type: m[1], lines: [] };
      lesson.cells.push(cur);
    } else if (cur) cur.lines.push(ln);
  }
  lesson.cells = lesson.cells.map((c) => ({ type: c.type, src: trimBlankEdges(c.lines.join("\n")) }));
  return lesson;
}

/** Deterministic order of the ten compiler lessons (matches lessons.mjs). */
export const COMPILER_LESSON_ORDER = [
  "section-1", "section-2", "section-3", "section-4",
  "lecture-1", "lecture-2", "lecture-3", "lecture-4", "lecture-5", "lecture-6",
];

export const COMPILER_MIGRATION_PREFIX = "matlab-compiler:";

/**
 * Converts a parsed compiler lesson into a notebook record. Order, code and
 * markdown are preserved exactly; image assets are referenced by file name in
 * the code (they ship with the notebook runtime), listed in `assets`.
 * @returns {{ migrationKey: string, sourceLessonId: string, slug: string, sortOrder: number,
 *            title: string, runtime: "matlab" | "cpp", content: object, assets: string[] }}
 */
export function compilerLessonToNotebook(lesson) {
  if (!lesson?.id) throw new Error("ملف الدرس لا يحتوي @id.");
  if (!lesson.title) throw new Error(`الدرس ${lesson.id} لا يحتوي @title.`);
  const cells = (lesson.cells || []).map((c) => ({ type: c.type === "md" ? "markdown" : "code", source: c.src }));
  if (!cells.length) throw new Error(`الدرس ${lesson.id} لا يحتوي خلايا.`);
  const order = COMPILER_LESSON_ORDER.indexOf(lesson.id);
  return {
    migrationKey: COMPILER_MIGRATION_PREFIX + lesson.id,
    sourceLessonId: lesson.id,
    slug: `matlab-${lesson.id}`,
    sortOrder: order < 0 ? 100 : order + 1,
    title: lesson.title,
    runtime: "matlab",
    content: toDoc(cells),
    assets: [...(lesson.files || [])],
  };
}

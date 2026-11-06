// Pure (DOM-free) helpers for the local "دفتر جديد" modal: the AI prompt, the
// input parser (notebook JSON / raw .ipynb JSON / .ipynb / .m file) and the
// shared-rules validator. Unit-tested in tests/notebook-input.test.js.
import { checkNotebook, normalizeNotebookContent } from "../../shared/content-rules.js";
import { normalizeNotebookLang, detectNotebookLang } from "../../shared/notebook-lang.js";
import { notebookFromFile, notebookFromIpynb } from "../../shared/notebook-convert.js";

export const NOTEBOOK_CREATION_PROMPT = `Create an interactive executable notebook as valid JSON. Write the Markdown explanations in the language requested by the user or the language of the material; if no language is specified, use the language of the request.

Use this exact structure:
\`\`\`json
{
  "title": "Notebook title",
  "description": "Short optional description",
  "source": "https://... (Direct URL to the source lecture/drive/book, or an empty string)",
  "runtime": "matlab",
  "language": "en",
  "cells": [
    { "type": "markdown", "source": "## Explanation in Markdown..." },
    { "type": "code", "source": "x = 1:5;\\ny = x.^2\\nplot(x, y)" }
  ]
}
\`\`\`
Rules:
- "language" is "en" (English, left-to-right UI) or "ar" (Arabic, right-to-left UI): the language of the Markdown explanations.
- "runtime" MUST be "matlab" or "cpp". MATLAB is the educational browser-based subset; C++ is sent to an online compiler and needs internet.
- Alternate short Markdown cells (explanations) with small, runnable code cells. Each code cell must be self-contained enough to run top-to-bottom, and code/comments/output stay left-to-right.
- Cell "type" is only "markdown" or "code". "source" is a single string. NEVER put a literal line break inside a JSON string: write every line break as the two characters \\n, and escape double quotes (\\") and backslashes (\\\\).
- Math: every formula, variable, exponent, fraction, root, Greek letter or math symbol inside Markdown cells must be LaTeX: $...$ inline, $$...$$ display. Never plain text (x^2, sqrt(x), x²). Escape backslashes in JSON (\\\\frac). No raw HTML.
- The only images available to code are the bundled samples: test.png, testgray.png, pepper.png, Test2.png, GrayTest1.png, BinaryImage.png, GrayscaleImage.png, ColorImage.png, test_lookup.gif.
- Limits: at most 200 cells, 20000 characters per cell, 300KB in total.
- "source" MUST be only a link (or an empty string), never a sentence.
Keep the notebook accurate, clear, progressive, and useful for studying. Return ONLY the valid JSON inside one code block, with no text before or after it.`;

/** Error with everything the modal needs to explain what went wrong and where. */
export class NotebookInputError extends Error {
  constructor(headline, details = [], loc = null) {
    super(headline);
    this.name = "NotebookInputError";
    this.headline = headline;
    this.details = details; // string[]
    this.loc = loc; // { offset, line, column, snippet, caret } | null (offsets refer to the ORIGINAL text)
  }
}

const VALID_ESC = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

/**
 * Best-effort repair of the usual AI mistakes: raw line breaks / tabs inside
 * strings, invalid backslash escapes, trailing commas. Returns the repaired
 * text, an index map back into the original, and Arabic notes of what changed.
 */
export function repairJsonText(text) {
  const out = [];
  const map = [];
  const fixes = { newline: 0, ctrl: 0, escape: 0, comma: 0 };
  let inStr = false;
  const push = (ch, i) => { out.push(ch); map.push(i); };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") {
        const nx = text[i + 1];
        const hex4 = nx === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6));
        if (nx !== undefined && VALID_ESC.has(nx) && (nx !== "u" || hex4)) { push(ch, i); push(nx, i + 1); i++; }
        else { push("\\", i); push("\\", i); fixes.escape++; }
        continue;
      }
      if (ch === '"') { inStr = false; push(ch, i); continue; }
      if (ch === "\n") { push("\\", i); push("n", i); fixes.newline++; continue; }
      if (ch === "\r") { if (text[i + 1] !== "\n") { push("\\", i); push("n", i); fixes.newline++; } continue; }
      if (ch === "\t") { push("\\", i); push("t", i); fixes.ctrl++; continue; }
      if (ch < " ") { for (const c of "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")) push(c, i); fixes.ctrl++; continue; }
      push(ch, i);
      continue;
    }
    if (ch === '"') { inStr = true; push(ch, i); continue; }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") { fixes.comma++; continue; }
    }
    push(ch, i);
  }
  const notes = [];
  if (fixes.newline) notes.push(`تم إصلاح ${fixes.newline} فاصل سطر خام داخل النصوص (يجب كتابته \\n داخل JSON).`);
  if (fixes.ctrl) notes.push(`تم إصلاح ${fixes.ctrl} محرف تحكم/تبويب داخل النصوص.`);
  if (fixes.escape) notes.push(`تم إصلاح ${fixes.escape} حرف \\ غير صالح داخل النصوص (يجب مضاعفته \\\\).`);
  if (fixes.comma) notes.push(`تم حذف ${fixes.comma} فاصلة زائدة قبل } أو ].`);
  return { text: out.join(""), map, notes, changed: notes.length > 0 };
}

function locate(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const column = offset - lineStart + 1;
  let lineText = text.slice(lineStart).split("\n")[0].replace(/\r$/, "");
  const MAX = 90;
  let caret = column - 1;
  if (lineText.length > MAX) {
    const from = Math.max(0, caret - 40);
    lineText = (from > 0 ? "…" : "") + lineText.slice(from, from + MAX) + (from + MAX < text.length ? "…" : "");
    caret = caret - from + (from > 0 ? 1 : 0);
  }
  return { offset, line, column, snippet: lineText, caret };
}

function explainJsonError(message) {
  const m = String(message || "");
  if (/Unexpected end/i.test(m)) return "انتهى النص قبل اكتمال JSON — غالباً قوس } أو ] أو علامة اقتباس \" ناقصة، أو أن الرد قُطع قبل نهايته.";
  if (/double-quoted property name|Expected property name/i.test(m)) return "اسم الحقل يجب أن يكون بين علامتي اقتباس مزدوجتين، أو توجد فاصلة زائدة.";
  if (/Expected ',' or|Expected ':'|after (array element|property value)/i.test(m)) return "فاصلة ناقصة بين عنصرين، أو علامة اقتباس لم تُغلق قبل هذا الموضع.";
  const tok = m.match(/Unexpected token (.+?),? /) || m.match(/Unexpected token (.)/);
  if (/Unexpected token|Unexpected character|Bad (control|escaped)/i.test(m)) return `رمز غير متوقع${tok ? ` «${tok[1].replace(/^"|"$/g, "")}»` : ""} في هذا الموضع.`;
  return m;
}

/** Parses JSON leniently; throws NotebookInputError (with line/column) when it cannot. */
export function parseJsonLenient(input) {
  let text = String(input ?? "").replace(/^\uFEFF/, "");
  const notes = [];
  const lead = text.trim();
  // Only unwrap a fence that WRAPS the whole answer; a ```matlab fence inside a cell's string must stay.
  const fence = lead.startsWith("```") ? lead.match(/^```[A-Za-z]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```\s*$/) : null;
  if (fence) { text = fence[1]; notes.push("تم تجاهل سياج ``` المحيط بالـ JSON."); }
  else if (lead && lead[0] !== "{" && lead[0] !== "[") {
    const s = lead.indexOf("{"), e = lead.lastIndexOf("}");
    if (s !== -1 && e > s) { text = lead.slice(s, e + 1); notes.push("تم تجاهل نص خارج JSON (قبل { أو بعد })."); }
  }
  try { return { value: JSON.parse(text), notes }; } catch (first) {
    const rep = repairJsonText(text);
    if (rep.changed) {
      try { return { value: JSON.parse(rep.text), notes: [...notes, ...rep.notes] }; } catch (second) {
        return failParse(second, rep.text, (i) => rep.map[Math.min(i, rep.map.length - 1)] ?? 0, text);
      }
    }
    return failParse(first, text, (i) => i, text);
  }
}

function failParse(err, parsedText, toOriginal, originalText) {
  const msg = String(err?.message || err);
  let offset = null;
  const pos = msg.match(/position (\d+)/);
  if (pos) offset = Number(pos[1]);
  else {
    const lc = msg.match(/line (\d+) column (\d+)/);
    if (lc) {
      const lines = parsedText.split("\n");
      offset = lines.slice(0, Number(lc[1]) - 1).reduce((n, l) => n + l.length + 1, 0) + Number(lc[2]) - 1;
    }
  }
  if (/Unexpected end/i.test(msg)) offset = Math.max(0, parsedText.length - 1);
  const loc = offset == null ? null : locate(originalText, Math.min(toOriginal(offset), Math.max(0, originalText.length - 1)));
  const atEnd = offset != null && offset >= parsedText.trimEnd().length;
  const details = [atEnd ? explainJsonError("Unexpected end of JSON input") : explainJsonError(msg)];
  if (loc) details.push(`الموضع: السطر ${loc.line}، العمود ${loc.column}.`);
  details.push("نصيحة: اطلب من الذكاء الاصطناعي إعادة JSON صالحاً فقط داخل كتلة كود واحدة، أو افتح الملف في محرر JSON للتحقق منه.");
  throw new NotebookInputError("JSON غير صالح", details, loc);
}


/** Structural checks on parsed notebook JSON, with messages that say exactly what is wrong. */
function assertNotebookShape(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new NotebookInputError("بنية الدفتر غير صحيحة", ["الجذر يجب أن يكون كائناً { … } يحتوي الحقول title و runtime و cells."]);
  }
  const hasCells = Array.isArray(data.cells) || Array.isArray(data?.content?.cells);
  if (!hasCells) {
    const found = Object.keys(data).slice(0, 8).join("، ") || "لا شيء";
    throw new NotebookInputError("الحقل cells مفقود", [
      "يجب أن يحتوي JSON على مصفوفة cells فيها خلايا { \"type\": \"markdown\" | \"code\", \"source\": \"…\" }.",
      `الحقول الموجودة: ${found}.`,
    ]);
  }
}

/** Pure: turns pasted text and/or an uploaded file into a validated notebook record. */
export function parseNotebookInput({ text = "", fileName = "" } = {}) {
  const raw = String(text || "").trim();
  let title = "";
  let description = "";
  let source = "";
  let runtime = "matlab";
  let content;
  let warnings = [];
  let notes = [];
  let explicitLang = "";

  if (fileName) {
    if (!raw) throw new NotebookInputError("الملف فارغ", [`${fileName} لا يحتوي أي نص.`]);
    if (/\.ipynb$/i.test(fileName)) {
      const { value, notes: n } = parseJsonLenient(raw); // gives line/column on a broken .ipynb
      notes = n;
      try {
        const r = notebookFromFile(fileName, JSON.stringify(value));
        ({ title, runtime, content, warnings } = r);
      } catch (e) {
        throw new NotebookInputError(`تعذّر قراءة ${fileName}`, [e.message]);
      }
    } else {
      try {
        const r = notebookFromFile(fileName, raw);
        ({ title, runtime, content, warnings } = r);
      } catch (e) {
        throw new NotebookInputError(`تعذّر قراءة ${fileName}`, [e.message]);
      }
    }
  } else {
    if (!raw) throw new NotebookInputError("لا يوجد محتوى", ["الصق JSON الدفتر في الحقل، أو اضغط «رفع ملف» لاختيار ملف .ipynb أو .m."]);
    const { value: data, notes: n } = parseJsonLenient(raw);
    notes = n;
    if (data && Array.isArray(data.cells) && (data.nbformat != null || data.cells.some((c) => c && c.cell_type))) {
      try {
        const r = notebookFromIpynb(JSON.stringify(data));
        content = r.content; runtime = r.runtime;
        warnings = r.warnings || [];
      } catch (e) {
        throw new NotebookInputError("تعذّر تحويل ملف Jupyter", [e.message]);
      }
      title = String(data.metadata?.title || data.title || "");
    } else {
      assertNotebookShape(data);
      title = String(data?.title || "");
      description = String(data?.description || "");
      source = typeof data?.source === "string" ? data.source : "";
      runtime = typeof data?.runtime === "string" ? data.runtime : "";
      const cells = Array.isArray(data?.cells) ? data.cells : data.content.cells;
      content = normalizeNotebookContent(cells, data?.language ?? data?.content?.language, runtime);
      explicitLang = data?.language ?? data?.content?.language;
    }
  }
  const language = normalizeNotebookLang(explicitLang) || detectNotebookLang({ title, description, cells: content?.cells || [] });
  if (content) content = { ...content, language };
  return { title, description, source, runtime, language, content, warnings: [...notes, ...warnings] };
}

export function validateNotebookRecord(rec) {
  const check = checkNotebook(rec);
  return { errors: check.errors.map((e) => e.message), warnings: check.warnings.map((w) => w.message) };
}

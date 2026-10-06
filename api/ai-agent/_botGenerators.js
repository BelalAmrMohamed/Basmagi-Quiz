// =============================================================================
// api/ai-agent/_botGenerators.js
// In-memory file builders for the Telegram bot.
//
// REUSES the platform's canonical export features from public/src/features/export-quiz/:
//   - export-to-quiz.js     → buildStandaloneQuizHtml (fully-featured standalone interactive .html)
//   - export-to-html.js     → buildQuizHtml (shared Markdown/KaTeX-aware content rendering)
//   - export-to-markdown.js → buildQuizMarkdown (clean GitHub-flavored markdown)
//   - pdfkit                → paginate rendered content into the Telegram .pdf
//   - json schema           → generateQuizJson (platform-importable .json)
// =============================================================================

// Polyfill minimal browser globals for public/src modules when running in Node.js
if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    addEventListener() {},
    removeEventListener() {},
    body: null,
    createElement() {
      return {
        style: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        setAttribute() {},
        getAttribute() { return null; },
        appendChild() {},
      };
    },
    createDocumentFragment() {
      return { appendChild() {} };
    },
  };
}
if (typeof globalThis.navigator === "undefined") {
  globalThis.navigator = { clipboard: {} };
}

import { buildStandaloneQuizHtml as buildPlatformQuizHtml } from "../../public/src/features/export-quiz/export-to-quiz.js";
import { buildQuizHtml as buildPlatformQuizDocument } from "../../public/src/features/export-quiz/export-to-html.js";
import { buildQuizMarkdown as buildPlatformQuizMarkdown } from "../../public/src/features/export-quiz/export-to-markdown.js";

// ── 3.1: Standalone Interactive Quiz HTML ────────────────────────────────────

/**
 * Generates the full-featured standalone interactive HTML quiz file using
 * the canonical platform builder from public/src/features/export-quiz/export-to-quiz.js.
 * Includes dark/light mode, mobile responsive layout, KaTeX math, code syntax
 * highlighting, timer, pagination, and instant scoring.
 *
 * @param {string} title
 * @param {Array<object>} questions
 * @param {object} [config]
 * @returns {Promise<Buffer>}
 */
export async function generateStandaloneQuizHtml(title, questions, config = {}) {
  const fullConfig = {
    title: title || "امتحان منصة بصمجي",
    description: config.description || "امتحان تفاعلي مستقل تم تصديره من منصة امتحانات بصمجي",
    id: config.id || undefined,
    authorHandle: config.authorHandle || undefined,
  };

  const html = await buildPlatformQuizHtml(fullConfig, questions, {
    layout: "pagination",
    showAnswersButton: true,
  });

  return Buffer.from(html, "utf-8");
}

// ── 3.2: Platform-compatible Quiz JSON ───────────────────────────────────────

/**
 * @param {string} title
 * @param {Array} questions
 * @param {string} [description]
 * @returns {Buffer}
 */
export function generateQuizJson(title, questions, description = "") {
  const payload = {
    meta: {
      title,
      description,
      createdAt: new Date().toISOString(),
      source: "Basmagi Quiz Telegram Bot",
    },
    questions,
  };
  return Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
}

// ── 3.3: Quiz Markdown ───────────────────────────────────────────────────────

/**
 * Generates clean quiz Markdown using the canonical platform builder from
 * public/src/features/export-quiz/export-to-markdown.js.
 *
 * @param {string} title
 * @param {Array} questions
 * @param {object} [config]
 * @returns {Buffer}
 */
export function generateQuizMarkdown(title, questions, config = {}) {
  const fullConfig = {
    title: title || "امتحان منصة بصمجي",
    ...(config || {}),
  };

  const md = buildPlatformQuizMarkdown(fullConfig, questions, [], {
    includeAnswers: true,
    includeStats: true,
  });

  return Buffer.from(md, "utf-8");
}

// ── 3.4: Lesson Markdown & JSON ─────────────────────────────────────────────

/**
 * @param {string} title
 * @param {Array<{title: string, content: string, questions?: Array}>} sections
 * @returns {Buffer}
 */
export function generateLessonMarkdown(title, sections) {
  let md = `# ${title}\n\n`;

  sections.forEach((sec) => {
    md += `## ${sec.title}\n\n`;
    let questionIndex = 0;
    lessonSectionBlocks(sec).forEach((block) => {
      if (block.type === "markdown") {
        md += `${block.body}\n\n`;
      } else {
        md += `### ${++questionIndex}. ${block.q || ""}\n\n`;
        const q = block;
        if (Array.isArray(q.options)) {
          q.options.forEach((opt, oi) => {
            md += `   ${String.fromCharCode(65 + oi)}. ${opt}\n`;
          });
        }
        const correct = Array.isArray(q.correct)
          ? q.correct
          : Number.isInteger(q.correctIndex)
            ? [q.correctIndex]
            : Array.isArray(q.correctIndexes)
              ? q.correctIndexes
              : [];
        if (correct.length && Array.isArray(q.options)) {
          md += `   **Correct answer:** ${correct.map((index) => q.options[index]).filter(Boolean).join(", ")}\n`;
        }
        if (q.answer || q.modelAnswer) {
          md += `   **الإجابة:** ${q.answer || q.modelAnswer}\n`;
        }
        if (q.explanation) md += `   **Explanation:** ${q.explanation}\n`;
        md += "\n";
      }
    });

    md += `---\n\n`;
  });

  return Buffer.from(md, "utf-8");
}

/**
 * @param {string} title
 * @param {Array<{title: string, content: string, questions?: Array}>} sections
 * @returns {Buffer}
 */
export function generateLessonJson(title, sections) {
  return Buffer.from(JSON.stringify({ title, sections }, null, 2), "utf-8");
}

/**
 * Creates a standalone interactive lesson for Telegram, including answer
 * reveal for embedded multiple-choice and essay questions.
 * @param {string} title
 * @param {Array<{title: string, content: string, questions?: Array}>} sections
 * @returns {Buffer}
 */
export function generateLessonHtml(title, sections) {
  const safeTitle = escapeHtml(title || "درس بدون عنوان");
  const sectionHtml = (Array.isArray(sections) ? sections : []).map((section, sectionIndex) => {
    let questionIndex = 0;
    const blocksHtml = lessonSectionBlocks(section).map((block) => {
      if (block.type === "markdown") {
        return `<div class="content">${escapeHtml(block.body).replace(/\r?\n/g, "<br>")}</div>`;
      }
      const question = block;
      questionIndex += 1;
      const options = Array.isArray(question.options) ? question.options : [];
      let correct = Array.isArray(question.correct)
        ? question.correct.map(Number)
        : Array.isArray(question.correctIndexes)
          ? question.correctIndexes.map(Number)
          : Number.isInteger(question.correctIndex)
            ? [question.correctIndex]
            : Number.isInteger(Number(question.correct))
              ? [Number(question.correct)]
              : [];
      if (!correct.length && question.answer && options.length) {
        const answer = String(question.answer).trim().toLocaleLowerCase();
        correct = options.flatMap((option, optionIndex) =>
          String(option).trim().toLocaleLowerCase() === answer ? [optionIndex] : [],
        );
      }
      const questionTitle = escapeHtml(question.q || `سؤال ${questionIndex}`);
      const optionsHtml = options.map((option, optionIndex) =>
        `<button type="button" class="option" data-index="${optionIndex}">${escapeHtml(option)}</button>`,
      ).join("");
      const modelAnswer = escapeHtml(question.modelAnswer || question.answer || "");
      const essay = question.questionKind === "essay" || options.length === 0;
      const explanation = question.explanation ? `<p class="explanation" hidden>${escapeHtml(question.explanation)}</p>` : "";
      return `<article class="question" data-correct="${escapeHtml(JSON.stringify(correct))}" data-multi="${question.multiSelect === true}" data-model="${modelAnswer}" data-essay="${essay}"><h3>${questionTitle}</h3>${essay
        ? `<textarea rows="4" placeholder="اكتب إجابتك هنا"></textarea><button type="button" class="check">تحقق من إجابتي</button>`
        : `<div class="options">${optionsHtml}</div>${question.multiSelect ? '<button type="button" class="check">تحقق من الإجابات</button>' : ""}`
      }<p class="feedback" hidden></p>${explanation}</article>`;
    }).join("");
    return `<section><h2>${escapeHtml(section.title || `قسم ${sectionIndex + 1}`)}</h2>${blocksHtml}</section>`;
  }).join("");
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>
    *{box-sizing:border-box}body{max-width:850px;margin:0 auto;padding:24px;font:16px/1.8 Tahoma,Arial,sans-serif;color:#18181b}h1{color:#1d4ed8}section{margin:2rem 0}section>h2{border-bottom:1px solid #ddd;padding-bottom:.5rem}.question{margin:1rem 0;padding:1rem;border:1px solid #ddd;border-radius:12px}.options{display:grid;gap:.5rem}.option,textarea{font:inherit;padding:.65rem;border:1px solid #ccc;border-radius:8px;background:white;text-align:start}.option{cursor:pointer}.option.selected{border-color:#2563eb;background:#eff6ff}.option.correct{border-color:#16a34a;background:#dcfce7}.option.wrong{border-color:#dc2626;background:#fee2e2}.check{margin-top:.7rem;padding:.55rem 1rem;border:0;border-radius:8px;background:#2563eb;color:white;font:inherit;cursor:pointer}.feedback{font-weight:bold}.explanation{color:#52525b}textarea{display:block;width:100%;margin-top:.7rem}.content{white-space:normal}@media(max-width:600px){body{padding:14px}}
  </style></head><body><main><h1>${safeTitle}</h1>${sectionHtml}</main><script>
  document.querySelectorAll(".question").forEach(q=>{const correct=JSON.parse(q.dataset.correct||"[]"),multi=q.dataset.multi==="true",feedback=q.querySelector(".feedback");
    const reveal=chosen=>{q.querySelectorAll(".option").forEach((b,i)=>{b.disabled=true;if(correct.includes(i))b.classList.add("correct");if(chosen.includes(i)&&!correct.includes(i))b.classList.add("wrong")});
      feedback.hidden=false;feedback.textContent=correct.length&&correct.length===chosen.length&&correct.every(i=>chosen.includes(i))?"إجابة صحيحة":"الإجابة النموذجية: "+(q.dataset.model||"راجع الشرح");const explanation=q.querySelector(".explanation");if(explanation)explanation.hidden=false;};
    q.querySelectorAll(".option").forEach(b=>b.addEventListener("click",()=>{if(q.dataset.multi==="true"){b.classList.toggle("selected");return}reveal([Number(b.dataset.index)])}));
    q.querySelector(".check")?.addEventListener("click",()=>{if(q.dataset.essay==="true"){const answer=q.querySelector("textarea").value.trim();if(!answer)return;q.querySelector("textarea").disabled=true;feedback.hidden=false;feedback.textContent="الإجابة النموذجية: "+(q.dataset.model||"راجع الشرح");const explanation=q.querySelector(".explanation");if(explanation)explanation.hidden=false;return}
      const chosen=[...q.querySelectorAll(".option.selected")].map(b=>Number(b.dataset.index));if(chosen.length)reveal(chosen)});
  });
  </script></body></html>`;
  return Buffer.from(html, "utf-8");
}

/**
 * Generates a printable PDF version of a lesson.
 * @param {string} title
 * @param {Array<{title: string, content: string, questions?: Array}>} sections
 * @returns {Promise<Buffer>}
 */
export async function generateLessonPdf(title, sections) {
  const PDFDocument = (await import("pdfkit")).default;
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: { Title: title || "Lesson", Author: "Basmagi Quiz Platform", Creator: "El-Bashmebasamag Bot" },
    });
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(20).font("Helvetica-Bold").text(title || "Lesson", { align: "center" });
    doc.moveDown();
    (Array.isArray(sections) ? sections : []).forEach((section, index) => {
      doc.fontSize(15).font("Helvetica-Bold").text(section.title || `Section ${index + 1}`);
      doc.moveDown(0.3);
      let questionIndex = 0;
      for (const block of lessonSectionBlocks(section)) {
        if (block.type === "markdown") {
          if (block.body) doc.fontSize(11).font("Helvetica").text(block.body);
          continue;
        }
        const question = block;
        questionIndex += 1;
        doc.moveDown(0.5);
        doc.fontSize(12).font("Helvetica-Bold").text(`${questionIndex}. ${question.q || question.prompt || ""}`);
        const options = Array.isArray(question.options) ? question.options : [];
        let correctIndexes = Array.isArray(question.correct)
          ? question.correct.map(Number)
          : Array.isArray(question.correctIndexes)
            ? question.correctIndexes.map(Number)
            : Number.isInteger(question.correctIndex)
              ? [question.correctIndex]
              : [];
        if (!correctIndexes.length && question.answer) {
          const answer = String(question.answer).trim().toLocaleLowerCase();
          correctIndexes = options.flatMap((option, optionIndex) =>
            String(option).trim().toLocaleLowerCase() === answer ? [optionIndex] : [],
          );
        }
        options.forEach((option, optionIndex) => {
          const correctMark = correctIndexes.includes(optionIndex) ? " [correct]" : "";
          doc.fontSize(10).font("Helvetica").text(`${String.fromCharCode(65 + optionIndex)}. ${option}${correctMark}`);
        });
        if (question.answer || question.modelAnswer) {
          doc.moveDown(0.2).fontSize(10).font("Helvetica-Oblique").text(`Answer: ${question.answer || question.modelAnswer}`);
        }
        if (question.explanation) {
          doc.moveDown(0.2).fontSize(9).font("Helvetica-Oblique").text(`Explanation: ${question.explanation}`);
        }
      }
      doc.moveDown();
    });
    doc.end();
  });
}

function lessonSectionBlocks(section) {
  const blocks = [];
  if (section?.content) blocks.push({ type: "markdown", body: String(section.content) });
  if (Array.isArray(section?.blocks)) blocks.push(...section.blocks);
  if (Array.isArray(section?.questions)) {
    blocks.push(...section.questions.map((question) => ({ type: "question", ...question })));
  }
  return blocks.map((block) => block?.type === "question"
    ? {
        ...block,
        q: block.prompt || block.q || "",
        correct: block.correctIndexes || (Number.isInteger(block.correctIndex) ? [block.correctIndex] : block.correct),
        answer: block.modelAnswer || block.answer || "",
      }
    : { type: "markdown", body: String(block?.body || "") });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

// ── 3.5: Quiz PDF ────────────────────────────────────────────────────────────

const PDF_DEFAULT_OPTIONS = {
  backgroundColor: "light",
  includeAnswers: false,
  includeExplanations: false,
  answerPlacement: "inline",
};

function decodeHtmlEntities(text) {
  const decodeCodePoint = (value) => {
    const codePoint = Number(value);
    return Number.isInteger(codePoint) &&
      codePoint > 0 &&
      codePoint <= 0x10ffff &&
      (codePoint < 0xd800 || codePoint > 0xdfff)
      ? String.fromCodePoint(codePoint)
      : "\uFFFD";
  };

  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(code))
    .replace(/&#x([\da-f]+);/gi, (_, code) =>
      decodeCodePoint(parseInt(code, 16)),
    );
}

function pdfBlocksFromHtml(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const source = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const tokens = source.match(/<[^>]+>|[^<]+/g) || [];
  const blocks = [];
  let runs = [];
  let style = { fontSize: 10, bold: false, italic: false, code: false, color: null };
  const styleStack = [];
  let alignment = "left";
  let listDepth = 0;

  const flush = () => {
    while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
    if (runs.length) blocks.push({ runs, alignment, listDepth });
    runs = [];
    alignment = "left";
  };
  const append = (text) => {
    const normalized = decodeHtmlEntities(text).replace(/\s+/g, " ");
    if (!normalized.trim()) {
      if (runs.length && !runs[runs.length - 1].text.endsWith(" ")) {
        runs.push({ ...style, text: " " });
      }
      return;
    }
    runs.push({ ...style, text: normalized });
  };
  const isBlock = /^(address|article|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|h[1-6]|hr|li|ol|p|pre|section|table|tr|ul)$/;
  const isVoid = /^(area|base|col|embed|img|input|link|meta|param|source|track|wbr)$/;

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      append(token);
      continue;
    }

    const match = token.match(/^<\s*(\/)?\s*([a-z0-9-]+)([^>]*)>/i);
    if (!match) continue;
    const [, closing, rawTag, attributes] = match;
    const tag = rawTag.toLowerCase();
    const classes = attributes.match(/\bclass=["']([^"']*)["']/i)?.[1] || "";
    const classNames = classes.split(/\s+/);

    if (closing) {
      if (tag === "ul" || tag === "ol") listDepth = Math.max(0, listDepth - 1);
      if (styleStack.length) style = styleStack.pop();
      if (tag === "td" || tag === "th") append("  |  ");
      if (isBlock.test(tag)) flush();
      continue;
    }

    if (tag === "br" || tag === "hr") {
      flush();
      continue;
    }
    if (tag === "img") {
      const alt = attributes.match(/\balt=["']([^"']*)["']/i)?.[1];
      if (alt) append(`[${alt}]`);
      continue;
    }
    if (isVoid.test(tag)) continue;
    if (isBlock.test(tag)) flush();
    styleStack.push(style);
    style = { ...style };

    if (tag === "h1") {
      style.fontSize = 18;
      style.bold = true;
      style.color = "#2563eb";
      alignment = "center";
    } else if (tag === "h2") {
      style.fontSize = 15;
      style.bold = true;
      style.color = "#2563eb";
    } else if (tag === "h3" || tag === "h4") {
      style.fontSize = 12;
      style.bold = true;
    } else if (tag === "strong" || tag === "b") {
      style.bold = true;
    } else if (tag === "em" || tag === "i") {
      style.italic = true;
    } else if (tag === "code" || tag === "pre") {
      style.code = true;
    } else if (tag === "a") {
      style.color = "#2563eb";
    }

    if (classNames.includes("q-header") || classNames.includes("meta")) {
      style.fontSize = 9;
      style.color = "#6b7280";
    } else if (classNames.includes("correct-answer")) {
      style.color = "#15803d";
      style.bold = true;
    } else if (classNames.includes("explanation")) {
      style.color = "#7c3aed";
    } else if (classNames.includes("option-letter")) {
      style.color = "#2563eb";
      style.bold = true;
    } else if (classNames.includes("md-blockquote")) {
      style.color = "#52525b";
      style.italic = true;
    }

    if (tag === "li") {
      listDepth = Math.max(1, listDepth);
      append("• ");
    } else if (tag === "ul" || tag === "ol") {
      listDepth += 1;
    } else if (tag === "th") {
      style.bold = true;
    }

    if (/\/\s*>$/.test(token)) {
      style = styleStack.pop() || style;
    }
  }

  flush();
  return blocks;
}

function writePdfBlocks(doc, blocks, dark) {
  const baseColor = dark ? "#f3f4f6" : "#1a1a1a";
  for (const block of blocks) {
    const indent = Math.max(0, block.listDepth - 1) * 14;
    block.runs.forEach((run, index) => {
      const font = run.code
        ? "Courier"
        : run.bold && run.italic
          ? "Helvetica-BoldOblique"
          : run.bold
            ? "Helvetica-Bold"
            : run.italic
              ? "Helvetica-Oblique"
              : "Helvetica";
      doc
        .font(font)
        .fontSize(run.fontSize || 10)
        .fillColor(run.color || baseColor)
        .text(run.text, {
          continued: index < block.runs.length - 1,
          indent: index === 0 ? indent : 0,
          align: block.alignment,
        });
    });
    doc.moveDown(block.runs.some((run) => run.fontSize >= 15) ? 0.55 : 0.3);
  }
}

/**
 * Builds the same Markdown/KaTeX/RTL-aware quiz document as the platform PDF
 * export, then paginates its rendered content in PDFKit for Telegram delivery.
 * The platform's browser print CSS is not available in a serverless bot, so
 * PDFKit carries over its content options, light/dark backgrounds, and core
 * Markdown styling in a downloadable file.
 *
 * @param {string} title
 * @param {Array} questions
 * @param {{backgroundColor?: "light"|"dark", includeAnswers?: boolean,
 *   includeExplanations?: boolean, answerPlacement?: "inline"|"final-page"}} options
 * @returns {Promise<Buffer>}
 */
export async function generateQuizPdf(title, questions, options = {}) {
  const pdfOptions = { ...PDF_DEFAULT_OPTIONS, ...options };
  const previousDocument = globalThis.document;
  let htmlPromise;
  try {
    delete globalThis.document;
    htmlPromise = buildPlatformQuizDocument(
      { title: title || "امتحان منصة بصمجي" },
      questions,
      [],
      {
        includeAnswers: Boolean(pdfOptions.includeAnswers),
        includeUserAnswers: false,
        includeExplanations: Boolean(pdfOptions.includeExplanations),
        answerPlacement:
          pdfOptions.answerPlacement === "final-page" ? "final-page" : "inline",
      },
    );
  } finally {
    if (previousDocument !== undefined) globalThis.document = previousDocument;
  }

  const html = await htmlPromise;
  const dark = pdfOptions.backgroundColor === "dark";
  const blocks = pdfBlocksFromHtml(html);
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: title || "Quiz",
        Author: "Basmagi Quiz Platform",
        Creator: "El-Bashmebasamag Bot",
      },
    });

    const paintBackground = () => {
      if (!dark) return;
      doc.save();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill("#121212");
      doc.restore();
    };
    doc.on("pageAdded", paintBackground);
    paintBackground();
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    writePdfBlocks(doc, blocks, dark);
    doc.end();
  });
}

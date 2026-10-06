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
    addEventListener() { },
    removeEventListener() { },
    body: null,
    createElement() {
      return {
        style: {},
        classList: { add() { }, remove() { }, contains() { return false; } },
        setAttribute() { },
        getAttribute() { return null; },
        appendChild() { },
      };
    },
    createDocumentFragment() {
      return { appendChild() { } };
    },
  };
}
if (typeof globalThis.navigator === "undefined") {
  globalThis.navigator = { clipboard: {} };
}

import { buildStandaloneQuizHtml as buildPlatformQuizHtml } from "../../public/src/features/export-quiz/export-to-quiz.js";
import { buildQuizHtml as buildPlatformQuizDocument } from "../../public/src/features/export-quiz/export-to-html.js";
import { buildQuizMarkdown as buildPlatformQuizMarkdown } from "../../public/src/features/export-quiz/export-to-markdown.js";
import { gradeEssay } from "../../public/src/shared/rate-answers.js";

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
  const sectionList = Array.isArray(sections) ? sections : [];
  const questionCount = sectionList.flatMap(lessonSectionBlocks).filter((block) => block.type === "question").length;
  let questionNumber = 0;
  sectionList.forEach((sec) => {
    md += `## ${sec.title}\n\n`;
    lessonSectionBlocks(sec).forEach((block) => {
      if (block.type === "markdown") {
        md += `${block.body}\n\n`;
      } else {
        questionNumber += 1;
        const q = block;
        const essay = q.questionKind === "essay" || !Array.isArray(q.options) || q.options.length === 0;
        const typeLabel = essay ? "سؤال مقالي" : q.multiSelect ? "اختيار متعدد" : "اختيار من متعدد";
        md += `### ${questionNumber}/${questionCount} · ${typeLabel}: ${q.q || ""}\n\n`;
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
        if (essay) md += "   **التقييم الذاتي التقريبي:** من 0 إلى 5 (ليس درجة نهائية)\n";
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
  const allLessonBlocks = (Array.isArray(sections) ? sections : []).flatMap(lessonSectionBlocks);
  const questionCount = allLessonBlocks.filter((block) => block.type === "question").length;
  let questionNumber = 0;
  const sectionHtml = (Array.isArray(sections) ? sections : []).map((section, sectionIndex) => {
    const blocksHtml = lessonSectionBlocks(section).map((block) => {
      if (block.type === "markdown") {
        return `<div class="content">${escapeHtml(block.body).replace(/\r?\n/g, "<br>")}</div>`;
      }
      const question = block;
      questionNumber += 1;
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
      const questionTitle = escapeHtml(question.q || `سؤال ${questionNumber}`);
      const optionsHtml = options.map((option, optionIndex) =>
        `<button type="button" class="lesson-question__option" data-option-index="${optionIndex}" aria-pressed="false"><span class="lesson-question__option-marker" aria-hidden="true">${String.fromCharCode(65 + optionIndex)}</span><span>${escapeHtml(option)}</span></button>`,
      ).join("");
      const modelAnswer = escapeHtml(question.modelAnswer || question.answer || "");
      const essay = question.questionKind === "essay" || options.length === 0;
      const typeLabel = essay ? "سؤال مقالي" : question.multiSelect ? "اختيار متعدد" : "اختيار من متعدد";
      const correctAnswers = correct.map((index) => options[index]).filter(Boolean);
      const explanation = question.explanation ? `<div class="lesson-question__explanation">${escapeHtml(question.explanation)}</div>` : "";
      return `<article class="lesson-question" data-question-kind="${essay ? "essay" : "mcq"}" data-correct-indexes="${escapeHtml(JSON.stringify(correct))}" data-multi-select="${question.multiSelect === true}" data-model-answer="${modelAnswer}"><div class="lesson-question__header"><span class="lesson-question__number">سؤال ${questionNumber} من ${questionCount}</span><span class="lesson-question__type">${typeLabel}</span></div><h3 class="lesson-question__prompt">${questionTitle}</h3>${essay
        ? `<label class="lesson-question__essay-wrap"><span>إجابتك</span><textarea dir="auto" class="lesson-question__essay-input" rows="4" placeholder="اكتب إجابتك هنا"></textarea></label><button type="button" class="lesson-question__check-btn">تحقق من الإجابة</button>`
        : `<div class="lesson-question__options">${optionsHtml}</div><button type="button" class="lesson-question__check-btn" data-question-check disabled>${question.multiSelect ? "تحقق من الإجابات" : "تحقق من الإجابة"}</button>`
        }<div class="lesson-question__feedback" role="status" aria-live="polite" hidden><strong class="lesson-question__verdict"></strong>${essay
          ? `<div class="lesson-question__essay-rating" aria-label="التقييم التقريبي من خمسة"></div><div class="lesson-question__model-answer"><strong>الإجابة النموذجية:</strong> ${modelAnswer}</div>`
          : `<div class="lesson-question__correct-answer"><strong>الإجابة الصحيحة:</strong> ${correctAnswers.map(escapeHtml).join("، ")}</div>`
        }${explanation}</div></article>`;
    }).join("");
    return `<section><h2>${escapeHtml(section.title || `قسم ${sectionIndex + 1}`)}</h2>${blocksHtml}</section>`;
  }).join("");
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>
    *{box-sizing:border-box}body{max-width:900px;margin:0 auto;padding:clamp(16px,4vw,36px);font:16px/1.8 Tahoma,Arial,sans-serif;color:#18181b;background:#f7f8fc}main{padding:clamp(16px,3vw,30px);border:1px solid #e1e5ee;border-radius:20px;background:white;box-shadow:0 14px 40px #182b4b0b}h1{margin:0 0 1.5rem;color:#1d4ed8}section{margin:2rem 0}section>h2{border-bottom:1px solid #ddd;padding-bottom:.5rem}.content{white-space:pre-wrap}.lesson-question{margin:1.3rem 0;padding:clamp(16px,3vw,24px);border:1px solid #e1e5ee;border-radius:16px;background:#fff;box-shadow:0 8px 24px #182b4b0a}.lesson-question__header{display:flex;justify-content:space-between;gap:12px;margin-bottom:14px}.lesson-question__number,.lesson-question__type{padding:3px 10px;border:1px solid #d8deea;border-radius:999px;font-size:.78rem;font-weight:700}.lesson-question__number{color:#2563eb;background:#eff6ff}.lesson-question__type{color:#64748b}.lesson-question__prompt{margin:0 0 14px;font-size:1.05rem}.lesson-question__options{display:grid;gap:9px}.lesson-question__option{display:flex;align-items:flex-start;gap:12px;width:100%;padding:12px;border:1px solid #d8deea;border-radius:11px;background:#fff;font:inherit;text-align:start;cursor:pointer}.lesson-question__option:hover:not(:disabled),.lesson-question__option.is-selected{border-color:#2563eb;background:#eff6ff}.lesson-question__option-marker{display:grid;flex:0 0 25px;height:25px;place-items:center;border:1px solid #cbd5e1;border-radius:50%;font-size:.75rem;font-weight:700}.lesson-question__option.is-selected .lesson-question__option-marker{border-color:#2563eb;background:#2563eb;color:white}.lesson-question__option.is-correct{border-color:#16a34a;background:#f0fdf4}.lesson-question__option.is-wrong{border-color:#dc2626;background:#fef2f2}.lesson-question__option:disabled{cursor:default}.lesson-question__check-btn{min-height:42px;margin-top:14px;padding:8px 16px;border:0;border-radius:9px;background:#2563eb;color:white;font:inherit;font-weight:700;cursor:pointer}.lesson-question__check-btn:disabled{opacity:.5;cursor:not-allowed}.lesson-question__essay-wrap{display:grid;gap:6px;color:#64748b;font-size:.85rem;font-weight:700}.lesson-question__essay-input{width:100%;padding:12px;border:1px solid #d8deea;border-radius:10px;font:inherit;resize:vertical}.lesson-question__feedback{display:grid;gap:8px;margin-top:16px;padding:14px;border:1px solid #e1e5ee;border-radius:11px;background:#f8fafc}.lesson-question__feedback[hidden]{display:none}.lesson-question__verdict{font-weight:800}.lesson-question__verdict.is-correct{color:#15803d}.lesson-question__verdict.is-wrong{color:#b91c1c}.lesson-question__correct-answer,.lesson-question__explanation,.lesson-question__model-answer{color:#475569;line-height:1.7}.lesson-question__essay-rating{color:#b7791f;font-weight:800;letter-spacing:.04em}.lesson-question__model-answer{padding-top:8px;border-top:1px solid #d8deea}@media(max-width:600px){body{padding:12px}main{padding:16px}.lesson-question__header{align-items:flex-start;flex-direction:column}.lesson-question__check-btn{width:100%}}
  </style></head><body><main><h1>${safeTitle}</h1>${sectionHtml}</main><script>
  const gradeEssay=(${gradeEssay.toString()});
  document.querySelectorAll(".lesson-question[data-question-kind='mcq']").forEach(q=>{const correct=JSON.parse(q.dataset.correctIndexes||"[]"),multi=q.dataset.multiSelect==="true",feedback=q.querySelector(".lesson-question__feedback"),check=q.querySelector("[data-question-check]");
    const reveal=chosen=>{q.dataset.answered="true";q.querySelectorAll(".lesson-question__option").forEach(b=>{const i=Number(b.dataset.optionIndex);b.disabled=true;b.classList.toggle("is-selected",chosen.includes(i));b.setAttribute("aria-pressed",String(chosen.includes(i)));if(correct.includes(i))b.classList.add("is-correct");if(chosen.includes(i)&&!correct.includes(i))b.classList.add("is-wrong")});
      const right=correct.length===chosen.length&&correct.every(i=>chosen.includes(i)),verdict=feedback.querySelector(".lesson-question__verdict");feedback.hidden=false;verdict.textContent=right?"إجابة صحيحة":"إجابة غير صحيحة — راجع الإجابة الصحيحة والشرح";verdict.classList.toggle("is-correct",right);verdict.classList.toggle("is-wrong",!right);check.disabled=true;};
    q.querySelectorAll(".lesson-question__option").forEach(b=>b.addEventListener("click",()=>{if(q.dataset.answered==="true")return;if(multi)b.classList.toggle("is-selected");else q.querySelectorAll(".lesson-question__option").forEach(option=>{const selected=option===b;option.classList.toggle("is-selected",selected);option.setAttribute("aria-pressed",String(selected))});b.setAttribute("aria-pressed",String(b.classList.contains("is-selected")));check.disabled=!q.querySelector(".lesson-question__option.is-selected")}));
    check.addEventListener("click",()=>{const chosen=[...q.querySelectorAll(".lesson-question__option.is-selected")].map(b=>Number(b.dataset.optionIndex));if(chosen.length)reveal(chosen)});
  });
  document.querySelectorAll(".lesson-question[data-question-kind='essay']").forEach(q=>{const input=q.querySelector(".lesson-question__essay-input"),button=q.querySelector(".lesson-question__check-btn");input.addEventListener("input",()=>button.disabled=!input.value.trim());button.disabled=true;button.addEventListener("click",()=>{const answer=input.value.trim();if(!answer)return;input.disabled=true;const score=gradeEssay(answer,q.dataset.modelAnswer||""),feedback=q.querySelector(".lesson-question__feedback"),verdict=feedback.querySelector(".lesson-question__verdict"),close=score>=3;feedback.hidden=false;verdict.textContent=close?"إجابتك قريبة من الإجابة النموذجية":"راجع الإجابة النموذجية";verdict.classList.toggle("is-correct",close);verdict.classList.toggle("is-wrong",!close);const rating=feedback.querySelector(".lesson-question__essay-rating");rating.textContent=score+" من 5 · "+"★".repeat(score)+"☆".repeat(5-score);rating.setAttribute("aria-label","التقييم التقريبي: "+score+" من 5");button.disabled=true})});
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
  const sectionList = Array.isArray(sections) ? sections : [];
  const questionCount = sectionList.flatMap(lessonSectionBlocks).filter((block) => block.type === "question").length;
  let questionNumber = 0;
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
    sectionList.forEach((section, index) => {
      doc.fontSize(15).font("Helvetica-Bold").text(section.title || `Section ${index + 1}`);
      doc.moveDown(0.3);
      for (const block of lessonSectionBlocks(section)) {
        if (block.type === "markdown") {
          if (block.body) doc.fontSize(11).font("Helvetica").text(block.body);
          continue;
        }
        const question = block;
        questionNumber += 1;
        doc.moveDown(0.5);
        const options = Array.isArray(question.options) ? question.options : [];
        const essay = question.questionKind === "essay" || options.length === 0;
        const typeLabel = essay ? "Essay" : question.multiSelect ? "Multiple choice (select all)" : "Multiple choice";
        doc.fontSize(12).font("Helvetica-Bold").text(`${questionNumber}/${questionCount} · ${typeLabel}: ${question.q || question.prompt || ""}`);
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
        if (essay) {
          doc.moveDown(0.2).fontSize(9).font("Helvetica-Oblique").text("Approximate self-check rating: 0-5 (not a final grade)");
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

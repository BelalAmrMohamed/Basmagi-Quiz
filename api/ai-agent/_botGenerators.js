// =============================================================================
// api/ai-agent/_botGenerators.js
// In-memory file builders for the Telegram bot.
//
// REUSES the platform's canonical export features from public/src/features/export-quiz/:
//   - export-to-quiz.js     → buildStandaloneQuizHtml (fully-featured standalone interactive .html)
//   - export-to-markdown.js → buildQuizMarkdown (clean GitHub-flavored markdown)
//   - pdfkit                → generateQuizPdf (paginated .pdf)
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
    md += `${sec.content}\n\n`;

    if (Array.isArray(sec.questions) && sec.questions.length) {
      md += `### أسئلة على هذا القسم\n\n`;
      sec.questions.forEach((q, qi) => {
        md += `${qi + 1}. ${q.q || q.prompt || ""}\n`;
        if (Array.isArray(q.options)) {
          q.options.forEach((opt, oi) => {
            md += `   ${String.fromCharCode(65 + oi)}. ${opt}\n`;
          });
        }
        if (q.answer || q.modelAnswer) {
          md += `   **الإجابة:** ${q.answer || q.modelAnswer}\n`;
        }
        md += "\n";
      });
    }

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
    const questions = (Array.isArray(section.questions) ? section.questions : []).map((question, questionIndex) => {
      const options = Array.isArray(question.options) ? question.options : [];
      let correct = Array.isArray(question.correct)
        ? question.correct.map(Number)
        : Number.isInteger(Number(question.correct))
          ? [Number(question.correct)]
          : [];
      if (!correct.length && question.answer && options.length) {
          const answer = String(question.answer).trim().toLocaleLowerCase();
        correct = options.flatMap((option, optionIndex) =>
          String(option).trim().toLocaleLowerCase() === answer ? [optionIndex] : [],
        );
      }
      const questionTitle = escapeHtml(question.q || question.prompt || `سؤال ${questionIndex + 1}`);
      const optionsHtml = options.map((option, optionIndex) =>
        `<button type="button" class="option" data-index="${optionIndex}">${escapeHtml(option)}</button>`,
      ).join("");
      const modelAnswer = escapeHtml(question.modelAnswer || question.answer || "");
      const essay = options.length === 0;
      return `<article class="question" data-correct="${escapeHtml(JSON.stringify(correct))}" data-multi="${question.multiSelect === true}" data-model="${modelAnswer}" data-essay="${essay}"><h3>${questionTitle}</h3>${essay
        ? `<textarea rows="4" placeholder="اكتب إجابتك هنا"></textarea><button type="button" class="check">تحقق من إجابتي</button>`
        : `<div class="options">${optionsHtml}</div>${question.multiSelect ? '<button type="button" class="check">تحقق من الإجابات</button>' : ""}`
      }<p class="feedback" hidden></p>${question.explanation ? `<p class="explanation" hidden>${escapeHtml(question.explanation)}</p>` : ""}</article>`;
    }).join("");
    return `<section><h2>${escapeHtml(section.title || `قسم ${sectionIndex + 1}`)}</h2><div class="content">${escapeHtml(section.content || "").replace(/\r?\n/g, "<br>")}</div>${questions}</section>`;
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
      if (section.content) doc.fontSize(11).font("Helvetica").text(section.content);
      for (const [questionIndex, question] of (Array.isArray(section.questions) ? section.questions : []).entries()) {
        doc.moveDown(0.5);
        doc.fontSize(12).font("Helvetica-Bold").text(`${questionIndex + 1}. ${question.q || question.prompt || ""}`);
        const options = Array.isArray(question.options) ? question.options : [];
        let correctIndexes = Array.isArray(question.correct) ? question.correct.map(Number) : [];
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
      }
      doc.moveDown();
    });
    doc.end();
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

// ── 3.5: Quiz PDF (pdfkit) ─────────────────────────────────────────────────

/**
 * Generates a paginated PDF with header, questions, options, and answers.
 *
 * @param {string} title
 * @param {Array} questions
 * @returns {Promise<Buffer>}
 */
export async function generateQuizPdf(title, questions) {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: title,
        Author: "Basmagi Quiz Platform",
        Creator: "El-Bashmebasamag Bot",
      },
    });

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Title header
    doc.fontSize(20).text(title, { align: "center" });
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .fillColor("#666")
      .text(`${questions.length} Questions — Basmagi Quiz Platform`, { align: "center" });
    doc.moveDown(1.2);
    doc.fillColor("#000");

    questions.forEach((q, i) => {
      if (doc.y > 680) doc.addPage();

      // Question number + text
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(`Q${i + 1}. `, { continued: true })
        .font("Helvetica")
        .text(q.q || "");
      doc.moveDown(0.3);

      // Options
      if (Array.isArray(q.options) && q.options.length) {
        const correctList = Array.isArray(q.correct)
          ? q.correct
          : q.correct != null
          ? [q.correct]
          : [];
        const correctSet = new Set(correctList);
        q.options.forEach((opt, oi) => {
          const letter = String.fromCharCode(65 + oi);
          const mark = correctSet.has(oi) ? " ✓" : "";
          doc.fontSize(10).text(`    ${letter}. ${opt}${mark}`);
        });
        doc.moveDown(0.3);
      }

      // Essay answer
      if (q.answer) {
        doc
          .fontSize(9.5)
          .fillColor("#2563eb")
          .text(`Answer: ${q.answer}`)
          .fillColor("#000");
        doc.moveDown(0.2);
      }

      // Explanation
      if (q.explanation) {
        doc
          .fontSize(9.5)
          .fillColor("#7c3aed")
          .text(`Explanation: ${q.explanation}`)
          .fillColor("#000");
        doc.moveDown(0.2);
      }

      doc.moveDown(0.5);
    });

    // Footer
    doc
      .fontSize(8)
      .fillColor("#999")
      .text("Generated by Basmagi Quiz Platform — https://basmagi-quiz.vercel.app", {
        align: "center",
      });

    doc.end();
  });
}

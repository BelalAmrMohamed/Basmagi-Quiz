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

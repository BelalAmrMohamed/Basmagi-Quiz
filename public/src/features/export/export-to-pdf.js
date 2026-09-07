// public/src/features/export/export-to-pdf.js
// "Exports" the quiz to PDF via the browser's native print pipeline (.pdf)
// Deals with the export from both main page and results/summary page
//
// STEP 1 REWRITE — NATIVE PRINT METHOD
// -------------------------------------------------------------------------
// The previous implementation drove jsPDF's manual canvas-drawing API
// (2700+ lines) plus html2canvas as a KaTeX rasterization fallback. It
// froze the tab on large quizzes, mangled Arabic shaping/bidi, broke
// KaTeX layout when forced through the raster fallback, and clipped or
// force-scrolled code blocks because the PDF page had no scroll surface
// to give them.
//
// The new approach: reuse buildQuizHtml() — the same markdown/KaTeX/RTL
// -aware renderer that powers the "Interactive HTML" export — to build a
// real DOM, drop it into a hidden <iframe>, apply print-specific CSS
// overrides (unwrap anything that clips or horizontally scrolls on
// screen), and hand off to iframe.contentWindow.print(). The browser's
// native "Save as PDF" pipeline then does the actual layout, pagination,
// and text/Arabic shaping — which it already does correctly — instead of
// us reimplementing a page-layout engine by hand.
// -------------------------------------------------------------------------

import { showNotification } from "../../components/notifications/notifications.js";
import { buildQuizHtml } from "./export-to-html.js";

// =========================================================
// PRINT-ONLY CSS OVERRIDES
// =========================================================
// buildQuizHtml() is written for on-screen viewing: code blocks scroll
// horizontally and are height-capped (max-height: 500px; overflow:
// hidden) because on a screen you can scroll them. A printed/PDF page
// has no scroll surface, so anything relying on scroll has to be
// unwrapped into flowing, wrapping content instead — that's what this
// stylesheet does. It's appended *after* MARKDOWN_CSS (already inlined
// into buildQuizHtml's <style>), so these rules win on specificity/order,
// and only apply inside `@media print` so on-screen previewing of the
// same iframe (if ever shown) isn't affected.
const PDF_PRINT_CSS = (backgroundChoice = "light") => `
@media print {
  @page { size: A4; margin: 14mm 12mm; }

  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  html, body {
    background: ${backgroundChoice === "dark" ? "#121212" : "#ffffff"} !important;
    ${backgroundChoice === "dark" ? "" : "color: #1a1a1a !important;"}
    width: auto;
    max-width: none;
  }
  ${backgroundChoice === "dark" ? "" : `
  /* Fix #pdf-contrast: light background needs the CSS custom properties
     that shared/markdown-css.js's MARKDOWN_CSS relies on throughout
     (--color-text-primary, --color-background, etc.) flipped too — the
     previous fix only overrode a handful of hardcoded-hex selectors
     directly in export-to-html.js's own <style> block, but every
     markdown-rendered question/option/explanation body still resolved
     --color-text-primary to the dark-theme "#fff" default declared in
     that file's :root block, which is invisible on the new white page.
     Redeclaring the variables here (after the original :root block, so
     these win on source order) fixes every var(--...)-based rule at
     once instead of chasing each one individually. */
  :root {
    --color-primary: #3b82f6 !important;
    --color-primary-light: rgba(59, 130, 246, 0.12) !important;
    --color-border: #ddd !important;
    --color-border-light: #ccc !important;
    --color-text-primary: #1a1a1a !important;
    --color-text-secondary: #555 !important;
    --color-background: #ffffff !important;
    --color-background-secondary: #f4f4f5 !important;
    --color-success: #16a34a !important;
    --color-error: #dc2626 !important;
    --color-code: #1a1a1a !important;
  }
  /* Also flip the [data-theme="light"]-scoped rules already defined in
     markdown-css.js (table striping, code syntax-highlight colors, the
     inline-code block) by actually setting data-theme so they apply —
     they were previously written but unreachable since the exported
     <html> tag never carried this attribute. */
  html { color-scheme: light; }

  /* Light background: the on-screen dark theme's card/text colors need
     flipping too, or content is unreadable (dark text on dark card,
     etc. inherited from the interactive-HTML dark theme). */
  .question-card { background: #f8f9fa !important; border-color: #ddd !important; }
  .q-header, .rd-label { color: #555 !important; }
  .q-text, h1, .score-label, .rd-value { color: #1a1a1a !important; }
  .option { background: #f0f1f3 !important; color: #1a1a1a !important; border-color: #ddd !important; }
  .option-letter { background: #e2e4e8 !important; color: #444 !important; }
  .code-block { background: #f4f4f5 !important; border-color: #ccc !important; }
  .code-block code { color: #1a1a1a !important; }
  .code-block-wrapper { background: #f4f4f5 !important; border-color: #ccc !important; box-shadow: none !important; }
  .inline-code { background: #eef0f4 !important; border-color: #ccc !important; color: #b91c1c !important; }
  .math-raw { background: #f4f4f5 !important; border-color: #ccc !important; color: #1a1a1a !important; }
  .md-blockquote { background: #f4f4f5 !important; color: #333 !important; }
  .essay-box { background: #f0f1f3 !important; }
  .essay-score.correct { background: rgba(16,185,129,0.12) !important; color: #047857 !important; }
  .essay-score.partial { background: rgba(245,158,11,0.12) !important; color: #b45309 !important; }
  .essay-score.wrong   { background: rgba(239,68,68,0.12) !important;  color: #b91c1c !important; }
  .score-block { background: #f8f9fa !important; border-color: #ddd !important; }
  .results-detail { background: #f4f4f5 !important; border-color: #ddd !important; }
  .rd-row { border-bottom-color: #e2e4e8 !important; }
  .rd-value { color: #1a1a1a !important; }
  .rd-highlight { background: rgba(59,130,246,0.08) !important; }
  .rd-highlight .rd-label, .rd-highlight .rd-value { color: #1d4ed8 !important; }
  .meta, .footer { color: #666 !important; }
  .footer { border-top-color: #ddd !important; }
  `}

  /* ── Code blocks: never clip, never force a horizontal scrollbar ──
     On screen these rely on overflow/scroll — the printed page has no
     scroll surface, so we let them grow to full height and wrap long
     lines instead of cutting them off or relying on a scrollbar. */
  .code-block-wrapper {
    max-height: none !important;
    overflow: visible !important;
    break-inside: avoid;
  }
  .code-block {
    overflow: visible !important;
    white-space: pre-wrap !important;
    word-break: break-word !important;
    overflow-wrap: anywhere !important;
  }
  .code-block code {
    white-space: pre-wrap !important;
    word-break: break-word !important;
    overflow-wrap: anywhere !important;
  }
  .inline-code {
    white-space: pre-wrap !important;
    word-break: break-word !important;
  }

  /* GFM tables: same story — let them wrap/shrink instead of scrolling */
  .md-table-wrapper { overflow-x: visible !important; }
  table { table-layout: fixed; width: 100%; }
  table td, table th {
    white-space: normal !important;
    word-break: break-word !important;
  }

  /* KaTeX: allow display-mode equations to wrap rather than overflow
     the page width if a single expression is wider than the margin. */
  .katex-display { overflow-x: visible !important; white-space: normal !important; }
  .katex-display > .katex { white-space: normal !important; }

  /* Never split a question card across a page boundary if it can
     reasonably fit on one page; if it can't, allow the break rather
     than shrinking/clipping content. Spacing is tightened vs. the
     on-screen version (which uses generous padding/margins meant for
     mouse/touch interaction) specifically so two short questions
     (True/False, short MCQ) can share a page instead of each one
     nearly filling a page on its own. */
  .question-card {
    break-inside: avoid-page;
    page-break-inside: avoid;
    padding: 12px 14px !important;
    margin-bottom: 10px !important;
  }
  .q-header { margin-bottom: 8px !important; }
  .q-text { margin-bottom: 10px !important; }
  .options-list { gap: 5px !important; margin-bottom: 10px !important; }
  .option { padding: 6px 10px !important; margin-bottom: 0 !important; }
  .user-answer, .correct-answer { margin-top: 8px !important; padding: 8px 10px !important; }
  .explanation { margin-top: 8px !important; padding: 8px 10px !important; }
  .score-block { break-inside: avoid-page; }

  /* Copy-code buttons and other purely-interactive chrome are
     meaningless on paper. */
  .copy-code-btn { display: none !important; }

  /* Avoid an empty trailing page/hairline caused by margin collapse
     on the last element. */
  .footer { break-inside: avoid; }
}
`;

// =========================================================
// HIDDEN IFRAME PRINT PIPELINE
// =========================================================
/**
 * Writes `htmlContent` into a hidden, off-screen <iframe>, waits for it
 * (and any KaTeX/webfont it loads) to actually finish rendering, then
 * calls print() on it. Using an iframe rather than a new tab/window means:
 *  - it can't be blocked by popup blockers,
 *  - nothing ever flashes visibly in the current tab,
 *  - we don't depend on the browser keeping a second window alive.
 *
 * @param {string} htmlContent — full <!DOCTYPE html> document string
 * @param {string} title — used as the iframe document's <title>, which
 *   most browsers pre-fill as the suggested "Save as PDF" filename.
 * @returns {Promise<void>} resolves once print() has been invoked
 *   (i.e. once the native print/save dialog has been handed off to the
 *   browser — not once the user has actually finished saving, which the
 *   web platform gives us no reliable signal for).
 */
function printHtmlViaHiddenIframe(htmlContent, title) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(iframe);

    let settled = false;
    let printed = false;

    const cleanup = () => {
      // Give the browser a beat after the print dialog closes before we
      // rip the iframe (and its document/resources) out from under it —
      // some browsers still reference it briefly during dialog teardown.
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
      // Don't clean up immediately on resolve — the print dialog is
      // often still using the iframe's document at this point (esp. in
      // Chromium's async print preview). cleanup() runs from
      // afterprint/blur below, or the fallback timer.
    };

    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      try {
        const win = iframe.contentWindow;
        if (win.document.title !== title) win.document.title = title;

        // afterprint fires once the user closes/completes the native
        // dialog (either by saving or cancelling) — that's our real
        // signal that it's safe to tear the iframe down.
        win.addEventListener("afterprint", cleanup, { once: true });

        win.focus();
        win.print();
        succeed();

        // Fallback for browsers that never fire afterprint on an
        // iframe's contentWindow (older WebKit/mobile browsers): tear
        // down after a generous timeout regardless.
        setTimeout(cleanup, 60000);
      } catch (err) {
        fail(err);
      }
    };

    iframe.onerror = () => fail(new Error("Failed to load print document"));

    iframe.onload = () => {
      const doc = iframe.contentDocument || iframe.contentWindow.document;

      // If the document declares KaTeX (loaded async via <script src>),
      // give it a moment to finish laying out math before printing —
      // otherwise math nodes can print as raw "$...$" text if the
      // browser hands off to the print dialog mid-render. We poll for
      // KaTeX's presence rather than hooking a load event since the
      // auto-render pass itself doesn't expose one.
      const needsKatexWait = /\bkatex\b/i.test(htmlContent);
      if (!needsKatexWait) {
        // No math in this quiz — print as soon as the layout/paint from
        // the initial load has settled (two rAFs is the standard trick
        // for "after the browser has actually painted").
        requestAnimationFrame(() => requestAnimationFrame(triggerPrint));
        return;
      }

      const deadline = Date.now() + 3000;
      const poll = () => {
        const rendered =
          doc.querySelector(".katex") || Date.now() > deadline;
        if (rendered) {
          requestAnimationFrame(() => requestAnimationFrame(triggerPrint));
        } else {
          setTimeout(poll, 100);
        }
      };
      poll();
    };

    iframe.srcdoc = htmlContent;
  });
}

// =========================================================
// MAIN EXPORT
// =========================================================
/**
 * @param {object} config
 * @param {Array} questions
 * @param {Array|object} [userAnswers]
 * @param {object} [resultMeta] — currently unused by the print pipeline
 *   (the score summary is already built into buildQuizHtml() whenever
 *   userAnswers is non-empty); kept in the signature so callers
 *   (download-quiz-modal.js) don't need to change.
 * @param {Function} [onProgress] — optional (pct: 0–100) => void.
 * @param {object} [pdfOptions] — { backgroundColor?: "light" | "dark" }.
 *   backgroundColor defaults to "light" (uniform white) — the old
 *   hardcoded dark background is now opt-in via the settings panel.
 */
export async function exportToPdf(
  config,
  questions,
  userAnswers = [],
  resultMeta = {},
  onProgress = null,
  pdfOptions = {},
) {
  const backgroundChoice = pdfOptions.backgroundColor === "dark" ? "dark" : "light";
  try {
    if (!config || !questions || !Array.isArray(questions)) {
      throw new Error(
        "Invalid parameters: config and questions array required",
      );
    }

    if (typeof onProgress === "function") onProgress(10);

    // Reuse the same markdown/KaTeX/RTL-aware HTML builder as the
    // "Interactive HTML" export — one renderer, one set of Arabic/RTL/
    // code-block/math fixes to maintain instead of two.
    const htmlContent = await buildQuizHtml(config, questions, userAnswers);

    if (typeof onProgress === "function") onProgress(40);

    // Splice our print-only overrides in right before </head> so they
    // load after (and therefore override) MARKDOWN_CSS.
    const printCss = PDF_PRINT_CSS(backgroundChoice);
    const htmlWithPrintCss = htmlContent.includes("</head>")
      ? htmlContent.replace(
        "</head>",
        `<style>${printCss}</style></head>`,
      )
      : htmlContent + `<style>${printCss}</style>`;

    const filenameBase = (config.title || "quiz").trim() || "quiz";

    if (typeof onProgress === "function") onProgress(60);

    await printHtmlViaHiddenIframe(htmlWithPrintCss, filenameBase);

    if (typeof onProgress === "function") onProgress(100);

    showNotification(
      "جاهز للحفظ كـ PDF",
      'اختر "حفظ كـ PDF" من نافذة الطباعة',
      "./assets/images/PDF_Icon.png",
    );
    return { success: true };
  } catch (error) {
    console.error("PDF Export Error:", error);
    showNotification("فشل تصدير PDF", `${error.message}`, "error");
    return { success: false, error: error.message };
  }
}
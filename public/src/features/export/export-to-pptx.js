// public/src/features/export/export-to-pptx.js
// Downloads the quiz as a PowerPoint file (.pptx)
// Deals with the export from both main page and results page
// `PptxGenJS` library used, included in this file.

/* ============== Issues ==============
1. Score page has missplaced the score table
2. Some text is gray, which makes it unreadable.
3. Everything is rendered RTL. It should be LTR
4. It attpemts to render a useless copy button for code blocks for some reason!.
5. The language name for code blocks is missplaced out of the code block itself
   ============== End ============== */

import { showNotification } from "../../components/notifications.js";

import {
  gradeEssay,
  isEssayQuestion,
  calculateQuizMetrics,
} from "../../shared/rate-answers.js";

// Markdown + KaTeX renderer (same engine used by the live quiz UI and HTML export)
import { renderMarkdown } from "../../shared/markdown.js";

// ===========================
// LAZY LOADERS
// ===========================
let _pptxgen;
let _html2canvas;

async function loadPptxGen() {
  if (!_pptxgen) {
    // Official PptxGenJS — does not support slide transitions/animations.
    // For a fork that does, swap this URL:
    // "https://esm.sh/@bapunhansdah/pptxgenjs"
    const module =
      await import("https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/+esm");
    _pptxgen = module.default;
    window.pptxgen = _pptxgen;
  }
  return _pptxgen;
}

/**
 * Dynamically loads html2canvas from the CDN.
 * html2canvas is used to rasterise off-screen DOM nodes (Markdown + KaTeX)
 * into PNG images that PptxGenJS can embed natively.
 */
async function loadHtml2Canvas() {
  if (!_html2canvas) {
    const mod =
      await import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.esm.js");
    _html2canvas = mod.default;
  }
  return _html2canvas;
}

// ===========================
// FONT PRE-WARMER
// ===========================
/**
 * Renders a tiny hidden element containing representative KaTeX math so the
 * browser starts fetching KaTeX's WOFF2 font files immediately — before the
 * export loop begins. We then await document.fonts.ready so html2canvas
 * never captures a slide while fallback fonts are still in use.
 *
 * Safe to call multiple times; the DOM node is removed after fonts are ready.
 */
async function warmKatexFonts() {
  if (typeof renderMarkdown !== "function") return;

  const probe = document.createElement("div");
  Object.assign(probe.style, {
    position: "fixed",
    left: "-99999px",
    top: "0",
    fontSize: "14pt",
    visibility: "hidden",
  });

  // Cover as many KaTeX font variants as possible in one probe:
  // Main, Math italic, bold, SansSerif, Caligraphic, fractions, Greek, operators
  probe.innerHTML = renderMarkdown(
        "$E = mc^2$, $\\alpha + \\beta + \\gamma$, $\\mathbf{A}$, $\\mathcal{L}$\n\n" +
        "$$\\int_0^\\infty e^{-x}\\,dx = 1 \\quad \\sum_{i=0}^{n} \\frac{i^2}{n}$$\n\n" +
        "$$\\sqrt{x^2+y^2} \\leq \\|\\mathbf{v}\\| \\cdot \\cos\\theta$$");
  document.body.appendChild(probe);

  // Step 1 — let the browser decide what fonts it needs
  await document.fonts.ready;

  // Step 2 — explicitly force-fetch every font face that isn't fully loaded yet.
  // document.fonts.ready resolves even on slow networks (Chrome just uses fallbacks),
  // so we must call .load() ourselves to guarantee real glyphs before any canvas capture.
  const forceLoads = [];
  document.fonts.forEach((face) => {
    if (face.status !== "loaded") {
      forceLoads.push(
        face.load().catch(() => {
          /* ignore individual failures */
        }),
      );
    }
  });
  if (forceLoads.length) await Promise.allSettled(forceLoads);

  document.body.removeChild(probe);
}
// ===========================
// MAIN EXPORT FUNCTION
// ===========================
export async function exportToPptx(config, questions, userAnswers = []) {
  try {
    // ── Parallel: load CDN libs + pre-warm KaTeX fonts simultaneously ──────
    const [pptxgen] = await Promise.all([
      loadPptxGen(),
      loadHtml2Canvas(), // warm the module cache now, not on first render
      warmKatexFonts(), // kick off font downloads immediately
    ]);

    // ===========================
    // VALIDATION
    // ===========================
    if (!config || !questions || !Array.isArray(questions)) {
      throw new Error(
        "Invalid parameters: config and questions array required",
      );
    }

    // ===========================
    // INITIALIZE PRESENTATION
    // ===========================
    const pptx = new pptxgen();

    // Fix #3a: Force LTR globally so Arabic footer text doesn't flip the entire presentation
    pptx.rtlMode = false;

    // ===========================
    // CONSTANTS & CONFIGURATION
    // ===========================
    const SLIDE_WIDTH = 10;
    const SLIDE_HEIGHT = 5.625;
    const MARGIN = 0.4;
    const HEADER_HEIGHT = 0.8;
    const FOOTER_HEIGHT = 0.4;
    const USABLE_WIDTH = SLIDE_WIDTH - MARGIN * 2;
    const MAX_IMAGE_HEIGHT = SLIDE_HEIGHT * 0.35;

    /** Y-coordinate at which body content starts (just below the header divider). */
    const CONTENT_TOP = HEADER_HEIGHT + 0.1;

    /**
     * Maximum Y-coordinate body content may reach before we must paginate.
     * Leaves a 0.15 in breathing room above the footer band.
     */
    const CONTENT_BOTTOM = SLIDE_HEIGHT - FOOTER_HEIGHT - 0.15;

    // Modern Color Palette
    const COLORS = Object.freeze({
      primary: "4F46E5", // Indigo 600
      primaryLight: "818CF8", // Indigo 400
      secondary: "F59E0B", // Amber 500
      accent: "06B6D4", // Cyan 500
      success: "10B981", // Emerald 500
      error: "EF4444", // Red 500
      warning: "F97316", // Orange 500
      info: "3B82F6", // Blue 500
      background: "F8FAFC", // Slate 50
      surface: "FFFFFF", // White
      textDark: "1E293B", // Slate 800
      textMedium: "475569", // Slate 600
      textLight: "94A3B8", // Slate 400
      border: "CBD5E1", // Slate 300
      optionNeutral: "F1F5F9", // Slate 100
      userWrong: "FEE2E2", // Red 100
      correctBg: "D1FAE5", // Emerald 100
      essayBg: "FFF7ED", // Orange 50
      explanationBg: "EFF6FF", // Blue 50
      userAnswerBg: "EDE9FE", // Violet 100
    });

    // ===========================
    // UTILITY FUNCTIONS
    // ===========================

    /** Strips real control characters; preserves all printable text and newlines. */
    const sanitizeText = (text) => {
      if (text === null || text === undefined) return "";
      return String(text)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
    };

    /**
     * Returns true when the string contains Markdown or LaTeX math tokens that
     * cannot be reliably represented as native PptxGenJS text runs.
     * Covers: inline/block math ($), bold, italic, strikethrough, inline code,
     * fenced code blocks, ATX headings, bullet/ordered lists, and tables.
     */
    const hasMarkdownOrMath = (text) => {
      if (!text) return false;
      return /\$|[*_]{1,3}[^\s]|~~[^\s]|`|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\|/m.test(
        text,
      );
    };

    /**
     * Estimates the rendered height (in inches) of a plain-text string inside a
     * PptxGenJS text box. Used as the fallback when hasMarkdownOrMath is false so
     * we avoid PptxGenJS clipping text that overflows its fixed-height box.
     *
     * The formula is intentionally generous (+20 %) so short estimates never cause
     * clipping — any excess whitespace at the bottom is harmless.
     */
    const estimateTextHeight = (text, fontSizePt, widthInches) => {
      const lineHeightIn = (fontSizePt / 72) * 1.7;
      // Approximate average character width ≈ 0.55 × em
      const charsPerLine = Math.max(
        Math.floor((widthInches * 72) / (fontSizePt * 0.55)),
        8,
      );
      const lines = Math.max(Math.ceil((text || "").length / charsPerLine), 1);
      return lines * lineHeightIn + 0.1; // +0.1 in padding
    };

    /**
     * Renders Markdown + KaTeX text into a PNG image via html2canvas and returns
     * it as a data URL along with its intrinsic dimensions in inches.
     *
     * Strategy:
     *  1. Create a hidden off-screen <div> whose pixel width matches the desired
     *     PPTX width in inches (at 96 DPI).
     *  2. Inject `renderMarkdown(text)` HTML.
     *  3. Wait two rAF frames for KaTeX to finish painting.
     *  4. Capture with html2canvas at scale 1.5 for crisp text in PowerPoint.
     *  5. Return the data URL and the computed height in inches.
     *
     * @param {string} text – Raw quiz text (may contain Markdown / LaTeX).
     * @param {object} opts
     * @param {number}  opts.maxWidthIn  – Target width in PPTX inches (default USABLE_WIDTH).
     * @param {string|null} opts.bgHex   – 6-char hex background or null for white.
     * @param {string}  opts.textHex     – 6-char hex foreground text colour.
     * @param {number}  opts.fontSizePt  – Base font size in points.
     * @param {number}  opts.paddingPx   – Inner padding applied to the off-screen div.
     * @returns {Promise<{dataUrl:string, widthIn:number, heightIn:number}>}
     */
    const renderTextToImage = async (
      text,
      {
        maxWidthIn = USABLE_WIDTH,
        bgHex = null,
        textHex = COLORS.textDark,
        fontSizePt = 13,
        paddingPx = 10,
      } = {},
    ) => {
      const h2c = await loadHtml2Canvas();
      const widthPx = Math.floor(maxWidthIn * 96);

      const wrapper = document.createElement("div");
      Object.assign(wrapper.style, {
        position: "fixed",
        left: "-99999px",
        top: "0",
        width: `${widthPx}px`,
        fontFamily: "Segoe UI, Arial, sans-serif",
        fontSize: `${fontSizePt}pt`,
        color: `#${textHex}`,
        background: bgHex ? `#${bgHex}` : "#ffffff",
        padding: `${paddingPx}px`,
        boxSizing: "border-box",
        lineHeight: "1.55",
        wordBreak: "break-word",
        overflowWrap: "break-word",
      });

      // Fix #3c: Force LTR on the off-screen wrapper so html2canvas captures
      // LTR layout regardless of the host page's base direction
      wrapper.setAttribute("dir", "ltr");

      // Minimal styles so tables, code blocks, lists, and KaTeX render legibly.
      const style = document.createElement("style");
      style.textContent = `
        table{border-collapse:collapse;width:100%;margin:6px 0}
        td,th{border:1px solid #cbd5e1;padding:5px 10px;text-align:left;font-size:0.92em}
        th{background:#f1f5f9;font-weight:700}
        pre{background:#1e293b;color:#e2e8f0;padding:10px 14px;border-radius:7px;
            overflow:hidden;font-family:Consolas,monospace;font-size:0.85em;margin:6px 0}
        code{background:rgba(99,102,241,0.1);border:1px solid #e2e8f0;border-radius:4px;
             padding:1px 6px;font-family:Consolas,monospace;font-size:0.88em}
        pre code{background:none;border:none;padding:0;color:inherit}
        strong{font-weight:700} em{font-style:italic} del{text-decoration:line-through}
        ul,ol{padding-left:22px;margin:4px 0} li{margin:2px 0}
        blockquote{border-left:3px solid #4f46e5;margin:6px 0;
                   padding:4px 12px;background:#f5f3ff;border-radius:0 4px 4px 0}
        h1,h2,h3,h4{margin:6px 0 3px;line-height:1.3;font-weight:700}
        .katex{font-size:1.1em} .katex-display{margin:4px 0;text-align:center}
        .math-block{text-align:center;margin:6px 0;overflow:hidden}
        p{margin:3px 0}
        button{display:none!important}
        [class*="copy"]{display:none!important}
        [class*="lang"],[class*="language-label"],pre>span:first-child{display:none!important}
      `;
      // Fix #4: Hide all buttons (catches any class name the renderer assigns to copy buttons)
      // TODO: narrow the `button` / `[class*="copy"]` selector once the exact class
      //       emitted by renderMarkdown is confirmed in DevTools.
      // Fix #5: Hide language badges that float outside the code block due to missing
      //         host-page CSS; selector uses [class*="lang"] to catch common variants.
      //         TODO: replace with the precise class name from renderMarkdown's output.
      wrapper.appendChild(style);

      const content = document.createElement("div");
      content.innerHTML = renderMarkdown(text);
      wrapper.appendChild(content);
      document.body.appendChild(wrapper);

      // Wait for KaTeX SVG layout
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );

      // Force-load any font still not fully loaded — same reasoning as warmKatexFonts.
      // This is the last line of defence right before html2canvas captures the element.
      const pendingFonts = [];
      document.fonts.forEach((face) => {
        if (face.status !== "loaded") {
          pendingFonts.push(face.load().catch(() => {}));
        }
      });
      if (pendingFonts.length) await Promise.allSettled(pendingFonts);

      const canvas = await h2c(wrapper, {
        backgroundColor: bgHex ? `#${bgHex}` : "#ffffff",
        scale: 1.5,
        logging: false,
        useCORS: true,
        allowTaint: false,
        onclone: async (_clonedDoc) => {
          // Ensure the cloned document's fonts are also ready
          await _clonedDoc.fonts.ready;
        },
      });

      document.body.removeChild(wrapper);

      const dataUrl = canvas.toDataURL("image/png");
      // Convert pixel height back to inches (canvas is at scale 1.5 × 96 DPI = 144 DPI)
      const heightIn = canvas.height / 144;

      return { dataUrl, widthIn: maxWidthIn, heightIn };
    };

    // ===========================
    // IMAGE HELPERS (unchanged)
    // ===========================
    const getImageDimensions = (imageSource) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => reject(new Error("Failed to load image"));
        img.crossOrigin = "Anonymous";
        img.src = imageSource;
      });

    const calculateImageSize = (imgWidth, imgHeight, maxWidth, maxHeight) => {
      const aspectRatio = imgWidth / imgHeight;
      let width = maxWidth;
      let height = width / aspectRatio;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }
      return { width, height, aspectRatio };
    };

    // ===========================
    // PRESENTATION METADATA
    // ===========================
    const userName = localStorage.getItem("username") || "User";
    const documentTitle = sanitizeText(config.title || "Quiz Quest");

    const isResultsMode =
      userAnswers &&
      (Array.isArray(userAnswers)
        ? userAnswers.length > 0
        : Object.keys(userAnswers).length > 0);

    /**
     * scoreData now comes from the shared calculateQuizMetrics function,
     * which is the single source of truth used by the results page and HTML export.
     * Fields: mcqCorrect, mcqWrong, mcqSkipped, mcqTotal, essayCount,
     *         essayScoreTotal, essayMaxTotal, isEssayOnly,
     *         percentage, actualPercentage
     */
    const scoreData = isResultsMode
      ? calculateQuizMetrics(questions, userAnswers)
      : null;

    // Passing threshold: ≥70 % on the holistic (combined MCQ+Essay) score.
    const isPassing = scoreData ? scoreData.actualPercentage >= 70 : false;

    // ===========================
    // PRESENTATION PROPERTIES
    // ===========================
    pptx.author = "Belal Amr - Quiz Quest";
    pptx.title = documentTitle;
    pptx.subject = "Interactive Quiz Results";
    pptx.layout = "LAYOUT_16x9";
    pptx.theme = { bodyFont: "Segoe UI" };

    // ===========================
    // SLIDE HELPERS
    // ===========================
    const addBackground = (slide) => {
      slide.background = { color: COLORS.background };
      slide.addShape(pptx.shapes.RECTANGLE, {
        x: 0,
        y: 0,
        w: 0.15,
        h: SLIDE_HEIGHT,
        fill: { color: COLORS.primary },
      });
    };

    const addHeader = (slide) => {
      slide.addText(documentTitle, {
        x: MARGIN,
        y: 0.15,
        w: USABLE_WIDTH * 0.6,
        h: 0.4,
        fontSize: 16,
        bold: true,
        color: COLORS.primary,
        align: "left",
        fontFace: "Segoe UI Semibold",
      });
      slide.addText(userName, {
        x: MARGIN + USABLE_WIDTH * 0.6,
        y: 0.15,
        w: USABLE_WIDTH * 0.4,
        h: 0.4,
        fontSize: 12,
        color: COLORS.textLight,
        align: "right",
      });
      slide.addShape(pptx.shapes.LINE, {
        x: MARGIN,
        y: 0.6,
        w: USABLE_WIDTH,
        h: 0,
        line: { color: COLORS.border, width: 1 },
      });
    };

    const addFooter = (slide) => {
      slide.addText("صنع بواسطة منصة إمتحانات بصمجي", {
        x: MARGIN,
        y: SLIDE_HEIGHT - FOOTER_HEIGHT,
        w: USABLE_WIDTH,
        h: FOOTER_HEIGHT,
        fontSize: 9,
        color: COLORS.textLight,
        align: "center",
        // Fix #3b: Mark only this text box as RTL so the Arabic footer renders
        // correctly without flipping the direction of the rest of the slide
        lang: "ar-EG",
        rtlMode: true,
      });
    };

    /** Creates a fresh content slide (background + header + footer pre-applied). */
    const addContentSlide = () => {
      const s = pptx.addSlide();
      addBackground(s);
      addHeader(s);
      addFooter(s);
      return s;
    };

    // ===========================
    // TITLE SLIDE
    // ===========================
    const titleSlide = pptx.addSlide();
    addBackground(titleSlide);

    titleSlide.addShape(pptx.shapes.OVAL, {
      x: SLIDE_WIDTH - 2.5,
      y: -0.5,
      w: 3,
      h: 3,
      fill: { color: COLORS.primaryLight, transparency: 80 },
    });
    titleSlide.addShape(pptx.shapes.OVAL, {
      x: -0.5,
      y: SLIDE_HEIGHT - 2,
      w: 3,
      h: 3,
      fill: { color: COLORS.secondary, transparency: 80 },
    });

    titleSlide.addText(documentTitle, {
      x: 1,
      y: 1.8,
      w: 8,
      h: 1,
      fontSize: 40,
      bold: true,
      color: COLORS.textDark,
      align: "center",
      fontFace: "Segoe UI Black",
    });
    titleSlide.addText(
      isResultsMode ? "Interactive Results Review" : "Quiz Preview",
      {
        x: 1,
        y: 2.8,
        w: 8,
        h: 0.5,
        fontSize: 20,
        color: COLORS.primary,
        align: "center",
        fontFace: "Segoe UI Semibold",
      },
    );
    titleSlide.addText(`${questions.length} Questions`, {
      x: 1,
      y: 3.4,
      w: 8,
      h: 0.4,
      fontSize: 14,
      color: COLORS.textMedium,
      align: "center",
    });

    // ===========================
    // RESULTS SUMMARY SLIDE
    // ===========================
    if (isResultsMode && scoreData) {
      const {
        mcqCorrect,
        mcqWrong,
        mcqSkipped,
        mcqTotal,
        essayCount,
        essayScoreTotal,
        essayMaxTotal,
        actualPercentage,
        percentage,
      } = scoreData;

      const displayPct =
        actualPercentage !== undefined ? actualPercentage : percentage;

      const summarySlide = addContentSlide();

      summarySlide.addText("PERFORMANCE SUMMARY", {
        x: MARGIN,
        y: 0.9,
        w: USABLE_WIDTH,
        h: 0.45,
        fontSize: 22,
        bold: true,
        color: COLORS.textDark,
        align: "center",
      });

      // ── Score circle ──
      summarySlide.addShape(pptx.shapes.OVAL, {
        x: SLIDE_WIDTH / 2 - 1.2,
        y: 1.5,
        w: 2.4,
        h: 2.4,
        fill: { color: COLORS.surface },
        line: { color: isPassing ? COLORS.success : COLORS.warning, width: 5 },
      });
      summarySlide.addText(`${displayPct}%`, {
        x: SLIDE_WIDTH / 2 - 1.2,
        y: 1.5,
        w: 2.4,
        h: 2.4,
        fontSize: 44,
        bold: true,
        color: isPassing ? COLORS.success : COLORS.warning,
        align: "center",
        valign: "middle",
      });
      summarySlide.addText(
        isPassing ? "🎉 Great Job!" : "📚 Keep Practicing!",
        {
          x: MARGIN,
          y: 4.1,
          w: USABLE_WIDTH,
          h: 0.4,
          fontSize: 16,
          bold: true,
          color: isPassing ? COLORS.success : COLORS.warning,
          align: "center",
        },
      );

      // ── Stats table — mirrors export-to-html.js score block ──
      const hasMcq = mcqTotal > 0;
      const hasEssay = essayCount > 0;

      // Build rows dynamically depending on quiz type
      const headerRow = [
        {
          text: "Metric",
          options: {
            bold: true,
            fontSize: 11,
            fill: COLORS.primary,
            color: "FFFFFF",
          },
        },
        {
          text: "Value",
          options: {
            bold: true,
            fontSize: 11,
            fill: COLORS.primary,
            color: "FFFFFF",
          },
        },
      ];

      const dataRows = [];

      if (hasMcq && hasEssay) {
        const totalEarned = mcqCorrect + essayScoreTotal;
        const totalPossible = mcqTotal + essayMaxTotal;
        const essayStars =
          "★".repeat(Math.round((essayScoreTotal / essayMaxTotal) * 5)) +
          "☆".repeat(5 - Math.round((essayScoreTotal / essayMaxTotal) * 5));
        dataRows.push(
          [
            {
              text: "Total Score",
              options: { fontSize: 11, fill: "FFFFFF", color: COLORS.textDark },
            }, // Fix #2a: explicit color
            {
              text: `${totalEarned} / ${totalPossible} pts`,
              options: {
                fontSize: 11,
                bold: true,
                fill: "FFFFFF",
                color: COLORS.primary,
              },
            },
          ],
          [
            {
              text: "MCQ",
              options: {
                fontSize: 11,
                fill: COLORS.background,
                color: COLORS.textDark,
              },
            }, // Fix #2a: explicit color
            {
              text: `${mcqCorrect} / ${mcqTotal} correct`,
              options: {
                fontSize: 11,
                color: COLORS.success,
                bold: true,
                fill: COLORS.background,
              },
            },
          ],
          [
            {
              text: "MCQ Wrong",
              options: { fontSize: 11, fill: "FFFFFF", color: COLORS.textDark },
            }, // Fix #2a: explicit color
            {
              text: String(mcqWrong),
              options: {
                fontSize: 11,
                color: COLORS.error,
                bold: true,
                fill: "FFFFFF",
              },
            },
          ],
          [
            {
              text: "Essays",
              options: {
                fontSize: 11,
                fill: COLORS.background,
                color: COLORS.textDark,
              }, // Fix #2a: explicit color
            },
            {
              text: `${essayScoreTotal} / ${essayMaxTotal} pts  ${essayStars}`,
              options: {
                fontSize: 11,
                color: COLORS.secondary,
                bold: true,
                fill: COLORS.background,
              },
            },
          ],
        );
      } else if (hasEssay) {
        const essayStars =
          "★".repeat(Math.round((essayScoreTotal / essayMaxTotal) * 5)) +
          "☆".repeat(5 - Math.round((essayScoreTotal / essayMaxTotal) * 5));
        dataRows.push(
          [
            {
              text: "Essay Score",
              options: { fontSize: 11, fill: "FFFFFF", color: COLORS.textDark },
            }, // Fix #2a: explicit color
            {
              text: `${essayScoreTotal} / ${essayMaxTotal} pts`,
              options: {
                fontSize: 11,
                bold: true,
                color: COLORS.primary,
                fill: "FFFFFF",
              },
            },
          ],
          [
            {
              text: "Rating",
              options: {
                fontSize: 11,
                fill: COLORS.background,
                color: COLORS.textDark,
              }, // Fix #2a: explicit color
            },
            {
              text: essayStars,
              options: {
                fontSize: 13,
                color: COLORS.secondary,
                bold: true,
                fill: COLORS.background,
              },
            },
          ],
        );
      } else {
        // MCQ only
        dataRows.push(
          [
            {
              text: "Correct Answers",
              options: { fontSize: 11, fill: "FFFFFF", color: COLORS.textDark }, // Fix #2a: explicit color
            },
            {
              text: `${mcqCorrect} / ${mcqTotal}`,
              options: {
                fontSize: 11,
                color: COLORS.success,
                bold: true,
                fill: "FFFFFF",
              },
            },
          ],
          [
            {
              text: "Incorrect Answers",
              options: {
                fontSize: 11,
                fill: COLORS.background,
                color: COLORS.textDark,
              }, // Fix #2a: explicit color
            },
            {
              text: String(mcqWrong),
              options: {
                fontSize: 11,
                color: COLORS.error,
                bold: true,
                fill: COLORS.background,
              },
            },
          ],
          [
            {
              text: "Skipped",
              options: { fontSize: 11, fill: "FFFFFF", color: COLORS.textDark },
            }, // Fix #2a: explicit color
            {
              text: String(mcqSkipped),
              options: {
                fontSize: 11,
                color: COLORS.textMedium,
                fill: "FFFFFF",
              },
            },
          ],
        );
      }

      // Always append Overall % and Pass/Fail
      dataRows.push(
        [
          {
            text: "Overall Score",
            options: {
              fontSize: 12,
              bold: true,
              fill: COLORS.primaryLight,
              color: "FFFFFF",
            },
          },
          {
            text: `${displayPct}%`,
            options: {
              fontSize: 14,
              bold: true,
              fill: COLORS.primaryLight,
              color: "FFFFFF",
            },
          },
        ],
        [
          {
            text: "Status",
            options: {
              fontSize: 11,
              fill: isPassing ? COLORS.correctBg : COLORS.userWrong,
              color: COLORS.textDark, // Fix #2a: explicit color so it's readable on both fills
            },
          },
          {
            text: isPassing ? "✓ Passed" : "✗ Not Passed",
            options: {
              fontSize: 11,
              bold: true,
              color: isPassing ? COLORS.success : COLORS.error,
              fill: isPassing ? COLORS.correctBg : COLORS.userWrong,
            },
          },
        ],
      );

      // Fix #1: Shift table left and reduce width so the right edge (6.1 + 3.3 = 9.4 in)
      // stays within the slide boundary (10 in) and clears the score circle (right edge ~6.2 in)
      summarySlide.addTable([headerRow, ...dataRows], {
        x: SLIDE_WIDTH / 2 + 1.1, // Fix #1: was SLIDE_WIDTH / 2 + 1.3 (overflowed at 10.1 in)
        y: 1.5,
        w: 3.3, // Fix #1: was 3.8 (right edge now 9.4 in, safely within slide)
        border: { pt: 0.5, color: COLORS.border },
        align: "left",
        valign: "middle",
        rowH: 0.32,
      });
    }

    // ===========================
    // QUESTION SLIDES
    // ===========================
    for (const [index, question] of questions.entries()) {
      const isEssay = isEssayQuestion(question);
      const userAns = userAnswers[index];
      const hasUserAnswer =
        isResultsMode && userAns !== undefined && userAns !== null;
      const questionText = sanitizeText(question.q || "");

      // ── Per-question mutable slide state ──
      let slide = addContentSlide();
      let currentY = CONTENT_TOP;

      /**
       * Ensures there is at least `neededH` inches of vertical space remaining.
       * If not, a new continuation slide is created and currentY is reset.
       * Because `slide` and `currentY` are captured by reference in this closure,
       * the caller always reads the updated values after calling maybeNewSlide().
       */
      const maybeNewSlide = (neededH) => {
        if (currentY + neededH > CONTENT_BOTTOM) {
          slide = addContentSlide();
          slide.addText(`Q${index + 1} — continued`, {
            x: MARGIN,
            y: CONTENT_TOP,
            w: 2.5,
            h: 0.22,
            fontSize: 9,
            color: COLORS.textLight,
            italic: true,
          });
          currentY = CONTENT_TOP + 0.27;
        }
      };

      /**
       * Universal "rich text block" renderer.
       *
       * • When the string contains Markdown/LaTeX → captured as a PNG image
       *   (exact pixel height → precise layout).
       * • Otherwise → native PptxGenJS addText (no http round-trip, no canvas).
       *
       * Always calls maybeNewSlide() before writing so the block never starts
       * past the usable content area. Updates currentY after writing.
       *
       * @returns {number} height consumed in inches
       */
      const addRichBlock = async (
        text,
        {
          x = MARGIN,
          w = USABLE_WIDTH,
          fontSizePt = 13,
          bold = false,
          colorHex = COLORS.textDark,
          bgHex = null,
          insetIn = 0,
          minH = 0,
        } = {},
      ) => {
        const innerW = w - insetIn * 2;

        if (hasMarkdownOrMath(text)) {
          // ── Image path (Markdown / KaTeX) ──
          let img;
          try {
            img = await renderTextToImage(text, {
              maxWidthIn: innerW,
              bgHex: bgHex || "FFFFFF",
              textHex: colorHex,
              fontSizePt,
              paddingPx: Math.round(insetIn * 72), // convert inches → pts for px padding
            });
          } catch (err) {
            // Graceful fallback: plain sanitised text
            console.warn("[PPTX] renderTextToImage failed, falling back:", err);
            img = null;
          }

          if (img) {
            const totalH = Math.max(img.heightIn + insetIn * 2, minH);
            maybeNewSlide(totalH);

            if (bgHex) {
              slide.addShape(pptx.shapes.RECTANGLE, {
                x,
                y: currentY,
                w,
                h: totalH,
                fill: { color: bgHex },
                line: { color: bgHex },
              });
            }
            slide.addImage({
              data: img.dataUrl,
              x: x + insetIn,
              y: currentY + insetIn,
              w: img.widthIn,
              h: img.heightIn,
            });
            currentY += totalH;
            return totalH;
          }
          // fall through to plain path if image render failed
        }

        // ── Native text path (plain / fallback) ──
        const plain = sanitizeText(text);
        const estimatedH = Math.max(
          estimateTextHeight(plain, fontSizePt, innerW),
          minH,
        );
        maybeNewSlide(estimatedH);

        const textOpts = {
          x,
          y: currentY,
          w,
          h: estimatedH,
          fontSize: fontSizePt,
          bold,
          color: colorHex,
          valign: "top",
          wrap: true,
          ...(bgHex && { fill: { color: bgHex } }),
          ...(insetIn > 0 && { inset: insetIn }),
        };
        slide.addText(plain, textOpts);
        currentY += estimatedH;
        return estimatedH;
      };

      // ── Label helpers ──
      const addLabel = (labelText, colorHex = COLORS.textMedium, fsPt = 10) => {
        const h = 0.28;
        maybeNewSlide(h);
        slide.addText(labelText, {
          x: MARGIN,
          y: currentY,
          w: USABLE_WIDTH,
          h,
          fontSize: fsPt,
          bold: true,
          color: colorHex,
        });
        currentY += h;
      };

      const addSpacer = (heightIn = 0.1) => {
        currentY += heightIn;
      };

      // ===========================
      // STATUS BADGE + QUESTION NUMBER
      // ===========================
      if (isResultsMode) {
        let statusText = "ESSAY";
        let statusBg = COLORS.warning;

        if (!isEssay) {
          if (!hasUserAnswer) {
            statusText = "SKIPPED";
            statusBg = COLORS.textLight;
          } else if (userAns === (question.correct ?? question.answer)) {
            statusText = "CORRECT";
            statusBg = COLORS.success;
          } else {
            statusText = "WRONG";
            statusBg = COLORS.error;
          }
        }

        maybeNewSlide(0.3);
        slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
          x: MARGIN,
          y: currentY,
          w: 1.2,
          h: 0.28,
          r: 0.14,
          fill: { color: statusBg },
        });
        slide.addText(statusText, {
          x: MARGIN,
          y: currentY,
          w: 1.2,
          h: 0.28,
          fontSize: 10,
          bold: true,
          color: "FFFFFF",
          align: "center",
        });
      }

      slide.addText(`Question ${index + 1}`, {
        x: isResultsMode ? MARGIN + 1.3 : MARGIN,
        y: currentY,
        w: 4,
        h: 0.28,
        fontSize: 14,
        bold: true,
        color: COLORS.primary,
      });
      currentY += 0.35;

      // ===========================
      // QUESTION IMAGE (if present)
      // ===========================
      if (question.image) {
        try {
          const imgDims = await getImageDimensions(question.image);
          const aspectRatio = imgDims.width / imgDims.height;
          const isWide = aspectRatio >= 1.2;

          const imgSize = calculateImageSize(
            imgDims.width,
            imgDims.height,
            isWide ? USABLE_WIDTH * 0.4 : USABLE_WIDTH * 0.8,
            MAX_IMAGE_HEIGHT,
          );

          if (isWide && imgSize.width < USABLE_WIDTH * 0.5) {
            // Side-by-side: text left, image right
            const textWidth = USABLE_WIDTH - imgSize.width - 0.4;
            maybeNewSlide(Math.max(imgSize.height, 0.5));

            await addRichBlock(questionText, {
              x: MARGIN,
              w: textWidth,
              fontSizePt: 16,
              bold: true,
              colorHex: COLORS.textDark,
            });
            // Rewind currentY to draw image alongside the text that was just added
            const imgY =
              currentY -
              estimateTextHeight(sanitizeText(questionText), 16, textWidth);
            slide.addImage({
              path: question.image,
              x: MARGIN + textWidth + 0.2,
              y: Math.max(imgY, CONTENT_TOP + 0.35),
              w: imgSize.width,
              h: imgSize.height,
            });
            currentY =
              Math.max(currentY, CONTENT_TOP + 0.35 + imgSize.height) + 0.2;
          } else {
            // Stacked: image then text
            maybeNewSlide(imgSize.height + 0.2);
            slide.addImage({
              path: question.image,
              x: (SLIDE_WIDTH - imgSize.width) / 2,
              y: currentY,
              w: imgSize.width,
              h: imgSize.height,
            });
            currentY += imgSize.height + 0.15;
            await addRichBlock(questionText, {
              fontSizePt: 16,
              bold: true,
              colorHex: COLORS.textDark,
            });
          }
        } catch (err) {
          console.warn("[PPTX] Failed to load question image:", err);
          await addRichBlock(questionText, {
            fontSizePt: 18,
            bold: true,
            colorHex: COLORS.textDark,
          });
        }
      } else {
        // No image — full-width question text
        await addRichBlock(questionText, {
          fontSizePt: 18,
          bold: true,
          colorHex: COLORS.textDark,
        });
      }
      addSpacer(0.15);

      // ===========================
      // OPTIONS / ESSAY ANSWER AREA
      // ===========================
      if (isEssay) {
        // ── Essay question ──────────────────────────────────────────────────

        if (isResultsMode && hasUserAnswer) {
          // User's submitted answer
          addLabel("YOUR ANSWER:", COLORS.info, 10);
          await addRichBlock(String(userAns), {
            fontSizePt: 12,
            colorHex: COLORS.textDark,
            bgHex: COLORS.userAnswerBg,
            insetIn: 0.1,
          });
          addSpacer(0.1);

          // ── Essay score via gradeEssay ───────────────────────────────────
          const essayScore = gradeEssay(userAns, question.answer ?? "");
          const stars = "★".repeat(essayScore) + "☆".repeat(5 - essayScore);
          const scoreColor =
            essayScore >= 4
              ? COLORS.success
              : essayScore >= 2
                ? COLORS.secondary
                : COLORS.error;
          const scoreBg =
            essayScore >= 4
              ? COLORS.correctBg
              : essayScore >= 2
                ? "FEF3C7" // Amber 100
                : COLORS.userWrong;

          const scoreH = 0.38;
          maybeNewSlide(scoreH);
          slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
            x: MARGIN,
            y: currentY,
            w: USABLE_WIDTH,
            h: scoreH,
            r: 0.1,
            fill: { color: scoreBg },
            line: { color: scoreColor, width: 1 },
          });
          slide.addText(
            [
              {
                text: `Score: ${essayScore}/5  `,
                options: { bold: true, color: COLORS.textDark, fontSize: 12 },
              },
              {
                text: stars,
                options: { bold: true, color: COLORS.secondary, fontSize: 14 },
              },
            ],
            {
              x: MARGIN,
              y: currentY,
              w: USABLE_WIDTH,
              h: scoreH,
              valign: "middle",
              align: "center",
            },
          );
          currentY += scoreH + 0.12;
        }

        // Model / correct answer
        addLabel("CORRECT ANSWER / KEY POINTS:", COLORS.success, 10);
        await addRichBlock(sanitizeText(question.answer), {
          fontSizePt: 12,
          colorHex: COLORS.textDark,
          bgHex: COLORS.correctBg,
          insetIn: 0.1,
        });
      } else {
        // ── Multiple-choice options ─────────────────────────────────────────

        const options = question.options || [];
        const correctIdx = question.correct ?? question.answer;
        const anyMdOrMath = options.some((o) => hasMarkdownOrMath(String(o)));

        // Only use two-column layout when options are plain text (easier height math)
        const useTwoCols = !anyMdOrMath && options.length > 3;
        const colWidth = useTwoCols ? (USABLE_WIDTH - 0.2) / 2 : USABLE_WIDTH;

        for (let idx = 0; idx < options.length; idx++) {
          const opt = options[idx];
          const optText = String(opt);
          const label = String.fromCharCode(65 + idx);
          const isCorrect = idx === correctIdx;
          const isUserSel = isResultsMode && hasUserAnswer && idx === userAns;

          let highlightBg = COLORS.surface;
          let borderColor = COLORS.border;
          let borderWidth = 1;

          if (isCorrect) {
            highlightBg = COLORS.correctBg;
            borderColor = COLORS.success;
            borderWidth = 2;
          } else if (isUserSel && !isCorrect) {
            highlightBg = COLORS.userWrong;
            borderColor = COLORS.error;
            borderWidth = 2;
          }

          if (anyMdOrMath) {
            // ── Markdown/math options: render each as its own image block ──
            const prefixedText = `**${label}.** ${optText}`;
            const img = hasMarkdownOrMath(prefixedText)
              ? await renderTextToImage(prefixedText, {
                  maxWidthIn: USABLE_WIDTH - 0.2,
                  bgHex: highlightBg,
                  fontSizePt: 12,
                }).catch(() => null)
              : null;

            if (img) {
              const optH = Math.max(img.heightIn + 0.12, 0.38);
              maybeNewSlide(optH + 0.06);

              slide.addShape(pptx.shapes.RECTANGLE, {
                x: MARGIN,
                y: currentY,
                w: USABLE_WIDTH,
                h: optH,
                fill: { color: highlightBg },
                line: { color: borderColor, width: borderWidth },
              });
              slide.addImage({
                data: img.dataUrl,
                x: MARGIN + 0.08,
                y: currentY + 0.06,
                w: img.widthIn,
                h: img.heightIn,
              });
              currentY += optH + 0.06;
            } else {
              // Fallback to plain text if image render failed
              const plain = `${label}. ${sanitizeText(optText)}`;
              const optH = Math.max(
                estimateTextHeight(plain, 12, USABLE_WIDTH - 0.2),
                0.35,
              );
              maybeNewSlide(optH + 0.06);
              slide.addText(plain, {
                x: MARGIN,
                y: currentY,
                w: USABLE_WIDTH,
                h: optH,
                fontSize: 12,
                color: COLORS.textDark,
                fill: { color: highlightBg },
                line: { color: borderColor, width: borderWidth },
                inset: 0.1,
                valign: "middle",
                wrap: true,
              });
              currentY += optH + 0.06;
            }
          } else {
            // ── Plain text options: native PptxGenJS text (fast, no canvas) ──
            const plain = `${label}. ${sanitizeText(optText)}`;
            const optH = Math.max(
              estimateTextHeight(plain, 12, colWidth - 0.2),
              0.35,
            );

            const col = idx % (useTwoCols ? 2 : 1);
            const row = Math.floor(idx / (useTwoCols ? 2 : 1));

            if (col === 0) {
              maybeNewSlide(optH + 0.06);
            }
            // Recalculate y after potential slide break (currentY may have changed)
            const optX = MARGIN + col * (colWidth + 0.2);
            const optY =
              useTwoCols && col === 1
                ? currentY - (optH + 0.06) // align with the left cell in the same row
                : currentY;

            slide.addText(plain, {
              x: optX,
              y: optY,
              w: colWidth,
              h: optH,
              fontSize: 12,
              color: COLORS.textDark,
              fill: { color: highlightBg },
              line: { color: borderColor, width: borderWidth },
              inset: 0.1,
              valign: "middle",
              wrap: true,
            });

            if (
              !useTwoCols ||
              col === (useTwoCols ? 1 : 0) ||
              idx === options.length - 1
            ) {
              currentY += optH + 0.06;
            }
          }
        }
      }

      addSpacer(0.1);

      // ===========================
      // EXPLANATION
      // ===========================
      if (question.explanation && question.explanation.trim()) {
        addLabel("💡 EXPLANATION:", COLORS.primary, 10);
        await addRichBlock(sanitizeText(question.explanation), {
          fontSizePt: 11,
          colorHex: COLORS.textDark, // Fix #2b: was COLORS.textMedium (low contrast on explanationBg)
          bgHex: COLORS.explanationBg,
          insetIn: 0.1,
        });
      }
    } // end question loop

    // ===========================
    // CTA SLIDE
    // ===========================
    const ctaSlide = addContentSlide();

    ctaSlide.addText("🎮 End 🎮", {
      x: 1,
      y: 1.4,
      w: 8,
      h: 0.7,
      fontSize: 50,
      bold: true,
      color: COLORS.primary,
      align: "center",
    });
    ctaSlide.addText("READY FOR MORE?", {
      x: 1,
      y: 2.3,
      w: 8,
      h: 0.5,
      fontSize: 28,
      bold: true,
      color: COLORS.primary,
      align: "center",
    });
    ctaSlide.addText("https://basmagi-quiz.vercel.app/", {
      x: 1,
      y: 3.1,
      w: 8,
      h: 0.3,
      fontSize: 18,
      bold: true,
      color: COLORS.info,
      align: "center",
      hyperlink: {
        url: "https://basmagi-quiz.vercel.app/",
        tooltip: "Go to The quiz website again.",
      },
    });

    // ===========================
    // SAVE FILE
    // ===========================
    const fileName = `${documentTitle}.pptx`;
    await pptx.writeFile({ fileName });

    showNotification(
      "PowerPoint file downloaded.",
      "You have it now",
      "./assets/images/pptx_icon.png",
    );

    return true;
  } catch (error) {
    console.error("[PPTX] Export Error:", error);
    throw error;
  }
}

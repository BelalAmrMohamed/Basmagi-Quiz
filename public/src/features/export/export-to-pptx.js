// public/src/features/export/export-to-pptx.js
// Downloads the quiz as a PowerPoint file (.pptx)
// Deals with the export from both main page and results page
// `PptxGenJS` library used, included in this file.

/* ============== Issues ==============
All items from the original list here (score-table placement, gray
unreadable text, RTL flipping, stray copy buttons, misplaced code-block
language labels) are resolved — see the `Fix #1`–`Fix #6` comments
throughout this file for where each was addressed.

All items from docs/plans/plan-to-fix-pptx-bugs.md are now also
addressed: multi-correct-answer support (isIdxCorrect/isIdxUserSelected),
the html2canvas contrast sweep, empty-slide prevention (lazy getSlide()),
long-question overflow + markdown-detection gaps (hasMarkdownOrMath /
estimateTextHeight), two-column option layout (row-major Fix #two-col),
video/audio/YouTube placeholders, and progress-bar granularity (per-
question weighted reporting). A separate, previously unreported bug was
also found and fixed while working the contrast/overflow items: the
off-screen html2canvas wrapper's injected <style> used unscoped
`button`/`[class*="copy"]` selectors, which — combined with a missing
try/finally around the canvas capture — could leak a page-wide
"hide every button" rule if a single render failed, explaining reports
of buttons vanishing elsewhere on the site after a PPTX export. See
Fix #critical near renderTextToImage().
   ============== End ============== */

import { showNotification } from "../../components/notifications/notifications.js";

import {
  gradeEssay,
  isEssayQuestion,
  isAnswerCorrect,
  calculateQuizMetrics,
} from "../../shared/rate-answers.js";

// Markdown + KaTeX renderer (same engine used by the live quiz UI and HTML export)
import { renderMarkdown } from "../../shared/markdown.js";

// ===========================
// MEDIA URL HELPERS (mirrors export-to-html.js / export-to-quiz.js)
// ===========================
// This is now the THIRD file needing this exact logic (export-to-quiz.js,
// export-to-html.js, and this one) — per the plan doc's own note, a third
// duplicate is the point where extracting a shared module stops being a
// "nice to have" and starts being worth doing. Kept as a local duplicate
// for now to avoid widening this session's blast radius across files, but
// flagged here for a follow-up `shared/media-url.js` extraction.
const PLATFORM_ORIGIN = "https://basmagi-quiz.vercel.app";
const resolveMediaUrl = (url) => {
  if (!url || typeof url !== "string") return url;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  // Fix #file-origin: a file:// page's window.location.origin serializes to
  // the literal (truthy) string "null" per spec, which silently defeated
  // the `|| PLATFORM_ORIGIN` fallback and let a relative path survive
  // unresolved into the exported file — see export-to-quiz.js's
  // resolveMediaUrl for the full explanation.
  const winOrigin =
    typeof window !== "undefined" && window.location && window.location.origin;
  const origin =
    winOrigin && winOrigin !== "null" && !/^file:/i.test(winOrigin)
      ? winOrigin
      : PLATFORM_ORIGIN;
  try {
    return new URL(url, origin).href;
  } catch {
    return url;
  }
};

const YOUTUBE_RE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

/** Returns the 11-char YouTube video ID if `url` is a YouTube link, else null. */
const extractYoutubeId = (url) => {
  if (!url || typeof url !== "string") return null;
  const m = url.match(YOUTUBE_RE);
  return m ? m[1] : null;
};

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
/**
 * @param {object} config
 * @param {Array} questions
 * @param {Array|object} [userAnswers]
 * @param {Function} [onProgress]
 * @param {AbortSignal} [signal]
 * @param {object} [pptxOptions] — settings collected from the download
 *   modal's Settings Panel: { includeAnswers, includeUserAnswers,
 *   includeExplanations, answerPlacement: "inline" | "final-page" }.
 *   Defaults preserve the previous always-on behavior when omitted, so
 *   existing call sites that don't pass this keep working unchanged.
 */
export async function exportToPptx(
  config,
  questions,
  userAnswers = [],
  onProgress = null,
  signal = null,
  pptxOptions = {},
) {
  const {
    includeAnswers = true,
    includeUserAnswers = true,
    includeExplanations = true,
    answerPlacement = "inline",
  } = pptxOptions;
  try {
    // ── Fix #progress-7c: small sub-progress ticks for the CDN-loading
    // phase, so the bar doesn't sit at a dead 0% while pptxgenjs/
    // html2canvas/KaTeX fonts are still downloading — previously it
    // jumped straight from 0 to the first chunk's percentage once these
    // resolved. Only pre-warm html2canvas/KaTeX eagerly when the quiz
    // actually contains markdown/math content, so plain quizzes don't
    // pay for a network fetch they'll never use.
    if (typeof onProgress === "function") onProgress(2);
    const needsRichRender = (questions || []).some((q) => {
      const isEssay = isEssayQuestion(q);
      const opts = isEssay ? [] : q.options || [];
      return (
        /\$|[*_]{1,3}[^\s]|~~[^\s]|`|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\||\[[^\]]*\]\([^)]*\)|^\s*>\s|\\\[|\\\]/m.test(
          String(q.q || ""),
        ) ||
        opts.some((o) =>
          /\$|[*_]{1,3}[^\s]|~~[^\s]|`|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\||\[[^\]]*\]\([^)]*\)|^\s*>\s|\\\[|\\\]/m.test(
            String(o),
          ),
        ) ||
        /\$|[*_]{1,3}[^\s]|~~[^\s]|`|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\||\[[^\]]*\]\([^)]*\)|^\s*>\s|\\\[|\\\]/m.test(
          String(q.explanation || ""),
        )
      );
    });

    // ── Parallel: load CDN libs + pre-warm KaTeX fonts simultaneously ──────
    const pptxgenPromise = loadPptxGen().then((mod) => {
      if (typeof onProgress === "function") onProgress(4);
      return mod;
    });
    const auxPromises = needsRichRender
      ? [
        loadHtml2Canvas().then(() => {
          if (typeof onProgress === "function") onProgress(6);
        }),
        warmKatexFonts(),
      ]
      : [];
    const [pptxgen] = await Promise.all([pptxgenPromise, ...auxPromises]);
    if (typeof onProgress === "function") onProgress(8);

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
      // Fix #overflow-4a: widened to cover syntax the editor actually
      // allows (per shared/markdown.js's _renderMarkdownCore) that the
      // original regex missed entirely:
      //  - [text](url) / ![alt](url) — links & images
      //  - ^\s*>  — blockquotes (markdown-css.js explicitly styles
      //    `blockquote`, so the renderer supports it — this was a real gap)
      //  - \\\[ / \\\] — alternate display-math delimiters some editors emit
      return /\$|[*_]{1,3}[^\s]|~~[^\s]|`|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\||\[[^\]]*\]\([^)]*\)|^\s*>\s|\\\[|\\\]/m.test(
        text,
      );
    };

    /**
     * Estimates the rendered height (in inches) of a plain-text string inside a
     * PptxGenJS text box. Used as the fallback when hasMarkdownOrMath is false so
     * we avoid PptxGenJS clipping text that overflows its fixed-height box.
     *
     * Fix #overflow-4b: the safety margin now scales with line count (an
     * actual ~8% per line) instead of a flat +0.1in — a flat constant is
     * negligible once you're 15-20 lines in, which is how long questions
     * were getting cut off even though each individual line's estimate
     * only under-shot by a little. Also explicit newlines in the source
     * text are counted as forced line breaks in addition to the
     * width-based wrap estimate, since a flat char-count/charsPerLine
     * division alone undercounts height for text with manual line breaks.
     */
    const estimateTextHeight = (text, fontSizePt, widthInches) => {
      const lineHeightIn = (fontSizePt / 72) * 1.7;
      // Approximate average character width ≈ 0.55 × em. NOTE: this is a
      // deliberately conservative (wide) ratio for the default Segoe UI
      // body font PptxGenJS renders with — if a future font change makes
      // real glyphs narrower, estimates simply end up more generous, which
      // is the safe direction to be wrong in for this formula.
      const charsPerLine = Math.max(
        Math.floor((widthInches * 72) / (fontSizePt * 0.55)),
        8,
      );
      const raw = text || "";
      // Count wrapped lines per explicit paragraph separately, then sum —
      // a string with several manual newlines wraps each segment on its
      // own, it doesn't pool all characters into one continuous wrap.
      const paragraphs = raw.split("\n");
      const wrappedLines = paragraphs.reduce(
        (sum, p) => sum + Math.max(Math.ceil(p.length / charsPerLine), 1),
        0,
      );
      const lines = Math.max(wrappedLines, 1);
      // ~8% per-line safety margin (was a flat +0.1in, which is fine for a
      // 2-line string but negligible for a 20-line one) plus a small fixed
      // padding term so very short strings still get a touch of breathing
      // room.
      return lines * lineHeightIn * 1.08 + 0.06;
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

      // Fix #critical: unique per-call scope class. Previously the <style>
      // injected below used bare `button`/`[class*="copy"]` selectors —
      // since <style> tags are NOT scoped by DOM ancestry, those rules
      // applied to the ENTIRE host page for as long as the wrapper stayed
      // attached to document.body. Combined with the missing try/finally
      // around the h2c() call below (any failure meant removeChild() never
      // ran), this could permanently hide every button on the page —
      // exactly the "buttons disappeared after PPTX export" bug. Scoping
      // every rule under a unique class fixes the leak at the source;
      // the try/finally below is a second, independent safety net so a
      // thrown error can never leave the node attached at all.
      const scopeClass = `pptx-render-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const wrapper = document.createElement("div");
      wrapper.className = scopeClass;
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
      // Fix #critical: every selector is now scoped under `.${scopeClass}`
      // so these rules can never leak onto the rest of the page, no matter
      // how long the wrapper stays attached to document.body.
      const style = document.createElement("style");
      style.textContent = `
        .${scopeClass} table{border-collapse:collapse;width:100%;margin:6px 0}
        .${scopeClass} td,.${scopeClass} th{border:1px solid #cbd5e1;padding:5px 10px;text-align:left;font-size:0.92em}
        .${scopeClass} td,.${scopeClass} th{color:#1e293b!important;background-color:transparent!important}
        .${scopeClass} th{background:#f1f5f9!important;font-weight:700}
        /* Fix #contrast-3 (fresh LibreOffice Impress repro screenshot — a
           table with a purple header row and near-invisible body text):
           the HOST page's MARKDOWN_CSS [data-theme="..."] rules leak into
           this off-screen capture wrapper, and their specificity ((0,2,1)
           for \`[data-theme] .md-table th\` / \`.md-table-wrapper\`) beats
           these scoped rules ((0,1,1)), so on a dark-theme host page the
           wrapper's \`.md - table - wrapper\` filled with the dark
           var(--color-background) and the light `.th` background lost to
           the indigo tint — dark-navy cell text on a near-black table
           reads as "no content" and the tinted header looks purple.
           html2canvas renders the clone inside the SAME document, so host
           selectors really do apply; pin the light chrome + explicit dark
           cell text with !important so they can't be overridden. */
        .${scopeClass} .md-table-wrapper{background:#ffffff!important;background-image:none!important;background-color:#ffffff!important;box-shadow:none!important}
        .${scopeClass} .md-table{background:transparent!important}
        .${scopeClass} .md-table thead tr{background:transparent!important}
        .${scopeClass} .md-table tbody tr{background:transparent!important}
        .${scopeClass} pre{background:#1e293b!important;color:#e2e8f0!important;padding:10px 14px;border-radius:7px;
            overflow:hidden;font-family:Consolas,monospace;font-size:0.85em;margin:6px 0}
        .${scopeClass} code{background:rgba(99,102,241,0.1);border:1px solid #e2e8f0;border-radius:4px;
             padding:1px 6px;font-family:Consolas,monospace;font-size:0.88em}
        .${scopeClass} pre code{background:none;border:none;padding:0;color:inherit}
        /* Fix #6: syntax-highlighting token colors. highlightCode() (shared/
           markdown.js) wraps fenced-code tokens in <span class="sh-*">, whose
           colors normally come from shared/markdown-css.js's MARKDOWN_CSS —
           which is NOT imported here (it leans on var(--...) custom
           properties that only resolve on the live page's :root, so
           injecting it wholesale into this isolated off-screen wrapper would
           just trade one invisible-text bug for another). These are the same
           token colors hardcoded as plain hex instead, so code blocks render
           with real syntax coloring on the dark pre background rather than
           silently inheriting the surrounding text's color (which is
           whatever the caller's own textHex is — often a dark navy meant for
           a light background — producing the reported "black on black". */
        .${scopeClass} .sh-comment   { color: #636370; font-style: italic; }
        .${scopeClass} .sh-keyword   { color: #ff79c6; font-weight: 600; }
        .${scopeClass} .sh-string    { color: #50fa7b; }
        .${scopeClass} .sh-number    { color: #bd93f9; }
        .${scopeClass} .sh-type      { color: #8be9fd; }
        .${scopeClass} .sh-function  { color: #ffb86c; }
        .${scopeClass} .sh-property  { color: #f1fa8c; }
        .${scopeClass} .sh-builtin   { color: #8be9fd; font-style: italic; }
        .${scopeClass} .sh-operator  { color: #ff79c6; }
        .${scopeClass} .sh-variable  { color: #f8f8f2; }
        .${scopeClass} .sh-tag       { color: #ff79c6; }
        .${scopeClass} .sh-attr      { color: #50fa7b; }
        .${scopeClass} strong{font-weight:700} .${scopeClass} em{font-style:italic} .${scopeClass} del{text-decoration:line-through}
        .${scopeClass} ul,.${scopeClass} ol{padding-left:22px;margin:4px 0} .${scopeClass} li{margin:2px 0}
        .${scopeClass} blockquote{border-left:3px solid #4f46e5;margin:6px 0;
                   padding:4px 12px;background:#f5f3ff;border-radius:0 4px 4px 0;color:#1e293b}
        .${scopeClass} h1,.${scopeClass} h2,.${scopeClass} h3,.${scopeClass} h4{margin:6px 0 3px;line-height:1.3;font-weight:700}
        .${scopeClass} .katex{font-size:1.1em} .${scopeClass} .katex-display{margin:4px 0;text-align:center}
        .${scopeClass} .math-block{text-align:center;margin:6px 0;overflow:hidden}
        .${scopeClass} p{margin:3px 0}
        .${scopeClass} button{display:none!important}
        .${scopeClass} [class*="copy"]{display:none!important}
        .${scopeClass} [class*="lang"],.${scopeClass} [class*="language-label"],.${scopeClass} pre>span:first-child{display:none!important}
      `;
      // Fix #4: Hide all buttons (catches any class name the renderer assigns to copy buttons)
      // Fix #5: Hide language badges that float outside the code block due to missing
      //         host-page CSS; selector uses [class*="lang"] to catch common variants.
      // Both now scoped under scopeClass — see Fix #critical above.
      wrapper.appendChild(style);

      const content = document.createElement("div");
      content.innerHTML = renderMarkdown(text);
      wrapper.appendChild(content);
      document.body.appendChild(wrapper);

      // Fix #critical: guarantee cleanup even if html2canvas (or anything
      // else below) throws — previously a failure here left `wrapper` (and
      // its page-wide-leaking <style>, before the scoping fix above) stuck
      // in the DOM forever, which is how buttons across the whole site
      // could vanish after a single failed render.
      try {
        // Wait for KaTeX SVG layout
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );

        // Force-load any font still not fully loaded — same reasoning as warmKatexFonts.
        // This is the last line of defence right before html2canvas captures the element.
        const pendingFonts = [];
        document.fonts.forEach((face) => {
          if (face.status !== "loaded") {
            pendingFonts.push(face.load().catch(() => { }));
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

        const dataUrl = canvas.toDataURL("image/png");
        // Convert pixel height back to inches (canvas is at scale 1.5 × 96 DPI = 144 DPI)
        const heightIn = canvas.height / 144;

        return { dataUrl, widthIn: maxWidthIn, heightIn };
      } finally {
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      }
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

    // Fix #exportOptions: `isResultsMode` now also requires
    // includeUserAnswers — if the person exporting turned that setting
    // off in the download modal's settings panel, the deck should render
    // as a plain answer-key-style export (no per-user status
    // badges/highlighting/score summary), even when userAnswers was
    // technically passed in by the caller (e.g. exporting from the
    // Results page but choosing not to bake in this specific attempt).
    const isResultsMode =
      includeUserAnswers &&
      userAnswers &&
      (Array.isArray(userAnswers)
        ? userAnswers.length > 0
        : Object.keys(userAnswers).length > 0);

    // Collected while iterating the question loop below, used to build a
    // final "Answer Key" slide when answerPlacement === "final-page".
    const answerKeyEntries = [];

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
      slide.addText("صنع بواسطة منصة امتحانات بصمجي", {
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
    // QUESTION SLIDES  — chunked for UI responsiveness + cancellable
    // ===========================
    // Each iteration already awaits real async work (html2canvas renders
    // for Markdown/KaTeX-bearing questions), but a run of plain-text-only
    // questions has no await at all and can still block the main thread
    // for a while on a large quiz. We force a yield every PPTX_RENDER_CHUNK
    // questions regardless, and check `signal` at each question so Cancel
    // takes effect within a question or two instead of only at the end.
    // Fix #progress-7: reduced from 3 to 1 — report (and yield) after
    // EVERY question instead of every third one. This also directly
    // improves Cancel responsiveness (the yield below is what lets a
    // click actually register), not just visual smoothness.
    const PPTX_RENDER_CHUNK = 1;
    const totalQuestions = questions.length;
    // Weight each question's share of the 0-85% question-slide progress
    // band by whether it needs an html2canvas render (meaningfully
    // slower) so a run of markdown/math-heavy questions doesn't read as
    // "stalled then jumps" — a plain question is 1 unit of work, one with
    // any markdown/math (question text, options, or explanation) is ~3.5.
    const questionWorkUnits = questions.map((q) => {
      const isEssay = isEssayQuestion(q);
      const opts = isEssay ? [] : (q.options || []);
      const anyMd =
        hasMarkdownOrMath(String(q.q || "")) ||
        opts.some((o) => hasMarkdownOrMath(String(o))) ||
        hasMarkdownOrMath(String(q.explanation || "")) ||
        (isEssay && hasMarkdownOrMath(String(q.answer || "")));
      return anyMd ? 3.5 : 1;
    });
    const totalWorkUnits = questionWorkUnits.reduce((a, b) => a + b, 0) || 1;
    let completedWorkUnits = 0;

    for (const [index, question] of questions.entries()) {
      if (signal?.aborted) {
        throw new DOMException("Export cancelled", "AbortError");
      }

      const isEssay = isEssayQuestion(question);
      const userAns = userAnswers[index];
      const hasUserAnswer =
        isResultsMode && userAns !== undefined && userAns !== null;
      const questionText = sanitizeText(question.q || "");

      // ── Per-question mutable slide state ──
      // Fix #7 (empty slides): `slide` is created LAZILY on first real
      // content write instead of eagerly here. pptxgenjs@3.12.0 has no
      // removeSlide()/deleteSlide() API (confirmed against its source), so
      // the only reliable way to guarantee a slide is never shipped with
      // nothing drawn on it (just header/footer/background chrome) is to
      // never call addContentSlide() speculatively in the first place —
      // "create, then maybe delete if unused" isn't available, so this
      // does "only create once something is actually about to be drawn."
      // getSlide() is what every content-writing call below should go
      // through instead of reading `slide` directly.
      let slide = null;
      let currentY = CONTENT_TOP;
      let pendingContinuationLabel = false;

      const getSlide = () => {
        if (!slide) {
          slide = addContentSlide();
          if (pendingContinuationLabel) {
            slide.addText(`Q${index + 1} — continued`, {
              x: MARGIN,
              y: CONTENT_TOP,
              w: 2.5,
              h: 0.22,
              fontSize: 9,
              color: COLORS.textLight,
              italic: true,
            });
            pendingContinuationLabel = false;
          }
        }
        return slide;
      };

      /**
       * Ensures there is at least `neededH` inches of vertical space remaining.
       * If not, the CURRENT slide reference is cleared (rather than a new
       * slide being created immediately) and currentY is reset — the actual
       * addContentSlide() call is deferred to getSlide(), the next time
       * something is really drawn. Because `slide`/`currentY` are captured
       * by reference in this closure, the caller always reads the updated
       * values after calling maybeNewSlide().
       */
      const maybeNewSlide = (neededH) => {
        if (slide !== null && currentY + neededH > CONTENT_BOTTOM) {
          slide = null;
          pendingContinuationLabel = true;
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
              getSlide().addShape(pptx.shapes.RECTANGLE, {
                x,
                y: currentY,
                w,
                h: totalH,
                fill: { color: bgHex },
                line: { color: bgHex },
              });
            }
            getSlide().addImage({
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
        getSlide().addText(plain, textOpts);
        currentY += estimatedH;
        return estimatedH;
      };

      // ── Label helpers ──
      const addLabel = (labelText, colorHex = COLORS.textMedium, fsPt = 10) => {
        const h = 0.28;
        maybeNewSlide(h);
        getSlide().addText(labelText, {
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

      /**
       * Draws a labeled rounded-rectangle placeholder for direct (non-
       * YouTube) video/audio files — no thumbnail is available for these,
       * so this is a fixed-height box with a centered icon/label and a
       * hyperlink text run pointing at the resolved URL, so clicking it
       * in PowerPoint/Impress opens the file/stream in a browser.
       */
      const addMediaPlaceholder = (label, url) => {
        const h = 1.2;
        maybeNewSlide(h);
        getSlide().addShape(pptx.shapes.ROUNDED_RECTANGLE, {
          x: MARGIN,
          y: currentY,
          w: USABLE_WIDTH,
          h,
          r: 0.08,
          fill: { color: COLORS.background },
          line: { color: COLORS.border, width: 1 },
        });
        getSlide().addText(
          [
            { text: `${label}\n`, options: { fontSize: 20, bold: true, color: COLORS.textDark, breakLine: true } },
            { text: "Click to open", options: { fontSize: 11, color: COLORS.info } },
          ],
          {
            x: MARGIN,
            y: currentY,
            w: USABLE_WIDTH,
            h,
            align: "center",
            valign: "middle",
            hyperlink: { url, tooltip: url },
          },
        );
        currentY += h;
      };

      // ===========================
      // STATUS BADGE + QUESTION NUMBER
      // ===========================
      // Fix #exportOptions: CORRECT/WRONG inherently reveals whether the
      // user's answer matches the correct one, so this badge only shows
      // when includeAnswers is also on — with answers withheld, a "wrong"
      // badge would leak which questions were missed without ever
      // showing what the right answer was, which is a half-measure the
      // settings panel isn't supposed to allow. "SKIPPED" is safe to
      // keep either way since it reveals nothing about correctness, so
      // it still needs its own branch below when answers are off.
      const showStatusBadge = isResultsMode && includeAnswers;
      if (showStatusBadge || (isResultsMode && !hasUserAnswer)) {
        let statusText = "ESSAY";
        let statusBg = COLORS.warning;

        if (!isEssay) {
          if (!hasUserAnswer) {
            statusText = "SKIPPED";
            statusBg = COLORS.textLight;
          } else if (!includeAnswers) {
            statusText = "ANSWERED";
            statusBg = COLORS.info;
          } else if (isAnswerCorrect(userAns, question.correct ?? question.answer)) {
            statusText = "CORRECT";
            statusBg = COLORS.success;
          } else {
            statusText = "WRONG";
            statusBg = COLORS.error;
          }
        } else if (!includeAnswers) {
          statusText = "ANSWERED";
          statusBg = COLORS.info;
        }

        maybeNewSlide(0.3);
        getSlide().addShape(pptx.shapes.ROUNDED_RECTANGLE, {
          x: MARGIN,
          y: currentY,
          w: 1.2,
          h: 0.28,
          r: 0.14,
          fill: { color: statusBg },
        });
        getSlide().addText(statusText, {
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

      getSlide().addText(`Question ${index + 1}`, {
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
            getSlide().addImage({
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
            getSlide().addImage({
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
      // QUESTION VIDEO / AUDIO / YOUTUBE (if present)
      // ===========================
      // Mirrors the approach already shipped in export-to-html.js: PPTX
      // can't embed remote playable video/audio, so we draw a placeholder
      // instead. YouTube gets its real thumbnail (same img.youtube.com
      // trick); direct video/audio files get a labeled placeholder box.
      // Both are hyperlinked so clicking them in PowerPoint/Impress opens
      // the resolved URL in a browser. Always stacked above the question
      // text's own image handling (no side-by-side special case here —
      // that's only worth the complexity for the image path already
      // handled above). Schema doesn't combine question.image with
      // question.video/audio in practice, so this is a simple sequential
      // block rather than an if/else with the image branch above.
      const mediaUrl = question.video || question.audio;
      if (mediaUrl) {
        const resolvedMediaUrl = resolveMediaUrl(mediaUrl);
        const youtubeId = extractYoutubeId(mediaUrl);

        if (youtubeId) {
          // ── YouTube: real thumbnail + "Watch on YouTube" hyperlink ──
          const thumbUrl = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
          try {
            const imgDims = await getImageDimensions(thumbUrl);
            const imgSize = calculateImageSize(
              imgDims.width,
              imgDims.height,
              USABLE_WIDTH * 0.6,
              MAX_IMAGE_HEIGHT,
            );
            const totalH = imgSize.height + 0.3;
            maybeNewSlide(totalH);
            getSlide().addImage({
              path: thumbUrl,
              x: (SLIDE_WIDTH - imgSize.width) / 2,
              y: currentY,
              w: imgSize.width,
              h: imgSize.height,
            });
            getSlide().addText("▶ Watch on YouTube", {
              x: (SLIDE_WIDTH - imgSize.width) / 2,
              y: currentY + imgSize.height + 0.02,
              w: imgSize.width,
              h: 0.24,
              fontSize: 11,
              bold: true,
              color: COLORS.info,
              align: "center",
              hyperlink: { url: resolvedMediaUrl, tooltip: "Watch on YouTube" },
            });
            currentY += totalH;
          } catch (err) {
            console.warn("[PPTX] Failed to load YouTube thumbnail:", err);
            // Fall through to the generic placeholder below if the
            // thumbnail itself fails to load (e.g. network blocked it).
            addMediaPlaceholder("🎬 Video", resolvedMediaUrl);
          }
        } else {
          // ── Direct video/audio file: labeled placeholder + hyperlink ──
          const isAudio = Boolean(question.audio) && !question.video;
          addMediaPlaceholder(isAudio ? "🎵 Audio" : "🎬 Video", resolvedMediaUrl);
        }
        addSpacer(0.15);
      }

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
          getSlide().addShape(pptx.shapes.ROUNDED_RECTANGLE, {
            x: MARGIN,
            y: currentY,
            w: USABLE_WIDTH,
            h: scoreH,
            r: 0.1,
            fill: { color: scoreBg },
            line: { color: scoreColor, width: 1 },
          });
          getSlide().addText(
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

        // Fix #exportOptions: the model/correct answer is itself an
        // answer reveal, so it's gated by includeAnswers. When
        // answerPlacement is "final-page", defer it to the Answer Key
        // slide built after the question loop instead of rendering
        // inline here.
        if (includeAnswers) {
          if (answerPlacement === "final-page") {
            answerKeyEntries.push({
              index,
              type: "essay",
              answer: sanitizeText(question.answer),
            });
          } else {
            addLabel("CORRECT ANSWER / KEY POINTS:", COLORS.success, 10);
            await addRichBlock(sanitizeText(question.answer), {
              fontSizePt: 12,
              colorHex: COLORS.textDark,
              bgHex: COLORS.correctBg,
              insetIn: 0.1,
            });
          }
        }
      } else if (!Array.isArray(question.options) || question.options.length === 0) {
        // Fix #empty-slide-fallback: this question is neither classified as
        // essay (isEssayQuestion requires question.answer !== undefined) nor
        // does it have any options to render as MCQ — e.g. a multi-part
        // free-response/math question whose expected answer lives under a
        // field this exporter doesn't otherwise read, or genuinely has no
        // answer data at all. Previously this fell through to the MCQ
        // branch below with options = [], which rendered NOTHING after the
        // "Question N" label — producing an entirely blank-looking slide
        // (only header/footer/label), which is exactly the reported bug.
        // Render whatever we do have instead of silently drawing nothing:
        // question.answer if present (even though isEssayQuestion said no —
        // a truthy-but-somehow-still-undefined edge case is defensive here),
        // otherwise a neutral placeholder so the slide is never blank.
        if (includeAnswers && question.answer) {
          addLabel("ANSWER:", COLORS.success, 10);
          await addRichBlock(sanitizeText(String(question.answer)), {
            fontSizePt: 12,
            colorHex: COLORS.textDark,
            bgHex: COLORS.correctBg,
            insetIn: 0.1,
          });
        } else {
          await addRichBlock("(No answer options available for this question.)", {
            fontSizePt: 12,
            colorHex: COLORS.textMedium,
          });
        }
      } else {
        // ── Multiple-choice options ─────────────────────────────────────────

        const options = question.options || [];
        const correctIdx = question.correct ?? question.answer;
        const anyMdOrMath = options.some((o) => hasMarkdownOrMath(String(o)));

        // Fix #exportOptions: when answers are on AND placement is
        // "final-page", record the correct-answer text for the Answer
        // Key slide built after the question loop, and render options
        // WITHOUT correct-answer highlighting inline (only the user's
        // own selection, neutrally, still shows here — the reveal itself
        // is deferred to the final page).
        const deferAnswerToFinalPage =
          includeAnswers && answerPlacement === "final-page";
        if (deferAnswerToFinalPage) {
          const idxList = Array.isArray(correctIdx) ? correctIdx : [correctIdx];
          const letters = idxList
            .filter((i) => Number.isInteger(i) && options[i] !== undefined)
            .map((i) => `${String.fromCharCode(65 + i)}. ${sanitizeText(String(options[i]))}`)
            .join("; ");
          answerKeyEntries.push({ index, type: "mcq", answer: letters || "—" });
        }
        // Effective "reveal answers inline" flag used by the highlighting
        // logic below — false whenever the reveal is deferred to the
        // final page, even though includeAnswers itself is true.
        const revealInline = includeAnswers && !deferAnswerToFinalPage;

        // Only use two-column layout when options are plain text (easier height math)
        const useTwoCols = !anyMdOrMath && options.length > 3;
        const colWidth = useTwoCols ? (USABLE_WIDTH - 0.2) / 2 : USABLE_WIDTH;

        // Multi-select support: question.correct may be an array (e.g. [0, 2])
        // instead of a single index, and userAns follows the same shape for
        // multi-select questions (see shared/rate-answers.js's isAnswerCorrect,
        // the single source of truth for this comparison used by the live
        // quiz UI and results page — reused here rather than reimplemented).
        const isIdxCorrect = (idx) =>
          Array.isArray(correctIdx) ? correctIdx.includes(idx) : idx === correctIdx;
        const isIdxUserSelected = (idx) =>
          Array.isArray(userAns) ? userAns.includes(idx) : idx === userAns;

        // Fix #exportOptions: when includeAnswers is off, we must not
        // reveal correctness at all — that includes not highlighting the
        // user's own selection as "wrong", since a red highlight next to
        // an unmarked correct option still leaks which one was right by
        // elimination. The user's selection can still be shown, just in
        // a neutral "you picked this" tone with no correct/incorrect
        // implication.
        for (let idx = 0; idx < options.length; idx++) {
          const opt = options[idx];
          const optText = String(opt);
          const label = String.fromCharCode(65 + idx);
          const isCorrect = revealInline && isIdxCorrect(idx);
          const isUserSel =
            isResultsMode && hasUserAnswer && isIdxUserSelected(idx);

          let highlightBg = COLORS.surface;
          let borderColor = COLORS.border;
          let borderWidth = 1;

          if (isCorrect) {
            highlightBg = COLORS.correctBg;
            borderColor = COLORS.success;
            borderWidth = 2;
          } else if (isUserSel && !isCorrect && revealInline) {
            highlightBg = COLORS.userWrong;
            borderColor = COLORS.error;
            borderWidth = 2;
          } else if (isUserSel && !revealInline) {
            highlightBg = COLORS.userAnswerBg;
            borderColor = COLORS.info;
            borderWidth = 2;
          }

          if (anyMdOrMath) {
            // ── Markdown/math options: render each as its own image block ──
            const prefixedText = `**${label}.** ${optText}`;
            const img = hasMarkdownOrMath(prefixedText)
              ? await renderTextToImage(prefixedText, {
                maxWidthIn: USABLE_WIDTH - 0.2,
                bgHex: highlightBg,
                // Explicit rather than relying on renderTextToImage's own
                // default — highlightBg is always a light tone
                // (correctBg/userWrong/surface) so COLORS.textDark reads
                // fine on all three, but that should be asserted here, not
                // assumed silently via an unset param.
                textHex: COLORS.textDark,
                fontSizePt: 12,
              }).catch(() => null)
              : null;

            if (img) {
              const optH = Math.max(img.heightIn + 0.12, 0.38);
              maybeNewSlide(optH + 0.06);

              getSlide().addShape(pptx.shapes.RECTANGLE, {
                x: MARGIN,
                y: currentY,
                w: USABLE_WIDTH,
                h: optH,
                fill: { color: highlightBg },
                line: { color: borderColor, width: borderWidth },
              });
              getSlide().addImage({
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
              getSlide().addText(plain, {
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
          } else if (!useTwoCols) {
            // ── Single-column plain text: native PptxGenJS text ──
            const plain = `${label}. ${sanitizeText(optText)}`;
            const optH = Math.max(
              estimateTextHeight(plain, 12, colWidth - 0.2),
              0.35,
            );
            maybeNewSlide(optH + 0.06);
            getSlide().addText(plain, {
              x: MARGIN,
              y: currentY,
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
            currentY += optH + 0.06;
          }
          // Two-column plain-text options are handled in a separate
          // row-major pass below (see Fix #two-col) instead of inline
          // here, since drawing both cells of a row requires knowing
          // both cells' heights up front.
        }

        // ── Fix #two-col: row-major two-column rendering ──
        // The old per-option loop above alternated options into columns
        // one at a time and advanced currentY by whichever option was
        // drawn last in the row, which (a) assumed column 1's height
        // equalled column 0's height when computing column 1's Y, and
        // (b) advanced by the last-drawn height instead of the row's max
        // — both compounding into visibly misaligned rows once options'
        // lengths varied. Fixed by computing both cells' styling/height
        // up front, then drawing both at the same row Y using the row's
        // tallest cell height for both boxes and for the Y advance.
        if (useTwoCols && !anyMdOrMath) {
          const styleFor = (idx) => {
            const isCorrect = revealInline && isIdxCorrect(idx);
            const isUserSel =
              isResultsMode && hasUserAnswer && isIdxUserSelected(idx);
            let highlightBg = COLORS.surface;
            let borderColor = COLORS.border;
            let borderWidth = 1;
            if (isCorrect) {
              highlightBg = COLORS.correctBg;
              borderColor = COLORS.success;
              borderWidth = 2;
            } else if (isUserSel && !isCorrect && revealInline) {
              highlightBg = COLORS.userWrong;
              borderColor = COLORS.error;
              borderWidth = 2;
            } else if (isUserSel && !revealInline) {
              highlightBg = COLORS.userAnswerBg;
              borderColor = COLORS.info;
              borderWidth = 2;
            }
            return { highlightBg, borderColor, borderWidth };
          };

          for (let row = 0; row * 2 < options.length; row++) {
            const leftIdx = row * 2;
            const rightIdx = row * 2 + 1;
            const hasRight = rightIdx < options.length;

            const leftLabel = String.fromCharCode(65 + leftIdx);
            const leftText = `${leftLabel}. ${sanitizeText(String(options[leftIdx]))}`;
            const leftH = Math.max(
              estimateTextHeight(leftText, 12, colWidth - 0.2),
              0.35,
            );

            let rightText = "";
            let rightH = 0;
            if (hasRight) {
              const rightLabel = String.fromCharCode(65 + rightIdx);
              rightText = `${rightLabel}. ${sanitizeText(String(options[rightIdx]))}`;
              rightH = Math.max(
                estimateTextHeight(rightText, 12, colWidth - 0.2),
                0.35,
              );
            }

            const rowH = Math.max(leftH, rightH);
            maybeNewSlide(rowH + 0.06);

            const leftStyle = styleFor(leftIdx);
            getSlide().addText(leftText, {
              x: MARGIN,
              y: currentY,
              w: colWidth,
              h: rowH,
              fontSize: 12,
              color: COLORS.textDark,
              fill: { color: leftStyle.highlightBg },
              line: { color: leftStyle.borderColor, width: leftStyle.borderWidth },
              inset: 0.1,
              valign: "middle",
              wrap: true,
            });

            if (hasRight) {
              const rightStyle = styleFor(rightIdx);
              getSlide().addText(rightText, {
                x: MARGIN + colWidth + 0.2,
                y: currentY,
                w: colWidth,
                h: rowH,
                fontSize: 12,
                color: COLORS.textDark,
                fill: { color: rightStyle.highlightBg },
                line: { color: rightStyle.borderColor, width: rightStyle.borderWidth },
                inset: 0.1,
                valign: "middle",
                wrap: true,
              });
            }

            currentY += rowH + 0.06;
          }
        }
      }

      addSpacer(0.1);

      // ===========================
      // EXPLANATION
      // ===========================
      // Fix #exportOptions: gated by includeExplanations from the
      // settings panel.
      if (
        includeExplanations &&
        question.explanation &&
        question.explanation.trim()
      ) {
        // Fix #explanations-follow-placement: when answers are deferred
        // to the final-page Answer Key, the explanation is bundled with
        // that question's key entry instead of staying inline — an
        // explanation that restates the answer would otherwise defeat the
        // point of deferring the reveal. includeExplanations still
        // controls whether explanations appear at all.
        if (answerPlacement === "final-page" && includeAnswers) {
          const entry = answerKeyEntries.find((e) => e.index === index);
          if (entry) {
            entry.explanation = sanitizeText(question.explanation);
          } else {
            // No key entry for this question (its answer wasn't recorded)
            // — fall through to the inline render rather than silently
            // dropping the explanation.
            addLabel("💡 EXPLANATION:", COLORS.primary, 10);
            await addRichBlock(sanitizeText(question.explanation), {
              fontSizePt: 11,
              colorHex: COLORS.textDark, // Fix #2b: was COLORS.textMedium (low contrast on explanationBg)
              bgHex: COLORS.explanationBg,
              insetIn: 0.1,
            });
          }
        } else {
          addLabel("💡 EXPLANATION:", COLORS.primary, 10);
          await addRichBlock(sanitizeText(question.explanation), {
            fontSizePt: 11,
            colorHex: COLORS.textDark, // Fix #2b: was COLORS.textMedium (low contrast on explanationBg)
            bgHex: COLORS.explanationBg,
            insetIn: 0.1,
          });
        }
      }

      // Report progress (0–85% reserved for question slides; the
      // remaining 15% covers the CTA slide + pptx.writeFile() below).
      // Fix #progress-7: weighted by estimated work (see
      // questionWorkUnits above) rather than a flat (index+1)/total, so
      // the bar reflects that markdown/math-heavy questions genuinely
      // take longer instead of appearing to stall then jump.
      completedWorkUnits += questionWorkUnits[index];
      const isChunkEnd = (index + 1) % PPTX_RENDER_CHUNK === 0;
      const isLast = index === totalQuestions - 1;
      if (isChunkEnd || isLast) {
        if (typeof onProgress === "function") {
          onProgress(Math.round((completedWorkUnits / totalWorkUnits) * 85));
        }
        // Yield to the browser event loop so it can paint and process
        // input/cancel-click events before we resume CPU/canvas work.
        await new Promise((r) => setTimeout(r, 0));
      }
    } // end question loop

    // ===========================
    // ANSWER KEY SLIDE(S) — only when answerPlacement === "final-page"
    // ===========================
    // Fix #exportOptions: when the settings panel's "answer key placement"
    // is set to "grouped on a final page" instead of "below each
    // question", every correct answer collected during the question loop
    // (answerKeyEntries) is rendered here instead, on one or more
    // dedicated slides, rather than inline per-question.
    if (includeAnswers && answerPlacement === "final-page" && answerKeyEntries.length) {
      let akSlide = addContentSlide();
      let akY = CONTENT_TOP;
      akSlide.addText("ANSWER KEY", {
        x: MARGIN,
        y: akY,
        w: USABLE_WIDTH,
        h: 0.4,
        fontSize: 20,
        bold: true,
        color: COLORS.textDark,
        align: "center",
      });
      akY += 0.55;

      for (const entry of answerKeyEntries) {
        const text = `Q${entry.index + 1}: ${entry.answer}`;
        // Fix #explanations-follow-placement: entries may carry a bundled
        // explanation (only when the person exporting turned it on) —
        // render it as a second, smaller line and size the box to fit both.
        const explanationText = entry.explanation
          ? `\nExplanation: ${entry.explanation}`
          : "";
        const rowH =
          Math.max(estimateTextHeight(text, 12, USABLE_WIDTH - 0.2), 0.32) +
          (explanationText
            ? Math.max(
                estimateTextHeight(explanationText, 11, USABLE_WIDTH - 0.2),
                0.28,
              )
            : 0);
        if (akY + rowH + 0.06 > CONTENT_BOTTOM) {
          akSlide = addContentSlide();
          akY = CONTENT_TOP;
        }
        if (entry.explanation) {
          akSlide.addText(
            [
              {
                text: `Q${entry.index + 1}: ${entry.answer}`,
                options: { color: COLORS.textDark, fontSize: 12, breakLine: true },
              },
              {
                text: `Explanation: ${entry.explanation}`,
                options: { color: COLORS.info, fontSize: 11 },
              },
            ],
            {
              x: MARGIN,
              y: akY,
              w: USABLE_WIDTH,
              h: rowH,
              fill: { color: COLORS.correctBg },
              inset: 0.1,
              valign: "middle",
              wrap: true,
            },
          );
        } else {
          akSlide.addText(text, {
            x: MARGIN,
            y: akY,
            w: USABLE_WIDTH,
            h: rowH,
            fontSize: 12,
            color: COLORS.textDark,
            fill: { color: COLORS.correctBg },
            inset: 0.1,
            valign: "middle",
            wrap: true,
          });
        }
        akY += rowH + 0.06;
      }
    }

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
    if (signal?.aborted) {
      throw new DOMException("Export cancelled", "AbortError");
    }
    if (typeof onProgress === "function") onProgress(90);

    const fileName = `${documentTitle}.pptx`;
    await pptx.writeFile({ fileName });

    if (typeof onProgress === "function") onProgress(100);

    showNotification(
      "PowerPoint file downloaded.",
      "You have it now",
      "./assets/images/pptx_icon.png",
    );

    return true;
  } catch (error) {
    if (error.name === "AbortError") {
      console.log("[PPTX] Export cancelled by user");
      return { success: false, cancelled: true };
    }
    console.error("[PPTX] Export Error:", error);
    throw error;
  }
}
// src/features/export/export-to-pdf.js
// Downloads the quiz as a PDF file (.pdf)
// Deals with the export from both main page and results/summary page
// `jsPDF` library used, included in here `loadPdfLib`

import { showNotification } from "../../components/notifications.js";

// Question helpers
import {
  gradeEssay,
  isEssayQuestion,
  calculateQuizMetrics,
} from "../../shared/rate-answers.js";

const currentName = localStorage.getItem("username") || "User";

const loadPdfLib = () =>
  new Promise((resolve, reject) => {
    if (window.jspdf && window.jspdf.jsPDF) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src =
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("PDF library failed to load"));
    document.head.appendChild(s);
  });

// ── Markdown + KaTeX integration (mirrored from create-quiz) ──────────────────
// html2canvas is used to rasterize KaTeX-rendered HTML to PNG images that
// jsPDF's text-mode pipeline can embed.  Loaded lazily — only triggered when
// window.katex is present and the quiz actually contains math expressions.
const loadHtml2Canvas = () =>
  new Promise((resolve, reject) => {
    if (window.html2canvas) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src =
      "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("html2canvas failed to load"));
    document.head.appendChild(s);
  });

export async function exportToPdf(
  config,
  questions,
  userAnswers = [],
  result = {},
  onProgress = null, // optional (pct: 0–100) => void — called during render
) {
  try {
    try {
      await loadPdfLib();
    } catch {
      showNotification(
        "PDF library could not be loaded.",
        "Issue is From the website",
        "error",
      );
      alert("PDF library could not be loaded.");
      return;
    }

    if (!config || !questions || !Array.isArray(questions))
      throw new Error(
        "Invalid parameters: config and questions array required",
      );
    if (!window.jspdf || !window.jspdf.jsPDF)
      throw new Error("jsPDF library not loaded");

    // =========================================================
    // INIT
    // =========================================================
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });
    doc.setFont("helvetica");

    // =========================================================
    // COLORS
    // =========================================================
    const COLORS = Object.freeze({
      primary: [106, 90, 205],
      secondary: [255, 215, 0],
      success: [46, 213, 115],
      error: [255, 71, 87],
      warning: [255, 168, 1],
      info: [52, 172, 224],
      cardBg: [255, 255, 255],
      cardBorder: [106, 90, 205],
      pageBg: [248, 250, 252],
      textDark: [30, 41, 59],
      textLight: [100, 116, 139],
      textWhite: [255, 255, 255],
      btnCorrect: [16, 185, 129],
      btnWrong: [239, 68, 68],
      btnNeutral: [203, 213, 225],
      progressBg: [226, 232, 240],
      progressFill: [255, 215, 0],
      codeBg: [240, 242, 246],
      codeBorder: [180, 185, 200],
      codeText: [50, 60, 100],
      inlineCodeBg: [226, 230, 242],
    });

    // =========================================================
    // SIZES
    // =========================================================
    const SIZES = Object.freeze({
      headerH: 18,
      footerH: 12,
      progressBar: 6,
      cardPad: 8,
      cardMargin: 6,
      cardCorner: 3,
      cardShadow: 0.8,
      titleFont: 24,
      headingFont: 16,
      qFont: 11,
      optFont: 10,
      labelFont: 9,
      footerFont: 8,
      codeFont: 9,
      btnPad: 3,
      btnMinH: 10,
      btnRadius: 2,
      optGap: 4,
    });

    const MARGINS = Object.freeze({ top: 22, right: 12, bottom: 18, left: 12 });

    // =========================================================
    // LAYOUT CONSTANTS
    // =========================================================
    const LINE_H = 4.5; // mm per line of text
    const BASELINE_RATIO = 0.78; // baseline position within a line (fraction from top)
    const CODE_LINE_H = 5.0; // mm per code line  (9pt courier, ~1.4× leading)
    const CODE_LABEL_H = 7.0; // mm for "CODE" label area at top of block
    const CODE_OVERHEAD = CODE_LABEL_H + 3.5; // total vertical overhead in a code box
    const IC_PAD = 1.0; // inline-code horizontal padding per side (mm)
    const IC_GAP = 0.6; // gap after inline-code pill (mm)
    const CARD_TOP_OFF = SIZES.cardPad - 2; // 6mm — visual top inset inside card

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - MARGINS.left - MARGINS.right;

    const MAX_IMG_H = 50;
    const MAX_IMG_W = contentWidth - SIZES.cardPad * 2 - 6;

    // Card content area coordinates (used everywhere for consistency)
    const CC_X = MARGINS.left + SIZES.cardPad + 3; // 23 mm from left
    const CC_W = contentWidth - SIZES.cardPad * 2 - 6; // inner width

    let currentY = MARGINS.top;
    let currentLevel = 1;

    // =========================================================
    // UNICODE / ARABIC DETECTION
    // =========================================================
    const hasNonLatin = (t) => /[^\x00-\xFF]/.test(t);
    const hasArabic = (t) =>
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
        t,
      );

    // =========================================================
    // TEXT SANITIZATION  (Unicode-safe — strip only raw control chars)
    // =========================================================
    const sanitizeText = (text) => {
      if (text == null) return "";
      return String(text)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
    };

    // =========================================================
    // BARE LATEX AUTO-WRAPPER  (Markdown + KaTeX integration)
    //
    // Some quiz data stores LaTeX without $ delimiters, e.g.:
    //   "x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
    // This helper detects such lines and wraps them in $...$ so the
    // standard $...$ pipeline (parseInlineRuns / collectMathExpressions)
    // can render them.  Only fires when NO $ or ` already present on the line.
    // =========================================================
    const BARE_LATEX_CMD_RE =
      /\\(?:frac|sqrt|sum|int|prod|lim|pm|mp|cdot|times|div|leq|geq|neq|approx|equiv|infty|partial|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|sigma|phi|psi|omega|vec|hat|bar|tilde|dot|binom|mathbb|mathbf|mathrm|mathit)\b/;

    const wrapBareLaTeXLines = (text) => {
      if (!text || !BARE_LATEX_CMD_RE.test(text)) return text;
      return String(text).replace(/^(?![^\n]*[$`])([^\n]+)$/gm, (line) =>
        BARE_LATEX_CMD_RE.test(line) ? `$${line.trim()}$` : line,
      );
    };

    // =========================================================
    // CANVAS MEASUREMENT CACHE  (#7 — avoids creating thousands of canvases)
    // =========================================================
    // Use a lower pixel-ratio on mobile/low-end devices to reduce canvas memory
    // pressure (each 3× canvas uses 9× the RAM of a 1× canvas).
    const _isMobile =
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (typeof navigator.hardwareConcurrency === "number" &&
        navigator.hardwareConcurrency <= 4);
    const CANVAS_DPR = _isMobile ? 2 : 3;
    const mmToPx = (mm) => mm * 3.7795275591 * CANVAS_DPR;

    const _mxCache = new Map();
    const getMeasureCtx = (fontSizePt, bold = false) => {
      const key = `${fontSizePt}_${bold}`;
      if (!_mxCache.has(key)) {
        const cv = document.createElement("canvas");
        cv.width = 600;
        cv.height = 1;
        const ctx = cv.getContext("2d");
        const px = fontSizePt * 1.3333 * CANVAS_DPR;
        ctx.font = `${bold ? "bold " : ""}${px}px Inter, Cairo, Arial, sans-serif`;
        _mxCache.set(key, { ctx, pxSize: px });
      }
      return _mxCache.get(key);
    };

    // =========================================================
    // CANVAS WORD-WRAP  (for Arabic / Unicode paragraphs)
    // =========================================================
    const wrapTextCanvas = (text, maxWidthMm, fontSizePt, bold = false) => {
      const { ctx } = getMeasureCtx(fontSizePt, bold);
      const maxPx = mmToPx(maxWidthMm);
      const lines = [];
      for (const para of text.split("\n")) {
        if (!para.trim()) {
          lines.push("");
          continue;
        }
        const words = para.split(/\s+/);
        let cur = "";
        for (const w of words) {
          const test = cur ? `${cur} ${w}` : w;
          if (ctx.measureText(test).width > maxPx && cur) {
            lines.push(cur);
            cur = w;
          } else cur = test;
        }
        if (cur) lines.push(cur);
      }
      return lines;
    };

    // =========================================================
    // UNICODE CANVAS RENDERER
    // y = top of the image area. Returns height consumed (mm).
    //
    // PERF: A single canvas is reused across all calls instead of
    // creating one per text block.  jsPDF.addImage() processes the
    // dataURL synchronously (stores compressed bytes immediately), so
    // the canvas pixel-buffer is free to be overwritten right after.
    // =========================================================
    const _uniCanvas = document.createElement("canvas");
    const _uniCtx = _uniCanvas.getContext("2d");

    const renderUnicodeText = (
      text,
      x,
      y,
      maxWidthMm,
      color,
      fontSizePt,
      bold = false,
      rtl = false,
    ) => {
      if (!text) return 0;
      const lines = wrapTextCanvas(text, maxWidthMm, fontSizePt, bold);
      if (!lines.length) return 0;
      const { pxSize } = getMeasureCtx(fontSizePt, bold);
      const lineHpx = pxSize * 1.55;
      const widthPx = mmToPx(maxWidthMm);
      const heightPx = Math.ceil(lines.length * lineHpx + pxSize * 0.4);

      // Resize & clear the shared canvas (no new element allocation)
      _uniCanvas.width = widthPx;
      _uniCanvas.height = heightPx;
      _uniCtx.font = `${bold ? "bold " : ""}${pxSize}px Inter, Cairo, Arial, sans-serif`;
      _uniCtx.direction = rtl ? "rtl" : "ltr";
      _uniCtx.textAlign = rtl ? "right" : "left";
      _uniCtx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      lines.forEach((line, i) =>
        _uniCtx.fillText(
          line,
          rtl ? widthPx - 1 : 1,
          (i + 1) * lineHpx - pxSize * 0.15,
        ),
      );
      const heightMm = heightPx / (CANVAS_DPR * 3.7795275591);
      doc.addImage(
        _uniCanvas.toDataURL("image/png"),
        "PNG",
        x,
        y,
        maxWidthMm,
        heightMm,
      );
      return heightMm;
    };

    const measureUnicodeHeight = (
      text,
      maxWidthMm,
      fontSizePt,
      bold = false,
    ) => {
      if (!text) return 0;
      const lines = wrapTextCanvas(text, maxWidthMm, fontSizePt, bold);
      const { pxSize } = getMeasureCtx(fontSizePt, bold);
      return (
        Math.ceil(lines.length * pxSize * 1.55 + pxSize * 0.4) /
        (CANVAS_DPR * 3.7795275591)
      );
    };

    // =========================================================
    // KATEX → PNG RASTERISER  (Markdown + KaTeX integration)
    //
    // PRIMARY PATH — SVG <foreignObject>
    //   KaTeX renders its HTML into a hidden div; we measure the
    //   bounding box with getBoundingClientRect(), then embed the
    //   same HTML inside an SVG <foreignObject> blob.  The browser's
    //   native SVG engine rasterises it (no DOM traversal, no
    //   pixel-by-pixel canvas copy).  ~5–10× faster than html2canvas
    //   and uses a fraction of the peak memory.
    //
    //   Caveats: relies on KaTeX's page-level CSS being applied when
    //   the browser renders the blob URL Image.  Works reliably in
    //   Chrome/Edge/Safari.  Firefox requires a same-origin SVG URI.
    //
    // FALLBACK PATH — html2canvas
    //   Used automatically when the SVG path fails (e.g., Firefox
    //   sandbox restrictions, CSP, or unexpected render errors).
    //
    // Returns { dataUrl, widthMm, heightMm } or null on failure.
    // =========================================================
    const renderKatexToDataUrl = async (mathStr, displayMode) => {
      if (typeof window.katex === "undefined") return null;

      // 1. Render KaTeX HTML into a hidden measurement container
      const container = document.createElement("div");
      container.setAttribute("dir", "ltr");
      Object.assign(container.style, {
        position: "absolute",
        left: "-9999px",
        top: "0",
        background: "white",
        padding: displayMode ? "6px 10px" : "0 2px",
        fontSize: "16px",
        lineHeight: "1",
        color: "#1e293b",
        whiteSpace: "nowrap",
        direction: "ltr",
        unicodeBidi: "isolate",
        visibility: "hidden",
      });
      document.body.appendChild(container);

      try {
        window.katex.render(mathStr, container, {
          displayMode,
          throwOnError: false,
        });

        // 2. Measure the rendered element
        const rect = container.getBoundingClientRect();
        const rawW = Math.ceil(rect.width) || 60;
        const rawH = Math.ceil(rect.height) || 24;

        // 3. Collect KaTeX CSS rules needed for the SVG context
        //    (only the first time — result is cached on the function itself)
        if (!renderKatexToDataUrl._katexCss) {
          const sheets = Array.from(document.styleSheets);
          const katexRules = [];
          for (const sheet of sheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule.cssText && rule.cssText.includes(".katex")) {
                  katexRules.push(rule.cssText);
                }
              }
            } catch {
              /* cross-origin stylesheet — skip */
            }
          }
          renderKatexToDataUrl._katexCss = katexRules.join("\n");
        }

        const scaledW = rawW * CANVAS_DPR;
        const scaledH = rawH * CANVAS_DPR;

        // 4. Build an SVG that embeds the KaTeX HTML with inlined CSS
        const innerHtml = container.innerHTML;
        document.body.removeChild(container);

        const svgStr = [
          `<svg xmlns="http://www.w3.org/2000/svg"`,
          ` width="${scaledW}" height="${scaledH}">`,
          `<defs><style>`,
          `* { box-sizing: border-box; }`,
          renderKatexToDataUrl._katexCss,
          `</style></defs>`,
          `<foreignObject width="${scaledW}" height="${scaledH}">`,
          `<div xmlns="http://www.w3.org/1999/xhtml"`,
          ` style="font-size:${16 * CANVAS_DPR}px;line-height:1;`,
          `direction:ltr;unicode-bidi:isolate;`,
          `background:white;padding:${displayMode ? 6 * CANVAS_DPR : 0}px ${displayMode ? 10 * CANVAS_DPR : 2 * CANVAS_DPR}px;`,
          `color:#1e293b;white-space:nowrap;">`,
          innerHtml,
          `</div></foreignObject>`,
          `</svg>`,
        ].join("");

        // 5. Rasterise via Blob URL → Image → canvas
        const blob = new Blob([svgStr], {
          type: "image/svg+xml;charset=utf-8",
        });
        const blobUrl = URL.createObjectURL(blob);

        const dataUrl = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              const cv = document.createElement("canvas");
              cv.width = scaledW;
              cv.height = scaledH;
              const ctx2 = cv.getContext("2d");
              ctx2.fillStyle = "white";
              ctx2.fillRect(0, 0, scaledW, scaledH);
              ctx2.drawImage(img, 0, 0);

              // ── Security Catch ──────────────
              // If the SVG contains external fonts/links, browser may 'taint' 
              // the canvas, throwing a SecurityError on toDataURL().
              const url = cv.toDataURL("image/png");

              // Release pixel buffer immediately
              cv.width = 0;
              cv.height = 0;
              resolve(url);
            } catch (e) {
              reject(e);
            }
          };
          img.onerror = () => reject(new Error("SVG render failed"));
          img.src = blobUrl;
        }).finally(() => URL.revokeObjectURL(blobUrl));

        const PX_PER_MM = CANVAS_DPR * 3.7795275591;
        return {
          dataUrl,
          widthMm: rawW / 3.7795275591,
          heightMm: rawH / 3.7795275591,
        };
      } catch (svgErr) {
        // Remove container if still in DOM (SVG path failed before removeChild)
        if (document.body.contains(container))
          document.body.removeChild(container);

        // ── FALLBACK: html2canvas ──────────────────────────────────────
        // If SVG path fails, we use html2canvas to rasterise the DOM element.
        try {
          await loadHtml2Canvas();
        } catch (loadErr) {
          console.error("[PDF] Failed to load html2canvas fallback:", loadErr.message);
          return null;
        }

        if (!window.html2canvas) {
          console.warn(
            "[PDF] KaTeX SVG path failed, html2canvas not available:",
            mathStr,
            svgErr,
          );
          return null;
        }
        console.warn(
          "[PDF] KaTeX SVG path failed (likely Tainted Canvas), falling back to html2canvas:",
          svgErr.message,
        );

        const fb = document.createElement("div");
        fb.setAttribute("dir", "ltr");
        Object.assign(fb.style, {
          position: "absolute",
          left: "-9999px",
          top: "0",
          background: "white",
          padding: displayMode ? "6px 10px" : "0 2px",
          fontSize: "16px",
          lineHeight: "1",
          color: "#1e293b",
          whiteSpace: "nowrap",
          direction: "ltr",
          unicodeBidi: "isolate",
        });
        document.body.appendChild(fb);
        try {
          window.katex.render(mathStr, fb, {
            displayMode,
            throwOnError: false,
          });
          const canvas = await window.html2canvas(fb, {
            backgroundColor: null,
            scale: CANVAS_DPR,
            logging: false,
            useCORS: true,
          });
          document.body.removeChild(fb);
          const PX_PER_MM = CANVAS_DPR * 3.7795275591;
          const result = {
            dataUrl: canvas.toDataURL("image/png"),
            widthMm: canvas.width / PX_PER_MM,
            heightMm: canvas.height / PX_PER_MM,
          };
          // Release fallback canvas pixel-buffer
          canvas.width = 0;
          canvas.height = 0;
          return result;
        } catch (fbErr) {
          if (document.body.contains(fb)) document.body.removeChild(fb);
          console.warn(
            "[PDF] KaTeX fallback render also failed:",
            mathStr,
            fbErr,
          );
          return null;
        }
      }
    };

    // Collect every unique math expression in a text string.
    // Returns [{ key, expr, displayMode }] (no duplicates within the call).
    const collectMathExpressions = (text) => {
      if (!text) return [];
      const exprs = [];
      // ── Fix: normalize bare LaTeX lines before scanning for $ ──────────────
      // Without this, "x = \frac{...}" (no delimiters) would be missed entirely.
      const normalized = wrapBareLaTeXLines(String(text));
      // Strip block math first (avoids matching inner $ of $$...$$)
      let remaining = normalized.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => {
        exprs.push({
          key: `block:${m.trim()}`,
          expr: m.trim(),
          displayMode: true,
        });
        return " ";
      });
      // Inline math $...$
      const re = /\$([^\$\n]+)\$/g;
      let m;
      while ((m = re.exec(remaining)) !== null) {
        exprs.push({
          key: `inline:${m[1].trim()}`,
          expr: m[1].trim(),
          displayMode: false,
        });
      }
      return exprs;
    };

    // =========================================================
    // PDF STATE CACHE  (#7 — skip redundant set* calls)
    // =========================================================
    let _pfam = "",
      _psty = "",
      _psz = 0;
    let _tR = -1,
      _tG = -1,
      _tB = -1;
    let _fR = -1,
      _fG = -1,
      _fB = -1;

    const setPdfFont = (family, style, size) => {
      if (family !== _pfam || style !== _psty) {
        doc.setFont(family, style);
        _pfam = family;
        _psty = style;
      }
      if (size !== _psz) {
        doc.setFontSize(size);
        _psz = size;
      }
    };

    // const setPdfTextColor = (r, g, b) => {
    //   if (r !== _tR || g !== _tG || b !== _tB) {
    //     doc.setTextColor(r, g, b);
    //     _tR = r;
    //     _tG = g;
    //     _tB = b;
    //   }
    // };
    // const setPdfFillColor = (r, g, b) => {
    //   if (r !== _fR || g !== _fG || b !== _fB) {
    //     doc.setFillColor(r, g, b);
    //     _fR = r;
    //     _fG = g;
    //     _fB = b;
    //   }
    // };

    const setPdfTextColor = (r, g, b) => {
      if (r !== _tR || g !== _tG || b !== _tB) {
        doc.setTextColor(r, g, b);
        _tR = r;
        _tG = g;
        _tB = b;
        // Force the next setPdfFillColor to apply
        _fR = -1;
        _fG = -1;
        _fB = -1;
      }
    };

    const setPdfFillColor = (r, g, b) => {
      if (r !== _fR || g !== _fG || b !== _fB) {
        doc.setFillColor(r, g, b);
        _fR = r;
        _fG = g;
        _fB = b;
        // Force the next setPdfTextColor to apply
        _tR = -1;
        _tG = -1;
        _tB = -1;
      }
    };

    // ── Markdown + KaTeX integration (mirrored from create-quiz) ──
    // Maps heading levels h1–h6 to jsPDF point sizes.
    const getHeadingFontSize = (level) =>
      [20, 16, 13, 12, SIZES.qFont + 1, SIZES.qFont][
        Math.max(0, Math.min(5, level - 1))
      ];

    // ── Markdown + KaTeX integration ──────────────────────────────────────────
    // Declared here (before wrapInlineRuns / renderInlineLine / renderSegments /
    // calcSegmentsHeight, all of which reference it) so that the const is in scope
    // for every closure that reads from it.  The Map is populated later, after
    // imageCache pre-loading, by the MATH PRE-RENDERING block.
    const mathImageCache = new Map();

    // =========================================================
    // INLINE RUN PARSER  (Markdown + KaTeX integration)
    //
    // Parses a single line of text into typed InlineRun objects.
    // Run types: text | inline-code | math-inline |
    //            bold | italic | bold-italic | strikethrough | link
    // =========================================================
    const parseInlineRuns = (text) => {
      if (!text) return [{ type: "text", content: "" }];
      const stash = [];
      const stashPush = (run) => {
        const k = `\x01SR${stash.length}\x01`;
        stash.push(run);
        return k;
      };
      let s = String(text);
      // 1. Stash inline math $...$ (before bold/italic so $ isn't misread as *)
      s = s.replace(/\$([^\$\n]+)\$/g, (_, m) =>
        stashPush({ type: "math-inline", content: m.trim() }),
      );
      // 2. Stash inline code `...`
      s = s.replace(/`([^`\n]+)`/g, (_, m) =>
        stashPush({ type: "inline-code", content: m }),
      );
      // 3. Bold-italic ***...*** (must precede bold/italic)
      s = s.replace(/\*\*\*([^*]+)\*\*\*/g, (_, m) =>
        stashPush({ type: "bold-italic", content: m }),
      );
      // 4. Bold **...** or __...__
      s = s.replace(/\*\*([^*\n]+)\*\*/g, (_, m) =>
        stashPush({ type: "bold", content: m }),
      );
      s = s.replace(/__([^_\n]+)__/g, (_, m) =>
        stashPush({ type: "bold", content: m }),
      );
      // 5. Italic *...* or _..._
      s = s.replace(/\*([^*\n]+)\*/g, (_, m) =>
        stashPush({ type: "italic", content: m }),
      );
      s = s.replace(/_([^_\n]+)_/g, (_, m) =>
        stashPush({ type: "italic", content: m }),
      );
      // 6. Strikethrough ~~...~~
      s = s.replace(/~~([^~\n]+)~~/g, (_, m) =>
        stashPush({ type: "strikethrough", content: m }),
      );
      // 7. Links [text](url)
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (_, t, u) =>
        stashPush({ type: "link", content: t, href: u }),
      );
      // 8. Restore stash tokens
      const runs = [];
      for (const part of s.split(/(\x01SR\d+\x01)/)) {
        if (!part) continue;
        const m = part.match(/^\x01SR(\d+)\x01$/);
        if (m) runs.push(stash[parseInt(m[1])]);
        else runs.push({ type: "text", content: part });
      }
      return runs.length ? runs : [{ type: "text", content: "" }];
    };

    // =========================================================
    // INLINE RUN WORD-WRAP  (extended for new run types)
    //
    // Turns an array of InlineRun into display lines (array of arrays),
    // respecting maxWidthMm.  text runs are word-split; all other types
    // are treated as atomic tokens (no mid-token line break).
    // =========================================================
    const wrapInlineRuns = (runs, maxWidthMm, fontSizePt, bold = false) => {
      // Width measurement helpers
      const getW = (t, fStyle) => {
        setPdfFont(
          "helvetica",
          fStyle !== undefined ? fStyle : bold ? "bold" : "normal",
          fontSizePt,
        );
        return doc.getTextWidth(t);
      };
      const getCodeW = (t) => {
        setPdfFont("courier", "normal", fontSizePt);
        return doc.getTextWidth(t) + IC_PAD * 2 + IC_GAP;
      };

      // Tokenise all runs into atomic chunks (words / spaces / pills / images)
      const tokens = [];
      for (const run of runs) {
        if (run.type === "inline-code") {
          tokens.push({ ...run, w: getCodeW(run.content) });
        } else if (run.type === "math-inline") {
          // ── Markdown + KaTeX integration ──
          const cached = mathImageCache.get(`inline:${run.content}`);
          const w = cached ? cached.widthMm + 0.5 : getW(`$${run.content}$`);
          tokens.push({ ...run, w });
        } else if (run.type === "bold") {
          // ── Markdown + KaTeX integration ── (atomic styled run)
          tokens.push({ ...run, w: getW(run.content, "bold") });
        } else if (run.type === "bold-italic") {
          tokens.push({ ...run, w: getW(run.content, "bolditalic") });
        } else if (run.type === "italic") {
          tokens.push({ ...run, w: getW(run.content, "italic") });
        } else if (run.type === "strikethrough" || run.type === "link") {
          tokens.push({ ...run, w: getW(run.content) });
        } else {
          // "text" run — split by whitespace tokens for correct word-wrap
          for (const p of run.content.split(/(\s+)/)) {
            if (p) tokens.push({ type: "text", content: p, w: getW(p) });
          }
        }
      }

      const lines = [];
      let curLine = [],
        lineW = 0;

      const flushLine = () => {
        while (
          curLine.length &&
          /^\s+$/.test(curLine[curLine.length - 1].content)
        )
          curLine.pop();
        if (curLine.length) lines.push(curLine);
        curLine = [];
        lineW = 0;
      };

      for (const tok of tokens) {
        const isWS = tok.type === "text" && /^\s+$/.test(tok.content);
        if (isWS) {
          if (curLine.length) {
            const last = curLine[curLine.length - 1];
            if (last.type === "text") {
              last.content += tok.content;
              last.w += tok.w;
            } else curLine.push({ ...tok });
            lineW += tok.w;
          }
          continue;
        }
        if (curLine.length > 0 && lineW + tok.w > maxWidthMm) flushLine();
        if (
          tok.type === "text" &&
          curLine.length &&
          curLine[curLine.length - 1].type === "text"
        ) {
          curLine[curLine.length - 1].content += tok.content;
          curLine[curLine.length - 1].w += tok.w;
        } else {
          curLine.push({ ...tok });
        }
        lineW += tok.w;
      }
      flushLine();
      return lines.length > 0 ? lines : [[]];
    };

    // =========================================================
    // INLINE LINE RENDERER  (extended for Markdown + KaTeX)
    // baselineY = actual jsPDF baseline Y coordinate (NOT top-of-line).
    // Handles: inline-code pills, math-inline images, bold, italic,
    //          bold-italic, strikethrough, link, plain text.
    // =========================================================
    const renderInlineLine = (
      lineTokens,
      x,
      baselineY,
      color,
      fontSizePt,
      bold,
    ) => {
      let curX = x;
      for (const tok of lineTokens) {
        if (tok.type === "inline-code") {
          setPdfFont("courier", "normal", fontSizePt);
          const codeW = doc.getTextWidth(tok.content);
          // Cap height in mm ≈ font_pt × 0.352 × 0.85
          const capH = fontSizePt * 0.352 * 0.85;
          const bgH = capH + IC_PAD * 1.8;
          const bgY = baselineY - capH - IC_PAD * 0.4;
          setPdfFillColor(...COLORS.inlineCodeBg);
          doc.roundedRect(curX, bgY, codeW + IC_PAD * 2, bgH, 0.7, 0.7, "F");
          setPdfTextColor(...COLORS.codeText);
          doc.text(tok.content, curX + IC_PAD, baselineY);
          curX += codeW + IC_PAD * 2 + IC_GAP;
        } else if (tok.type === "math-inline") {
          // ── Markdown + KaTeX integration ──
          const cached = mathImageCache.get(`inline:${tok.content}`);
          if (cached) {
            // Align image so its baseline ≈ 80 % down from its top edge
            const imgY = baselineY - cached.heightMm * 0.8;
            doc.addImage(
              cached.dataUrl,
              "PNG",
              curX,
              imgY,
              cached.widthMm,
              cached.heightMm,
            );
            curX += cached.widthMm + 0.5;
          } else {
            // Fallback: raw LaTeX source in courier
            setPdfFont("courier", "normal", fontSizePt);
            setPdfTextColor(...COLORS.codeText);
            const fb = `$${tok.content}$`;
            doc.text(fb, curX, baselineY);
            curX += doc.getTextWidth(fb);
          }
        } else if (tok.type === "bold") {
          // ── Markdown + KaTeX integration ──
          setPdfFont("helvetica", "bold", fontSizePt);
          setPdfTextColor(...color);
          doc.text(tok.content, curX, baselineY);
          curX += doc.getTextWidth(tok.content);
        } else if (tok.type === "italic") {
          // ── Markdown + KaTeX integration ──
          setPdfFont("helvetica", "italic", fontSizePt);
          setPdfTextColor(...color);
          doc.text(tok.content, curX, baselineY);
          curX += doc.getTextWidth(tok.content);
        } else if (tok.type === "bold-italic") {
          // ── Markdown + KaTeX integration ──
          setPdfFont("helvetica", "bolditalic", fontSizePt);
          setPdfTextColor(...color);
          doc.text(tok.content, curX, baselineY);
          curX += doc.getTextWidth(tok.content);
        } else if (tok.type === "strikethrough") {
          // ── Markdown + KaTeX integration ──
          setPdfFont("helvetica", bold ? "bold" : "normal", fontSizePt);
          setPdfTextColor(...color);
          const tw = doc.getTextWidth(tok.content);
          doc.text(tok.content, curX, baselineY);
          // Strikethrough line at mid-cap height
          const strikeY = baselineY - fontSizePt * 0.352 * 0.5;
          doc.setDrawColor(...color);
          doc.setLineWidth(0.3);
          doc.line(curX, strikeY, curX + tw, strikeY);
          curX += tw;
        } else if (tok.type === "link") {
          // ── Markdown + KaTeX integration ──
          setPdfFont("helvetica", bold ? "bold" : "normal", fontSizePt);
          setPdfTextColor(...COLORS.info);
          const tw = doc.getTextWidth(tok.content);
          doc.text(tok.content, curX, baselineY);
          // Underline
          doc.setDrawColor(...COLORS.info);
          doc.setLineWidth(0.25);
          doc.line(curX, baselineY + 0.5, curX + tw, baselineY + 0.5);
          // Clickable annotation
          const capH = fontSizePt * 0.352 * 0.85;
          doc.link(curX, baselineY - capH, tw, capH + 1, { url: tok.href });
          curX += tw;
        } else {
          // "text" run (plain)
          setPdfFont("helvetica", bold ? "bold" : "normal", fontSizePt);
          setPdfTextColor(...color);
          doc.text(tok.content, curX, baselineY);
          curX += doc.getTextWidth(tok.content);
        }
      }
    };

    // =========================================================
    // MARKDOWN PARSER  (Markdown + KaTeX integration — mirrored from create-quiz)
    //
    // Returns Block[]  where Block is one of:
    //   { type: "code-block",        content: string                       }
    //   { type: "math-block",        content: string                       }
    //   { type: "heading",           level: 1–6, runs: InlineRun[]        }
    //   { type: "hr"                                                       }
    //   { type: "blockquote",        runs: InlineRun[]                    }
    //   { type: "list",              ordered: boolean, items: InlineRun[][] }
    //   { type: "inline-paragraph",  runs: InlineRun[]                    }
    //
    // InlineRun types: text | inline-code | math-inline |
    //                  bold | italic | bold-italic | strikethrough | link
    // =========================================================
    const parseMarkdown = (text) => {
      if (!text)
        return [
          { type: "inline-paragraph", runs: [{ type: "text", content: "" }] },
        ];

      const result = [];
      const codeBlocks = [];
      const mathBlocks = [];

      // ── Fix 0: Auto-wrap bare LaTeX lines ──────────────────────────────────
      // Normalize before stashing so $$ / fenced-code stashing in steps 1–2
      // sees the already-wrapped $...$ and handles them correctly.
      let processed = wrapBareLaTeXLines(String(text));

      // 1. Stash block math $$...$$ (multi-line safe)
      processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => {
        const idx = mathBlocks.length;
        mathBlocks.push(m.trim());
        return `\x00MB${idx}\x00`;
      });

      // 2. Stash fenced code blocks ```...```
      processed = processed.replace(
        /```(\w*)\n?([\s\S]*?)```/g,
        (_, _lang, code) => {
          const idx = codeBlocks.length;
          codeBlocks.push(code.trim());
          return `\x00CB${idx}\x00`;
        },
      );

      // Helper: restore any $$...$$ stash tokens back to $...$ inline math
      // so they are handled by parseInlineRuns in paragraph / heading context.
      const restoreMathAsInline = (s) =>
        s.replace(/\x00MB(\d+)\x00/g, (_, i) => `$${mathBlocks[+i]}$`);

      // 3. Line-by-line block parsing
      const rawLines = processed.split("\n");
      let listBuf = [];
      let listOrdered = false;

      const flushList = () => {
        if (listBuf.length) {
          result.push({ type: "list", ordered: listOrdered, items: listBuf });
          listBuf = [];
        }
      };

      for (const rawLine of rawLines) {
        // ── Block math stash on its own line ──────────────────────────
        const mbM = rawLine.trim().match(/^\x00MB(\d+)\x00$/);
        if (mbM) {
          flushList();
          result.push({ type: "math-block", content: mathBlocks[+mbM[1]] });
          continue;
        }

        // ── Code block stash on its own line ─────────────────────────
        const cbM = rawLine.trim().match(/^\x00CB(\d+)\x00$/);
        if (cbM) {
          flushList();
          result.push({ type: "code-block", content: codeBlocks[+cbM[1]] });
          continue;
        }

        // ── Horizontal rule ---  ***  ___ ────────────────────────────
        if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(rawLine)) {
          flushList();
          result.push({ type: "hr" });
          continue;
        }

        // ── Heading # … ###### ───────────────────────────────────────
        const hM = rawLine.match(/^(#{1,6})\s+(.+)$/);
        if (hM) {
          flushList();
          result.push({
            type: "heading",
            level: hM[1].length,
            runs: parseInlineRuns(restoreMathAsInline(hM[2])),
          });
          continue;
        }

        // ── Blockquote > text ─────────────────────────────────────────
        const bqM = rawLine.match(/^>\s*(.*)$/);
        if (bqM) {
          flushList();
          result.push({
            type: "blockquote",
            runs: parseInlineRuns(restoreMathAsInline(bqM[1])),
          });
          continue;
        }

        // ── Unordered list  - / * / + ─────────────────────────────────
        const ulM = rawLine.match(/^[-*+]\s+(.+)$/);
        if (ulM) {
          if (listBuf.length && listOrdered) flushList();
          listOrdered = false;
          listBuf.push(parseInlineRuns(restoreMathAsInline(ulM[1])));
          continue;
        }

        // ── Ordered list  1. ──────────────────────────────────────────
        const olM = rawLine.match(/^\d+\.\s+(.+)$/);
        if (olM) {
          if (listBuf.length && !listOrdered) flushList();
          listOrdered = true;
          listBuf.push(parseInlineRuns(restoreMathAsInline(olM[1])));
          continue;
        }

        // ── Empty line ────────────────────────────────────────────────
        if (!rawLine.trim()) {
          flushList();
          result.push({
            type: "inline-paragraph",
            runs: [{ type: "text", content: "" }],
          });
          continue;
        }

        // ── Regular paragraph line ────────────────────────────────────
        flushList();
        result.push({
          type: "inline-paragraph",
          runs: parseInlineRuns(restoreMathAsInline(rawLine)),
        });
      }

      flushList();

      return result.length
        ? result
        : [{ type: "inline-paragraph", runs: [{ type: "text", content: "" }] }];
    };

    /**
     * Prepend a plain-text string into the first inline-paragraph of a segments array.
     * Used to merge option prefix ("A. ") with option content for correct word-wrap.
     */
    const prependText = (prefix, segments) => {
      if (!segments.length)
        return [
          {
            type: "inline-paragraph",
            runs: [{ type: "text", content: prefix }],
          },
        ];
      const result = segments.map((s) => ({
        ...s,
        runs: s.runs ? [...s.runs] : undefined,
      }));
      const idx = result.findIndex((s) => s.type === "inline-paragraph");
      if (idx === -1) {
        result.unshift({
          type: "inline-paragraph",
          runs: [{ type: "text", content: prefix }],
        });
      } else {
        result[idx] = {
          ...result[idx],
          runs: [{ type: "text", content: prefix }, ...result[idx].runs],
        };
      }
      return result;
    };

    // =========================================================
    // HEIGHT MEASUREMENT  (must mirror renderSegments exactly)
    // Extended for: math-block, heading, hr, blockquote, list
    // =========================================================
    const calcSegmentsHeight = (
      segments,
      maxWidthMm,
      fontSizePt = SIZES.optFont,
      bold = false,
    ) => {
      let h = 0;
      for (const seg of segments) {
        if (seg.type === "code-block") {
          const codeLines = seg.content.split("\n");
          let blockLinesH = 0;
          for (const line of codeLines) {
            if (!line.trim()) {
              blockLinesH += CODE_LINE_H;
              continue;
            }
            if (hasNonLatin(line)) {
              blockLinesH += Math.max(
                CODE_LINE_H,
                measureUnicodeHeight(
                  line,
                  maxWidthMm - 6,
                  SIZES.codeFont,
                  false,
                ),
              );
            } else {
              setPdfFont("courier", "normal", SIZES.codeFont);
              const wrapped = doc.splitTextToSize(line, maxWidthMm - 6);
              blockLinesH += wrapped.length * CODE_LINE_H;
            }
          }
          h += blockLinesH + CODE_OVERHEAD + 2;
        } else if (seg.type === "math-block") {
          // ── Markdown + KaTeX integration ──
          const cached = mathImageCache.get(`block:${seg.content}`);
          h += cached ? cached.heightMm + 6 : LINE_H * 2;
        } else if (seg.type === "heading") {
          // ── Markdown + KaTeX integration ──
          const hFontSize = getHeadingFontSize(seg.level);
          const lineH = (hFontSize / SIZES.optFont) * LINE_H;
          const fullText = seg.runs.map((r) => r.content).join("");
          if (hasNonLatin(fullText)) {
            h +=
              measureUnicodeHeight(fullText, maxWidthMm, hFontSize, true) +
              (seg.level <= 2 ? 3 : 1);
          } else {
            h +=
              wrapInlineRuns(seg.runs, maxWidthMm, hFontSize, true).length *
                lineH +
              (seg.level <= 2 ? 3 : 1);
          }
        } else if (seg.type === "hr") {
          // ── Markdown + KaTeX integration ──
          h += LINE_H;
        } else if (seg.type === "blockquote") {
          // ── Markdown + KaTeX integration ──
          const indW = maxWidthMm - 5;
          const fullText = seg.runs.map((r) => r.content).join("");
          h += 4; // 2mm top + 2mm bottom padding
          if (hasNonLatin(fullText)) {
            h += measureUnicodeHeight(fullText, indW, fontSizePt, bold);
          } else {
            h +=
              wrapInlineRuns(seg.runs, indW, fontSizePt, bold).length * LINE_H;
          }
        } else if (seg.type === "list") {
          // ── Markdown + KaTeX integration ──
          const itemW = maxWidthMm - 5; // 5mm for bullet/number prefix
          for (const item of seg.items) {
            const fullText = item.map((r) => r.content).join("");
            if (hasNonLatin(fullText)) {
              h += measureUnicodeHeight(fullText, itemW, fontSizePt, bold) + 1;
            } else {
              h +=
                wrapInlineRuns(item, itemW, fontSizePt, bold).length * LINE_H +
                1;
            }
          }
          h += 2; // bottom gap after list
        } else {
          // inline-paragraph (existing behavior)
          const fullText = seg.runs.map((r) => r.content).join("");
          if (!fullText.trim()) {
            h += LINE_H * 0.5;
            continue;
          }
          if (hasNonLatin(fullText)) {
            h += measureUnicodeHeight(fullText, maxWidthMm, fontSizePt, bold);
          } else {
            h +=
              wrapInlineRuns(seg.runs, maxWidthMm, fontSizePt, bold).length *
              LINE_H;
          }
        }
      }
      return Math.max(h, LINE_H);
    };

    const calcMarkdownHeight = (
      text,
      maxWidthMm,
      fontSizePt = SIZES.optFont,
      bold = false,
    ) => {
      if (!text) return LINE_H;
      return calcSegmentsHeight(
        parseMarkdown(text),
        maxWidthMm,
        fontSizePt,
        bold,
      );
    };

    const calcTextHeight = (text, maxWidthMm, fontSizePt = SIZES.optFont) => {
      if (!text) return 0;
      if (hasNonLatin(text))
        return measureUnicodeHeight(text, maxWidthMm, fontSizePt);
      setPdfFont("helvetica", "normal", fontSizePt);
      return doc.splitTextToSize(text, maxWidthMm).length * LINE_H;
    };

    // =========================================================
    // CODE BLOCK RENDERER  (#5 — proper line heights, no overlap)
    // Returns height consumed (mm). y = top of block.
    // =========================================================
    const renderCodeBlock = (content, x, y, maxWidthMm) => {
      const codeLines = content.split("\n");

      let blockLinesH = 0;
      for (const line of codeLines) {
        if (!line.trim()) {
          blockLinesH += CODE_LINE_H;
          continue;
        }
        if (hasNonLatin(line)) {
          blockLinesH += Math.max(
            CODE_LINE_H,
            measureUnicodeHeight(line, maxWidthMm - 6, SIZES.codeFont, false),
          );
        } else {
          setPdfFont("courier", "normal", SIZES.codeFont);
          const wrapped = doc.splitTextToSize(line, maxWidthMm - 6);
          blockLinesH += wrapped.length * CODE_LINE_H;
        }
      }

      const boxH = blockLinesH + CODE_OVERHEAD;

      setPdfFillColor(...COLORS.codeBg);
      doc.roundedRect(x, y, maxWidthMm, boxH, 1.5, 1.5, "F");
      doc.setDrawColor(...COLORS.codeBorder);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, maxWidthMm, boxH, 1.5, 1.5, "S");

      // "CODE" label
      setPdfFont("helvetica", "bold", SIZES.labelFont - 1);
      setPdfTextColor(...COLORS.codeText);
      doc.text("CODE", x + 2.5, y + 4.5);

      // Separator
      doc.setDrawColor(...COLORS.codeBorder);
      doc.setLineWidth(0.15);
      doc.line(
        x + 1.5,
        y + CODE_LABEL_H - 0.5,
        x + maxWidthMm - 1.5,
        y + CODE_LABEL_H - 0.5,
      );

      // Lines of code
      setPdfFont("courier", "normal", SIZES.codeFont);
      setPdfTextColor(...COLORS.codeText);

      let curYOffset = CODE_LABEL_H;
      codeLines.forEach((line) => {
        if (!line.trim()) {
          curYOffset += CODE_LINE_H;
          return;
        }

        if (hasNonLatin(line)) {
          const usedH = renderUnicodeText(
            line,
            x + 3,
            y + curYOffset,
            maxWidthMm - 6,
            COLORS.codeText,
            SIZES.codeFont,
            false,
            false,
          );
          curYOffset += Math.max(CODE_LINE_H, usedH);
        } else {
          setPdfFont("courier", "normal", SIZES.codeFont);
          const wrappedLines = doc.splitTextToSize(line, maxWidthMm - 6);
          wrappedLines.forEach((wl) => {
            const baselineY = y + curYOffset + BASELINE_RATIO * CODE_LINE_H;
            doc.text(wl, x + 3, baselineY);
            curYOffset += CODE_LINE_H;
          });
        }
      });

      return boxH + 2; // +2 mm gap after block
    };

    // =========================================================
    // SEGMENT RENDERER  (extended for Markdown + KaTeX)
    // y = top of content area. Returns total height consumed (mm).
    // Handles: code-block, math-block, heading, hr, blockquote,
    //          list, inline-paragraph.
    // =========================================================
    const renderSegments = (
      segments,
      x,
      y,
      maxWidthMm,
      {
        color = COLORS.textDark,
        fontSizePt = SIZES.optFont,
        bold = false,
      } = {},
    ) => {
      let consumed = 0;
      for (const seg of segments) {
        if (seg.type === "code-block") {
          consumed += renderCodeBlock(seg.content, x, y + consumed, maxWidthMm);
        } else if (seg.type === "math-block") {
          // ── Markdown + KaTeX integration ──
          const cached = mathImageCache.get(`block:${seg.content}`);
          if (cached) {
            // Center image horizontally within the available width
            const imgX = x + Math.max(0, (maxWidthMm - cached.widthMm) / 2);
            doc.addImage(
              cached.dataUrl,
              "PNG",
              imgX,
              y + consumed + 2,
              cached.widthMm,
              cached.heightMm,
            );
            consumed += cached.heightMm + 6;
          } else {
            // Fallback: display raw LaTeX source in a code block
            consumed += renderCodeBlock(
              `$$${seg.content}$$`,
              x,
              y + consumed,
              maxWidthMm,
            );
          }
        } else if (seg.type === "heading") {
          // ── Markdown + KaTeX integration ──
          const hFontSize = getHeadingFontSize(seg.level);
          const lineH = (hFontSize / SIZES.optFont) * LINE_H;
          const fullText = seg.runs.map((r) => r.content).join("");
          if (hasNonLatin(fullText)) {
            consumed += renderUnicodeText(
              fullText,
              x,
              y + consumed,
              maxWidthMm,
              color,
              hFontSize,
              true,
              hasArabic(fullText),
            );
          } else {
            const wrapped = wrapInlineRuns(
              seg.runs,
              maxWidthMm,
              hFontSize,
              true,
            );
            for (const lineRuns of wrapped) {
              renderInlineLine(
                lineRuns,
                x,
                y + consumed + lineH * BASELINE_RATIO,
                color,
                hFontSize,
                true,
              );
              consumed += lineH;
            }
          }
          // Decorative underline for h1 and h2
          if (seg.level <= 2) {
            doc.setDrawColor(...COLORS.textLight);
            doc.setLineWidth(seg.level === 1 ? 0.5 : 0.25);
            doc.line(x, y + consumed, x + maxWidthMm, y + consumed);
            consumed += 2;
          } else {
            consumed += 1;
          }
        } else if (seg.type === "hr") {
          // ── Markdown + KaTeX integration ──
          const midY = y + consumed + LINE_H / 2;
          doc.setDrawColor(...COLORS.btnNeutral);
          doc.setLineWidth(0.4);
          doc.line(x, midY, x + maxWidthMm, midY);
          consumed += LINE_H;
        } else if (seg.type === "blockquote") {
          // ── Markdown + KaTeX integration ──
          const indX = x + 4; // 4mm horizontal indent
          const indW = maxWidthMm - 5;
          const fullText = seg.runs.map((r) => r.content).join("");
          const bqStart = consumed;
          consumed += 2; // top padding

          if (hasNonLatin(fullText)) {
            consumed += renderUnicodeText(
              fullText,
              indX,
              y + consumed,
              indW,
              COLORS.textLight,
              fontSizePt,
              false,
              hasArabic(fullText),
            );
          } else {
            const wrapped = wrapInlineRuns(seg.runs, indW, fontSizePt, false);
            for (const lineRuns of wrapped) {
              renderInlineLine(
                lineRuns,
                indX,
                y + consumed + LINE_H * BASELINE_RATIO,
                COLORS.textLight,
                fontSizePt,
                false,
              );
              consumed += LINE_H;
            }
          }
          consumed += 2; // bottom padding
          // ── Fix: call doc.setFillColor directly (bypass stale state cache) ──
          // renderInlineLine calls setPdfTextColor which resets _fR to -1, but
          // jsPDF's own fill state can still be stale in some code paths. Using
          // the raw doc method guarantees the accent bar is drawn in primary color.
          doc.setFillColor(...COLORS.primary);
          doc.rect(x, y + bqStart, 1.5, consumed - bqStart, "F");
          // Sync cache so subsequent setPdf* calls behave correctly
          _fR = COLORS.primary[0];
          _fG = COLORS.primary[1];
          _fB = COLORS.primary[2];
          _tR = -1;
          _tG = -1;
          _tB = -1;
        } else if (seg.type === "list") {
          // ── Markdown + KaTeX integration ──
          const prefW = 5; // mm reserved for bullet / number
          const itemX = x + prefW;
          const itemW = maxWidthMm - prefW;
          for (let li = 0; li < seg.items.length; li++) {
            const item = seg.items[li];
            const bullet = seg.ordered ? `${li + 1}.` : "-";
            const fullText = item.map((r) => r.content).join("");
            setPdfFont("helvetica", bold ? "bold" : "normal", fontSizePt);
            setPdfTextColor(...color);
            doc.text(bullet, x, y + consumed + LINE_H * BASELINE_RATIO);
            if (hasNonLatin(fullText)) {
              consumed +=
                renderUnicodeText(
                  fullText,
                  itemX,
                  y + consumed,
                  itemW,
                  color,
                  fontSizePt,
                  false,
                  hasArabic(fullText),
                ) + 1;
            } else {
              const wrapped = wrapInlineRuns(item, itemW, fontSizePt, false);
              for (const lineRuns of wrapped) {
                renderInlineLine(
                  lineRuns,
                  itemX,
                  y + consumed + LINE_H * BASELINE_RATIO,
                  color,
                  fontSizePt,
                  false,
                );
                consumed += LINE_H;
              }
              consumed += 1; // gap between items
            }
          }
          consumed += 2; // bottom gap after list
        } else {
          // inline-paragraph (existing behavior, unchanged)
          const fullText = seg.runs.map((r) => r.content).join("");
          if (!fullText.trim()) {
            consumed += LINE_H * 0.5;
            continue;
          }

          if (hasNonLatin(fullText)) {
            consumed += renderUnicodeText(
              fullText,
              x,
              y + consumed,
              maxWidthMm,
              color,
              fontSizePt,
              bold,
              hasArabic(fullText),
            );
          } else {
            const wrapped = wrapInlineRuns(
              seg.runs,
              maxWidthMm,
              fontSizePt,
              bold,
            );
            for (const lineRuns of wrapped) {
              renderInlineLine(
                lineRuns,
                x,
                y + consumed + LINE_H * BASELINE_RATIO,
                color,
                fontSizePt,
                bold,
              );
              consumed += LINE_H;
            }
          }
        }
      }
      return consumed;
    };

    // Convenience wrapper: parse + render
    const renderMarkdownBlock = (text, x, y, maxWidthMm, opts = {}) => {
      if (!text) return 0;
      return renderSegments(parseMarkdown(text), x, y, maxWidthMm, opts);
    };

    // Plain text renderer — y = top of content area
    const renderText = (
      text,
      x,
      y,
      maxWidthMm,
      {
        color = COLORS.textDark,
        fontSizePt = SIZES.optFont,
        bold = false,
      } = {},
    ) => {
      if (!text) return 0;
      if (hasNonLatin(text))
        return renderUnicodeText(
          text,
          x,
          y,
          maxWidthMm,
          color,
          fontSizePt,
          bold,
          hasArabic(text),
        );
      setPdfFont("helvetica", bold ? "bold" : "normal", fontSizePt);
      setPdfTextColor(...color);
      const lines = doc.splitTextToSize(text, maxWidthMm);
      const baselineY = y + LINE_H * BASELINE_RATIO;
      lines.forEach((l, i) => doc.text(l, x, baselineY + i * LINE_H));
      return lines.length * LINE_H;
    };

    // =========================================================
    // IMAGE UTILITIES
    // =========================================================
    const getDataUrl = (url) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = img.width;
          cv.height = img.height;
          cv.getContext("2d").drawImage(img, 0, 0);
          res(cv.toDataURL("image/png"));
        };
        img.onerror = () => rej(new Error("Failed to load image"));
        img.src = url;
      });

    const svgToDataUrl = (svgStr) =>
      new Promise((res, rej) => {
        const img = new Image();
        const url = URL.createObjectURL(
          new Blob([svgStr], { type: "image/svg+xml" }),
        );
        img.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = img.width || 800;
          cv.height = img.height || 600;
          cv.getContext("2d").drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          res(cv.toDataURL("image/png"));
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          rej(new Error("SVG conversion failed"));
        };
        img.src = url;
      });

    const constrainDims = (w, h, mw, mh) => {
      const ar = w / h;
      let nw = mw,
        nh = nw / ar;
      if (nh > mh) {
        nh = mh;
        nw = nh * ar;
      }
      return { width: nw, height: nh };
    };

    const processImage = async (src) => {
      try {
        let data = src;
        const svg = src.includes("<svg") || src.includes("data:image/svg+xml");
        if (svg) {
          data = src.startsWith("data:image/svg+xml")
            ? await svgToDataUrl(decodeURIComponent(src.split(",")[1]))
            : await svgToDataUrl(src);
        } else if (!src.startsWith("data:")) {
          data = await getDataUrl(src);
        }
        const img = new Image();
        await new Promise((r, j) => {
          img.onload = r;
          img.onerror = j;
          img.src = data;
        });
        const { width, height } = constrainDims(
          img.width,
          img.height,
          MAX_IMG_W * 3.78,
          MAX_IMG_H * 3.78,
        );
        return {
          data,
          width: width / 3.78,
          height: height / 3.78,
          success: true,
        };
      } catch {
        return { success: false };
      }
    };

    // =========================================================
    // DECORATIVE HELPERS
    // =========================================================
    const drawBackgroundPattern = () => {
      setPdfFillColor(...COLORS.pageBg);
      doc.rect(0, 0, pageWidth, pageHeight, "F");
      // Diagonal lines (#7: 18mm spacing, was 12mm)
      doc.setDrawColor(220, 220, 230);
      doc.setLineWidth(0.15);
      for (let i = -pageHeight; i < pageWidth + pageHeight; i += 18)
        doc.line(i, 0, i + pageHeight, pageHeight);
      // Dots (#7: 22mm spacing, was 15mm)
      setPdfFillColor(215, 215, 225);
      for (let dx = 10; dx < pageWidth; dx += 22)
        for (let dy = 10; dy < pageHeight; dy += 22)
          doc.circle(dx, dy, 0.3, "F");
      // Corners
      setPdfFillColor(230, 230, 240);
      doc.triangle(0, 0, 15, 0, 0, 15, "F");
      doc.triangle(pageWidth, 0, pageWidth - 15, 0, pageWidth, 15, "F");
      doc.triangle(0, pageHeight, 15, pageHeight, 0, pageHeight - 15, "F");
      doc.triangle(
        pageWidth,
        pageHeight,
        pageWidth - 15,
        pageHeight,
        pageWidth,
        pageHeight - 15,
        "F",
      );
    };

    const drawCard = (x, y, w, h) => {
      setPdfFillColor(200, 200, 210);
      doc.roundedRect(
        x + SIZES.cardShadow,
        y + SIZES.cardShadow,
        w,
        h,
        SIZES.cardCorner,
        SIZES.cardCorner,
        "F",
      );
      setPdfFillColor(...COLORS.cardBg);
      doc.roundedRect(x, y, w, h, SIZES.cardCorner, SIZES.cardCorner, "F");
      doc.setDrawColor(...COLORS.cardBorder);
      doc.setLineWidth(0.4);
      doc.roundedRect(x, y, w, h, SIZES.cardCorner, SIZES.cardCorner, "S");
    };

    const drawButton = (x, y, w, h, isCorrect, isWrong) => {
      const bg = isCorrect
        ? COLORS.btnCorrect
        : isWrong
          ? COLORS.btnWrong
          : COLORS.btnNeutral;
      const tc = isCorrect || isWrong ? COLORS.textWhite : COLORS.textDark;
      setPdfFillColor(180, 180, 190);
      doc.roundedRect(
        x + 0.4,
        y + 0.4,
        w,
        h,
        SIZES.btnRadius,
        SIZES.btnRadius,
        "F",
      );
      setPdfFillColor(...bg);
      doc.roundedRect(x, y, w, h, SIZES.btnRadius, SIZES.btnRadius, "F");
      doc.setDrawColor(...bg);
      doc.setLineWidth(0.6);
      doc.roundedRect(x, y, w, h, SIZES.btnRadius, SIZES.btnRadius, "S");
      return tc;
    };

    const drawProgressBar = (x, y, w, h, pct) => {
      setPdfFillColor(...COLORS.progressBg);
      doc.roundedRect(x, y, w, h, 1.5, 1.5, "F");
      const fw = (w * pct) / 100;
      if (fw > 0) {
        setPdfFillColor(...COLORS.progressFill);
        doc.roundedRect(x, y, fw, h, 1.5, 1.5, "F");
      }
      doc.setDrawColor(...COLORS.primary);
      doc.setLineWidth(0.25);
      doc.roundedRect(x, y, w, h, 1.5, 1.5, "S");
    };

    const getQuestionStatus = (question, userAns, isEssay) => {
      if (isEssay) return { statusText: "ESSAY" };
      if (userAns === undefined || userAns === null)
        return { statusText: "SKIPPED" };
      return userAns === question.correct
        ? { statusText: "CORRECT" }
        : { statusText: "WRONG" };
    };

    // =========================================================
    // HEADER / FOOTER
    // =========================================================
    const addGameHeader = () => {
      drawBackgroundPattern();
      setPdfFillColor(...COLORS.primary);
      doc.rect(0, 0, pageWidth, SIZES.headerH, "F");
      doc.setDrawColor(...COLORS.secondary);
      doc.setLineWidth(1.5);
      doc.line(0, SIZES.headerH - 1, pageWidth, SIZES.headerH - 1);

      const title = sanitizeText(config.title || "Quiz Quest");
      if (hasNonLatin(title)) {
        renderUnicodeText(
          title,
          MARGINS.left,
          4,
          contentWidth * 0.65,
          COLORS.textWhite,
          SIZES.headingFont,
          true,
          hasArabic(title),
        );
      } else {
        setPdfFont("helvetica", "bold", SIZES.headingFont);
        setPdfTextColor(...COLORS.textWhite);
        doc.text(title, MARGINS.left, 11);
      }

      const name = sanitizeText(currentName);
      if (hasNonLatin(name)) {
        renderUnicodeText(
          name,
          pageWidth - MARGINS.right - contentWidth * 0.3,
          4,
          contentWidth * 0.3,
          COLORS.textWhite,
          12,
          true,
          hasArabic(name),
        );
      } else {
        setPdfFont("helvetica", "bold", 12);
        setPdfTextColor(...COLORS.textWhite);
        doc.text(name, pageWidth - MARGINS.right - doc.getTextWidth(name), 11);
      }
      currentY = SIZES.headerH + 6;
    };

    // #8: Arabic watermark
    const WATERMARK_W = 52;
    const WATERMARK_TEXT = "منصة إمتحانات بصمجي";

    const addGameFooter = (isLastPage = false) => {
      const fy = pageHeight - SIZES.footerH;
      setPdfFillColor(240, 242, 245);
      doc.rect(0, fy - 2, pageWidth, SIZES.footerH + 2, "F");
      doc.setDrawColor(...COLORS.secondary);
      doc.setLineWidth(0.8);
      doc.line(0, fy - 2, pageWidth, fy - 2);

      setPdfFont("helvetica", "bold", SIZES.footerFont);
      setPdfTextColor(...COLORS.primary);
      doc.text(`Page ${currentLevel}`, MARGINS.left, fy + 4);

      // Arabic watermark via canvas (#8)
      renderUnicodeText(
        WATERMARK_TEXT,
        pageWidth - MARGINS.right - WATERMARK_W,
        fy - 1,
        WATERMARK_W,
        COLORS.textLight,
        SIZES.footerFont,
        false,
        true,
      );

      if (!isLastPage) {
        const dotY = fy + 3.5,
          dotSp = 3.5,
          nDots = 5;
        const startX = pageWidth / 2 - (nDots * dotSp) / 2;
        for (let i = 0; i < nDots; i++) {
          setPdfFillColor(
            ...(i < currentLevel ? COLORS.primary : COLORS.progressBg),
          );
          doc.circle(startX + i * dotSp, dotY, 0.7, "F");
        }
      }
    };

    // =========================================================
    // SCORE CALCULATION + PAGE
    // =========================================================
    const calculateScore = () => {
      let correct = 0,
        wrong = 0,
        skipped = 0,
        essayCount = 0,
        essayScoreTotal = 0,
        essayMaxTotal = 0,
        mcqTotal = 0;
      questions.forEach((q, i) => {
        if (isEssayQuestion(q)) {
          essayCount++;
          essayScoreTotal += gradeEssay(userAnswers[i], q.answer);
          essayMaxTotal += 5;
          return;
        }
        mcqTotal++;
        const a = userAnswers[i];
        if (a === undefined || a === null) skipped++;
        else if (a === (q.correct ?? q.answer)) correct++;
        else wrong++;
      });
      const totalPoints = correct + essayScoreTotal;
      const maxPoints = mcqTotal + essayMaxTotal;
      const pct =
        maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;
      return {
        correct,
        wrong,
        skipped,
        essayCount,
        essayScoreTotal,
        essayMaxTotal,
        mcqTotal,
        totalPoints,
        maxPoints,
        percentage: pct,
        isPassing: pct >= 70,
      };
    };

    const scoreData = calculateScore();

    const isResultsMode =
      userAnswers &&
      (Array.isArray(userAnswers)
        ? userAnswers.length > 0
        : Object.keys(userAnswers).length > 0);

    const renderScorePage = () => {
      // ── Gather extra result metadata (safe fallbacks) ──────────────
      const timeElapsed = result.timeElapsed ?? 0;
      const points = result.gamification?.pointsEarned ?? 0;
      const newBadges = result.gamification?.newBadges ?? [];
      const timeStr = `${Math.floor(timeElapsed / 60)}m ${timeElapsed % 60}s`;

      // ── Dynamically compute card height ───────────────────────────
      // Traced from actual rendering geometry:
      // cardY+5 → title banner(12) → currentY = cardY+27
      // circle center at cardY+40, radius=18 → currentY = cardY+64
      // motivational text ≈ 10mm → cardY+74
      // total score (7mm) → cardY+81
      // conditional rows added below
      // time (3gap + 8) = 11mm, bottom room = 8mm → base ends at cardY+100
      let cardH = 100; // base: title + circle + motive + score + time + bottom
      if (scoreData.mcqTotal > 0) cardH += 11; // MCQ pills: 7mm + 4mm gap
      if (scoreData.essayCount > 0) cardH += 13; // Essay row: 9mm + 4mm gap
      if (points > 0) cardH += 11; // Points pill: 7mm + 4mm gap
      if (newBadges.length > 0) cardH += 7 + newBadges.length * 8; // Badges

      addGameHeader();
      const cardY = currentY;
      drawCard(MARGINS.left, cardY, contentWidth, cardH);

      // ── Title banner ──────────────────────────────────────────────
      currentY = cardY + 5;
      setPdfFillColor(...COLORS.primary);
      doc.roundedRect(
        MARGINS.left + 12,
        currentY,
        contentWidth - 24,
        12,
        2,
        2,
        "F",
      );
      setPdfFont("helvetica", "bold", SIZES.titleFont);
      setPdfTextColor(...COLORS.textWhite);
      doc.text("QUIZ COMPLETE!", pageWidth / 2, currentY + 9, {
        align: "center",
      });
      currentY += 22;

      // ── Percentage circle ─────────────────────────────────────────
      const circleY = currentY + 13,
        radius = 18;
      setPdfFillColor(...COLORS.secondary);
      doc.circle(pageWidth / 2, circleY, radius + 1.5, "F");
      setPdfFillColor(
        ...(scoreData.isPassing ? COLORS.success : COLORS.warning),
      );
      doc.circle(pageWidth / 2, circleY, radius, "F");
      setPdfFont("helvetica", "bold", 22);
      setPdfTextColor(...COLORS.textWhite);
      doc.text(`${scoreData.percentage}%`, pageWidth / 2, circleY + 2, {
        align: "center",
      });
      currentY = circleY + radius + 6;

      // ── Motivational line ─────────────────────────────────────────
      // Note: render WITHOUT rtl=true so the canvas image left-anchors and
      // can be properly centered. Arabic letters still render correctly on
      // canvas without explicit RTL direction (browser handles bidi).
      const isArabicName = hasArabic(currentName);
      const motiveText = scoreData.isPassing
        ? isArabicName
          ? `احسنت يا ${currentName}!`
          : `LEGENDARY, ${currentName}!`
        : isArabicName
          ? `استمر في المذاكرة يا ${currentName}`
          : `KEEP GRINDING, ${currentName}!`;
      if (hasNonLatin(motiveText)) {
        // Measure actual text width so we can create a tight canvas and
        // centre it on the page. This avoids left-shift from an oversized box.
        const { ctx: mCtx, pxSize: mPx } = getMeasureCtx(13, true);
        const textPxW = mCtx.measureText(motiveText).width;
        const motiveW = Math.min(
          textPxW / (CANVAS_DPR * 3.7795275591) + 2, // tight fit + 2mm pad
          contentWidth * 0.9, // safety cap
        );
        const motiveX = pageWidth / 2 - motiveW / 2;
        const mh = renderUnicodeText(
          motiveText,
          motiveX,
          currentY,
          motiveW,
          COLORS.primary,
          13,
          true,
          false,
        );
        currentY += mh + 4;
      } else {
        setPdfFont("helvetica", "bold", 14);
        setPdfTextColor(...COLORS.primary);
        doc.text(motiveText, pageWidth / 2, currentY + 5, { align: "center" });
        currentY += 10;
      }

      // ── Total score line ──────────────────────────────────────────
      setPdfFont("helvetica", "bold", SIZES.qFont);
      setPdfTextColor(...COLORS.textDark);
      doc.text(
        `Total Score: ${scoreData.totalPoints} / ${scoreData.maxPoints}`,
        pageWidth / 2,
        currentY,
        { align: "center" },
      );
      currentY += 7;

      // ── MCQ breakdown (only if MCQ questions exist) ───────────────
      if (scoreData.mcqTotal > 0) {
        const bx = MARGINS.left + 6;
        const bw = (contentWidth - 12) / 3;
        const pillH = 7;
        const midY = currentY + pillH / 2; // vertical text centre

        setPdfFont("helvetica", "bold", SIZES.labelFont);

        // Correct pill
        setPdfFillColor(...COLORS.btnCorrect);
        doc.roundedRect(bx, currentY, bw - 2, pillH, 1.5, 1.5, "F");
        setPdfTextColor(...COLORS.textWhite);
        doc.text(`Correct ${scoreData.correct}`, bx + (bw - 2) / 2, midY, {
          align: "center",
          baseline: "middle",
        });

        // Wrong pill
        setPdfFillColor(...COLORS.btnWrong);
        doc.roundedRect(bx + bw, currentY, bw - 2, pillH, 1.5, 1.5, "F");
        setPdfTextColor(...COLORS.textWhite);
        doc.text(`Wrong ${scoreData.wrong}`, bx + bw + (bw - 2) / 2, midY, {
          align: "center",
          baseline: "middle",
        });

        // Skipped pill
        setPdfFillColor(...COLORS.progressBg);
        doc.roundedRect(bx + bw * 2, currentY, bw - 2, pillH, 1.5, 1.5, "F");
        setPdfTextColor(...COLORS.textLight);
        doc.text(
          `Skipped ${scoreData.skipped}`,
          bx + bw * 2 + (bw - 2) / 2,
          midY,
          { align: "center", baseline: "middle" },
        );

        currentY += pillH + 4;
      }

      // ── Essay row (only if essay questions exist) ─────────────────
      if (scoreData.essayCount > 0) {
        const avgStars = Math.round(
          scoreData.essayScoreTotal / scoreData.essayCount,
        );
        const stars = "\u2605".repeat(avgStars) + "\u2606".repeat(5 - avgStars);
        const essayLabel = `Essay: ${scoreData.essayScoreTotal} / ${scoreData.essayMaxTotal}`;
        const rowH = 9;
        const rowY = currentY;

        // Row background
        setPdfFillColor(240, 253, 244);
        doc.roundedRect(
          MARGINS.left + 6,
          rowY,
          contentWidth - 12,
          rowH,
          1.5,
          1.5,
          "F",
        );
        doc.setDrawColor(...COLORS.success);
        doc.setLineWidth(0.3);
        doc.roundedRect(
          MARGINS.left + 6,
          rowY,
          contentWidth - 12,
          rowH,
          1.5,
          1.5,
          "S",
        );

        // Essay label (left-aligned)
        setPdfFont("helvetica", "bold", SIZES.labelFont);
        setPdfTextColor(...COLORS.success);
        doc.text(essayLabel, MARGINS.left + 10, rowY + rowH / 2 - 0.5, {
          baseline: "middle",
        });

        // Stars centred in the right half of the row via canvas
        const starsW = 28; // fixed width for 5 star glyphs
        const starsX = pageWidth / 2 - starsW / 2;
        renderUnicodeText(
          stars,
          starsX,
          rowY + 0.5,
          starsW,
          COLORS.warning,
          SIZES.optFont + 2,
          false,
          false,
        );
        currentY += rowH + 4;
      }

      // ── Time line ─────────────────────────────────────────────────
      currentY += 3; // breathing room above time
      setPdfFont("helvetica", "normal", SIZES.optFont);
      setPdfTextColor(...COLORS.textLight);
      doc.text(`Time: ${timeStr}`, pageWidth / 2, currentY + 2, {
        align: "center",
      });
      currentY += 8;

      // ── Points pill (only if non-zero) ───────────────────────────
      if (points > 0) {
        const pillW = 38,
          pillH = 7;
        const pillX = pageWidth / 2 - pillW / 2;
        setPdfFillColor(...COLORS.secondary);
        doc.roundedRect(pillX, currentY - 1, pillW, pillH, 3, 3, "F");
        setPdfFont("helvetica", "bold", SIZES.labelFont);
        setPdfTextColor(...COLORS.textDark);
        doc.text(`+ ${points} Points`, pageWidth / 2, currentY + 3.5, {
          align: "center",
        });
        currentY += 9;
      }

      // ── Badges section (only if any earned) ───────────────────────
      if (newBadges.length > 0) {
        setPdfFont("helvetica", "bold", SIZES.labelFont);
        setPdfTextColor(...COLORS.primary);
        doc.text("Badges Earned:", MARGINS.left + 6, currentY + 1);
        currentY += 5;
        for (const badge of newBadges) {
          const badgeText = `${badge.icon}  ${badge.title}`;
          renderUnicodeText(
            badgeText,
            MARGINS.left + 8,
            currentY,
            contentWidth - 16,
            COLORS.primary,
            SIZES.optFont,
            false,
            false,
          );
          currentY += 7;
        }
      }

      // ── Progress bar (below card) ─────────────────────────────────
      currentY = cardY + cardH + 8;
      drawProgressBar(
        MARGINS.left + 18,
        currentY,
        contentWidth - 36,
        SIZES.progressBar,
        scoreData.percentage,
      );
      currentY += SIZES.progressBar + 3;

      setPdfFont("helvetica", "normal", SIZES.labelFont);
      setPdfTextColor(...COLORS.textLight);
      doc.text(`${scoreData.percentage}% Complete`, pageWidth / 2, currentY, {
        align: "center",
      });
      currentY += 10;

      doc.setDrawColor(...COLORS.primary);
      doc.setLineWidth(1.2);
      doc.line(
        MARGINS.left + 25,
        currentY,
        pageWidth - MARGINS.right - 25,
        currentY,
      );
      currentY += 8;
    };

    if (isResultsMode) renderScorePage();
    else addGameHeader();

    // =========================================================
    // SECTION-BASED QUESTION RENDERING  (#1 #2 #6)
    //
    // Each Section = { height: mm, render: (topY) => void }
    // Heights are measured first; render closures are pure / stateless.
    // =========================================================

    /**
     * Build an ordered array of Section objects for one question.
     * All heights pre-computed; closures capture what they need.
     */
    const measureQuestionSections = (question, qIndex, userAns, imageInfo) => {
      const sections = [];
      const isEssay = isEssayQuestion(question);
      const qText = sanitizeText(question.q);
      const BW = CC_W; // box / button width
      const IW = BW - 3; // inner text width (small left inset)

      const { statusText } = getQuestionStatus(question, userAns, isEssay);

      // ── Section 1: Header strip ───────────────────────────────────
      sections.push({
        height: 15, // 8mm strip + 7mm gap
        render: (y) => {
          setPdfFillColor(...COLORS.primary);
          doc.roundedRect(
            MARGINS.left + SIZES.cardPad,
            y,
            contentWidth - SIZES.cardPad * 2,
            8,
            2,
            2,
            "F",
          );
          setPdfFont("helvetica", "bold", SIZES.qFont);
          setPdfTextColor(...COLORS.textWhite);
          doc.text(
            `Question #${qIndex + 1}`,
            MARGINS.left + SIZES.cardPad + 2.5,
            y + 5.5,
          );
          if (isResultsMode) {
            setPdfFont("helvetica", "normal", SIZES.optFont);
            doc.text(
              statusText,
              pageWidth - MARGINS.right - SIZES.cardPad - 2.5,
              y + 5.5,
              { align: "right" },
            );
          }
        },
      });

      // ── Section 2: Image (if present) ────────────────────────────
      if (imageInfo && imageInfo.success) {
        const { width: iW, height: iH } = imageInfo;
        sections.push({
          height: iH + 5,
          render: (y) => {
            try {
              doc.addImage(
                imageInfo.data,
                "PNG",
                CC_X + (CC_W - iW) / 2,
                y,
                iW,
                iH,
              );
            } catch (e) {
              console.error("addImage failed", e);
            }
          },
        });
      }

      // ── Section 3: Question text ──────────────────────────────────
      const qSegs = parseMarkdown(qText);
      const qContentH = calcSegmentsHeight(qSegs, BW, SIZES.qFont);
      sections.push({
        height: qContentH + 5,
        render: (y) => {
          renderSegments(qSegs, CC_X, y, BW, {
            color: COLORS.textDark,
            fontSizePt: SIZES.qFont,
          });
        },
      });

      // ── Section 4a: MCQ options ───────────────────────────────────
      if (!isEssay) {
        question.options.forEach((opt, optIndex) => {
          const isUserAns = optIndex === userAns;
          const isCorrectAns = optIndex === question.correct;
          const rawOpt = sanitizeText(opt);
          const letter = String.fromCharCode(65 + optIndex);
          const marker = isCorrectAns ? "> " : isUserAns ? "X " : "";
          const prefix = `${marker}${letter}. `;
          const isLast = optIndex === question.options.length - 1;

          // Merge prefix + option for unified word-wrap (#2 alignment fix)
          const optSegs = prependText(prefix, parseMarkdown(rawOpt));
          const optTextH = calcSegmentsHeight(
            optSegs,
            BW - SIZES.btnPad * 2,
            SIZES.optFont,
            isCorrectAns,
          );
          const btnH = Math.max(optTextH + SIZES.btnPad * 2, SIZES.btnMinH);
          const sectionH = btnH + SIZES.optGap + (isLast ? 3 : 0);

          // Capture loop variables for closure
          const _segs = optSegs;
          const _btnH = btnH;
          const _corr = isCorrectAns;
          const _user = isUserAns;

          sections.push({
            height: sectionH,
            render: (y) => {
              const tc = drawButton(CC_X, y, BW, _btnH, _corr, _user && !_corr);
              renderSegments(
                _segs,
                CC_X + SIZES.btnPad,
                y + SIZES.btnPad,
                BW - SIZES.btnPad * 2,
                { color: tc, fontSizePt: SIZES.optFont, bold: _corr },
              );
            },
          });
        });
      }

      // ── Section 4b: Essay sections ────────────────────────────────
      if (isEssay) {
        const formalText = sanitizeText(question.answer);

        // Score badge (results mode + answered)
        if (isResultsMode && userAns && String(userAns).trim()) {
          const score = gradeEssay(userAns, question.answer);
          const stars = "★".repeat(score) + "☆".repeat(5 - score);
          const label = `Score: ${score} / 5`;
          const badgeC =
            score >= 3
              ? COLORS.success
              : score > 0
                ? COLORS.warning
                : COLORS.error;
          const _score = score,
            _stars = stars,
            _label = label,
            _badgeC = badgeC;

          sections.push({
            height: 13, // 10mm badge + 3mm gap
            render: (y) => {
              setPdfFillColor(..._badgeC);
              doc.roundedRect(CC_X, y, BW, 10, 1.5, 1.5, "F");
              setPdfFont("helvetica", "bold", SIZES.optFont);
              setPdfTextColor(...COLORS.textWhite);
              doc.text(_label, CC_X + 2, y + 5, { baseline: "middle" });
              renderUnicodeText(
                _stars,
                CC_X + 30,
                y + 0.5,
                BW - 32,
                COLORS.textWhite,
                SIZES.optFont + 1,
                false,
                false,
              );
            },
          });
        }

        // User answer box (results mode)
        if (isResultsMode) {
          const userText = sanitizeText(userAns || "لم تُجِب");
          const uContentH = calcTextHeight(userText, IW, SIZES.optFont);
          const uBoxH = Math.max(uContentH + 10, 16);
          const _uText = userText,
            _uBoxH = uBoxH;

          sections.push({
            height: uBoxH + 2,
            render: (y) => {
              setPdfFillColor(245, 247, 250);
              doc.roundedRect(CC_X, y, BW, _uBoxH, 1.5, 1.5, "F");
              setPdfFont("helvetica", "bold", SIZES.labelFont);
              setPdfTextColor(...COLORS.primary);
              doc.text("YOUR ANSWER:", CC_X + 1.5, y + 4);
              renderText(_uText, CC_X + 1.5, y + 7, IW, {
                color: COLORS.textDark,
                fontSizePt: SIZES.optFont,
              });
            },
          });
        }

        // Formal / correct answer box
        const fSegs = parseMarkdown(formalText);
        const fContentH = calcSegmentsHeight(fSegs, IW, SIZES.optFont);
        const fBoxH = Math.max(fContentH + 10, 16);
        const _fSegs = fSegs,
          _fBoxH = fBoxH;

        sections.push({
          height: fBoxH + 3,
          render: (y) => {
            setPdfFillColor(240, 253, 244);
            doc.roundedRect(CC_X, y, BW, _fBoxH, 1.5, 1.5, "F");
            setPdfFont("helvetica", "bold", SIZES.labelFont);
            setPdfTextColor(...COLORS.success);
            doc.text("CORRECT ANSWER:", CC_X + 1.5, y + 4);
            renderSegments(_fSegs, CC_X + 1.5, y + 7, IW, {
              color: COLORS.textDark,
              fontSizePt: SIZES.optFont,
            });
          },
        });
      }

      // ── Section 5: Explanation ────────────────────────────────────
      if (question.explanation) {
        const expText = sanitizeText(question.explanation);
        const eSegs = parseMarkdown(expText);
        const eContentH = calcSegmentsHeight(eSegs, IW, SIZES.optFont);
        const eBoxH = Math.max(eContentH + 9, 14);
        const _eSegs = eSegs,
          _eBoxH = eBoxH;

        sections.push({
          height: eBoxH + 3,
          render: (y) => {
            setPdfFillColor(255, 251, 235);
            doc.roundedRect(CC_X, y, BW, _eBoxH, 1.5, 1.5, "F");
            doc.setDrawColor(...COLORS.warning);
            doc.setLineWidth(0.4);
            doc.roundedRect(CC_X, y, BW, _eBoxH, 1.5, 1.5, "S");
            setPdfFont("helvetica", "bold", SIZES.labelFont);
            setPdfTextColor(...COLORS.warning);
            doc.text("EXPLANATION:", CC_X + 1.5, y + 4);
            renderSegments(_eSegs, CC_X + 1.5, y + 7, IW, {
              color: COLORS.textDark,
              fontSizePt: SIZES.optFont,
            });
          },
        });
      }

      return sections;
    };

    /**
     * Group sections into per-page arrays.
     * startY: initial Y on the current page.
     * Returns Section[][] (one inner array per page).
     */
    const groupSectionsIntoPages = (sections, startY) => {
      // Reserve card margin so the card + margin fits before footer
      const maxY =
        pageHeight - MARGINS.bottom - SIZES.footerH - SIZES.cardMargin;
      const freshY = MARGINS.top + SIZES.headerH + 6;

      const groups = [];
      let curY = startY,
        group = [];

      for (const sec of sections) {
        if (group.length > 0 && curY + sec.height > maxY) {
          groups.push(group);
          group = [];
          curY = freshY;
        }
        group.push(sec);
        curY += sec.height;
      }
      if (group.length > 0) groups.push(group);
      return groups;
    };

    /**
     * Render one question. Handles any length via section-based multi-page flow.
     */
    const renderQuestion = async (question, qIndex) => {
      const userAns = userAnswers[qIndex];
      const imageInfo = imageCache.get(qIndex) ?? null;
      const sections = measureQuestionSections(
        question,
        qIndex,
        userAns,
        imageInfo,
      );

      // If very little space remains, start fresh page before grouping
      const MIN_USEFUL = 42; // mm
      const pageBottom = pageHeight - MARGINS.bottom - SIZES.footerH;
      if (pageBottom - currentY < MIN_USEFUL) {
        addGameFooter();
        doc.addPage();
        currentLevel++;
        addGameHeader();
      }

      const pageGroups = groupSectionsIntoPages(sections, currentY);

      for (let gi = 0; gi < pageGroups.length; gi++) {
        if (gi > 0) {
          addGameFooter();
          doc.addPage();
          currentLevel++;
          addGameHeader();
        }

        const group = pageGroups[gi];
        const groupH = group.reduce((s, sec) => s + sec.height, 0);
        const cardH = groupH + SIZES.cardPad * 2;
        const cardY = currentY;

        drawCard(MARGINS.left, cardY, contentWidth, cardH);

        let secY = cardY + CARD_TOP_OFF;
        for (const sec of group) {
          sec.render(secY);
          secY += sec.height;
        }

        currentY = cardY + cardH + SIZES.cardMargin;
      }
    };

    // =========================================================
    // PARALLEL IMAGE PRE-LOADING  (#7 — no sequential awaits)
    // =========================================================
    const imageCache = new Map();
    await Promise.all(
      questions.map(async (q, i) => {
        if (q.image) {
          const info = await processImage(q.image);
          if (info.success) imageCache.set(i, info);
        }
      }),
    );

    // =========================================================
    // MATH PRE-RENDERING  (Markdown + KaTeX integration)
    //
    // Render all LaTeX expressions to PNG images BEFORE the main
    // layout pass so that calcSegmentsHeight() has correct dims.
    //
    // PERF: Instead of Promise.all (all at once → simultaneous large
    // canvases → OOM on mobile), we use a concurrency-limited queue
    // so at most KATEX_CONCURRENCY renders are in-flight at once.
    // The SVG path (primary) is much lighter than html2canvas, so
    // KATEX_CONCURRENCY=6 is fine on desktop; reduce to 3 on mobile.
    // =========================================================
    if (typeof window.katex !== "undefined") {
      try {
        // Only load html2canvas if the SVG path is unavailable/unsupported.
        // We attempt the SVG path first; html2canvas becomes the fallback
        // inside renderKatexToDataUrl itself.  We still try to load it
        // lazily so it is available if needed without blocking startup.
        loadHtml2Canvas().catch(() => {
          /* non-fatal — html2canvas fallback simply won't be available */
        });

        const uniqueMath = new Map();
        const mathTextFields = (q) =>
          [q.q, q.explanation, q.answer, ...(q.options || [])].filter(Boolean);
        for (const q of questions) {
          for (const t of mathTextFields(q)) {
            for (const e of collectMathExpressions(sanitizeText(t))) {
              if (!uniqueMath.has(e.key)) uniqueMath.set(e.key, e);
            }
          }
        }

        // Concurrency-limited render queue
        const KATEX_CONCURRENCY = _isMobile ? 3 : 6;
        const mathQueue = [...uniqueMath.values()];
        for (let qi = 0; qi < mathQueue.length; qi += KATEX_CONCURRENCY) {
          const batch = mathQueue.slice(qi, qi + KATEX_CONCURRENCY);
          await Promise.all(
            batch.map(async ({ key, expr, displayMode }) => {
              const res = await renderKatexToDataUrl(expr, displayMode);
              if (res) mathImageCache.set(key, res);
            }),
          );
          // Yield to UI thread between batches on mobile
          if (_isMobile && qi + KATEX_CONCURRENCY < mathQueue.length) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        if (mathImageCache.size > 0)
          console.log(
            `[PDF] Pre-rendered ${mathImageCache.size} math expression(s)`,
          );
      } catch (err) {
        console.warn("[PDF] Math pre-rendering skipped:", err.message);
      }
    }

    // =========================================================
    // RENDER ALL QUESTIONS  — chunked for UI responsiveness
    //
    // The jsPDF draw calls are synchronous CPU work.  On a 50-question
    // quiz they block the main thread for hundreds of milliseconds,
    // freezing scroll / animations and triggering ANR dialogs on mobile.
    //
    // Fix: after every RENDER_CHUNK questions we `await setTimeout(0)`
    // to hand control back to the browser event loop.  This keeps the
    // tab responsive and lets a progress bar update between chunks.
    //
    // RENDER_CHUNK = 5 is a balance between throughput and latency;
    // use 3 on mobile where each question involves more canvas work.
    // =========================================================
    const RENDER_CHUNK = _isMobile ? 3 : 5;
    const totalQ = questions.length;

    for (let qi = 0; qi < totalQ; qi++) {
      await renderQuestion(questions[qi], qi);

      const isChunkEnd = (qi + 1) % RENDER_CHUNK === 0;
      const isLast = qi === totalQ - 1;

      if (isChunkEnd || isLast) {
        // Report progress (0–90 % reserved for question rendering;
        // the final 10 % covers CTA page + save).
        const pct = Math.round(((qi + 1) / totalQ) * 90);
        if (typeof onProgress === "function") onProgress(pct);

        // Yield to the browser event loop so it can process paint /
        // input events and avoid "page unresponsive" warnings.
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // ── Free cached image data (no longer needed after rendering) ──────
    // dataUrl strings can be several hundred KB each.  Clearing the
    // caches here lets the GC reclaim that memory before jsPDF compresses
    // and serialises the PDF (another memory-intensive operation).
    mathImageCache.clear();
    imageCache.clear();

    // =========================================================
    // FINAL CTA PAGE
    // =========================================================
    const renderCTAPage = () => {
      addGameFooter();
      doc.addPage();
      currentLevel++;
      addGameHeader();

      const cardH = 55,
        cardY = currentY + 18;
      drawCard(MARGINS.left + 8, cardY, contentWidth - 16, cardH);
      currentY = cardY + 12;

      setPdfFont("helvetica", "bold", 32);
      setPdfTextColor(...COLORS.primary);
      doc.text("End", pageWidth / 2, currentY, { align: "center" });
      currentY += 14;

      setPdfFont("helvetica", "bold", 20);
      doc.text("READY FOR MORE?", pageWidth / 2, currentY, { align: "center" });
      currentY += 8;

      setPdfFont("helvetica", "normal", SIZES.qFont);
      setPdfTextColor(...COLORS.textLight);
      doc.text(
        "Continue your journey with more challenges!",
        pageWidth / 2,
        currentY,
        { align: "center" },
      );
      currentY += 10;

      const bX = MARGINS.left + 25,
        bY = currentY,
        bW = contentWidth - 50;
      setPdfFillColor(...COLORS.primary);
      doc.roundedRect(bX, bY, bW, 12, 2.5, 2.5, "F");
      setPdfFont("helvetica", "bold", SIZES.qFont);
      setPdfTextColor(...COLORS.textWhite);
      doc.text("PLAY MORE QUIZZES", pageWidth / 2, bY + 7.5, {
        align: "center",
      });
      currentY += 25;

      setPdfFont("helvetica", "bold", 18);
      setPdfTextColor(...COLORS.info);
      doc.text("https://basmagi-quiz.vercel.app/", pageWidth / 2, currentY, {
        align: "center",
      });

      addGameFooter(true);
    };

    renderCTAPage();

    // =========================================================
    // SAVE
    // =========================================================
    if (typeof onProgress === "function") onProgress(100);

    // Release the shared Unicode canvas pixel-buffer and the
    // measurement canvas cache so the GC can reclaim RAM before
    // the browser writes the PDF blob to disk.
    _uniCanvas.width = 0;
    _uniCanvas.height = 0;
    _mxCache.clear();

    const filename = `${sanitizeText(config.title || "quiz")}.pdf`;
    doc.save(filename);
    console.log(`PDF exported: ${filename}`);
    showNotification(
      "PDF file downloaded.",
      "You have it now",
      "./assets/images/PDF_Icon.png",
    );
    return { success: true, filename };
  } catch (error) {
    console.error("PDF Export Error:", error);
    alert(`Failed to export PDF: ${error.message}`);
    showNotification("Failed to export PDF", `${error.message}`, "error");
    return { success: false, error: error.message };
  }
}

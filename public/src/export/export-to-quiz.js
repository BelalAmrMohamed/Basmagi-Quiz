// src/scripts/export-to-quiz.js
// Downloads the quiz as a standalone file (.html)
// Deals with the export from the main page, create-quiz page, and results page
// No libraries used.

import { showNotification } from "../components/notifications.js";

// Question helpers
import { gradeEssay, calculateQuizMetrics, isAnswerCorrect } from "../shared/rate-answers.js";

import {
  renderMarkdown,
  _renderMarkdownCore,
  scanDirections,
  detectDirection,
  applyInline,
  escHtml,
  highlightCode,
  _processElement,
  _processByLine,
  _applyDirectionClass,
  _HL_KEYWORDS,
  _HL_BUILTINS_JS,
  _SKIP_TAGS,
  _LTR_ONLY_SELECTOR,
  _BLOCK_CHILD_SELECTOR,
  _LABEL_PREFIX_REGEX,
  _FIRST_STRONG_CHAR_REGEX,
  _ARABIC_REGEX,
} from "../shared/markdown.js";

import { MARKDOWN_CSS } from "../shared/markdown-css.js";

// ── Quiz Info Dialog helpers (ported from result.js) ──────────────────────
// Resolves a category label from a stored quiz path when config.category
// isn't set directly. Mirrors the canonical Faculty/Year/Term/Subject path
// structure used elsewhere in the app.
const extractCategoryFromPath = (path) => {
  if (!path) return "";

  let rawPath = path;

  try {
    const qIdx = rawPath.indexOf("?");
    if (qIdx !== -1) {
      const params = new URLSearchParams(rawPath.slice(qIdx + 1));
      const p = params.get("path");
      if (p) rawPath = decodeURIComponent(p);
    }
  } catch (_) {
    // ignore malformed query strings
  }

  const match = rawPath.match(/quizzes\/[^/]+\/[^/]+\/[^/]+\/(.+)/);
  if (match) {
    const segments = match[1].split("/");
    const parts = segments.slice(0, -1);
    if (parts.length > 0) return parts.join(" / ");
  }

  return "";
};

// Builds the <tr> rows for the quiz-info dialog at export time (the dialog
// content is static once downloaded, so this runs once here rather than
// being re-derived client-side). Field set and Arabic labels match the
// quiz-info dialog used on the results page exactly.
const buildQuizInfoRows = (config, questionCount) => {
  const formatDate = (raw) => {
    if (!raw) return null;
    let d = String(raw);
    if (d.includes(",")) d = d.split(",")[0];
    else if (d.includes(" - ")) d = d.split(" - ")[0];
    else if (d.includes(" ")) d = d.split(" ")[0];
    return d || null;
  };

  const ROWS = [
    { label: "ID", val: config.id },
    { label: "العنوان", val: config.title },
    { label: "الوصف", val: config.description },
    { label: "المادة", val: config.category || extractCategoryFromPath(config.path) || null },
    { label: "التاريخ", val: formatDate(config.createdAt) },
    { label: "المصدر", val: config.source },
    { label: "صاحب الإمتحان", val: config.author },
    { label: "نوع الإمتحان الإجباري", val: config.mode },
    {
      label: "الشكل الإجباري",
      val:
        config.view === "pagination"
          ? "كل سؤال في صفحة (Pagination)"
          : config.view === "vertical"
            ? "كل الأسئلة في صفحة واحدة (Vertical)"
            : null,
    },
    { label: "نوع الأسئلة", val: config.questionTypes },
    { label: "عدد الأسئلة", val: questionCount },
  ].filter((r) => r.val);

  if (!ROWS.length) {
    return `<tr><td colspan="2" style="padding:12px 8px;opacity:0.6;">لا توجد معلومات إضافية</td></tr>`;
  }

  const isUrl = (s) => /^https?:\/\//i.test(s);

  return ROWS.map(({ label, val }) => {
    const v = String(val);
    const displayVal = isUrl(v)
      ? `<a href="${escHtml(v)}" target="_blank" rel="noopener noreferrer">${escHtml(v)}</a>`
      : escHtml(v);
    return `<tr>
        <th scope="row">${escHtml(label)}</th>
        <td>${displayVal}</td>
      </tr>`;
  }).join("");
};

// highlightCode (imported above) is serialized into the export via
// .toString(), same as renderMarkdown/escHtml/etc — but it also reads two
// module-level constants from markdown.js (_HL_KEYWORDS, _HL_BUILTINS_JS)
// by bare reference. Those aren't functions, so .toString() can't capture
// them, and they contain Set objects, so JSON.stringify can't either.
// Rebuild them as JS source text here so the exported script actually
// defines what highlightCode expects to find in scope.
const serializeHlKeywords = (hlKeywords) => {
  const entries = Object.entries(hlKeywords).map(([lang, set]) => {
    const items = set
      ? Array.from(set).map((w) => JSON.stringify(w)).join(", ")
      : "";
    return `  ${JSON.stringify(lang)}: new Set([${items}])`;
  });
  return `{\n${entries.join(",\n")}\n}`;
};

const serializeHlBuiltinsJs = (set) =>
  `new Set([${Array.from(set).map((w) => JSON.stringify(w)).join(", ")}])`;

export async function exportToQuiz(config, questions) {
  const processedQuestions = await convertImagesToBase64(questions);
  const quizInfoRowsHtml = buildQuizInfoRows(config, questions.length);

  const quizHTML = `<!DOCTYPE html>
  <html lang="ar" dir="rtl">
  <head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escHtml(config.description || "Interactive quiz platform")}">
  <title>${escHtml(config.title || "Practice Quiz")}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg width='512' height='512' viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3CradialGradient id='bulbG' cx='36%25' cy='28%25' r='68%25'%3E%3Cstop offset='0%25' stop-color='%23FFFDE7'/%3E%3Cstop offset='22%25' stop-color='%23FFF59D'/%3E%3Cstop offset='58%25' stop-color='%23FFEB3B'/%3E%3Cstop offset='100%25' stop-color='%23FBC02D'/%3E%3C/radialGradient%3E%3ClinearGradient id='sA' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0%25' stop-color='%23F0F0F0'/%3E%3Cstop offset='100%25' stop-color='%23BDBDBD'/%3E%3C/linearGradient%3E%3ClinearGradient id='sB' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0%25' stop-color='%23DEDEDE'/%3E%3Cstop offset='100%25' stop-color='%239E9E9E'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='256' cy='242' r='180' fill='%23FFEB3B' opacity='0.15'/%3E%3Ccircle cx='256' cy='242' r='130' fill='%23FFEB3B' opacity='0.25'/%3E%3Cline x1='256' y1='140' x2='256' y2='104' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='326' y1='172' x2='351' y2='147' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='358' y1='242' x2='394' y2='242' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='326' y1='312' x2='351' y2='337' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='186' y1='312' x2='161' y2='337' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='154' y1='242' x2='118' y2='242' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='186' y1='172' x2='161' y2='147' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cpath d='M 164,285 A 94,94 0 1,1 348,285 Q 345,342 312,350 L 200,350 Q 167,342 164,285 Z' fill='url(%23bulbG)'/%3E%3Cellipse cx='214' cy='192' rx='18' ry='37' fill='white' opacity='0.38' transform='rotate(-22,214,192)'/%3E%3Cellipse cx='206' cy='183' rx='8' ry='15' fill='white' opacity='0.55' transform='rotate(-22,206,183)'/%3E%3Ctext x='256' y='270' text-anchor='middle' dominant-baseline='central' font-family='Georgia, serif' font-size='114' font-weight='700' fill='%231A237E'%3E?%3C/text%3E%3Crect x='198' y='350' width='116' height='15' rx='3' fill='url(%23sA)'/%3E%3Crect x='205' y='365' width='102' height='13' rx='3' fill='url(%23sB)'/%3E%3Crect x='213' y='378' width='86' height='13' rx='3' fill='url(%23sA)'/%3E%3Crect x='224' y='391' width='64' height='13' rx='7' fill='url(%23sB)'/%3E%3C/svg%3E">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <!-- ========== Markdown + KaTeX integration ==========
       Classic (non-deferred) script so window.katex is synchronously
       available before the inline quiz <script> at the bottom of <body> runs.
       No SRI hashes. Pinned to 0.16.9 exactly — do NOT add defer/async. -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>

  <script type="module">
        const ICON_CHECK = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>\`;

        window.copyCodeBlock = (btn) => {
          const wrapper = btn.closest(".code-block-wrapper");
          if (!wrapper) return;
          const codeEl = wrapper.querySelector("code");
          if (!codeEl) return;

          navigator.clipboard
            .writeText(codeEl.innerText)
            .then(() => {
              const original = btn.innerHTML;
              btn.innerHTML = ICON_CHECK;
              btn.classList.add("copied");
              btn.setAttribute("aria-label", "Copied!");
              setTimeout(() => {
                btn.innerHTML = original;
                btn.classList.remove("copied");
                btn.setAttribute("aria-label", "Copy code");
              }, 2000);
            })
            .catch(() => {
              // Fallback: select the text so the user can Ctrl+C manually
              const range = document.createRange();
              range.selectNodeContents(codeEl);
              const sel = window.getSelection();
              if (sel) {
                sel.removeAllRanges();
                sel.addRange(range);
              }
            });
        };
  </script>

  <style>
  *, *::before, *::after {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html {
    scroll-behavior: smooth;
    scrollbar-width: thin;
    scrollbar-color: #6b6ed3 transparent;
  }

  html::-webkit-scrollbar {
    width: 8px;
  }

  html::-webkit-scrollbar-track {
    background: transparent;
  }

  html::-webkit-scrollbar-thumb {
    background-color: #6b6ed3;
    border-radius: 10px;
  }

  /* Accessibility */
  *:focus-visible {
    outline: 3px solid rgba(99, 102, 241, 0.45);
    outline-offset: 3px;
    border-radius: 8px;
  }

  ::selection {
    background: rgba(99, 102, 241, 0.12);
    color: #6366f1;
  }

  /* ── Design Tokens ───────────────────────────────────────────── */
  :root {
    color-scheme: light;

    /* Backgrounds */
    --bg-primary:    #ffffff;
    --bg-secondary:  #f8fafc;
    --bg-tertiary:   #e8edf3;

    /* Text */
    --text-primary:   #1a202c;
    --text-secondary: #4a5568;
    --text-muted:     #718096;

    /* Borders & Cards */
    --border-color:  #e2e8f0;
    --card-bg:       #f8fafc;
    --card-answered: #eef2ff;

    /* Brand */
    --gradient-start:     #667eea;
    --gradient-end:       #764ba2;
    --gradient:           linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-end) 100%);
    --gradient-body:      var(--gradient);
    --gradient-body-dark: linear-gradient(135deg, #1a1b3e 0%, #2d1654 100%);

    /* Typography */
    --font-mono: "SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace;

    /* Semantic — light */
    --success:      #10b981;
    --success-bg:   #ecfdf5;
    --success-text: #065f46;

    --error:        #ef4444;
    --error-bg:     #fef2f2;
    --error-text:   #991b1b;

    --warning:      #f59e0b;
    --warning-bg:   #fffbeb;
    --warning-text: #92400e;

    --info:         #3b82f6;
    --info-bg:      #eff6ff;
    --info-text:    #1e40af;

    /* Shadows */
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 16px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05);
    --shadow-lg: 0 20px 60px rgba(0,0,0,0.14);

    /* Radius scale */
    --radius-xs: 4px;
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;
    --radius-xl: 20px;

    /* Transitions */
    --t-fast: 0.15s ease;
    --t-base: 0.25s ease;
    --t-slow: 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  }

  [data-theme="dark"] {
    color-scheme: dark;

    --bg-primary:    #0f172a;
    --bg-secondary:  #1e293b;
    --bg-tertiary:   #334155;
    --text-primary:  #f1f5f9;
    --text-secondary:#cbd5e1;
    --text-muted:    #94a3b8;
    --border-color:  #334155;
    --card-bg:       #1e293b;
    --card-answered: #1e2d4a;

    --success-bg:   #022c22;
    --success-text: #6ee7b7;
    --error-bg:     #2d0a0a;
    --error-text:   #fca5a5;
    --warning-bg:   #1c1007;
    --warning-text: #fcd34d;
    --info-bg:      #0c1e3f;
    --info-text:    #93c5fd;

    --shadow-sm: 0 1px 3px rgba(0,0,0,0.25);
    --shadow-md: 0 4px 16px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.2);
    --shadow-lg: 0 20px 60px rgba(0,0,0,0.5);
  }

  /* ── Base ────────────────────────────────────────────────────── */
  [data-theme="dark"] body { background: var(--gradient-body-dark) center / cover fixed; }

  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
    background: var(--gradient-body) center / cover fixed;
    min-height: 100vh;
    padding: 24px 16px;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  input, button, textarea, select {
    font-family: inherit;
    accent-color: var(--gradient-start);
  }

  /* Brand text selection */
  ::selection {
    background: rgba(102, 126, 234, 0.22);
    color: inherit;
  }

  /* ── Skip Link ───────────────────────────────────────────────── */
  .skip-link {
    position: absolute;
    top: -48px;
    left: 0;
    background: var(--gradient-start);
    color: #fff;
    padding: 8px 18px;
    text-decoration: none;
    border-radius: 0 0 var(--radius-sm) 0;
    z-index: 2000;
    font-size: 14px;
    font-weight: 600;
    transition: top var(--t-fast);
  }

  .skip-link:focus {
    top: 0;
  }

  /* ── Menu Toggle ─────────────────────────────────────────────── */
  .menu-toggle {
    position: fixed;
    top: 18px;
    right: 18px;
    z-index: 1001;
    width: 48px;
    height: 48px;
    background: var(--gradient);
    border: none;
    border-radius: var(--radius-lg);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    box-shadow: 0 4px 16px rgba(102, 126, 234, 0.45);
    transition: transform var(--t-base), box-shadow var(--t-base);
  }

  .menu-toggle:hover {
    transform: scale(1.06);
    box-shadow: 0 6px 22px rgba(102, 126, 234, 0.6);
  }

  .menu-toggle:focus-visible {
    outline: 3px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
  }

  .menu-toggle span {
    display: block;
    width: 22px;
    height: 2.5px;
    background: #fff;
    border-radius: 2px;
    transition: transform var(--t-base), opacity var(--t-base);
  }

  .menu-toggle.active span:nth-child(1) {
    transform: rotate(45deg) translate(5.5px, 5.5px);
  }

  .menu-toggle.active span:nth-child(2) {
    opacity: 0;
    transform: scaleX(0);
  }

  .menu-toggle.active span:nth-child(3) {
    transform: rotate(-45deg) translate(5.5px, -5.5px);
  }

  /* ── Side Menu ───────────────────────────────────────────────── */
  .side-menu {
    position: fixed;
    top: 0;
    right: -324px;
    width: 320px;
    height: 100vh;
    background: var(--bg-primary);
    box-shadow: -8px 0 48px rgba(0, 0, 0, 0.2);
    z-index: 1000;
    transition: right var(--t-slow), visibility var(--t-slow);
    visibility: hidden;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
  }

  .side-menu.open {
    right: 0;
    visibility: visible;
  }

  .side-menu-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    z-index: 999;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--t-base);
  }

  .side-menu-overlay.show {
    opacity: 1;
    pointer-events: auto;
  }

  .side-menu-header {
    text-align: center;
    background: var(--gradient);
    color: #fff;
    padding: 28px 22px 22px;
    flex-shrink: 0;
  }

  .side-menu-header h2 {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 3px;
    letter-spacing: -0.2px;
  }

  .side-menu-header p {
    font-size: 13px;
    opacity: 0.82;
  }

  .side-menu-content {
    flex: 1;
    padding: 22px;
    overflow-y: auto;
  }

  .side-menu-content::-webkit-scrollbar       { width: 4px; }
  .side-menu-content::-webkit-scrollbar-track { background: transparent; }
  .side-menu-content::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 4px; }


  .menu-section {
    margin-bottom: 28px;
  }

  .menu-section h3 {
    font-size: 11px;
    color: var(--text-muted);
    direction: rtl;
    text-align: right;
    letter-spacing: 1px;
    margin-bottom: 10px;
    font-weight: 700;
  }

  .toggle-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 13px 15px;
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: background var(--t-fast), transform var(--t-fast);
    margin-bottom: 10px;
  }

  .toggle-option:hover {
    background: var(--bg-tertiary);
    transform: translateX(2px);
  }

  .toggle-option:focus-visible {
    outline: 2px solid var(--gradient-start);
    outline-offset: 2px;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 500;
  }

  .toggle-switch {
    position: relative;
    width: 46px;
    height: 24px;
    background: var(--bg-tertiary);
    border-radius: 12px;
    transition: background var(--t-base);
    flex-shrink: 0;
  }

  .toggle-switch.active {
    background: var(--gradient-start);
  }

  .toggle-slider {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    box-shadow: 0 1px 4px rgba(0,0,0,0.2);
  }

  .toggle-switch.active .toggle-slider {
    transform: translateX(22px);
  }

  /* ── Question Nav Grid ───────────────────────────────────────── */
  .nav-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 7px;
  }

  .nav-btn {
    padding: 9px 4px;
    border: 1.5px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-weight: 700;
    font-size: 12px;
    text-align: center;
    position: relative;
    min-height: 40px;
    transition: all var(--t-fast);
  }

  .nav-btn:hover {
    border-color: var(--gradient-start);
    background: var(--card-answered);
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
  }

  .nav-btn:focus-visible {
    outline: 2px solid var(--gradient-start);
    outline-offset: 2px;
  }

  .nav-btn.answered {
    background: var(--card-answered);
    border-color: var(--gradient-start);
    color: var(--gradient-start);
  }

  .nav-btn.flagged::after {
    content: '🚩';
    position: absolute;
    top: -6px;
    right: -6px;
    font-size: 10px;
    line-height: 1;
  }

  .nav-btn.current {
    background: var(--gradient);
    color: #fff;
    border-color: transparent;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.45);
  }

  /* ── Main Container ──────────────────────────────────────────── */
  .container {
    max-width: 860px;
    margin: 0 auto;
    background: var(--bg-primary);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    transition: background var(--t-base), box-shadow var(--t-base);
    position: relative;
    z-index: 1;
  }

  /* ── Header ──────────────────────────────────────────────────── */
  .header {
    background: var(--gradient);
    color: #fff;
    padding: 36px 32px 28px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }

  /* Subtle dot-grid texture overlay */
  .header::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle, rgba(255,255,255,0.12) 1px, transparent 1px);
    background-size: 20px 20px;
    pointer-events: none;
  }

  .header h1 {
    font-size: 26px;
    font-weight: 800;
    margin-bottom: 14px;
    letter-spacing: -0.5px;
    position: relative;
    z-index: 1;
    text-wrap: balance;
  }

  /* ── Direction-aware title row ──────────────────────────────────
     The info button sits after the title in reading order: to the
     right of an LTR title, to the left of an RTL title. Flipping
     flex-direction (rather than order) keeps this correct regardless
     of which side "after" maps to. */
  .quiz-title-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-bottom: 14px;
    position: relative;
    z-index: 1;
  }

  .quiz-title-row.text-rtl {
    flex-direction: row-reverse;
  }

  .quiz-title-row h1 {
    margin-bottom: 0;
  }

  /* ── Per-element text direction (ported from result.js) ────────── */
  .text-rtl {
    direction: rtl;
  }

  .text-ltr {
    direction: ltr;
  }

  /* ── Info icon button next to the quiz title ────────────────────── */
  .quiz-info-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.4);
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    cursor: pointer;
    transition: color 0.18s ease, background 0.18s ease, border-color 0.18s ease, transform 0.15s ease;
  }

  .quiz-info-btn:hover {
    background: rgba(255, 255, 255, 0.24);
    border-color: rgba(255, 255, 255, 0.6);
    transform: scale(1.1);
  }

  .quiz-info-btn:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }

  .quiz-info-btn svg {
    pointer-events: none;
  }

  /* ── Quiz Info Dialog ────────────────────────────────────────────── */
  dialog.quiz-info-dialog {
    border: none;
    border-radius: 20px;
    padding: 0;
    background: var(--bg-primary);
    box-shadow: var(--shadow-lg);
    max-width: min(560px, 92vw);
    max-height: min(85vh, 640px);
    width: 100%;
    color: var(--text-primary);
    overflow: hidden;
    position: fixed;
    inset: 0;
    margin: auto;
  }

  .quiz-info-dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
  }

  .quiz-info-dialog[open] {
    animation: dialog-pop-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  @keyframes dialog-pop-in {
    from { opacity: 0; transform: scale(0.93) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }

  .quiz-info-dialog-inner {
    display: flex;
    flex-direction: column;
  }

  .quiz-info-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--border-color);
    position: relative;
  }

  .quiz-info-dialog-header::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: var(--gradient);
    border-radius: 20px 20px 0 0;
  }

  .quiz-info-dialog-header h2 {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0 auto;
    line-height: 1.4;
    color: var(--gradient-start);
    text-align: center;
    opacity: 0;
    transform: translateY(4px);
    animation: dialog-h2-enter 0.4s ease-out forwards;
  }

  @keyframes dialog-h2-enter {
    to { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .quiz-info-dialog-header h2 {
      animation: none;
      opacity: 1;
      transform: none;
    }
  }

  [data-theme="dark"] .quiz-info-dialog-header h2 {
    color: #93c5fd;
  }

  .quiz-info-dialog-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
  }

  .quiz-info-dialog-close:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
    transform: scale(1.08);
  }

  .quiz-info-dialog-close:focus-visible {
    outline: 2px solid var(--gradient-start);
    outline-offset: 2px;
  }

  .quiz-info-dialog-body {
    padding: 20px 24px 24px;
    overflow-y: auto;
    max-height: min(60vh, 400px);
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
  }

  .quiz-info-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  .quiz-info-table tr {
    border-bottom: 1px solid var(--border-color);
  }

  .quiz-info-table tr:last-child {
    border-bottom: none;
  }

  .quiz-info-table th,
  .quiz-info-table td {
    padding: 11px 8px;
    vertical-align: top;
    border: none;
    background: none;
  }

  .quiz-info-table th {
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
    width: 30%;
    padding-inline-end: 16px;
    text-align: right;
  }

  .quiz-info-table td {
    color: var(--text-primary);
    overflow-wrap: break-word;
    word-break: break-word;
    text-align: left;
  }

  .quiz-info-table td a {
    color: var(--gradient-start);
    text-decoration: none;
    word-break: break-all;
  }

  .quiz-info-table td a:hover {
    text-decoration: underline;
  }

  @media (max-width: 480px) {
    .quiz-info-dialog {
      border-radius: 16px;
      max-width: 96vw;
    }

    .quiz-info-dialog-header {
      padding: 18px 18px 14px;
    }

    .quiz-info-dialog-body {
      padding: 16px 18px 20px;
      max-height: 55vh;
    }

    .quiz-info-table th {
      width: 35%;
      font-size: 0.82rem;
    }
  }

  .header-meta {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 20px;
    position: relative;
    z-index: 1;
  }

  .header-meta > span {
    background: rgba(255, 255, 255, 0.18);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.25);
    padding: 5px 13px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
  }

  .quiz-timer {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-variant-numeric: tabular-nums;
  }

  .progress-container {
    background: rgba(255, 255, 255, 0.2);
    height: 10px;
    border-radius: 5px;
    overflow: hidden;
    position: relative;
    z-index: 1;
  }

  .progress-bar {
    background: linear-gradient(90deg, #34d399, #10b981);
    height: 100%;
    width: 0%;
    border-radius: 5px;
    transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 0 10px rgba(52, 211, 153, 0.6);
  }

  .progress-bar.updating {
    animation: progress-pulse 0.5s ease-out;
  }

  @keyframes progress-pulse {
    50% { box-shadow: 0 0 22px rgba(52, 211, 153, 0.9); }
  }

  .progress-text {
    margin-top: 10px;
    font-size: 13px;
    opacity: 0.88;
    font-weight: 500;
    position: relative;
    z-index: 1;
  }

  /* ── Quiz Body ───────────────────────────────────────────────── */
  .quiz-body {
    padding: 32px;
  }

  /* ── Question Card ───────────────────────────────────────────── */
  .question-card {
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    padding: 26px 28px;
    margin-bottom: 22px;
    border: 1.5px solid var(--border-color);
    box-shadow: var(--shadow-sm);
    transition: border-color var(--t-base), box-shadow var(--t-base), transform var(--t-base);
    scroll-margin-top: 24px;
  }

  .question-card:last-child {
    margin-bottom: 0;
  }

  .question-card:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .question-card.answered {
    border-color: var(--gradient-start);
    border-left-width: 4px;
    background: var(--card-answered);
  }

  .question-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
    flex-wrap: wrap;
    gap: 10px;
  }

  .question-num {
    background: var(--gradient);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 13px;
    border-radius: var(--radius-sm);
    letter-spacing: 0.3px;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.35);
  }

  .question-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .question-badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 11px;
    background: var(--success-bg);
    color: var(--success-text);
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }

  .question-badge.essay {
    background: var(--warning-bg);
    color: var(--warning-text);
  }

  .flag-btn {
    background: transparent;
    border: 1.5px solid var(--border-color);
    width: 34px;
    height: 34px;
    border-radius: var(--radius-sm);
    font-size: 15px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--t-fast);
    color: var(--text-muted);
  }

  .flag-btn:hover {
    border-color: var(--warning);
    background: var(--warning-bg);
    transform: scale(1.08);
  }

  .flag-btn:focus-visible {
    outline: 2px solid var(--gradient-start);
    outline-offset: 2px;
  }

  .question-text {
    font-size: 17px;
    font-weight: 600;
    margin-bottom: 22px;
    color: var(--text-primary);
    line-height: 1.65;
    text-wrap: pretty;
  }

  /* ── Question Image ──────────────────────────────────────────── */
  .question-image-container {
    margin-bottom: 22px;
    text-align: center;
    position: relative;
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--bg-secondary);
  }

  .skeleton-loader {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      var(--bg-secondary) 25%,
      var(--bg-tertiary) 50%,
      var(--bg-secondary) 75%
    );
    background-size: 200% 100%;
    animation: skeleton-loading 1.5s infinite;
  }

  @keyframes skeleton-loading {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .question-image {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md);
    opacity: 0;
    transition: opacity 0.35s ease;
    display: block;
    margin: 0 auto;
    position: relative;
    z-index: 1;
  }

  .question-image.loaded {
    opacity: 1;
    animation: fade-in 0.35s ease-in;
  }

  @keyframes fade-in {
    from { opacity: 0; transform: scale(0.98); }
    to   { opacity: 1; transform: scale(1); }
  }

  /* ── Reading Passage ──────────────────────────────────────────── */
  .reading-passage {
    max-height: min(420px, 55vh);
    overflow-y: auto;
    padding: 20px 24px;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-background-secondary);
    font-size: 1.05rem;
    font-weight: 500;
    line-height: 1.75;
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
    margin-bottom: 20px;
  }

  .passage-content {
    color: var(--text-primary);
    font-size: 15px;
  }

  /* ── Media Containers ────────────────────────────────────────── */
  .question-media-container {
    margin-bottom: 22px;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--bg-secondary);
    padding: 8px;
  }

  .question-audio-container {
    display: flex;
    align-items: center;
    min-height: 60px;
    justify-content: center;
  }

  .question-video-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 240px;
  }

  .question-audio,
  .question-video {
    width: 100%;
    max-width: 100%;
    border-radius: var(--radius-sm);
  }

  .question-audio {
    height: 40px;
  }

  .question-video {
    height: auto;
    aspect-ratio: 16 / 9;
  }

  .question-video.youtube-embed {
    border: none;
  }

  /* ── Options ─────────────────────────────────────────────────── */
  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .option-btn {
    background: var(--bg-primary);
    border: 1.5px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 14px 18px;
    text-align: start;
    cursor: pointer;
    transition: border-color var(--t-fast), background var(--t-fast),
                transform var(--t-fast), box-shadow var(--t-fast), color var(--t-fast);
    font-size: 15px;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 13px;
    position: relative;
    overflow: hidden;
    min-height: 52px;
    line-height: 1.5;
  }

  .option-btn:hover:not(.disabled) {
    border-color: var(--gradient-start);
    background: var(--card-answered);
    transform: translateX(4px);
    box-shadow: var(--shadow-sm);
  }

  .option-btn:focus-visible {
    outline: 2px solid var(--gradient-start);
    outline-offset: 2px;
  }

  .option-btn.selecting {
    animation: select-bounce 0.35s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  }

  @keyframes select-bounce {
    0%   { transform: scale(1) translateX(0); }
    50%  { transform: scale(1.03) translateX(6px); }
    100% { transform: scale(1) translateX(4px); }
  }

  .option-letter {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    min-width: 30px;
    border-radius: 50%;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-weight: 700;
    font-size: 13px;
    transition: background var(--t-base), color var(--t-base);
  }

  .option-label {
    flex: 1;
    text-align: start;
  }

  .option-label p {
    margin: 0;
  }

  .option-btn.selected .option-letter { background: var(--gradient-start); color: #fff; }
  .option-btn.correct  .option-letter { background: var(--success);         color: #fff; }
  .option-btn.wrong    .option-letter { background: var(--error);           color: #fff; }

  .option-btn.selected {
    background: var(--card-answered);
    border-color: var(--gradient-start);
  }

  .option-btn.correct {
    background: var(--success-bg);
    border-color: var(--success);
    color: var(--success-text);
  }

  .option-btn.wrong {
    background: var(--error-bg);
    border-color: var(--error);
    color: var(--error-text);
  }

  .option-btn.disabled {
    cursor: not-allowed;
    opacity: 0.8;
  }

  /* ── Ripple ──────────────────────────────────────────────────── */
  .ripple {
    position: absolute;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    transform: scale(0);
    animation: ripple-animation 0.55s ease-out;
    pointer-events: none;
  }

  @keyframes ripple-animation {
    to { transform: scale(4); opacity: 0; }
  }

  /* ── Essay ───────────────────────────────────────────────────── */
  .essay-input {
    width: 100%;
    min-height: 150px;
    padding: 14px 16px;
    border: 1.5px solid var(--border-color);
    border-radius: var(--radius-md);
    font-size: 15px;
    resize: vertical;
    transition: border-color var(--t-base), box-shadow var(--t-base);
    line-height: 1.65;
    background: var(--bg-primary);
    color: var(--text-primary);
    caret-color: var(--gradient-start);
    unicode-bidi: plaintext;
    text-align: start;
  }

  .essay-input:focus {
    outline: none;
    border-color: var(--gradient-start);
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.12);
  }

  .essay-input.disabled {
    cursor: not-allowed;
    opacity: 0.75;
    background: var(--bg-secondary);
  }

  .char-count {
    text-align: right;
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* ── Feedback Boxes ──────────────────────────────────────────── */
  .explanation,
  .model-answer,
  .essay-score {
    padding: 14px 16px;
    margin-top: 16px;
    border-radius: var(--radius-md);
    font-size: 14px;
    line-height: 1.65;
    display: none;
    border-left: 4px solid;
  }

  .explanation.show,
  .model-answer.show,
  .essay-score.show {
    display: block;
    animation: slideDown 0.28s ease;
  }

  .explanation  { background: var(--info-bg);    border-color: var(--info);    color: var(--info-text);    }
  .model-answer { background: var(--success-bg); border-color: var(--success); color: var(--success-text); }

  /* Labels like "💡 الشرح" / "✓ Model Answer" are fixed English
     captions, not part of the (possibly Arabic/RTL) answer content, so
     they must always render centered and LTR regardless of which
     direction TextDirectionEngine applies to their parent container. */
  .answer-label {
    display: block;
    text-align: center;
    direction: ltr;
    unicode-bidi: isolate;
  }

  .essay-score.correct { background: var(--success-bg); border-color: var(--success); color: var(--success-text); }
  .essay-score.partial { background: var(--warning-bg); border-color: var(--warning); color: var(--warning-text); }
  .essay-score.wrong   { background: var(--error-bg);   border-color: var(--error);   color: var(--error-text);   }

  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── Controls Bar ────────────────────────────────────────────── */
  .controls {
    display: flex;
    gap: 12px;
    justify-content: center;
    align-items: center;
    padding: 20px 24px;
    background: var(--bg-secondary);
    flex-wrap: wrap;
    border-top: 1px solid var(--border-color);
  }

  /* ── Buttons ─────────────────────────────────────────────────── */
  .btn {
    padding: 11px 26px;
    border: none;
    border-radius: var(--radius-md);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: transform var(--t-base), box-shadow var(--t-base), background var(--t-base), opacity var(--t-base);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    position: relative;
    overflow: hidden;
    min-height: 44px;
    letter-spacing: -0.1px;
  }

  .btn:focus-visible {
    outline: 2px solid var(--gradient-start);
    outline-offset: 2px;
  }

  .btn-primary {
    background: var(--gradient);
    color: #fff;
    box-shadow: 0 2px 12px rgba(102, 126, 234, 0.4);
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.55);
  }

  .btn-primary:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--border-color);
    transform: translateY(-1px);
  }

  .btn-block {
    width: 100%;
    justify-content: center;
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn.loading .btn-text   { display: none; }
  .btn.loading .btn-loader { display: inline-flex !important; }
  .btn-loader              { display: none; }

  .spinner {
    width: 18px;
    height: 18px;
    animation: rotate 1.8s linear infinite;
  }

  .spinner circle {
    stroke-linecap: round;
    animation: dash 1.5s ease-in-out infinite;
  }

  @keyframes rotate { 100% { transform: rotate(360deg); } }

  @keyframes dash {
    0%   { stroke-dasharray: 1, 150;  stroke-dashoffset: 0;    }
    50%  { stroke-dasharray: 90, 150; stroke-dashoffset: -35;  }
    100% { stroke-dasharray: 90, 150; stroke-dashoffset: -124; }
  }

  /* ── Results ─────────────────────────────────────────────────── */
  .results {
    padding: 40px 32px;
    text-align: center;
    display: none;
    border-top: 1px solid var(--border-color);
  }

  .results.show {
    display: block;
    animation: fadeIn 0.45s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .score-circle {
    width: 148px;
    height: 148px;
    border-radius: 50%;
    margin: 0 auto 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 38px;
    font-weight: 800;
    color: #fff;
    animation: scaleIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    position: relative;
    letter-spacing: -1px;
    will-change: transform, opacity;
  }

  /* Outer ring */
  .score-circle::after {
    content: '';
    position: absolute;
    inset: -7px;
    border-radius: 50%;
    border: 3px solid currentColor;
    opacity: 0.28;
    animation: scaleIn 0.5s 0.08s cubic-bezier(0.68, -0.55, 0.265, 1.55) both;
  }

  .score-circle.pass {
    background: linear-gradient(135deg, #34d399, #059669);
    box-shadow: 0 8px 32px rgba(16, 185, 129, 0.45);
    color: #fff;
  }

  .score-circle.fail {
    background: linear-gradient(135deg, #f87171, #dc2626);
    box-shadow: 0 8px 32px rgba(239, 68, 68, 0.45);
    color: #fff;
  }

  @keyframes scaleIn {
    from { transform: scale(0); opacity: 0; }
    to   { transform: scale(1); opacity: 1; }
  }

  .results h2 {
    font-size: 24px;
    font-weight: 800;
    color: var(--text-primary);
    margin-bottom: 4px;
    letter-spacing: -0.5px;
    text-wrap: balance;
  }

  .results-detail {
    margin: 20px auto 0;
    max-width: 360px;
    padding: 20px 24px;
    background: var(--bg-secondary);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    text-align: left;
  }

  .results-detail p {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 9px 0;
    font-size: 14px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-color);
  }

  .results-detail p:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .results-detail p:first-child {
    padding-top: 0;
  }

  .results-detail p strong {
    color: var(--text-primary);
    font-weight: 600;
    white-space: nowrap;
  }

  /* ── Modal ───────────────────────────────────────────────────── */
  .modal {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 1100;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal.show {
    display: flex;
  }

  .modal-content {
    background: var(--bg-primary);
    padding: 28px 28px 24px;
    border-radius: var(--radius-xl);
    max-width: 480px;
    width: 100%;
    box-shadow: 0 24px 80px rgba(0,0,0,0.28);
    animation: modalSlideIn 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
    max-height: 80vh;
    overflow-y: auto;
  }

  .modal-content h3 {
    margin-bottom: 12px;
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.3px;
    text-wrap: balance;
  }

  .modal-content p {
    color: var(--text-secondary);
    margin-bottom: 8px;
    line-height: 1.6;
    font-size: 14px;
  }

  .modal-buttons {
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-wrap: wrap;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color);
  }

  .modal-btn {
    flex-shrink: 0;
  }


  .review-summary .warning {
    color: var(--warning-text);
    background: var(--warning-bg);
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    margin: 10px 0;
    font-size: 13px;
    border-left: 3px solid var(--warning);
  }

  .review-actions {
    display: flex;
    gap: 10px;
    margin-top: 16px;
    flex-wrap: wrap;
    justify-content: center;
  }

  @keyframes modalSlideIn {
    from { opacity: 0; transform: scale(0.92) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }

  /* ── Toast ───────────────────────────────────────────────────── */
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(120px);
    background: var(--bg-primary);
    padding: 13px 18px;
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08);
    border: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    gap: 11px;
    z-index: 2000;
    opacity: 0;
    transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
    max-width: min(90vw, 380px);
  }

  .toast.show {
    transform: translateX(-50%) translateY(0);
    opacity: 1;
  }

  .toast-success { border-left: 4px solid var(--success); }
  .toast-info    { border-left: 4px solid var(--info); }

  .toast-icon    { font-size: 16px; flex-shrink: 0; line-height: 1; }
  .toast-message { color: var(--text-primary); font-size: 14px; font-weight: 500; }

  /* ── Markdown CSS Variables Mapping ── */
  :root {
    --color-primary: var(--info);
    --color-primary-light: rgba(59, 130, 246, 0.1);
    --color-border: var(--border-color);
    --color-text-primary: var(--text-primary);
    --color-text-secondary: var(--text-secondary);
    --color-background: var(--bg-primary);
    --color-background-secondary: var(--bg-secondary);
    --color-success: var(--success);
    --color-error: var(--error);
    --color-code: var(--text-primary);
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.1);
    --shadow-md: 0 4px 6px rgba(0,0,0,0.1);
  }
  
  [data-theme="dark"] {
    --color-code: #e2e8f0;
  }

  ${MARKDOWN_CSS}

  /* ── Print ───────────────────────────────────────────────────── */
  @media print {
    body { background: white; padding: 0; }

    .menu-toggle, .side-menu, .side-menu-overlay,
    .controls, .toast, .skip-link { display: none !important; }

    .container { box-shadow: none; border-radius: 0; }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .question-card {
      page-break-inside: avoid;
      border: 1px solid #ddd;
      margin-bottom: 20px;
      box-shadow: none;
      transform: none;
    }

    .option-btn { border: 1px solid #ddd; background: white !important; }
    .flag-btn   { display: none; }
  }

  /* ── Mobile ──────────────────────────────────────────────────── */
  @media (max-width: 600px) {
    body { padding: 0; }

    .container { border-radius: 0; }

    .header {
      padding: 24px 18px 20px;
    }

    .header h1 { font-size: 20px; }

    .header-meta > span { font-size: 12px; padding: 4px 10px; }

    .quiz-body {
      padding: 20px 16px;
    }

    .question-card { padding: 18px 16px; }

    .question-text { font-size: 16px; }

    .option-btn { padding: 13px 14px; font-size: 14px; }

    .side-menu {
      top: auto;
      bottom: -100%;
      right: 0;
      left: 0;
      width: 100%;
      height: 72vh;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      transition: bottom var(--t-slow), visibility var(--t-slow);
    }

    .side-menu.open { bottom: 0; right: 0; }

    .side-menu::before {
      content: '';
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      width: 36px;
      height: 4px;
      background: var(--border-color);
      border-radius: 2px;
    }

    .nav-grid { grid-template-columns: repeat(5, 1fr); gap: 6px; }

    .menu-toggle { width: 44px; height: 44px; }

    .modal-content { padding: 22px 18px 18px; }

    .toast {
      left: 16px;
      right: 16px;
      transform: translateX(0) translateY(120px);
      max-width: none;
    }

    .toast.show { transform: translateX(0) translateY(0); }

    .controls { padding: 14px 16px; gap: 10px; }

    .btn { flex: 1; min-width: 0; }

    .results { padding: 28px 18px; }

    .results-detail { max-width: 100%; }
  }

  /* ── Reduced Motion ──────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }

  /* ── Accessibility ───────────────────────────────────────────── */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  .live-region {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
  </style>
  </head>
  <body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  
  <div class="live-region" aria-live="polite" aria-atomic="true" id="liveRegion"></div>
  
  <button class="menu-toggle" id="menuToggle" aria-label="Toggle menu" aria-expanded="false">
    <span></span>
    <span></span>
    <span></span>
  </button>
  
  <div class="side-menu-overlay" id="menuOverlay"></div>
  
  <div class="side-menu" id="sideMenu" role="dialog" aria-label="Quiz navigation menu">
    <div class="side-menu-header">
      <h2>التنقل بين الأسئلة</h2>
      <p>اذهب إلى أيّ سؤال</p>
    </div>
    
    <div class="side-menu-content">
      <div class="menu-section">
        <h3>الإعدادات</h3>
        
        <div class="toggle-option" id="darkModeToggle" role="switch" aria-checked="false" tabindex="0">
          <div class="toggle-label">
            <span id="themeIcon" aria-hidden="true">🌙</span>
            <span>خلفية سوداء</span>
          </div>
          <div class="toggle-switch" id="darkModeSwitch">
            <div class="toggle-slider"></div>
          </div>
        </div>
      </div>
      
      <div class="menu-section">
        <h3>الإجراءات</h3>
        <button class="btn btn-secondary btn-block" onclick="quizApp.printQuiz()">
          🖨️ إطبع الامتحان
        </button>
      </div>
      
      <div class="menu-section">
        <h3>الأسئلة</h3>
        <div class="nav-grid" id="navGrid"></div>
      </div>
    </div>
  </div>
  
  <div class="container">
    <header class="header">
      <div class="quiz-title-row" id="quizTitleRow">
        <button class="quiz-info-btn" id="quizInfoBtn" type="button" aria-label="Quiz info" aria-haspopup="dialog">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        </button>
        <h1 id="quiz-title">${escHtml(config.title || "Practice Quiz")}</h1>
      </div>
      <div class="header-meta">
        <span class="quiz-timer">⏱️ <span id="timerDisplay">0:00</span></span>
      </div>
      <div class="progress-container">
        <div class="progress-bar" id="progressBar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
      </div>
      <div class="progress-text" id="progressText">أجبت على 0 من ${questions.length} سؤال</div>
    </header>

    <dialog class="quiz-info-dialog" id="quizInfoDialog" aria-labelledby="quizInfoDialogTitle">
      <div class="quiz-info-dialog-inner">
        <div class="quiz-info-dialog-header">
          <h2 id="quizInfoDialogTitle">معلومات الإمتحان</h2>
          <button class="quiz-info-dialog-close" id="quizInfoDialogClose" type="button" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="quiz-info-dialog-body">
          <table class="quiz-info-table">
            <tbody id="quizInfoTable">${quizInfoRowsHtml}</tbody>
          </table>
        </div>
      </div>
    </dialog>

    <main id="main-content" class="quiz-body"></main>
    
    <div class="controls">      
      <button class="btn btn-primary" onclick="quizApp.submit()" id="submitBtn">
        <span class="btn-text">✓ تسليم الامتحان</span>
        <span class="btn-loader">
          <svg class="spinner" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5"></circle>
          </svg>
        </span>
      </button>
      <button class="btn btn-secondary" onclick="quizApp.reset()">
        🔄 إعادة الامتحان
      </button>
      <button class="btn btn-secondary" onclick="quizApp.enterReviewMode()" id="reviewBtn">
        👁️ مراجعة
      </button>      
    </div>
    
    <div id="results" class="results" role="region" aria-label="Quiz results"></div>
  </div>
  
  <div id="modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-content">
      <h3 id="modalTitle">Confirm Action</h3>
      <div id="modalBody"></div>
      <div class="modal-buttons">
        <button class="btn btn-primary modal-btn" id="modalConfirm">تأكيد</button>
        <button class="btn btn-secondary modal-btn" onclick="quizApp.closeModal()">إلغاء</button>
      </div>
    </div>
  </div>
  
  <script>
  const ICON_COPY = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>\`;
  const questions = ${JSON.stringify(processedQuestions)};
  
  // ── Markdown + KaTeX integration (mirrored from create-quiz) ──
  // All functions are serialised from module scope via .toString() so the
  // generated file is self-contained with no build step needed.
  // highlightCode's own module-level dependencies (_HL_KEYWORDS,
  // _HL_BUILTINS_JS) aren't functions, so .toString() can't carry them —
  // they're rebuilt as JS source text via the serialize* helpers above.

  const _HL_KEYWORDS = ${serializeHlKeywords(_HL_KEYWORDS)};

  const _HL_BUILTINS_JS = ${serializeHlBuiltinsJs(_HL_BUILTINS_JS)};

  ${highlightCode.toString()}

  ${escHtml.toString()}
  
  ${applyInline.toString()}
  
  ${_renderMarkdownCore.toString()}
  
  ${renderMarkdown.toString()}

  ${scanDirections.toString()}
  
  ${gradeEssay.toString()}
  
  ${isAnswerCorrect.toString()}
  
  ${calculateQuizMetrics.toString()}

  const _BLOCK_CHILD_SELECTOR = ${JSON.stringify(_BLOCK_CHILD_SELECTOR)};
  const _LTR_ONLY_SELECTOR = ${JSON.stringify(_LTR_ONLY_SELECTOR)};
  const _ARABIC_REGEX = ${_ARABIC_REGEX.toString()};
  const _FIRST_STRONG_CHAR_REGEX = ${_FIRST_STRONG_CHAR_REGEX.toString()};
  const _LABEL_PREFIX_REGEX = ${_LABEL_PREFIX_REGEX.toString()};
  const _SKIP_TAGS = new Set(${JSON.stringify(Array.from(_SKIP_TAGS))});

  ${detectDirection.toString()}

  ${_processElement.toString()}

  ${_processByLine.toString()}

  ${_applyDirectionClass.toString()}
 
  const isEssayQuestion = (question) => {
    return question.answer;
  };

  const quizApp = {
    userAnswers: new Array(questions.length).fill(null),
    submitted: false,
    currentQuestion: 0,
    darkMode: false,
    flaggedQuestions: new Set(),
    quizStartTime: null,
    timerInterval: null,
    init() {
      this.loadPreferences();
      this.loadProgress();
      this.renderQuiz();
      this.renderNav();
      this.updateProgress();
      this.setupMenuToggle();
      this.setupToggles();
      this.setupKeyboardNavigation();
      this.setupModalClickOutside();
      this.startQuizTimer();
      this.setupImageLoading();
      this.setupQuizTitle();
      this.setupInfoDialog();
      this.announceToScreenReader('Quiz loaded. ' + questions.length + ' questions available.');
    },
  
    loadPreferences() {
      const savedTheme = localStorage.getItem('quizTheme');
      
      this.darkMode = savedTheme === 'dark';
      
      this.applyTheme();
    },
  
    applyTheme() {
      if (this.darkMode) {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('themeIcon').textContent = '☀️';
        document.getElementById('darkModeToggle').setAttribute('aria-checked', 'true');
      } else {
        document.documentElement.removeAttribute('data-theme');
        document.getElementById('themeIcon').textContent = '🌙';
        document.getElementById('darkModeToggle').setAttribute('aria-checked', 'false');
      }
      
      const toggleSwitch = document.getElementById('darkModeSwitch');
      toggleSwitch.classList.toggle('active', this.darkMode);
    },
  
    toggleDarkMode() {
      this.darkMode = !this.darkMode;
      localStorage.setItem('quizTheme', this.darkMode ? 'dark' : 'light');
      this.applyTheme();
      this.announceToScreenReader(this.darkMode ? 'Dark mode enabled' : 'Light mode enabled');
    },
  
    saveProgress() {
      const state = {
        answers: this.userAnswers,
        flagged: Array.from(this.flaggedQuestions),
        currentQuestion: this.currentQuestion,
        timestamp: Date.now()
      };
      localStorage.setItem('quiz_progress', JSON.stringify(state));
    },
  
    loadProgress() {
      const saved = localStorage.getItem('quiz_progress');
      if (saved) {
        try {
          const state = JSON.parse(saved);
          const ageInHours = (Date.now() - state.timestamp) / (1000 * 60 * 60);
          
          if (ageInHours < 24) {
            this.userAnswers = state.answers || this.userAnswers;
            this.flaggedQuestions = new Set(state.flagged || []);
            this.currentQuestion = state.currentQuestion || 0;
            
            setTimeout(() => {
              this.restoreUIState();
              this.showToast('تم استعادة إجاباتك السابقة', 'info');
            }, 500);
          }
        } catch (e) {
          console.error('Failed to load progress:', e);
        }
      }
    },
  
    restoreUIState() {
      this.userAnswers.forEach((ans, i) => {
        if (ans !== null && (!Array.isArray(ans) || ans.length > 0)) {
          const q = questions[i];
          if (isEssayQuestion(q)) {
            const textarea = document.getElementById(\`essay\${i}\`);
            if (textarea) {
              textarea.value = ans;
              this.updateCharCount(i, ans);
            }
          } else {
            const card = document.getElementById(\`q\${i}\`);
            if (card) {
              card.classList.add('answered');
              const isMultiple = Array.isArray(q.correct);
              const buttons = card.querySelectorAll('.option-btn');
              buttons.forEach((btn, j) => {
                const isSelected = isMultiple ? Array.isArray(ans) && ans.includes(j) : j === ans;
                btn.classList.toggle('selected', isSelected);
                const checkbox = btn.querySelector('input[type="checkbox"]');
                if (checkbox) checkbox.checked = isSelected;
              });
            }
          }
        }
      });
      
      this.flaggedQuestions.forEach(i => {
        this.updateFlagUI(i);
      });
      
      this.updateAllNavButtons();
    },
  
    startQuizTimer() {
      this.quizStartTime = Date.now();
      this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    },
  
    updateTimer() {
      if (!this.quizStartTime) return;
      const elapsed = Math.floor((Date.now() - this.quizStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      document.getElementById('timerDisplay').textContent = 
        \`\${mins}:\${secs.toString().padStart(2, '0')}\`;
    },
  
    stopTimer() {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    },
  
    // The info button's position (after the title, in reading order) follows
    // whichever direction the title text itself resolves to — independent of
    // the rest of the page, since titles are often Arabic while the rest of
    // the quiz (or vice versa) may not be. scanDirections applies
    // .text-rtl/.text-ltr to #quiz-title itself; mirror that onto the row
    // wrapper so the flex order follows it.
    setupQuizTitle() {
      const titleEl = document.getElementById('quiz-title');
      const titleRow = document.getElementById('quizTitleRow');
      if (!titleEl || !titleRow) return;

      // #quiz-title is populated via static HTML (not renderMarkdown), so
      // we call scanDirections once to apply the direction class, then
      // mirror it synchronously onto the row wrapper.
      scanDirections(titleEl);

      const isRtl = titleEl.classList.contains('text-rtl');
      titleRow.classList.toggle('text-rtl', isRtl);
      titleRow.classList.toggle('text-ltr', !isRtl);
    },

    setupInfoDialog() {
      const btn = document.getElementById('quizInfoBtn');
      const dialog = document.getElementById('quizInfoDialog');
      const closeBtn = document.getElementById('quizInfoDialogClose');
      if (!btn || !dialog) return;

      btn.addEventListener('click', () => dialog.showModal());
      closeBtn && closeBtn.addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
    },

    setupMenuToggle() {
      const menuToggle = document.getElementById('menuToggle');
      const overlay = document.getElementById('menuOverlay');
  
      menuToggle.addEventListener('click', () => this.toggleMenu());
      overlay.addEventListener('click', () => this.closeMenu());
    },
  
    setupToggles() {
      const darkModeToggle = document.getElementById('darkModeToggle');
  
      darkModeToggle.addEventListener('click', () => this.toggleDarkMode());
      
      darkModeToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          darkModeToggle.click();
        }
      });
    },
  
    toggleMenu() {
      const menuToggle = document.getElementById('menuToggle');
      const sideMenu = document.getElementById('sideMenu');
      const overlay = document.getElementById('menuOverlay');
      const isOpen = sideMenu.classList.contains('open');
  
      menuToggle.classList.toggle('active');
      sideMenu.classList.toggle('open');
      overlay.classList.toggle('show');
      
      menuToggle.setAttribute('aria-expanded', !isOpen);
      
      if (!isOpen) {
        this.trapFocus(sideMenu);
      }
    },
  
    closeMenu() {
      const menuToggle = document.getElementById('menuToggle');
      const sideMenu = document.getElementById('sideMenu');
      const overlay = document.getElementById('menuOverlay');
  
      menuToggle.classList.remove('active');
      sideMenu.classList.remove('open');
      overlay.classList.remove('show');
      menuToggle.setAttribute('aria-expanded', 'false');
    },
  
    toggleFlag(qIndex) {
      if (this.flaggedQuestions.has(qIndex)) {
        this.flaggedQuestions.delete(qIndex);
      } else {
        this.flaggedQuestions.add(qIndex);
      }
      this.updateFlagUI(qIndex);
      this.updateNavButton(qIndex);
      this.saveProgress();
      
      const isFlagged = this.flaggedQuestions.has(qIndex);
      this.announceToScreenReader(
        isFlagged ? 'Question flagged for review' : 'Question unflagged'
      );
    },
  
    updateFlagUI(qIndex) {
      const flagBtn = document.getElementById(\`flag\${qIndex}\`);
      if (flagBtn) {
        const isFlagged = this.flaggedQuestions.has(qIndex);
        flagBtn.textContent = isFlagged ? '🚩' : '⚑';
        flagBtn.setAttribute('aria-label', 
          isFlagged ? 'Unflag question' : 'Flag question for review');
      }
    },
    
    renderQuestionImage(imageUrl, qIndex) {
      if (!imageUrl) return "";
      return \`
        <div class="question-image-container">
          <div class="skeleton-loader" id="skeleton\${qIndex}"></div>
          <img 
            src="\${this.escapeHTML(imageUrl)}" 
            alt="Question context image" 
            class="question-image"
            id="img\${qIndex}"
            data-index="\${qIndex}"
          />
        </div>
      \`;
    },

    renderQuestionAudio(audioUrl, qIndex) {
      if (!audioUrl) return "";
      return \`
        <div class="question-media-container question-audio-container">
          <audio controls preload="metadata" class="question-audio" id="audio\${qIndex}">
            <source src="\${this.escapeHTML(audioUrl)}" />
            Your browser doesn't support audio playback.
          </audio>
        </div>
      \`;
    },

    renderQuestionVideo(videoUrl, qIndex) {
      if (!videoUrl) return "";

      // Built via RegExp(string) rather than a /regex/ literal: a literal
      // regex here sits inside the outer quizHTML template literal, and its
      // backslash escapes get consumed by that outer literal's own escape
      // processing before the regex is ever parsed by the browser --
      // silently stripping every backslash and producing an invalid
      // pattern at runtime. Building the pattern from plain string pieces
      // (zero backslashes in the source) sidesteps that entirely.
      // NOTE: "." and "?" are regex metacharacters, so they must be escaped
      // *within the pattern string* to match literally -- using a
      // char-code-built backslash (not a literal "\\") to keep zero
      // backslashes in this file's own source.
      const BACKSLASH = String.fromCharCode(92);
      const DOT = BACKSLASH + String.fromCharCode(46);
      const SLASH = BACKSLASH + String.fromCharCode(47);
      const QMARK = BACKSLASH + String.fromCharCode(63);
      const YOUTUBE_RE = new RegExp(
        "(?:youtube" + DOT + "com" + SLASH +
          "(?:watch" + QMARK + "(?:.*&)?v=|embed" + SLASH + "|v" + SLASH + "|shorts" + SLASH + ")" +
          "|youtu" + DOT + "be" + SLASH +
          ")([a-zA-Z0-9_-]{11})",
        "i"
      );
      const ytMatch = String(videoUrl).match(YOUTUBE_RE);

      if (ytMatch) {
        const embedSrc = \`https://www.youtube-nocookie.com/embed/\${ytMatch[1]}\`;
        return \`
          <div class="question-media-container question-video-container">
            <iframe
              class="question-video youtube-embed"
              id="video\${qIndex}"
              src="\${this.escapeHTML(embedSrc)}"
              frameborder="0"
              referrerpolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
              loading="lazy"
            ></iframe>
          </div>
        \`;
      }

      return \`
        <div class="question-media-container question-video-container">
          <video controls preload="metadata" playsinline class="question-video" id="video\${qIndex}">
            <source src="\${this.escapeHTML(videoUrl)}" />
            Your browser doesn't support video playback.
          </video>
        </div>
      \`;
    },

    renderReadingPassage(passage) {
      if (!passage) return "";
      return \`
        <div class="reading-passage" role="region" aria-label="Reading passage">
          <div class="passage-content">\${renderMarkdown(passage)}</div>
        </div>
      \`;
    },

    renderQuestionMedia(q, qIndex) {
      return [
        this.renderQuestionImage(q.image, qIndex),
        this.renderQuestionAudio(q.audio, qIndex),
        this.renderQuestionVideo(q.video, qIndex),
      ].join("");
    },
  
    setupImageLoading() {
      document.querySelectorAll('.question-image').forEach(img => {
        img.addEventListener('load', function() {
          const index = this.dataset.index;
          const skeleton = document.getElementById(\`skeleton\${index}\`);
          if (skeleton) skeleton.style.display = 'none';
          this.classList.add('loaded');
          this.style.display = 'block';
        });
        
        img.addEventListener('error', function() {
          this.parentElement.style.display = 'none';
        });
      });
    },
  
    escapeHTML(str) {
      if (str == null) return "";
      const div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    },
  
    renderNav() {
      const navGrid = document.getElementById("navGrid");
      const navHtml = questions.map((_, i) => 
        \`<button class="nav-btn" id="nav\${i}" 
           onclick="quizApp.jumpToQuestion(\${i})" 
           aria-label="Go to question \${i + 1}">
          \${i + 1}
        </button>\`
      ).join("");
      navGrid.innerHTML = navHtml;
      this.updateAllNavButtons();
    },
  
    renderQuiz() {
      const quizBody = document.querySelector(".quiz-body");
      const html = questions.map((q, i) => this.renderQuestion(q, i)).join("");
      quizBody.innerHTML = html;
      scanDirections(quizBody);
    },
  
    renderQuestion(q, i) {
      // There is a missing feature here: It doesn't recognise True/False questions.
      const isEssay = isEssayQuestion(q);
      const badgeText = isEssay ? "مقالي" : "إختياري";
      const badgeClass = isEssay ? "essay" : "";
  
      let optionsHtml = "";
      if (isEssay) {
        const savedAnswer = this.userAnswers[i] || "";
        optionsHtml = \`
          <textarea 
            class="essay-input" 
            id="essay\${i}" 
            placeholder="اكتب إجابتك هنا..."
            oninput="quizApp.handleEssayInput(\${i}, this.value)"
            aria-label="Essay answer for question \${i + 1}"
          >\${savedAnswer}</textarea>
          <div class="char-count" id="charCount\${i}">
            \${savedAnswer.length} حروف
          </div>
          <div class="model-answer" id="modelAns\${i}">
            <strong class="answer-label">✓ Model Answer</strong><br>
            \${renderMarkdown(q.answer)}
          </div>
          <div class="essay-score" id="essayScore\${i}"></div>
        \`;
      } else {
        const isMultiple = Array.isArray(q.correct);
        optionsHtml = \`<div class="options">\${
          q.options.map((opt, j) => {
            const letter = String.fromCharCode(65 + j);
            const prefix = isMultiple 
              ? '<input type="checkbox" class="export-checkbox" disabled style="pointer-events: none; margin-right: 12px; transform: scale(1.2); accent-color: var(--gradient-start);">' 
              : \`<span class="option-letter">\${letter}</span>\`;
            return \`
              <button 
                class="option-btn" 
                id="btn\${i}_\${j}" 
                onclick="quizApp.selectAnswer(\${i}, \${j})"
                onkeydown="quizApp.handleOptionKeydown(event, \${i}, \${j})"
                aria-label="Option \${letter}: \${this.escapeHTML(opt)}"
              >
                \${prefix}
                <span class="option-label">\${renderMarkdown(opt)}</span>
              </button>
            \`;
          }).join("")
        }</div>\`;
      }
  
      const explanationHtml = q.explanation ? 
        \`<div class="explanation" id="exp\${i}">
          <strong class="answer-label">💡 Explanation</strong> \${renderMarkdown(q.explanation)}
        </div>\` : "";
  
      return \`
        <div class="question-card" id="q\${i}">
          <div class="question-header">
            <div class="question-num">سؤال\${i + 1}</div>
            <div class="question-actions">
              <div class="question-badge \${badgeClass}">\${badgeText}</div>
              <button class="flag-btn" id="flag\${i}" 
                      onclick="quizApp.toggleFlag(\${i})"
                      aria-label="Flag question for review">⚑</button>
            </div>
          </div>
          
          \${this.renderReadingPassage(q.passage)}
          <div class="question-text">\${renderMarkdown(q.q)}</div>
          \${this.renderQuestionMedia(q, i)}
          \${optionsHtml}
          \${explanationHtml}
        </div>
      \`;
    },
  
    selectAnswer(qIndex, optIndex) {
      if (this.submitted) return;
  
      const q = questions[qIndex];
      const isMultiple = Array.isArray(q.correct);
      const card = document.getElementById(\`q\${qIndex}\`);
      
      if (isMultiple) {
        if (!Array.isArray(this.userAnswers[qIndex])) {
          this.userAnswers[qIndex] = [];
        }
        const ansArray = this.userAnswers[qIndex];
        const idx = ansArray.indexOf(optIndex);
        if (idx > -1) {
          ansArray.splice(idx, 1);
        } else {
          ansArray.push(optIndex);
        }
        
        card.classList.toggle("answered", ansArray.length > 0);
        
        const btn = document.getElementById(\`btn\${qIndex}_\${optIndex}\`);
        const isSelected = idx === -1;
        btn.classList.toggle('selected', isSelected);
        btn.classList.add('selecting');
        setTimeout(() => btn.classList.remove('selecting'), 400);
        
        const checkbox = btn.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = isSelected;
        
        this.announceToScreenReader(\`Option \${String.fromCharCode(65 + optIndex)} \${isSelected ? 'selected' : 'unselected'}\`);
      } else {
        this.userAnswers[qIndex] = optIndex;
        card.classList.add("answered");
    
        const buttons = card.querySelectorAll(".option-btn");
        buttons.forEach((btn, i) => {
          btn.classList.remove('selected', 'selecting');
          if (i === optIndex) {
            btn.classList.add("selected", "selecting");
            setTimeout(() => btn.classList.remove('selecting'), 400);
          }
        });
        this.announceToScreenReader(\`Option \${String.fromCharCode(65 + optIndex)} selected\`);
      }
  
      this.updateProgress();
      this.updateNavButton(qIndex);
      this.saveProgress();
    },
  
    handleEssayInput(qIndex, value) {
      const trimmed = value.trim();
      this.userAnswers[qIndex] = trimmed || null;
      
      const card = document.getElementById(\`q\${qIndex}\`);
      card.classList.toggle("answered", !!trimmed);
      
      this.updateCharCount(qIndex, value);
      this.updateProgress();
      this.updateNavButton(qIndex);
      this.saveProgress();
    },
  
    updateCharCount(qIndex, value) {
      const charCount = document.getElementById(\`charCount\${qIndex}\`);
      if (charCount) {
        charCount.textContent = \`\${value.length} حروف\`;
      }
    },
  
    updateProgress() {
      const answered = this.userAnswers.filter(a => a !== null && (!Array.isArray(a) || a.length > 0)).length;
      const total = questions.length;
      const percent = (answered / total) * 100;
  
      const progressBar = document.getElementById("progressBar");
      const progressText = document.getElementById("progressText");
      
      progressBar.classList.add('updating');
      setTimeout(() => progressBar.classList.remove('updating'), 500);
      
      progressBar.style.width = \`\${percent}%\`;
      progressBar.setAttribute('aria-valuenow', percent);
      progressText.textContent = \`أجبت على \${answered} من \${questions.length} سؤال\`;
    },
  
    updateNavButton(qIndex) {
      const navBtn = document.getElementById(\`nav\${qIndex}\`);
      if (navBtn) {
        const val = this.userAnswers[qIndex];
        const isAnswered = val !== null && (!Array.isArray(val) || val.length > 0);
        navBtn.classList.toggle("answered", isAnswered);
        navBtn.classList.toggle("flagged", this.flaggedQuestions.has(qIndex));
        navBtn.classList.toggle("current", this.currentQuestion === qIndex);
      }
    },
  
    updateAllNavButtons() {
      questions.forEach((_, i) => this.updateNavButton(i));
    },
  
    jumpToQuestion(qIndex) {
      const card = document.getElementById(\`q\${qIndex}\`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        this.currentQuestion = qIndex;
        this.updateAllNavButtons();
        this.closeMenu();
        
        setTimeout(() => {
          const firstBtn = card.querySelector('.option-btn, .essay-input, .flag-btn');
          if (firstBtn) firstBtn.focus();
        }, 500);
      }
    },
  
    enterReviewMode() {
      const unanswered = [];
      const flagged = [];
      
      this.userAnswers.forEach((ans, i) => {
        if (ans === null || (Array.isArray(ans) && ans.length === 0)) unanswered.push(i + 1);
      });
      
      this.flaggedQuestions.forEach(i => flagged.push(i + 1));
      
      let summaryHTML = '<div class="review-summary">';
      // summaryHTML += '<h3>Quiz Review</h3>';
      summaryHTML += \`<p><strong>أسئلة مجابة:</strong> \${this.userAnswers.filter(a => a !== null && (!Array.isArray(a) || a.length > 0)).length}/\${questions.length}</p>\`;
      
      if (unanswered.length > 0) {
        summaryHTML += \`<p class="warning">⚠️ <strong>أسئلة غير مجابة:</strong> \${unanswered.join(', ')}</p>\`;
      }
      
      if (flagged.length > 0) {
        summaryHTML += \`<p>🚩 <strong>أسئلة عليها علامة مراجعة:</strong> \${flagged.join(', ')}</p>\`;
      }
      
      if (unanswered.length === 0 && flagged.length === 0) {
        summaryHTML += '<p style="color: var(--success);">✓ كل الأسئلة مجابة ، ولا يوجد علامات للمراجعة</p>';
      }
      
      summaryHTML += \`
        <div class="review-actions">
          <button class="btn btn-primary modal-btn" onclick="quizApp.performSubmit()">تسليم الامتحان الآن</button>
          <button class="btn btn-secondary modal-btn" onclick="quizApp.closeModal()">استمر في الامتحان</button>
        </div>
      </div>\`;
      
      this.showModal('مراجعة الامتحان', summaryHTML);
    },
  
    submit() {
      if (this.submitted) return;
  
      // Always show confirmation before submitting
      const unanswered = this.userAnswers.filter(a => a === null || (Array.isArray(a) && a.length === 0)).length;
      
      let message = '<p>هل أنت متأكد من تسليم الامتحان؟</p>';
      if (unanswered > 0) {
        message = \`<p>لديك <strong>\${unanswered}</strong> سؤالاً غير مجاب</p><p>هل انت متأكد من أنك تريد التسليم؟</p>\`;
      }
      
      this.showModal(
        "تأكيد التسليم",
        message,
        () => this.performSubmit()
      );
    },
  
    performSubmit() {
      this.closeModal();
      
      const submitBtn = document.getElementById('submitBtn');
      submitBtn.classList.add('loading');
      submitBtn.disabled = true;
      
      setTimeout(() => {
        this.submitted = true;
        this.stopTimer();
  
        let mcqCorrect = 0;
        let mcqTotal = 0;
        let essayScore = 0;
        let essayMaxScore = 0;
  
        questions.forEach((q, i) => {
          if (isEssayQuestion(q)) {
            this.handleEssaySubmission(i);
          } else {
            this.handleMCQSubmission(q, i);
          }
  
          const exp = document.getElementById(\`exp\${i}\`);
          if (exp) exp.classList.add("show");
        });

        ({
          mcqCorrect,
          mcqTotal,
          essayScoreTotal: essayScore,
          essayMaxTotal: essayMaxScore,
          actualPercentage,
        } = calculateQuizMetrics(questions, this.userAnswers));
  
        this.showResults(mcqCorrect, mcqTotal, essayScore, essayMaxScore, actualPercentage);
        
        submitBtn.classList.remove('loading');
        document.getElementById('reviewBtn').disabled = true;
        
        localStorage.removeItem('quiz_progress');
        
        this.announceToScreenReader('Quiz submitted. Check results below.');
      }, 800);
    },
  
    handleEssaySubmission(qIndex) {
      const q = questions[qIndex];
      const userText = this.userAnswers[qIndex] || "";
  
      const essayEl = document.getElementById(\`essay\${qIndex}\`);
      if (essayEl) {
        essayEl.readOnly = true;
        essayEl.classList.add("disabled");
      }
  
      const score = gradeEssay(userText, q.answer);
      const stars = "★".repeat(score) + "☆".repeat(5 - score);
      const scoreEl = document.getElementById(\`essayScore\${qIndex}\`);
      if (scoreEl) {
        const scoreClass = score >= 3 ? "correct" : score >= 1 ? "partial" : "wrong";
        scoreEl.innerHTML = \`<strong>Score: \${score}/5</strong> &nbsp;<span style="color:#f59e0b;font-size:1.15em">\${stars}</span>\`;
        scoreEl.className = \`essay-score show \${scoreClass}\`;
      }
  
      const modelEl = document.getElementById(\`modelAns\${qIndex}\`);
      if (modelEl) modelEl.classList.add("show");
  
      return score;
    },
  
    handleMCQSubmission(q, qIndex) {
      const userAns = this.userAnswers[qIndex];
      // Handle both single correct answer and multiple correct answers (array)
      const isAnswerCorrect = (ans, correct) => {
        if (ans === undefined || ans === null) return false;
        if (Array.isArray(correct)) return correct.includes(ans);
        return ans === correct;
      };
      const isCorrect = isAnswerCorrect(userAns, q.correct);
  
      const card = document.getElementById(\`q\${qIndex}\`);
      const buttons = card.querySelectorAll(".option-btn");
      
      buttons.forEach((btn, k) => {
        btn.classList.add("disabled");
        btn.disabled = true;
        // Handle both single and array of correct answers
        const isCorrectOption = Array.isArray(q.correct) ? q.correct.includes(k) : k === q.correct;
        if (isCorrectOption) {
          btn.classList.add("correct");
        } else if (k === userAns && !isCorrect) {
          btn.classList.add("wrong");
        }
      });
  
      return isCorrect;
    },
  
    showResults(mcqCorrect, mcqTotal, essayScore, essayMaxScore, actualPercentage) {
      const totalScore = mcqCorrect + essayScore;
      const totalPossible = mcqTotal + essayMaxScore;
      // Use the pre-computed actualPercentage from calculateQuizMetrics when available;
      // fall back to local computation for backwards-compatibility (e.g. direct calls).
      const percent = (actualPercentage !== undefined)
        ? actualPercentage
        : (totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0);
      const passed = percent >= 70;
  
      const hasEssay = essayMaxScore > 0;
      const hasMcq = mcqTotal > 0;
  
      let scoreBreakdown = "";
      if (hasMcq && hasEssay) {
        const essayPct = Math.round((essayScore / essayMaxScore) * 100);
        const essayStars = "★".repeat(Math.round(essayScore / essayMaxScore * 5)) + "☆".repeat(5 - Math.round(essayScore / essayMaxScore * 5));
        scoreBreakdown = \`
          <p><strong>جميع الأسئلة:</strong> \${totalScore} / \${totalPossible}</p>
          <p><strong>الإختياري:</strong> صحيح \${mcqCorrect} / \${mcqTotal}</p>
          <p><strong>المقالي:</strong><span style="color:#f59e0b">\${essayStars}</span> نقطة &nbsp; \${essayScore} / \${essayMaxScore}</p>
        \`;
      } else if (hasEssay) {
        const essayStars = "★".repeat(Math.round(essayScore / essayMaxScore * 5)) + "☆".repeat(5 - Math.round(essayScore / essayMaxScore * 5));
        scoreBreakdown = \`
          <p><strong>المقالي:</strong> نقطة \${essayScore} / \${essayMaxScore}</p>
          <p><strong>التقييم:</strong> <span style="color:#f59e0b;font-size:1.15em">\${essayStars}</span></p>
        \`;
      } else {
        scoreBreakdown = \`<p><strong>Score:</strong> \${mcqCorrect} / \${mcqTotal} correct</p>\`;
      }
      
      const resultsDiv = document.getElementById("results");
      resultsDiv.innerHTML = \`
        <div class="score-circle \${passed ? "pass" : "fail"}">
          \${percent}%
        </div>
        <h2>\${passed ? "🎉 Great Job!" : "📚 استمر في المذاكرة!"}</h2>
        <div class="results-detail">
          \${scoreBreakdown}
          <p><strong>الدرجة النهائية:</strong> <span>\${percent}%</span></p>
          \${(hasMcq && hasEssay) ? \`<p><strong>درجة الإختياري:</strong> <span>\${mcqTotal > 0 ? Math.round((mcqCorrect / mcqTotal) * 100) : 0}%</span></p>\` : ""}
          <p><strong>الحالة:</strong> <span>\${passed ? "✓ ناجح" : "✗ ساقط"}</span></p>
          <p><strong>الوقت:</strong> <span>\${document.getElementById('timerDisplay').textContent}</span></p>
        </div>
        <p style="margin-top:20px;color:var(--text-muted)">اذهب للأعلى لمراجعة الإجابات الصحيحة</p>
      \`;
      
      resultsDiv.classList.add("show");
      setTimeout(() => {
        resultsDiv.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
      
      this.showToast(\`انتهى الامتحان! درجتك هي: \${percent}%\`, 'success');
    },
  
    reset() {
      this.showModal(
        "إعادة الامتحان",
        "<p>هل أنت متأكد من إعادة الامتحان؟ ستفقد جميع إجاباتك.</p>",
        () => this.performReset()
      );
    },
  
    performReset() {
      this.closeModal();
      this.submitted = false;
      this.userAnswers = new Array(questions.length).fill(null);
      this.currentQuestion = 0;
      this.flaggedQuestions.clear();
  
      document.getElementById("results").classList.remove("show");
      document.getElementById("submitBtn").disabled = false;
      document.getElementById("submitBtn").classList.remove('loading');
      document.getElementById('reviewBtn').disabled = false;
      
      this.renderQuiz();
      this.renderNav();
      this.updateProgress();
      this.setupImageLoading();
      
      this.stopTimer();
      this.startQuizTimer();
      
      localStorage.removeItem('quiz_progress');
      
      window.scrollTo({ top: 0, behavior: "smooth" });
      this.showToast('Quiz reset', 'info');
      this.announceToScreenReader('Quiz has been reset');
    },
  
    showModal(title, bodyHTML, onConfirm = null) {
      const modal = document.getElementById("modal");
      document.getElementById("modalTitle").textContent = title;
      document.getElementById("modalBody").innerHTML = bodyHTML;
      
      const confirmBtn = document.getElementById("modalConfirm");
      if (onConfirm) {
        confirmBtn.style.display = 'inline-flex';
        confirmBtn.onclick = onConfirm;
      } else {
        confirmBtn.style.display = 'none';
      }
      
      modal.classList.add("show");
      
      setTimeout(() => {
        const firstBtn = modal.querySelector('.btn');
        if (firstBtn) firstBtn.focus();
      }, 100);
    },
  
    closeModal() {
      document.getElementById("modal").classList.remove("show");
    },
  
    setupModalClickOutside() {
      document.getElementById("modal").addEventListener("click", (e) => {
        if (e.target.id === "modal") {
          this.closeModal();
        }
      });
    },
  
    setupKeyboardNavigation() {
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this.closeModal();
          this.closeMenu();
        }
        
        if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey) {
          const modal = document.getElementById("modal");
          if (!modal.classList.contains("show")) {
            this.toggleMenu();
          }
        }
        
        if (e.key >= '1' && e.key <= '4' && !this.submitted) {
          const optIndex = parseInt(e.key) - 1;
          const q = questions[this.currentQuestion];
          if (!this.isEssayQuestion(q) && optIndex < q.options.length) {
            this.selectAnswer(this.currentQuestion, optIndex);
          }
        }
        
        if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey) {
          const targetEl = e.target;
          if (targetEl.tagName !== 'TEXTAREA' && targetEl.tagName !== 'INPUT') {
            e.preventDefault();
            this.jumpToQuestion(Math.min(this.currentQuestion + 1, questions.length - 1));
          }
        }
        
        if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey) {
          const targetEl = e.target;
          if (targetEl.tagName !== 'TEXTAREA' && targetEl.tagName !== 'INPUT') {
            e.preventDefault();
            this.jumpToQuestion(Math.max(this.currentQuestion - 1, 0));
          }
        }
        
        if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) {
          const targetEl = e.target;
          if (targetEl.tagName !== 'TEXTAREA' && targetEl.tagName !== 'INPUT') {
            e.preventDefault();
            this.toggleFlag(this.currentQuestion);
          }
        }
      });
    },
  
    handleOptionKeydown(event, qIndex, optIndex) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.selectAnswer(qIndex, optIndex);
      }
    },
  
    announceToScreenReader(message) {
      const liveRegion = document.getElementById('liveRegion');
      if (liveRegion) {
        liveRegion.textContent = message;
        setTimeout(() => {
          liveRegion.textContent = '';
        }, 1000);
      }
    },
  
    trapFocus(element) {
      const focusableElements = element.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
  
      element.addEventListener('keydown', function(e) {
        if (e.key !== 'Tab') return;
  
        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            lastFocusable.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            firstFocusable.focus();
            e.preventDefault();
          }
        }
      });
    },
  
    printQuiz() {
      this.closeMenu();
      setTimeout(() => window.print(), 100);
    },
  
    showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = \`toast toast-\${type}\`;
      toast.innerHTML = \`
        <span class="toast-icon" aria-hidden="true">\${type === 'success' ? '✓' : 'ℹ'}</span>
        <span class="toast-message">\${message}</span>
      \`;
      
      document.body.appendChild(toast);
      
      requestAnimationFrame(() => {
        toast.classList.add('show');
      });
      
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
      
      this.announceToScreenReader(message);
    }
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => quizApp.init());
  } else {
    quizApp.init();
  }
  
  document.addEventListener('click', function(e) {
    if (e.target.closest('.btn, .option-btn')) {
      const btn = e.target.closest('.btn, .option-btn');
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = e.clientX - rect.left - size/2 + 'px';
      ripple.style.top = e.clientY - rect.top - size/2 + 'px';
      
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    }
  });
  
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const cards = document.querySelectorAll('.question-card');
      const viewportCenter = window.innerHeight / 2;
      
      cards.forEach((card, index) => {
        const rect = card.getBoundingClientRect();
        if (rect.top < viewportCenter && rect.bottom > viewportCenter) {
          if (quizApp.currentQuestion !== index) {
            quizApp.currentQuestion = index;
            quizApp.updateAllNavButtons();
          }
        }
      });
    }, 100);
  }, { passive: true });
  </script>
  </body>
  </html>`;

  const blob = new Blob([quizHTML], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${config.title || "Basmagi Quiz"}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNotification(
    "تم تحميل الامتحان بنجاح",
    "هو لديك الآن",
    "./favicon.png",
  );
}

// Image Helpers
const convertImagesToBase64 = async (questions) => {
  const processedQuestions = [];

  for (const question of questions) {
    const processedQuestion = { ...question };

    if (question.image) {
      // If it's a local path or needs conversion
      if (isLocalPath(question.image)) {
        console.log(`Converting local image to base64: ${question.image}`);
        const base64 = await getDataUrl(question.image);
        if (base64) {
          processedQuestion.image = base64;
        } else {
          console.warn(`Failed to convert ${question.image}, keeping original`);
          // Keep original - will show alt text if broken
        }
      }
      // Remote URLs or already base64 - keep as is
    }

    processedQuestions.push(processedQuestion);
  }

  return processedQuestions;
};

const getDataUrl = (url) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      try {
        resolve(canvas.toDataURL("image/jpeg"));
      } catch (e) {
        console.warn("Failed to convert image to data URL", e);
        resolve(null);
      }
    };
    img.onerror = () => {
      console.warn("Failed to load image for PDF export", url);
      resolve(null);
    };
    img.src = url;
  });
};

const isLocalPath = (url) => {
  if (!url) return false;
  // Check for relative paths (./, ../, or no protocol)
  if (url.startsWith("./") || url.startsWith("../") || url.startsWith("/")) {
    return true;
  }
  // Check if it lacks a protocol (http://, https://, data:)
  return !/^(https?:|data:)/i.test(url);
};
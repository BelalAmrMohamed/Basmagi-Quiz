// public/src/features/export/export-to-quiz.js
// Downloads the quiz as a standalone file (.html)
// Deals with the export from the main page, create-quiz page, and results page
// No libraries used.

import { showNotification } from "../../components/notifications/notifications.js";

// Question helpers
import { gradeEssay, calculateQuizMetrics, isAnswerCorrect } from "../../shared/rate-answers.js";

// Shared media URL resolution (relative-to-platform-origin -> absolute URL).
// See public/src/shared/media-url.js for the full rationale.
import { resolveMediaUrl, isLocalPath } from "../../shared/media-url.js";

import {
  renderMarkdown,
  _renderMarkdownCore,
  scanDirections,
  detectDirection,
  applyInline,
  escHtml,
  highlightCode,
  _ownText,
  _processElement,
  _processByLine,
  _applyDirectionClass,
  _HL_KEYWORDS,
  _HL_BUILTINS_JS,
  _CSS_VALUE_KEYWORDS,
  _SKIP_TAGS,
  _LTR_ONLY_SELECTOR,
  _BLOCK_CHILD_SELECTOR,
  _LABEL_PREFIX_REGEX,
  _FIRST_STRONG_CHAR_REGEX,
  _ARABIC_REGEX,
  unescapeHtmlEntities,
  detectLang,
  ICON_COPY,
  ICON_CHECK,
  COPY_LABEL,
} from "../../shared/markdown.js";

import { MARKDOWN_CSS } from "../../shared/markdown-css.js";

import { buildQuizInfoModalHtml, fetchCreatorProfile } from "../../components/quiz-info-modal/quiz-info-html.js";
import { QuizInfoModalCSS } from "../../components/quiz-info-modal/quiz-info-modal-css.js";

// Keyboard-shortcut help modal markup (⌨️ Keyboard Shortcuts dialog) —
// generated once at export time since it's pure/static HTML with no
// dependency on quiz content. The wiring (initKeyboardNav-equivalent
// keydown listener) is baked in separately below, adapted to this
// export's own DOM shape — see setupKeyboardNavigation().
import { getShortcutModalHTML } from "../quiz/keyboard-nav.js";

// Builds the <tr> rows for the quiz-info dialog at export time (the dialog
// content is static once downloaded, so this runs once here rather than
// being re-derived client-side). Field set and Arabic labels match the
// quiz-info dialog used on the results page exactly.


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

// Deterministic short hash used to namespace this quiz's localStorage
// progress key when config.id isn't available (see progressKeySuffix in
// buildStandaloneQuizHtml). Not cryptographic — just needs to be stable
// across re-exports of the exact same quiz content and different across
// distinct quizzes. FNV-1a over title + question count + every question's
// own text, so two quizzes sharing a title still hash differently.
const hashQuizIdentity = (title, processedQuestions) => {
  const identity =
    (title || "") +
    "|" +
    processedQuestions.length +
    "|" +
    processedQuestions.map((q) => q.q || "").join("|");

  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Unsigned, base36 for compactness.
  return (hash >>> 0).toString(36);
};

export async function buildStandaloneQuizHtml(config, questions, exportOptions = {}) {
  const {
    showAnswersButton = false,
    layout = "pagination",
  } = exportOptions;
  const processedQuestions = await convertImagesToBase64(questions);

  const authorIdentifier = config.authorId || config.authorHandle;
  let creatorProfile = null;
  if (authorIdentifier) {
    const type = config.authorId ? "id" : "handle";
    creatorProfile = await fetchCreatorProfile(authorIdentifier, type);
    if (creatorProfile && creatorProfile.avatarUrl) {
      const base64 = await getDataUrl(creatorProfile.avatarUrl);
      if (base64) {
        creatorProfile.avatarUrl = base64;
      }
      const cleanHandle = creatorProfile.handle ? creatorProfile.handle.replace(/^@/, "") : "";
      if (cleanHandle) {
        creatorProfile.profileUrl = `https://basmagi-quiz.vercel.app/@${encodeURIComponent(cleanHandle)}`;
      }
    }
  }

  // ── Per-quiz progress-storage namespace ──────────────────────────
  // Every exported .html file is opened from the same browser/origin
  // (or the same file:// context), so a single hardcoded localStorage
  // key like 'quiz_progress' would collide across every quiz the
  // reader has ever downloaded — opening a brand-new quiz could
  // incorrectly restore answers left over from a completely different
  // quiz. config.id is the ideal namespace when the quiz has one (a
  // saved/published quiz on the platform), but a fresh quiz exported
  // straight from the create-quiz page has no id at all — so this
  // falls back to a short deterministic hash derived from content
  // that's fixed for this quiz forever (title + question count + the
  // literal text of every question, so two same-titled quizzes with
  // different content still get different keys). Baked in once here
  // at export time, exactly like EXPORT_LAYOUT below — never
  // recomputed client-side, so it can't drift from run to run.
  const progressKeySuffix =
    config.id ||
    hashQuizIdentity(config.title, processedQuestions);

  const quizInfoModalHtml = buildQuizInfoModalHtml(config, processedQuestions.length, creatorProfile);

  return `<!DOCTYPE html>
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
        // NOTE: these are plain string literals baked in at export time from
        // the live markdown.js module's ICON_CHECK/ICON_COPY/COPY_LABEL —
        // NOT references to those exports (this file has no import/module
        // binding for them). Do not rewrite as \`const ICON_CHECK = \${ICON_CHECK}\`
        // — that self-references the const being declared and throws
        // "Cannot access 'ICON_CHECK' before initialization".
        const ICON_CHECK = ${JSON.stringify(ICON_CHECK)};
        const ICON_COPY = ${JSON.stringify(ICON_COPY)};
        const COPY_LABEL = ${JSON.stringify(COPY_LABEL)};

        // window.copyCodeBlock is registered here (rather than relying on
        // markdown.js's own module-level \`window.copyCodeBlock = ...\` side
        // effect) because that assignment is not a named function — the
        // .toString()-based serialization used for every other markdown.js
        // helper further down this file can't capture a bare arrow-function
        // assignment statement, only function declarations/expressions.
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

    --bg-primary:    #000000;
    --bg-secondary:  #0a0a0a;
    --bg-tertiary:   #1a1a1a;
    --text-primary:  #f5f5f5;
    --text-secondary:#c4c4c4;
    --text-muted:    #8a8a8a;
    --border-color:  #262626;
    --card-bg:       #0a0a0a;
    --card-answered: #14140f;

    --success-bg:   #051b12;
    --success-text: #6ee7b7;
    --error-bg:     #200606;
    --error-text:   #fca5a5;
    --warning-bg:   #1a1206;
    --warning-text: #fcd34d;
    --info-bg:      #06121f;
    --info-text:    #93c5fd;

    --shadow-sm: 0 1px 3px rgba(0,0,0,0.5);
    --shadow-md: 0 4px 16px rgba(0,0,0,0.6), 0 1px 4px rgba(0,0,0,0.4);
    --shadow-lg: 0 20px 60px rgba(0,0,0,0.8);
  }

  /* ── Dark-mode glow/shadow neutralization ────────────────────────
     The brand purple/indigo (--gradient-start/--gradient-end) is kept
     on interactive elements in dark mode (buttons, links, selected/
     focus borders) intentionally — that's a normal accent color and
     reads fine on true black. What doesn't read well is the *ambient*
     ombre glow these hardcoded rgba(102,126,234,...) shadows/rings
     create when spread across large ombre ambient chrome (the menu
     toggle's floating shadow, the current-nav-question badge glow,
     the primary button's drop shadow, the essay textarea's focus
     ring, text selection tint, and the scrollbar thumb) — on a true
     black background these read as a purple/blue haze bleeding across
     the UI rather than a normal, contained shadow. Dimming their
     alpha and, for the largest ambient ones, tightening spread keeps
     the same brand hue as a subtle cue without the glow. */
  [data-theme="dark"] ::selection {
    background: rgba(102, 126, 234, 0.28);
  }

  [data-theme="dark"] .menu-toggle {
    box-shadow: 0 4px 16px rgba(102, 126, 234, 0.18);
  }

  [data-theme="dark"] .menu-toggle:hover {
    box-shadow: 0 6px 22px rgba(102, 126, 234, 0.28);
  }

  [data-theme="dark"] .nav-btn.current {
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.22);
  }

  [data-theme="dark"] .question-num {
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.18);
  }

  [data-theme="dark"] .essay-input:focus {
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.16);
  }

  [data-theme="dark"] .btn-primary {
    box-shadow: 0 2px 12px rgba(102, 126, 234, 0.2);
  }

  [data-theme="dark"] .btn-primary:hover:not(:disabled) {
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.3);
  }

  [data-theme="dark"] .btn-primary:active:not(:disabled) {
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.15);
  }

  [data-theme="dark"] html {
    scrollbar-color: #4a4d8f transparent;
  }

  [data-theme="dark"] html::-webkit-scrollbar-thumb {
    background-color: #4a4d8f;
  }

  /* ── Base ────────────────────────────────────────────────────── */
  [data-theme="dark"] body { background: #000000; }

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
    transform: translateY(7.5px) rotate(45deg);
  }

  .menu-toggle.active span:nth-child(2) {
    opacity: 0;
    transform: scaleX(0);
  }

  .menu-toggle.active span:nth-child(3) {
    transform: translateY(-7.5px) rotate(-45deg);
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

  html[data-motion="reduced"] .quiz-info-dialog-header h2 {
    animation: none;
    opacity: 1;
    transform: none;
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

  .question-badge.truefalse {
    background: var(--info-bg);
    color: var(--info-text);
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

  /* ── Per-question "تحقق من الإجابة" (Check Answer) button ──────── */
  .check-answer-btn {
    background: var(--gradient);
    color: #fff;
    border: none;
    padding: 12px 24px;
    border-radius: var(--radius-md);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform var(--t-fast), box-shadow var(--t-fast), opacity var(--t-fast);
    box-shadow: var(--shadow-sm);
    width: 100%;
    margin-top: 16px;
    text-align: center;
  }

  .check-answer-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .check-answer-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .check-answer-btn.hidden {
    display: none;
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

  /* When relocated into the side menu (pagination mode — see
     setupPager()), the bar drops its fixed-footer chrome and stacks
     its buttons full-width like the rest of the menu's actions. */
  .menu-controls-slot .controls.controls-in-menu {
    padding: 0;
    border-top: none;
    background: transparent;
    flex-direction: column;
    align-items: stretch;
    margin-top: 10px;
  }

  .menu-controls-slot .controls.controls-in-menu .btn {
    width: 100%;
  }

  /* ── Pagination mode ─────────────────────────────────────────────
     When EXPORT_LAYOUT === "pagination", quizApp.applyPagerVisibility()
     toggles this class on .quiz-body and adds .pg-active to exactly one
     .question-card at a time — every other card is hidden outright
     (not just scrolled away) so the file behaves like a real
     one-question-per-page flow instead of a long scroll. Vertical mode
     (the previous/default behavior) never gets this class, so every
     card stays visible exactly as before. ─────────────────────────── */
  .quiz-body.paginated .question-card {
    display: none;
  }

  .quiz-body.paginated .question-card.pg-active {
    display: block;
    margin-bottom: 0;
  }

  .pager-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 16px 24px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
  }

  .pager-status {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
    min-width: 64px;
    text-align: center;
  }

  .pager-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  @media (max-width: 600px) {
    .pager-controls { padding: 12px 16px; gap: 10px; }
    .pager-btn { flex: 1; }
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
  ${QuizInfoModalCSS}

  /* ── Print ───────────────────────────────────────────────────── */
  @media print {
    body { background: white; padding: 0; }

    .menu-toggle, .side-menu, .side-menu-overlay,
    .controls, .toast, .skip-link, .pager-controls { display: none !important; }

    /* Pagination mode only ever keeps the current .pg-active card
       visible on screen (see .quiz-body.paginated .question-card
       above) — printing would otherwise print just that single
       question. Force every card visible for print regardless of
       EXPORT_LAYOUT/pagination state, so printQuiz() always prints
       the whole exam. */
    .quiz-body.paginated .question-card {
      display: block !important;
    }

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
    .desktop-only { display: none; }

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
  html[data-motion="reduced"] *,
  html[data-motion="reduced"] *::before,
  html[data-motion="reduced"] *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
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

        <div class="toggle-option high-performance-toggle-container" id="highPerformanceToggleOption" role="switch" aria-checked="false" tabindex="0">
          <div class="toggle-label">
            <span aria-hidden="true">⚡</span>
            <span>الأداء الفائق</span>
          </div>
          <div class="toggle-switch" id="highPerformanceSwitch">
            <div class="toggle-slider"></div>
          </div>
        </div>

        ${showAnswersButton ? `<div class="toggle-option" id="showAnswersToggle" role="switch" aria-checked="false" tabindex="0">
          <div class="toggle-label">
            <span aria-hidden="true">🔑</span>
            <span>إظهار كل الإجابات</span>
          </div>
          <div class="toggle-switch" id="showAnswersSwitch">
            <div class="toggle-slider"></div>
          </div>
        </div>` : ""}
      </div>
      
      <div class="menu-section">
        <h3>الإجراءات</h3>
        <button class="btn btn-secondary btn-block" onclick="quizApp.printQuiz()">
          🖨️ إطبع الامتحان
        </button>
        <button class="btn btn-secondary btn-block desktop-only" onclick="quizApp.toggleShortcutModal()" style="margin-top: 8px;">
          ⌨️ اختصارات لوحة المفاتيح
        </button>
        <div class="menu-controls-slot" id="menuControlsSlot"></div>
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
${quizInfoModalHtml}
    </dialog>

    <main id="main-content" class="quiz-body"></main>

    <div class="pager-controls" id="pagerControls" style="display:none;">
      <button class="btn btn-secondary pager-btn" id="pagerPrevBtn" onclick="quizApp.pagerGo(-1)">السابق</button>
      <span class="pager-status" id="pagerStatus">1 / ${processedQuestions.length}</span>
      <button class="btn btn-primary pager-btn" id="pagerNextBtn" onclick="quizApp.pagerGo(1)">التالي</button>
    </div>
    
    <div class="controls" id="controlsBar">      
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

  ${getShortcutModalHTML([
    ["→", "السؤال التالي"],
    ["←", "السؤال السابق"],
    ["↑ / ↓", "اختيار الخيار المجاور"],
    ["1 – 9", "اختيار خيار برقمه"],
    ["Enter", "تحقق من الإجابة"],
    ["F", "علّم السؤال للمراجعة"],
    ["M", "فتح/إغلاق القائمة"],
    ["?", "إظهار/إخفاء هذه القائمة"],
  ])}
  
  <script>
  const questions = ${JSON.stringify(processedQuestions)};

  // Export-time settings baked in from the download modal's settings
  // panel (see download-quiz-modal.js) — these decide whether the
  // "🔑 Show All Answers" button exists at all, and whether questions
  // are laid out as one continuous vertical scroll or one-at-a-time with
  // Next/Previous pagination. Both are fixed once the file is generated;
  // the reader has no in-file control over either (unlike the dark-mode/
  // show-answers *value* toggles, which remain fully reader-side).
  const EXPORT_SHOW_ANSWERS_BUTTON = ${JSON.stringify(!!showAnswersButton)};
  const EXPORT_LAYOUT = ${JSON.stringify(layout === "vertical" ? "vertical" : "pagination")};

  // Namespaces this quiz's saved progress so it can't collide with any
  // other quiz previously downloaded and opened from the same browser/
  // origin (see hashQuizIdentity()/progressKeySuffix at export time —
  // this value is fixed for this specific exported file forever).
  // quizTheme and quiz_high_performance_pref are intentionally left
  // un-namespaced/shared below — those are reader display preferences,
  // not per-quiz answer state, so sharing them across every downloaded
  // quiz is the desired behavior.
  const PROGRESS_STORAGE_KEY = ${JSON.stringify(`quiz_progress_${progressKeySuffix}`)};

  // ── Safe localStorage wrapper ──
  // Downloaded quizzes are routinely opened straight from disk
  // (file:///D:/Downloads/...), and file:// pages have an OPAQUE origin in
  // every major browser — any localStorage access on an opaque origin
  // throws a synchronous, UNCAUGHT SecurityError, not just a quota/privacy
  // warning. loadPreferences() calls localStorage.getItem() unconditionally
  // during init(), so without this wrapper the entire quiz app crashes
  // before a single question renders whenever the file is opened locally
  // rather than served over http(s). Every direct localStorage.* call below
  // goes through this instead so dark-mode/progress-saving simply becomes a
  // no-op (rather than a page-breaking crash) in that environment, while
  // behaving completely normally when the quiz is hosted/served normally.
  const safeStorage = {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* opaque origin or storage disabled — ignore */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* opaque origin or storage disabled — ignore */ }
    },
  };

  // ── Markdown + KaTeX integration (mirrored from create-quiz) ──
  // All functions are serialised from module scope via .toString() so the
  // generated file is self-contained with no build step needed.
  // highlightCode's own module-level dependencies (_HL_KEYWORDS,
  // _HL_BUILTINS_JS) aren't functions, so .toString() can't carry them —
  // they're rebuilt as JS source text via the serialize* helpers above.

  const _HL_KEYWORDS = ${serializeHlKeywords(_HL_KEYWORDS)};

  const _HL_BUILTINS_JS = ${serializeHlBuiltinsJs(_HL_BUILTINS_JS)};

  // highlightCode's CSS branch reads this Set too — same bare-closure-
  // reference situation as _HL_KEYWORDS/_HL_BUILTINS_JS above.
  const _CSS_VALUE_KEYWORDS = ${serializeHlBuiltinsJs(_CSS_VALUE_KEYWORDS)};

  // _renderMarkdownCore's fenced-code-block branch references ICON_COPY /
  // COPY_LABEL by bare closure reference (not as params), same story as
  // _HL_KEYWORDS/_HL_BUILTINS_JS above — .toString() can't carry them, so
  // they're baked in here as plain string literals from the live
  // markdown.js module's exports at export time. This is the ONLY
  // declaration of ICON_COPY in this script — it used to also be
  // separately declared near the top (for the app's own copy-button UI,
  // before this markdown dependency was discovered), which caused a
  // same-scope "Identifier 'ICON_COPY' has already been declared"
  // SyntaxError that broke every exported quiz .html file at parse time.
  // Do not add another const ICON_COPY = ... anywhere else in this
  // script — reuse this one.
  const ICON_COPY = ${JSON.stringify(ICON_COPY)};
  const COPY_LABEL = ${JSON.stringify(COPY_LABEL)};

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

  ${unescapeHtmlEntities.toString()}
  
  ${detectLang.toString()}

  ${_ownText.toString()}

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
    showAllAnswers: false,
    flaggedQuestions: new Set(),
    // Per-question "تحقق من الإجابة" state — indices the reader has
    // checked. Purely a display lock (reveals correct/wrong + explanation
    // for that one question) that's independent of the whole-quiz
    // submit()/submitted flow, mirroring quiz.js's checkAnswerForQuestion.
    lockedQuestions: new Set(),
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
      this.setupPager();
      this.announceToScreenReader('Quiz loaded. ' + questions.length + ' questions available.');
    },

    // ── Pagination mode ── EXPORT_LAYOUT is baked in at export time (see
    // download-quiz-modal.js's settings panel); "vertical" leaves the
    // pager controls hidden and every card visible (previous behavior).
    // In pagination mode, the exam actions (تسليم الامتحان / إعادة
    // الامتحان / مراجعة) move into the side menu's "الإجراءات" section
    // instead of sitting as a fixed footer bar under the single active
    // question — the footer bar reads as "attached to every question"
    // in that context since it's the only thing below the lone visible
    // card. This physically relocates the existing #controlsBar element
    // (keeping its real ids/onclick handlers intact, so submit()/reset()/
    // enterReviewMode() and their DOM lookups by id keep working
    // unchanged) into the side menu's slot, rather than duplicating the
    // markup — duplicating would mean two #submitBtn/#reviewBtn elements
    // sharing the same id, which breaks every getElementById() call site.
    setupPager() {
      if (EXPORT_LAYOUT !== "pagination") return;
      const quizBody = document.querySelector(".quiz-body");
      quizBody.classList.add("paginated");
      document.getElementById("pagerControls").style.display = "flex";

      const controlsBar = document.getElementById("controlsBar");
      const menuSlot = document.getElementById("menuControlsSlot");
      if (controlsBar && menuSlot) {
        controlsBar.classList.add("controls-in-menu");
        menuSlot.appendChild(controlsBar);
      }

      this.applyPagerVisibility();
    },

    // Shows only the .question-card matching this.currentQuestion and
    // updates the pager status/button states to match. Safe to call any
    // time currentQuestion changes (jumpToQuestion, pagerGo, nav clicks,
    // review-mode "go to question", reset) — a no-op in vertical mode.
    applyPagerVisibility() {
      if (EXPORT_LAYOUT !== "pagination") return;
      document.querySelectorAll(".question-card").forEach((card, i) => {
        card.classList.toggle("pg-active", i === this.currentQuestion);
      });
      const status = document.getElementById("pagerStatus");
      if (status) status.textContent = \`\${this.currentQuestion + 1} / \${questions.length}\`;
      const prevBtn = document.getElementById("pagerPrevBtn");
      const nextBtn = document.getElementById("pagerNextBtn");
      if (prevBtn) prevBtn.disabled = this.currentQuestion === 0;
      if (nextBtn) nextBtn.disabled = this.currentQuestion === questions.length - 1;
    },

    pagerGo(delta) {
      const target = Math.min(
        Math.max(this.currentQuestion + delta, 0),
        questions.length - 1,
      );
      this.jumpToQuestion(target);
    },

    loadPreferences() {
      const savedTheme = safeStorage.get('quizTheme');
      
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
      safeStorage.set('quizTheme', this.darkMode ? 'dark' : 'light');
      this.applyTheme();
      this.announceToScreenReader(this.darkMode ? 'Dark mode enabled' : 'Light mode enabled');
    },

    // ── "Show All Answers" — turns this single file into an answer key ──
    // Purely a display overlay: it marks the correct option(s) on every
    // question and reveals essay model answers/explanations, but never
    // touches userAnswers/submitted state, never disables inputs, and
    // never runs grading — so it works before, during, or after a real
    // attempt, and toggling it off returns the quiz to exactly the state
    // the learner was in (their selections/typed essay text untouched).
    //
    // Turning it ON is confirmed first (via the same showModal()/onConfirm
    // pattern used by reset()/submit()) since it's a one-click spoiler that
    // can ruin the quiz for the learner — turning it back OFF needs no
    // confirmation since it's simply undoing a display state.
    toggleShowAllAnswers() {
      if (this.showAllAnswers) {
        this.setShowAllAnswers(false);
        return;
      }

      this.showModal(
        "إظهار كل الإجابات",
        "<p>هل أنت متأكد من إظهار كل الإجابات؟ سيتم كشف كل الإجابات الصحيحة الآن.</p>",
        () => {
          this.closeModal();
          this.setShowAllAnswers(true);
        }
      );
    },

    // Actually applies the show/hide-all-answers state. Split out of
    // toggleShowAllAnswers() so the confirmation modal above can gate only
    // the reveal path, not the hide path.
    setShowAllAnswers(value) {
      this.showAllAnswers = value;
      const toggleSwitch = document.getElementById('showAnswersSwitch');
      const toggleOption = document.getElementById('showAnswersToggle');
      if (toggleSwitch) toggleSwitch.classList.toggle('active', this.showAllAnswers);
      if (toggleOption) toggleOption.setAttribute('aria-checked', String(this.showAllAnswers));

      if (this.showAllAnswers) {
        this.revealAllAnswers();
      } else {
        this.hideAllAnswers();
      }
      this.announceToScreenReader(this.showAllAnswers ? 'All answers shown' : 'All answers hidden');
    },

    revealAllAnswers() {
      questions.forEach((q, i) => {
        const card = document.getElementById(\`q\${i}\`);
        if (!card) return;

        if (isEssayQuestion(q)) {
          const modelEl = document.getElementById(\`modelAns\${i}\`);
          if (modelEl) modelEl.classList.add('show', 'answer-key-reveal');
        } else {
          const isMultiple = Array.isArray(q.correct);
          card.querySelectorAll('.option-btn').forEach((btn, k) => {
            const isCorrectOption = isMultiple ? q.correct.includes(k) : k === q.correct;
            if (isCorrectOption) btn.classList.add('correct', 'answer-key-reveal');
          });
        }

        const exp = document.getElementById(\`exp\${i}\`);
        if (exp) exp.classList.add('show', 'answer-key-reveal');
      });
    },

    hideAllAnswers() {
      // Only strips what revealAllAnswers() itself added (tagged via the
      // answer-key-reveal marker class), so a genuinely-submitted
      // question's real correct/wrong/show state — which uses the same
      // classes without the marker — is left exactly as it was.
      document.querySelectorAll('.answer-key-reveal').forEach((el) => {
        el.classList.remove('answer-key-reveal', 'correct', 'show');
      });
    },
  
    saveProgress() {
      const state = {
        answers: this.userAnswers,
        flagged: Array.from(this.flaggedQuestions),
        currentQuestion: this.currentQuestion,
        timestamp: Date.now()
      };
      safeStorage.set(PROGRESS_STORAGE_KEY, JSON.stringify(state));
    },
  
    loadProgress() {
      const saved = safeStorage.get(PROGRESS_STORAGE_KEY);
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

      // ── "الأداء الفائق" (High Performance Mode) — global motion
      // kill-switch, ported from the main platform's theme-controller.js.
      // Persisted separately from dark mode so it survives across visits
      // to this standalone file the same way it does on the live site.
      const highPerformanceToggle = document.getElementById('highPerformanceToggleOption');
      if (highPerformanceToggle) {
        const applyHighPerformance = (enabled) => {
          document.documentElement.setAttribute('data-motion', enabled ? 'reduced' : 'normal');
          safeStorage.set('quiz_high_performance_pref', enabled ? 'enabled' : 'disabled');
          const sw = document.getElementById('highPerformanceSwitch');
          if (sw) sw.classList.toggle('active', enabled);
          highPerformanceToggle.setAttribute('aria-checked', String(enabled));
        };
        const savedHighPerformance = safeStorage.get('quiz_high_performance_pref') === 'enabled';
        applyHighPerformance(savedHighPerformance);

        highPerformanceToggle.addEventListener('click', () => {
          const enabled = document.documentElement.getAttribute('data-motion') !== 'reduced';
          applyHighPerformance(enabled);
          this.announceToScreenReader(enabled ? 'High performance mode enabled' : 'High performance mode disabled');
        });

        highPerformanceToggle.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            highPerformanceToggle.click();
          }
        });
      }

      // Only present in the DOM when EXPORT_SHOW_ANSWERS_BUTTON was
      // enabled at export time (see the side-menu markup above) — the
      // control (and its wiring) is skipped entirely otherwise.
      const showAnswersToggle = document.getElementById('showAnswersToggle');
      if (showAnswersToggle) {
        showAnswersToggle.addEventListener('click', () => this.toggleShowAllAnswers());

        showAnswersToggle.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            showAnswersToggle.click();
          }
        });
      }
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
      // renderQuestion() built fresh nodes with no reveal markers on them —
      // if the answer key was switched on, re-apply it to the new DOM.
      if (this.showAllAnswers) this.revealAllAnswers();
      // Fresh nodes also have no .pg-active marker — reapply pagination
      // (a no-op in vertical mode).
      this.applyPagerVisibility();
    },
  
    renderQuestion(q, i) {
      const isEssay = isEssayQuestion(q);
      const isTrueFalse = !isEssay && Array.isArray(q.options) && q.options.length === 2;
      const badgeText = isEssay ? "مقالي" : (isTrueFalse ? "صح أم خطأ" : "إختياري");
      const badgeClass = isEssay ? "essay" : (isTrueFalse ? "truefalse" : "");
      const isLocked = this.lockedQuestions.has(i);
      const hasOptions = !isEssay && Array.isArray(q.options) && q.options.length > 0;
      // "Check Answer" only makes sense once submission itself is still
      // meaningful (before the whole quiz is submitted) and there's an
      // actual answer to check against — essay questions and MCQ/T-F
      // both qualify; the "no options, no essay answer" fallback case
      // does not (nothing to check).
      const canCheckAnswer = !this.submitted && (isEssay || hasOptions);
      const userAnswerForCheck = this.userAnswers[i];
      const hasUserResponse = isEssay
        ? typeof userAnswerForCheck === "string" && userAnswerForCheck.trim() !== ""
        : userAnswerForCheck !== null && userAnswerForCheck !== undefined &&
          (!Array.isArray(userAnswerForCheck) || userAnswerForCheck.length > 0);
  
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
            \${isLocked ? "readonly" : ""}
          >\${savedAnswer}</textarea>
          <div class="char-count" id="charCount\${i}">
            \${savedAnswer.length} حروف
          </div>
          <div class="model-answer\${isLocked ? " show" : ""}" id="modelAns\${i}">
            <strong class="answer-label">✓ Model Answer</strong><br>
            \${renderMarkdown(q.answer)}
          </div>
          <div class="essay-score" id="essayScore\${i}"></div>
        \`;
      } else if (!Array.isArray(q.options) || q.options.length === 0) {
        // Fix #empty-render-fallback: neither essay (isEssayQuestion needs
        // q.answer !== undefined) nor valid MCQ (no options array) — e.g. a
        // multi-part free-response question. q.options.map() below would
        // otherwise throw on undefined and crash renderQuiz() for the
        // ENTIRE quiz (not just this one question), since renderQuestion()
        // is called synchronously for every question in one .map() chain.
        optionsHtml = q.answer
          ? \`<div class="model-answer" style="display:block;">
              <strong class="answer-label">✓ Answer</strong><br>
              \${renderMarkdown(q.answer)}
            </div>\`
          : \`<div class="model-answer" style="display:block; opacity:0.7;">
              <em>لا توجد خيارات إجابة متاحة لهذا السؤال</em>
            </div>\`;
      } else {
        const isMultiple = Array.isArray(q.correct);
        const userSelected = this.userAnswers[i];
        optionsHtml = \`<div class="options">\${
          q.options.map((opt, j) => {
            const letter = String.fromCharCode(65 + j);
            const prefix = isMultiple 
              ? '<input type="checkbox" class="export-checkbox" disabled style="pointer-events: none; margin-right: 12px; transform: scale(1.2); accent-color: var(--gradient-start);">' 
              : \`<span class="option-letter">\${letter}</span>\`;
            // When locked (checked, not full-submit), reflect correct/wrong
            // the same way handleMCQSubmission does at whole-quiz submit —
            // but scoped to just this question's buttons.
            let lockedClass = "";
            if (isLocked) {
              const isCorrectOption = isMultiple ? q.correct.includes(j) : j === q.correct;
              const wasSelected = isMultiple
                ? Array.isArray(userSelected) && userSelected.includes(j)
                : j === userSelected;
              if (isCorrectOption) lockedClass = " correct";
              else if (wasSelected) lockedClass = " wrong";
            }
            return \`
              <button 
                class="option-btn\${lockedClass}\${isLocked ? " disabled" : ""}" 
                id="btn\${i}_\${j}" 
                onclick="quizApp.selectAnswer(\${i}, \${j})"
                onkeydown="quizApp.handleOptionKeydown(event, \${i}, \${j})"
                aria-label="Option \${letter}: \${this.escapeHTML(opt)}"
                \${isLocked ? "disabled" : ""}
              >
                \${prefix}
                <span class="option-label">\${renderMarkdown(opt)}</span>
              </button>
            \`;
          }).join("")
        }</div>\`;
      }
  
      const explanationHtml = q.explanation ? 
        \`<div class="explanation\${isLocked ? " show" : ""}" id="exp\${i}">
          <strong class="answer-label">💡 Explanation</strong> \${renderMarkdown(q.explanation)}
        </div>\` : "";

      const checkAnswerBtnHtml = canCheckAnswer
        ? \`<button class="check-answer-btn\${isLocked ? " hidden" : ""}" 
                    id="checkBtn\${i}"
                    title="إظهار الإجابة الصحيحة"
                    onclick="quizApp.checkAnswerForQuestion(\${i})"
                    \${!hasUserResponse ? "disabled" : ""}>
             تحقق من الإجابة
           </button>\`
        : "";
  
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
          \${checkAnswerBtnHtml}
          \${explanationHtml}
        </div>
      \`;
    },
  
    selectAnswer(qIndex, optIndex) {
      if (this.submitted || this.lockedQuestions.has(qIndex)) return;
  
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
      this.updateCheckAnswerButton(qIndex);
    },
  
    handleEssayInput(qIndex, value) {
      if (this.lockedQuestions.has(qIndex)) return;
      const trimmed = value.trim();
      this.userAnswers[qIndex] = trimmed || null;
      
      const card = document.getElementById(\`q\${qIndex}\`);
      card.classList.toggle("answered", !!trimmed);
      
      this.updateCharCount(qIndex, value);
      this.updateProgress();
      this.updateNavButton(qIndex);
      this.saveProgress();
      this.updateCheckAnswerButton(qIndex);
    },

    // Keeps the per-question "تحقق من الإجابة" button's disabled state in
    // sync with whether there's currently an answer to check — mirrors
    // handleEssayInputForQuestion's check-button sync in quiz.js.
    updateCheckAnswerButton(qIndex) {
      const btn = document.getElementById(\`checkBtn\${qIndex}\`);
      if (!btn) return;
      const q = questions[qIndex];
      const ans = this.userAnswers[qIndex];
      const hasResponse = isEssayQuestion(q)
        ? typeof ans === "string" && ans.trim() !== ""
        : ans !== null && ans !== undefined && (!Array.isArray(ans) || ans.length > 0);
      btn.disabled = !hasResponse;
    },

    // Per-question "تحقق من الإجابة" — locks just this one question and
    // reveals whether the reader's current answer is correct, without
    // touching submitted/userAnswers state or running whole-quiz grading.
    // Ported from quiz.js's window.checkAnswerForQuestion.
    checkAnswerForQuestion(qIndex) {
      if (this.submitted || this.lockedQuestions.has(qIndex)) return;
      const q = questions[qIndex];
      const isEssay = isEssayQuestion(q);
      const ans = this.userAnswers[qIndex];
      if (isEssay) {
        if (typeof ans !== "string" || !ans.trim()) return;
      } else {
        if (ans === null || ans === undefined) return;
        if (Array.isArray(ans) && ans.length === 0) return;
      }

      this.lockedQuestions.add(qIndex);

      if (isEssay) {
        // Reuses handleEssaySubmission's exact grading path (gradeEssay,
        // stars, #essayScore population, model-answer reveal) so a
        // per-question "check" shows the same (score/5) breakdown that
        // whole-quiz submit() already shows — previously this only
        // locked the textarea and revealed the model answer with no
        // grade at all.
        this.handleEssaySubmission(qIndex);
      } else {
        const card = document.getElementById(\`q\${qIndex}\`);
        const buttons = card ? card.querySelectorAll(".option-btn") : [];
        const isMultiple = Array.isArray(q.correct);
        buttons.forEach((btn, k) => {
          btn.classList.add("disabled");
          btn.disabled = true;
          const isCorrectOption = isMultiple ? q.correct.includes(k) : k === q.correct;
          const wasSelected = isMultiple ? Array.isArray(ans) && ans.includes(k) : k === ans;
          if (isCorrectOption) btn.classList.add("correct");
          else if (wasSelected) btn.classList.add("wrong");
        });
      }

      const checkBtn = document.getElementById(\`checkBtn\${qIndex}\`);
      if (checkBtn) checkBtn.classList.add("hidden");

      const exp = document.getElementById(\`exp\${qIndex}\`);
      if (exp) exp.classList.add("show");

      this.announceToScreenReader(\`Question \${qIndex + 1} checked\`);
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
      this.currentQuestion = qIndex;
      this.applyPagerVisibility();
      const card = document.getElementById(\`q\${qIndex}\`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
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

          const checkBtn = document.getElementById(\`checkBtn\${i}\`);
          if (checkBtn) checkBtn.classList.add("hidden");
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
        
        safeStorage.remove(PROGRESS_STORAGE_KEY);
        
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
      this.lockedQuestions.clear();
  
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
      
      safeStorage.remove(PROGRESS_STORAGE_KEY);
      
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
  
    // ── Keyboard navigation (ported from keyboard-nav.js) ──────────────
    // The platform's keyboard-nav.js targets its own DOM shape (radio/
    // checkbox <input> elements inside .option-row, cards carrying a
    // data-question-index attribute). This export uses a different shape
    // (.option-btn <button> elements, .question-card with id="q{i}") —
    // so SHORTCUT_MAP/isSuppressed/toggleShortcutModal are ported
    // verbatim (they're DOM-shape-agnostic), while getActiveQuestionCard/
    // moveOptionFocus/initKeyboardNav are re-implemented here against the
    // export's actual markup, preserving the same keys and behavior.
    SHORTCUT_MAP: {
      ArrowRight: "next",
      ArrowLeft: "prev",
      ArrowDown: "option-next",
      ArrowUp: "option-prev",
      1: "select-0",
      2: "select-1",
      3: "select-2",
      4: "select-3",
      5: "select-4",
      6: "select-5",
      7: "select-6",
      8: "select-7",
      9: "select-8",
      Enter: "check",
      f: "flag",
      "?": "help",
    },

    isShortcutSuppressed() {
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "TEXTAREA") return true;
      if (tag === "INPUT") {
        const type = (el.type || "text").toLowerCase();
        if (type !== "radio" && type !== "checkbox") return true;
      }
      const modal = document.getElementById("modal");
      if (modal && modal.classList.contains("show")) return true;
      return false;
    },

    // Returns the .question-card that keyboard interaction should target:
    // the single visible card in pagination mode, or — in vertical mode,
    // where every card is stacked in the DOM at once — whichever card
    // contains focus, falling back to whichever card's vertical center is
    // closest to the viewport's vertical center (the one being read).
    getActiveQuestionCard() {
      const cards = Array.from(document.querySelectorAll(".question-card"));
      if (cards.length === 0) return null;
      if (EXPORT_LAYOUT === "pagination") {
        return cards.find((c) => c.classList.contains("pg-active")) || cards[0];
      }
      if (cards.length === 1) return cards[0];

      const focused = document.activeElement?.closest(".question-card");
      if (focused) return focused;

      const viewportCenter = window.innerHeight / 2;
      let closest = null;
      let closestDistance = Infinity;
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        const cardCenter = rect.top + rect.height / 2;
        const distance = Math.abs(cardCenter - viewportCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = card;
        }
      });
      return closest || cards[0];
    },

    getActiveQuestionIndex() {
      const card = this.getActiveQuestionCard();
      if (!card) return this.currentQuestion;
      const match = /^q(\d+)$/.exec(card.id || "");
      return match ? parseInt(match[1], 10) : this.currentQuestion;
    },

    // Moves focus between .option-btn elements within the active card,
    // wrapping at the ends. Returns the option index moved to, or -1 if
    // there's nothing to move between (essay cards, cards with no
    // options) so native page scroll is left intact.
    moveOptionFocus(direction) {
      const card = this.getActiveQuestionCard();
      if (!card) return -1;

      const buttons = Array.from(
        card.querySelectorAll(".option-btn:not(.disabled)"),
      );
      if (buttons.length === 0) return -1;

      const currentIndex = buttons.indexOf(document.activeElement);
      let nextIndex;
      if (currentIndex === -1) {
        const selectedIndex = buttons.findIndex((b) => b.classList.contains("selected"));
        nextIndex = selectedIndex >= 0
          ? (selectedIndex + direction + buttons.length) % buttons.length
          : (direction === 1 ? 0 : buttons.length - 1);
      } else {
        nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
      }

      buttons[nextIndex].focus();
      return nextIndex;
    },

    handleOptionKeydown(event, qIndex, optIndex) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.selectAnswer(qIndex, optIndex);
      }
    },

    setupKeyboardNavigation() {
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this.closeModal();
          this.closeMenu();
          return;
        }

        if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !this.isShortcutSuppressed()) {
          const modal = document.getElementById("modal");
          if (!modal.classList.contains("show")) {
            this.toggleMenu();
          }
          return;
        }

        if (this.isShortcutSuppressed()) return;

        const action = this.SHORTCUT_MAP[e.key];
        if (!action) return;

        // ArrowUp/ArrowDown: move focus to (and, for single-choice
        // questions, select) the neighbouring option. Multi-select
        // buttons only move focus so arrows don't toggle answers on/off
        // while navigating.
        if (action === "option-next" || action === "option-prev") {
          const index = this.moveOptionFocus(action === "option-next" ? 1 : -1);
          if (index >= 0) {
            e.preventDefault();
            const qIndex = this.getActiveQuestionIndex();
            const q = questions[qIndex];
            if (q && !Array.isArray(q.correct)) {
              this.selectAnswer(qIndex, index);
            }
          }
          return;
        }

        e.preventDefault();

        switch (action) {
          case "next":
            this.jumpToQuestion(Math.min(this.currentQuestion + 1, questions.length - 1));
            break;

          case "prev":
            this.jumpToQuestion(Math.max(this.currentQuestion - 1, 0));
            break;

          case "select-0":
          case "select-1":
          case "select-2":
          case "select-3":
          case "select-4":
          case "select-5":
          case "select-6":
          case "select-7":
          case "select-8": {
            const qIndex = this.getActiveQuestionIndex();
            const q = questions[qIndex];
            const optIndex = Number(action.split("-")[1]);
            if (q && Array.isArray(q.options) && optIndex < q.options.length) {
              this.selectAnswer(qIndex, optIndex);
            }
            break;
          }

          case "check":
            this.checkAnswerForQuestion(this.getActiveQuestionIndex());
            break;

          case "flag":
            this.toggleFlag(this.getActiveQuestionIndex());
            break;

          case "help":
            this.toggleShortcutModal();
            break;
        }
      });
    },

    toggleShortcutModal() {
      const modal = document.getElementById("shortcutModal");
      if (!modal) return;
      const isHidden = modal.hasAttribute("hidden");
      if (isHidden) {
        modal.removeAttribute("hidden");
        modal.style.display = "flex";
      } else {
        modal.setAttribute("hidden", "");
        modal.style.display = "none";
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
}

export async function exportToQuiz(config, questions, exportOptions = {}) {
  const quizHTML = await buildStandaloneQuizHtml(config, questions, exportOptions);
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

    // Video/audio can't be feasibly inlined as base64 (file size), so
    // relative paths are rewritten to absolute URLs against the platform's
    // origin instead — see shared/media-url.js. Fall back to the original
    // string on a genuine resolution failure (empty/malformed URL) so a
    // broken value doesn't get silently wiped out.
    if (question.video) {
      processedQuestion.video = resolveMediaUrl(question.video) || question.video;
    }
    if (question.audio) {
      processedQuestion.audio = resolveMediaUrl(question.audio) || question.audio;
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
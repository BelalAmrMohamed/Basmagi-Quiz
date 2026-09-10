// public/src/features/create/create-quiz.js

import {
  showNotification,
  _confirm,
  _prompt
} from "../../components/notifications/notifications.js";

import {
  processQuizJsonFile,
  parseQuizJson,
  buildJsonQuizExport,
} from "../../shared/quiz-json.js";
import { showDownloadModal } from "../../components/download-quiz-modal/download-quiz-modal.js";
import { renderMarkdown } from "../../shared/markdown.js";
import { isAdminAuthenticated } from "../../shared/adminAuth.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { createAIAgentFab } from "../../components/ai-agent/ai-agent.js";
import { CREATE_QUIZ_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { CREATE_QUIZ_PAGE_SUGGESTED_PROMPTS } from "../../components/ai-agent/ai-agent-suggested-prompts.js";

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let quizData = {
  title: "",
  description: "",
  source: "",
  questions: [],
};

// Internal-only marker used for a question's `answer` field so every
// isEssay check (a truthy test on `question.answer`) reliably identifies
// essay questions even while the actual model-answer text (`options[0]`)
// is still blank. Never shown to the user or exported — buildQuizPayload/
// exportQuiz derive the real exported `answer` from `options[0]` for any
// question whose `options` array has exactly one entry.
const ESSAY_MARKER = "__essay__";

let questionIdCounter = 0;
let autosaveTimeout = null;
let bulkModeActive = false;
let selectedQuestions = new Set();
let isTemplatesPanelOpen = false;
let editingQuizId = null;
let reorderModeActive = false;
// ID of the current draft entry in user_quizzes (meta.type = "draft").
// null when editing an already-published quiz via ?edit=<id>.
let currentDraftId = null;

// ── Admin detection ──────────────────────────────────────────────────────────
// Set once on DOMContentLoaded; controls whether media-upload tabs are shown.
let isAdmin = false;

// ============================================================================
// LATEX / KATEX RENDERING
// ============================================================================

/**
 * Scan a container for LaTeX delimiters ($...$ inline, $$...$$ block) and
 * render them in place with KaTeX. Safe to call even if KaTeX or the
 * auto-render extension haven't loaded yet (e.g. slow CDN) — it just no-ops.
 * Call this AFTER any innerHTML update that may contain raw markdown/LaTeX
 * source, so the DOM nodes actually exist for KaTeX to walk and replace.
 */
function renderMathIn(container) {
  if (!container) return;
  if (typeof window.renderMathInElement !== "function") return;
  try {
    window.renderMathInElement(container, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
      ],
      throwOnError: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    });
  } catch (err) {
    console.error("KaTeX rendering error:", err);
  }
}

// ============================================================================
// WRITE / PREVIEW EDITOR SYSTEM (GitHub-style)
// ============================================================================
//
// Each text field (question text, options, explanation, essay answer) is a
// single bordered container with a Write / Preview tab pair and a small
// markdown formatting toolbar, mirroring GitHub's comment/release editor.
// Only one pane (textarea or rendered preview) is visible at a time — no
// stacked "edit box + live preview beneath it" like the old system.

const MD_TOOLBAR_ACTIONS = [
  { cmd: "bold", title: "غامق", icon: "bold" },
  { cmd: "italic", title: "مائل", icon: "italic" },
  { cmd: "heading", title: "عنوان", icon: "heading", dropdown: true },
  { cmd: "codeblock", title: "كتلة كود", icon: "codeblock" },
  { cmd: "code", title: "كود مضمّن", icon: "code" },
  { cmd: "ul", title: "قائمة نقطية", icon: "list" },
  { cmd: "ol", title: "قائمة مرقمة", icon: "list-ordered" },
];

const HEADING_LEVELS = [1, 2, 3, 4, 5];

const MD_TOOLBAR_ICONS = {
  bold: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h9a4 4 0 0 1 0 8H6V4h8a4 4 0 0 1 0 8"/></svg>',
  italic:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
  heading:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/></svg>',
  code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  codeblock:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><polyline points="9 9 7 12 9 15"/><polyline points="15 9 17 12 15 15"/></svg>',
  list: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  "list-ordered":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>',
};

function mdToolbarHtml(id) {
  const buttons = MD_TOOLBAR_ACTIONS.map((a) => {
    if (a.dropdown) {
      const levelBtns = HEADING_LEVELS.map(
        (lvl) =>
          `<button type="button" class="wp-heading-option" onclick="applyMdToolbarAction(event, '${id}', 'heading', ${lvl})">عنوان ${lvl}</button>`,
      ).join("");
      return `
        <div class="wp-tool-dropdown" id="heading-dropdown-${id}">
          <button type="button" class="wp-tool-btn" title="${a.title}" aria-label="${a.title}" aria-haspopup="true" onclick="toggleHeadingDropdown(event, '${id}')">${MD_TOOLBAR_ICONS[a.icon]}</button>
          <div class="wp-heading-menu" id="heading-menu-${id}" style="display:none;">${levelBtns}</div>
        </div>`;
    }
    return `<button type="button" class="wp-tool-btn" title="${a.title}" aria-label="${a.title}" onclick="applyMdToolbarAction(event, '${id}', '${a.cmd}')">${MD_TOOLBAR_ICONS[a.icon]}</button>`;
  }).join("");
  return `<div class="wp-toolbar" id="toolbar-${id}">${buttons}</div>`;
}

/** Toggle the H1–H5 dropdown menu open/closed for one field */
window.toggleHeadingDropdown = function (e, id) {
  e.preventDefault();
  e.stopPropagation();
  const menu = document.getElementById(`heading-menu-${id}`);
  if (!menu) return;
  const isOpen = menu.style.display !== "none";
  // Close any other open heading menus first
  document.querySelectorAll(".wp-heading-menu").forEach((m) => {
    m.style.display = "none";
  });
  menu.style.display = isOpen ? "none" : "block";
};

// Close any open heading dropdown when clicking elsewhere
document.addEventListener("click", (e) => {
  if (!e.target.closest(".wp-tool-dropdown")) {
    document.querySelectorAll(".wp-heading-menu").forEach((m) => {
      m.style.display = "none";
    });
  }
});

/**
 * Build the HTML for a Write/Preview markdown field.
 * The per-card .wp-bar (tabs + toolbar) has been removed — formatting is
 * applied via the global #globalMdBar fixed toolbar at the top of the page.
 * The textarea is always directly accessible; the preview pane is still
 * available for callers that switch to it programmatically.
 */
function mdEditorHtml(id, value, placeholder, rows = 2) {
  const safeValue = (value || "").replace(/\\n/g, "\n");
  const escaped = safeValue
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `
    <div class="wp-field" id="wrap-${id}">
      <div class="wp-pane-wrap">
        <textarea
          class="md-source wp-textarea" dir="auto"
          id="${id}"
          rows="${rows}"
          placeholder="${placeholder}"
        >${escaped}</textarea>
        <div class="wp-preview-pane ltr" id="preview-${id}" style="display:none;"></div>
      </div>
    </div>`;
}

/** Focus a .md-source field and place the cursor at the end of its text.
 * Formerly also switched a per-card Write/Preview tab (switchMdTab); that
 * markup was removed along with the per-card .wp-bar in favor of the global
 * #globalMdBar toolbar, so this now only handles focusing the field. */
window.activateMdEditor = function (e, id) {
  if (typeof e === "string" && !id) {
    id = e;
  }
  const source = document.getElementById(id);
  if (source) {
    source.focus();
    source.setSelectionRange(source.value.length, source.value.length);
  }
};

/**
 * AI-chat-style growing textarea: starts small enough for one line, grows
 * with content up to a max height, then stops growing and scrolls instead.
 * `minPx` lets compact fields (like option inputs) start smaller than the
 * default single question-text line.
 */
function autoResizeMdSource(ta, minPx = 40, maxPx = 240) {
  ta.style.height = "auto";
  const next = Math.min(Math.max(ta.scrollHeight, minPx), maxPx);
  ta.style.height = next + "px";
  ta.style.overflowY = ta.scrollHeight > maxPx ? "auto" : "hidden";
}

/**
 * Replace the range [start, end) of a textarea's value with `text`, without
 * breaking the browser's native undo/redo (Ctrl+Z) history.
 *
 * Setting `ta.value` directly wipes the textarea's undo stack in every
 * browser — that's why Ctrl+Z used to stop working the moment any toolbar
 * button was used. `document.execCommand('insertText', ...)` goes through
 * the same input pipeline a real keystroke would, so it's recorded as a
 * normal undoable edit. execCommand is deprecated for rich-text editing in
 * general, but for plain <textarea>/<input> "insertText" it is still
 * implemented and recommended by all major browsers specifically because
 * there is no replacement API yet for preserving undo history this way.
 * Falls back to a direct value swap (old behavior) only if execCommand is
 * unavailable, so nothing breaks in that rare case.
 */
function replaceTextareaRange(ta, start, end, text) {
  ta.focus();
  ta.setSelectionRange(start, end);
  const ok =
    typeof document.execCommand === "function" &&
    document.execCommand("insertText", false, text);
  if (!ok) {
    // Fallback: no native undo support, but the edit still applies.
    const value = ta.value;
    ta.value = value.slice(0, start) + text + value.slice(end);
    ta.setSelectionRange(start + text.length, start + text.length);
  }
}

/** Wire up a Write/Preview field: auto-resize + onChange. Preview renders on-demand (tab switch).
 * Option fields (id starts with "option-text-") are compact, like a chat
 * reply box; everything else (question text, explanation, description)
 * gets the taller prompt-box sizing. */
function setupMdEditor(id, onChange) {
  const source = document.getElementById(id);
  if (!source) return;

  const isOption = id.startsWith("option-text-");
  const minPx = isOption ? 36 : 40;
  const maxPx = isOption ? 140 : 240;

  autoResizeMdSource(source, minPx, maxPx);

  source.addEventListener("input", () => {
    autoResizeMdSource(source, minPx, maxPx);
    if (onChange) onChange(source.value);
  });
}

/** Insert/wrap markdown syntax at the cursor of a Write/Preview textarea */
window.applyMdToolbarAction = function (e, id, cmd, headingLevel) {
  e.preventDefault();
  e.stopPropagation();
  const ta = document.getElementById(id);
  if (!ta) return;

  // Close the heading dropdown if this call came from picking a level
  const menu = document.getElementById(`heading-menu-${id}`);
  if (menu) menu.style.display = "none";

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  const selected = value.slice(start, end);

  const wrap = (prefix, suffix = prefix, placeholder = "") => {
    const text = selected || placeholder;
    replaceTextareaRange(ta, start, end, prefix + text + suffix);
    const cursorStart = start + prefix.length;
    const cursorEnd = cursorStart + text.length;
    ta.setSelectionRange(cursorStart, cursorEnd);
  };

  const linePrefix = (prefix) => {
    // Apply prefix to the start of the current line (or each selected line)
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = end || lineStart;
    const affected = value.slice(lineStart, lineEnd);
    const lines = (affected || "").split("\n");
    const newLines = lines
      .map((line) => (line.startsWith(prefix) ? line : prefix + line))
      .join("\n");
    replaceTextareaRange(ta, lineStart, lineEnd, newLines);
    ta.setSelectionRange(lineStart, lineStart + newLines.length);
  };

  switch (cmd) {
    case "bold":
      wrap("**", "**", "نص غامق");
      break;
    case "italic":
      wrap("*", "*", "نص مائل");
      break;
    case "code":
      wrap("`", "`", "كود");
      break;
    case "codeblock": {
      const text = selected || "كود";
      replaceTextareaRange(ta, start, end, "```\n" + text + "\n```");
      const codeStart = start + 4;
      ta.setSelectionRange(codeStart, codeStart + text.length);
      break;
    }
    case "heading": {
      const level = Math.min(Math.max(headingLevel || 3, 1), 6);
      linePrefix("#".repeat(level) + " ");
      break;
    }
    case "ul":
      linePrefix("- ");
      break;
    case "ol":
      linePrefix("1. ");
      break;
  }

  ta.focus();
  autoResizeMdSource(ta);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
};

// ============================================================================
// GLOBAL MARKDOWN + LATEX TOOLBAR (#globalMdBar)
// A single fixed toolbar shared by all .md-source textareas on the page.
// Tracks the last-focused textarea and applies formatting/insertion to it.
// ============================================================================

/** The currently (or last) focused .md-source textarea, or null. */
let _activeMdSource = null;

/** Track focus across all .md-source fields via event delegation. */
function _trackMdSourceFocus() {
  document.addEventListener("focusin", (e) => {
    if (e.target.classList.contains("md-source")) {
      _activeMdSource = e.target;
    }
  }, true);
}

/** Show a brief floating tooltip when no .md-source is focused. */
let _gmdTipEl = null;
let _gmdTipTimer = null;
function _showNoFieldTip() {
  if (!_gmdTipEl) {
    _gmdTipEl = document.createElement("div");
    _gmdTipEl.className = "gmd-no-field-tip";
    _gmdTipEl.textContent = "انقر على حقل نصي أولاً";
    document.body.appendChild(_gmdTipEl);
  }
  clearTimeout(_gmdTipTimer);
  _gmdTipEl.classList.add("visible");
  _gmdTipTimer = setTimeout(() => {
    if (_gmdTipEl) _gmdTipEl.classList.remove("visible");
  }, 2000);
}

/**
 * Apply a markdown command or insert a LaTeX snippet into the active textarea.
 * @param {string} cmd - Named markdown command or null for raw LaTeX insert
 * @param {string|null} latex - Raw LaTeX string to insert at cursor (when cmd is null)
 */
function applyGlobalMdAction(cmd, latex = null, headingLevel = null) {
  const ta = _activeMdSource;
  if (!ta) {
    _showNoFieldTip();
    return;
  }

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  const selected = value.slice(start, end);

  // Helper: wrap selection (or placeholder) with prefix/suffix
  const wrap = (prefix, suffix = prefix, placeholder = "") => {
    const text = selected || placeholder;
    replaceTextareaRange(ta, start, end, prefix + text + suffix);
    const cs = start + prefix.length;
    ta.setSelectionRange(cs, cs + text.length);
  };

  // Helper: prepend prefix to the current line (or each selected line)
  const linePrefix = (prefix) => {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = end || lineStart;
    const affected = value.slice(lineStart, lineEnd);
    const lines = (affected || "").split("\n");
    const newLines = lines
      .map((line) => (line.startsWith(prefix) ? line : prefix + line))
      .join("\n");
    replaceTextareaRange(ta, lineStart, lineEnd, newLines);
    ta.setSelectionRange(lineStart, lineStart + newLines.length);
  };

  if (latex !== null) {
    // Raw LaTeX snippets (superscript, fraction, matrix, etc.) must be
    // wrapped in $...$ inline-math delimiters, or renderMathIn()'s KaTeX
    // auto-render extension has no delimiter to detect and leaves the raw
    // LaTeX source showing as plain text. Insert at cursor, place cursor
    // inside the first {} placeholder.
    const snippet = selected ? selected + latex : latex;
    const inserted = `$${snippet}$`;
    replaceTextareaRange(ta, start, end, inserted);
    // Try to place cursor inside the first {} (offset by 1 for the leading $)
    const braceIdx = inserted.indexOf("{}");
    if (braceIdx !== -1) {
      const pos = start + braceIdx + 1;
      ta.setSelectionRange(pos, pos);
    } else {
      const pos = start + inserted.length - 1; // before the closing $
      ta.setSelectionRange(pos, pos);
    }
  } else {
    switch (cmd) {
      case "bold": wrap("**", "**", "نص غامق"); break;
      case "italic": wrap("*", "*", "نص مائل"); break;
      case "strike": wrap("~~", "~~", "نص مشطوب"); break;
      case "code": wrap("`", "`", "كود"); break;
      case "codeblock": {
        const text = selected || "كود";
        replaceTextareaRange(ta, start, end, "```\n" + text + "\n```");
        const cs = start + 4;
        ta.setSelectionRange(cs, cs + text.length);
        break;
      }
      case "heading": {
        const level = Math.min(Math.max(Number(headingLevel) || 3, 1), 6);
        linePrefix("#".repeat(level) + " ");
        break;
      }
      case "blockquote": linePrefix("> "); break;
      case "hr": {
        const ins = "\n---\n";
        replaceTextareaRange(ta, start, end, ins);
        const pos = start + ins.length;
        ta.setSelectionRange(pos, pos);
        break;
      }
      case "ul": linePrefix("- "); break;
      case "ol": linePrefix("1. "); break;
      case "link": {
        const text = selected || "نص الرابط";
        replaceTextareaRange(ta, start, end, `[${text}](https://)`);
        const urlStart = start + text.length + 3; // after "[text]("
        ta.setSelectionRange(urlStart, urlStart + "https://".length);
        break;
      }
      case "image": {
        const alt = selected || "وصف الصورة";
        replaceTextareaRange(ta, start, end, `![${alt}](https://)`);
        const urlStart = start + alt.length + 4; // after "![alt]("
        ta.setSelectionRange(urlStart, urlStart + "https://".length);
        break;
      }
      case "table": {
        const rows =
          "| العمود 1 | العمود 2 |\n| --- | --- |\n| قيمة | قيمة |";
        const needsLeadingNewline = start > 0 && value[start - 1] !== "\n";
        const ins = (needsLeadingNewline ? "\n" : "") + rows;
        replaceTextareaRange(ta, start, end, ins);
        const pos = start + ins.length;
        ta.setSelectionRange(pos, pos);
        break;
      }
      case "inlinemath": wrap("$", "$", "math"); break;
      case "blockmath": wrap("$$", "$$", "math"); break;
    }
  }

  ta.focus();
  autoResizeMdSource(ta);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Wire up the global #globalMdBar: attach click handlers to every .gmd-btn,
 * wire up the LaTeX "more" and heading dropdowns, and start tracking
 * .md-source focus.
 */
function setupGlobalMdBar() {
  _trackMdSourceFocus();

  const bar = document.getElementById("globalMdBar");
  if (!bar) return;

  bar.querySelectorAll(".gmd-btn:not(.gmd-dropdown-toggle)").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const cmd = btn.dataset.gmdCmd || null;
      const latex = btn.dataset.gmdLatex !== undefined ? btn.dataset.gmdLatex : null;
      const heading = btn.dataset.gmdHeading || null;
      applyGlobalMdAction(cmd, latex, heading);
      // Using a dropdown item closes the dropdown it came from.
      closeAllGmdDropdowns();
    });
  });

  // Dropdown toggles (LaTeX "more" menu, heading levels menu)
  bar.querySelectorAll(".gmd-dropdown-toggle").forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = toggle.nextElementSibling;
      if (!menu) return;
      const isOpen = menu.classList.contains("open");
      closeAllGmdDropdowns();
      if (!isOpen) {
        positionGmdDropdown(toggle, menu);
        menu.classList.add("open");
      }
    });
  });

  // Re-close (rather than leave stranded mid-air) if the bar scrolls or the
  // window resizes while a dropdown is open — its fixed position was
  // computed for the toggle's rect at open-time only.
  bar.addEventListener("scroll", closeAllGmdDropdowns);
  window.addEventListener("resize", closeAllGmdDropdowns);

  // Close any open gmd dropdown when clicking elsewhere
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".gmd-dropdown")) closeAllGmdDropdowns();
  });
}

/**
 * Position a .gmd-dropdown-menu (position: fixed) directly beneath its
 * toggle button, using the toggle's live bounding rect. Needed because the
 * menu can no longer be positioned with `position: absolute` relative to
 * .global-md-bar — that bar clips vertical overflow (see CSS comment on
 * .gmd-dropdown-menu), so an absolutely-positioned child never became
 * visible there. Aligns to the toggle's right edge (this UI is RTL) and
 * clamps to the viewport so it can't run off the left edge on narrow bars.
 */
function positionGmdDropdown(toggle, menu) {
  const rect = toggle.getBoundingClientRect();
  // Measure first with visibility hidden so scrollWidth/Height are correct
  // before we do the final visible placement.
  menu.style.visibility = "hidden";
  menu.style.display = "flex";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = "0px";

  const menuWidth = menu.offsetWidth;
  let left = rect.right - menuWidth; // align menu's right edge to toggle's right edge (RTL)
  left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

  menu.style.left = `${left}px`;
  menu.style.display = "";
  menu.style.visibility = "";
}

function closeAllGmdDropdowns() {
  document
    .querySelectorAll("#globalMdBar .gmd-dropdown-menu.open")
    .forEach((m) => m.classList.remove("open"));
}

// ============================================================================
// UNDO / REDO
// ============================================================================
//
// Whole-quiz-snapshot history. #undoBtn/#redoBtn in create-quiz.html already
// call performUndo()/performRedo() and expect updateUndoRedoButtons() to
// toggle their disabled state — this block is what actually backs them.
//
// Deliberately scoped to STRUCTURAL edits only (add/remove/duplicate/move/
// reorder/convert/bulk-delete/import/template-insert/AI edits) — i.e. every
// call site that already calls autosave() from outside a per-keystroke
// input handler. Per-keystroke text edits (question/option/title/description
// text) are intentionally excluded and continue to rely on the textarea's
// own native undo (see the "why not just set ta.value" comment above
// replaceTextareaRange) — pushing a snapshot on every keystroke would both
// explode the stack and fight the native undo the user already expects
// inside a text field.
//
// Snapshots are plain deep clones of `quizData` (JSON-safe: title,
// description, source, questions — no DOM/live references), so restoring
// one is just `quizData = clone; rerenderAllQuestions(); ...`.

const UNDO_STACK_LIMIT = 50;
let undoStack = [];
let redoStack = [];
// Set while performUndo/performRedo is actively restoring a snapshot, so
// pushHistorySnapshot() calls triggered by that restore's own re-render
// (e.g. autosave() inside rerenderAllQuestions callbacks) don't re-enter
// the stack and corrupt it.
let isRestoringHistory = false;

function cloneQuizData() {
  return JSON.parse(JSON.stringify(quizData));
}

/**
 * Record the CURRENT quizData as an undo point, then clear the redo stack
 * (a fresh structural edit invalidates whatever was ahead). Call this
 * BEFORE mutating quizData for a structural operation — that way the
 * snapshot captures the pre-edit state to return to.
 */
function pushHistorySnapshot() {
  if (isRestoringHistory) return;
  undoStack.push(cloneQuizData());
  if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

/** Fully re-render the editor from the current quizData after a snapshot
 * restore — mirrors what every structural mutator already does after
 * changing quizData, so undo/redo looks identical to a normal edit. */
function refreshEditorAfterHistoryChange() {
  rerenderAllQuestions();
  updateEmptyState();
  updateProgress();
  updateStatistics();
  updateAppTitleBar();

  const titleInput = document.getElementById("quizTitle");
  const descInput = document.getElementById("quizDescription");
  const sourceInput = document.getElementById("quizSource");
  if (titleInput) titleInput.value = quizData.title || "";
  if (descInput) {
    descInput.value = quizData.description || "";
    autoResizeMdSource(descInput);
  }
  if (sourceInput) sourceInput.value = quizData.source || "";

  // Bulk/reorder mode reference DOM nodes (checkboxes, drag handles) that
  // no longer exist after the container was rebuilt — leaving the mode
  // "on" would show a stale toolbar over cards with no handles/checkboxes.
  if (bulkModeActive) window.toggleBulkMode();
  if (reorderModeActive) window.toggleReorderMode();
}

window.performUndo = function () {
  if (undoStack.length === 0) return;
  const previous = undoStack.pop();
  redoStack.push(cloneQuizData());
  if (redoStack.length > UNDO_STACK_LIMIT) redoStack.shift();

  isRestoringHistory = true;
  quizData = previous;
  refreshEditorAfterHistoryChange();
  isRestoringHistory = false;

  updateUndoRedoButtons();
  autosave();
};

window.performRedo = function () {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  undoStack.push(cloneQuizData());
  if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();

  isRestoringHistory = true;
  quizData = next;
  refreshEditorAfterHistoryChange();
  isRestoringHistory = false;

  updateUndoRedoButtons();
  autosave();
};

/** Reset the history stacks — call whenever quizData is replaced wholesale
 * from outside the undo system itself (loading a draft, importing a quiz,
 * resetting the page), since old snapshots would otherwise point back to
 * a completely unrelated quiz. */
function resetHistory() {
  undoStack = [];
  redoStack = [];
  updateUndoRedoButtons();
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Detect admin role — controls upload-tab visibility
  isAdmin = isAdminAuthenticated();

  const urlParams = new URLSearchParams(window.location.search);
  const editId = urlParams.get("edit");
  if (editId) {
    // Deep-linked edit (?edit=<id>) always bypasses the entry screen and
    // opens straight into the form, same as before this feature existed.
    editingQuizId = editId;
    showQuizForm();
    loadQuizFromLocalStorage(editId);
  } else {
    showEntryScreen();
  }

  setupEventListeners();
  setupKeyboardShortcuts();
  setupMenuBarListeners();
  setupEntryItemMenuListeners();
  setupQuestionMenuListeners();
  setupGlobalMdBar();
  mountAIHelper();
  updateUndoRedoButtons();
  setupReorderHandles();
});

// ============================================================================
// ENTRY SCREEN
// ============================================================================

/**
 * Build the Google-Docs-style "recent items" grid: a "Blank quiz" tile plus
 * one tile per saved item (the current draft, if any, and every quiz in
 * user_quizzes), newest first. Replaces the old three-fixed-cards layout.
 */
function showEntryScreen() {
  const entryScreen = document.getElementById("entryScreen");
  const form = document.getElementById("quizCreatorForm");
  const appTitleBar = document.getElementById("appTitleBar");
  const globalMdBar = document.getElementById("globalMdBar");
  if (!entryScreen || !form) {
    // Defensive fallback: if the entry screen markup is missing for any
    // reason, don't strand the user on a blank page — go straight in.
    loadDraftFromLocalStorage();
    finishFormInit();
    return;
  }

  form.style.display = "none";
  // Hide the unified top bar (now contains both title + menu nav)
  if (appTitleBar) appTitleBar.style.display = "none";
  // Hide the global markdown/LaTeX toolbar
  if (globalMdBar) globalMdBar.style.display = "none";
  entryScreen.style.display = "block";
  document.body.classList.remove("quiz-form-active");

  renderEntryItemsGrid();
}

/** Read the draft + saved quizzes and render them as one recent-items grid. */
function renderEntryItemsGrid() {
  const grid = document.getElementById("entryItemsGrid");
  if (!grid) return;

  // Migrate legacy single-key draft to a proper draft entry, then clean up
  try {
    const legacyDraft = localStorage.getItem("quiz_draft");
    if (legacyDraft) {
      const d = JSON.parse(legacyDraft);
      const hasContent = d && (d.meta?.title || d.title || d.questions?.length);
      if (hasContent) {
        const id = "draft-" + Date.now();
        const entry = {
          id,
          meta: {
            type: "draft",
            title: d.meta?.title || d.title || "مسودة غير مُعنونة",
            description: d.meta?.description || d.description || "",
            source: d.meta?.source || d.source || "",
            updatedAt: d.lastModified || new Date().toISOString(),
          },
          questions: d.questions || [],
        };
        const quizzes = _readUserQuizzes();
        quizzes.push(entry);
        localStorage.setItem("user_quizzes", JSON.stringify(quizzes));
      }
      localStorage.removeItem("quiz_draft");
    }
  } catch (e) { /* ignore migration errors */ }

  let userQuizzes = _readUserQuizzes();

  // ── Helper: render a single tile ──────────────────────────────────────────
  function makeTile(item) {
    const title = escapeHtml(item.title);
    const countLabel = `${item.count} ${item.count === 1 ? "سؤال" : "أسئلة"}`;
    const dateLabel = formatEntryItemDate(item.updatedAt);
    const meta = [countLabel, dateLabel].filter(Boolean).join(" · ");
    const clickHandler = `chooseUserQuizToEdit('${item.id}')`;
    const moreMenu =
      item.kind === "mine" || item.kind === "draft"
        ? `
        <div class="entry-item-more-wrap">
          <button type="button" class="entry-item-more-btn" onclick="toggleEntryItemMenu(event, '${item.id}')"
            aria-label="خيارات إضافية" title="خيارات إضافية">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
          </button>
          <div class="entry-item-menu" id="entryItemMenu-${item.id}">
            <button type="button" class="entry-item-menu-option" onclick="renameEntryItem(event, '${item.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
              <span>إعادة تسمية</span>
            </button>
            <button type="button" class="entry-item-menu-option entry-item-menu-option-danger"
              onclick="deleteEntryItem(event, '${item.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>حذف</span>
            </button>
          </div>
        </div>`
        : "";
    return `
      <div class="entry-item-wrap">
        <button type="button" class="entry-item${item.kind === "draft" ? " entry-item-draft" : ""}" onclick="${clickHandler}">
          <span class="entry-item-thumb">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <path d="M12 11h4" />
              <path d="M12 16h4" />
              <path d="M8 11h.01" />
              <path d="M8 16h.01" />
            </svg>
          </span>
          <span class="entry-item-title">${title}</span>
          <span class="entry-item-meta">${meta}</span>
        </button>
        ${moreMenu}
      </div>`;
  }

  // ── Drafts section ────────────────────────────────────────────────────────
  const draftItems = userQuizzes
    .filter((q) => q.meta?.type === "draft")
    .map((q) => ({
      kind: "draft",
      id: q.id,
      title: q.meta?.title || q.title || "مسودة غير مُعنونة",
      count: q.questions?.length || 0,
      updatedAt: q.meta?.updatedAt || null,
    }))
    .sort((a, b) => {
      if (!a.updatedAt && !b.updatedAt) return 0;
      if (!a.updatedAt) return 1;
      if (!b.updatedAt) return -1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

  // ── Saved quizzes section ─────────────────────────────────────────────────
  const savedItems = userQuizzes
    .filter((quiz) => {
      const t = quiz.meta?.type;
      return t !== "folder" && t !== "course" && t !== "draft";
    })
    .map((quiz) => ({
      kind: "mine",
      id: quiz.id,
      title: quiz.meta?.title || quiz.title || "بدون عنوان",
      count: quiz.stats?.questionCount ?? quiz.questions?.length ?? 0,
      updatedAt: quiz.meta?.updatedAt || null,
    }))
    .sort((a, b) => {
      if (!a.updatedAt && !b.updatedAt) return 0;
      if (!a.updatedAt) return 1;
      if (!b.updatedAt) return -1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

  // ── Assemble sections ─────────────────────────────────────────────────────
  const draftTiles = draftItems.map((item) => makeTile(item)).join("");
  const savedTiles = savedItems.map(makeTile).join("");

  // ── New-quiz tile (always shown) ────────────────────────────────────────────
  const newTile = `
    <div class="entry-item-wrap">
      <button type="button" class="entry-item entry-item-new" onclick="chooseEntryAction('new')">
        <span class="entry-item-thumb entry-item-thumb-new">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </span>
        <span class="entry-item-title">امتحان جديد</span>
      </button>
    </div>`;

  let html = `
    <div class="entry-section">
      <h2 class="entry-screen-heading">أنشئ امتحانًا جديدًا</h2>
      <div class="entry-items-grid">${newTile}</div>
    </div>`;

  if (draftTiles) {
    html += `
    <div class="entry-section">
      <h2 class="entry-screen-heading">المسودات</h2>
      <div class="entry-items-grid">${draftTiles}</div>
    </div>`;
  }

  if (savedTiles) {
    html += `
    <div class="entry-section">
      <h2 class="entry-screen-heading">الامتحانات المحفوظة</h2>
      <div class="entry-items-grid">${savedTiles}</div>
    </div>`;
  }

  grid.innerHTML = html;

  // First real render: swap the static skeleton out for the actual grid.
  const skeleton = document.getElementById("entrySkeleton");
  if (skeleton) skeleton.style.display = "none";
  grid.style.display = "";
}



/** "منذ ٣ أيام"-style relative label, falling back to a short date. */
function formatEntryItemDate(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `منذ ${diffHr} ساعة`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `منذ ${diffDay} يوم`;
  return date.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
}

/** Hide the entry screen and reveal the quiz-creator form + unified bar. */
function showQuizForm() {
  const entryScreen = document.getElementById("entryScreen");
  const form = document.getElementById("quizCreatorForm");
  const appTitleBar = document.getElementById("appTitleBar");
  const globalMdBar = document.getElementById("globalMdBar");
  if (entryScreen) entryScreen.style.display = "none";
  if (form) form.style.display = "flex";
  // Show the unified top bar (merged title + menu nav)
  if (appTitleBar) appTitleBar.style.display = "flex";
  // Show the global markdown/LaTeX toolbar below the top bar
  if (globalMdBar) globalMdBar.style.display = "flex";
  document.body.classList.add("quiz-form-active");
  updateAppTitleBar();
}

/** Keep the compact app-bar title in sync with the quiz's own title field. */
function updateAppTitleBar() {
  const titleEl = document.getElementById("appTitleText");
  if (titleEl && titleEl.getAttribute("contenteditable") !== "true") {
    titleEl.textContent = quizData.title?.trim() || "امتحان بدون عنوان";
  }
}

// ============================================================================
// APP-BAR TITLE — click-to-rename (Docs-style)
// The app-bar title is a *display mirror* of the real #quizTitle input in
// the metadata card, not a second source of truth — editing it here writes
// straight into #quizTitle and fires the same "input" event that field
// already listens for, so quizData.title, the char counter, and autosave
// all stay driven by the one existing code path.
// ============================================================================

/** Turn the app-bar title into an editable field, focused with all text selected. */
window.startTitleEdit = function () {
  const titleEl = document.getElementById("appTitleText");
  if (!titleEl) return;

  titleEl.setAttribute("contenteditable", "true");
  titleEl.textContent = quizData.title || "";
  titleEl.classList.add("editing");
  titleEl.focus();

  const range = document.createRange();
  range.selectNodeContents(titleEl);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};

/** Commit the edited app-bar title back into #quizTitle (the real field). */
window.commitTitleEdit = function () {
  const titleEl = document.getElementById("appTitleText");
  if (!titleEl || titleEl.getAttribute("contenteditable") !== "true") return;

  titleEl.setAttribute("contenteditable", "false");
  titleEl.classList.remove("editing");

  const newTitle = titleEl.textContent.trim();
  const titleInput = document.getElementById("quizTitle");
  if (titleInput && titleInput.value !== newTitle) {
    titleInput.value = newTitle;
    // Reuse the exact same path typing in the metadata field already
    // takes: updates quizData.title, the char counter, the app-bar text,
    // and triggers autosave — no duplicated logic here.
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    updateAppTitleBar();
  }
};

/** Enter commits, Escape cancels without saving. */
window.handleTitleEditKeydown = function (event) {
  if (event.key === "Enter") {
    event.preventDefault();
    document.getElementById("appTitleText")?.blur();
  } else if (event.key === "Escape") {
    event.preventDefault();
    const titleEl = document.getElementById("appTitleText");
    if (titleEl) {
      titleEl.setAttribute("contenteditable", "false");
      titleEl.classList.remove("editing");
      updateAppTitleBar();
      titleEl.blur();
    }
  }
};

/** Run the same init steps the form previously did unconditionally on load. */
function finishFormInit() {
  showQuizForm();
  updateEmptyState();
  updateProgress();
  updateStatistics();
}

// ============================================================================
// SHARED LOCALSTORAGE HELPERS
// ============================================================================

/** Safe read of user_quizzes from localStorage. Always returns an array. */
function _readUserQuizzes() {
  try {
    return JSON.parse(localStorage.getItem("user_quizzes") || "[]");
  } catch (e) {
    return [];
  }
}

/** Safe write of user_quizzes to localStorage. */
function _writeUserQuizzes(quizzes) {
  localStorage.setItem("user_quizzes", JSON.stringify(quizzes));
}

/** Generate a simple unique ID (timestamp + random suffix). */
function _generateId(prefix = "draft") {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
}



/** Handles taps on entry-screen tiles ("new" | "exit"). */
window.chooseEntryAction = function (action) {
  if (action === "new") {
    resetPageData();    // clears quizData, generates a new currentDraftId
    finishFormInit();
    return;
  }

  if (action === "exit") {
    // The app-bar "هوم" button: go back to the entry screen without
    // discarding anything — autosave already persisted the current draft.
    showEntryScreen();
  }
};

/** User picked a specific saved quiz OR draft tile from the entry screen. */
window.chooseUserQuizToEdit = function (quizId) {
  const quizzes = _readUserQuizzes();
  const quiz = quizzes.find((q) => q.id === quizId);
  if (!quiz) return;

  if (quiz.meta?.type === "draft") {
    // Opening a draft: track it as currentDraftId so autosave updates it
    currentDraftId = quizId;
    editingQuizId = null;
  } else {
    // Opening a published quiz for editing: no draft tracking
    editingQuizId = quizId;
    currentDraftId = null;
  }
  finishFormInit();
  loadQuizFromLocalStorage(quizId);
};

// ============================================================================
// ENTRY SCREEN — per-tile "more" (⋮) menu: rename / delete
// A lightweight, purpose-built implementation rather than reusing
// user-quizzes-folders.js's renameItem()/deleteFolder() — those re-render
// the home page's own views (renderRootCategories/renderUserQuizzesView),
// which don't exist on this page. This follows the same storage contract
// (user_quizzes in localStorage, item.meta.title) but re-renders the entry
// grid instead.
// ============================================================================

/** Open/close the ⋮ dropdown for one tile, closing any other open one first. */
window.toggleEntryItemMenu = function (event, quizId) {
  event.stopPropagation();
  const menu = document.getElementById(`entryItemMenu-${quizId}`);
  if (!menu) return;
  const isOpen = menu.classList.contains("open");
  closeAllEntryItemMenus();
  if (!isOpen) menu.classList.add("open");
};

function closeAllEntryItemMenus() {
  document
    .querySelectorAll(".entry-item-menu.open")
    .forEach((menu) => menu.classList.remove("open"));
}

/** Open/close the ⋮ "more" dropdown for one question card, closing any
 * other open one first. Same pattern as toggleEntryItemMenu. */
window.toggleQuestionMenu = function (event, questionId) {
  event.stopPropagation();
  const menu = document.getElementById(`questionMenu-${questionId}`);
  if (!menu) return;
  const isOpen = menu.classList.contains("open");
  closeAllQuestionMenus();
  if (!isOpen) menu.classList.add("open");
};

window.closeAllQuestionMenus = function () {
  document
    .querySelectorAll(".question-more-menu.open")
    .forEach((menu) => menu.classList.remove("open"));
};

/** Rename a saved quiz directly in user_quizzes, then refresh the grid. */
window.renameEntryItem = async function (event, quizId) {
  event.stopPropagation();
  closeAllEntryItemMenus();

  let userQuizzes = [];
  try {
    userQuizzes = JSON.parse(localStorage.getItem("user_quizzes") || "[]");
  } catch (e) {
    userQuizzes = [];
  }

  const quiz = userQuizzes.find((q) => q.id === quizId);
  if (!quiz) return;

  const currentTitle = quiz.meta?.title || quiz.title || "";
  const newTitle = await _prompt("أدخل الاسم الجديد:", currentTitle);
  if (!newTitle || !newTitle.trim()) return;

  if (quiz.meta) {
    quiz.meta.title = newTitle.trim();
  } else {
    quiz.title = newTitle.trim();
  }
  localStorage.setItem("user_quizzes", JSON.stringify(userQuizzes));
  renderEntryItemsGrid();
};

/** Delete a saved quiz directly from user_quizzes, then refresh the grid. */
window.deleteEntryItem = async function (event, quizId) {
  event.stopPropagation();
  closeAllEntryItemMenus();

  if (!(await _confirm("هل أنت متأكد من حذف هذا الامتحان؟"))) return;

  let userQuizzes = [];
  try {
    userQuizzes = JSON.parse(localStorage.getItem("user_quizzes") || "[]");
  } catch (e) {
    userQuizzes = [];
  }

  const newQuizzes = userQuizzes.filter((q) => q.id !== quizId);
  localStorage.setItem("user_quizzes", JSON.stringify(newQuizzes));
  renderEntryItemsGrid();
};

// ============================================================================
// MENU BAR (Docs-style dropdowns)
// ============================================================================

/**
 * Position a .menu-dropdown (position: fixed) directly beneath its trigger,
 * using the trigger's live bounding rect, then clamp to the viewport.
 * Mirrors positionGmdDropdown() above — needed because .app-title-bar
 * scrolls horizontally on phones, so a plain position:absolute dropdown
 * could render partly or fully off-screen depending on scroll position.
 */
function positionMenuDropdown(trigger, dropdown) {
  const rect = trigger.getBoundingClientRect();
  // Measure first with visibility hidden so offsetWidth/Height are correct
  // before the final visible placement.
  dropdown.style.visibility = "hidden";
  dropdown.style.display = "block";
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = "0px";

  const menuWidth = dropdown.offsetWidth;
  let left = rect.right - menuWidth; // align dropdown's right edge to trigger's right edge (RTL)
  left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

  let top = rect.bottom + 4;
  const menuHeight = dropdown.offsetHeight;
  if (top + menuHeight > window.innerHeight - 8) {
    // Not enough room below — flip to open above the trigger instead.
    top = Math.max(8, rect.top - menuHeight - 4);
  }

  dropdown.style.left = `${left}px`;
  dropdown.style.top = `${top}px`;
  dropdown.style.display = "";
  dropdown.style.visibility = "";
}

/**
 * Position a .menu-submenu-dropdown beside its trigger row (to the left in
 * this RTL layout), clamped to the viewport the same way as top-level menus.
 */
function positionSubmenuDropdown(trigger, dropdown) {
  const rect = trigger.getBoundingClientRect();
  dropdown.style.visibility = "hidden";
  dropdown.style.display = "block";
  dropdown.style.top = "0px";
  dropdown.style.left = "0px";

  const menuWidth = dropdown.offsetWidth;
  const menuHeight = dropdown.offsetHeight;

  // Prefer popping out to the left of the trigger row (RTL: away from the
  // sidebar). If there isn't room on the left, fall back to the right.
  let left = rect.left - menuWidth - 2;
  if (left < 8) left = Math.min(rect.right + 2, window.innerWidth - menuWidth - 8);
  left = Math.max(8, left);

  let top = rect.top - 6;
  top = Math.max(8, Math.min(top, window.innerHeight - menuHeight - 8));

  dropdown.style.left = `${left}px`;
  dropdown.style.top = `${top}px`;
  dropdown.style.display = "";
  dropdown.style.visibility = "";
}

/** Open the named dropdown, closing any other open one first. */
window.toggleMenu = function (name) {
  const dropdown = document.getElementById(`menu-${name}`);
  const item = dropdown?.closest(".menu-bar-item");
  const trigger = item?.querySelector(":scope > .menu-trigger");
  if (!dropdown || !item || !trigger) return;

  const isOpen = item.classList.contains("menu-item-open");
  closeAllMenus();
  if (!isOpen) {
    item.classList.add("menu-item-open");
    positionMenuDropdown(trigger, dropdown);
  }
};

/** Close every open menu dropdown. Safe to call even if none are open. */
window.closeAllMenus = function () {
  document
    .querySelectorAll(".menu-bar-item.menu-item-open")
    .forEach((item) => item.classList.remove("menu-item-open"));
  // Also collapse any open submenus
  document
    .querySelectorAll(".menu-item-submenu.menu-item-open")
    .forEach((item) => item.classList.remove("menu-item-open"));
};

/**
 * Toggle a nested submenu inside an already-open parent dropdown.
 * Stops event propagation so the parent dropdown doesn't close.
 * Now click-driven (not hover) since the submenu is position:fixed and
 * placed by JS on open — there's no continuous CSS box to hover across
 * once the dropdown can float anywhere in the viewport.
 */
window.toggleSubmenu = function (event, submenuId) {
  event.stopPropagation();
  const submenuItem = event.currentTarget.closest("[data-menu='" + submenuId + "']");
  const trigger = event.currentTarget;
  const dropdown = submenuItem?.querySelector(":scope > .menu-submenu-dropdown");
  if (!submenuItem || !dropdown) return;
  const isOpen = submenuItem.classList.contains("menu-item-open");
  // Close any other open submenus at this level first
  submenuItem
    .closest(".menu-dropdown")
    ?.querySelectorAll(".menu-item-submenu.menu-item-open")
    .forEach((s) => s.classList.remove("menu-item-open"));
  if (!isOpen) {
    submenuItem.classList.add("menu-item-open");
    positionSubmenuDropdown(trigger, dropdown);
  }
};

/**
 * Open the Insert (إدراج) menu and pre-expand the templates submenu,
 * so the empty-state "استخدام قالب" button takes users straight there.
 */
window.openTemplatesMenu = function () {
  // Open the Insert top-level menu
  const insertItem = document.querySelector(".menu-bar-item[data-menu='insert']");
  if (!insertItem) return;
  closeAllMenus();
  const insertTrigger = insertItem.querySelector(":scope > .menu-trigger");
  const insertDropdown = insertItem.querySelector(":scope > .menu-dropdown");
  insertItem.classList.add("menu-item-open");
  if (insertTrigger && insertDropdown) positionMenuDropdown(insertTrigger, insertDropdown);
  // Pre-expand the templates submenu inside it
  const templatesItem = insertItem.querySelector(".menu-item-submenu[data-menu='insert-templates']");
  const templatesTrigger = templatesItem?.querySelector(":scope > .menu-option");
  const templatesDropdown = templatesItem?.querySelector(":scope > .menu-submenu-dropdown");
  if (templatesItem) {
    templatesItem.classList.add("menu-item-open");
    if (templatesTrigger && templatesDropdown) positionSubmenuDropdown(templatesTrigger, templatesDropdown);
  }
};

// ============================================================================
// STATISTICS MODAL
// ============================================================================

/** Open the stats modal (updating numbers first so they're always fresh). */
window.openStatsModal = function () {
  updateStatistics();
  const modal = document.getElementById("statsModal");
  if (modal) modal.style.display = "flex";
};

/** Close the stats modal. */
window.closeStatsModal = function () {
  const modal = document.getElementById("statsModal");
  if (modal) modal.style.display = "none";
};

/** Click-outside and Escape-to-close wiring for the menu bar, plus
 * hover-to-switch between top-level menus once one is already open.
 * NOTE: The menu bar is now embedded as .app-bar-menu inside #appTitleBar.
 * We attach the close listener to #appTitleBar so that clicks anywhere
 * INSIDE it (including submenu items) do NOT close the dropdown prematurely.
 * Submenus are now click-driven (see toggleSubmenu) since dropdowns are
 * position:fixed and placed by JS rather than pure CSS :hover. */
function setupMenuBarListeners() {
  // Reference the unified top bar (which contains the embedded menu nav)
  const appTitleBar = document.getElementById("appTitleBar");
  if (!appTitleBar) return;

  // Click outside the entire top bar AND outside any open dropdown → close.
  // Dropdowns are position:fixed now, so they're no longer DOM-nested
  // inside appTitleBar's visible box in a way .contains() would still
  // reliably reflect for outside-click purposes — check both.
  document.addEventListener("click", (e) => {
    if (!appTitleBar.contains(e.target) && !e.target.closest(".menu-dropdown")) {
      closeAllMenus();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllMenus();
  });

  // Re-close (rather than leave a dropdown stranded mid-air) if the bar
  // scrolls or the window resizes — its fixed position was computed for
  // the trigger's rect at open-time only.
  appTitleBar.addEventListener("scroll", closeAllMenus);
  window.addEventListener("resize", closeAllMenus);

  // Hover-to-switch: once any top-level menu is open, hovering another
  // .menu-bar-item (that has its own data-menu trigger) switches to it.
  // We scope to .menu-bar-inner to avoid triggering on submenu rows.
  const menuBarInner = appTitleBar.querySelector(".menu-bar-inner");
  if (!menuBarInner) return;
  menuBarInner.querySelectorAll(":scope > .menu-bar-item").forEach((item) => {
    item.addEventListener("mouseenter", () => {
      const anyOpen = menuBarInner.querySelector(".menu-item-open");
      if (anyOpen && anyOpen !== item) {
        anyOpen.classList.remove("menu-item-open");
        item.classList.add("menu-item-open");
        const trigger = item.querySelector(":scope > .menu-trigger");
        const dropdown = item.querySelector(":scope > .menu-dropdown");
        if (trigger && dropdown) positionMenuDropdown(trigger, dropdown);
      }
    });
  });
}

/** Outside-click/Escape closing for entry-item "more" (⋮) dropdowns.
 * Delegated to document once at init — safe across renderEntryItemsGrid()
 * re-renders since it doesn't hold references to the (re-created) menu
 * elements themselves. */
function setupEntryItemMenuListeners() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".entry-item-more-wrap")) {
      closeAllEntryItemMenus();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllEntryItemMenus();
  });
}

/** Outside-click/Escape closing for question-card "more" (⋮) dropdowns.
 * Same delegated pattern as setupEntryItemMenuListeners — question cards
 * are re-rendered/reordered often (add/move/duplicate/remove), so this is
 * attached once at init rather than per-card. */
function setupQuestionMenuListeners() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".question-more-wrap")) {
      closeAllQuestionMenus();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllQuestionMenus();
  });
}

function setupEventListeners() {
  // Close modals on background click
  document.addEventListener("click", (e) => {
    // Modal Overlays
    if (e.target.classList.contains("modal-overlay")) {
      if (
        e.target.id === "previewModal" &&
        typeof window.closePreview === "function"
      ) {
        window.closePreview();
      } else if (
        e.target.id === "importModal" &&
        typeof window.closeImportModal === "function"
      ) {
        window.closeImportModal();
      } else if (e.target.id === "statsModal") {
        window.closeStatsModal();
      } else {
        e.target.style.display = "none";
      }
    }

    // Shortcuts Panel
    const shortcutsPanel = document.getElementById("shortcutsPanel");
    if (shortcutsPanel && shortcutsPanel.style.display === "block") {
      // Allow clicking either toggle button (help-panel close btn, or the
      // "مساعدة" menu item) without immediately re-closing what it just opened.
      if (
        !shortcutsPanel.contains(e.target) &&
        !e.target.closest('button[onclick^="toggleShortcuts()"]') &&
        !e.target.closest('button[onclick^="toggleShortcuts();"]')
      ) {
        toggleShortcuts();
      }
    }
  });

  // Metadata event listeners
  const titleInput = document.getElementById("quizTitle");
  const descInput = document.getElementById("quizDescription");
  const sourceInput = document.getElementById("quizSource");

  titleInput.addEventListener("input", (e) => {
    quizData.title = e.target.value;
    updateCharCount("titleCharCount", e.target.value.length, 100);
    updateAppTitleBar();
    autosave();
  });

  autoResizeMdSource(descInput);
  descInput.addEventListener("input", (e) => {
    quizData.description = e.target.value;
    updateCharCount("descCharCount", e.target.value.length, 500);
    autoResizeMdSource(e.target);
    autosave();
  });

  if (sourceInput) {
    sourceInput.addEventListener("input", (e) => {
      quizData.source = e.target.value.trim();
      autosave();
    });
  }

  // Search functionality with debounce
  const searchInput = document.getElementById("questionSearch");
  if (searchInput) {
    searchInput.addEventListener("input", debounce(handleSearch, 300));
    searchInput.addEventListener("input", (e) => {
      const clearBtn = document.getElementById("clearSearch");
      if (clearBtn) {
        clearBtn.style.display = e.target.value ? "flex" : "none";
      }
    });
  }

  // Note: the FAB and its scroll-driven show/hide were removed when the
  // "add question" action moved into the persistent top action bar.
}

// ============================================================================
// CHARACTER COUNT
// ============================================================================

function updateCharCount(elementId, current, max) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = `${current}/${max}`;
    element.classList.remove("warning", "error");
    if (current > max * 0.9) {
      element.classList.add("warning");
    }
    if (current >= max) {
      element.classList.add("error");
    }
  }
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Alt+N: Add new question
    if (e.altKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      addQuestion();
    }

    // Ctrl+S: Save quiz
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveLocally();
    }

    // Ctrl+Z: Undo. Ctrl+Y or Ctrl+Shift+Z: Redo (both are common
    // conventions — Ctrl+Y matches the shortcut already printed on
    // #redoBtn's title attribute in create-quiz.html).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      performUndo();
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key.toLowerCase() === "y" ||
        (e.shiftKey && e.key.toLowerCase() === "z"))
    ) {
      e.preventDefault();
      performRedo();
    }

    // Ctrl+P: Preview quiz
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      previewQuiz();
    }

    // Ctrl+E: Export quiz
    if ((e.ctrlKey || e.metaKey) && e.key === "e") {
      e.preventDefault();
      exportQuiz();
    }

    // Escape: close any open modal
    if (e.key === "Escape") {
      const statsModal = document.getElementById("statsModal");
      if (statsModal && statsModal.style.display !== "none") {
        window.closeStatsModal();
      }
    }

    // ?: Show shortcuts
    if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
      const target = e.target;
      if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
        e.preventDefault();
        toggleShortcuts();
      }
    }
  });
}

/**
 * Show/hide the quiz password's plaintext, like a normal password field's
 * reveal button — toggles the input's type between "password" and "text"
 * and swaps the eye / eye-off icon + label to match the resulting state.
 */
window.toggleQuizPasswordVisibility = function () {
  const input = document.getElementById("quizPassword");
  const btn = document.getElementById("quizPasswordToggle");
  if (!input || !btn) return;

  const revealing = input.type === "password";
  input.type = revealing ? "text" : "password";

  const eyeIcon = btn.querySelector(".icon-eye");
  const eyeOffIcon = btn.querySelector(".icon-eye-off");
  if (eyeIcon) eyeIcon.style.display = revealing ? "none" : "";
  if (eyeOffIcon) eyeOffIcon.style.display = revealing ? "" : "none";

  const label = revealing ? "إخفاء كلمة المرور" : "إظهار كلمة المرور";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-pressed", String(revealing));
};

/**
 * Copy the quiz password to the clipboard, independent of whether it's
 * currently masked or revealed (reads input.value directly either way).
 * Swaps the button's copy icon for a checkmark briefly as confirmation,
 * matching the pattern already used for the copy-question action, and
 * falls back to a hidden-textarea + execCommand copy for browsers/contexts
 * where navigator.clipboard is unavailable (e.g. non-HTTPS/local dev).
 */
window.copyQuizPassword = async function () {
  const input = document.getElementById("quizPassword");
  const btn = document.getElementById("quizPasswordCopy");
  if (!input || !btn) return;

  const value = input.value;
  if (!value) {
    showNotification("لا توجد كلمة مرور", "أدخل كلمة مرور أولاً لنسخها", "error");
    return;
  }

  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      copied = true;
    }
  } catch (err) {
    // Fall through to the execCommand fallback below.
  }

  if (!copied) {
    try {
      const temp = document.createElement("textarea");
      temp.value = value;
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      copied = document.execCommand("copy");
      document.body.removeChild(temp);
    } catch (err) {
      copied = false;
    }
  }

  if (!copied) {
    showNotification("تعذر النسخ", "لم يتمكن المتصفح من نسخ كلمة المرور", "error");
    return;
  }

  const copyIcon = btn.querySelector(".icon-copy");
  const checkIcon = btn.querySelector(".icon-check");
  if (copyIcon) copyIcon.style.display = "none";
  if (checkIcon) checkIcon.style.display = "";
  btn.classList.add("copied");
  btn.title = "تم النسخ";
  btn.setAttribute("aria-label", "تم نسخ كلمة المرور");

  clearTimeout(btn._copyResetTimer);
  btn._copyResetTimer = setTimeout(() => {
    if (copyIcon) copyIcon.style.display = "";
    if (checkIcon) checkIcon.style.display = "none";
    btn.classList.remove("copied");
    btn.title = "نسخ كلمة المرور";
    btn.setAttribute("aria-label", "نسخ كلمة المرور");
  }, 1500);
};

window.toggleShortcuts = function () {
  const panel = document.getElementById("shortcutsPanel");
  if (panel.style.display === "none") {
    panel.style.display = "block";
  } else {
    panel.style.display = "none";
  }
};

// ============================================================================
// PROGRESS TRACKING
// ============================================================================

function updateProgress() {
  const totalQuestions = quizData.questions.length;
  const progressText = document.getElementById("progressText");
  const progressBar = document.getElementById("progressBar");

  if (progressText) {
    progressText.textContent = `${totalQuestions} ${totalQuestions === 1 ? "سؤال" : "أسئلة"}`;
  }

  if (progressBar) {
    const progress = Math.min((totalQuestions / 10) * 100, 100);
    progressBar.style.width = `${progress}%`;
  }
}

// ============================================================================
// STATISTICS
// ============================================================================

function updateStatistics() {
  // Stats now live inside #statsModal rather than an inline card — just
  // keep the numbers up-to-date; the modal itself is shown on demand.
  const totalQuestions = quizData.questions.length;

  const questionsWithImages = quizData.questions.filter(
    (q) => q.image && q.image.trim(),
  ).length;
  const questionsWithExplanations = quizData.questions.filter(
    (q) => q.explanation && q.explanation.trim(),
  ).length;
  const totalOptions = quizData.questions.reduce(
    (sum, q) => sum + (Array.isArray(q.options) ? q.options.length : 1),
    0,
  );
  const avgOptions =
    totalQuestions > 0 ? (totalOptions / totalQuestions).toFixed(1) : "0";

  const statQ = document.getElementById("statQuestions");
  const statI = document.getElementById("statImages");
  const statE = document.getElementById("statExplanations");
  const statA = document.getElementById("statAvgOptions");
  if (statQ) statQ.textContent = totalQuestions;
  if (statI) statI.textContent = questionsWithImages;
  if (statE) statE.textContent = questionsWithExplanations;
  if (statA) statA.textContent = avgOptions;
}

// ============================================================================
// QUESTION MANAGEMENT
// ============================================================================

window.addQuestion = function () {
  pushHistorySnapshot();
  const questionId = ++questionIdCounter;

  const question = {
    id: questionId,
    q: "",
    options: ["", ""],
    correct: [],
    image: "",
    audio: "",
    video: "",
    explanation: "",
  };

  quizData.questions.push(question);
  renderQuestion(question);
  updateEmptyState();
  updateProgress();
  updateStatistics();
  autosave();

  setTimeout(() => {
    const questionCard = document.getElementById(`question-${questionId}`);
    if (questionCard) {
      questionCard.scrollIntoView({ behavior: "smooth", block: "center" });
      // Activate the question text md editor so user can type immediately
      const questionTextId = `question-text-${questionId}`;
      activateMdEditor(questionTextId);
    }
  }, 100);
};

window.removeQuestion = async function (questionId) {
  if (!(await _confirm("هل أنت متأكد من حذف هذا السؤال؟"))) {
    return;
  }

  const index = quizData.questions.findIndex((q) => q.id === questionId);
  if (index !== -1) {
    pushHistorySnapshot();
    quizData.questions.splice(index, 1);

    const questionCard = document.getElementById(`question-${questionId}`);
    if (questionCard) {
      questionCard.style.animation = "slideOut 0.3s ease";
      setTimeout(() => {
        questionCard.remove();
        updateQuestionNumbers();
        updateEmptyState();
        updateProgress();
        updateStatistics();
        showNotification("تم الحذف", "تم حذف السؤال بنجاح", "success");
      }, 300);
    }

    autosave();
  }
};

window.duplicateQuestion = function (questionId) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (!question) return;

  pushHistorySnapshot();
  const newId = ++questionIdCounter;
  const duplicatedQuestion = {
    ...question,
    id: newId,
    q: question.q,
  };

  const index = quizData.questions.findIndex((q) => q.id === questionId);
  quizData.questions.splice(index + 1, 0, duplicatedQuestion);

  renderQuestion(duplicatedQuestion, index + 1);
  updateQuestionNumbers();
  updateProgress();
  updateStatistics();
  autosave();

  showNotification("تم النسخ", "تم نسخ السؤال بنجاح", "success");

  setTimeout(() => {
    const newCard = document.getElementById(`question-${newId}`);
    if (newCard) {
      newCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 100);
};

function renderQuestion(question, insertAtIndex = null) {
  const container = document.getElementById("questionsContainer");
  const questionNumber =
    quizData.questions.findIndex((q) => q.id === question.id) + 1;

  const questionCard = document.createElement("div");
  questionCard.className = "question-card";
  questionCard.id = `question-${question.id}`;
  questionCard.dataset.questionId = question.id;

  // ── Detect question type and tag the card ──────────────────────────────────
  const isEssay = question.answer;
  if (isEssay) questionCard.classList.add("question-card--essay");

  if (!isEssay) normalizeCorrectField(question);

  // Check if question is incomplete
  const isIncomplete =
    !question.q ||
    question.q.trim() === "" ||
    question.options.some((opt) => !opt || opt.trim() === "") ||
    (!isEssay &&
      (!Array.isArray(question.correct) || question.correct.length === 0));
  if (isIncomplete) {
    questionCard.classList.add("incomplete");
  }

  questionCard.innerHTML = `
        <div class="question-header">
            ${reorderModeActive
      ? `<button type="button" class="question-drag-handle" aria-label="اسحب لإعادة ترتيب السؤال ${questionNumber}" title="اسحب لإعادة الترتيب">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="9" cy="6" r="1.2" /><circle cx="15" cy="6" r="1.2" />
                        <circle cx="9" cy="12" r="1.2" /><circle cx="15" cy="12" r="1.2" />
                        <circle cx="9" cy="18" r="1.2" /><circle cx="15" cy="18" r="1.2" />
                    </svg>
                </button>`
      : ""
    }
            <span class="question-number" id="qnum-${question.id}">
                ${bulkModeActive ? `<input type="checkbox" class="question-select-checkbox" onchange="handleQuestionSelect(event, ${question.id})" onclick="event.stopPropagation()">` : ""}
                <span class="q-label">سؤال ${questionNumber}</span>
                <span class="q-preview ltr" id="qpreview-${question.id}"></span>
            </span>
            <div class="question-actions" onclick="event.stopPropagation()">
                <div class="question-more-wrap">
                    <button type="button" class="question-more-btn" onclick="toggleQuestionMenu(event, ${question.id})"
                        aria-label="خيارات إضافية" title="خيارات إضافية">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="1" />
                            <circle cx="19" cy="12" r="1" />
                            <circle cx="5" cy="12" r="1" />
                        </svg>
                    </button>
                    <div class="question-more-menu" id="questionMenu-${question.id}" role="menu" aria-label="خيارات السؤال">
                        <button type="button" class="question-menu-option" role="menuitem" onclick="previewSingleQuestion(${question.id}); closeAllQuestionMenus();">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                            <span>معاينة</span>
                        </button>
                        <div class="menu-separator"></div>
                        <button type="button" class="question-menu-option" role="menuitem" onclick="moveQuestion(${question.id}, 'top'); closeAllQuestionMenus();">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 11l-5-5-5 5"/><path d="M17 18l-5-5-5 5"/></svg>
                            <span>نقل لأعلى السؤال</span>
                        </button>
                        <button type="button" class="question-menu-option" role="menuitem" onclick="moveQuestion(${question.id}, 'up'); closeAllQuestionMenus();">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                            <span>نقل للأعلى</span>
                        </button>
                        <button type="button" class="question-menu-option" role="menuitem" onclick="moveQuestion(${question.id}, 'down'); closeAllQuestionMenus();">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                            <span>نقل للأسفل</span>
                        </button>
                        <button type="button" class="question-menu-option" role="menuitem" onclick="moveQuestion(${question.id}, 'bottom'); closeAllQuestionMenus();">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 13l-5 5-5-5"/><path d="M17 6l-5 5-5-5"/></svg>
                            <span>نقل لأسفل السؤال</span>
                        </button>
                        <div class="menu-separator"></div>
                        <button type="button" class="question-menu-option" role="menuitem" onclick="toggleQuestionCollapse(${question.id}); closeAllQuestionMenus();">
                            <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24"
                              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                              stroke-linejoin="round">
                              <path d="m7 20 5-5 5 5" />
                              <path d="m7 4 5 5 5-5" />
                             </svg>
                            <span>طي/توسيع السؤال</span>
                        </button>
                        <button type="button" class="question-menu-option" role="menuitem" onclick="duplicateQuestion(${question.id}); closeAllQuestionMenus();">
                            <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                            <span>مضاعفة السؤال</span>
                        </button>
                        <div class="menu-separator"></div>
                        <button type="button" class="question-menu-option question-menu-option-danger" role="menuitem" onclick="closeAllQuestionMenus(); removeQuestion(${question.id});">
                            <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            <span>حذف السؤال</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="question-body">
            <div class="form-group">
                <label>نصّ السؤال *</label>
                ${mdEditorHtml(`question-text-${question.id}`, question.q, "أدخل سؤالك هنا...", 3)}
            </div>
            
            <div class="form-group">
                <label class="options-label">${isEssay ? "الإجابة المرجعية" : "الإختيارات"}</label>
                <div id="options-container-${question.id}" class="options-list">
                    ${renderOptions(question)}
                </div>
                <div id="option-btn-${question.id}">
                  ${isEssay
      ? `<button class="add-option-btn add-option-btn--convert" onclick="convertEssayToMcq(${question.id})">
                         <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> تحويل إلى اختيار متعدد
                       </button>`
      : `<button class="add-option-btn" onclick="addOption(${question.id})">
                         <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg> إضافة خيار
                       </button>
                       <button class="add-option-btn add-option-btn--convert" onclick="convertMcqToEssay(${question.id})">
                         <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg> تحويل إلى سؤال مقالي
                       </button>`
    }
                </div>
            </div>
            
            ${renderCombinedMediaSection(question)}
            
            <div class="form-group">
                <label><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lightbulb-icon lucide-lightbulb"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> الشرح (اختياري)</label>
                ${mdEditorHtml(`question-explanation-${question.id}`, question.explanation || "", "قدم تفسيرًا للإجابة الصحيحة", 3)}
            </div>
        </div>
    `;

  if (insertAtIndex !== null) {
    const existingCards = container.children;
    if (insertAtIndex < existingCards.length) {
      container.insertBefore(questionCard, existingCards[insertAtIndex]);
    } else {
      container.appendChild(questionCard);
    }
  } else {
    container.appendChild(questionCard);
  }

  setupQuestionEventListeners(question.id);
  renderMathIn(questionCard);

  // Load media previews if existing values present
  if (question.image) updateImagePreview(question.id, question.image);
  if (question.audio) updateAudioPreview(question.id, question.audio);
  if (question.video) updateVideoPreview(question.id, question.video);
}

// Click on header area (but not buttons/drag) collapses the card
window.handleHeaderClick = function (e, questionId) {
  // Only collapse if clicking directly on header/label, not child interactive elements
  if (
    e.target.closest(".question-actions") ||
    e.target.closest(".question-more-wrap") ||
    e.target.closest(".question-select-checkbox") ||
    e.target.tagName === "BUTTON" ||
    e.target.tagName === "INPUT"
  )
    return;
  toggleQuestionCollapse(questionId);
};

window.toggleQuestionCollapse = function (questionId) {
  const card = document.getElementById(`question-${questionId}`);
  if (!card) return;
  card.classList.toggle("collapsed");

  const isCollapsed = card.classList.contains("collapsed");
  const qPreview = document.getElementById(`qpreview-${questionId}`);

  if (isCollapsed && qPreview) {
    // Get question text from state or fallback to textarea
    const question = quizData.questions.find((q) => q.id === questionId);
    const textarea = document.getElementById(`question-text-${questionId}`);
    const rawText =
      (question && question.q) || (textarea && textarea.value) || "";
    const preview = rawText
      .replace(/\n/g, " ")
      .replace(/```[\s\S]*?```/g, "[كود]")
      .replace(/`/g, "")
      .trim();
    qPreview.textContent = preview
      ? preview.slice(0, 20) + (preview.length > 20 ? "…" : "")
      : "";
  } else if (qPreview) {
    qPreview.textContent = "";
  }
};

function setupQuestionEventListeners(questionId) {
  // Question text: inline md editor
  setupMdEditor(`question-text-${questionId}`, (val) =>
    updateQuestionData(questionId, "q", val),
  );

  // Media section listeners (image, audio, video)
  setupCombinedMediaListeners(questionId);

  // Explanation: inline md editor
  setupMdEditor(`question-explanation-${questionId}`, (val) =>
    updateQuestionData(questionId, "explanation", val),
  );

  // Option md editors are set up after rerenderOptions via setupOptionMdEditors
  setupOptionMdEditors(questionId);
}

// ============================================================================
// COMBINED MEDIA DROPZONE (image / audio / video, auto-detected)
// ============================================================================
//
// One dropzone + one link input per question, instead of three separate
// always-visible sections. Admins can drop/select any file or paste any
// link; the type (image / audio / video) is auto-detected from the file's
// MIME type or the URL's extension/host (e.g. YouTube), then routed into
// the matching `question.image` / `question.audio` / `question.video`
// field. Non-admin users get the link input only (no upload).

const MEDIA_MIME_MAP = {
  image: new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ]),
  audio: new Set([
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/webm",
    "audio/aac",
    "audio/x-m4a",
    "audio/mp4",
  ]),
  video: new Set(["video/mp4", "video/webm", "video/ogg"]),
};
const MEDIA_MAX_SIZE = {
  image: 5 * 1024 * 1024,
  audio: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};
const MEDIA_EXT_MAP = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/aac": "aac",
  "audio/x-m4a": "m4a",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
};

/**
 * Compress an image File in-browser using <canvas> before upload.
 * Downscales to a max dimension and re-encodes as JPEG at a given quality.
 * Returns the smaller of {compressed, original} — never makes things worse.
 * Skips SVG (vector) and GIF (animation would be flattened to one frame).
 */
async function compressImageFile(
  file,
  { maxDim = 1600, quality = 0.82, qualityFloor = 0.6 } = {},
) {
  if (!file || !file.type) return file;
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    return file;
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    console.warn("[compressImageFile] decode failed, using original", err);
    return file;
  }

  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", Math.max(quality, qualityFloor));
    });

    if (!blob) return file;

    // Only use the compressed version if it's actually smaller.
    if (blob.size >= file.size) return file;

    const ext = "jpg";
    const baseName = file.name ? file.name.replace(/\.[^.]+$/, "") : "image";
    return new File([blob], `${baseName}.${ext}`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (err) {
    console.warn("[compressImageFile] compression failed, using original", err);
    return file;
  } finally {
    bitmap.close?.();
  }
}

/** Detect media type ("image"|"audio"|"video"|null) from a File's MIME type. */
function detectMediaTypeFromFile(file) {
  if (!file || !file.type) return null;
  for (const type of ["image", "audio", "video"]) {
    if (MEDIA_MIME_MAP[type].has(file.type)) return type;
  }
  return null;
}

/** Detect media type ("image"|"audio"|"video"|null) from a URL string. */
function detectMediaTypeFromUrl(url) {
  if (!url) return null;
  const clean = url.split("?")[0].split("#")[0].trim().toLowerCase();
  if (/youtube\.com\/watch\?v=|youtu\.be\//i.test(url)) return "video";
  if (/\.(jpe?g|png|gif|webp|svg)$/.test(clean)) return "image";
  if (/\.(mp3|ogg|wav|webm|aac|m4a)$/.test(clean)) return "audio";
  if (/\.(mp4|ogv|mov)$/.test(clean)) return "video";
  return null;
}

/** Which media field(s) a question currently has content in. */
function getActiveMediaFields(question) {
  return ["image", "audio", "video"].filter(
    (t) => question[t] && question[t].trim(),
  );
}

const MEDIA_TYPE_LABELS = { image: "صورة", audio: "ملف صوتي", video: "فيديو" };
const MEDIA_TYPE_ICONS = {
  image: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  audio: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  video: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>`,
};

/**
 * Build the HTML for one question's combined media dropzone.
 * Shows a chip + preview for each media field that currently has content,
 * plus a single dropzone/link input to add another (or replace one).
 */
function renderCombinedMediaSection(question) {
  const qId = question.id;
  const active = getActiveMediaFields(question);

  const chips = active
    .map((type) => {
      const val = escapeHtml(question[type] || "");
      return `
        <div class="media-chip" id="media-chip-${type}-${qId}">
          <div class="media-chip-header">
            <span class="media-chip-label">${MEDIA_TYPE_ICONS[type]} ${MEDIA_TYPE_LABELS[type]}</span>
            <button type="button" class="media-chip-remove" title="إزالة" aria-label="إزالة ${MEDIA_TYPE_LABELS[type]}" onclick="removeQuestionMedia(${qId}, '${type}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <input type="url" class="ltr media-chip-url" id="question-${type}-${qId}" value="${val}" placeholder="https://..." />
          <div id="${type}-preview-${qId}" class="${type}-preview-container"></div>
        </div>`;
    })
    .join("");

  const dropzone = isAdmin
    ? `
      <div class="media-dropzone" id="media-dropzone-${qId}"
           onclick="document.getElementById('media-upload-input-${qId}').click()"
           ondragover="event.preventDefault();this.classList.add('drag-active')"
           ondragleave="this.classList.remove('drag-active')"
           ondrop="handleCombinedMediaDrop(event, ${qId})">
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <p>اسحب صورة أو صوت أو فيديو هنا<br><span>أو انقر للاختيار — أو الصق رابط YouTube أدناه</span></p>
        <p class="upload-size-hint">صور حتى 5MB · صوت حتى 10MB · فيديو حتى 50MB (أو رابط YouTube)</p>
      </div>
      <input type="file" id="media-upload-input-${qId}" accept="${[...MEDIA_MIME_MAP.image, ...MEDIA_MIME_MAP.audio, ...MEDIA_MIME_MAP.video].join(",")}" style="display:none;" />
      <div class="upload-progress" id="media-upload-progress-${qId}" style="display:none;">
        <div class="upload-progress-bar" id="media-upload-progress-bar-${qId}"></div>
        <span class="upload-progress-text" id="media-upload-progress-text-${qId}">جاري الرفع...</span>
      </div>`
    : "";

  return `
    <div class="form-group media-form-group">
      <label>وسائط السؤال (اختيارية)</label>
      ${chips}
      ${dropzone}
      <div class="media-link-row">
        <input type="url" class="ltr" id="media-link-input-${qId}" placeholder="أو الصق رابط صورة / صوت / فيديو / YouTube هنا" />
        <button type="button" class="btn btn-secondary btn-sm" onclick="addMediaFromLinkInput(${qId})">إضافة</button>
      </div>
    </div>`;
}

/** Wire listeners for one question's combined media dropzone + chip URL inputs + link-add row */
function setupCombinedMediaListeners(questionId) {
  // Chip URL inputs (for existing media, editable in place)
  ["image", "audio", "video"].forEach((type) => {
    const input = document.getElementById(`question-${type}-${questionId}`);
    if (!input) return;
    input.addEventListener(
      "input",
      debounce((e) => {
        updateQuestionData(questionId, type, e.target.value);
        updateMediaPreview(questionId, type, e.target.value);
      }, 500),
    );
    if (input.value) updateMediaPreview(questionId, type, input.value);
  });

  // Quick-add link row
  const linkInput = document.getElementById(`media-link-input-${questionId}`);
  if (linkInput) {
    linkInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addMediaFromLinkInput(questionId);
      }
    });
  }

  if (!isAdmin) return;

  const fileInput = document.getElementById(`media-upload-input-${questionId}`);
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) {
        uploadCombinedMediaFile(questionId, fileInput.files[0]);
      }
    });
  }
}

/** Add media from the free-text link input, auto-detecting its type */
window.addMediaFromLinkInput = function (questionId) {
  const linkInput = document.getElementById(`media-link-input-${questionId}`);
  if (!linkInput) return;
  const url = linkInput.value.trim();
  if (!url) return;

  const type = detectMediaTypeFromUrl(url);
  if (!type) {
    showNotification(
      "تعذّر تحديد نوع الرابط",
      "تأكد أن الرابط ينتهي بامتداد صورة/صوت/فيديو معروف، أو أنه رابط YouTube.",
      "error",
    );
    return;
  }

  updateQuestionData(questionId, type, url);
  linkInput.value = "";
  rerenderCombinedMedia(questionId);
};

/** Remove one media field from a question and re-render the dropzone section */
window.removeQuestionMedia = function (questionId, type) {
  updateQuestionData(questionId, type, "");
  rerenderCombinedMedia(questionId);
};

/** Re-render just the media section for a question, in place */
function rerenderCombinedMedia(questionId) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (!question) return;
  const card = document.getElementById(`question-${questionId}`);
  const oldSection = card?.querySelector(".media-form-group");
  if (!oldSection) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderCombinedMediaSection(question);
  const newSection = wrapper.firstElementChild;
  oldSection.replaceWith(newSection);
  setupCombinedMediaListeners(questionId);
}

/** Render the preview for a given media field/type */
function updateMediaPreview(questionId, type, url) {
  if (type === "image") updateImagePreview(questionId, url);
  if (type === "audio") updateAudioPreview(questionId, url);
  if (type === "video") updateVideoPreview(questionId, url);
}

/** Handle a file dropped on the combined dropzone */
window.handleCombinedMediaDrop = function (e, questionId) {
  e.preventDefault();
  const zone = document.getElementById(`media-dropzone-${questionId}`);
  if (zone) zone.classList.remove("drag-active");
  const file = e.dataTransfer?.files?.[0];
  if (file) uploadCombinedMediaFile(questionId, file);
};

/**
 * Upload a media file directly to Supabase Storage, auto-detecting its
 * type (image/audio/video) from its MIME type, then route it into the
 * matching question field. No Vercel serverless function needed.
 */
async function uploadCombinedMediaFile(questionId, inputFile) {
  let file = inputFile;
  const mediaType = detectMediaTypeFromFile(file);
  if (!mediaType) {
    showNotification(
      "نوع غير مدعوم",
      `نوع الملف (${file.type || "غير معروف"}) غير مدعوم. الأنواع المدعومة: صور، صوت، فيديو.`,
      "error",
    );
    return;
  }

  const progressEl = document.getElementById(
    `media-upload-progress-${questionId}`,
  );
  const progressBar = document.getElementById(
    `media-upload-progress-bar-${questionId}`,
  );
  const progressTxt = document.getElementById(
    `media-upload-progress-text-${questionId}`,
  );
  const zone = document.getElementById(`media-dropzone-${questionId}`);

  if (mediaType === "image") {
    if (progressEl) progressEl.style.display = "flex";
    if (progressBar) progressBar.style.width = "10%";
    if (progressTxt) progressTxt.textContent = "جاري ضغط الصورة...";
    if (zone) zone.style.opacity = "0.5";
    file = await compressImageFile(file);
  }

  if (file.size > MEDIA_MAX_SIZE[mediaType]) {
    const maxMb = MEDIA_MAX_SIZE[mediaType] / (1024 * 1024);
    showNotification(
      "الملف كبير جدًا",
      `الحد الأقصى لـ ${MEDIA_TYPE_LABELS[mediaType]} هو ${maxMb} ميجابايت.`,
      "error",
    );
    return;
  }
  if (file.size === 0) {
    showNotification("ملف فارغ", "الملف المحدد فارغ.", "error");
    return;
  }

  if (progressEl) progressEl.style.display = "flex";
  if (progressBar) progressBar.style.width = "20%";
  if (progressTxt) progressTxt.textContent = "جاري الاتصال...";
  if (zone) zone.style.opacity = "0.5";

  try {
    const client = await ensureSharedSupabaseClient();
    if (!client)
      throw new Error(
        "تعذّر الاتصال بـ Supabase. حاول تسجيل الخروج والدخول مجدداً.",
      );

    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) {
      throw new Error("جلسة Supabase منتهية. أعد تسجيل الدخول.");
    }

    if (progressBar) progressBar.style.width = "40%";
    if (progressTxt) progressTxt.textContent = "جاري الرفع...";

    const uid = sessionData.session.user.id;
    const ext = MEDIA_EXT_MAP[file.type] || "bin";
    const random = Math.random().toString(36).slice(2, 9);
    const storagePath = `${mediaType}s/${uid}/${Date.now()}-${random}.${ext}`;

    const { error: uploadError } = await client.storage
      .from("quiz-media")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw new Error(uploadError.message);

    if (progressBar) progressBar.style.width = "90%";

    const { data: urlData } = client.storage
      .from("quiz-media")
      .getPublicUrl(storagePath);

    if (!urlData?.publicUrl) throw new Error("تم الرفع لكن فشل توليد الرابط.");

    const publicUrl = urlData.publicUrl;

    updateQuestionData(questionId, mediaType, publicUrl);
    rerenderCombinedMedia(questionId);

    if (progressBar) progressBar.style.width = "100%";
    if (progressTxt) progressTxt.textContent = "تم الرفع بنجاح ✓";
    setTimeout(() => {
      const stillProgressEl = document.getElementById(
        `media-upload-progress-${questionId}`,
      );
      if (stillProgressEl) stillProgressEl.style.display = "none";
    }, 2000);

    showNotification(
      "تم الرفع",
      `تم رفع ${MEDIA_TYPE_LABELS[mediaType]} بنجاح وحفظ الرابط.`,
      "success",
    );
  } catch (err) {
    console.error("[uploadCombinedMediaFile]", err);
    if (progressEl) progressEl.style.display = "none";
    showNotification(
      "خطأ في الرفع",
      err.message || "حدث خطأ أثناء رفع الملف.",
      "error",
    );
  } finally {
    const stillZone = document.getElementById(`media-dropzone-${questionId}`);
    if (stillZone) stillZone.style.opacity = "";
  }
}

function updateImagePreview(questionId, imageUrl) {
  const previewContainer = document.getElementById(
    `image-preview-${questionId}`,
  );
  if (!previewContainer) return;

  if (!imageUrl || !imageUrl.trim()) {
    previewContainer.innerHTML = "";
    return;
  }

  previewContainer.innerHTML =
    '<div class="image-loading"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-circle-icon lucide-loader-circle"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> جاري تحميل الصورة...</div>';

  const img = new Image();
  img.onload = function () {
    previewContainer.innerHTML = `<img src="${escapeHtml(imageUrl)}" alt="معاينة الصورة" class="image-preview">`;
  };
  img.onerror = function () {
    previewContainer.innerHTML =
      '<div class="image-error"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image-off-icon lucide-image-off"><line x1="2" x2="22" y1="2" y2="22"/><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83"/><line x1="13.5" x2="6" y1="13.5" y2="21"/><line x1="18" x2="21" y1="12" y2="15"/><path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59"/><path d="M21 15V5a2 2 0 0 0-2-2H9"/></svg> فشل تحميل الصورة. تحقق من الرابط.</div>';
  };
  img.src = imageUrl;
}

function updateAudioPreview(questionId, audioUrl) {
  const container = document.getElementById(`audio-preview-${questionId}`);
  if (!container) return;
  if (!audioUrl || !audioUrl.trim()) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <audio class="question-audio-preview" controls preload="metadata">
      <source src="${escapeHtml(audioUrl)}">
      متصفحك لا يدعم تشغيل الصوت.
    </audio>`;
}

function updateVideoPreview(questionId, videoUrl) {
  const container = document.getElementById(`video-preview-${questionId}`);
  if (!container) return;
  if (!videoUrl || !videoUrl.trim()) {
    container.innerHTML = "";
    return;
  }

  // YouTube embed
  const ytMatch = videoUrl.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/,
  );
  if (ytMatch) {
    container.innerHTML = `
      <div class="video-preview-embed">
        <iframe
          src="https://www.youtube.com/embed/${ytMatch[1]}"
          frameborder="0" allowfullscreen
          loading="lazy"
          title="معاينة الفيديو"
        ></iframe>
      </div>`;
    return;
  }

  // Direct video file
  container.innerHTML = `
    <video class="question-video-preview" controls preload="metadata">
      <source src="${escapeHtml(videoUrl)}">
      متصفحك لا يدعم تشغيل الفيديو.
    </video>`;
}

function updateQuestionData(questionId, field, value) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (question) {
    question[field] = value;
    if (field === "explanation" || field === "image") {
      updateStatistics();
    }
    autosave();
  }
}

function updateQuestionNumbers() {
  quizData.questions.forEach((question, index) => {
    const qLabel = document
      .getElementById(`question-${question.id}`)
      ?.querySelector(".q-label");
    if (qLabel) {
      qLabel.textContent = `سؤال ${index + 1}`;
    }
  });
}

// ============================================================================
// QUESTION REORDERING
// ============================================================================
//
// Previously implemented with native HTML5 drag-and-drop, armed from a
// `.drag-handle` mousedown. That approach broke on touch devices: touchstart
// set `draggable = true`, but native HTML5 DnD is mouse-only, so no matching
// `dragstart` ever fired — leaving the element in a stuck intermediate drag
// state that froze the page with no console error. Replaced with explicit
// move-up/move-down buttons: deterministic, keyboard-accessible, no native
// drag gesture involved at all.

window.moveQuestion = function (questionId, direction) {
  const index = quizData.questions.findIndex((q) => q.id === questionId);
  if (index === -1) return;

  let targetIndex;
  if (direction === "up") targetIndex = index - 1;
  else if (direction === "down") targetIndex = index + 1;
  else if (direction === "top") targetIndex = 0;
  else if (direction === "bottom") targetIndex = quizData.questions.length - 1;
  else return;

  if (targetIndex < 0 || targetIndex >= quizData.questions.length) return;
  if (targetIndex === index) return;

  pushHistorySnapshot();
  const [moved] = quizData.questions.splice(index, 1);
  quizData.questions.splice(targetIndex, 0, moved);

  const container = document.getElementById("questionsContainer");
  const card = document.getElementById(`question-${questionId}`);

  if (card) {
    if (direction === "up") {
      const sibling = card.previousElementSibling;
      if (sibling) container.insertBefore(card, sibling);
    } else if (direction === "down") {
      const sibling = card.nextElementSibling;
      if (sibling) container.insertBefore(sibling, card);
    } else if (direction === "top") {
      container.insertBefore(card, container.firstElementChild);
    } else if (direction === "bottom") {
      container.appendChild(card);
    }
  }

  updateQuestionNumbers();
  autosave();
};

function rerenderAllQuestions() {
  const container = document.getElementById("questionsContainer");
  container.innerHTML = "";
  quizData.questions.forEach((question) => {
    renderQuestion(question);
  });
  updateQuestionNumbers();
}

// ============================================================================
// REORDER MODE (drag handle, Pointer Events)
// ============================================================================
//
// A dedicated toggleable mode rather than an always-on handle, per the same
// touch-safety lesson as the old HTML5 DnD removal above: this uses Pointer
// Events (pointerdown/pointermove/pointerup), which — unlike HTML5
// draggable/dragstart — fire consistently for mouse, touch, and pen alike,
// so there's no touch-only failure mode to repeat here. The handle only
// exists in the DOM while reorderModeActive (see renderQuestion), so it
// can't be grabbed by accident during normal editing.

let reorderDrag = null; // { card, placeholder, pointerId, startY, offsetY }

window.toggleReorderMode = function () {
  reorderModeActive = !reorderModeActive;
  const btn = document.getElementById("reorderModeBtn");

  // Reorder and bulk-select are mutually exclusive — both repurpose the
  // question header (drag handle vs. checkbox) and both reorder/renumber
  // the list, so having both active at once would be visually cluttered
  // and semantically confusing (what does "select" mean while dragging?).
  if (reorderModeActive && bulkModeActive) {
    window.toggleBulkMode();
  }

  if (btn) {
    btn.classList.toggle("active", reorderModeActive);
    btn.setAttribute("aria-pressed", String(reorderModeActive));
  }
  document.body.classList.toggle("reorder-mode-active", reorderModeActive);

  // Re-render so every card picks up (or drops) its drag handle — simplest
  // way to keep this in sync with bulkModeActive's own checkbox toggling.
  rerenderAllQuestions();
};

function setupReorderHandles() {
  const container = document.getElementById("questionsContainer");
  if (!container || container.dataset.reorderReady) return;
  container.dataset.reorderReady = "1";

  container.addEventListener("pointerdown", (e) => {
    if (!reorderModeActive) return;
    const handle = e.target.closest(".question-drag-handle");
    if (!handle) return;
    const card = handle.closest(".question-card");
    if (!card) return;

    e.preventDefault();

    const rect = card.getBoundingClientRect();
    const placeholder = document.createElement("div");
    placeholder.className = "question-drag-placeholder";
    placeholder.style.height = `${rect.height}px`;
    card.after(placeholder);

    card.classList.add("dragging");
    card.style.width = `${rect.width}px`;
    card.style.position = "fixed";
    card.style.top = `${rect.top}px`;
    card.style.left = `${rect.left}px`;
    card.style.zIndex = "500";
    card.style.pointerEvents = "none";

    reorderDrag = {
      card,
      placeholder,
      pointerId: e.pointerId,
      startY: e.clientY,
      cardTop: rect.top,
    };

    handle.setPointerCapture(e.pointerId);
  });

  container.addEventListener("pointermove", (e) => {
    if (!reorderDrag || e.pointerId !== reorderDrag.pointerId) return;
    e.preventDefault();

    const dy = e.clientY - reorderDrag.startY;
    reorderDrag.card.style.top = `${reorderDrag.cardTop + dy}px`;

    // Find which sibling the pointer is currently over and move the
    // placeholder there — the dragged card itself stays position:fixed
    // and is ignored by elementsFromPoint via pointer-events:none.
    const target = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((el) => el.classList?.contains("question-card") && el !== reorderDrag.card);
    if (!target) return;

    const targetRect = target.getBoundingClientRect();
    const isAfter = e.clientY > targetRect.top + targetRect.height / 2;
    if (isAfter) {
      target.after(reorderDrag.placeholder);
    } else {
      target.before(reorderDrag.placeholder);
    }
  });

  const endDrag = (e) => {
    if (!reorderDrag || e.pointerId !== reorderDrag.pointerId) return;
    const { card, placeholder } = reorderDrag;

    // Commit: move the card to the placeholder's position, then discard
    // the placeholder and reset the card's temporary drag styles.
    placeholder.replaceWith(card);
    card.classList.remove("dragging");
    card.style.position = "";
    card.style.top = "";
    card.style.left = "";
    card.style.width = "";
    card.style.zIndex = "";
    card.style.pointerEvents = "";

    reorderDrag = null;
    commitReorderFromDom();
  };

  container.addEventListener("pointerup", endDrag);
  container.addEventListener("pointercancel", endDrag);
}

/** After a drag settles, read the new DOM order back into quizData.questions
 * (single source of truth), snapshot for undo, renumber, and autosave —
 * mirrors what moveQuestion() does for the button-based reorder path. */
function commitReorderFromDom() {
  const container = document.getElementById("questionsContainer");
  if (!container) return;

  const domIds = Array.from(container.querySelectorAll(".question-card")).map(
    (card) => Number(card.dataset.questionId),
  );

  const currentIds = quizData.questions.map((q) => q.id);
  const unchanged =
    domIds.length === currentIds.length &&
    domIds.every((id, i) => id === currentIds[i]);
  if (unchanged) return;

  pushHistorySnapshot();
  const byId = new Map(quizData.questions.map((q) => [q.id, q]));
  quizData.questions = domIds.map((id) => byId.get(id)).filter(Boolean);

  updateQuestionNumbers();
  autosave();
}

// ============================================================================
// OPTIONS MANAGEMENT
// ============================================================================

/**
 * Normalize a question's `correct` field to always be an array of indices.
 * Older/imported data may still use a single number — this coerces it in
 * place so every render/export path can assume an array.
 */
function normalizeCorrectField(question) {
  if (!question) return;
  if (Array.isArray(question.correct)) return;
  if (typeof question.correct === "number" && !Number.isNaN(question.correct)) {
    question.correct = [question.correct];
  } else {
    question.correct = [];
  }
}

function renderOptions(question) {
  if (question.answer) {
    const optId = `option-text-${question.id}-0`;
    return `
      <div class="essay-answer-container" id="option-${question.id}-0">
        <div class="essay-answer-label">
          <span class="essay-badge">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>
            سؤال مقالي
          </span>
          نموذج الإجابة ${question.options?.[0]?.trim()
        ? `<span class="essay-answer-note">(يُستخدم لتصحيح إجابات الطلاب تلقائيًا وتقييمها من 5)</span>`
        : `<span class="essay-answer-missing">(مطلوب — بدونه لن يمكن تصحيح إجابات الطلاب تلقائيًا)</span>`
      }
        </div>
        <div class="essay-answer-editor">
          ${mdEditorHtml(optId, question.options[0], "اكتب نموذج إجابة هنا...", 5)}
        </div>
      </div>
    `;
  }

  normalizeCorrectField(question);

  // ── MCQ / True-False — checkboxes so more than one option can be correct ──
  return question.options
    .map((option, index) => {
      const optId = `option-text-${question.id}-${index}`;
      const isCorrect = question.correct.includes(index);
      return `
        <div class="option-item ${isCorrect ? "correct" : ""}" id="option-${question.id}-${index}">
            <input 
                type="checkbox" 
                class="option-checkbox"
                ${isCorrect ? "checked" : ""}
                onchange="toggleCorrectAnswer(${question.id}, ${index})"
                title="تحديد كإجابة صحيحة"
                aria-label="تحديد الخيار ${index + 1} كإجابة صحيحة"
            />
            <div class="option-md-wrap">
                ${mdEditorHtml(optId, option, `إختيار ${index + 1}`, 1)}
            </div>
            ${question.options.length > 2
          ? `<button class="option-delete" onclick="removeOption(${question.id}, ${index})" title="حذف الخيار" aria-label="حذف الخيار ${index + 1}"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>`
          : ""
        }
        </div>
      `;
    })
    .join("");
}

function setupOptionMdEditors(questionId) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (!question) return;
  question.options.forEach((_, index) => {
    const optId = `option-text-${questionId}-${index}`;
    setupMdEditor(optId, (val) => {
      const q = quizData.questions.find((q) => q.id === questionId);
      if (q) {
        q.options[index] = val;
        autosave();
      }
    });
  });
}

window.updateOption = function (questionId, optionIndex, value) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (question) {
    question.options[optionIndex] = value;
    autosave();
  }
};

/** Toggle whether an option is one of the correct answers (multi-select) */
window.toggleCorrectAnswer = function (questionId, optionIndex) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (question) {
    pushHistorySnapshot();
    normalizeCorrectField(question);
    const pos = question.correct.indexOf(optionIndex);
    if (pos === -1) {
      question.correct.push(optionIndex);
    } else {
      question.correct.splice(pos, 1);
    }
    question.correct.sort((a, b) => a - b);
    rerenderOptions(questionId);
    updateIncompleteState(questionId);
    autosave();
  }
};

function rerenderOptions(questionId) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (!question) return;

  const container = document.getElementById(`options-container-${questionId}`);
  if (container) {
    container.innerHTML = renderOptions(question);
    setupOptionMdEditors(questionId);
  }

  // ── Keep card class, label, and button in sync with question type ──────────
  // Truthy check (not `=== 1`) to match renderQuestion()/renderOptions()/
  // updateIncompleteState() — `answer` is a non-empty string for essay
  // questions, so the old strict-equality check here always evaluated to
  // false. That silently mis-rendered the "add option"/"convert" button for
  // *every* essay question the moment anything triggered a rerenderOptions
  // (toggling a correct answer, removing an option, etc.) — swapping in
  // "إضافة خيار" (which calls addOption -> options.push("")) instead of the
  // essay's actual "تحويل إلى اختيار متعدد" button, corrupting the
  // single-slot essay `options` array instead of doing anything visible as
  // "add a question".
  const isEssay = Boolean(question.answer);
  const card = document.getElementById(`question-${questionId}`);
  if (card) {
    card.classList.toggle("question-card--essay", isEssay);
  }

  const label = document.querySelector(
    `#question-${questionId} .options-label`,
  );
  if (label) {
    label.textContent = isEssay
      ? "الإجابة المرجعية"
      : "الإختيارات";
  }

  const btnDiv = document.getElementById(`option-btn-${questionId}`);
  if (btnDiv) {
    if (isEssay) {
      btnDiv.innerHTML = `<button class="add-option-btn add-option-btn--convert" onclick="convertEssayToMcq(${questionId})">
        <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> تحويل إلى اختيار متعدد
      </button>`;
    } else {
      btnDiv.innerHTML = `<button class="add-option-btn" onclick="addOption(${questionId})">
        <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> إضافة خيار
      </button>
      <button class="add-option-btn add-option-btn--convert" onclick="convertMcqToEssay(${questionId})">
        <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg> تحويل إلى سؤال مقالي
      </button>`;
    }
  }
}

window.addOption = function (questionId) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (question) {
    pushHistorySnapshot();
    question.options.push("");
    rerenderOptions(questionId);
    updateStatistics();
    autosave();
  }
};

window.removeOption = function (questionId, optionIndex) {
  const question = quizData.questions.find((q) => q.id === questionId);
  // MCQs must keep at least 2 options — only remove when there are more
  // than 2 to begin with, so the last removal always leaves exactly 2.
  if (question && question.options.length > 2) {
    pushHistorySnapshot();
    normalizeCorrectField(question);
    question.options.splice(optionIndex, 1);
    // Drop the removed index from `correct` and shift indices above it down.
    question.correct = question.correct
      .filter((i) => i !== optionIndex)
      .map((i) => (i > optionIndex ? i - 1 : i));
    rerenderOptions(questionId);
    updateStatistics();
    updateIncompleteState(questionId);
    autosave();
  }
};

/** Convert a single-option (essay) question into a 4-option MCQ */
window.convertEssayToMcq = function (questionId) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (!question) return;
  pushHistorySnapshot();
  // Keep the model-answer text as the first option
  while (question.options.length < 4) question.options.push("");
  question.correct = [0];
  // Clear the essay marker/text — every isEssay check in this file is a
  // truthy test on `answer`, so leaving it set (even to the old essay
  // answer text) would keep this question rendering as an essay question
  // everywhere except the one button this function itself just redrew,
  // reverting back to the essay UI the next time the card re-renders
  // (e.g. reopening the page, or any other rerenderOptions call).
  question.answer = "";
  rerenderOptions(questionId);
  updateStatistics();
  updateIncompleteState(questionId);
  autosave();
  showNotification("تم التحويل", "تم تحويل السؤال إلى اختيار متعدد", "success");
};

/**
 * Convert a multiple-choice/true-false question into a single-option essay
 * question. The counterpart to convertEssayToMcq above — previously
 * missing entirely, which is why there was no way to go MCQ → Essay in the
 * editor (only the reverse direction had a button).
 *
 * Destructive to the existing options list (a 4-option MCQ can't keep all
 * 4 texts once collapsed to a single essay-answer slot), so this asks for
 * confirmation first via the app's own _confirm() dialog — consistent with
 * removeQuestion's use of the same helper elsewhere in this file — rather
 * than silently discarding the user's option text.
 */
window.convertMcqToEssay = async function (questionId) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (!question) return;

  if (!(await _confirm(
    "تحويل هذا السؤال إلى سؤال مقالي سيحذف كل الخيارات الحالية باستثناء نص أول خيار (سيُستخدم كبداية لنموذج الإجابة). هل تريد المتابعة؟",
  ))) {
    return;
  }

  pushHistorySnapshot();
  // Keep the first option's text as a starting draft for the model answer
  // rather than discarding it outright — the user may already have typed
  // the correct answer's wording into option 1.
  const draftAnswer = question.options?.[0] || "";
  question.options = [draftAnswer];
  question.answer = draftAnswer || ESSAY_MARKER;
  question.correct = [];

  rerenderOptions(questionId);
  updateStatistics();
  updateIncompleteState(questionId);
  autosave();
  showNotification("تم التحويل", "تم تحويل السؤال إلى سؤال مقالي", "success");
};

/** Recompute the "incomplete" badge on a card (e.g. after toggling correct answers) */
function updateIncompleteState(questionId) {
  const question = quizData.questions.find((q) => q.id === questionId);
  const card = document.getElementById(`question-${questionId}`);
  if (!question || !card) return;

  const isIncomplete =
    !question.q ||
    question.q.trim() === "" ||
    question.options.some((opt) => !opt || opt.trim() === "") ||
    (!question.answer &&
      (!Array.isArray(question.correct) || question.correct.length === 0));

  card.classList.toggle("incomplete", isIncomplete);
}

// ============================================================================
// COLLAPSIBLE SECTIONS
// ============================================================================

// ============================================================================
// SEARCH AND FILTER - ENHANCED
// ============================================================================

function handleSearch(e) {
  const searchTerm = e.target.value.toLowerCase();
  const questionCards = document.querySelectorAll(".question-card");
  const clearBtn = document.getElementById("clearSearch");

  if (clearBtn) {
    clearBtn.style.display = searchTerm ? "flex" : "none";
  }

  let visibleCount = 0;
  questionCards.forEach((card) => {
    // Read from the md-source textarea (the raw text field)
    const sourceTextarea = card.querySelector(".md-source");
    const questionText = (
      sourceTextarea ? sourceTextarea.value : ""
    ).toLowerCase();
    const matches = questionText.includes(searchTerm);
    card.style.display = matches ? "block" : "none";
    if (matches) visibleCount++;
  });

  if (visibleCount === 0 && searchTerm) {
    showNotification(
      "لا توجد نتائج",
      `لم يتم العثور على أسئلة تحتوي على "${searchTerm}"`,
      "info",
    );
  }
}

window.clearSearch = function () {
  const searchInput = document.getElementById("questionSearch");
  const clearBtn = document.getElementById("clearSearch");

  if (searchInput) {
    searchInput.value = "";
    clearBtn.style.display = "none";

    // Show all questions
    document.querySelectorAll(".question-card").forEach((card) => {
      card.style.display = "block";
    });
  }
};

window.toggleExpand = function () {
  const cards = document.querySelectorAll(".question-card");
  if (cards.length === 0) return;

  const allCollapsed = Array.from(cards).every((card) =>
    card.classList.contains("collapsed"),
  );

  if (allCollapsed) {
    window.expandAll();
  } else {
    window.collapseAll();
  }
};

window.expandAll = function () {
  document.querySelectorAll(".question-card.collapsed").forEach((card) => {
    const id = parseInt(card.dataset.questionId);
    if (!Number.isNaN(id)) {
      window.toggleQuestionCollapse(id);
    }
  });
};

window.collapseAll = function () {
  document.querySelectorAll(".question-card").forEach((card) => {
    if (!card.classList.contains("collapsed")) {
      const id = parseInt(card.dataset.questionId);
      if (!Number.isNaN(id)) {
        window.toggleQuestionCollapse(id);
      }
    }
  });
};

// ============================================================================
// BULK MODE
// ============================================================================

window.toggleBulkMode = function () {
  bulkModeActive = !bulkModeActive;
  const bulkActionsBar = document.getElementById("bulkActionsBar");
  const bulkBtn = document.getElementById("bulkModeBtn");

  // Mutually exclusive with reorder mode — see the matching check in
  // toggleReorderMode() for why (both repurpose the question header).
  if (bulkModeActive && reorderModeActive) {
    window.toggleReorderMode();
  }

  if (bulkModeActive) {
    bulkActionsBar.style.display = "flex";
    bulkBtn.style.background = "var(--color-primary)";
    bulkBtn.style.color = "white";

    // Add checkboxes to all questions
    document.querySelectorAll(".question-card").forEach((card) => {
      if (!card.querySelector(".question-select-checkbox")) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "question-select-checkbox";
        checkbox.onclick = (e) => e.stopPropagation();
        checkbox.onchange = (e) =>
          handleQuestionSelect(e, parseInt(card.dataset.questionId));

        const numberSpan = card.querySelector(".question-number");
        numberSpan.insertBefore(checkbox, numberSpan.firstChild);
      }
    });
  } else {
    bulkActionsBar.style.display = "none";
    bulkBtn.style.background = "";
    bulkBtn.style.color = "";
    selectedQuestions.clear();

    // Remove checkboxes
    document
      .querySelectorAll(".question-select-checkbox")
      .forEach((cb) => cb.remove());
    document.querySelectorAll(".question-card").forEach((card) => {
      card.classList.remove("selected");
    });
    updateSelectedCount();
  }
};

window.handleQuestionSelect = function (e, questionId) {
  const card = document.getElementById(`question-${questionId}`);

  if (e.target.checked) {
    selectedQuestions.add(questionId);
    card.classList.add("selected");
  } else {
    selectedQuestions.delete(questionId);
    card.classList.remove("selected");
  }

  updateSelectedCount();
};

function updateSelectedCount() {
  const countSpan = document.getElementById("selectedCount");
  if (countSpan) {
    countSpan.textContent = selectedQuestions.size;
  }
}

window.selectAllQuestions = function () {
  document.querySelectorAll(".question-select-checkbox").forEach((cb) => {
    cb.checked = true;
    const card = cb.closest(".question-card");
    if (card) {
      const questionId = parseInt(card.dataset.questionId);
      selectedQuestions.add(questionId);
      card.classList.add("selected");
    }
  });
  updateSelectedCount();
  showNotification(
    "تم التحديد",
    `تم تحديد ${selectedQuestions.size} سؤال`,
    "info",
  );
};

window.deselectAllQuestions = function () {
  document.querySelectorAll(".question-select-checkbox").forEach((cb) => {
    cb.checked = false;
  });
  document.querySelectorAll(".question-card").forEach((card) => {
    card.classList.remove("selected");
  });
  selectedQuestions.clear();
  updateSelectedCount();
};

window.deleteSelectedQuestions = async function () {
  if (selectedQuestions.size === 0) {
    showNotification("تنبيه", "لم يتم تحديد أي أسئلة", "error");
    return;
  }

  if (
    !(await _confirm(`هل أنت متأكد من حذف ${selectedQuestions.size} سؤال؟`))
  ) {
    return;
  }

  pushHistorySnapshot();
  const idsToDelete = Array.from(selectedQuestions);

  idsToDelete.forEach((id) => {
    const index = quizData.questions.findIndex((q) => q.id === id);
    if (index !== -1) {
      quizData.questions.splice(index, 1);
    }

    const card = document.getElementById(`question-${id}`);
    if (card) {
      card.remove();
    }
  });

  selectedQuestions.clear();
  updateQuestionNumbers();
  updateEmptyState();
  updateProgress();
  updateStatistics();
  updateSelectedCount();
  autosave();

  showNotification("تم الحذف", `تم حذف ${idsToDelete.length} سؤال`, "success");
};

/** Duplicate every currently-selected question, inserting each copy
 * directly after its original — same per-question behavior as
 * duplicateQuestion(), just applied to the whole selection at once. */
window.duplicateSelectedQuestions = function () {
  if (selectedQuestions.size === 0) {
    showNotification("تنبيه", "لم يتم تحديد أي أسئلة", "error");
    return;
  }

  pushHistorySnapshot();

  // Snapshot the ids in on-page order (not Set insertion order) so
  // duplicates land in a predictable top-to-bottom sequence even if the
  // user selected questions out of order.
  const idsToDuplicate = quizData.questions
    .map((q) => q.id)
    .filter((id) => selectedQuestions.has(id));

  let duplicatedCount = 0;
  idsToDuplicate.forEach((id) => {
    const index = quizData.questions.findIndex((q) => q.id === id);
    if (index === -1) return;
    const original = quizData.questions[index];
    const newId = ++questionIdCounter;
    const copy = { ...original, id: newId };
    quizData.questions.splice(index + 1, 0, copy);
    renderQuestion(copy, index + 1);
    duplicatedCount++;
  });

  updateQuestionNumbers();
  updateEmptyState();
  updateProgress();
  updateStatistics();
  autosave();

  showNotification(
    "تم النسخ",
    `تم نسخ ${duplicatedCount} سؤال`,
    "success",
  );
};

// ============================================================================
// VALIDATION
// ============================================================================

function validateQuiz() {
  const errors = [];

  if (!quizData.title || quizData.title.trim() === "") {
    errors.push("عنوان الامتحان مطلوب");
  }

  if (quizData.questions.length === 0) {
    errors.push("يجب إضافة سؤال واحد على الأقل");
  }

  quizData.questions.forEach((q, index) => {
    const questionNum = index + 1;

    if (!q.q || q.q.trim() === "") {
      errors.push(`السؤال ${questionNum}: نص السؤال مطلوب`);
    }

    if (q.options.length > 1) {
      const emptyOptions = q.options.filter((opt) => !opt || opt.trim() === "");
      if (emptyOptions.length > 0) {
        errors.push(`السؤال ${questionNum}: جميع الخيارات يجب أن تحتوي على نص`);
      }

      if (!Array.isArray(q.correct) || q.correct.length === 0) {
        errors.push(
          `السؤال ${questionNum}: يجب تحديد إجابة صحيحة واحدة على الأقل`,
        );
      }
    }

    if (q.image && q.image.trim()) {
      try {
        new URL(q.image);
      } catch {
        errors.push(`السؤال ${questionNum}: رابط الصورة غير صحيح`);
      }
    }
  });

  return errors;
}

// ============================================================================
// EMPTY STATE
// ============================================================================

function updateEmptyState() {
  const emptyState = document.getElementById("emptyState");
  const questionControls = document.getElementById("questionControls");
  const addQuestionBottom = document.getElementById("addQuestionBottom");
  const questionBadge = document.getElementById("questionBadge");

  if (quizData.questions.length === 0) {
    emptyState.classList.remove("hidden");
    if (questionControls) questionControls.style.display = "none";
    if (addQuestionBottom) addQuestionBottom.style.display = "none";
  } else {
    emptyState.classList.add("hidden");
    if (questionControls) questionControls.style.display = "block";
    if (addQuestionBottom) addQuestionBottom.style.display = "flex";
  }

  if (questionBadge) {
    questionBadge.textContent = quizData.questions.length;
  }
}

// ============================================================================
// TEMPLATES SYSTEM
// ============================================================================

window.toggleTemplates = function () {
  const panel = document.getElementById("templatesPanel");
  isTemplatesPanelOpen = !isTemplatesPanelOpen;

  if (isTemplatesPanelOpen) {
    panel.style.display = "block";
  } else {
    panel.style.display = "none";
  }
};

window.addQuestionFromTemplate = function (templateType) {
  const templates = {
    mcq: {
      q: "",
      options: ["", "", "", ""],
      correct: [0],
      image: "",
      audio: "",
      video: "",
      explanation: "",
    },
    truefalse: {
      q: "",
      options: ["True", "False"],
      correct: [0],
      image: "",
      audio: "",
      video: "",
      explanation: "",
    },
    essay: {
      q: "",
      // Every isEssay check in this file (renderQuestion, renderOptions,
      // rerenderOptions, updateIncompleteState) branches on `answer` being
      // *truthy* — this template previously omitted the field entirely, so
      // picking "essay" from the templates panel silently produced a
      // single-empty-option MCQ instead of an essay question. `options[0]`
      // (not this field) is what the essay-answer editor actually reads
      // and writes as the user types, so this is only an internal marker
      // — it must stay non-empty (unlike options[0], which starts blank)
      // purely so the truthy checks correctly identify this as an essay
      // question from the moment it's created.
      answer: ESSAY_MARKER,
      options: [""],
      correct: [],
      image: "",
      audio: "",
      video: "",
      explanation: "",
    },
  };

  const template = templates[templateType];
  if (!template) return;

  pushHistorySnapshot();
  const questionId = ++questionIdCounter;
  const question = {
    id: questionId,
    ...template,
  };

  quizData.questions.push(question);
  renderQuestion(question);
  updateEmptyState();
  updateProgress();
  updateStatistics();
  autosave();

  // Close templates panel after selection
  toggleTemplates();

  setTimeout(() => {
    const questionCard = document.getElementById(`question-${questionId}`);
    if (questionCard) {
      questionCard.scrollIntoView({ behavior: "smooth", block: "center" });

      // Image section is always visible now — focus it directly for image
      // templates, otherwise focus the question text field.
      if (templateType === "image") {
        const imageInput = document.getElementById(
          `question-image-${questionId}`,
        );
        if (imageInput) {
          imageInput.focus();
        } else {
          activateMdEditor(`question-text-${questionId}`);
        }
      } else {
        activateMdEditor(`question-text-${questionId}`);
      }
    }
  }, 100);

  showNotification(
    "تم الإضافة!",
    `تم إضافة سؤال من قالب ${getTemplateName(templateType)}`,
    "success",
  );
};

function getTemplateName(type) {
  const names = {
    mcq: "اختيار متعدد",
    truefalse: "صح أم خطأ",
    essay: "مقالي",
    image: "مع صورة",
  };
  return names[type] || "افتراضي";
}

// ============================================================================
// AUTOSAVE
// ============================================================================

function autosave() {
  clearTimeout(autosaveTimeout);

  updateAutosaveIndicator("saving");

  autosaveTimeout = setTimeout(() => {
    try {
      // If we have a currentDraftId, upsert into user_quizzes as a draft entry.
      // If editing a published quiz (?edit=<id>), fall back to the old single-key
      // quiz_draft behaviour so the editor's state is preserved across refreshes.
      if (currentDraftId) {
        const quizzes = _readUserQuizzes();
        const idx = quizzes.findIndex((q) => q.id === currentDraftId);
        const entry = {
          id: currentDraftId,
          meta: {
            type: "draft",
            title: quizData.title?.trim() || "",
            description: quizData.description?.trim() || "",
            source: quizData.source?.trim() || "",
            updatedAt: new Date().toISOString(),
          },
          questions: quizData.questions,
        };
        if (idx >= 0) {
          quizzes[idx] = entry;
        } else {
          quizzes.push(entry);
        }
        _writeUserQuizzes(quizzes);
      } else {
        // Editing a published quiz — keep a local recovery copy under quiz_draft
        const dataToSave = {
          title: quizData.title,
          description: quizData.description,
          source: quizData.source,
          questions: quizData.questions,
          lastModified: new Date().toISOString(),
        };
        localStorage.setItem("quiz_draft", JSON.stringify(dataToSave));
      }
      updateAutosaveIndicator("saved");
    } catch (error) {
      console.error("Autosave error:", error);
      updateAutosaveIndicator("error");
    }
  }, 1000);
}

function updateAutosaveIndicator(status) {
  const indicator = document.getElementById("autosaveIndicator");
  if (!indicator) return;

  indicator.classList.remove("saving", "error");

  if (status === "saving") {
    indicator.classList.add("saving");
    indicator.querySelector(".save-text").textContent = "يُحفظ..";
  } else if (status === "saved") {
    indicator.querySelector(".save-text").textContent = "محفوظ";
  } else if (status === "error") {
    indicator.classList.add("error");
    indicator.querySelector(".save-text").textContent = "خطأ في الحفظ";
  }
}

/**
 * Convert a question from the saved (exported) format back to the editor's
 * internal format.  Essay questions are stored as { q, answer } in
 * user_quizzes but the editor always uses { q, options: [answer] }.
 */
function normalizeQuestionForEditor(q) {
  if (!Array.isArray(q.options)) {
    // Essay: answer field present, no options array. `answer` here becomes
    // the editor's isEssay marker (see ESSAY_MARKER) — it must stay
    // non-empty even when the real answer text (q.answer) is blank, since
    // every isEssay check in this file is a truthy test on `answer`, not a
    // check for the field's mere presence.
    return {
      ...q,
      answer: q.answer || ESSAY_MARKER,
      options: [q.answer ?? ""],
      correct: [],
    };
  }
  // Ensure options is never empty
  if (q.options.length === 0) {
    return { ...q, options: [""], correct: [] };
  }
  // MCQ/True-False question with a real options array. Every isEssay check
  // in this file (renderQuestion, rerenderOptions, updateIncompleteState,
  // etc.) is a plain truthy test on `question.answer` — it assumes `answer`
  // is only ever present on essay questions. The AI tool schema documents
  // that contract too (_tools.js: "Omit `correct` (and `options`) entirely
  // for essay/free-text questions and use `answer` instead"), but models
  // don't always honor it — some providers still tack on a redundant
  // `answer` field to an MCQ question (e.g. restating "the answer is B").
  // Left in place, that stray field flips every isEssay check to true and
  // the question silently loses its options/correct entirely. Since
  // `options` is the authoritative signal for "this is MCQ" here, drop any
  // `answer` field whenever real options are present, so the rest of the
  // editor sees an unambiguous MCQ/TF question.
  const { answer, ...withoutAnswer } = q;
  q = withoutAnswer;
  // Normalize a legacy single-index `correct` (old saved quizzes) into an
  // array so every render/export path downstream can assume an array.
  if (!Array.isArray(q.correct)) {
    return {
      ...q,
      correct:
        typeof q.correct === "number" && !Number.isNaN(q.correct)
          ? [q.correct]
          : [],
    };
  }
  return q;
}

// Ensure all loaded questions have stable numeric IDs before rendering
function normalizeQuestionsWithIds(questions) {
  let maxId = 0;
  const normalized = questions.map((q) => {
    let idNum = Number(q.id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      idNum = maxId + 1;
    }
    if (idNum > maxId) {
      maxId = idNum;
    }
    return normalizeQuestionForEditor({
      ...q,
      id: idNum,
    });
  });

  // Fallback for legacy data with no IDs at all
  if (maxId === 0 && normalized.length > 0) {
    normalized.forEach((q, index) => {
      q.id = index + 1;
    });
    maxId = normalized.length;
  }

  return { questions: normalized, maxId };
}

function loadDraftFromLocalStorage() {
  try {
    const saved = localStorage.getItem("quiz_draft");
    if (saved) {
      const data = JSON.parse(saved);

      // Support both old flat schema and new (meta.title)
      const title = data.meta?.title || data.title;
      const description = data.meta?.description || data.description;
      const source = data.meta?.source || data.source || "";

      if (title) {
        quizData.title = title;
        document.getElementById("quizTitle").value = title;
        updateCharCount("titleCharCount", title.length, 100);
      }

      if (description) {
        quizData.description = description;
        const descEl = document.getElementById("quizDescription");
        descEl.value = description;
        updateCharCount("descCharCount", description.length, 500);
        autoResizeMdSource(descEl);
      }

      if (source) {
        quizData.source = source;
        const srcEl = document.getElementById("quizSource");
        if (srcEl) srcEl.value = source;
      }

      // Restore Phase 2 fields
      if (data.meta) {
        if (data.meta.password) {
          const passEl = document.getElementById("quizPassword");
          if (passEl) passEl.value = data.meta.password;
        }

        const viewValue =
          data.meta.view && data.meta.view !== "empty"
            ? data.meta.view
            : "empty";
        const viewRadio = document.querySelector(
          `input[name="quizView"][value="${viewValue}"]`,
        );
        if (viewRadio) {
          viewRadio.checked = true;
          if (typeof updateOptionCards === "function")
            updateOptionCards(viewRadio);
        }

        const modeValue =
          data.meta.mode && data.meta.mode !== "empty"
            ? data.meta.mode
            : "empty";
        const modeRadio = document.querySelector(
          `input[name="quizMode"][value="${modeValue}"]`,
        );
        if (modeRadio) {
          modeRadio.checked = true;
          if (typeof updateOptionCards === "function")
            updateOptionCards(modeRadio);
        }
      }

      if (data.questions && data.questions.length > 0) {
        const { questions, maxId } = normalizeQuestionsWithIds(data.questions);
        quizData.questions = questions;
        questionIdCounter = maxId;

        const container = document.getElementById("questionsContainer");
        container.innerHTML = "";

        questions.forEach((question) => {
          renderQuestion(question);
        });

        updateEmptyState();
        updateProgress();
        updateStatistics();
        showNotification("تم التحميل", "تم تحميل المسودة المحفوظة", "success");
      }
      // Sync the app-bar title now that quizData.title is populated
      updateAppTitleBar();
    }
    // Loading a draft replaces quizData wholesale — old undo/redo snapshots
    // (if any existed at this point) would no longer point back to anything
    // related to what's now on screen.
    resetHistory();
  } catch (error) {
    console.error("Error loading from localStorage:", error);
  }
}

function loadQuizFromLocalStorage(quizId) {
  try {
    const userQuizzes = JSON.parse(
      localStorage.getItem("user_quizzes") || "[]",
    );
    const quiz = userQuizzes.find((q) => q.id === quizId);

    if (quiz) {
      const headerTitle = document.querySelector(".header h1");
      if (headerTitle) headerTitle.textContent = "تعديل الامتحان";
      document.title = "تعديل الامتحان - منصة بصمجي";

      // Support both old flat schema and new (meta.title)
      quizData.title = quiz.meta?.title || quiz.title || "";
      const qTitleEl = document.getElementById("quizTitle");
      if (qTitleEl) {
        qTitleEl.value = quizData.title;
        updateCharCount("titleCharCount", quizData.title.length, 100);
      }

      quizData.description = quiz.meta?.description || quiz.description || "";
      const quizDescEl = document.getElementById("quizDescription");
      quizDescEl.value = quizData.description;
      updateCharCount("descCharCount", quizData.description.length, 500);
      autoResizeMdSource(quizDescEl);

      quizData.source = quiz.meta?.source || quiz.source || "";
      document.getElementById("quizSource").value = quizData.source;
      updateCharCount("sourceCharCount", quizData.source.length, 500);

      // Restore Phase 2 fields
      if (quiz.meta) {
        // Restore password
        if (quiz.meta.password) {
          const passEl = document.getElementById("quizPassword");
          if (passEl) passEl.value = quiz.meta.password;
        }

        const viewValue =
          quiz.meta.view && quiz.meta.view !== "empty"
            ? quiz.meta.view
            : "empty";
        const viewRadio = document.querySelector(
          `input[name="quizView"][value="${viewValue}"]`,
        );
        if (viewRadio) {
          viewRadio.checked = true;
          if (typeof updateOptionCards === "function")
            updateOptionCards(viewRadio);
        }

        const modeValue =
          quiz.meta.mode && quiz.meta.mode !== "empty"
            ? quiz.meta.mode
            : "empty";
        const modeRadio = document.querySelector(
          `input[name="quizMode"][value="${modeValue}"]`,
        );
        if (modeRadio) {
          modeRadio.checked = true;
          if (typeof updateOptionCards === "function")
            updateOptionCards(modeRadio);
        }
      }

      if (quiz.questions && quiz.questions.length > 0) {
        const { questions, maxId } = normalizeQuestionsWithIds(quiz.questions);
        quizData.questions = questions;
        questionIdCounter = maxId;
      }

      // Always clear and re-render everything
      const container = document.getElementById("questionsContainer");
      if (container) container.innerHTML = "";
      quizData.questions.forEach((question) => {
        renderQuestion(question);
      });

      showNotification("أهلاً بك", "تم تحميل الامتحان للتعديل", "success");
      // Sync the app-bar title now that quizData.title is populated
      updateAppTitleBar();
      // Questions were just rendered above — refresh the empty-state
      // visibility (it's shown by default / left over from an earlier,
      // still-empty call to finishFormInit()) along with progress/stats,
      // which also depend on quizData.questions now being populated.
      updateEmptyState();
      updateProgress();
      updateStatistics();
      // Freshly loaded quiz — nothing to undo back into yet.
      resetHistory();
    } else {
      showNotification("خطأ", "لم يتم العثور على الامتحان", "error");
      setTimeout(() => (window.location.href = "/"), 1500);
    }
  } catch (error) {
    console.error("Error loading quiz for edit:", error);
    showNotification("خطأ", "حدث خطأ أثناء تحميل الامتحان", "error");
  }
}

// ============================================================================
// SAVE TO USER QUIZZES
// ============================================================================

function buildQuizPayload(quizToSave, quizId, existingCreatedAt) {
  const questions = (quizToSave.questions || []).map((q) => {
    const out = { q: q.q };
    if (q.image?.trim()) out.image = q.image;
    if (q.audio?.trim()) out.audio = q.audio;
    if (q.video?.trim()) out.video = q.video;
    // Normalize essay: old 1-option → new answer field
    if (Array.isArray(q.options) && q.options.length === 1) {
      out.answer = q.options[0] ?? "";
    } else if (!Array.isArray(q.options) && q.answer !== undefined) {
      out.answer = q.answer;
    } else if (Array.isArray(q.options)) {
      out.options = q.options;
      if (q.correct !== undefined && q.correct !== null) {
        out.correct = Array.isArray(q.correct)
          ? q.correct
          : typeof q.correct === "number"
            ? [q.correct]
            : [];
      }
    }
    if (q.explanation?.trim()) out.explanation = q.explanation;
    return out;
  });

  const types = new Set();
  questions.forEach((q) => {
    if (!Array.isArray(q.options) || q.options.length === 0) types.add("Essay");
    else if (q.options.length === 2) types.add("True/False");
    else types.add("MCQ");
  });

  const meta = {
    title: quizToSave.title?.trim() || "Untitled",
    createdAt: existingCreatedAt || new Date().toLocaleString("en-US"),
    // ISO timestamp, distinct from the legacy locale-string createdAt above
    // (which other pages parse/display and I don't want to risk changing).
    // Used only by the entry screen's "recent items" sort/relative-date label.
    updatedAt: new Date().toISOString(),
  };
  if (quizToSave.description?.trim())
    meta.description = quizToSave.description.trim();
  if (quizToSave.source?.trim()) meta.source = quizToSave.source.trim();

  // Read Phase 2 fields
  const pwd = document.getElementById("quizPassword")?.value?.trim();
  if (pwd) {
    meta.password = pwd;
  } else {
    delete meta.password;
  }
  delete meta.privacy;
  delete meta.lang;
  const viewVal = document.querySelector(
    'input[name="quizView"]:checked',
  )?.value;
  if (viewVal && viewVal !== "empty") meta.view = viewVal;

  const modeVal = document.querySelector(
    'input[name="quizMode"]:checked',
  )?.value;
  if (modeVal && modeVal !== "empty") meta.mode = modeVal;

  return {
    meta,
    stats: {
      questionCount: questions.length,
      questionTypes: Array.from(types).sort(),
    },
    questions,
  };
}

function saveToUserQuizzes(quizToSave) {
  try {
    const existingQuizzes = JSON.parse(
      localStorage.getItem("user_quizzes") || "[]",
    );
    const quizId = `user_quiz_${Date.now()}`;
    const newQuiz = { id: quizId, ...buildQuizPayload(quizToSave, quizId) };
    existingQuizzes.push(newQuiz);
    localStorage.setItem("user_quizzes", JSON.stringify(existingQuizzes));
    return quizId;
  } catch (error) {
    console.error("Error saving quiz:", error);
    return null;
  }
}

function updateInUserQuizzes(quizId, quizToSave) {
  try {
    const existingQuizzes = JSON.parse(
      localStorage.getItem("user_quizzes") || "[]",
    );
    const quizIndex = existingQuizzes.findIndex((q) => q.id === quizId);
    if (quizIndex === -1) return null;
    const existing = existingQuizzes[quizIndex];
    const payload = buildQuizPayload(
      quizToSave,
      quizId,
      existing.meta?.createdAt || existing.createdAt,
    );
    existingQuizzes[quizIndex] = { ...existing, ...payload, id: quizId };
    localStorage.setItem("user_quizzes", JSON.stringify(existingQuizzes));
    return quizId;
  } catch (error) {
    console.error("Error updating quiz:", error);
    return null;
  }
}

// ============================================================================
// EXPORT QUIZ
// ============================================================================

window.exportQuiz = function () {
  const errors = validateQuiz();
  if (errors.length > 0) {
    showNotification(
      "خطأ في التحقق",
      "الرجاء إصلاح الأخطاء التالية:\n\n" + errors.join("\n"),
      "error",
    );
    return;
  }

  const config = {
    title: quizData.title,
    description: quizData.description,
    source: quizData.source,
  };
  const exportQuestions = quizData.questions.map((q) => {
    const out = { q: q.q };
    if (q.image?.trim()) out.image = q.image;
    if (q.audio?.trim()) out.audio = q.audio;
    if (q.video?.trim()) out.video = q.video;
    // Essay question: has 1 option (legacy) or has `answer` field → export as { q, answer }
    if (Array.isArray(q.options) && q.options.length === 1) {
      out.answer = q.options[0] || "";
    } else if (!Array.isArray(q.options) || q.options.length === 0) {
      out.answer = q.answer || "";
    } else {
      out.options = q.options;
      if (q.correct !== undefined && q.correct !== null) {
        out.correct = Array.isArray(q.correct)
          ? q.correct
          : typeof q.correct === "number"
            ? [q.correct]
            : [];
      }
    }
    if (q.explanation?.trim()) out.explanation = q.explanation;
    return out;
  });

  // Builds the JSON export meta (password/view/mode) from the current form
  // state. Shared by the download and copy paths so both stay in sync.
  const buildJsonExportMeta = () => {
    const exportMeta = {
      title: quizData.title,
      description: quizData.description,
      source: quizData.source,
    };

    const pwd = document.getElementById("quizPassword")?.value?.trim();
    if (pwd) {
      exportMeta.password = pwd;
    } else {
      delete exportMeta.password;
    }
    delete exportMeta.privacy;
    delete exportMeta.lang;

    const viewVal = document.querySelector(
      'input[name="quizView"]:checked',
    )?.value;
    if (viewVal && viewVal !== "empty") exportMeta.view = viewVal;
    const modeVal = document.querySelector(
      'input[name="quizMode"]:checked',
    )?.value;
    if (modeVal && modeVal !== "empty") exportMeta.mode = modeVal;

    return exportMeta;
  };

  const buildJsonPayloadString = async () => {
    const exportMeta = buildJsonExportMeta();
    const payload = await buildJsonQuizExport(
      exportMeta.title,
      exportMeta.description,
      exportMeta.source,
      exportQuestions,
    );
    Object.assign(payload.meta, exportMeta);
    return JSON.stringify(payload, null, 2);
  };

  const safeFilename = (quizData.title || "quiz")
    .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  // Shared modal (also used on the homepage's "My Quizzes" download popup —
  // see showDownloadModal() in
  // ../../components/download-quiz-modal/download-quiz-modal.js).
  // buildJsonPayloadString is passed through so the JSON export/copy still
  // carries the current password/view/mode form state.
  showDownloadModal({
    config,
    questions: exportQuestions,
    buildJsonPayloadString,
    filenameBase: safeFilename || "quiz",
  });
};

// ============================================================================
// SAVE LOCALLY
// ============================================================================

window.saveLocally = function () {
  const errors = validateQuiz();

  if (errors.length > 0) {
    showNotification(
      "خطأ في التحقق",
      "الرجاء إصلاح الأخطاء التالية:\n\n" + errors.join("\n"),
      "error",
    );
    return;
  }

  showLoading("يُحفظ..");

  setTimeout(() => {
    let quizId;
    if (editingQuizId) {
      quizId = updateInUserQuizzes(editingQuizId, quizData);
    } else {
      // New quiz (possibly from a draft) — save as a real published entry
      quizId = saveToUserQuizzes(quizData);
      // Promote: remove the draft entry that was tracking this work-in-progress
      if (currentDraftId) {
        const quizzes = _readUserQuizzes();
        _writeUserQuizzes(quizzes.filter((q) => q.id !== currentDraftId));
        currentDraftId = null;
      }
      editingQuizId = quizId;
    }
    hideLoading();

    if (quizId) {
      showNotification(
        "تم الحفظ!",
        'يمكنك العثور عليه في "امتحاناتك"',
        "success",
      );
      if (editingQuizId) {
        setTimeout(() => (window.location.href = "/"), 1000);
      }
    } else {
      showNotification("خطأ", "فشل حفظ الامتحان", "error");
    }
  }, 500);
};

// ============================================================================
// PREVIEW
// ============================================================================

/** Render one question's preview markup (question text, image, options with
 * the correct answer(s) marked, explanation). Shared by previewQuiz() (whole
 * quiz) and previewSingleQuestion() (one question from its ⋮ menu) so the
 * two stay visually identical. */
function renderQuestionPreviewHtml(q, index) {
  const isEssay = Boolean(q.answer);
  const correctSet = Array.isArray(q.correct)
    ? q.correct
    : typeof q.correct === "number"
      ? [q.correct]
      : [];

  const optionsHtml = isEssay
    ? `<div class="preview-essay-answer">${renderMarkdown(q.options?.[0] || "")}</div>`
    : `<ul class="preview-options">
          ${q.options
      .map(
        (opt, i) =>
          `<li class="${correctSet.includes(i) ? "correct" : ""}">${renderMarkdown(opt)}${correctSet.includes(i) ? " ✓" : ""}</li>`,
      )
      .join("")}
        </ul>`;

  return `
      <div class="preview-question">
        <h4>السؤال ${index + 1}: ${renderMarkdown(q.q)}</h4>
        ${q.image ? `<img src="${escapeHtml(q.image)}" class="preview-image" alt="صورة السؤال" onerror="this.style.display='none'">` : ""}
        ${optionsHtml}
        ${q.explanation ? `<div class="preview-explanation"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.125em;margin-left:4px"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> ${renderMarkdown(q.explanation)}</div>` : ""}
      </div>
    `;
}

/** Reset #previewTitle back to its default "معاينة الامتحان" wording/icon —
 * previewSingleQuestion() temporarily overrides it, so previewQuiz() (the
 * whole-quiz preview) needs to restore it on its own open, not just rely on
 * closePreview() to do it (the modal can be reopened without an intervening
 * close if the user re-triggers it from elsewhere). */
function resetPreviewModalTitle() {
  const titleEl = document.getElementById("previewTitle");
  if (!titleEl) return;
  titleEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide"
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                        stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye">
                        <path
                            d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                        <circle cx="12" cy="12" r="3" />
                    </svg> معاينة الامتحان`;
}

window.previewQuiz = function () {
  const errors = validateQuiz();

  if (errors.length > 0) {
    showNotification(
      "خطأ في التحقق",
      "الرجاء إصلاح الأخطاء التالية:\n\n" + errors.join("\n"),
      "error",
    );
    return;
  }

  const modal = document.getElementById("previewModal");
  const content = document.getElementById("previewContent");
  resetPreviewModalTitle();

  let html = `
    <div style="text-align: center; margin-bottom: 30px;">
      <h2 style="margin: 0 0 10px 0;">${escapeHtml(quizData.title)}</h2>
      ${quizData.description ? `<p style="color: var(--color-text-secondary); margin: 0;">${escapeHtml(quizData.description)}</p>` : ""}
    </div>
  `;

  quizData.questions.forEach((q, index) => {
    html += renderQuestionPreviewHtml(q, index);
  });

  content.innerHTML = html;
  modal.style.display = "flex";
  renderMathIn(content);
};

/** Preview a single question, opened from its ⋮ dropdown menu. Reuses the
 * same #previewModal as previewQuiz() (rather than a second modal) so
 * there's only one preview look-and-feel in the app, with the title
 * swapped to "معاينة السؤال" for the duration and restored by
 * closePreview()/the next previewQuiz() call. Skips validateQuiz() — that
 * check is about the whole quiz being publishable, not about whether this
 * one question can be rendered, so an unrelated incomplete question
 * elsewhere in the quiz shouldn't block previewing this one. */
window.previewSingleQuestion = function (questionId) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (!question) return;

  const index = quizData.questions.findIndex((q) => q.id === questionId);
  const modal = document.getElementById("previewModal");
  const content = document.getElementById("previewContent");
  const titleEl = document.getElementById("previewTitle");

  if (titleEl) {
    titleEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide"
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                        stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye">
                        <path
                            d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                        <circle cx="12" cy="12" r="3" />
                    </svg> معاينة السؤال ${index + 1}`;
  }

  content.innerHTML = renderQuestionPreviewHtml(question, index);
  modal.style.display = "flex";
  renderMathIn(content);
};

window.closePreview = function () {
  const modal = document.getElementById("previewModal");
  modal.style.display = "none";
  resetPreviewModalTitle();
};

window.updateShortcutsModal = function (show) {
  const modal = document.getElementById("shortcutsModal");
  if (!modal) return;
  modal.style.display = show ? "flex" : "none";
};

// ============================================================================
// PHASE 2: NEW UI HANDLERS
// ============================================================================

window.updateOptionCards = function (radioInput) {
  const name = radioInput.name;
  const cards = document.querySelectorAll(`input[name="${name}"]`);
  cards.forEach((card) => {
    const parent = card.closest(".option-card");
    if (parent) {
      if (card.checked) {
        parent.classList.add("selected");
      } else {
        parent.classList.remove("selected");
      }
    }
  });
};

// ============================================================================
// IMPORT QUESTIONS
// ============================================================================

window.importQuestions = function () {
  const modal = document.getElementById("importModal");
  modal.style.display = "flex";
  setupImportDropzone();
};

window.closeImportModal = function () {
  const modal = document.getElementById("importModal");
  modal.style.display = "none";
  document.getElementById("importTextarea").value = "";
  const fileInput = document.getElementById("importFileInput");
  if (fileInput) fileInput.value = "";
  const fileLabel = document.getElementById("importFileLabel");
  if (fileLabel) fileLabel.textContent = "لم يتم اختيار أي ملف";
};

function setupImportDropzone() {
  const dropzone = document.getElementById("importDropzone");
  if (!dropzone || dropzone.dataset.dropReady) return;
  dropzone.dataset.dropReady = "1";

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-active");
  });
  dropzone.addEventListener("dragleave", () =>
    dropzone.classList.remove("drag-active"),
  );
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-active");
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const fileInput = document.getElementById("importFileInput");
      // Can't set files directly, so read them here
      handleDroppedFiles(files);
    }
  });
}

function handleDroppedFiles(files) {
  const label = document.getElementById("importFileLabel");
  if (label) {
    label.textContent = Array.from(files)
      .map((f) => f.name)
      .join(", ");
  }
  // Store for processImport — use a module-level variable
  window._droppedImportFiles = files;
}

// ============================================================================
// SEARCH BAR TOGGLE
// ============================================================================

window.toggleSearchBar = function () {
  const searchBar = document.getElementById("searchBarCollapse");
  const toggleBtn = document.getElementById("searchToggleBtn");
  if (!searchBar) return;
  const isOpen = searchBar.style.display !== "none";
  searchBar.style.display = isOpen ? "none" : "block";
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-expanded", String(!isOpen));
    toggleBtn.classList.toggle("active", !isOpen);
  }
  if (!isOpen) {
    // focus the input when opening
    const input = document.getElementById("questionSearch");
    if (input) setTimeout(() => input.focus(), 50);
  } else {
    // clear search when closing
    clearSearch();
  }
};

window.processImport = async function () {
  const textarea = document.getElementById("importTextarea");
  const fileInput = document.getElementById("importFileInput");
  const content = textarea.value.trim();
  const files =
    window._droppedImportFiles ||
    (fileInput && fileInput.files.length > 0 ? fileInput.files : null);

  if (!content && (!files || files.length === 0)) {
    showNotification(
      "خطأ",
      "الرجاء إدخال محتوى أو اختيار ملف للاستيراد",
      "error",
    );
    return;
  }

  showLoading("جاري الاستيراد...");

  try {
    let allImportedQuestions = [];
    let savedQuizzesCount = 0;
    const multipleFiles = files && files.length > 1;

    // Process file uploads
    if (files && files.length > 0) {
      for (const file of files) {
        // Derive default title from filename
        const defaultTitle = file.name
          .replace(/\.json$/i, "")
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());

        let parsed;
        try {
          parsed = await processQuizJsonFile(file, defaultTitle);
        } catch (err) {
          console.warn(`Could not process ${file.name}:`, err);
          showNotification(
            "تحذير",
            `تعذّر قراءة ${file.name}: ${err.message}`,
            "error",
          );
          continue;
        }

        allImportedQuestions = allImportedQuestions.concat(parsed.questions);

        // Auto-save to library only when importing multiple files
        if (multipleFiles && parsed.meta) {
          const existingQuizzes = JSON.parse(
            localStorage.getItem("user_quizzes") || "[]",
          );
          const quizId = `user_quiz_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          existingQuizzes.push({
            id: quizId,
            title: parsed.meta.title || defaultTitle,
            description: parsed.meta.description || "",
            questions: parsed.questions,
            createdAt: new Date().toISOString(),
            author: "Imported",
          });
          localStorage.setItem("user_quizzes", JSON.stringify(existingQuizzes));
          savedQuizzesCount++;
        }

        // Apply title to current quiz if blank
        if (!quizData.title && parsed.meta) {
          quizData.title = parsed.meta.title || defaultTitle;
          quizData.description = parsed.meta.description || "";
          // FIX: read source FROM parsed.meta, not from stale quizData.source
          quizData.source = parsed.meta.source || "";
          const titleEl = document.getElementById("quizTitle");
          const descEl = document.getElementById("quizDescription");
          const sourceInput = document.getElementById("quizSource");
          if (titleEl) {
            titleEl.value = quizData.title;
            updateCharCount("titleCharCount", quizData.title.length, 100);
          }
          if (descEl) {
            descEl.value = quizData.description;
            updateCharCount("descCharCount", quizData.description.length, 500);
            autoResizeMdSource(descEl);
          }
          if (sourceInput) {
            sourceInput.value = quizData.source;
            updateCharCount("sourceCharCount", quizData.source.length, 250);
          }
        }
      }
      // Clear dropped files
      window._droppedImportFiles = null;
    }

    // Process pasted content
    if (content) {
      let parsed;
      try {
        parsed = parseQuizJson(content);
      } catch (err) {
        showNotification("خطأ في التنسيق", err.message, "error");
        hideLoading();
        return;
      }
      allImportedQuestions = allImportedQuestions.concat(parsed.questions);
      if (!quizData.title && parsed.meta) {
        quizData.title = parsed.meta.title || "";
        quizData.description = parsed.meta.description || "";
        // FIX: read source FROM parsed.meta, not from stale quizData.source
        quizData.source = parsed.meta.source || "";
        const titleEl = document.getElementById("quizTitle");
        const descEl = document.getElementById("quizDescription");
        const sourceInput = document.getElementById("quizSource");
        if (titleEl) {
          titleEl.value = quizData.title;
          updateCharCount("titleCharCount", quizData.title.length, 100);
        }
        if (descEl) {
          descEl.value = quizData.description;
          updateCharCount("descCharCount", quizData.description.length, 500);
          autoResizeMdSource(descEl);
        }
        if (sourceInput) {
          sourceInput.value = quizData.source;
          updateCharCount("sourceCharCount", quizData.source.length, 250);
        }
      }
    }

    // Add questions to current quiz
    if (allImportedQuestions.length > 0) pushHistorySnapshot();
    allImportedQuestions.forEach((q) => {
      const questionId = ++questionIdCounter;
      let importedCorrect;
      if (Array.isArray(q.correct)) {
        importedCorrect = q.correct;
      } else if (typeof q.correct === "number" && !Number.isNaN(q.correct)) {
        importedCorrect = [q.correct];
      } else {
        importedCorrect = [];
      }
      const question = {
        id: questionId,
        q: q.q || "",
        options: q.options || ["", ""],
        correct: importedCorrect,
        image: q.image || "",
        explanation: q.explanation || "",
      };
      quizData.questions.push(question);
      renderQuestion(question);
    });

    updateEmptyState();
    updateProgress();
    updateStatistics();
    autosave();

    hideLoading();
    closeImportModal();

    const parts = [];
    if (allImportedQuestions.length > 0)
      parts.push(`استيراد ${allImportedQuestions.length} سؤال`);
    if (savedQuizzesCount > 0)
      parts.push(`حفظ ${savedQuizzesCount} امتحان في المكتبة`);
    showNotification("تم الاستيراد!", parts.join(" و") || "اكتمل", "success");
  } catch (error) {
    hideLoading();
    console.error("Import error:", error);
    showNotification("خطأ في الاستيراد", error.message, "error");
  }
};

// ============================================================================
// RESET PAGE
// ============================================================================

/**
 * Actually performs the reset — no confirmation dialog here, since the two
 * callers need different confirmation strategies:
 *   - window.resetPage (the manual "إعادة ضبط" button) uses the app's own
 *     async _confirm() modal.
 *   - the AI Helper's reset_quiz_page tool handler (see
 *     handleAiResetPageToolCall below) must use a synchronous
 *     window.confirm() instead — onToolCall's return value is read
 *     synchronously right after it's called (see ai-agent-chat.js), so an
 *     awaited confirmation there would let the "done" chat bubble render
 *     before the user had even answered the dialog.
 *
 * BUG FIX: previously (inline in window.resetPage) this never cleared
 * editingQuizId. Opening the page via ?edit=<id> and then resetting left
 * editingQuizId pointing at that quiz — the next manual "Save" would
 * silently overwrite it with the now-empty draft instead of creating a
 * fresh, unlinked quiz. Also updates the page header back to "New quiz"
 * mode for the same reason (it was previously set to "تعديل الامتحان" by
 * loadQuizFromLocalStorage() and never reverted).
 */
function resetPageData() {
  // Clear the old single-key draft (backwards compat)
  localStorage.removeItem("quiz_draft");

  quizData = {
    title: "",
    description: "",
    source: "",
    questions: [],
  };

  questionIdCounter = 0;
  editingQuizId = null;
  // Every new session gets its own draft ID so old drafts are never overwritten
  currentDraftId = _generateId("draft");
  // A reset starts a brand-new quiz — old snapshots would undo back into a
  // quiz that no longer has anything to do with what's on screen.
  resetHistory();

  const headerTitle = document.querySelector(".header h1");
  if (headerTitle) headerTitle.textContent = "إنشاء امتحان جديد";
  document.title = "إنشاء امتحان - منصة بصمجي";

  const qTitleEl = document.getElementById("quizTitle");
  if (qTitleEl) qTitleEl.value = "";
  const qSrcEl = document.getElementById("quizSource");
  if (qSrcEl) qSrcEl.value = "";
  const qDescEl = document.getElementById("quizDescription");
  if (qDescEl) {
    qDescEl.value = "";
    autoResizeMdSource(qDescEl);
  }
  document.getElementById("questionsContainer").innerHTML = "";

  updateCharCount("titleCharCount", 0, 100);
  updateCharCount("descCharCount", 0, 500);
  updateEmptyState();
  updateProgress();
  updateStatistics();
}

window.resetPage = async function () {
  if (
    !(await _confirm(
      "هل أنت متأكد من إعادة ضبط الصفحة؟ سيتم حذف جميع البيانات!",
    ))
  ) {
    return;
  }

  resetPageData();
  showNotification("تم إعادة الضبط", "تم مسح جميع البيانات", "success");
};

// ============================================================================
// AI HELPER INTEGRATION
// ============================================================================
// Mounted once from DOMContentLoaded (see bottom of setupEventListeners'
// caller below). Offers exactly two tools — edit_quiz and reset_quiz_page
// (see api/ai-agent/_tools.js) — deliberately NOT create_quiz/delete_quiz:
// there is exactly one quiz in scope on this page (the one currently in
// the form), so "create another" or "delete a different one" don't apply
// here the way they do on the home page's quiz list.

/**
 * Lightweight text snapshot of the in-progress quiz, sent as a live
 * contextPrompt (not contextSummary — that option's rendering in
 * ai-agent-chat.js is hardcoded to the home page's "list of saved
 * quizzes" shape/wording, e.g. "امتحانات المستخدم الحالية" and a
 * title/questionCount/types-per-item format; this page has exactly one
 * quiz and needs its own wording, e.g. explicitly saying when it's empty)
 * so the assistant knows what's already on the page without a tool
 * round-trip.
 *
 * BUG FIX: a prior version passed this through `contextSummary` as a bare
 * object instead of an array — ai-agent-chat.js's Array.isArray() check on
 * that option was therefore always false, so the create-quiz page's
 * summary was silently never sent to the model at all, at any point. This
 * is now passed as `contextPrompt` (see mountAIHelper() below), which
 * ai-agent-chat.js accepts as either a plain string or a function; passing
 * a function specifically means it's re-read on every single message sent
 * (not just once when the panel first mounted), so the assistant always
 * sees the page's current title/question count — including after the
 * user resets the page, after the AI itself edits the quiz, or in a brand
 * new chat opened later in the same session.
 * @returns {string}
 */
function buildCurrentQuizContextForAI() {
  const count = quizData.questions.length;
  if (count === 0) {
    return "حالة الصفحة الآن: الصفحة فارغة تمامًا — لا يوجد عنوان ولا أي أسئلة بعد.";
  }
  const title = quizData.title?.trim() || "(بدون عنوان)";
  return `حالة الصفحة الآن: يوجد امتحان قيد الإعداد بعنوان "${title}" ويحتوي على ${count} سؤال.`;
}

/**
 * Applies an edit_quiz tool call to the live in-progress quiz. currentTitle
 * is ignored on purpose — see CREATE_QUIZ_PAGE_SYSTEM_PROMPT's note that
 * this page has only one quiz in scope, so there's nothing to disambiguate.
 *
 * Title/description are applied directly to quizData AND their visible
 * <input>/<textarea> elements — the same four-line pattern
 * processImport() already uses after a paste/file import, reused verbatim
 * so AI edits and manual imports keep the form in sync identically.
 *
 * If `questions` is present, it REPLACES the whole list (per
 * EDIT_QUIZ_TOOL's contract — the system prompt explicitly warns the model
 * to resend unchanged questions too, not just new/changed ones). The
 * replacement is rendered via the exact same clear-container-then-
 * renderQuestion-per-item loop loadQuizFromLocalStorage() already uses for
 * "load a full quiz for editing" — proven at whatever size a saved quiz
 * can already reach, so this is not a new, untested rendering path.
 * @param {{name: string, input: object}} toolCall
 * @returns {string} chat bubble text
 */
function handleAiEditQuizToolCall(toolCall) {
  const input = toolCall?.input || {};
  const hasTitle = typeof input.title === "string" && input.title.trim() !== "";
  const hasDescription = typeof input.description === "string";
  const hasQuestions = Array.isArray(input.questions) && input.questions.length > 0;

  if (!hasTitle && !hasDescription && !hasQuestions) {
    const err = new Error("edit_quiz tool call had no usable fields");
    err.userMessage = "تعذر تنفيذ التعديل: لم يتم إرسال أي بيانات صالحة.";
    throw err;
  }

  pushHistorySnapshot();

  if (hasTitle) {
    quizData.title = input.title.trim();
    const titleEl = document.getElementById("quizTitle");
    if (titleEl) {
      titleEl.value = quizData.title;
      updateCharCount("titleCharCount", quizData.title.length, 100);
    }
  }

  if (hasDescription) {
    quizData.description = input.description;
    const descEl = document.getElementById("quizDescription");
    if (descEl) {
      descEl.value = quizData.description;
      updateCharCount("descCharCount", quizData.description.length, 500);
      autoResizeMdSource(descEl);
    }
  }

  if (hasQuestions) {
    const { questions, maxId } = normalizeQuestionsWithIds(input.questions);
    quizData.questions = questions;
    questionIdCounter = maxId;

    const container = document.getElementById("questionsContainer");
    if (container) container.innerHTML = "";
    quizData.questions.forEach((question) => renderQuestion(question));
  }

  updateEmptyState();
  updateProgress();
  updateStatistics();
  autosave();

  const parts = [];
  if (hasTitle) parts.push("العنوان");
  if (hasDescription) parts.push("الوصف");
  if (hasQuestions) parts.push(`${quizData.questions.length} سؤال`);

  showNotification("تم التعديل", `تم تحديث: ${parts.join("، ")}`, "success");
  return `✅ تم تعديل الامتحان (${parts.join("، ")})`;
}

/**
 * Applies a reset_quiz_page tool call. No second confirmation dialog here
 * — the system prompt (CREATE_QUIZ_PAGE_SYSTEM_PROMPT) already requires
 * the model to warn the user this is irreversible and get an explicit
 * "yes" in chat before ever calling this tool. A prior version added a
 * native window.confirm() on top of that, which produced a confusing
 * double confirmation (once in chat, once in a popup) for the exact same
 * decision, and — being a blocking native dialog — was also a plain
 * window.confirm() rather than the app's own in-app notification UI. The
 * chat confirmation is the single source of truth, matching how
 * handleAiEditQuizToolCall below has no extra gate either.
 * @param {{name: string, input: object}} toolCall
 * @returns {string} chat bubble text
 */
function handleAiResetPageToolCall(toolCall) {
  resetPageData();
  showNotification("تم إعادة الضبط", "تم مسح جميع البيانات", "success");
  return "🗑️ تم مسح الصفحة بالكامل.";
}

/**
 * Single entry point passed as onToolCall to createAIAgentFab — dispatches
 * by tool name, same pattern as handleQuizToolCall in user-quizzes-view.js.
 * @param {{name: string, input: object}} toolCall
 * @returns {string} chat bubble text
 */
function handleCreateQuizPageToolCall(toolCall) {
  switch (toolCall?.name) {
    case "edit_quiz":
      return handleAiEditQuizToolCall(toolCall);
    case "reset_quiz_page":
      return handleAiResetPageToolCall(toolCall);
    default: {
      const err = new Error(`Unknown tool call: ${toolCall?.name}`);
      err.userMessage = "أداة غير معروفة.";
      throw err;
    }
  }
}

/**
 * Mounts the AI Helper FAB onto the page. Called once from
 * DOMContentLoaded, after the initial quiz (draft or ?edit=) has already
 * been loaded/rendered — though since buildCurrentQuizContextForAI is
 * passed as a function (not called once here), it stays accurate for the
 * whole lifetime of the page anyway, not just at this initial mount.
 */
function mountAIHelper() {
  const container = document.querySelector(".container");
  if (!container) return;
  container.appendChild(
    createAIAgentFab({
      placeholder: "اطلب تعديل الامتحان، أو ارفع ملفًا لتحويله لأسئلة...",
      pageKey: "create",
      defaultSystemPrompt: CREATE_QUIZ_PAGE_SYSTEM_PROMPT,
      suggestedPrompts: CREATE_QUIZ_PAGE_SUGGESTED_PROMPTS,
      enableFileUpload: true,
      enableTools: true,
      toolNames: ["edit_current_quiz", "reset_quiz_page"],
      contextPrompt: buildCurrentQuizContextForAI,
      onToolCall: handleCreateQuizPageToolCall,
    }),
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function showLoading(text = "جاري التحميل...") {
  const overlay = document.getElementById("loadingOverlay");
  const loadingText = document.getElementById("loadingText");
  if (overlay && loadingText) {
    loadingText.textContent = text;
    overlay.style.display = "flex";
  }
}

function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    overlay.style.display = "none";
  }
}
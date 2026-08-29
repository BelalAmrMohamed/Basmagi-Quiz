// public/src/features/create/create-quiz.js

// Temporary | For performance debugging
console.log("create-quiz.js loaded successfully");

import {
  showNotification,
  _confirm,
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
 */
function mdEditorHtml(id, value, placeholder, rows = 2) {
  const safeValue = (value || "").replace(/\\n/g, "\n");
  const escaped = safeValue
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `
    <div class="wp-field" id="wrap-${id}">
      <div class="wp-bar">
        <div class="wp-tabs" role="tablist">
          <button type="button" class="wp-tab active" id="tab-write-${id}" role="tab" aria-selected="true"
            onclick="switchMdTab('${id}', 'write')">كتابة</button>
          <button type="button" class="wp-tab" id="tab-preview-${id}" role="tab" aria-selected="false"
            onclick="switchMdTab('${id}', 'preview')">معاينة</button>
        </div>
        ${mdToolbarHtml(id)}
      </div>
      <div class="wp-pane-wrap">
        <textarea
          class="md-source wp-textarea ltr"
          id="${id}"
          rows="${rows}"
          placeholder="${placeholder}"
        >${escaped}</textarea>
        <div class="wp-preview-pane ltr" id="preview-${id}" style="display:none;"></div>
      </div>
      <div class="wp-footer">
        <span class="wp-hint"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M9 15h6"/><path d="M6 9h1"/><path d="M6 12h1"/></svg> يدعم Markdown و LaTeX</span>
      </div>
    </div>`;
}

/** Switch a field between its Write and Preview tabs */
window.switchMdTab = function (id, target) {
  const source = document.getElementById(id);
  const previewPane = document.getElementById(`preview-${id}`);
  const tabWrite = document.getElementById(`tab-write-${id}`);
  const tabPreview = document.getElementById(`tab-preview-${id}`);
  const toolbar = document.getElementById(`toolbar-${id}`);
  if (!source || !previewPane || !tabWrite || !tabPreview) return;

  if (target === "preview") {
    const val = source.value;
    if (val.trim()) {
      previewPane.innerHTML = renderMarkdown(val);
      renderMathIn(previewPane);
    } else {
      previewPane.innerHTML = `<span class="md-placeholder">لا يوجد شيء للمعاينة</span>`;
    }
    source.style.display = "none";
    previewPane.style.display = "block";
    if (toolbar) toolbar.style.display = "none";
    tabWrite.classList.remove("active");
    tabWrite.setAttribute("aria-selected", "false");
    tabPreview.classList.add("active");
    tabPreview.setAttribute("aria-selected", "true");
  } else {
    source.style.display = "block";
    previewPane.style.display = "none";
    if (toolbar) toolbar.style.display = "flex";
    tabPreview.classList.remove("active");
    tabPreview.setAttribute("aria-selected", "false");
    tabWrite.classList.add("active");
    tabWrite.setAttribute("aria-selected", "true");
    source.focus();
  }
};

/** Backward-compatible helper: some call sites just want to focus the field */
window.activateMdEditor = function (e, id) {
  if (typeof e === "string" && !id) {
    id = e;
  }
  switchMdTab(id, "write");
  const source = document.getElementById(id);
  if (source) {
    source.focus();
    source.setSelectionRange(source.value.length, source.value.length);
  }
};

function autoResizeMdSource(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.max(ta.scrollHeight, 60) + "px";
}

/** Wire up a Write/Preview field: auto-resize + onChange. Preview renders on-demand (tab switch). */
function setupMdEditor(id, onChange) {
  const source = document.getElementById(id);
  if (!source) return;

  autoResizeMdSource(source);

  source.addEventListener("input", () => {
    autoResizeMdSource(source);
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
    const newValue =
      value.slice(0, start) + prefix + text + suffix + value.slice(end);
    ta.value = newValue;
    const cursorStart = start + prefix.length;
    const cursorEnd = cursorStart + text.length;
    ta.setSelectionRange(cursorStart, cursorEnd);
  };

  const linePrefix = (prefix) => {
    // Apply prefix to the start of the current line (or each selected line)
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const affected = value.slice(lineStart, end || lineStart);
    const lines = (affected || "").split("\n");
    const newLines = lines
      .map((line) => (line.startsWith(prefix) ? line : prefix + line))
      .join("\n");
    const newValue =
      value.slice(0, lineStart) + newLines + value.slice(end || lineStart);
    ta.value = newValue;
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
      const newValue =
        value.slice(0, start) + "```\n" + text + "\n```" + value.slice(end);
      ta.value = newValue;
      const codeStart = start + 4;
      ta.setSelectionRange(codeStart, codeStart + text.length);
      break;
    }
    case "heading": {
      const level = Math.min(Math.max(headingLevel || 3, 1), 5);
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
// INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Detect admin role — controls upload-tab visibility
  isAdmin = isAdminAuthenticated();

  const urlParams = new URLSearchParams(window.location.search);
  const editId = urlParams.get("edit");
  if (editId) {
    editingQuizId = editId;
    loadQuizFromLocalStorage(editId);
  } else {
    loadDraftFromLocalStorage();
  }

  updateEmptyState();
  setupEventListeners();
  setupKeyboardShortcuts();
  updateProgress();
  updateStatistics();
  mountAIHelper();
});

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
      } else {
        e.target.style.display = "none";
      }
    }

    // Shortcuts Panel
    const shortcutsPanel = document.getElementById("shortcutsPanel");
    if (shortcutsPanel && shortcutsPanel.style.display === "block") {
      // Allow clicking the toggle button without immediately closing it
      if (
        !shortcutsPanel.contains(e.target) &&
        !e.target.closest('button[onclick="toggleShortcuts()"]')
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
    autosave();
  });

  descInput.addEventListener("input", (e) => {
    quizData.description = e.target.value;
    updateCharCount("descCharCount", e.target.value.length, 500);
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

  // Scroll detection for FAB
  let lastScrollTop = 0;
  window.addEventListener("scroll", () => {
    const fabContainer = document.getElementById("fabContainer");
    if (!fabContainer || quizData.questions.length < 3) return;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    // Show/hide based on scroll position
    if (scrollTop > 300) {
      fabContainer.style.display = "block";
    } else {
      fabContainer.style.display = "none";
    }

    lastScrollTop = scrollTop;
  });
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
  const statsCard = document.getElementById("statsCard");
  if (!statsCard) return;

  const totalQuestions = quizData.questions.length;

  if (totalQuestions === 0) {
    statsCard.style.display = "none";
    return;
  }

  statsCard.style.display = "block";

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
  const avgOptions = (totalOptions / totalQuestions).toFixed(1);

  document.getElementById("statQuestions").textContent = totalQuestions;
  document.getElementById("statImages").textContent = questionsWithImages;
  document.getElementById("statExplanations").textContent =
    questionsWithExplanations;
  document.getElementById("statAvgOptions").textContent = avgOptions;
}

// ============================================================================
// QUESTION MANAGEMENT
// ============================================================================

window.addQuestion = function () {
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
        <div class="question-header" onclick="handleHeaderClick(event, ${question.id})">
            <span class="question-number" id="qnum-${question.id}">
                ${bulkModeActive ? `<input type="checkbox" class="question-select-checkbox" onchange="handleQuestionSelect(event, ${question.id})" onclick="event.stopPropagation()">` : ""}
                <span class="move-handle" onclick="event.stopPropagation()">
                  <button type="button" class="move-btn move-btn--up" title="نقل للأعلى" aria-label="نقل السؤال للأعلى" onclick="moveQuestion(${question.id}, 'up')"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg></button>
                  <button type="button" class="move-btn move-btn--down" title="نقل للأسفل" aria-label="نقل السؤال للأسفل" onclick="moveQuestion(${question.id}, 'down')"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
                </span>
                <span class="q-label">سؤال ${questionNumber}</span>
                <span class="q-preview ltr" id="qpreview-${question.id}"></span>
            </span>
            <div class="question-actions" onclick="event.stopPropagation()">
                <button class="btn-icon btn-collapse" onclick="toggleQuestionCollapse(${question.id})" title="طي/توسيع السؤال">
                    <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-unfold-vertical-icon lucide-unfold-vertical"><path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3 3-3-3"/><path d="m15 5-3-3-3 3"/></svg>
                </button>
                <button class="btn-icon btn-duplicate" onclick="duplicateQuestion(${question.id})" title="مضاعفة السؤال">
                    <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy-icon lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                </button>
                <button class="btn-icon btn-delete" onclick="removeQuestion(${question.id})" title="حذف السؤال">
                    <svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash2-icon lucide-trash-2"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </div>
        
        <div class="question-body">
            <div class="form-group">
                <label>نصّ السؤال *</label>
                ${mdEditorHtml(`question-text-${question.id}`, question.q, "أدخل سؤالك هنا...", 3)}
            </div>
            
            <div class="form-group">
                <label class="options-label">${isEssay ? "الإجابة المرجعية" : "الإختيارات (اختر إجابة واحدة أو أكثر كصحيحة)"}</label>
                <div id="options-container-${question.id}" class="options-list">
                    ${renderOptions(question)}
                </div>
                <div id="option-btn-${question.id}">
                  ${
                    isEssay
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
    e.target.closest(".move-handle") ||
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
async function uploadCombinedMediaFile(questionId, file) {
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

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= quizData.questions.length) return;

  const [moved] = quizData.questions.splice(index, 1);
  quizData.questions.splice(targetIndex, 0, moved);

  const container = document.getElementById("questionsContainer");
  const card = document.getElementById(`question-${questionId}`);
  const siblingCard =
    direction === "up" ? card.previousElementSibling : card.nextElementSibling;

  if (card && siblingCard) {
    if (direction === "up") {
      container.insertBefore(card, siblingCard);
    } else {
      container.insertBefore(siblingCard, card);
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
        <div class="essay-badge">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>
          سؤال مقالي
        </div>
        <div class="essay-answer-label">نموذج الإجابة ${
          question.options?.[0]?.trim()
            ? `<span class="essay-answer-note">(يُستخدم لتصحيح إجابات الطلاب تلقائيًا وتقييمها من 5)</span>`
            : `<span class="essay-answer-missing">(مطلوب — بدونه لن يمكن تصحيح إجابات الطلاب تلقائيًا)</span>`
        }</div>
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
            ${
              question.options.length >= 2
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
      : "الإختيارات (اختر إجابة واحدة أو أكثر كصحيحة)";
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
    question.options.push("");
    rerenderOptions(questionId);
    updateStatistics();
    autosave();
  }
};

window.removeOption = function (questionId, optionIndex) {
  const question = quizData.questions.find((q) => q.id === questionId);
  if (question && question.options.length >= 2) {
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

// ============================================================================
// VALIDATION
// ============================================================================

function validateQuiz() {
  const errors = [];

  if (!quizData.title || quizData.title.trim() === "") {
    errors.push("عنوان الاختبار مطلوب");
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
  const fabContainer = document.getElementById("fabContainer");
  const questionBadge = document.getElementById("questionBadge");

  if (quizData.questions.length === 0) {
    emptyState.classList.remove("hidden");
    if (questionControls) questionControls.style.display = "none";
    if (addQuestionBottom) addQuestionBottom.style.display = "none";
    if (fabContainer) fabContainer.style.display = "none";
  } else {
    emptyState.classList.add("hidden");
    if (questionControls) questionControls.style.display = "block";
    if (addQuestionBottom) addQuestionBottom.style.display = "flex";
    if (fabContainer && quizData.questions.length >= 3) {
      fabContainer.style.display = "block";
    }
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
      const dataToSave = {
        title: quizData.title,
        description: quizData.description,
        source: quizData.source, // FIX: persist source in draft
        questions: quizData.questions,
        lastModified: new Date().toISOString(),
      };

      localStorage.setItem("quiz_draft", JSON.stringify(dataToSave));
      updateAutosaveIndicator("saved");

      setTimeout(() => {
        updateAutosaveIndicator("saved");
      }, 1000);
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
    indicator.querySelector(".save-text").textContent = "جاري الحفظ...";
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
        document.getElementById("quizDescription").value = description;
        updateCharCount("descCharCount", description.length, 500);
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
    }
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
      if (headerTitle) headerTitle.textContent = "تعديل الاختبار";
      document.title = "تعديل الاختبار - منصة بصمجي";

      // Support both old flat schema and new (meta.title)
      quizData.title = quiz.meta?.title || quiz.title || "";
      document.getElementById("quizTitle").value = quizData.title;
      updateCharCount("titleCharCount", quizData.title.length, 100);

      quizData.description = quiz.meta?.description || quiz.description || "";
      document.getElementById("quizDescription").value = quizData.description;
      updateCharCount("descCharCount", quizData.description.length, 500);

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

      showNotification("أهلاً بك", "تم تحميل الاختبار للتعديل", "success");
    } else {
      showNotification("خطأ", "لم يتم العثور على الاختبار", "error");
      setTimeout(() => (window.location.href = "/"), 1500);
    }
  } catch (error) {
    console.error("Error loading quiz for edit:", error);
    showNotification("خطأ", "حدث خطأ أثناء تحميل الاختبار", "error");
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

  showLoading("جاري الحفظ...");

  setTimeout(() => {
    let quizId;
    if (editingQuizId) {
      quizId = updateInUserQuizzes(editingQuizId, quizData);
    } else {
      quizId = saveToUserQuizzes(quizData);
    }
    hideLoading();

    if (quizId) {
      showNotification(
        "تم الحفظ!",
        'يمكنك العثور عليه في "إمتحاناتك"',
        "success",
      );
      if (editingQuizId) {
        setTimeout(() => (window.location.href = "/"), 1000);
      }
    } else {
      showNotification("خطأ", "فشل حفظ الاختبار", "error");
    }
  }, 500);
};

// ============================================================================
// PREVIEW
// ============================================================================

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

  let html = `
    <div style="text-align: center; margin-bottom: 30px;">
      <h2 style="margin: 0 0 10px 0;">${escapeHtml(quizData.title)}</h2>
      ${quizData.description ? `<p style="color: var(--color-text-secondary); margin: 0;">${escapeHtml(quizData.description)}</p>` : ""}
    </div>
  `;

  quizData.questions.forEach((q, index) => {
    const correctSet = Array.isArray(q.correct)
      ? q.correct
      : typeof q.correct === "number"
        ? [q.correct]
        : [];
    html += `
      <div class="preview-question">
        <h4>السؤال ${index + 1}: ${renderMarkdown(q.q)}</h4>
        ${q.image ? `<img src="${escapeHtml(q.image)}" class="preview-image" alt="صورة السؤال" onerror="this.style.display='none'">` : ""}
        <ul class="preview-options">
          ${q.options
            .map(
              (opt, i) =>
                `<li class="${correctSet.includes(i) ? "correct" : ""}">${renderMarkdown(opt)}${correctSet.includes(i) ? " ✓" : ""}</li>`,
            )
            .join("")}
        </ul>
        ${q.explanation ? `<div class="preview-explanation"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.125em;margin-left:4px"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> ${renderMarkdown(q.explanation)}</div>` : ""}
      </div>
    `;
  });

  content.innerHTML = html;
  modal.style.display = "flex";
  renderMathIn(content);
};

window.closePreview = function () {
  const modal = document.getElementById("previewModal");
  modal.style.display = "none";
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
        }
        if (sourceInput) {
          sourceInput.value = quizData.source;
          updateCharCount("sourceCharCount", quizData.source.length, 250);
        }
      }
    }

    // Add questions to current quiz
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
      parts.push(`حفظ ${savedQuizzesCount} اختبار في المكتبة`);
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
 * mode for the same reason (it was previously set to "تعديل الاختبار" by
 * loadQuizFromLocalStorage() and never reverted).
 */
function resetPageData() {
  localStorage.removeItem("quiz_draft");

  quizData = {
    title: "",
    description: "",
    source: "",
    questions: [],
  };

  questionIdCounter = 0;
  editingQuizId = null;

  const headerTitle = document.querySelector(".header h1");
  if (headerTitle) headerTitle.textContent = "إنشاء اختبار جديد";
  document.title = "إنشاء اختبار - منصة بصمجي";

  document.getElementById("quizTitle").value = "";
  document.getElementById("quizSource").value = "";
  document.getElementById("quizDescription").value = "";
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
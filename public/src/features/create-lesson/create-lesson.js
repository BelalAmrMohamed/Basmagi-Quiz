// =============================================================================
// public/src/features/create-lesson/create-lesson.js
// LESSON AUTHORING — /create-lesson page logic.
// =============================================================================
// See docs/plans/lessons-feature-plan.md's Phase 3.
//
// This page is deliberately a sibling of create-quiz.js and behaves like it:
//   * Lessons are created for EVERYONE (no admin gate) and are saved into the
//     user's own workspace "امتحاناتك" — the `user_quizzes` localStorage list —
//     exactly like a quiz. There is no course/folder picker: placement inside
//     امتحاناتك is done afterwards with the workspace's own move/organize UI.
//   * Auto-save keeps a draft row in `user_quizzes` (meta.type = "draft" while
//     work-in-progress, promoted to meta.type = "lesson" on حفظ), the same
//     lifecycle create-quiz uses.
//   * A single fixed global Markdown + LaTeX bar (#globalMdBar) formats
//     whichever .md-source textarea was focused last.
//   * Structural undo / redo (whole-lesson snapshots), Ctrl+S save, and a
//     rename-from-the-title-bar flow all match create-quiz.
//
// It does NOT import create-quiz.js (per the plan's explicit ⚠️): the few
// pieces that are shared in spirit (replaceTextareaRange, the
// global-bar dispatcher, the media-upload helper) are ported here.
//
// Content shape is the one lesson-schema.js's normalizeLessonContent() and
// api/_validateLesson.js define — `{ sections: [{ id, title, defaultHidden,
// blocks: [...] }] }` — so a local lesson can later be published server-side
// with no conversion. Embedded questions support BOTH kinds the validator
// knows: `questionKind: "mcq"` (options + correctIndex) and
// `questionKind: "essay"` (modelAnswer).
//
// ⚠️ Lessons are never scored: nothing in this file touches points / level /
// passed_quizzes_count.
// =============================================================================

import { isAdminAuthenticated } from "../../shared/adminAuth.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { getManifest } from "../../shared/quizManifest.js";
import { renderMarkdown } from "../../shared/markdown.js";
import { readEditorDrafts, upsertEditorDraft, removeEditorDraft, migrateWorkspaceDrafts } from "../../shared/editor-drafts.js";
import { escapeHtml } from "../home/escape-html.js";
import {
    showNotification,
    _confirm,
    _prompt,
} from "../../components/notifications/notifications.js";
import { normalizeLessonContent, hasLessonLevelCollision } from "../lesson/lesson-schema.js";
import { FONT_CHOICES, HIGHLIGHT_CHOICES } from "../lesson/lesson-reader-prefs.js";
import { mountColorPicker } from "../../shared/color-picker.js";
import { createAIAgentFab } from "../../components/ai-agent/ai-agent.js";
import { CREATE_LESSON_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { CREATE_LESSON_PAGE_SUGGESTED_PROMPTS } from "../../components/ai-agent/ai-agent-suggested-prompts.js";

// =============================================================================
// STATE
// =============================================================================

/**
 * The lesson being authored. `fontId` / `highlightId` are the author's
 * OPTIONAL reader defaults (saved as reader_prefs_default); they are edited
 * from the Markdown bar, not from a form card.
 */
let lessonData = emptyLessonData();

/** id of the current draft row in user_quizzes (meta.type === "draft"), or null. */
let currentDraftId = null;
/** id of an already-saved local lesson row being edited (?edit=<id>), or null. */
let editingLessonId = null;

/** `examList` from getManifest(), used by the quiz-reference picker. */
let quizExamList = [];

/** Set once on DOMContentLoaded — gates only media *upload* (links are for all). */
let isAdmin = false;

let autosaveTimeout = null;

function newLocalId(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function emptyLessonData() {
    return {
        title: "",
        fontId: "default",
        highlightId: "yellow",
        sections: [{ id: newLocalId("s"), title: "", defaultHidden: false, blocks: [] }],
    };
}

// Timestamp of the last programmatic dropdown open — used to ignore the scroll
// event that the browser fires as a side effect of that same tap on a
// horizontally-scrolling bar (identical guard to create-quiz.js).
let _lastMenuOpenAt = 0;
function _armMenuOpenGuard() {
    _lastMenuOpenAt = Date.now();
}

// =============================================================================
// LOCAL STORAGE MODEL — the "امتحاناتك" workspace
// =============================================================================
// Rows live in the same `user_quizzes` array quizzes/folders/courses use, so
// the workspace's collision, move, rename and trash machinery treats a lesson
// like any other item:
//
//   { id, meta: { type: "lesson" | "draft-lesson", title, parentId, createdAt,
//                 updatedAt, readerPrefs? }, lesson: { sections: [...] } }
//
// Drafts are tagged "draft-lesson" (not plain "draft") so create-quiz's entry
// screen — which lists every meta.type === "draft" row as a quiz draft —
// never mistakes an unfinished lesson for an unfinished quiz.

const USER_ITEMS_KEY = "user_quizzes";
const LESSON_TYPE = "lesson";
const LESSON_DRAFT_TYPE = "draft-lesson";

function _readUserItems() {
    try {
        const parsed = JSON.parse(localStorage.getItem(USER_ITEMS_KEY) || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function _writeUserItems(items) {
    localStorage.setItem(USER_ITEMS_KEY, JSON.stringify(items));
}

function _generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Strip editor-only keys (_localId) so what's persisted is the clean, validated shape. */
function serializeContent(data = lessonData) {
    return {
        sections: data.sections.map((section) => ({
            id: section.id,
            title: section.title,
            defaultHidden: Boolean(section.defaultHidden),
            blocks: section.blocks.map((block) => {
                const { _localId, ...clean } = block;
                return clean;
            }),
        })),
    };
}

function readerPrefsFromData(data = lessonData) {
    return { fontId: data.fontId || "default", highlightId: data.highlightId || "yellow" };
}

/** Number of embedded questions — shown on the workspace tile like a question count. */
function countQuestions(data = lessonData) {
    let n = 0;
    for (const s of data.sections) for (const b of s.blocks) if (b.type === "question") n++;
    return n;
}

function buildRow(id, type, existing) {
    const now = new Date().toISOString();
    const content = serializeContent();
    return {
        ...(existing || {}),
        id,
        meta: {
            ...(existing?.meta || {}),
            type,
            title: lessonData.title.trim(),
            parentId: existing?.meta?.parentId ?? null,
            createdAt: existing?.meta?.createdAt || new Date().toLocaleString("en-US"),
            updatedAt: now,
            readerPrefs: readerPrefsFromData(),
        },
        stats: { questionCount: countQuestions(), sectionCount: lessonData.sections.length },
        lesson: content,
        // `questions` stays an (empty) array so any workspace code that reads
        // `quiz.questions.length` on every row never throws on a lesson row.
        questions: [],
    };
}

// =============================================================================
// UNDO / REDO — whole-lesson snapshots (same mechanism as create-quiz.js)
// =============================================================================
// Scoped to STRUCTURAL edits only (add/remove/move a section or block, change
// a question's type/correct answer, toggle hidden, undo-worthy reader-default
// changes). Per-keystroke text edits are excluded on purpose: they would
// explode the stack and fight the textarea's own native Ctrl+Z, which already
// handles text-level undo.

const UNDO_STACK_LIMIT = 50;
let undoStack = [];
let redoStack = [];
let isRestoringHistory = false;

function cloneLessonData() {
    return JSON.parse(JSON.stringify(lessonData));
}

/** Call BEFORE mutating lessonData for a structural change. */
function pushHistorySnapshot() {
    if (isRestoringHistory) return;
    undoStack.push(cloneLessonData());
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

function resetHistory() {
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
}

function refreshEditorAfterHistoryChange() {
    renderSections();
    updateSectionNavigator();
    updateAppTitleBar();
    // Undoing/redoing a reader-default change restores lessonData.fontId, but
    // the <select> in the Markdown bar is not part of renderSections() — sync
    // it or the control keeps showing the pre-undo value.
    syncReaderDefaultsBar();
}

window.performUndo = function () {
    if (undoStack.length === 0) return;
    const previous = undoStack.pop();
    redoStack.push(cloneLessonData());
    if (redoStack.length > UNDO_STACK_LIMIT) redoStack.shift();

    isRestoringHistory = true;
    lessonData = previous;
    refreshEditorAfterHistoryChange();
    isRestoringHistory = false;

    updateUndoRedoButtons();
    autosave();
};

window.performRedo = function () {
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    undoStack.push(cloneLessonData());
    if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();

    isRestoringHistory = true;
    lessonData = next;
    refreshEditorAfterHistoryChange();
    isRestoringHistory = false;

    updateUndoRedoButtons();
    autosave();
};

// =============================================================================
// AUTOSAVE — debounced write of the working lesson into user_quizzes
// =============================================================================
// Same lifecycle as create-quiz.js:
//   * a brand-new lesson autosaves as a "draft-lesson" row (currentDraftId);
//   * editing an already-saved lesson (?edit=<id> / opened from the entry
//     grid) autosaves straight back onto THAT row (editingLessonId), keeping
//     its type "lesson", its parentId (so it stays where the user filed it)
//     and its createdAt — so a refresh never loses edits and never demotes a
//     saved lesson back to a draft.
// "حفظ الدرس" then promotes a draft to a real lesson (with the same-level name
// collision check) and returns to the entry grid.

function autosave() {
    clearTimeout(autosaveTimeout);
    updateAutosaveIndicator("saving");

    autosaveTimeout = setTimeout(() => {
        try {
            const items = _readUserItems();

            if (editingLessonId) {
                const idx = items.findIndex((r) => r.id === editingLessonId);
                if (idx >= 0) {
                    items[idx] = buildRow(editingLessonId, items[idx].meta?.type || LESSON_TYPE, items[idx]);
                    // An existing lesson's autosave must not fail just because
                    // the title is temporarily blank/duplicate mid-edit — the
                    // collision check is enforced on the explicit save.
                    _writeUserItems(items);
                }
            } else {
                if (!currentDraftId) currentDraftId = _generateId("draft-lesson");
                const existing = readEditorDrafts().find((r) => r.id === currentDraftId);
                upsertEditorDraft(buildRow(currentDraftId, LESSON_DRAFT_TYPE, existing));
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
    const label = indicator.querySelector(".save-text");
    if (status === "saving") {
        indicator.classList.add("saving");
        if (label) label.textContent = "يُحفظ..";
    } else if (status === "saved") {
        if (label) label.textContent = "محفوظ";
    } else if (status === "error") {
        indicator.classList.add("error");
        if (label) label.textContent = "خطأ في الحفظ";
    }
}

/** Flush a pending debounce immediately (used before leaving the editor). */
function flushAutosave() {
    if (!autosaveTimeout) return;
    clearTimeout(autosaveTimeout);
    autosaveTimeout = null;
    try {
        const items = _readUserItems();
        if (editingLessonId) {
            const idx = items.findIndex((r) => r.id === editingLessonId);
            if (idx >= 0) {
                items[idx] = buildRow(editingLessonId, items[idx].meta?.type || LESSON_TYPE, items[idx]);
                _writeUserItems(items);
            }
        } else {
            if (!currentDraftId) currentDraftId = _generateId("draft-lesson");
            const existing = readEditorDrafts().find((r) => r.id === currentDraftId);
            upsertEditorDraft(buildRow(currentDraftId, LESSON_DRAFT_TYPE, existing));
        }
        updateAutosaveIndicator("saved");
    } catch (error) {
        console.error("Autosave flush error:", error);
        updateAutosaveIndicator("error");
    }
}

// Persist any pending edit if the tab is closed / navigated away within the
// 1s debounce window — autosave() alone would lose those last keystrokes.
window.addEventListener("pagehide", flushAutosave);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAutosave();
});

// =============================================================================
// INIT
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
    migrateWorkspaceDrafts();
    isAdmin = isAdminAuthenticated();

    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get("edit");

    setupGlobalMdBar();
    setupKeyboardShortcuts();
    setupEntryItemMenuListeners();
    setupSectionNavigatorToggle();
    setupReaderDefaultsBar();
    updateUndoRedoButtons();
    loadQuizExamList();

    // Wrapped defensively: an old-schema/corrupt draft (e.g. a block shape
    // that predates this feature) can throw while normalizing or rendering.
    // Routing fix (vercel.json) stops the *wrong-page* symptom (browser nav
    // to /create-lesson was being caught by the SPA catch-all and bounced to
    // "/"), but a genuinely bad row can still throw client-side once we're
    // on the right page — this catch is what sends that case to the entry
    // screen instead of leaving a half-rendered/broken editor.
    let openedOk = false;
    if (editId) {
        try {
            openedOk = openLessonById(editId);
        } catch (err) {
            console.error("Failed to open lesson for editing:", err);
            openedOk = false;
        }
    }

    if (!openedOk) {
        showEntryScreen();
    } else {
        // Deep-linked edit bypasses the entry screen, same as create-quiz.
    }

    document.dispatchEvent(new Event("app:ready"));
});

window.toggleLessonMenu = function (event, id) {
    event.preventDefault();
    event.stopPropagation();
    const menu = document.getElementById(id);
    const open = menu?.classList.contains("open");
    document.querySelectorAll("#menuBar .menu-dropdown.open").forEach((item) => item.classList.remove("open"));
    if (menu && !open) menu.classList.add("open");
};

window.lessonMenuAction = function (action) {
    document.querySelectorAll("#menuBar .menu-dropdown.open").forEach((item) => item.classList.remove("open"));
    if (action === "save") return window.saveLesson();
    if (action === "preview") return window.previewLesson();
    if (action === "section") return window.addSection();
    if (action === "help") return showNotification("اختصارات", "Ctrl+S للحفظ، Ctrl+Z للتراجع، Ctrl+Y للإعادة.", "info");
    const section = lessonData.sections[lessonData.sections.length - 1];
    if (["markdown", "media", "question"].includes(action) && section) return window.addBlock(section.id, action);
    if (action === "expand" || action === "collapse") {
        document.querySelectorAll(".lesson-section-card").forEach((card) => card.classList.toggle("collapsed", action === "collapse"));
    }
};

document.addEventListener("click", (event) => {
    if (!event.target.closest("#menuBar")) {
        document.querySelectorAll("#menuBar .menu-dropdown.open").forEach((item) => item.classList.remove("open"));
    }
});

async function loadQuizExamList() {
    try {
        const { examList } = await getManifest();
        quizExamList = Array.isArray(examList) ? examList : [];
    } catch (err) {
        console.error("[create-lesson] failed to load quiz manifest:", err);
        quizExamList = [];
    }
}

// =============================================================================
// ENTRY SCREEN — recent drafts + saved lessons (from user_quizzes, like create-quiz)
// =============================================================================

function showEntryScreen() {
    flushAutosave();
    const entryScreen = document.getElementById("entryScreen");
    const form = document.getElementById("lessonCreatorForm");
    const appTitleBar = document.getElementById("appTitleBar");
    const globalMdBar = document.getElementById("globalMdBar");

    if (form) form.style.display = "none";
    if (appTitleBar) appTitleBar.style.display = "none";
    if (globalMdBar) globalMdBar.style.display = "none";
    if (entryScreen) entryScreen.style.display = "block";
    document.body.classList.remove("lesson-form-active");

    // Drop ?edit= now that the editor is closed, so the address bar never
    // points at a lesson that's no longer open.
    if (window.location.search) {
        const url = new URL(window.location.href);
        if (url.searchParams.has("edit")) {
            url.searchParams.delete("edit");
            history.replaceState(null, "", url.pathname + url.search);
        }
    }

    renderEntryItemsGrid();
}

function showLessonForm() {
    const entryScreen = document.getElementById("entryScreen");
    const form = document.getElementById("lessonCreatorForm");
    const appTitleBar = document.getElementById("appTitleBar");
    const globalMdBar = document.getElementById("globalMdBar");
    if (entryScreen) entryScreen.style.display = "none";
    if (form) form.style.display = "flex";
    if (appTitleBar) appTitleBar.style.display = "flex";
    if (globalMdBar) globalMdBar.style.display = "flex";
    document.body.classList.add("lesson-form-active");
    updateAppTitleBar();
    mountCreatorAgent();
}

function lessonEditorContext() {
    return {
        title: lessonData.title || "درس بدون عنوان",
        sections: lessonData.sections.map((section, index) => ({
            title: section.title || `قسم ${index + 1}`,
            blockCount: section.blocks.length,
        })),
    };
}

function addLessonQuestionFromAgent(toolCall) {
    if (toolCall?.name !== "add_lesson_question") throw new Error("Unknown lesson editor tool");
    const input = toolCall.input || {};
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw new Error("Question prompt is required");
    const target = input.sectionTitle
        ? lessonData.sections.find((section) => section.title === input.sectionTitle)
        : lessonData.sections[0];
    if (!target) {
        const error = new Error("Section not found");
        error.userMessage = "تعذر العثور على القسم المطلوب لإضافة السؤال.";
        throw error;
    }
    const isEssay = input.questionKind === "essay";
    const options = Array.isArray(input.options) ? input.options.map((option) => String(option || "").trim()) : [];
    const correctIndexes = Array.isArray(input.correctIndexes) ? input.correctIndexes.map(Number) : [0];
    if (isEssay && !String(input.modelAnswer || "").trim()) {
        const error = new Error("Essay model answer is required");
        error.userMessage = "السؤال المقالي يحتاج إجابة نموذجية.";
        throw error;
    }
    if (!isEssay && (options.length < 2 || correctIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= options.length))) {
        const error = new Error("Invalid MCQ options");
        error.userMessage = "السؤال يحتاج خيارين صالحين وإجابة صحيحة.";
        throw error;
    }
    pushHistorySnapshot();
    target.blocks.push(isEssay
        ? { type: "question", id: newLocalId("q"), _localId: newLocalId("b"), questionKind: "essay", prompt, modelAnswer: String(input.modelAnswer).trim(), explanation: String(input.explanation || "") }
        : { type: "question", id: newLocalId("q"), _localId: newLocalId("b"), questionKind: "mcq", prompt, options, correctIndex: correctIndexes[0], multiSelect: Boolean(input.multiSelect), correctIndexes, explanation: String(input.explanation || "") });
    renderSections();
    autosave();
    showNotification("تمت الإضافة", `أُضيف السؤال إلى ${target.title || "القسم الأول"}.`, "success");
    return `✅ تمت إضافة السؤال إلى ${target.title || "القسم الأول"}.`;
}

function mountCreatorAgent() {
    if (document.querySelector(".create-lesson-agent-fab")) return;
    const fab = createAIAgentFab({
        pageKey: "create-lesson",
        placeholder: "اطلب من الباشــمبصمج مساعدتك في هذا الدرس",
        defaultSystemPrompt: CREATE_LESSON_PAGE_SYSTEM_PROMPT,
        suggestedPrompts: CREATE_LESSON_PAGE_SUGGESTED_PROMPTS,
        contextSummary: lessonEditorContext,
        enableTools: true,
        toolNames: ["add_lesson_question"],
        onToolCall: addLessonQuestionFromAgent,
    });
    fab.classList.add("create-lesson-agent-fab");
    document.body.appendChild(fab);
}

function formatEntryItemDate(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "";
    const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return "الآن";
    if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `منذ ${diffHr} ساعة`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `منذ ${diffDay} يوم`;
    return date.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
}

function _byNewest(a, b) {
    if (!a.updatedAt && !b.updatedAt) return 0;
    if (!a.updatedAt) return 1;
    if (!b.updatedAt) return -1;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
}

function renderEntryItemsGrid() {
    const grid = document.getElementById("entryItemsGrid");
    if (!grid) return;

    const items = _readUserItems();
    const draftItems = readEditorDrafts();
    const toTile = (row, kind) => ({
        kind,
        id: row.id,
        title: row.meta?.title || (kind === "draft" ? "مسودة غير مُعنونة" : "درس بدون عنوان"),
        count: row.stats?.questionCount ?? 0,
        sections: row.stats?.sectionCount ?? row.lesson?.sections?.length ?? 0,
        updatedAt: row.meta?.updatedAt || null,
    });

    const drafts = draftItems
        .filter((r) => r.meta?.type === LESSON_DRAFT_TYPE)
        .map((r) => toTile(r, "draft"))
        .sort(_byNewest);
    const saved = items
        .filter((r) => r.meta?.type === LESSON_TYPE)
        .map((r) => toTile(r, "mine"))
        .sort(_byNewest);

    const makeTile = (item) => {
        const meta = [
            `${item.sections} ${item.sections === 1 ? "قسم" : "أقسام"}`,
            formatEntryItemDate(item.updatedAt),
        ]
            .filter(Boolean)
            .join(" · ");
        const id = escapeHtml(item.id);
        return `
      <div class="entry-item-wrap">
        <button type="button" class="entry-item${item.kind === "draft" ? " entry-item-draft" : ""}" onclick="chooseUserLessonToEdit('${id}')">
          <span class="entry-item-thumb">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 7v14" />
              <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
            </svg>
          </span>
          <span class="entry-item-title">${escapeHtml(item.title)}</span>
          <span class="entry-item-meta">${escapeHtml(meta)}</span>
        </button>
        <div class="entry-item-more-wrap">
          <button type="button" class="entry-item-more-btn" onclick="toggleEntryItemMenu(event, '${id}')" aria-label="خيارات إضافية" title="خيارات إضافية">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
          </button>
          <div class="entry-item-menu" id="entryItemMenu-${id}">
            <button type="button" class="entry-item-menu-option" onclick="renameEntryItem(event, '${id}')">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
              <span>إعادة تسمية</span>
            </button>
            <button type="button" class="entry-item-menu-option entry-item-menu-option-danger" onclick="deleteEntryItem(event, '${id}')">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              <span>حذف</span>
            </button>
          </div>
        </div>
      </div>`;
    };

    let html = "";
    if (drafts.length) {
        html += `<div class="entry-section"><h2 class="entry-screen-heading">المسودات</h2><div class="entry-items-grid">${drafts.map(makeTile).join("")}</div></div>`;
    }
    if (saved.length) {
        html += `<div class="entry-section"><h2 class="entry-screen-heading">الدروس المحفوظة</h2><div class="entry-items-grid">${saved.map(makeTile).join("")}</div></div>`;
    }
    grid.innerHTML = html;

    const skeleton = document.getElementById("entrySkeleton");
    if (skeleton) skeleton.style.display = "none";
    grid.style.display = "";
}

// ── Entry-tile ⋮ menu: rename / delete ───────────────────────────────────────

window.toggleEntryItemMenu = function (event, id) {
    event.stopPropagation();
    const menu = document.getElementById(`entryItemMenu-${id}`);
    if (!menu) return;
    const wasOpen = menu.classList.contains("open");
    closeAllEntryItemMenus();
    if (!wasOpen) menu.classList.add("open");
};

function closeAllEntryItemMenus() {
    document.querySelectorAll(".entry-item-menu.open").forEach((m) => m.classList.remove("open"));
}

function setupEntryItemMenuListeners() {
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".entry-item-more-wrap")) closeAllEntryItemMenus();
    });
}

window.renameEntryItem = async function (event, id) {
    event.stopPropagation();
    closeAllEntryItemMenus();
    const items = _readUserItems();
    const idx = items.findIndex((r) => r.id === id);
    const draft = idx < 0 ? readEditorDrafts().find((r) => r.id === id) : null;
    if (idx < 0 && !draft) return;
    const row = draft || items[idx];

    const next = await _prompt("اسم الدرس الجديد:", row.meta?.title || "");
    if (next === null || next === undefined) return;
    const title = String(next).trim();
    if (!title) {
        showNotification("تنبيه", "اسم الدرس لا يمكن أن يكون فارغاً.", "warning");
        return;
    }
    // Only a saved lesson takes part in the same-level naming rule; a draft
    // has no permanent name yet.
    if (
        row.meta?.type === LESSON_TYPE &&
        hasLessonLevelCollision(items, { title, parentId: row.meta?.parentId || null, excludeId: id })
    ) {
        showNotification("تنبيه", "يوجد درس بنفس الاسم في هذا المستوى من امتحاناتك بالفعل.", "warning");
        return;
    }
    const updated = { ...row, meta: { ...row.meta, title, updatedAt: new Date().toISOString() } };
    if (draft) upsertEditorDraft(updated);
    else {
        items[idx] = updated;
        _writeUserItems(items);
    }
    renderEntryItemsGrid();
};

window.deleteEntryItem = async function (event, id) {
    event.stopPropagation();
    closeAllEntryItemMenus();
    const items = _readUserItems();
    const draft = readEditorDrafts().find((r) => r.id === id);
    const row = draft || items.find((r) => r.id === id);
    if (!row) return;
    const isDraft = row.meta?.type === LESSON_DRAFT_TYPE;
    const ok = await _confirm(
        isDraft ? "هل تريد حذف هذه المسودة نهائياً؟" : "هل تريد حذف هذا الدرس نهائياً؟",
    );
    if (!ok) return;
    if (draft) removeEditorDraft(id);
    else _writeUserItems(items.filter((r) => r.id !== id));
    renderEntryItemsGrid();
};

// ── Entry actions ─────────────────────────────────────────────────────────────

window.chooseEntryAction = function (action) {
    if (action === "new") {
        startNewLesson();
    } else if (action === "exit") {
        // The title-bar "back" button: autosave already persisted the work.
        showEntryScreen();
    }
};

function startNewLesson() {
    lessonData = emptyLessonData();
    currentDraftId = null;
    editingLessonId = null;
    resetHistory();
    renderLessonForm();
    showLessonForm();
    // Persist immediately so the draft appears in "المسودات" even if the user
    // leaves before typing anything.
    autosave();
}

window.chooseUserLessonToEdit = function (id) {
    if (!openLessonById(id)) {
        showNotification("خطأ", "تعذّر العثور على هذا الدرس.", "error");
        renderEntryItemsGrid();
    }
};

/**
 * Loads a stored row (draft or saved lesson) into the editor.
 * @returns {boolean} false if the id isn't a lesson/draft-lesson row.
 */
function openLessonById(id) {
    const row = readEditorDrafts().find((r) => r.id === id) || _readUserItems().find((r) => r.id === id);
    if (!row || (row.meta?.type !== LESSON_TYPE && row.meta?.type !== LESSON_DRAFT_TYPE)) return false;

    const normalized = normalizeLessonContent(row.lesson);
    const prefs = row.meta?.readerPrefs || {};
    lessonData = {
        title: row.meta?.title || "",
        fontId: prefs.fontId || "default",
        highlightId: prefs.highlightId || "yellow",
        sections: normalized.sections.length
            ? normalized.sections.map((s) => ({
                id: s.id,
                title: s.title,
                defaultHidden: s.defaultHidden,
                blocks: s.blocks.map(hydrateBlock),
            }))
            : [{ id: newLocalId("s"), title: "", defaultHidden: false, blocks: [] }],
    };

    if (row.meta.type === LESSON_DRAFT_TYPE) {
        currentDraftId = id;
        editingLessonId = null;
    } else {
        editingLessonId = id;
        currentDraftId = null;
    }

    resetHistory();
    renderLessonForm();
    showLessonForm();
    return true;
}

/** Give a stored block its editor-only _localId (and fill defaults). */
function hydrateBlock(block) {
    const b = { ...block, _localId: newLocalId("b") };
    if (b.type === "question") {
        if (b.questionKind === "essay") {
            b.questionKind = "essay";
            b.modelAnswer = b.modelAnswer || "";
            delete b.options;
            delete b.correctIndex;
        } else {
            b.questionKind = "mcq";
            b.options = Array.isArray(b.options) && b.options.length >= 2 ? [...b.options] : ["", ""];
            b.correctIndex = Number.isInteger(b.correctIndex) ? b.correctIndex : 0;
            b.multiSelect = Boolean(b.multiSelect);
            b.correctIndexes = b.multiSelect && Array.isArray(b.correctIndexes) && b.correctIndexes.length
                ? b.correctIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < b.options.length)
                : [b.correctIndex];
        }
    }
    return b;
}

// =============================================================================
// APP-BAR TITLE — click-to-rename (the ONLY place the lesson title is set)
// =============================================================================

function updateAppTitleBar() {
    const el = document.getElementById("appTitleText");
    if (el && el.getAttribute("contenteditable") !== "true") {
        el.textContent = lessonData.title?.trim() || "درس بدون عنوان";
    }
}

window.startTitleEdit = function () {
    const el = document.getElementById("appTitleText");
    if (!el) return;
    el.setAttribute("contenteditable", "true");
    el.textContent = lessonData.title || "";
    el.classList.add("editing");
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
};

window.commitTitleEdit = function () {
    const el = document.getElementById("appTitleText");
    if (!el || el.getAttribute("contenteditable") !== "true") return;
    el.setAttribute("contenteditable", "false");
    el.classList.remove("editing");

    const next = el.textContent.trim().slice(0, 200);
    if (next !== lessonData.title) {
        // Unlike a quiz's mirrored #quizTitle input, this contenteditable
        // span IS the only place lessonData.title is ever set (see the
        // section header above) — so a commit here is a single discrete
        // rename, not a per-keystroke edit. It needs its own snapshot the
        // same as any other one-shot structural change (addSection,
        // toggleSectionDefaultHidden, etc.), or renaming the lesson is
        // silently unrecoverable via Ctrl+Z.
        pushHistorySnapshot();
        lessonData.title = next;
        autosave();
    }
    updateAppTitleBar();
};

window.handleTitleEditKeydown = function (event) {
    const el = document.getElementById("appTitleText");
    if (event.key === "Enter") {
        event.preventDefault();
        el?.blur();
    } else if (event.key === "Escape") {
        event.preventDefault();
        if (el) {
            el.setAttribute("contenteditable", "false");
            el.classList.remove("editing");
            updateAppTitleBar();
            el.blur();
        }
    }
};

// =============================================================================
// Markdown field primitives
// =============================================================================

// =============================================================================
// MARKDOWN FIELD PRIMITIVES (ported from create-quiz.js)
// =============================================================================
// Every text field in the editor (a markdown block, a question prompt, an
// option, an explanation, an essay model answer) is the same `.md-source`
// textarea create-quiz uses, so the ONE global bar formats all of them and
// the same drag/drop/paste media embedding works everywhere.

/** HTML for one markdown field. `id` must be unique on the page. */
function mdEditorHtml(id, value, placeholder, rows = 2) {
    const escaped = String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    return `
    <div class="wp-field" id="wrap-${id}">
      <div class="wp-pane-wrap">
        <textarea class="md-source wp-textarea" dir="auto" id="${id}" rows="${rows}" placeholder="${escapeHtml(placeholder)}">${escaped}</textarea>
        <div class="wp-preview-pane ltr md-content" id="preview-${id}" style="display:none;"></div>
      </div>
    </div>`;
}

/** AI-chat-style growing textarea: grows with content up to a cap, then scrolls. */
function autoResizeMdSource(ta, minPx = 40, maxPx = 320) {
    ta.style.height = "auto";
    const next = Math.min(Math.max(ta.scrollHeight, minPx), maxPx);
    ta.style.height = next + "px";
    ta.style.overflowY = ta.scrollHeight > maxPx ? "auto" : "hidden";
}

/**
 * Replace [start, end) of a textarea with `text` WITHOUT wiping the browser's
 * native Ctrl+Z history (setting .value directly clears it in every browser;
 * execCommand("insertText") goes through the real input pipeline instead).
 */
function replaceTextareaRange(ta, start, end, text) {
    ta.focus();
    ta.setSelectionRange(start, end);
    const ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
    if (!ok) {
        const value = ta.value;
        ta.value = value.slice(0, start) + text + value.slice(end);
        ta.setSelectionRange(start + text.length, start + text.length);
    }
}

/** Wire one textarea: auto-resize, onChange, and media drop/paste embedding. */
function setupMdField(id, onChange, { minPx = 40, maxPx = 320 } = {}) {
    const source = document.getElementById(id);
    if (!source) return;
    autoResizeMdSource(source, minPx, maxPx);
    source.addEventListener("input", () => {
        autoResizeMdSource(source, minPx, maxPx);
        if (onChange) onChange(source.value);
    });
    setupMarkdownMediaDropzone(source, onChange);
}

// =============================================================================
// GLOBAL MARKDOWN + LATEX BAR (#globalMdBar) — one bar for every .md-source
// =============================================================================

let _activeMdSource = null;
// Highlight picker state — see setupGlobalMdBar().
let _highlightPicker = null;
let _highlightSavedSelection = null;

function _trackMdSourceFocus() {
    document.addEventListener(
        "focusin",
        (e) => {
            if (e.target.classList?.contains("md-source")) _activeMdSource = e.target;
        },
        true,
    );
}

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
    _gmdTipTimer = setTimeout(() => _gmdTipEl?.classList.remove("visible"), 2000);
}

/**
 * Apply a markdown command or insert a LaTeX snippet into the active field.
 * @param {string|null} cmd
 * @param {string|null} latex  raw LaTeX (when cmd is null)
 * @param {string|null} extra  heading level, or a highlight color for cmd "highlight"
 */
function applyGlobalMdAction(cmd, latex = null, extra = null) {
    const ta = _activeMdSource;
    if (!ta || !document.body.contains(ta)) {
        _showNoFieldTip();
        return;
    }

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const selected = value.slice(start, end);

    const wrap = (prefix, suffix = prefix, placeholder = "") => {
        const text = selected || placeholder;
        replaceTextareaRange(ta, start, end, prefix + text + suffix);
        const cs = start + prefix.length;
        ta.setSelectionRange(cs, cs + text.length);
    };

    const linePrefix = (prefix) => {
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const lineEnd = end || lineStart;
        const affected = value.slice(lineStart, lineEnd);
        const newLines = (affected || "")
            .split("\n")
            .map((line) => (line.startsWith(prefix) ? line : prefix + line))
            .join("\n");
        replaceTextareaRange(ta, lineStart, lineEnd, newLines);
        ta.setSelectionRange(lineStart, lineStart + newLines.length);
    };

    if (latex !== null) {
        // Raw LaTeX must be wrapped in $…$ or the KaTeX auto-render pass has no
        // delimiter to find and leaves the source showing as plain text.
        const snippet = selected ? selected + latex : latex;
        const inserted = `$${snippet}$`;
        replaceTextareaRange(ta, start, end, inserted);
        const braceIdx = inserted.indexOf("{}");
        const pos = braceIdx !== -1 ? start + braceIdx + 1 : start + inserted.length - 1;
        ta.setSelectionRange(pos, pos);
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
                const level = Math.min(Math.max(Number(extra) || 3, 1), 6);
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
                const urlStart = start + text.length + 3;
                ta.setSelectionRange(urlStart, urlStart + "https://".length);
                break;
            }
            case "table": {
                const rows = "| العمود 1 | العمود 2 |\n| --- | --- |\n| قيمة | قيمة |";
                const needsNl = start > 0 && value[start - 1] !== "\n";
                const ins = (needsNl ? "\n" : "") + rows;
                replaceTextareaRange(ta, start, end, ins);
                const pos = start + ins.length;
                ta.setSelectionRange(pos, pos);
                break;
            }
            case "inlinemath": wrap("$", "$", "math"); break;
            case "blockmath": wrap("$$", "$$", "math"); break;
            case "highlight": {
                // DYNAMIC PER-SPAN COLOR. Emits `==text==(color)`, which
                // markdown.js's applyInline() turns into a span carrying its
                // OWN --md-highlight-color — so different words in the SAME
                // lesson can each get a different color. Only the swatch the
                // author picks decides the color; nothing here is page-wide.
                const text = selected || "نص مظلل";
                const color = typeof extra === "string" ? extra : "";
                const suffix = color ? `(${color})` : "";
                replaceTextareaRange(ta, start, end, `==${text}==${suffix}`);
                const cs = start + 2;
                ta.setSelectionRange(cs, cs + text.length);
                break;
            }
        }
    }

    ta.focus();
    autoResizeMdSource(ta);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Drops an empty <img>/<video>/<audio> tag at the cursor for the author to paste a link into. */
function triggerMediaInsertForActiveField(mediaType) {
    const ta = _activeMdSource;
    if (!ta || !document.body.contains(ta)) {
        _showNoFieldTip();
        return;
    }
    const tag =
        mediaType === "image"
            ? `<img width="400" height="400" alt="" src="" />`
            : `<${mediaType} src=""></${mediaType}>`;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    replaceTextareaRange(ta, start, end, tag);
    autoResizeMdSource(ta);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const srcIdx = tag.indexOf('src=""') + 5;
    ta.setSelectionRange(start + srcIdx, start + srcIdx);
    ta.focus();
}

// ── Roving-tabindex keyboard nav for the bar's role="menu" dropdowns ─────────

function _gmdMenuItems(menuEl) {
    return Array.from(menuEl.querySelectorAll(":scope > button"));
}

function _focusRovingItem(items, index) {
    if (!items.length) return;
    const clamped = (index + items.length) % items.length;
    items.forEach((item, i) => item.setAttribute("tabindex", i === clamped ? "0" : "-1"));
    items[clamped].focus();
}

function activateMenuKeyboardNav(menuEl, onClose) {
    if (!menuEl) return;
    if (!menuEl.dataset.rovingNavReady) {
        menuEl.dataset.rovingNavReady = "1";
        menuEl.addEventListener("keydown", (e) => {
            const items = _gmdMenuItems(menuEl);
            if (!items.length) return;
            const cur = items.indexOf(document.activeElement);
            if (e.key === "ArrowDown") { e.preventDefault(); _focusRovingItem(items, cur === -1 ? 0 : cur + 1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); _focusRovingItem(items, cur === -1 ? items.length - 1 : cur - 1); }
            else if (e.key === "Home") { e.preventDefault(); _focusRovingItem(items, 0); }
            else if (e.key === "End") { e.preventDefault(); _focusRovingItem(items, items.length - 1); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose?.(); }
            else if (e.key === "Tab") { onClose?.(); }
        });
    }
    const items = _gmdMenuItems(menuEl);
    items.forEach((item, i) => item.setAttribute("tabindex", i === 0 ? "0" : "-1"));
    items[0]?.focus();
}

function positionGmdDropdown(toggle, menu) {
    const rect = toggle.getBoundingClientRect();
    menu.style.visibility = "hidden";
    menu.style.display = "flex";
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = "0px";
    const menuWidth = menu.offsetWidth;
    let left = rect.right - menuWidth; // RTL: align the menu's right edge to the toggle's
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    menu.style.left = `${left}px`;
    menu.style.display = "";
    menu.style.visibility = "";
}

function closeAllGmdDropdowns() {
    document.querySelectorAll("#globalMdBar .gmd-dropdown-menu.open").forEach((m) => {
        m.classList.remove("open");
        const toggle = m.previousElementSibling;
        if (toggle?.classList.contains("gmd-dropdown-toggle")) toggle.setAttribute("aria-expanded", "false");
    });
}

function setupGlobalMdBar() {
    _trackMdSourceFocus();

    const bar = document.getElementById("globalMdBar");
    if (!bar) return;

    // Keep the textarea focused (and its selection intact) while a bar button
    // is pressed — a mousedown on a button would otherwise blur the field and
    // collapse the selection before the click handler reads it.
    bar.addEventListener("mousedown", (e) => {
        if (e.target.closest(".gmd-btn")) e.preventDefault();
    });

    bar.querySelectorAll(".gmd-btn:not(.gmd-dropdown-toggle)").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const cmd = btn.dataset.gmdCmd || null;
            if (cmd === "image" || cmd === "video" || cmd === "audio") {
                triggerMediaInsertForActiveField(cmd);
                closeAllGmdDropdowns();
                return;
            }
            const latex = btn.dataset.gmdLatex !== undefined ? btn.dataset.gmdLatex : null;
            // `extra` doubles as the heading level OR the highlight swatch color.
            const extra = btn.dataset.gmdHeading || btn.dataset.gmdColor || null;
            applyGlobalMdAction(cmd, latex, extra);
            closeAllGmdDropdowns();
        });
    });

    // Highlight color picker (Google-Docs-style palette + custom + eyedropper).
    // The picker's own controls are .cp-* elements, deliberately NOT .gmd-btn,
    // so the generic command-button handler above never sees them.
    //
    // Selection safety: bar-level mousedown preventDefault (above) keeps the
    // textarea focused for palette clicks, but the picker also contains a
    // text field (#RRGGBB) and a native color input, which MUST be allowed to
    // take focus/opening. Taking focus blurs the textarea, and although a
    // textarea keeps its selectionStart/End after blur, the picker's own
    // interactions could still move it in some browsers — so the range is
    // captured when the menu opens and restored right before applying.
    const highlightMenu = document.getElementById("gmdHighlightMenu");
    if (highlightMenu) {
        highlightMenu.addEventListener("mousedown", (e) => e.stopPropagation());
        _highlightPicker = mountColorPicker(
            highlightMenu,
            (hex) => {
                const ta = _highlightSavedSelection?.ta;
                if (ta && document.body.contains(ta)) {
                    _activeMdSource = ta;
                    ta.focus();
                    ta.setSelectionRange(_highlightSavedSelection.start, _highlightSavedSelection.end);
                }
                applyGlobalMdAction("highlight", null, hex);
            },
            closeAllGmdDropdowns,
            () => {
                closeAllGmdDropdowns();
                document.getElementById("gmdHighlightToggle")?.focus();
            },
        );
    }

    bar.querySelectorAll(".gmd-dropdown-toggle").forEach((toggle) => {
        toggle.setAttribute("aria-haspopup", "true");
        toggle.setAttribute("aria-expanded", "false");
        const menu = toggle.nextElementSibling;
        menu?.querySelectorAll(".gmd-btn").forEach((b) => b.setAttribute("role", "menuitem"));
        toggle.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const m = toggle.nextElementSibling;
            if (!m) return;
            const isOpen = m.classList.contains("open");
            closeAllGmdDropdowns();
            if (!isOpen) {
                if (m.id === "gmdHighlightMenu") {
                    const ta = _activeMdSource;
                    _highlightSavedSelection =
                        ta && document.body.contains(ta)
                            ? { ta, start: ta.selectionStart, end: ta.selectionEnd }
                            : null;
                    _highlightPicker?.refresh();
                }
                positionGmdDropdown(toggle, m);
                m.classList.add("open");
                toggle.setAttribute("aria-expanded", "true");
                if (m.id === "gmdHighlightMenu") {
                    // The picker owns its keyboard handling (2D grid nav, free
                    // Tab to the hex field). Only move focus in when the menu
                    // was opened from the keyboard (Enter/Space fire a click
                    // with detail === 0); a mouse click must leave the focus —
                    // and the caret — in the textarea.
                    if (e.detail === 0) _highlightPicker?.focusFirst();
                } else {
                    activateMenuKeyboardNav(m, () => {
                        closeAllGmdDropdowns();
                        toggle.focus();
                    });
                }
                _armMenuOpenGuard();
            }
        });
    });

    bar.addEventListener("scroll", () => {
        if (Date.now() - _lastMenuOpenAt < 350) return;
        closeAllGmdDropdowns();
    });
    window.addEventListener("resize", closeAllGmdDropdowns);
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".gmd-dropdown")) closeAllGmdDropdowns();
    });
}

// =============================================================================
// READER DEFAULTS — font + highlight, now living in the Markdown bar
// =============================================================================
// Formerly two <select>s in the (removed) `.lesson-metadata` card. They belong
// with the other text-formatting controls, so they're injected into the bar as
// a small group: a font dropdown, and a "default highlight" dropdown. These
// are the author's OPTIONAL reader defaults (saved as reader_prefs_default);
// the per-word colors come from the ==text==(color) swatches above instead.

function setupReaderDefaultsBar() {
    const bar = document.getElementById("globalMdBar");
    if (!bar || document.getElementById("gmdReaderDefaults")) return;

    const group = document.createElement("div");
    group.className = "gmd-group gmd-group-reader";
    group.id = "gmdReaderDefaults";

    const sep = document.createElement("div");
    sep.className = "gmd-separator";
    sep.setAttribute("aria-hidden", "true");

    const fontSelect = document.createElement("select");
    fontSelect.id = "lessonFontSelect";
    fontSelect.className = "gmd-select";
    fontSelect.title = "الخط الافتراضي للقارئ";
    fontSelect.setAttribute("aria-label", "الخط الافتراضي للقارئ");
    fontSelect.innerHTML = FONT_CHOICES.map(
        (f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.label)}</option>`,
    ).join("");

    fontSelect.addEventListener("change", () => {
        pushHistorySnapshot();
        lessonData.fontId = fontSelect.value || "default";
        autosave();
    });

    group.append(fontSelect);
    bar.append(sep, group);
}

function syncReaderDefaultsBar() {
    // Only the font <select> exists in the bar (the per-word highlight color
    // comes from the ==text==(color) picker, not a reader-default control).
    const f = document.getElementById("lessonFontSelect");
    if (f) f.value = lessonData.fontId || "default";
}

// =============================================================================
// MEDIA — upload (admin only, like create-quiz) + drag/drop/paste embedding
// =============================================================================

const MEDIA_MIME_MAP = {
    image: new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]),
    audio: new Set(["audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/aac", "audio/x-m4a", "audio/mp4"]),
    video: new Set(["video/mp4", "video/webm", "video/ogg"]),
};
const MEDIA_MAX_SIZE = { image: 5 * 1024 * 1024, audio: 10 * 1024 * 1024, video: 50 * 1024 * 1024 };
const MEDIA_TYPE_LABELS = { image: "الصور", audio: "الملفات الصوتية", video: "الفيديو" };
const MEDIA_EXT_MAP = {
    "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg",
    "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav", "audio/webm": "webm", "audio/aac": "aac",
    "audio/x-m4a": "m4a", "audio/mp4": "m4a",
    "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv",
};

function detectMediaTypeFromFile(file) {
    if (!file || !file.type) return null;
    for (const type of ["image", "audio", "video"]) {
        if (MEDIA_MIME_MAP[type].has(file.type)) return type;
    }
    return null;
}

function detectMediaTypeFromUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    if (/(?:youtube\.com|youtu\.be)/i.test(url)) return "video";
    const path = url.split(/[?#]/)[0].toLowerCase();
    if (/\.(jpe?g|png|gif|webp|svg)$/.test(path)) return "image";
    if (/\.(mp3|ogg|wav|aac|m4a)$/.test(path)) return "audio";
    if (/\.(mp4|webm|ogv)$/.test(path)) return "video";
    return null;
}

/** Downscale + re-encode as JPEG; returns the smaller of {compressed, original}. */
async function compressImageFile(file, { maxDim = 1600, quality = 0.82, qualityFloor = 0.6 } = {}) {
    if (!file || !file.type) return file;
    if (file.type === "image/svg+xml" || file.type === "image/gif") return file;
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch (err) {
        console.warn("[create-lesson] image decode failed, using original", err);
        return file;
    }
    try {
        const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
        const blob = await new Promise((resolve) =>
            canvas.toBlob((b) => resolve(b), "image/jpeg", Math.max(quality, qualityFloor)),
        );
        if (!blob || blob.size >= file.size) return file;
        const baseName = file.name ? file.name.replace(/\.[^.]+$/, "") : "image";
        return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    } catch (err) {
        console.warn("[create-lesson] image compression failed, using original", err);
        return file;
    } finally {
        bitmap.close?.();
    }
}

function buildMediaHtmlTag(mediaType, url, opts = {}) {
    const esc = (v) => String(v ?? "").replace(/"/g, "&quot;");
    if (mediaType === "image") {
        const dims = (opts.width ? ` width="${opts.width}"` : "") + (opts.height ? ` height="${opts.height}"` : "");
        return `<img${dims} alt="${esc(opts.alt ?? "صورة توضيحية")}" src="${esc(url)}" />`;
    }
    return `<${mediaType} src="${esc(url)}"></${mediaType}>`;
}

/** Same "quiz-media" bucket + per-user path + compression as create-quiz.js. */
async function uploadMediaFile(file, mediaType) {
    let workingFile = file;
    let dims = null;
    if (mediaType === "image") {
        workingFile = await compressImageFile(workingFile);
        try {
            const bitmap = await createImageBitmap(workingFile);
            dims = { width: bitmap.width, height: bitmap.height };
            bitmap.close?.();
        } catch {
            dims = null;
        }
    }
    if (workingFile.size > MEDIA_MAX_SIZE[mediaType]) {
        const maxMb = MEDIA_MAX_SIZE[mediaType] / (1024 * 1024);
        throw new Error(`الحد الأقصى لـ ${MEDIA_TYPE_LABELS[mediaType]} هو ${maxMb} ميجابايت.`);
    }
    if (workingFile.size === 0) throw new Error("الملف المحدد فارغ.");

    const client = await ensureSharedSupabaseClient();
    if (!client) throw new Error("تعذّر الاتصال بـ Supabase. حاول تسجيل الخروج والدخول مجدداً.");
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) throw new Error("جلسة Supabase منتهية. أعد تسجيل الدخول.");

    const uid = sessionData.session.user.id;
    const ext = MEDIA_EXT_MAP[workingFile.type] || "bin";
    const random = Math.random().toString(36).slice(2, 9);
    const storagePath = `${mediaType}s/${uid}/${Date.now()}-${random}.${ext}`;

    const { error: uploadError } = await client.storage
        .from("quiz-media")
        .upload(storagePath, workingFile, { contentType: workingFile.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: urlData } = client.storage.from("quiz-media").getPublicUrl(storagePath);
    if (!urlData?.publicUrl) throw new Error("تم الرفع لكن فشل توليد الرابط.");
    return { url: urlData.publicUrl, dims };
}

/** GitHub-style: insert a placeholder, upload in the background, swap in the tag. */
async function handleMarkdownMediaFile(textarea, file, onChange) {
    // Uploading into the shared bucket is admin-only (same rule as create-quiz);
    // everyone can still paste a link.
    if (!isAdmin) {
        showNotification(
            "غير مسموح",
            "رفع الملفات متاح للمشرفين فقط. الصق رابط الملف مباشرة بدلاً من ذلك.",
            "error",
        );
        return;
    }
    const mediaType = detectMediaTypeFromFile(file);
    if (!mediaType) {
        showNotification(
            "نوع غير مدعوم",
            `نوع الملف (${file.type || "غير معروف"}) غير مدعوم. الأنواع المدعومة: صور، صوت، فيديو.`,
            "error",
        );
        return;
    }

    const uploadTag = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const placeholder = `![Uploading ${uploadTag}…]()`;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    replaceTextareaRange(textarea, start, end, placeholder);
    autoResizeMdSource(textarea);
    if (onChange) onChange(textarea.value);

    const replacePlaceholder = (replacement) => {
        const idx = textarea.value.indexOf(placeholder);
        if (idx === -1) return;
        replaceTextareaRange(textarea, idx, idx + placeholder.length, replacement);
        autoResizeMdSource(textarea);
        if (onChange) onChange(textarea.value);
    };

    try {
        const { url, dims } = await uploadMediaFile(file, mediaType);
        replacePlaceholder(buildMediaHtmlTag(mediaType, url, { width: dims?.width, height: dims?.height, alt: file.name }));
    } catch (err) {
        console.error("[handleMarkdownMediaFile]", err);
        replacePlaceholder("");
        showNotification("خطأ في الرفع", err.message || "حدث خطأ أثناء رفع الملف.", "error");
    }
}

/** Drag/drop + paste media handling for one .md-source textarea. */
function setupMarkdownMediaDropzone(textarea, onChange) {
    let dragDepth = 0;

    textarea.addEventListener("dragenter", (e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        dragDepth++;
        textarea.classList.add("md-source--drag-active");
    });
    textarea.addEventListener("dragover", (e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
    });
    textarea.addEventListener("dragleave", () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) textarea.classList.remove("md-source--drag-active");
    });
    textarea.addEventListener("drop", (e) => {
        const files = e.dataTransfer?.files;
        if (!files || !files.length) return;
        e.preventDefault();
        dragDepth = 0;
        textarea.classList.remove("md-source--drag-active");
        Array.from(files).forEach((f) => handleMarkdownMediaFile(textarea, f, onChange));
    });

    textarea.addEventListener("paste", (e) => {
        // Case 1: an actual file/screenshot on the clipboard.
        const fileItems = Array.from(e.clipboardData?.items || []).filter((i) => i.kind === "file");
        if (fileItems.length) {
            e.preventDefault();
            fileItems.forEach((item) => {
                const f = item.getAsFile();
                if (f) handleMarkdownMediaFile(textarea, f, onChange);
            });
            return;
        }
        const text = e.clipboardData?.getData("text/plain");
        if (!text) return;
        const trimmed = text.trim();

        // Case 2: a bare media URL (YouTube / direct image / audio / video link).
        const mediaType = detectMediaTypeFromUrl(trimmed);
        if (mediaType) {
            e.preventDefault();
            replaceTextareaRange(textarea, textarea.selectionStart, textarea.selectionEnd, buildMediaHtmlTag(mediaType, trimmed));
            autoResizeMdSource(textarea);
            if (onChange) onChange(textarea.value);
            return;
        }

        // Case 3: a raw <img>/<video>/<audio> snippet ("copy image").
        if (/^<(img|video|audio|source)\b[^>]*\bsrc=["'][^"']*["'][^>]*>/i.test(trimmed)) {
            e.preventDefault();
            replaceTextareaRange(textarea, textarea.selectionStart, textarea.selectionEnd, trimmed);
            autoResizeMdSource(textarea);
            if (onChange) onChange(textarea.value);
        }
    });
}

// =============================================================================
// KEYBOARD SHORTCUTS
// =============================================================================

function isTextEditableElement(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
        // Only active while the editor (not the entry grid) is showing.
        if (!document.body.classList.contains("lesson-form-active")) return;

        // Alt+N: new section. Physical key (e.code) so it works on Arabic layouts.
        if (e.altKey && e.code === "KeyN") {
            e.preventDefault();
            window.addSection();
        }

        // Ctrl+S: save.
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            window.saveLesson();
        }

        // Ctrl+P: preview.
        if ((e.ctrlKey || e.metaKey) && e.key === "p") {
            e.preventDefault();
            window.previewLesson();
        }

        // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z — structural undo/redo. Skipped inside
        // text fields so the field's own native undo handles text edits.
        const inText = isTextEditableElement(e.target);
        if (!inText && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
            e.preventDefault();
            window.performUndo();
        }
        if (!inText && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
            e.preventDefault();
            window.performRedo();
        }
    });
}

// =============================================================================
// RENDERING THE LESSON FORM
// =============================================================================

function renderLessonForm() {
    updateAppTitleBar();
    syncReaderDefaultsBar();
    renderSections();
    updateSectionNavigator();
}

/**
 * Re-renders every section card. Any unsaved text sitting in a focused field
 * is already in lessonData (fields write through on every input event), so a
 * full re-render never loses typing.
 */
function renderSections() {
    const container = document.getElementById("sectionsContainer");
    if (!container) return;
    container.innerHTML = lessonData.sections.map((s, i) => sectionCardHtml(s, i)).join("");
    lessonData.sections.forEach((section) => {
        section.blocks.forEach((block) => wireBlock(section.id, block));
    });
}

function sectionCardHtml(section, index) {
    const sid = escapeHtml(section.id);
    const isFirst = index === 0;
    const isLast = index === lessonData.sections.length - 1;
    const icon = (d) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    return `
    <div class="lesson-section-card" id="section-${sid}" data-section-id="${sid}">
      <div class="lesson-section-card-header">
        <div class="lesson-section-title-group">
          <span class="lesson-section-index">${index + 1}</span>
          <input type="text" class="form-input lesson-section-title-input" placeholder="عنوان القسم (اختياري)"
            value="${escapeHtml(section.title)}" maxlength="200" oninput="updateSectionTitle('${sid}', this.value)">
        </div>
        <div class="lesson-section-actions">
          <label class="lesson-section-hidden-toggle" title="إخفاء هذا القسم افتراضياً حتى يُكشف بشرط">
            <input type="checkbox" ${section.defaultHidden ? "checked" : ""} onchange="toggleSectionDefaultHidden('${sid}', this.checked)">
            <span>مخفي افتراضياً</span>
          </label>
          <button type="button" class="lesson-icon-btn" title="نقل لأعلى" ${isFirst ? "disabled" : ""} onclick="moveSection('${sid}', -1)">${icon('<path d="m18 15-6-6-6 6"/>')}</button>
          <button type="button" class="lesson-icon-btn" title="نقل لأسفل" ${isLast ? "disabled" : ""} onclick="moveSection('${sid}', 1)">${icon('<path d="m6 9 6 6 6-6"/>')}</button>
          <button type="button" class="lesson-icon-btn" title="مضاعفة القسم" onclick="duplicateSection('${sid}')">${icon('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>')}</button>
          <button type="button" class="lesson-icon-btn lesson-icon-btn-danger" title="حذف القسم" onclick="removeSection('${sid}')">${icon('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')}</button>
        </div>
      </div>

      <div class="lesson-blocks-list">
        ${section.blocks.map((b, i) => blockCardHtml(section.id, b, i, section.blocks.length)).join("")}
      </div>

      <div class="lesson-add-block-row">
        <button type="button" class="btn btn-secondary btn-sm" onclick="addBlock('${sid}', 'markdown')">+ نص</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addBlock('${sid}', 'media')">+ وسائط</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addBlock('${sid}', 'quizRef')">+ امتحان مرتبط</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addBlock('${sid}', 'question')">+ سؤال مدمج</button>
      </div>
    </div>`;
}

// =============================================================================
// SECTION CRUD
// =============================================================================

function findSection(sectionId) {
    return lessonData.sections.find((s) => s.id === sectionId) || null;
}

function findBlock(sectionId, localId) {
    return findSection(sectionId)?.blocks.find((b) => b._localId === localId) || null;
}

window.addSection = function () {
    pushHistorySnapshot();
    lessonData.sections.push({ id: newLocalId("s"), title: "", defaultHidden: false, blocks: [] });
    renderSections();
    updateSectionNavigator();
    autosave();
    const last = lessonData.sections[lessonData.sections.length - 1];
    document.getElementById(`section-${last.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
};

// Per-keystroke title edits are NOT snapshotted (see the undo/redo header).
window.updateSectionTitle = function (sectionId, value) {
    const section = findSection(sectionId);
    if (!section) return;
    section.title = value;
    updateSectionNavigator();
    refreshAllRuleDropdowns();
    autosave();
};

window.toggleSectionDefaultHidden = function (sectionId, checked) {
    const section = findSection(sectionId);
    if (!section) return;
    pushHistorySnapshot();
    section.defaultHidden = checked;
    updateSectionNavigator();
    autosave();
};

window.moveSection = function (sectionId, delta) {
    const idx = lessonData.sections.findIndex((s) => s.id === sectionId);
    const target = idx + delta;
    if (idx === -1 || target < 0 || target >= lessonData.sections.length) return;
    pushHistorySnapshot();
    [lessonData.sections[idx], lessonData.sections[target]] = [lessonData.sections[target], lessonData.sections[idx]];
    renderSections();
    updateSectionNavigator();
    autosave();
};

window.duplicateSection = function (sectionId) {
    const idx = lessonData.sections.findIndex((s) => s.id === sectionId);
    if (idx === -1) return;
    pushHistorySnapshot();
    const src = lessonData.sections[idx];
    const copy = {
        id: newLocalId("s"),
        title: src.title ? `${src.title} (نسخة)` : "",
        defaultHidden: src.defaultHidden,
        // Fresh block + question ids: question ids must stay unique across the
        // whole lesson (validator + reader progress both key off them), and a
        // copied reveal rule would still point at the ORIGINAL target section.
        blocks: src.blocks.map((b) => {
            const clone = JSON.parse(JSON.stringify(b));
            clone._localId = newLocalId("b");
            if (clone.type === "question") clone.id = newLocalId("q");
            return clone;
        }),
    };
    lessonData.sections.splice(idx + 1, 0, copy);
    renderSections();
    updateSectionNavigator();
    autosave();
};

window.removeSection = async function (sectionId) {
    if (lessonData.sections.length <= 1) {
        showNotification("تنبيه", "يجب أن يبقى قسم واحد على الأقل في الدرس.", "warning");
        return;
    }
    if (!(await _confirm("هل تريد حذف هذا القسم وكل محتواه؟"))) return;
    pushHistorySnapshot();
    lessonData.sections = lessonData.sections.filter((s) => s.id !== sectionId);
    // Clear reveal rules elsewhere that pointed at the deleted section, so a
    // save never carries a dangling revealSection.
    for (const section of lessonData.sections) {
        for (const block of section.blocks) {
            if (block.type !== "question") continue;
            if (block.onWrong?.revealSection === sectionId) delete block.onWrong;
            if (block.onCorrect?.revealSection === sectionId) delete block.onCorrect;
        }
    }
    renderSections();
    updateSectionNavigator();
    autosave();
};

// =============================================================================
// SECTION NAVIGATOR (sidebar widget)
// =============================================================================

function updateSectionNavigator() {
    const panel = document.getElementById("createLessonSectionNavPanel");
    const count = document.getElementById("createLessonSectionNavCount");
    if (!panel || !count) return;
    count.textContent = String(lessonData.sections.length);
    panel.innerHTML = lessonData.sections
        .map(
            (s, i) =>
                `<button type="button" class="create-question-nav-item${s.defaultHidden ? " incomplete" : ""}" title="${escapeHtml(s.title || `قسم ${i + 1}`)}" onclick="scrollToSection('${escapeHtml(s.id)}')">${i + 1}</button>`,
        )
        .join("");
}

window.scrollToSection = function (sectionId) {
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

function setupSectionNavigatorToggle() {
    document.addEventListener("click", (event) => {
        const toggle = event.target.closest("#createLessonSectionNavToggle");
        if (!toggle) return;
        const nav = document.getElementById("createLessonSectionNav");
        const panel = document.getElementById("createLessonSectionNavPanel");
        const isOpen = nav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(isOpen));
        panel.hidden = !isOpen;
    });
}

// =============================================================================
// BLOCK CRUD
// =============================================================================

function makeBlock(type) {
    const _localId = newLocalId("b");
    if (type === "markdown") return { type: "markdown", body: "", _localId };
    if (type === "media") return { type: "media", url: "", kind: "image", alt: "", _localId };
    if (type === "quizRef") return { type: "quizRef", quizId: "", title: "", _localId };
    return {
        type: "question",
        id: newLocalId("q"),
        questionKind: "mcq",
        prompt: "",
        options: ["", ""],
        correctIndex: 0,
        multiSelect: false,
        correctIndexes: [0],
        explanation: "",
        _localId,
    };
}

window.addBlock = function (sectionId, type) {
    const section = findSection(sectionId);
    if (!section) return;
    if (section.blocks.length >= 40) {
        showNotification("تنبيه", "الحد الأقصى 40 عنصراً لكل قسم.", "warning");
        return;
    }
    pushHistorySnapshot();
    section.blocks.push(makeBlock(type));
    renderSections();
    autosave();
};

window.removeBlock = async function (sectionId, localId) {
    if (!(await _confirm("هل تريد حذف هذا العنصر؟"))) return;
    const section = findSection(sectionId);
    if (!section) return;
    pushHistorySnapshot();
    section.blocks = section.blocks.filter((b) => b._localId !== localId);
    renderSections();
    autosave();
};

window.moveBlock = function (sectionId, localId, delta) {
    const section = findSection(sectionId);
    if (!section) return;
    const idx = section.blocks.findIndex((b) => b._localId === localId);
    const target = idx + delta;
    if (idx === -1 || target < 0 || target >= section.blocks.length) return;
    pushHistorySnapshot();
    [section.blocks[idx], section.blocks[target]] = [section.blocks[target], section.blocks[idx]];
    renderSections();
    autosave();
};

window.duplicateBlock = function (sectionId, localId) {
    const section = findSection(sectionId);
    if (!section) return;
    const idx = section.blocks.findIndex((b) => b._localId === localId);
    if (idx === -1) return;
    if (section.blocks.length >= 40) {
        showNotification("تنبيه", "الحد الأقصى 40 عنصراً لكل قسم.", "warning");
        return;
    }
    pushHistorySnapshot();
    const clone = JSON.parse(JSON.stringify(section.blocks[idx]));
    clone._localId = newLocalId("b");
    if (clone.type === "question") clone.id = newLocalId("q");
    section.blocks.splice(idx + 1, 0, clone);
    renderSections();
    autosave();
};

const BLOCK_LABELS = {
    markdown: "نص (Markdown)",
    media: "وسائط",
    quizRef: "امتحان مرتبط",
    question: "سؤال مدمج",
};

function blockCardHtml(sectionId, block, index, total) {
    const sid = escapeHtml(sectionId);
    const bid = escapeHtml(block._localId);
    const isFirst = index === 0;
    const isLast = index === total - 1;
    const icon = (d) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

    let inner;
    if (block.type === "markdown") inner = markdownBlockInnerHtml(block);
    else if (block.type === "media") inner = mediaBlockInnerHtml(sectionId, block);
    else if (block.type === "quizRef") inner = quizRefBlockInnerHtml(sectionId, block);
    else inner = questionBlockInnerHtml(sectionId, block);

    return `
    <div class="lesson-block-card" data-block-type="${block.type}" data-local-id="${bid}">
      <div class="lesson-block-card-header">
        <span class="lesson-block-type-label">${BLOCK_LABELS[block.type] || ""}</span>
        <div class="lesson-block-card-actions">
          <button type="button" class="lesson-icon-btn" title="نقل لأعلى" ${isFirst ? "disabled" : ""} onclick="moveBlock('${sid}', '${bid}', -1)">${icon('<path d="m18 15-6-6-6 6"/>')}</button>
          <button type="button" class="lesson-icon-btn" title="نقل لأسفل" ${isLast ? "disabled" : ""} onclick="moveBlock('${sid}', '${bid}', 1)">${icon('<path d="m6 9 6 6 6-6"/>')}</button>
          <button type="button" class="lesson-icon-btn" title="مضاعفة" onclick="duplicateBlock('${sid}', '${bid}')">${icon('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>')}</button>
          <button type="button" class="lesson-icon-btn lesson-icon-btn-danger" title="حذف" onclick="removeBlock('${sid}', '${bid}')">${icon('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')}</button>
        </div>
      </div>
      ${inner}
    </div>`;
}

/** Attach behaviour to a block's freshly-rendered DOM (called after every render). */
function wireBlock(sectionId, block) {
    if (block.type === "markdown") {
        setupMdField(`md-${block._localId}`, (val) => {
            block.body = val;
            autosave();
        }, { minPx: 120 });
    } else if (block.type === "question") {
        wireQuestionBlock(sectionId, block);
    } else if (block.type === "media") {
        wireMediaDropzone(sectionId, block);
    }
}

// ── Markdown block ───────────────────────────────────────────────────────────
// A plain `.md-source` field — the global bar (Markdown + LaTeX + per-word
// highlight colors + media) formats it. A Write/Preview toggle sits above.

function markdownBlockInnerHtml(block) {
    const fid = `md-${block._localId}`;
    return `
    <div class="lesson-md-editor" data-field-id="${fid}">
      <div class="lesson-md-tabs">
        <button type="button" class="lesson-md-tab active" data-mode="write" onclick="setMdMode('${fid}', 'write')">كتابة</button>
        <button type="button" class="lesson-md-tab" data-mode="preview" onclick="setMdMode('${fid}', 'preview')">معاينة</button>
      </div>
      ${mdEditorHtml(fid, block.body, "اكتب محتوى القسم هنا… يدعم Markdown و LaTeX ($...$) والتظليل الملوّن", 5)}
    </div>`;
}

window.setMdMode = function (fieldId, mode) {
    const root = document.querySelector(`.lesson-md-editor[data-field-id="${fieldId}"]`);
    if (!root) return;
    const textarea = document.getElementById(fieldId);
    const preview = document.getElementById(`preview-${fieldId}`);
    if (!textarea || !preview) return;
    root.querySelectorAll(".lesson-md-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
    if (mode === "preview") {
        preview.innerHTML = renderMarkdown(textarea.value || "");
        textarea.style.display = "none";
        preview.style.display = "";
    } else {
        textarea.style.display = "";
        preview.style.display = "none";
        textarea.focus();
    }
};

// ── Media block ──────────────────────────────────────────────────────────────

function mediaPreviewHtml(block) {
    if (!block.url) return "";
    if (block.kind === "image") return `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt || "")}" class="lesson-media-preview-img">`;
    if (block.kind === "audio") return `<audio src="${escapeHtml(block.url)}" controls></audio>`;
    return `<video src="${escapeHtml(block.url)}" controls class="lesson-media-preview-video"></video>`;
}

function mediaBlockInnerHtml(sectionId, block) {
    const sid = escapeHtml(sectionId);
    const bid = escapeHtml(block._localId);
    return `
    <div class="lesson-media-editor">
      ${isAdmin ? `
      <div class="lesson-media-dropzone" data-local-id="${bid}">
        <input type="file" class="lesson-media-file-input" accept="image/*,audio/*,video/*" onchange="handleMediaFileInput(event, '${sid}', '${bid}')">
        <p>اسحب ملفاً هنا أو اضغط للاختيار، أو الصق رابطاً مباشرة أدناه</p>
      </div>` : ""}
      <div class="form-row">
        <div class="form-group">
          <label>رابط الوسائط</label>
          <input type="text" class="form-input" dir="ltr" value="${escapeHtml(block.url)}" placeholder="https://…"
            oninput="updateMediaField('${sid}', '${bid}', 'url', this.value)">
        </div>
        <div class="form-group">
          <label>النوع</label>
          <select class="form-input" onchange="updateMediaField('${sid}', '${bid}', 'kind', this.value, true)">
            <option value="image" ${block.kind === "image" ? "selected" : ""}>صورة</option>
            <option value="audio" ${block.kind === "audio" ? "selected" : ""}>صوت</option>
            <option value="video" ${block.kind === "video" ? "selected" : ""}>فيديو</option>
          </select>
        </div>
      </div>
      ${block.kind === "image" ? `
      <div class="form-group">
        <label>نص بديل (alt)</label>
        <input type="text" class="form-input" value="${escapeHtml(block.alt || "")}" placeholder="وصف الصورة"
          oninput="updateMediaField('${sid}', '${bid}', 'alt', this.value)">
      </div>` : ""}
      <div class="lesson-media-preview" id="media-preview-${bid}">${mediaPreviewHtml(block)}</div>
    </div>`;
}

window.updateMediaField = function (sectionId, localId, field, value, structural = false) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    if (structural) pushHistorySnapshot();
    block[field] = value;
    autosave();
    if (field === "kind") {
        renderSections(); // alt field only shows for images
        return;
    }
    if (field === "url") {
        const el = document.getElementById(`media-preview-${localId}`);
        if (el) el.innerHTML = mediaPreviewHtml(block);
    }
};

window.handleMediaFileInput = async function (event, sectionId, localId) {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadIntoMediaBlock(file, sectionId, localId);
    event.target.value = "";
};

function wireMediaDropzone(sectionId, block) {
    const zone = document.querySelector(`.lesson-media-dropzone[data-local-id="${block._localId}"]`);
    if (!zone) return;
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("is-dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
    zone.addEventListener("drop", async (e) => {
        e.preventDefault();
        zone.classList.remove("is-dragover");
        const file = e.dataTransfer?.files?.[0];
        if (file) await uploadIntoMediaBlock(file, sectionId, block._localId);
    });
}

async function uploadIntoMediaBlock(file, sectionId, localId) {
    if (!isAdmin) {
        showNotification("غير مسموح", "رفع الملفات متاح للمشرفين فقط. الصق رابط الملف مباشرة بدلاً من ذلك.", "error");
        return;
    }
    const block = findBlock(sectionId, localId);
    if (!block) return;
    const mediaType = detectMediaTypeFromFile(file);
    if (!mediaType) {
        showNotification("خطأ", "نوع الملف غير مدعوم.", "error");
        return;
    }
    const previewEl = document.getElementById(`media-preview-${localId}`);
    if (previewEl) previewEl.innerHTML = `<p class="lesson-media-uploading">جاري الرفع…</p>`;
    try {
        const { url } = await uploadMediaFile(file, mediaType);
        pushHistorySnapshot();
        block.url = url;
        block.kind = mediaType;
        autosave();
        renderSections();
    } catch (err) {
        showNotification("خطأ", err.message || "فشل رفع الملف.", "error");
        if (previewEl) previewEl.innerHTML = mediaPreviewHtml(block);
    }
}

// ── Quiz-reference block ─────────────────────────────────────────────────────

function quizRefSelectedHtml(exam, fallbackTitle) {
    if (!exam) {
        return fallbackTitle
            ? `<div class="lesson-quizref-chip"><span class="lesson-quizref-chip-title">${escapeHtml(fallbackTitle)}</span></div>`
            : `<p class="lesson-quizref-empty">لم يتم اختيار امتحان بعد.</p>`;
    }
    return `
    <div class="lesson-quizref-chip">
      <span class="lesson-quizref-chip-title">${escapeHtml(exam.title)}</span>
      ${typeof exam.questionCount === "number" ? `<span class="lesson-quizref-chip-count">${exam.questionCount} سؤال</span>` : ""}
    </div>`;
}

function quizRefBlockInnerHtml(sectionId, block) {
    const sid = escapeHtml(sectionId);
    const bid = escapeHtml(block._localId);
    const matched = block.quizId ? quizExamList.find((q) => q.id === block.quizId) : null;
    return `
    <div class="lesson-quizref-editor">
      <div class="form-group">
        <label>ابحث عن امتحان بالعنوان</label>
        <input type="text" class="form-input lesson-quizref-search" placeholder="اكتب جزءاً من عنوان الامتحان…"
          data-section-id="${sid}" data-local-id="${bid}" oninput="handleQuizRefSearch(this)">
        <div class="lesson-quizref-results" id="quizref-results-${bid}"></div>
      </div>
      <div class="lesson-quizref-selected" id="quizref-selected-${bid}">
        ${matched ? quizRefSelectedHtml(matched) : block.quizId ? quizRefSelectedHtml(null, block.title || block.quizId) : quizRefSelectedHtml(null)}
      </div>
    </div>`;
}

window.handleQuizRefSearch = function (input) {
    const term = input.value.trim().toLowerCase();
    const resultsEl = document.getElementById(`quizref-results-${input.dataset.localId}`);
    if (!resultsEl) return;
    if (!term) { resultsEl.innerHTML = ""; return; }
    const matches = quizExamList.filter((q) => (q.title || "").toLowerCase().includes(term)).slice(0, 8);
    if (matches.length === 0) {
        resultsEl.innerHTML = `<p class="lesson-quizref-no-results">لا توجد نتائج.</p>`;
        return;
    }
    resultsEl.innerHTML = matches
        .map(
            (q) =>
                `<button type="button" class="lesson-quizref-result" onclick="selectQuizRef('${escapeHtml(input.dataset.sectionId)}', '${escapeHtml(input.dataset.localId)}', '${escapeHtml(q.id)}')">
          <span>${escapeHtml(q.title)}</span>
          ${typeof q.questionCount === "number" ? `<span class="lesson-quizref-result-count">${q.questionCount} سؤال</span>` : ""}
        </button>`,
        )
        .join("");
};

// ⚠️ Stores examList[].id (the 8-char meta id), NEVER dbId — lesson-view.js's
// fetchQuizRefs() and _urls.js's quizUrl() both route on the meta id.
window.selectQuizRef = function (sectionId, localId, metaId) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    const exam = quizExamList.find((q) => q.id === metaId);
    pushHistorySnapshot();
    block.quizId = metaId;
    block.title = exam?.title || "";
    document.getElementById(`quizref-selected-${localId}`).innerHTML = quizRefSelectedHtml(exam);
    document.getElementById(`quizref-results-${localId}`).innerHTML = "";
    const search = document.querySelector(`.lesson-quizref-search[data-local-id="${localId}"]`);
    if (search) search.value = "";
    autosave();
};

// ── Embedded question block — MCQ or ESSAY ───────────────────────────────────
// Mirrors create-quiz's question editor: prompt / options / explanation are
// `.md-source` fields (so the global bar works on them), and a question can be
// converted between multiple-choice and essay in either direction.

function questionBlockInnerHtml(sectionId, block) {
    const sid = escapeHtml(sectionId);
    const bid = escapeHtml(block._localId);
    const isEssay = block.questionKind === "essay";

    const optionsHtml = isEssay
        ? `
      <div class="essay-answer-container">
        <div class="essay-answer-label">
          <span class="essay-badge">سؤال مقالي</span>
          الإجابة النموذجية
          ${block.modelAnswer?.trim() ? "" : `<span class="essay-answer-missing">(مطلوبة)</span>`}
        </div>
        ${mdEditorHtml(`q-model-${block._localId}`, block.modelAnswer || "", "اكتب الإجابة النموذجية هنا...", 4)}
      </div>`
        : block.options
            .map(
                (opt, i) => `
      <div class="lesson-question-option-row">
        <input type="${block.multiSelect ? "checkbox" : "radio"}" name="correct-${bid}" ${(block.correctIndexes || [block.correctIndex]).includes(i) ? "checked" : ""}
          title="تحديد كإجابة صحيحة" aria-label="تحديد الخيار ${i + 1} كإجابة صحيحة"
          onchange="setQuestionCorrectIndex('${sid}', '${bid}', ${i})">
        <div class="option-md-wrap" style="flex:1;min-width:0;">
          ${mdEditorHtml(`q-opt-${block._localId}-${i}`, opt, `خيار ${i + 1}`, 1)}
        </div>
        <button type="button" class="lesson-icon-btn lesson-icon-btn-danger" title="حذف الخيار" ${block.options.length <= 2 ? "disabled" : ""}
          onclick="removeQuestionOption('${sid}', '${bid}', ${i})">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>`,
            )
            .join("");

    const otherSections = lessonData.sections.filter((s) => s.id !== sectionId);
    const ruleHtml = isEssay
        ? "" // an essay has no reliable right/wrong signal — see _validateLesson.js
        : `
    <div class="lesson-adaptive-rule">
      <label>إذا أجاب خطأ → اكشف قسم:</label>
      <select class="form-input lesson-rule-select" data-section-id="${sid}" data-local-id="${bid}"
        onchange="setQuestionRevealRule('${sid}', '${bid}', 'onWrong', this.value)">
        ${ruleOptionsHtml(otherSections, block.onWrong?.revealSection)}
      </select>
    </div>`;

    return `
    <div class="form-group">
      <label>نصّ السؤال *</label>
      ${mdEditorHtml(`q-prompt-${block._localId}`, block.prompt, "أدخل سؤالك هنا...", 1)}
    </div>
    <div class="lesson-question-options">
      <label>${isEssay ? "الإجابة المرجعية" : block.multiSelect ? "الإختيارات (حدد كل الإجابات الصحيحة)" : "الإختيارات (اختر الإجابة الصحيحة)"}</label>
      ${optionsHtml}
      <div class="lesson-question-type-actions">
        ${isEssay
            ? `<button type="button" class="btn btn-secondary btn-sm" onclick="convertQuestionKind('${sid}', '${bid}', 'mcq')">تحويل إلى اختيار متعدد</button>`
            : `<button type="button" class="btn btn-secondary btn-sm" ${block.options.length >= 8 ? "disabled" : ""} onclick="addQuestionOption('${sid}', '${bid}')">+ خيار</button>
                   <button type="button" class="btn btn-secondary btn-sm" onclick="toggleQuestionMultiSelect('${sid}', '${bid}')">${block.multiSelect ? "إجابة واحدة" : "إجابات متعددة"}</button>
                   <button type="button" class="btn btn-secondary btn-sm" onclick="convertQuestionKind('${sid}', '${bid}', 'essay')">تحويل إلى سؤال مقالي</button>`
        }
      </div>
    </div>
    <div class="form-group">
      <label>الشرح (اختياري)</label>
      ${mdEditorHtml(`q-expl-${block._localId}`, block.explanation || "", "يظهر بعد الإجابة", 1)}
    </div>
    ${ruleHtml}`;
}

function ruleOptionsHtml(otherSections, selectedId) {
    return (
        `<option value="">— بدون —</option>` +
        otherSections
            .map((s) => {
                const label = s.title || `قسم ${lessonData.sections.indexOf(s) + 1}`;
                return `<option value="${escapeHtml(s.id)}" ${s.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
            })
            .join("")
    );
}

/** Section titles/order changed — refresh every question's reveal-rule dropdown in place. */
function refreshAllRuleDropdowns() {
    document.querySelectorAll(".lesson-rule-select").forEach((sel) => {
        const block = findBlock(sel.dataset.sectionId, sel.dataset.localId);
        if (!block) return;
        const others = lessonData.sections.filter((s) => s.id !== sel.dataset.sectionId);
        sel.innerHTML = ruleOptionsHtml(others, block.onWrong?.revealSection);
    });
}

function wireQuestionBlock(sectionId, block) {
    setupMdField(`q-prompt-${block._localId}`, (v) => { block.prompt = v; autosave(); });
    setupMdField(`q-expl-${block._localId}`, (v) => { block.explanation = v; autosave(); });
    if (block.questionKind === "essay") {
        setupMdField(`q-model-${block._localId}`, (v) => { block.modelAnswer = v; autosave(); }, { minPx: 80 });
    } else {
        block.options.forEach((_, i) => {
            setupMdField(`q-opt-${block._localId}-${i}`, (v) => { block.options[i] = v; autosave(); }, { minPx: 36, maxPx: 160 });
        });
    }
}

window.addQuestionOption = function (sectionId, localId) {
    const block = findBlock(sectionId, localId);
    if (!block || block.questionKind === "essay" || block.options.length >= 8) return;
    pushHistorySnapshot();
    block.options.push("");
    renderSections();
    autosave();
};

window.removeQuestionOption = function (sectionId, localId, index) {
    const block = findBlock(sectionId, localId);
    if (!block || block.questionKind === "essay" || block.options.length <= 2) return;
    pushHistorySnapshot();
    block.options.splice(index, 1);
    block.correctIndexes = (block.correctIndexes || [block.correctIndex]).filter((i) => i !== index).map((i) => i > index ? i - 1 : i);
    if (!block.correctIndexes.length) block.correctIndexes = [0];
    block.correctIndex = block.correctIndexes[0];
    renderSections();
    autosave();
};

window.setQuestionCorrectIndex = function (sectionId, localId, index) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    pushHistorySnapshot();
    if (block.multiSelect) {
        const selected = new Set(block.correctIndexes || [block.correctIndex]);
        if (selected.has(index) && selected.size > 1) selected.delete(index);
        else selected.add(index);
        block.correctIndexes = [...selected].sort((a, b) => a - b);
    } else {
        block.correctIndex = index;
        block.correctIndexes = [index];
    }
    autosave();
};

window.toggleQuestionMultiSelect = function (sectionId, localId) {
    const block = findBlock(sectionId, localId);
    if (!block || block.questionKind === "essay") return;
    pushHistorySnapshot();
    block.multiSelect = !block.multiSelect;
    block.correctIndexes = block.multiSelect ? (block.correctIndexes || [block.correctIndex]) : [block.correctIndexes?.[0] ?? block.correctIndex];
    block.correctIndex = block.correctIndexes[0];
    renderSections();
    autosave();
};

/** One rule per question, onWrong only — see the plan's "no chained branching" scoping. */
window.setQuestionRevealRule = function (sectionId, localId, ruleKey, targetSectionId) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    pushHistorySnapshot();
    if (targetSectionId) block[ruleKey] = { revealSection: targetSectionId };
    else delete block[ruleKey];
    autosave();
};

/**
 * MCQ ⇄ essay, mirroring create-quiz's convertMcqToEssay / convertEssayToMcq.
 * MCQ → essay is destructive (options collapse to one model answer), so it
 * asks first; the first option's text is kept as a starting draft answer.
 */
window.convertQuestionKind = async function (sectionId, localId, kind) {
    const block = findBlock(sectionId, localId);
    if (!block || block.type !== "question") return;

    if (kind === "essay") {
        if (
            !(await _confirm(
                "تحويل هذا السؤال إلى سؤال مقالي سيحذف كل الخيارات الحالية باستثناء نص أول خيار (سيُستخدم كبداية للإجابة النموذجية). كما سيُزال شرط الكشف الشرطي. هل تريد المتابعة؟",
            ))
        ) {
            return;
        }
        pushHistorySnapshot();
        block.modelAnswer = block.options?.[0] || "";
        block.questionKind = "essay";
        delete block.options;
        delete block.correctIndex;
        delete block.correctIndexes;
        delete block.multiSelect;
        // An essay has no reliable right/wrong signal, and the validator
        // rejects reveal rules on essay questions outright.
        delete block.onWrong;
        delete block.onCorrect;
    } else {
        pushHistorySnapshot();
        const draft = block.modelAnswer || "";
        block.questionKind = "mcq";
        block.options = [draft, "", "", ""];
        block.correctIndex = 0;
        block.multiSelect = false;
        block.correctIndexes = [0];
        delete block.modelAnswer;
    }
    renderSections();
    autosave();
    showNotification(
        "تم التحويل",
        kind === "essay" ? "تم تحويل السؤال إلى سؤال مقالي" : "تم تحويل السؤال إلى اختيار متعدد",
        "success",
    );
};

// =============================================================================
// PREVIEW — in-page overlay rendered with the READER'S real block renderer
// =============================================================================
// What the author sees is what a reader gets: blocks go through lesson-blocks.js's
// renderBlock(), and the author's reader defaults (font + default highlight)
// are applied as the same CSS variables the reader sets.
//
// ⚠️ Deliberately NOT calling equipQuestionBlocks(): that wires the embedded
// questions to write into `lesson_progress_<lessonId>` in localStorage, and a
// preview must never leave reading-progress behind. Questions therefore render
// statically here (their choices are visible but not interactive).

async function loadReaderModules() {
    const [{ renderBlock }, prefs] = await Promise.all([
        import("../lesson/lesson-blocks.js"),
        import("../lesson/lesson-reader-prefs.js"),
    ]);
    return { renderBlock, applyReaderPrefs: prefs.applyReaderPrefs };
}

window.previewLesson = async function () {
    const errors = validateLesson();
    if (errors.length > 0) {
        showNotification("خطأ في التحقق", "الرجاء إصلاح الأخطاء التالية:\n\n" + errors.join("\n"), "error");
        return;
    }

    let mods;
    try {
        mods = await loadReaderModules();
    } catch (err) {
        console.error("[create-lesson] preview modules failed to load:", err);
        showNotification("خطأ", "تعذّر تحميل المعاينة.", "error");
        return;
    }

    closeLessonPreview();
    const ctx = { lessonId: "__preview__", quizLookup: new Map() };
    const content = serializeContent();

    const sectionsHtml = content.sections
        .map((section, i) => {
            const blocksHtml = section.blocks.map((b) => mods.renderBlock(b, ctx)).join("");
            const hiddenNote = section.defaultHidden
                ? `<span class="lesson-preview-hidden-note">مخفي افتراضياً — يظهر عند تفعيل شرط الكشف</span>`
                : "";
            return `
        <section class="lesson-section${section.defaultHidden ? " lesson-section--preview-hidden" : ""}">
          ${section.title || section.defaultHidden ? `<div class="lesson-section__header"><h2 class="lesson-section__title">${escapeHtml(section.title || `قسم ${i + 1}`)}</h2>${hiddenNote}</div>` : ""}
          <div class="lesson-section__body">${blocksHtml}</div>
        </section>`;
        })
        .join("");

    const overlay = document.createElement("div");
    overlay.className = "lesson-preview-overlay";
    overlay.id = "lessonPreviewOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
    <div class="lesson-preview-panel">
      <div class="lesson-preview-topbar">
        <span class="lesson-preview-badge">معاينة — لن يُحفظ أي تقدّم</span>
        <button type="button" class="lesson-icon-btn" id="lessonPreviewClose" aria-label="إغلاق المعاينة" title="إغلاق (Esc)">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <article class="lesson-view lesson-preview-article">
        <header class="lesson-view__header"><h1 class="lesson-view__title">${escapeHtml(lessonData.title || "درس بدون عنوان")}</h1></header>
        <div class="lesson-view__body">${sectionsHtml}</div>
      </article>
    </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add("lesson-preview-open");

    const article = overlay.querySelector(".lesson-view");
    mods.applyReaderPrefs(article, readerPrefsFromData());

    overlay.querySelector("#lessonPreviewClose").addEventListener("click", closeLessonPreview);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeLessonPreview();
    });
    document.addEventListener("keydown", _previewEscHandler);
};

function _previewEscHandler(e) {
    if (e.key === "Escape") closeLessonPreview();
}

function closeLessonPreview() {
    document.getElementById("lessonPreviewOverlay")?.remove();
    document.body.classList.remove("lesson-preview-open");
    document.removeEventListener("keydown", _previewEscHandler);
}

// =============================================================================
// VALIDATION — mirrors what api/_validateLesson.js requires, so a lesson that
// passes here is also publishable server-side later without surprises.
// =============================================================================

function validateLesson() {
    const errors = [];

    if (!lessonData.title || !lessonData.title.trim()) {
        errors.push("عنوان الدرس مطلوب (اضغط على الاسم في الشريط العلوي لتسميته)");
    }
    if (lessonData.sections.length === 0) {
        errors.push("الدرس يحتاج قسماً واحداً على الأقل");
    }

    lessonData.sections.forEach((section, sIdx) => {
        const sLabel = `القسم ${sIdx + 1}`;
        section.blocks.forEach((block, bIdx) => {
            const label = `${sLabel} · العنصر ${bIdx + 1}`;
            if (block.type === "media") {
                if (!block.url?.trim()) errors.push(`${label}: رابط الوسائط مطلوب`);
            } else if (block.type === "quizRef") {
                if (!block.quizId?.trim()) errors.push(`${label}: اختر الامتحان المرتبط`);
            } else if (block.type === "question") {
                if (!block.prompt?.trim()) errors.push(`${label}: نص السؤال مطلوب`);
                if (block.questionKind === "essay") {
                    if (!block.modelAnswer?.trim()) errors.push(`${label}: الإجابة النموذجية مطلوبة للسؤال المقالي`);
                } else {
                    if ((block.options || []).some((o) => !o || !o.trim())) {
                        errors.push(`${label}: جميع الخيارات يجب أن تحتوي على نص`);
                    }
                    const correctIndexes = block.multiSelect ? block.correctIndexes : [block.correctIndex];
                    if (!Array.isArray(correctIndexes) || !correctIndexes.length || correctIndexes.some((i) => !Number.isInteger(i) || i < 0 || i >= (block.options || []).length)) {
                        errors.push(`${label}: حدّد الإجابة الصحيحة`);
                    }
                }
            }
        });
    });

    return errors;
}

// =============================================================================
// SAVE — promote the draft to a real lesson in "امتحاناتك"
// =============================================================================
// Same flow as create-quiz.js's saveLocally():
//   * validate, then write the row into user_quizzes;
//   * a new lesson is checked against same-level name collisions (root level —
//     it is filed in the workspace root; the user moves it afterwards with the
//     workspace's normal organize/move UI) and the draft row is removed;
//   * an already-saved lesson is updated in place, keeping its parentId.

window.saveLesson = function () {
    const errors = validateLesson();
    if (errors.length > 0) {
        showNotification("خطأ في التحقق", "الرجاء إصلاح الأخطاء التالية:\n\n" + errors.join("\n"), "error");
        return;
    }

    // Cancel any pending debounce; this explicit save supersedes it.
    clearTimeout(autosaveTimeout);
    autosaveTimeout = null;

    showLoading("يُحفظ..");
    setTimeout(() => {
        let savedId = null;
        let errorMessage = "";
        try {
            const items = _readUserItems();
            const title = lessonData.title.trim();

            if (editingLessonId) {
                const idx = items.findIndex((r) => r.id === editingLessonId);
                if (idx < 0) {
                    errorMessage = "تعذّر العثور على الدرس المحفوظ.";
                } else if (
                    hasLessonLevelCollision(items, {
                        title,
                        parentId: items[idx].meta?.parentId || null,
                        excludeId: editingLessonId,
                    })
                ) {
                    errorMessage = "يوجد درس بنفس الاسم في هذا المستوى من امتحاناتك بالفعل.";
                } else {
                    items[idx] = buildRow(editingLessonId, LESSON_TYPE, items[idx]);
                    _writeUserItems(items);
                    savedId = editingLessonId;
                }
            } else {
                // New lesson (from a draft): file it at the workspace root.
                if (hasLessonLevelCollision(items, { title, parentId: null })) {
                    errorMessage = "يوجد درس بنفس الاسم في المستوى الرئيسي من امتحاناتك بالفعل.";
                } else {
                    const id = `user_lesson_${Date.now()}`;
                    items.push(buildRow(id, LESSON_TYPE, null));
                    _writeUserItems(items);
                    if (currentDraftId) removeEditorDraft(currentDraftId);
                    currentDraftId = null;
                    savedId = id;
                }
            }
        } catch (err) {
            console.error("[create-lesson] save failed:", err);
            errorMessage = "فشل حفظ الدرس. قد تكون مساحة التخزين ممتلئة.";
        }
        hideLoading();

        if (savedId) {
            editingLessonId = savedId;
            updateAutosaveIndicator("saved");
            showNotification("تم الحفظ!", 'يمكنك العثور عليه في "امتحاناتك"', "success");
            setTimeout(() => {
                editingLessonId = null;
                currentDraftId = null;
                showEntryScreen();
            }, 1000);
        } else {
            updateAutosaveIndicator("error");
            showNotification("خطأ", errorMessage || "فشل حفظ الدرس", "error");
        }
    }, 400);
};

// =============================================================================
// UTILITIES
// =============================================================================

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
    if (overlay) overlay.style.display = "none";
}

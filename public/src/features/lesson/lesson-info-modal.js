// ============================================================================
// public/src/features/lesson/lesson-info-modal.js
// LESSON CONTROL MODAL (Phase 5) — the "معلومات الدرس" dialog opened from
// the live /lesson/:id reading page itself.
// ============================================================================
// NOT the same module as features/home/lesson-info-modal.js: that one is a
// read-only summary of a WORKSPACE row (opened from a library card's ⋮
// menu, before the reader is even on the page — see its own header
// comment). This one is opened FROM the live reading page and is
// interactive: it hosts the actual reading-prefs controls, the bookmarks
// list, a progress readout, and quick AI study actions, so those controls
// have one well-organized home instead of crowding the page header.
//
// Reuses the SAME dialog shell CSS both modals share (`.quiz-info-dialog*`
// — see quiz-info-modal.css, already loaded globally) rather than building
// a new modal framework, per the plan's Phase 5 step 1. Reading-prefs
// markup/wiring is imported from lesson-view.js itself (renderPrefsPopover/
// equipPrefs) rather than reimplemented here, so there is exactly one
// source of truth for those controls no matter where they're rendered from.
// ============================================================================

import { escapeHtml } from "../home/escape-html.js";
import { renderLessonBookmarks, equipLessonBookmarks, cleanupLessonBookmarks } from "./lesson-bookmarks.js";
import {
    computeLessonProgressSummary,
    renderLessonProgressSummary,
    equipLessonProgressSummary,
} from "./lesson-progress-summary.js";
import {
    getReaderPrefs,
    equipReaderPrefs,
    FONT_CHOICES,
    WIDTH_CHOICES,
    TEXT_SIZE_CHOICES,
} from "./lesson-reader-prefs.js";

const BLOCK_LABELS = {
    markdown: "نص",
    media: "وسائط",
    quizRef: "امتحان",
    question: "سؤال",
};

function collectLiveLessonInfo(lesson, normalized) {
    const blockCounts = {};
    let questionCount = 0;
    for (const section of normalized.sections || []) {
        for (const block of section.blocks || []) {
            blockCounts[block.type] = (blockCounts[block.type] || 0) + 1;
            if (block.type === "question") questionCount += 1;
        }
    }
    return {
        title: lesson.title || "درس بدون عنوان",
        sectionCount: normalized.sections?.length || 0,
        questionCount,
        blockCounts,
        createdAt: lesson.created_at || null,
    };
}

function formatDate(value) {
    if (!value) return null;
    try {
        return new Date(value).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
    } catch {
        return null;
    }
}

function renderInfoSection(info) {
    const plural = (n, one, two, many) => (n === 1 ? one : n === 2 ? two : many);
    const rows = [];
    const presentTypes = Object.keys(BLOCK_LABELS).filter((t) => info.blockCounts[t]);
    for (const type of presentTypes) {
        rows.push(
            `<div class="quiz-meta-label">${escapeHtml(BLOCK_LABELS[type])}</div>` +
            `<div class="quiz-meta-value">${escapeHtml(String(info.blockCounts[type]))}</div>`,
        );
    }
    const created = formatDate(info.createdAt);
    if (created) {
        rows.push(`<div class="quiz-meta-label">تاريخ الإنشاء</div><div class="quiz-meta-value"><span dir="ltr">${escapeHtml(created)}</span></div>`);
    }
    return (
        `<div class="quiz-info-section">` +
        `<div class="quiz-info-section-title">عن هذا الدرس</div>` +
        `<div class="quiz-metrics-row">` +
        `<span class="quiz-metric-pill">${info.sectionCount} ${escapeHtml(plural(info.sectionCount, "قسم", "قسمان", "أقسام"))}</span>` +
        (info.questionCount
            ? `<span class="quiz-metric-pill">${info.questionCount} ${escapeHtml(plural(info.questionCount, "سؤال مدمج", "سؤالان مدمجان", "أسئلة مدمجة"))}</span>`
            : "") +
        `</div>` +
        (rows.length ? `<div class="quiz-meta-grid" style="margin-top:12px">${rows.join("")}</div>` : "") +
        `</div>`
    );
}

// AI study actions offered from the modal — each just fills the AI
// composer with a ready-made prompt via the same one-click "submitText"
// path lesson-view.js's selection/wrong-answer triggers use, so there is
// no second way of sending an AI message living in this file.
const AI_STUDY_ACTIONS = [
    { id: "summarize", label: "لخّص الدرس كامل", prompt: "لخّص لي هذا الدرس كاملاً في نقاط واضحة ومرتبة." },
    { id: "flashcards", label: "بطاقات مراجعة", prompt: "اعمل لي بطاقات مراجعة (سؤال وجواب) من أهم أفكار هذا الدرس." },
    { id: "practice", label: "أسئلة تدريبية", prompt: "اقترح لي أسئلة تدريبية تغطي أهم أفكار هذا الدرس، بدون إنشاء تدريب تفاعلي — فقط اكتبها كنص." },
    { id: "hint", label: "نقطة صعبة؟ اشرحها لي", prompt: "اشرح لي أصعب فكرة أو مفهوم في هذا الدرس بمثال مبسط." },
];

function renderAiActionsSection() {
    const buttons = AI_STUDY_ACTIONS.map(
        (a) => `<button type="button" class="lesson-info-modal__ai-action" data-ai-study-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`,
    ).join("");
    return (
        `<div class="quiz-info-section">` +
        `<div class="quiz-info-section-title">مذاكرة بمساعدة الباشــمبصمج</div>` +
        `<div class="lesson-info-modal__ai-actions">${buttons}</div>` +
        `</div>`
    );
}


function renderInfoPrefs(prefs) {
    const fontOptions = FONT_CHOICES.map((item) =>
        `<option value="${escapeHtml(item.id)}"${item.id === prefs.fontId ? " selected" : ""}>${escapeHtml(item.label)}</option>`
    ).join("");
    const widthOptions = WIDTH_CHOICES.map((item) =>
        `<option value="${escapeHtml(item.id)}"${item.id === prefs.widthId ? " selected" : ""}>${escapeHtml(item.label)}</option>`
    ).join("");
    const textSizeOptions = TEXT_SIZE_CHOICES.map((item) =>
        `<option value="${escapeHtml(item.id)}"${item.id === prefs.textSizeId ? " selected" : ""}>${escapeHtml(item.label)}</option>`
    ).join("");
    return (
        `<section class="lesson-info-modal__prefs" aria-labelledby="lessonInfoPrefsTitle">` +
        `<div class="lesson-info-modal__prefs-head"><div><h3 id="lessonInfoPrefsTitle">إعدادات القراءة</h3>` +
        `<p>تُطبّق هذه الإعدادات على صفحة الدرس وتحفظ على هذا الجهاز.</p></div></div>` +
        `<div class="lesson-info-modal__prefs-grid">` +
        `<label><span>الخط</span><select data-reader-pref="font">${fontOptions}</select></label>` +
        `<label><span>عرض القراءة</span><select data-reader-pref="width">${widthOptions}</select></label>` +
        `<label><span>حجم النص</span><select data-reader-pref="text-size">${textSizeOptions}</select></label>` +
        `<label class="lesson-info-modal__prefs-switch"><span>وضع التركيز</span><input type="checkbox" data-reader-pref="focus"${prefs.focusMode ? " checked" : ""}></label>` +
        `</div></section>`
    );
}

/**
 * Opens the live lesson page's control modal.
 *
 * @param {object} options
 * @param {object} options.lesson - the fetched lesson row (id, title, created_at, reader_prefs_default)
 * @param {object} options.normalized - normalizeLessonContent(lesson.content)
 * @param {(sectionId:string)=>void} options.onJumpToSection - scrolls to a section
 * @param {(sectionId:string)=>void} [options.onBookmarksChange] - called after a bookmark add/remove
 * @param {(actionId:string, prompt:string)=>void} options.onAiStudyAction - opens the AI agent with the given prompt
 * @returns {HTMLDialogElement}
 */
export function showLessonControlModal(options) {
    const {
        lesson,
        normalized,
        onJumpToSection,
        onBookmarksChange,
        onAiStudyAction,
    } = options;

    const info = collectLiveLessonInfo(lesson, normalized);
    const sectionTitleById = new Map((normalized.sections || []).map((s) => [s.id, s.title || "قسم من الدرس"]));
    const progressSummary = computeLessonProgressSummary(normalized, lesson.id);

    const dialog = document.createElement("dialog");
    dialog.className = "quiz-info-dialog lesson-info-dialog lesson-control-dialog";
    dialog.setAttribute("aria-labelledby", "lessonControlDialogTitle");
    dialog.innerHTML =
        `<div class="quiz-info-dialog-inner">` +
        `<div class="quiz-info-dialog-header">` +
        `<h2 id="lessonControlDialogTitle">معلومات الدرس</h2>` +
        `<button class="quiz-info-dialog-close" type="button" aria-label="إغلاق">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>` +
        `</button>` +
        `</div>` +
        `<div class="quiz-info-dialog-body">` +
        `<div class="quiz-info-hero"><h3>${escapeHtml(info.title)}</h3></div>` +
        renderInfoSection(info) +
        `<div class="quiz-info-section"><div class="quiz-info-section-title">التقدّم</div>${renderLessonProgressSummary(progressSummary, sectionTitleById)}</div>` +
        `<div class="quiz-info-section lesson-info-modal__bookmarks-section"><div class="quiz-info-section-title">العلامات المرجعية</div>${renderLessonBookmarks(lesson.id)}</div>` +
        renderInfoPrefs(getReaderPrefs(lesson.reader_prefs_default)) +
        renderAiActionsSection() +
        `</div>` +
        `</div>`;
    document.body.appendChild(dialog);

    const lessonEl = document.querySelector(`.lesson-view[data-lesson-id="${CSS.escape(lesson.id)}"]`);
    const prefsCleanup = lessonEl
        ? equipReaderPrefs(dialog, lessonEl, lesson.reader_prefs_default)
        : () => { };
    const bookmarksSection = dialog.querySelector(".lesson-info-modal__bookmarks-section");
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        prefsCleanup();
        cleanupLessonBookmarks(bookmarksSection);
        if (dialog.open) dialog.close();
        dialog.remove();
    };
    dialog.querySelector(".quiz-info-dialog-close").onclick = close;
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog) close();
    });
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    dialog.addEventListener("close", close);

    // Bookmarks: rerender just this modal's bookmarks block in place, then
    // let the caller know so the page's own header bookmarks widget (and
    // the bookmark toggle buttons per-section) can refresh too.
    const rerenderBookmarks = () => {
        const container = dialog.querySelector(".lesson-info-modal__bookmarks-section");
        if (container) {
            container.innerHTML = `<div class="quiz-info-section-title">العلامات المرجعية</div>${renderLessonBookmarks(lesson.id)}`;
            equipLessonBookmarks(container, lesson.id, rerenderBookmarks);
            container.querySelectorAll("[data-bookmark-jump]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    close();
                    onJumpToSection?.(btn.dataset.bookmarkJump);
                });
            });
        }
        onBookmarksChange?.();
    };
    if (bookmarksSection) equipLessonBookmarks(bookmarksSection, lesson.id, rerenderBookmarks);
    dialog.querySelectorAll("[data-bookmark-jump]").forEach((btn) => {
        btn.addEventListener("click", () => {
            close();
            onJumpToSection?.(btn.dataset.bookmarkJump);
        });
    });

    equipLessonProgressSummary(dialog, (sectionId) => {
        close();
        onJumpToSection?.(sectionId);
    });

    dialog.querySelectorAll("[data-ai-study-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const action = AI_STUDY_ACTIONS.find((a) => a.id === btn.dataset.aiStudyAction);
            if (!action) return;
            close();
            onAiStudyAction?.(action.id, action.prompt);
        });
    });

    dialog.showModal();
    return dialog;
}
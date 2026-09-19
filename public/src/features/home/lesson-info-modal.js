// ============================================================================
// public/src/features/home/lesson-info-modal.js
// LESSON INFO MODAL — the "معلومات الدرس" read-only dialog opened from a
// workspace lesson card's ⋮ menu (see user-quiz-card.js).
// ============================================================================
// Deliberately NOT a reuse of quiz-info-modal.js / buildQuizInfoModalHtml():
// that builder is organised around quiz-only facts (question count, question
// types, forced mode/view, creator card) and would show a lesson as a broken
// quiz. This module is lesson-specific and split into three independent
// layers so each can change without touching the others:
//
//   1. collectLessonInfo(row)   pure data — no DOM, easy to reason about
//   2. buildLessonInfoHtml(info) pure markup — every value escaped
//   3. showUserLessonInfoModal(row)  the only part that touches the DOM
//
// It shares ONLY the `.quiz-info-dialog*` / `.quiz-meta-*` / `.quiz-metric-pill`
// class names — the dialog shell (backdrop, animation, close button, RTL) that
// index.html already loads via quiz-info-modal.css. Nothing here needs new CSS.
// ============================================================================

import { escapeHtml } from "./escape-html.js";
import { formatDateForInfo } from "../../components/quiz-info-modal/quiz-info-html.js";
import { normalizeLessonContent } from "../lesson/lesson-schema.js";
import { FONT_CHOICES } from "../lesson/lesson-reader-prefs.js";

const BLOCK_LABELS = {
    markdown: "نص",
    media: "وسائط",
    quizRef: "امتحان مرتبط",
    question: "سؤال مدمج",
};

/**
 * Derives everything the modal shows from a stored workspace row
 * (`{ id, meta, stats, lesson }` — the shape create-lesson.js's buildRow()
 * writes). Reads `row.lesson` through normalizeLessonContent() rather than
 * assuming the shape, the same way openLessonById() does when editing.
 *
 * @param {object} row - a user_quizzes entry with meta.type === "lesson"
 * @returns {{
 *   id: string, title: string, createdAt: string|null, updatedAt: string|null,
 *   sectionCount: number, hiddenSectionCount: number, blockCount: number,
 *   blockCounts: Record<string, number>, questionCount: number,
 *   essayCount: number, adaptiveRuleCount: number, fontLabel: string|null,
 * }}
 */
export function collectLessonInfo(row) {
    const { sections } = normalizeLessonContent(row?.lesson);

    const blockCounts = {};
    let blockCount = 0;
    let questionCount = 0;
    let essayCount = 0;
    let adaptiveRuleCount = 0;
    let hiddenSectionCount = 0;

    for (const section of sections) {
        if (section.defaultHidden) hiddenSectionCount += 1;
        for (const block of section.blocks) {
            blockCount += 1;
            blockCounts[block.type] = (blockCounts[block.type] || 0) + 1;
            if (block.type === "question") {
                questionCount += 1;
                if (block.questionKind === "essay") essayCount += 1;
                if (block.onWrong?.revealSection || block.onCorrect?.revealSection) adaptiveRuleCount += 1;
            }
        }
    }

    const fontId = row?.meta?.readerPrefs?.fontId;
    const font = fontId && fontId !== "default" ? FONT_CHOICES.find((f) => f.id === fontId) : null;

    return {
        id: row?.id || row?.meta?.id || "",
        title: row?.meta?.title || "درس بدون عنوان",
        createdAt: row?.meta?.createdAt || null,
        updatedAt: row?.meta?.updatedAt || null,
        sectionCount: sections.length,
        hiddenSectionCount,
        blockCount,
        blockCounts,
        questionCount,
        essayCount,
        adaptiveRuleCount,
        fontLabel: font ? font.label : null,
    };
}

/** "١٢٣" style is avoided on purpose: the quiz modal shows Latin digits, and
 * mixing numeral systems between the two dialogs would look inconsistent. */
function pill(iconPath, text, title) {
    return `
    <span class="quiz-metric-pill" title="${escapeHtml(title)}">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPath}</svg>
      ${escapeHtml(text)}
    </span>`;
}

const ICON_SECTIONS = '<rect x="3" y="3" width="18" height="6" rx="1"/><rect x="3" y="12" width="18" height="9" rx="1"/>';
const ICON_QUESTION = '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>';
const ICON_HIDDEN =
    '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>';
const ICON_BRANCH = '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>';

/**
 * Markup for the dialog's inner contents. Every interpolated value passes
 * through escapeHtml() — titles are user-typed free text (the same stored-XSS
 * class user-quiz-card.js's header comment documents).
 * @param {ReturnType<typeof collectLessonInfo>} info
 * @returns {string}
 */
export function buildLessonInfoHtml(info) {
    const plural = (n, one, two, many) => (n === 1 ? one : n === 2 ? two : many);

    const pills = [
        pill(ICON_SECTIONS, `${info.sectionCount} ${plural(info.sectionCount, "قسم", "قسمان", "أقسام")}`, "عدد الأقسام"),
    ];
    if (info.questionCount) {
        pills.push(
            pill(ICON_QUESTION, `${info.questionCount} ${plural(info.questionCount, "سؤال مدمج", "سؤالان مدمجان", "أسئلة مدمجة")}`, "الأسئلة المدمجة"),
        );
    }
    if (info.hiddenSectionCount) {
        pills.push(pill(ICON_HIDDEN, `${info.hiddenSectionCount} مخفي افتراضياً`, "أقسام تظهر حسب الإجابة"));
    }
    if (info.adaptiveRuleCount) {
        pills.push(pill(ICON_BRANCH, `${info.adaptiveRuleCount} شرط كشف`, "أسئلة تكشف قسماً عند الإجابة"));
    }

    // Content breakdown, only for block types that are actually present, in a
    // stable order (not object-insertion order, which depends on the content).
    const breakdown = Object.keys(BLOCK_LABELS)
        .filter((type) => info.blockCounts[type])
        .map((type) => `${BLOCK_LABELS[type]}: ${info.blockCounts[type]}`)
        .join(" · ");

    const rows = [];
    const addRow = (label, valueHtml) => {
        rows.push(`
      <div class="quiz-meta-label">${escapeHtml(label)}</div>
      <div class="quiz-meta-value">${valueHtml}</div>`);
    };

    addRow("المحتوى", breakdown ? escapeHtml(breakdown) : "فارغ");
    if (info.essayCount) addRow("أسئلة مقالية", escapeHtml(String(info.essayCount)));
    if (info.fontLabel) addRow("خط القراءة", escapeHtml(info.fontLabel));
    const created = formatDateForInfo(info.createdAt);
    if (created) addRow("تاريخ الإنشاء", `<span dir="ltr">${escapeHtml(created)}</span>`);
    const updated = formatDateForInfo(info.updatedAt ? new Date(info.updatedAt).toLocaleString("en-US") : null);
    if (updated && updated !== created) addRow("آخر تعديل", `<span dir="ltr">${escapeHtml(updated)}</span>`);
    if (info.id) addRow("ID", `<span class="quiz-id-badge">${escapeHtml(info.id)}</span>`);

    return `
    <div class="quiz-info-dialog-inner">
      <div class="quiz-info-dialog-header">
        <h2 id="lessonInfoDialogTitle">معلومات الدرس</h2>
        <button class="quiz-info-dialog-close" type="button" aria-label="إغلاق">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="quiz-info-dialog-body">
        <div class="quiz-info-hero">
          <h3>${escapeHtml(info.title)}</h3>
          <div class="quiz-metrics-row">${pills.join("")}</div>
        </div>
        <div class="quiz-info-section">
          <div class="quiz-info-section-title">تفاصيل الدرس</div>
          <div class="quiz-meta-grid">${rows.join("")}</div>
        </div>
      </div>
    </div>`;
}

/**
 * Opens the lesson info dialog for a workspace lesson row.
 * @param {object} row
 * @returns {HTMLDialogElement}
 */
export function showUserLessonInfoModal(row) {
    const dialog = document.createElement("dialog");
    dialog.className = "quiz-info-dialog lesson-info-dialog";
    dialog.setAttribute("aria-labelledby", "lessonInfoDialogTitle");
    dialog.innerHTML = buildLessonInfoHtml(collectLessonInfo(row));
    document.body.appendChild(dialog);

    const close = () => {
        dialog.close();
        dialog.remove();
    };
    dialog.querySelector(".quiz-info-dialog-close").onclick = close;
    // Click on the backdrop (the <dialog> element itself, outside its inner box).
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog) close();
    });
    // Native Esc closes the dialog; make sure the node is removed too, or every
    // open/Esc cycle would leak a detached <dialog> into <body>.
    dialog.addEventListener("close", () => dialog.remove());

    dialog.showModal();
    return dialog;
}
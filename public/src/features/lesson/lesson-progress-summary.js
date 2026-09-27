// ============================================================================
// public/src/features/lesson/lesson-progress-summary.js
// LIVE-PAGE PROGRESS SUMMARY (Phase 5) — a compact "how far am I" readout
// for the lesson info modal: sections visited / total, embedded-question
// tally, overall completion, and a resume-reading action.
// ============================================================================
// Deliberately NOT the same module as lesson-progress.js: that one
// aggregates MANY lessons for a course/folder catalog card and never reads
// section-by-section detail. This one describes ONE lesson's own progress
// in more depth, for the reader currently on that lesson's page. Both read
// the same underlying local storage contract (lesson-schema.js) — no
// duplicated persistence, just a different view of it.
//
// "Mark complete" is intentionally NOT offered here: the plan (Phase 5 step
// 3) says completion must stay compatible with the existing model, which
// derives completion purely from `visitedSections` covering every required
// section (see getRequiredSectionIds/isLessonComplete) — there is no
// separate "completed" flag to set. Adding one here would fork the
// completion definition Phase 4's catalog rollup already relies on.
// ============================================================================

import { escapeHtml } from "../home/escape-html.js";
import { getLessonProgress, getRequiredSectionIds } from "./lesson-schema.js";

/**
 * @param {{sections: Array<{id:string,title?:string,defaultHidden?:boolean}>}} normalized
 * @param {string} lessonId
 * @returns {{
 *   requiredTotal: number, requiredVisited: number,
 *   revealedExtra: number, questionTotal: number, questionAnswered: number,
 *   questionCorrect: number, percent: number, isComplete: boolean,
 *   lastVisitedSectionId: string|null,
 * }}
 */
export function computeLessonProgressSummary(normalized, lessonId) {
    const progress = getLessonProgress(lessonId);
    const visited = new Set(progress.visitedSections || []);
    const requiredIds = getRequiredSectionIds(normalized);
    const requiredVisited = requiredIds.filter((id) => visited.has(id)).length;

    // Sections visited beyond the required set are adaptive/hidden sections
    // the reader was routed into — worth surfacing, but not part of the
    // completion denominator (see module doc comment above).
    const allSectionIds = new Set((normalized?.sections || []).map((s) => s.id));
    const revealedExtra = [...visited].filter((id) => allSectionIds.has(id) && !requiredIds.includes(id)).length;

    const questionEntries = Object.values(progress.questions || {});
    const questionTotal = (normalized?.sections || [])
        .flatMap((s) => s.blocks || [])
        .filter((b) => b?.type === "question").length;

    const percent = requiredIds.length ? Math.round((requiredVisited / requiredIds.length) * 100) : 0;

    // Same "last visited section that's still visible" logic lesson-view.js's
    // own resume button uses, duplicated in miniature here since the modal
    // needs it independently of the header button's DOM.
    const lastVisitedSectionId = [...visited].reverse().find((id) => allSectionIds.has(id)) || null;

    return {
        requiredTotal: requiredIds.length,
        requiredVisited,
        revealedExtra,
        questionTotal,
        questionAnswered: questionEntries.filter((q) => q.answered).length,
        questionCorrect: questionEntries.filter((q) => q.wasCorrect).length,
        percent,
        isComplete: requiredIds.length > 0 && requiredVisited === requiredIds.length,
        lastVisitedSectionId,
    };
}

/**
 * Markup for the progress section shown inside the lesson info modal.
 * @param {ReturnType<typeof computeLessonProgressSummary>} summary
 * @param {Map<string,string>} sectionTitleById - for the resume link's label
 */
export function renderLessonProgressSummary(summary, sectionTitleById) {
    const resumeTitle = summary.lastVisitedSectionId
        ? sectionTitleById.get(summary.lastVisitedSectionId) || "آخر قسم توقفت عنده"
        : null;

    return (
        `<div class="lesson-progress-summary">` +
        `<div class="lesson-progress-summary__bar-track" role="progressbar" aria-valuenow="${summary.percent}" aria-valuemin="0" aria-valuemax="100">` +
        `<div class="lesson-progress-summary__bar-fill" style="width:${summary.percent}%"></div>` +
        `</div>` +
        `<p class="lesson-progress-summary__headline">${summary.percent}% مكتمل` +
        (summary.isComplete ? ` <span class="lesson-progress-summary__done">— أتممت الدرس</span>` : "") +
        `</p>` +
        `<div class="lesson-progress-summary__stats">` +
        `<span>${summary.requiredVisited} من ${summary.requiredTotal} قسم أساسي</span>` +
        (summary.revealedExtra ? `<span>${summary.revealedExtra} قسم إضافي ظهر حسب إجاباتك</span>` : "") +
        (summary.questionTotal
            ? `<span>${summary.questionAnswered} من ${summary.questionTotal} سؤال مُجاب${summary.questionAnswered ? ` (${summary.questionCorrect} صحيح)` : ""}</span>`
            : "") +
        `</div>` +
        (resumeTitle
            ? `<button type="button" class="lesson-progress-summary__resume" data-progress-resume="${escapeHtml(summary.lastVisitedSectionId)}">متابعة من: ${escapeHtml(resumeTitle)}</button>`
            : "") +
        `</div>`
    );
}

/** Wires the summary's resume-reading action. `root` is the modal element. */
export function equipLessonProgressSummary(root, onJump) {
    root.querySelector("[data-progress-resume]")?.addEventListener("click", (e) => {
        onJump?.(e.currentTarget.dataset.progressResume);
    });
}
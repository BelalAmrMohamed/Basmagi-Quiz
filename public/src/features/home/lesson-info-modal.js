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

import { bindInfoCopyButtons } from "../../shared/info-link.js";
import { buildCreatorSectionHtml, fetchCreatorById, fetchLessonViewCount, fetchLessonDetails, fetchItemLocation } from "./info-details.js";
import { buildInfoBodyHtml, buildInfoDialogHtml, infoPill, INFO_ICONS } from "../../components/quiz-info-modal/quiz-info-html.js";
import { buildInfoModel } from "../../components/quiz-info-modal/info-model.js";
import { normalizeLessonContent } from "../lesson/lesson-schema.js";
import { FONT_CHOICES } from "../lesson/lesson-reader-prefs.js";

const BLOCK_LABELS = {
    markdown: "نص",
    media: "وسائط",
    quizRef: "امتحان",
    "lesson-reference": "درس",
    "notebook-reference": "دفتر",
    "folder-reference": "مجلد",
    "course-reference": "مادة",
    question: "سؤال",
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
    const hasContent = row?.lesson != null || row?.content != null;
    const content = row?.lesson ?? row?.content ?? { sections: [] };
    const { sections } = normalizeLessonContent(content);
    const resolvedSectionCount = hasContent
        ? sections.length
        : Number(row?.section_count ?? row?.sectionCount ?? 0);

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
        title: row?.meta?.title || row?.title || "درس بدون عنوان",
        description: row?.description || row?.meta?.description || "",
        source: row?.source || row?.meta?.source || "",
        local: !(row?.created_by || row?.createdBy || row?.course_id || row?.courseId) && (row?.meta?.type === "lesson" || String(row?.id || "").startsWith("user_lesson_")),
        courseId: row?.course_id || row?.courseId || null,
        folderId: row?.folder_id || row?.folderId || null,
        eduType: row?.education_type || null,
        college: row?.college || null,
        year: row?.year ?? null,
        term: row?.term ?? null,
        dbId: row?.dbId || (/^[0-9a-f]{8}-/i.test(String(row?.id || "")) ? row.id : null),
        url: `${window.location.origin}/lesson/${encodeURIComponent(row?.slug || row?.id || row?.meta?.id || "")}${row?.meta?.type === "lesson" && row?.id?.startsWith("user_lesson_") ? "?type=user" : ""}`,
        passwordProtected: Boolean(row?.passwordProtected || row?.password_protected || row?.meta?.passwordProtected || row?.passwordHash || row?.password_hash),
        createdBy: row?.createdBy || row?.created_by || null,
        createdAt: row?.meta?.createdAt || row?.created_at || null,
        updatedAt: row?.meta?.updatedAt || row?.updated_at || null,
        sectionCount: Number.isFinite(resolvedSectionCount) ? resolvedSectionCount : 0,
        hiddenSectionCount,
        blockCount,
        blockCounts,
        questionCount,
        essayCount,
        adaptiveRuleCount,
        fontLabel: font ? font.label : null,
    };
}

const plural = (n, one, two, many) => (n === 1 ? one : n === 2 ? two : many);

/**
 * Inner markup of the shared info core for a lesson (hero, chips, location,
 * dates, lesson specifics, links, creator). Pure: every value is escaped by
 * the shared renderer. `info` is enriched later by hydrateLessonCreator().
 * @param {ReturnType<typeof collectLessonInfo>} info
 */
export function buildLessonCoreHtml(info) {
    const pills = [infoPill(INFO_ICONS.sections, `${info.sectionCount} ${plural(info.sectionCount, "قسم", "قسمان", "أقسام")}`, "عدد الأقسام")];
    if (info.questionCount) {
        pills.push(infoPill(INFO_ICONS.question, `${info.questionCount} ${plural(info.questionCount, "سؤال مدمج", "سؤالان مدمجان", "أسئلة مدمجة")}`, "الأسئلة المدمجة"));
    }
    if (info.hiddenSectionCount) pills.push(infoPill(INFO_ICONS.hidden, `${info.hiddenSectionCount} مخفي افتراضياً`, "أقسام تظهر حسب الإجابة"));
    if (info.adaptiveRuleCount) pills.push(infoPill(INFO_ICONS.branch, `${info.adaptiveRuleCount} شرط كشف`, "أسئلة تكشف قسماً عند الإجابة"));

    // Block-type counts: only types that are actually present (no "empty" row).
    const specific = Object.keys(BLOCK_LABELS)
        .filter((type) => info.blockCounts[type])
        .map((type) => [BLOCK_LABELS[type], String(info.blockCounts[type])]);
    if (info.essayCount) specific.push(["أسئلة مقالية", String(info.essayCount)]);
    if (info.fontLabel) specific.push(["خط القراءة", info.fontLabel]);

    const hasLink = info.url && !info.url.endsWith("/lesson/") && !info.local;
    const model = buildInfoModel("lesson", {
        id: info.id,
        title: info.title,
        description: info.description,
        passwordProtected: info.passwordProtected,
        eduType: info.eduType,
        college: info.college,
        year: info.year,
        term: info.term,
        course: info.courseName,
        folders: info.folderNames,
        local: info.local,
        createdAt: info.createdAt,
        updatedAt: info.updatedAt,
        source: info.source,
        link: hasLink ? info.url : null,
        linkLabel: "رابط الدرس",
        engagementCount: typeof info.viewCount === "number" ? info.viewCount : (info.local || !info.dbId ? undefined : null),
        engagementLabel: "مشاهدة لهذا الدرس",
        pills,
        specific,
        specificTitle: "محتوى الدرس",
    });
    const creatorHtml = info.creator ? buildCreatorSectionHtml(info.creator) : "";
    return buildInfoBodyHtml(model, { creatorHtml, creatorSlot: Boolean(info.createdBy) && !info.creator && !info.creatorDone });
}

/** Body for the standalone / lesson-page dialogs: a re-renderable core wrapper. */
export function buildLessonInfoBodyHtml(info) {
    return `<div data-info-core>${buildLessonCoreHtml(info)}</div>`;
}

/**
 * Enriches a rendered lesson info core once the async facts arrive:
 * classification and course/folder from the DB, the view count and the creator
 * card. Re-renders only the `[data-info-core]` wrapper, so sections a caller
 * appended after it (progress, bookmarks, reader prefs) are untouched. Shared by
 * every lesson info modal (home, lesson page, embedded lesson cards).
 * @param {ParentNode} root - element containing the modal body
 * @param {ReturnType<typeof collectLessonInfo>} info
 */
export function hydrateLessonCreator(root, info) {
    const core = root.querySelector("[data-info-core]");
    if (!core || !info) return;
    const rerender = () => {
        if (!core.isConnected) return;
        core.innerHTML = buildLessonCoreHtml(info);
        bindInfoCopyButtons(core);
    };
    const tasks = [];
    if (info.dbId) {
        tasks.push(fetchLessonDetails(info.dbId).then(async (d) => {
            if (!d) return;
            info.eduType = info.eduType || d.education_type || null;
            info.college = info.college || d.college || null;
            info.year = info.year ?? d.year ?? null;
            info.term = info.term ?? d.term ?? null;
            info.createdAt = info.createdAt || d.created_at || null;
            info.updatedAt = info.updatedAt || d.updated_at || null;
            info.createdBy = info.createdBy || d.created_by || null;
            info.courseId = info.courseId || d.course_id || null;
            info.folderId = info.folderId || d.folder_id || null;
            if (!info.courseName && (info.courseId || info.folderId)) {
                const loc = await fetchItemLocation(info.courseId, info.folderId);
                info.courseName = loc.course;
                info.folderNames = loc.folders;
            }
        }));
        tasks.push(fetchLessonViewCount(info.dbId).then((count) => { if (typeof count === "number") info.viewCount = count; }));
    }
    Promise.allSettled(tasks)
        .then(() => (info.createdBy
            ? fetchCreatorById(info.createdBy).then((creator) => { info.creator = creator; }).catch(() => {})
            : null))
        .finally(() => { info.creatorDone = true; rerender(); });
}

/**
 * Markup for the whole dialog (header + body) of the standalone info modal.
 * @param {ReturnType<typeof collectLessonInfo>} info
 * @returns {string}
 */
export function buildLessonInfoHtml(info) {
    return buildInfoDialogHtml("معلومات الدرس", buildLessonInfoBodyHtml(info), { titleId: "lessonInfoDialogTitle" });
}

/**
 * Opens the lesson info dialog for a workspace lesson row.
 * @param {object} row
 * @returns {HTMLDialogElement}
 */
export function showUserLessonInfoModal(row) {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.createElement("dialog");
    dialog.className = "quiz-info-dialog lesson-info-dialog";
    dialog.setAttribute("aria-labelledby", "lessonInfoDialogTitle");
    const info = collectLessonInfo(row);
    dialog.innerHTML = buildLessonInfoHtml(info);
    bindInfoCopyButtons(dialog);
    document.body.appendChild(dialog);

    // Shared lessons carry the uploader's account id: the body renders a
    // shimmer placeholder, then the creator card once the profile resolves.
    hydrateLessonCreator(dialog, info);

    const close = () => {
        if (dialog.open) dialog.close();
        dialog.remove();
        if (previousFocus && document.body.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
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

export function showLessonInfoModal(row) {
    return showUserLessonInfoModal(row);
}

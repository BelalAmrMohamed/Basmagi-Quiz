// ============================================================================
// public/src/features/home/course-actions.js
// COURSE ACTIONS — the bottom-sheet action overlay and info modal for a
// subscribed course card's own three-dot menu.
// ============================================================================
// This covers showCourseActionsOverlay() and showCourseInfoModal(), extracted
// from original lines 5406-5497 (end of the original file).
//
// Relationship to course-info-tooltip.js: course-info-tooltip.js handles the
// hover/tap tooltip that appears on any course card (subscribed or not) and
// has its own inline unsubscribe path for the tooltip's "إلغاء الإشتراك"
// button. This module handles the separate bottom-sheet overlay that appears
// when the user taps the "⋮" (three-dot) button on a subscribed course card
// — a distinct entry point. The info table rendered by showCourseInfoModal()
// is structurally similar to what course-info-tooltip.js shows (same fields),
// but is a full modal rather than a floating tooltip, so it has not been
// deduplicated further — the duplication is intentional (different UX context,
// different dismissal mechanic, different ARIA role/structure).
// ============================================================================

import { INFO_ICON_SVG, TRASH_ICON_SVG } from "./icons.js";
import { userProfile } from "../../shared/userProfile.js";
import { renderRootCategories } from "./root-view.js";
import { getCategoryTree } from "./app-state.js";
import { buildCourseInfoRows } from "./course-info-fields.js";
import {
  openInfoOverlay,
  buildInfoTableHtml,
  buildCreatorSectionHtml,
  fetchCourseDetails,
  fetchCreatorById,
  formatDateForInfo,
} from "./info-details.js";

export function getCourseContentsStats(course) {
  const tree = getCategoryTree() || {};
  let quizCount = Array.isArray(course?.exams) ? course.exams.length : 0;
  let lessonCount = Array.isArray(course?.lessons) ? course.lessons.length : 0;
  let subfolderCount = 0;

  function visitFolder(key) {
    const folder = typeof key === "string" ? tree[key] : key;
    if (!folder) return;
    subfolderCount += 1;
    quizCount += Array.isArray(folder.exams) ? folder.exams.length : 0;
    lessonCount += Array.isArray(folder.lessons) ? folder.lessons.length : 0;
    (folder.subcategories || []).forEach(visitFolder);
  }

  (course?.subcategories || []).forEach(visitFolder);
  return { quizCount, lessonCount, subfolderCount };
}

/**
 * Show a bottom-sheet action overlay for a subscribed course card.
 * Options: "معلومات المادة" → opens showCourseInfoModal();
 *          "إلغاء الإشتراك" → removes the course and re-renders root.
 *
 * @param {object} course - The course object from the categoryTree.
 */
export function showCourseActionsOverlay(course) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay exam-actions-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const sheet = document.createElement("div");
  sheet.className = "exam-actions-sheet";

  const infoOpt = document.createElement("button");
  infoOpt.type = "button";
  infoOpt.className = "exam-action-btn";
  infoOpt.innerHTML = `${INFO_ICON_SVG}<span>معلومات المادة</span>`;
  infoOpt.onclick = (e) => {
    e.stopPropagation();
    modal.remove();
    showCourseInfoModal(course);
  };

  const deleteOpt = document.createElement("button");
  deleteOpt.type = "button";
  deleteOpt.className = "exam-action-btn exam-action-btn--danger";
  deleteOpt.innerHTML = `${TRASH_ICON_SVG}<span>إلغاء الإشتراك</span>`;
  deleteOpt.onclick = (e) => {
    e.stopPropagation();
    modal.remove();
    const subscribed = userProfile.getSubscribedCourseIds();
    userProfile.setSubscribedCourses(
      subscribed.filter((id) => id !== course.id),
    );

    // Rerender DOM without page refresh
    renderRootCategories();
  };

  sheet.appendChild(infoOpt);
  sheet.appendChild(deleteOpt);
  modal.appendChild(sheet);
  document.body.appendChild(modal);
}

/**
 * Show a full modal dialog with the course's metadata: education type,
 * college, year, term, content counts, dates, ID and the creator. The
 * metadata that is already in the catalog renders immediately; dates and
 * the creator profile load behind a shimmer skeleton.
 *
 * @param {object} course - The course object from the categoryTree.
 */
export function showCourseInfoModal(course) {
  const { quizCount, lessonCount, subfolderCount } = getCourseContentsStats(course);
  const { body, isOpen } = openInfoOverlay({
    title: "معلومات المادة",
    statsHtml: `
    <div class="course-info-stat"><strong>${quizCount}</strong><span>امتحان</span></div>
    <div class="course-info-stat"><strong>${lessonCount}</strong><span>درس</span></div>
    <div class="course-info-stat"><strong>${subfolderCount}</strong><span>مجلد فرعي</span></div>
  `,
  });

  (async () => {
    const details = await fetchCourseDetails(course?.id);
    const creatorId = details?.created_by || course?.created_by || null;
    const creator = await fetchCreatorById(creatorId);
    if (!isOpen()) return; // closed while loading

    const created = formatDateForInfo(details?.created_at || course?.created_at);
    const updated = formatDateForInfo(details?.updated_at);
    const rows = [
      ...buildCourseInfoRows(course),
      { label: "تاريخ الإنشاء", val: created, ltr: true },
      { label: "آخر تعديل", val: updated && updated !== created ? updated : null, ltr: true },
      { label: "ID", val: course?.id || null, ltr: true },
    ];
    body.innerHTML = buildInfoTableHtml(rows) + buildCreatorSectionHtml(creator);
  })();
}
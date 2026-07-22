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
    userProfile.setSubscribedCourses(subscribed.filter((id) => id !== course.id));

    // Rerender DOM without page refresh
    renderRootCategories();
  };

  sheet.appendChild(infoOpt);
  sheet.appendChild(deleteOpt);
  modal.appendChild(sheet);
  document.body.appendChild(modal);
}

/**
 * Show a full modal dialog with the course's metadata (education type,
 * faculty, year, term).  Dismissed via close button or backdrop click.
 *
 * NOTE: showNotification and confirmationNotification are NOT ES exports —
 * they are runtime globals loaded via a non-module <script> tag from
 * src/components/notifications.js. They are not used in this function.
 *
 * @param {object} course - The course object from the categoryTree.
 */
export function showCourseInfoModal(course) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card quiz-info-modal-card";

  const h2 = document.createElement("h2");
  h2.textContent = "معلومات المادة";

  const tableWrap = document.createElement("div");
  tableWrap.className = "quiz-info-table-wrap";

  const table = document.createElement("table");
  table.className = "quiz-info-table";
  table.innerHTML = `
    <tbody>
      <tr><th>نوع التعليم</th><td>${
        {
          "University": "جامعي",
          "High": "ثانوي",
          "Middle": "إعدادي",
          "Primary": "إبتدائي",
          "Featured": "كورسات مميزة"
        }[course.education_type] || course.education_type || '-'
      }</td></tr>
      ${course.faculty && course.faculty !== "All" ? `<tr><th>الكلية</th><td>${course.faculty}</td></tr>` : ''}
      <tr><th>العام</th><td>${course.year || '-'}</td></tr>
      <tr><th>الترم</th><td>${course.term || '-'}</td></tr>
    </tbody>
  `;
  tableWrap.appendChild(table);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "close-modal";
  closeBtn.textContent = "إغلاق";
  closeBtn.onclick = () => modal.remove();

  modalCard.appendChild(h2);
  modalCard.appendChild(tableWrap);
  modalCard.appendChild(closeBtn);
  modal.appendChild(modalCard);
  document.body.appendChild(modal);
}

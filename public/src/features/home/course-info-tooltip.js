// ============================================================================
// public/src/features/home/course-info-tooltip.js
// COURSE INFO TOOLTIP — the (i) button + popover shown on category/course
// cards, listing education type / faculty / year / term.
// ============================================================================
// DEDUPLICATION: the original file built this exact same tooltip three
// separate times with copy-pasted code (subscribed-courses cards, all-courses
// cards, and course search-result cards) — ~85 near-identical lines each,
// differing only in whether an "unsubscribe" button is appended. That's
// consolidated here into one function with a `withUnsubscribe` option.
//
// SECURITY FIX: the original interpolated `course.faculty`, `course.year`,
// and `course.term` directly into `tooltip.innerHTML` with no escaping —
// inconsistent with the rest of the codebase, which does escape comparable
// fields elsewhere (see showCourseInfoModal). This version runs every
// interpolated value through escapeHtml() before it reaches innerHTML.

import { escapeHtml } from "./escape-html.js";
import { userProfile } from "../../shared/userProfile.js";
import { confirmationNotification } from "../../components/notifications/notifications.js";
import {
  positionCourseInfoTooltip,
  attachCourseInfoTooltipDismissOnScroll,
} from "./tooltip-position.js";

const EDU_TYPE_AR = {
  University: "جامعي",
  High: "ثانوي",
  Middle: "إعدادي",
  Primary: "إبتدائي",
  Featured: "كورسات مميزة",
};

/**
 * Builds the `.course-info-container` (info button + tooltip) for a course
 * card and appends it to `card`. Wires up the toggle-on-tap behavior
 * (desktop uses CSS `:hover` instead — see the `matchMedia` guard below) and,
 * optionally, an "إلغاء الإشتراك" (unsubscribe) button inside the tooltip.
 *
 * @param {HTMLElement} card - the course/category card to attach the info
 *   container to.
 * @param {object} course - course/category object with education_type,
 *   faculty, year, term, and (for unsubscribe) an `id`.
 * @param {object} [options]
 * @param {boolean} [options.withUnsubscribe=false] - if true, adds an
 *   "إلغاء الإشتراك" button inside the tooltip that removes the course from
 *   the user's subscriptions and re-renders the root view.
 * @param {() => void} [options.onUnsubscribe] - called after a successful
 *   unsubscribe, instead of the default renderRootCategories() re-render, so
 *   callers that need a different refresh (e.g. search results) can supply
 *   their own. Only used when withUnsubscribe is true.
 */
export function attachCourseInfoTooltip(card, course, options = {}) {
  const { withUnsubscribe = false, onUnsubscribe } = options;

  const infoContainer = document.createElement("div");
  infoContainer.className = "course-info-container";

  const infoBtn = document.createElement("button");
  infoBtn.className = "course-info-btn";
  infoBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;
  infoBtn.type = "button";

  const tooltip = document.createElement("div");
  tooltip.className = "course-info-tooltip tooltip-interactive";

  const eduTypeAr =
    EDU_TYPE_AR[course.education_type] || course.education_type || "-";

  let courseInfoHtml = "";
  if (course.education_type === "Featured") {
    courseInfoHtml = `
      <div class="tooltip-row" style="justify-content: center;">
        <span style="color: var(--color-primary); font-size: 1rem;">مادة مميزة</span>
      </div>
    `;
  } else {
    courseInfoHtml = `
      <div class="tooltip-row"><span>التعليم:</span> <span>${escapeHtml(eduTypeAr)}</span></div>
      ${course.faculty && course.faculty !== "All" ? `<div class="tooltip-row"><span>الكلية:</span> <span>${escapeHtml(course.faculty)}</span></div>` : ""}
      <div class="tooltip-row"><span>العام:</span> <span>${escapeHtml(course.year || "-")}</span></div>
      <div class="tooltip-row"><span>الترم:</span> <span>${escapeHtml(course.term || "-")}</span></div>
    `;
  }

  if (withUnsubscribe) {
    tooltip.innerHTML = `
      ${courseInfoHtml}
      <hr class="tooltip-divider">
      <button class="tooltip-delete-btn" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
        <span>إلغاء الإشتراك</span>
      </button>
    `;
  } else {
    tooltip.innerHTML = courseInfoHtml;
  }

  infoContainer.appendChild(infoBtn);
  infoContainer.appendChild(tooltip);

  if (withUnsubscribe) {
    const deleteBtn = tooltip.querySelector(".tooltip-delete-btn");
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (
        await confirmationNotification(
          "هل أنت متأكد من إلغاء الإشتراك في هذه المادة؟",
        )
      ) {
        const subscribed = userProfile.getSubscribedCourseIds();
        userProfile.setSubscribedCourses(
          subscribed.filter((id) => id !== course.id),
        );
        if (onUnsubscribe) onUnsubscribe();
      }
    };
  }

  infoBtn.onclick = (e) => {
    if (
      window.matchMedia &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const willShow = !tooltip.classList.contains("show");
    if (willShow) {
      document.querySelectorAll(".course-info-tooltip.show").forEach((t) => {
        if (t !== tooltip) t.classList.remove("show");
      });
    }
    tooltip.classList.toggle("show", willShow);
    if (willShow) {
      positionCourseInfoTooltip(tooltip, infoBtn);
      attachCourseInfoTooltipDismissOnScroll(tooltip);
    }
  };
  tooltip.onclick = (e) => e.stopPropagation();

  card.appendChild(infoContainer);
}

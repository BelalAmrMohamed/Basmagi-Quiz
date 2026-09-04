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
//
// INTERACTION FIX: this used to be a hybrid hover(desktop)/click(mobile)
// widget, with hover driven by JS "hover-intent" timers layered on top of a
// `position: fixed` tooltip. That combination was fragile (card-lift
// transition races, hover-intent grace periods, CSS `:hover` fighting a JS
// close timer) — and even when working, gave desktop and mobile genuinely
// different interaction models for the same widget, with no dismiss on
// outside-click/Escape/scroll/resize.
//
// Replaced with the same click-toggle + single-exit-point dismiss lifecycle
// already used (and already correct) for `.exam-dropdown-menu` in
// exam-dropdown-menu.js: openExamDropdownMenu()/closeMenu(). Every close
// route (outside click, Escape, scroll, resize, the trigger button itself)
// goes through one closeTooltip() function, so listeners can never leak and
// desktop/mobile behave identically — click/tap opens it, and anything that
// would plausibly mean "the user is done with this" closes it.
//
// positionCourseInfoTooltip() (tooltip-position.js) is unchanged — it
// already does the correct `position: fixed` + viewport-clamped placement,
// same technique as positionExamDropdownMenu(). The bug was entirely in
// *when* it got called and how the tooltip was shown/hidden, not in the
// positioning math itself.

import { escapeHtml } from "./escape-html.js";
import { userProfile } from "../../shared/userProfile.js";
import { _confirm } from "../../components/notifications/notifications.js";
import { positionCourseInfoTooltip } from "./tooltip-position.js";
import { openAIAgentWithAttachment, buildPlatformCourseAttachment } from "../../components/ai-agent/ai-agent-attach-launcher.js";
import { HOME_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { SPARKLE_ICON_SVG } from "./icons.js";

const EDU_TYPE_AR = {
  University: "جامعي",
  High: "ثانوي",
  Middle: "إعدادي",
  Primary: "إبتدائي",
  Featured: "كورسات مميزة",
};

/**
 * Builds the `.course-info-container` (info button + tooltip) for a course
 * card and appends it to `card`. Wires up click/tap-to-toggle behavior,
 * optionally including an "إلغاء الإشتراك" (unsubscribe) button inside the
 * tooltip.
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
  infoBtn.setAttribute("aria-haspopup", "true");
  infoBtn.setAttribute("aria-expanded", "false");

  const tooltip = document.createElement("div");
  tooltip.className = "course-info-tooltip tooltip-interactive";
  tooltip.setAttribute("role", "dialog");

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
      <button class="tooltip-ask-ai-btn" type="button">
        ${SPARKLE_ICON_SVG}
        <span>اسأل الباشـمبصمج</span>
      </button>
      <button class="tooltip-delete-btn" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
        <span>إلغاء الإشتراك</span>
      </button>
    `;
  } else {
    tooltip.innerHTML = `
      ${courseInfoHtml}
      <hr class="tooltip-divider">
      <button class="tooltip-ask-ai-btn" type="button">
        ${SPARKLE_ICON_SVG}
        <span>اسأل الباشـمبصمج</span>
      </button>
    `;
  }

  infoContainer.appendChild(infoBtn);
  // The tooltip is intentionally NOT appended inside `card`/`infoContainer`.
  // `.category-card`/`.exam-card`/`.card` all get `transform` on `:hover`
  // (the lift animation) and also have `overflow: hidden`. Per spec, an
  // ancestor with `transform` becomes the containing block for any
  // `position: fixed` descendant — so the instant the card is hovered, this
  // tooltip's viewport-relative `top`/`left` would suddenly be reinterpreted
  // relative to the card's box instead, and get clipped by the card's
  // `overflow: hidden` in the process. That's why `.show` stayed on the
  // element in DevTools while it visually vanished: nothing was hiding it,
  // it was being clipped/repositioned out of view by its own ancestor.
  // Appending it to <body> — the same approach already used for
  // `.exam-dropdown-menu` — keeps it a sibling of the card instead of a
  // descendant, so the card's hover transform can never touch it.
  document.body.appendChild(tooltip);

  // ── Single-exit-point dismiss lifecycle ───────────────────────────────────
  // Mirrors openExamDropdownMenu()/closeMenu() in exam-dropdown-menu.js:
  // exactly one close path, wired to outside click / Escape / scroll /
  // resize, so listeners are always cleaned up regardless of which of those
  // fires. Unlike the dropdown menu, this tooltip is a permanent child of
  // the card (not appended/removed from <body> per open) — it's toggled via
  // the `.show` class instead of being mounted/unmounted, so `isOpen` tracks
  // state locally rather than DOM presence.
  let isOpen = false;

  function closeTooltip() {
    if (!isOpen) return;
    isOpen = false;
    tooltip.classList.remove("show");
    infoBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutsideClick);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", closeTooltip);
    window.removeEventListener("scroll", onScroll, true);
  }

  function onOutsideClick(e) {
    if (tooltip.contains(e.target) || infoBtn.contains(e.target)) return;
    closeTooltip();
  }

  function onKeydown(e) {
    if (e.key === "Escape") closeTooltip();
  }

  function onScroll(e) {
    if (tooltip.contains(e.target)) return; // scrolling inside the tooltip itself
    // Only treat this as "the page scrolled out from under the tooltip" when
    // the event actually originates from the document/viewport scrolling.
    // With `{ capture: true }` this listener also receives scroll events
    // bubbling from unrelated elements — including spurious ones a browser
    // can fire when a nested element's layout shifts (e.g. a card's
    // hover-lift `transform` transition). Those aren't real page scrolls
    // and shouldn't close a tooltip whose trigger hasn't actually moved.
    const target = e.target;
    const isRealPageScroll =
      target === document ||
      target === window ||
      target === document.documentElement ||
      target === document.body;
    if (!isRealPageScroll) return;
    closeTooltip();
  }

  function openTooltip() {
    // Only one tooltip open at a time. Other open tooltips belong to other
    // attachCourseInfoTooltip() closures (each card gets its own), so they
    // can't be reached directly here — toggling their `.show` class off
    // is enough to hide them visually and matches what the previous
    // implementation did; their own outside-click listener stays attached
    // until the user's next interaction (harmless — closeTooltip() checks
    // `.show` state next time it fires, and a fresh click resets it) is
    // avoided below by clearing aria-expanded too, which is the only other
    // piece of state a hidden tooltip carries.
    document.querySelectorAll(".course-info-tooltip.show").forEach((t) => {
      if (t !== tooltip) t.classList.remove("show");
    });
    document
      .querySelectorAll('.course-info-btn[aria-expanded="true"]')
      .forEach((btn) => {
        if (btn !== infoBtn) btn.setAttribute("aria-expanded", "false");
      });

    isOpen = true;
    positionCourseInfoTooltip(tooltip, infoBtn);
    tooltip.classList.add("show");
    infoBtn.setAttribute("aria-expanded", "true");

    document.addEventListener("click", onOutsideClick);
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", closeTooltip);
    window.addEventListener("scroll", onScroll, true);
  }

  const askAiBtn = tooltip.querySelector(".tooltip-ask-ai-btn");
  if (askAiBtn) {
    askAiBtn.onclick = (e) => {
      e.stopPropagation();
      closeTooltip();
      openAIAgentWithAttachment(buildPlatformCourseAttachment(course), {
        defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT,
      });
    };
  }

  if (withUnsubscribe) {
    const deleteBtn = tooltip.querySelector(".tooltip-delete-btn");
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (await _confirm("هل أنت متأكد من إلغاء الإشتراك في هذه المادة؟")) {
        const subscribed = userProfile.getSubscribedCourseIds();
        userProfile.setSubscribedCourses(
          subscribed.filter((id) => id !== course.id),
        );
        closeTooltip();
        if (onUnsubscribe) onUnsubscribe();
      }
    };
  }

  infoBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOpen) {
      closeTooltip();
    } else {
      openTooltip();
    }
  };
  tooltip.onclick = (e) => e.stopPropagation();

  card.appendChild(infoContainer);
}
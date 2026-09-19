// ============================================================================
// public/src/features/lesson/lesson-toc.js
// LESSON TABLE OF CONTENTS — section jump-nav with visited checkmarks.
// ============================================================================
// ── Why this isn't features/documents/doc-toc.js ────────────────────────────
// That module was the starting point (per the lessons plan's Phase 2 step 4)
// but it can't be imported: it exports nothing at all — it's a side-effect
// script that, on load, scans the DOM for `.page-wrapper .section h2[id]`
// and builds a ToC from whatever static markup it finds. Lessons are the
// opposite case: sections come from jsonb, are rendered dynamically, can be
// hidden/revealed after an answer, and carry visited state. So this is a
// lesson-specific variant that keeps doc-toc.js's two good ideas — a
// scroll-spy active link, and a collapsed floating toggle on narrow screens
// — without inheriting its static-markup coupling.
// ============================================================================

import { escapeHtml } from "../home/escape-html.js";
import { markSectionVisited } from "./lesson-schema.js";

/**
 * Builds the ToC markup for the currently-visible sections.
 *
 * @param {Array<{id:string,title:string}>} visibleSections
 * @param {string[]} visitedSectionIds
 * @returns {string}
 */
export function renderLessonToc(visibleSections, visitedSectionIds) {
  const titled = visibleSections.filter((s) => s.title);
  // Below two entries a jump-nav is just noise — same "don't render for a
  // single heading" judgement doc-toc.js makes.
  if (titled.length < 2) return "";

  const visited = new Set(visitedSectionIds || []);
  const items = titled
    .map(
      (section) =>
        `<li class="lesson-toc__item${visited.has(section.id) ? " is-visited" : ""}">` +
        `<a class="lesson-toc__link" href="#lesson-section-${escapeHtml(section.id)}" ` +
        `data-section-id="${escapeHtml(section.id)}">` +
        `<span class="lesson-toc__check" aria-hidden="true"></span>` +
        `<span class="lesson-toc__text">${escapeHtml(section.title)}</span>` +
        `</a></li>`,
    )
    .join("");

  return (
    `<nav class="lesson-toc" aria-label="محتويات الدرس">` +
    `<button type="button" class="lesson-toc__toggle" aria-expanded="false">المحتويات</button>` +
    `<ol class="lesson-toc__list">${items}</ol>` +
    `</nav>`
  );
}

/**
 * Wires the ToC: smooth-scroll on click, the narrow-screen collapse toggle,
 * and a scroll-spy that marks sections visited as the reader reaches them.
 *
 * Scroll-spy uses IntersectionObserver here (unlike doc-toc.js, which
 * deliberately avoids IO-only tracking for its active-link highlight). The
 * difference is what's being tracked: "has the reader reached this section
 * at all" is a one-way latch, so a fast scroll that skips an observer band
 * only delays a checkmark until the next scroll — it can't leave the wrong
 * section permanently marked the way a bidirectional active-link highlight
 * could. The active-link highlight below is driven off the same entries and
 * is purely cosmetic.
 *
 * @param {HTMLElement} root - the lesson container
 * @param {string} lessonId
 */
export function equipLessonToc(root, lessonId) {
  if (!root) return;
  const toc = root.querySelector(".lesson-toc");

  if (toc) {
    const toggle = toc.querySelector(".lesson-toc__toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const open = toc.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(open));
      });
    }

    toc.querySelectorAll(".lesson-toc__link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const sectionId = link.dataset.sectionId;
        const target = root.querySelector(`#lesson-section-${CSS.escape(sectionId)}`);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        markSectionVisited(lessonId, sectionId);
        markTocVisited(root, sectionId);
        toc.classList.remove("is-open");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const sections = Array.from(root.querySelectorAll(".lesson-section"));
  if (sections.length === 0) return;

  if (typeof IntersectionObserver !== "function") {
    // No IO support — mark everything currently rendered as visited rather
    // than leaving the ToC permanently unchecked.
    sections.forEach((s) => {
      if (s.dataset.sectionId) markSectionVisited(lessonId, s.dataset.sectionId);
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const sectionId = entry.target.dataset.sectionId;
        if (!sectionId) continue;
        markSectionVisited(lessonId, sectionId);
        markTocVisited(root, sectionId);
        setActiveTocLink(root, sectionId);
      }
    },
    { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
  );
  sections.forEach((section) => observer.observe(section));
}

function markTocVisited(root, sectionId) {
  const link = root.querySelector(`.lesson-toc__link[data-section-id="${CSS.escape(sectionId)}"]`);
  if (link) link.closest(".lesson-toc__item")?.classList.add("is-visited");
}

function setActiveTocLink(root, sectionId) {
  root.querySelectorAll(".lesson-toc__item").forEach((item) => item.classList.remove("is-active"));
  const link = root.querySelector(`.lesson-toc__link[data-section-id="${CSS.escape(sectionId)}"]`);
  if (link) link.closest(".lesson-toc__item")?.classList.add("is-active");
}
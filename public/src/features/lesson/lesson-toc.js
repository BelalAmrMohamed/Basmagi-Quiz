// ============================================================================
// LESSON TABLE OF CONTENTS — same interaction model as documents/.doc-toc.
// ============================================================================

import { escapeHtml } from "../home/escape-html.js";
import { markSectionVisited } from "./lesson-schema.js";
import { registerLessonPanel } from "./lesson-panel-manager.js";
import { createGeometryTocScrollSpy } from "../../shared/toc-scroll-spy.js";

const MINIMIZED_KEY = "lesson_toc_minimized";

export function renderLessonToc(visibleSections, visitedSectionIds) {
  const titled = (visibleSections || []).filter((section) => section?.title);
  if (titled.length < 2) return "";

  const items = titled.map((section) => (
    `<li><a class="doc-toc-link" href="#lesson-section-${escapeHtml(section.id)}" data-section-id="${escapeHtml(section.id)}">${escapeHtml(section.title)}</a></li>`
  )).join("");

  return (
    `<nav class="doc-toc lesson-toc" id="lessonTocPanel" aria-label="محتويات الدرس">` +
    `<div class="doc-toc-heading">` +
    `<span class="doc-toc-heading-label">محتويات الدرس</span>` +
    `<button type="button" class="doc-toc-minimize-btn" data-lesson-toc-minimize aria-controls="lessonTocPanel" aria-expanded="true" aria-label="طي محتويات الدرس" title="طي المحتويات">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>` +
    `</button></div>` +
    `<ul class="doc-toc-list">${items}</ul>` +
    `</nav>` +
    `<button type="button" class="doc-toc-toggle" data-lesson-toc-mobile-toggle aria-expanded="false" aria-controls="lessonTocPanel">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>` +
    `<span>المحتويات</span></button>`
  );
}

export function equipLessonToc(root, lessonId) {
  const toc = root?.querySelector(".lesson-toc");
  if (!toc) return;

  const list = toc.querySelector(".doc-toc-list");
  const mobileToggle = root?.querySelector("[data-lesson-toc-mobile-toggle]");
  const minimizeBtn = toc.querySelector("[data-lesson-toc-minimize]");
  if (!list || !mobileToggle) return;

  const closeMobile = () => {
    toc.classList.remove("doc-toc-open");
    mobileToggle.setAttribute("aria-expanded", "false");
  };
  const setMobileOpen = (open) => {
    toc.classList.toggle("doc-toc-open", open);
    mobileToggle.setAttribute("aria-expanded", String(open));
  };

  const unregisterPanel = registerLessonPanel({
    toggle: mobileToggle,
    panel: toc,
    isOpen: () => toc.classList.contains("doc-toc-open"),
    setOpen: setMobileOpen,
  });

  let minimized = false;
  try { minimized = localStorage.getItem(MINIMIZED_KEY) === "true"; } catch (_) {}
  const setMinimized = (value) => {
    toc.classList.toggle("doc-toc-minimized", value);
    minimizeBtn?.setAttribute("aria-expanded", value ? "false" : "true");
    if (minimizeBtn) {
      minimizeBtn.setAttribute("aria-label", value ? "إظهار محتويات الدرس" : "طي محتويات الدرس");
      minimizeBtn.title = value ? "إظهار المحتويات" : "طي المحتويات";
    }
    try { localStorage.setItem(MINIMIZED_KEY, value ? "true" : "false"); } catch (_) {}
  };
  setMinimized(minimized);

  minimizeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    setMinimized(!toc.classList.contains("doc-toc-minimized"));
  });
  toc.addEventListener("click", (event) => {
    if (!toc.classList.contains("doc-toc-minimized")) return;
    if (event.target.closest("a")) return;
    setMinimized(false);
  });

  const links = [...toc.querySelectorAll(".doc-toc-link")];
  const sections = links
    .map((link) => root.querySelector(`#lesson-section-${CSS.escape(link.dataset.sectionId)}`))
    .filter(Boolean);
  if (!sections.length) {
    unregisterPanel();
    return;
  }

  const linkById = new Map(links.map((link) => [link.dataset.sectionId, link]));
  const setActive = (id) => {
    links.forEach((link) => link.classList.toggle("doc-toc-link--active", link.dataset.sectionId === id));
  };
  const markVisited = (id) => {
    markSectionVisited(lessonId, id);
    linkById.get(id)?.classList.add("doc-toc-link--visited");
  };
  const spy = createGeometryTocScrollSpy({
    targets: sections,
    onActive: setActive,
    markVisited,
    onNavigate: (id, event) => {
      event?.preventDefault();
      const target = root.querySelector(`#lesson-section-${CSS.escape(id)}`);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      closeMobile();
    },
  });

  list.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    const id = link.dataset.sectionId;
    if (!linkById.has(id)) return;
    spy.handleNavigate(id, event);
  });

  // Keep the lifecycle explicit because paint() replaces innerHTML. Old
  // scroll listeners must be removed, otherwise every answered question
  // would add another scroll-spy to the document.
  return () => {
    unregisterPanel();
    spy.cleanup();
  };
}

// ============================================================================
// public/src/features/lesson/lesson-section-nav.js
// Sidebar section navigator for /lesson/:id (+ heading anchors, j/k keys).
// ============================================================================
// Lives inside the global sidebar <nav> (not the disabled floating TOC in
// lesson-toc.js). Lists titled sections with read time, marks visited ones,
// highlights the current one via the shared geometry scroll spy, and hides
// adaptive sections until they are revealed (watched through the section's
// own `hidden` attribute, so no coupling to lesson-view's reveal code).
// Local-only: reads/writes the same localStorage progress as the lesson page.
// ============================================================================

import { escapeHtml } from "../home/escape-html.js";
import { createGeometryTocScrollSpy } from "../../shared/toc-scroll-spy.js";
import { getLessonProgress, markSectionVisited } from "./lesson-schema.js";
import { lessonIcon } from "./lesson-icons.js";

const WORDS_PER_MINUTE = 180;
const MOBILE_BP = 768; // keep in sync with side-menu.js MOBILE_BP

function sectionReadMinutes(section) {
  let words = 0;
  for (const block of section.blocks || []) {
    if (block?.type === "markdown" && typeof block.body === "string") {
      words += block.body.trim().split(/\s+/).filter(Boolean).length;
    }
  }
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

function scrollBehavior() {
  return document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth";
}

function isTypingTarget(el) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/**
 * @param {HTMLElement} root - the lesson container
 * @param {object} lesson - fetched lesson row (id, slug)
 * @param {object} normalized - normalizeLessonContent() result
 * @returns {() => void} cleanup
 */
export function equipLessonSectionNav(root, lesson, normalized) {
  const nav = document.querySelector("#sidebar nav");
  const themeSection = nav?.querySelector(".theme-controls-section");
  const lessonId = lesson.id;
  const sections = (normalized.sections || []).filter((s) => s.title);
  const cleanups = [];

  // ── Heading anchors (work even without a sidebar) ──────────────────────
  const onRootClick = async (event) => {
    const btn = event.target.closest("[data-section-anchor]");
    if (!btn || !root.contains(btn)) return;
    const id = btn.dataset.sectionAnchor;
    const url = `${window.location.origin}/lesson/${encodeURIComponent(lesson.slug || lessonId)}#lesson-section-${id}`;
    if (!(await copyText(url))) return;
    btn.classList.add("is-copied");
    btn.innerHTML = lessonIcon("check");
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => {
      btn.classList.remove("is-copied");
      btn.innerHTML = lessonIcon("link");
    }, 1800);
  };
  root.addEventListener("click", onRootClick);
  cleanups.push(() => root.removeEventListener("click", onRootClick));

  if (!nav || !themeSection || !sections.length) {
    return () => cleanups.forEach((fn) => fn());
  }

  // ── Sidebar block ──────────────────────────────────────────────────────
  nav.querySelectorAll(".lesson-section-nav").forEach((el) => el.remove());
  const block = document.createElement("div");
  block.className = "lesson-section-nav";
  const items = sections
    .map((s) =>
      `<li class="lesson-section-nav__item" data-nav-section="${escapeHtml(s.id)}">` +
      `<button type="button" class="lesson-section-nav__link" data-nav-target="${escapeHtml(s.id)}" title="${escapeHtml(s.title)} (j / k للتنقل)">` +
      `<span class="lesson-section-nav__dot" aria-hidden="true"></span>` +
      `<span class="lesson-section-nav__title">${escapeHtml(s.title)}</span>` +
      `<span class="lesson-section-nav__time">${sectionReadMinutes(s)} د</span>` +
      `</button></li>`,
    )
    .join("");
  block.innerHTML =
    `<button type="button" class="theme-section-header sidebar-collapsed-only" data-tooltip="أقسام الدرس" title="أقسام الدرس" aria-label="فتح قائمة أقسام الدرس">` +
    `${lessonIcon("list")}</button>` +
    `<div class="lesson-section-nav__panel sidebar-expanded-only">` +
    `<div class="lesson-section-nav__heading">أقسام الدرس</div>` +
    `<ol class="lesson-section-nav__list">${items}</ol>` +
    `</div>`;
  const anchorEl = themeSection.previousElementSibling?.classList.contains("menu-divider")
    ? themeSection.previousElementSibling
    : themeSection;
  // The existing divider above the theme section already separates us from it.
  nav.insertBefore(block, anchorEl);
  cleanups.push(() => block.remove());

  const sectionEl = (id) => root.querySelector(`#lesson-section-${CSS.escape(id)}`);
  const itemEl = (id) => block.querySelector(`[data-nav-section="${CSS.escape(id)}"]`);

  const refresh = () => {
    const visited = new Set(getLessonProgress(lessonId).visitedSections || []);
    sections.forEach((s) => {
      const li = itemEl(s.id);
      if (!li) return;
      const el = sectionEl(s.id);
      li.hidden = !el || el.hasAttribute("hidden");
      li.classList.toggle("is-visited", visited.has(s.id));
    });
  };
  refresh();

  // Adaptive sections flip their own `hidden` attribute when revealed.
  const observer = new MutationObserver(refresh);
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
  cleanups.push(() => observer.disconnect());

  // ── Active section (shared geometry spy) ───────────────────────────────
  let activeId = null;
  const setActive = (id) => {
    activeId = id;
    block.querySelectorAll(".lesson-section-nav__item").forEach((li) => {
      const on = li.dataset.navSection === id;
      li.classList.toggle("is-active", on);
      const btn = li.querySelector("button");
      if (on) btn?.setAttribute("aria-current", "true");
      else btn?.removeAttribute("aria-current");
    });
  };
  const targets = sections.map((s) => sectionEl(s.id)).filter(Boolean);
  const spy = createGeometryTocScrollSpy({
    targets,
    onActive: setActive,
    markVisited: (id) => { markSectionVisited(lessonId, id); refresh(); },
    onNavigate: (id, event) => {
      event?.preventDefault?.();
      sectionEl(id)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    },
  });
  if (spy?.cleanup) cleanups.push(spy.cleanup);

  const closeMobileSheet = () => {
    if (window.innerWidth <= MOBILE_BP) document.getElementById("closeMenuBtn")?.click();
  };

  const onBlockClick = (event) => {
    const link = event.target.closest("[data-nav-target]");
    if (link) {
      spy?.handleNavigate?.(link.dataset.navTarget, event);
      closeMobileSheet();
      return;
    }
    // Collapsed rail: same pattern as the theme icon — just expand the sidebar.
    if (event.target.closest(".sidebar-collapsed-only") && window.innerWidth > MOBILE_BP) {
      document.getElementById("sidebarExpandBtn")?.click();
    }
  };
  block.addEventListener("click", onBlockClick);

  // ── j / k shortcuts ────────────────────────────────────────────────────
  const onKey = (event) => {
    if (event.key !== "j" && event.key !== "k") return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
    if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;
    if (document.querySelector("dialog[open]")) return;
    const visible = sections.filter((s) => {
      const el = sectionEl(s.id);
      return el && !el.hasAttribute("hidden");
    });
    if (!visible.length) return;
    const currentIndex = Math.max(0, visible.findIndex((s) => s.id === activeId));
    const nextIndex = Math.min(visible.length - 1, Math.max(0, currentIndex + (event.key === "j" ? 1 : -1)));
    if (nextIndex === currentIndex && activeId) return;
    event.preventDefault();
    spy?.handleNavigate?.(visible[nextIndex].id);
  };
  document.addEventListener("keydown", onKey);
  cleanups.push(() => document.removeEventListener("keydown", onKey));

  return () => cleanups.forEach((fn) => fn());
}

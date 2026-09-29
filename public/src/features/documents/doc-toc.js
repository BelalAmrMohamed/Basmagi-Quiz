// ============================================================================
// public/src/features/documents/doc-toc.js
// STICKY TABLE OF CONTENTS — reference-style doc pages
// ============================================================================
// Auto-generates a sticky in-page ToC from every `.page-wrapper .section
// h2[id]` on the page (the same numbered-section pattern already used by
// privacy-policy.html, terms-of-service.html, and how-to-use-ai-agent.html —
// each h2 already carries a stable id like #s1..#s6 for deep-linking).
//
// Deliberately generic: no page needs to opt in explicitly beyond including
// this script. If a doc page has 2+ matching headings, the ToC renders;
// otherwise this is a no-op (e.g. the two "coming soon" stub docs only have
// one placeholder heading each, so they don't include this script at all).
//
// Highlights the section currently in view, and collapses to a compact
// floating toggle on narrow screens rather than eating permanent width from
// the reading column.
//
// ── Why this isn't IntersectionObserver-only ────────────────────────────────
// A previous version tracked active state purely off IO's `isIntersecting`
// entries inside a thin `rootMargin` band. That's exactly the kind of setup
// that goes wrong on fast scrolls or fast wheel/trackpad flicks: IO only
// fires when an observed element's intersection ratio crosses the
// threshold, so a heading whose entire "band" gets skipped between two
// consecutive frames never fires an event at all, leaving the observer's
// internal state stale — and clicking a link jumps to a heading immediately,
// which can itself skip past the band in one frame the same way, so the
// freshly clicked section's neighbor (whichever one happened to still be
// "intersecting" from the pre-click scroll position) gets marked active
// instead. Both reported symptoms — "goes through elements in an unexpected
// way" and "highlights the one above/under" the clicked link — trace back
// to the same root cause: relying on discrete intersection *events* instead
// of directly asking "which heading is closest to my reference line right
// now" on every scroll frame.
//
// This version is purely geometry-based, re-evaluated on a throttled
// scroll/resize listener, which cannot skip a frame the way IO's threshold
// crossings can.
// ============================================================================

import { createGeometryTocScrollSpy } from "../../shared/toc-scroll-spy.js";

function buildToc() {
  // Reference-style docs (privacy/terms/ai-agent) use `.page-wrapper >
  // .section > h2[id]`; about.html's bespoke storytelling layout uses
  // `.about-section > .about-section-heading > h2[id]` instead (plus one
  // `.creator` section with a directly-nested h2). Both patterns are
  // covered here since the plan calls out about.html by name alongside the
  // privacy/terms pages as pages that would benefit from a ToC.
  const headings = Array.from(
    document.querySelectorAll(
      ".page-wrapper > .section > h2[id], .about-section h2[id]",
    ),
  );
  if (headings.length < 2) return; // not worth a ToC for a single section

  const nav = document.createElement("nav");
  nav.className = "doc-toc";
  nav.setAttribute("aria-label", "محتويات الصفحة");

  const heading = document.createElement("div");
  heading.className = "doc-toc-heading";

  const headingLabel = document.createElement("span");
  headingLabel.className = "doc-toc-heading-label";
  headingLabel.textContent = "محتويات الصفحة";
  heading.appendChild(headingLabel);

  // Desktop-only minimize control — the panel is `position: fixed` at
  // vertical-center, so on shorter/narrower content it can sit on top of
  // paragraph text instead of beside it. Phones already get their own
  // collapse-to-toggle behavior below; this gives desktop an equivalent
  // "get it out of my way" affordance by sliding the whole panel almost
  // entirely off the left edge of the screen (a thin sliver stays
  // visible/clickable as a handle) rather than shrinking it in place —
  // see the .doc-toc-minimized rules in documents.css for the
  // actual slide.
  const MINIMIZED_KEY = "doc_toc_minimized";
  const minimizeBtn = document.createElement("button");
  minimizeBtn.type = "button";
  minimizeBtn.className = "doc-toc-minimize-btn";
  minimizeBtn.setAttribute("aria-controls", "docTocPanel");
  minimizeBtn.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>`;
  heading.appendChild(minimizeBtn);
  nav.appendChild(heading);

  function setMinimized(minimized) {
    nav.classList.toggle("doc-toc-minimized", minimized);
    minimizeBtn.setAttribute("aria-expanded", minimized ? "false" : "true");
    minimizeBtn.setAttribute(
      "aria-label",
      minimized ? "إظهار محتويات الصفحة" : "طي محتويات الصفحة",
    );
    minimizeBtn.title = minimized ? "إظهار المحتويات" : "طي المحتويات";
    try {
      localStorage.setItem(MINIMIZED_KEY, minimized ? "true" : "false");
    } catch (_) { }
  }

  minimizeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setMinimized(!nav.classList.contains("doc-toc-minimized"));
  });

  // Clicking anywhere on the minimized pill re-expands it, not just the
  // small chevron button — the whole thing is a compact affordance at
  // that point, and hunting for a precise hitbox is unnecessary friction.
  nav.addEventListener("click", (e) => {
    if (!nav.classList.contains("doc-toc-minimized")) return;
    if (e.target.closest("a")) return; // shouldn't exist while minimized, but stay safe
    setMinimized(false);
  });

  let startMinimized = false;
  try {
    startMinimized = localStorage.getItem(MINIMIZED_KEY) === "true";
  } catch (_) { }
  if (startMinimized) setMinimized(true);
  else minimizeBtn.setAttribute("aria-expanded", "true");

  const list = document.createElement("ul");
  list.className = "doc-toc-list";

  const linkByHeadingId = new Map();
  headings.forEach((h2) => {
    // The h2 may contain a nested .section-badge span — that shouldn't leak
    // into the ToC label, so pull text from the heading's own text nodes
    // only (first meaningful line), not the whole subtree.
    const label = Array.from(h2.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent.trim())
      .filter(Boolean)
      .join(" ") || h2.textContent.trim();

    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#${h2.id}`;
    link.textContent = label;
    link.className = "doc-toc-link";
    li.appendChild(link);
    list.appendChild(li);
    linkByHeadingId.set(h2.id, link);
  });
  nav.appendChild(list);

  // Mobile: collapse behind a small floating toggle instead of permanently
  // consuming reading-column width — the sidebar rail on desktop already
  // has room, phones don't.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "doc-toc-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "docTocPanel");
  toggle.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>` +
    `<span>المحتويات</span>`;
  nav.id = "docTocPanel";

  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("doc-toc-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  document.body.appendChild(toggle);
  document.body.appendChild(nav);

  // Close the mobile panel after choosing a section, and after any outside
  // click/tap — otherwise it stays pinned open over the content.
  document.addEventListener("click", (e) => {
    if (!nav.classList.contains("doc-toc-open")) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    nav.classList.remove("doc-toc-open");
    toggle.setAttribute("aria-expanded", "false");
  });

  const spy = createGeometryTocScrollSpy({
    targets: headings,
    onActive: (id) => {
      linkByHeadingId.forEach((link, linkId) => {
        link.classList.toggle("doc-toc-link--active", linkId === id);
      });
    },
    onNavigate: (id, event) => {
      const link = linkByHeadingId.get(id);
      if (!link) return;
      // Preserve native hash navigation; the spy only locks the active item.
      // `event.preventDefault()` is deliberately not used here.
      void event;
    },
  });

  list.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;
    const id = link.getAttribute("href").slice(1);
    spy.handleNavigate(id, e);
    nav.classList.remove("doc-toc-open");
    toggle.setAttribute("aria-expanded", "false");
  });

}

buildToc();
// ============================================================================
// public/src/features/privacy-and-terms/doc-toc.js
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

  // A heading flush against the very top edge of the viewport reads as
  // "just barely visible, technically" rather than "the section I'm
  // reading" — giving every heading some breathing room above it (and
  // telling the browser's native anchor-jump the same thing via
  // scroll-margin-top) means the active link changes right around when a
  // section's content actually starts filling the screen, and a clicked
  // link lands the heading at that same reference line instead of flush
  // against the very top edge.
  const REFERENCE_OFFSET = Math.max(96, Math.round(window.innerHeight * 0.18));
  headings.forEach((h2) => {
    h2.style.scrollMarginTop = `${REFERENCE_OFFSET}px`;
  });

  const nav = document.createElement("nav");
  nav.className = "doc-toc";
  nav.setAttribute("aria-label", "محتويات الصفحة");

  const heading = document.createElement("div");
  heading.className = "doc-toc-heading";
  heading.textContent = "محتويات الصفحة";
  nav.appendChild(heading);

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
  list.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      nav.classList.remove("doc-toc-open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("click", (e) => {
    if (!nav.classList.contains("doc-toc-open")) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    nav.classList.remove("doc-toc-open");
    toggle.setAttribute("aria-expanded", "false");
  });

  function setActive(id) {
    linkByHeadingId.forEach((link, linkId) => {
      link.classList.toggle("doc-toc-link--active", linkId === id);
    });
  }

  // The single source of truth for "which section is active": whichever
  // heading's top edge is the closest one at-or-above the reference line,
  // falling back to the first heading if we're above all of them (top of
  // the document) and to the last heading if we've scrolled past all of
  // them (bottom of the document — common when the last section's own
  // content is shorter than the viewport). Pure geometry, computed fresh
  // every time it's called — nothing here can go "stale" the way tracking
  // discrete enter/exit events can.
  function computeActiveId() {
    let activeId = headings[0].id;
    for (const h2 of headings) {
      if (h2.getBoundingClientRect().top - REFERENCE_OFFSET <= 0) {
        activeId = h2.id;
      } else {
        break; // headings are in document order, so nothing after this can qualify either
      }
    }
    // Reached (or overscrolled past) the bottom of the page: the last
    // section should read as active even if its own heading scrolled far
    // above the reference line long ago.
    const doc = document.documentElement;
    if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
      activeId = headings[headings.length - 1].id;
    }
    return activeId;
  }

  // While a click-triggered smooth scroll is still animating toward its
  // target, the scroll listener below keeps firing on every intermediate
  // frame and recomputing "closest heading to the reference line" against
  // geometry that hasn't settled yet — which very often names the heading
  // one-above the clicked link as active mid-flight, stomping the class
  // `setActive` just applied. The listener's *next* fire after the scroll
  // finally lands recomputes correctly, but by then the visible symptom is
  // "the right section only highlights after a second click." Locking the
  // active id to the clicked target for the duration of that scroll (instead
  // of letting geometry recompute override it) removes the race outright.
  let lockedId = null;
  let unlockTimer = null;

  function clearLock() {
    lockedId = null;
    if (unlockTimer) {
      clearTimeout(unlockTimer);
      unlockTimer = null;
    }
  }

  let ticking = false;
  function scheduleUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      if (!lockedId) setActive(computeActiveId());
      ticking = false;
    });
  }

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);

  // Clicking a link jumps immediately via the native `#hash` navigation —
  // no need to intercept it — but recompute right away too (rather than
  // waiting for the scroll event, which can lag a frame or two behind a
  // smooth-scroll's start) so the correct link highlights the instant the
  // click happens, not a moment later. The lock keeps it stuck through the
  // ensuing smooth-scroll animation; a manual scroll/resize after that
  // (or a 1s safety timeout, in case the browser's smooth-scroll never
  // reports "settled") releases it back to normal geometry tracking.
  list.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;
    const id = link.getAttribute("href").slice(1);
    lockedId = id;
    setActive(id);
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(clearLock, 1000);
  });

  // Any scroll/resize the user initiates themselves after the lock should
  // resume normal tracking rather than staying pinned to a stale click.
  window.addEventListener("wheel", clearLock, { passive: true });
  window.addEventListener("touchmove", clearLock, { passive: true });

  scheduleUpdate();
}

buildToc();
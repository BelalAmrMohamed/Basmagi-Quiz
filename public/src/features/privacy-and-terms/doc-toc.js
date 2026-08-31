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
// Highlights the section currently in view via IntersectionObserver, and
// collapses to a compact floating toggle on narrow screens rather than
// eating permanent width from the reading column.
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

  // Highlight whichever section is currently most in view.
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const link = linkByHeadingId.get(entry.target.id);
        if (!link) return;
        link.classList.toggle("doc-toc-link--active", entry.isIntersecting);
      });
    },
    { rootMargin: "-15% 0px -70% 0px" },
  );
  headings.forEach((h2) => observer.observe(h2));
}

buildToc();

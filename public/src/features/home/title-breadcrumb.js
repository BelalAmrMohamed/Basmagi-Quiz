// ============================================================================
// public/src/features/home/title-breadcrumb.js
// TITLE BREADCRUMB — smart, collapsible inline breadcrumb rendered inside
// the #Subjects-text element (or any container element passed to it).
//
// Design:
//   • Always shows the first item (root) and the last item (current page).
//   • Collapses intermediate items into a single "…" button when:
//       – the wrapper overflows its container, OR
//       – items.length exceeds `options.maxItems` (default 4).
//   • Clicking "…" opens a floating dropdown listing all hidden items;
//     clicking outside or clicking "…" again closes it.
//   • Labels are CSS-truncated with text-overflow:ellipsis.
//   • A ResizeObserver re-evaluates collapse every time the container resizes.
// ============================================================================

/**
 * Render a smart collapsible breadcrumb inside `titleEl`.
 *
 * @param {HTMLElement} titleEl - The container (e.g. the #Subjects-text element).
 * @param {Array<{label: string, onClick?: () => void}>} items
 *   Ordered path items. Last item has no `onClick` (it is the current page).
 * @param {object}  [options]
 * @param {number}  [options.maxItems=4]  Collapse if items.length > maxItems.
 */
export function renderTitleBreadcrumb(titleEl, items, options = {}) {
  // ── Cleanup from any previous invocation ─────────────────────────────────
  if (titleEl._breadcrumbObserver) {
    titleEl._breadcrumbObserver.disconnect();
    titleEl._breadcrumbObserver = null;
  }
  if (titleEl._breadcrumbCleanup) {
    titleEl._breadcrumbCleanup();
    titleEl._breadcrumbCleanup = null;
  }

  titleEl.style.display = "";
  titleEl.style.alignItems = "";
  titleEl.style.gap = "";
  titleEl.style.flexWrap = "";
  titleEl.innerHTML = "";

  if (!items || items.length === 0) return;

  // Single item: no interactive breadcrumb needed
  if (items.length === 1) {
    titleEl.textContent = items[0].label;
    return;
  }

  const wrapper = document.createElement("nav");
  wrapper.className = "title-breadcrumb";
  wrapper.setAttribute("aria-label", "مسار التنقل");
  titleEl.appendChild(wrapper);

  let activeDropdown = null;

  function closeDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
      const btn = wrapper.querySelector(".title-breadcrumb-ellipsis");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
  }

  function buildItem(label, onClick, isCurrent = false, isRoot = false) {
    const el = document.createElement(isCurrent ? "span" : "a");
    el.className =
      "title-breadcrumb-item" +
      (isCurrent ? " title-breadcrumb-item--current" : "") +
      (isRoot ? " title-breadcrumb-item--root" : "");
    el.textContent = label;
    el.title = label;
    if (!isCurrent && onClick) {
      el.href = "javascript:void(0)";
      el.addEventListener("click", (e) => { e.preventDefault(); closeDropdown(); onClick(); });
    }
    return el;
  }

  function buildSep() {
    const sep = document.createElement("span");
    sep.className = "title-breadcrumb-sep";
    sep.setAttribute("aria-hidden", "true");
    return sep;
  }

  function render(collapsed) {
    wrapper.innerHTML = "";
    closeDropdown();

    const first = items[0];
    const last = items[items.length - 1];
    const middle = items.slice(1, items.length - 1);

    wrapper.appendChild(buildItem(first.label, first.onClick, false, true));

    if (collapsed && middle.length > 0) {
      wrapper.appendChild(buildSep());

      const ellipsisBtn = document.createElement("button");
      ellipsisBtn.type = "button";
      ellipsisBtn.className = "title-breadcrumb-ellipsis";
      ellipsisBtn.setAttribute("aria-label", "عرض المسار الكامل");
      ellipsisBtn.setAttribute("aria-expanded", "false");
      ellipsisBtn.setAttribute("aria-haspopup", "menu");
      ellipsisBtn.textContent = "…";

      ellipsisBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (activeDropdown) { closeDropdown(); return; }

        const dropdown = document.createElement("ul");
        dropdown.className = "title-breadcrumb-dropdown";
        dropdown.setAttribute("role", "menu");

        middle.forEach((item) => {
          const li = document.createElement("li");
          li.setAttribute("role", "none");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "title-breadcrumb-dropdown-item";
          btn.setAttribute("role", "menuitem");

          if (item.icon) {
            const iconSpan = document.createElement("span");
            iconSpan.className = "title-breadcrumb-dropdown-icon";
            iconSpan.textContent = item.icon;
            iconSpan.setAttribute("aria-hidden", "true");
            btn.appendChild(iconSpan);
          }

          const labelSpan = document.createElement("span");
          labelSpan.className = "title-breadcrumb-dropdown-label";
          labelSpan.textContent = item.label;
          btn.appendChild(labelSpan);

          btn.title = item.label;
          if (item.onClick) {
            btn.addEventListener("click", () => { closeDropdown(); item.onClick(); });
          }
          li.appendChild(btn);
          dropdown.appendChild(li);
        });

        // Append first with visibility hidden to measure natural rendered width
        dropdown.style.visibility = "hidden";
        dropdown.style.display = "block";
        dropdown.style.top = "0px";
        dropdown.style.left = "0px";
        document.body.appendChild(dropdown);
        activeDropdown = dropdown;

        const rect = ellipsisBtn.getBoundingClientRect();
        const dropdownWidth = dropdown.offsetWidth || 180;

        // Horizontally center the dropdown directly underneath the ellipsis button
        const btnCenter = rect.left + (rect.width / 2) + window.scrollX;
        let leftPos = btnCenter - (dropdownWidth / 2);

        // Clamp within viewport margins
        const minLeft = 12 + window.scrollX;
        const maxLeft = window.innerWidth - dropdownWidth - 12 + window.scrollX;
        if (leftPos < minLeft) leftPos = minLeft;
        if (leftPos > maxLeft) leftPos = maxLeft;

        dropdown.style.top = `${rect.bottom + window.scrollY + 6}px`;
        dropdown.style.left = `${leftPos}px`;
        dropdown.style.visibility = "";
        ellipsisBtn.setAttribute("aria-expanded", "true");

        const firstItem = dropdown.querySelector(".title-breadcrumb-dropdown-item");
        if (firstItem) firstItem.focus();
      });

      wrapper.appendChild(ellipsisBtn);
    } else {
      middle.forEach((item) => {
        wrapper.appendChild(buildSep());
        wrapper.appendChild(buildItem(item.label, item.onClick));
      });
    }

    wrapper.appendChild(buildSep());
    wrapper.appendChild(buildItem(last.label, last.onClick, true));
  }

  const { maxItems = 4 } = options;

  function evaluate() {
    render(false);

    // On compact screens (or narrow containers), collapse intermediate items when >2 items
    const isCompact = window.innerWidth <= 640 || (titleEl.parentElement && titleEl.parentElement.clientWidth < 450);
    const effectiveMaxItems = isCompact ? 2 : maxItems;

    const itemsEl = Array.from(wrapper.querySelectorAll(".title-breadcrumb-item"));
    const hasTruncatedItem = itemsEl.some((el) => el.scrollWidth > el.clientWidth + 1);
    const isOverflowing = wrapper.scrollWidth > wrapper.clientWidth + 2;

    const shouldCollapse = (items.length > effectiveMaxItems || isOverflowing || (isCompact && hasTruncatedItem)) && items.length > 2;

    if (shouldCollapse) {
      render(true);
    }
  }

  evaluate();

  const outsideClick = (e) => { if (activeDropdown && !activeDropdown.contains(e.target)) closeDropdown(); };
  const escapeKey = (e) => { if (e.key === "Escape" && activeDropdown) closeDropdown(); };
  document.addEventListener("click", outsideClick);
  document.addEventListener("keydown", escapeKey);

  const observer = new ResizeObserver(() => evaluate());
  observer.observe(titleEl);

  titleEl._breadcrumbObserver = observer;
  titleEl._breadcrumbCleanup = () => {
    document.removeEventListener("click", outsideClick);
    document.removeEventListener("keydown", escapeKey);
    closeDropdown();
  };
}
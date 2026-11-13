// ============================================================================
// public/src/components/tooltip/tooltip.js
// MODERN CUSTOM TOOLTIP SYSTEM — High-performance floating tooltips for cards,
// titles, descriptions, and UI controls with dark-theme glassmorphism.
// ============================================================================

let tooltipEl = null;
let badgeEl = null;
let textEl = null;
let showTimer = null;
let activeTarget = null;
let lastHideTime = 0;
let isInitialized = false;

const HOVER_DELAY_MS = 180;
const WARM_TRANSITION_MS = 300;
const GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 12;

function ensureTooltipDOM() {
  if (tooltipEl) return;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "app-custom-tooltip";
  tooltipEl.setAttribute("role", "tooltip");
  tooltipEl.setAttribute("aria-hidden", "true");

  badgeEl = document.createElement("span");
  badgeEl.className = "app-custom-tooltip-badge";
  badgeEl.style.display = "none";

  textEl = document.createElement("span");
  textEl.className = "app-custom-tooltip-text";

  tooltipEl.appendChild(badgeEl);
  tooltipEl.appendChild(textEl);
  document.body.appendChild(tooltipEl);
}

function isTextClamped(element) {
  if (!element) return false;
  return (
    element.scrollWidth > element.clientWidth + 1 ||
    element.scrollHeight > element.clientHeight + 1
  );
}

function resolveTooltipData(target) {
  if (!target || !(target instanceof Element)) return null;

  // 1. Folders and courses: NO tooltips on cards, icons, or subtext;
  // only show on the title (h3) if the title is actually clamped/truncated.
  const categoryCard = target.closest('.item-card[data-card-kind="folder"]');
  if (categoryCard) {
    const heading = target.closest("h3");
    if (!heading || !categoryCard.contains(heading)) {
      return null;
    }
    if (!isTextClamped(heading)) {
      return null;
    }
    const text = heading.getAttribute("data-tooltip-text") || heading.textContent.trim();
    // Plain full title only (no badges)
    return text ? { element: heading, text, badge: "" } : null;
  }

  // 2. Card descriptions on content cards: only show if clamped/truncated
  const desc = target.closest(".ic-desc");
  if (desc) {
    if (!isTextClamped(desc)) {
      return null;
    }
    const text = desc.getAttribute("data-tooltip-text") || desc.textContent.trim();
    return text ? { element: desc, text, badge: "📄 الوصف" } : null;
  }

  // 3. Content card headings (quizzes, lessons, notebooks):
  // ALWAYS show on hover with type badge so desktop users can distinguish card kinds easily
  const examHeading = target.closest(".item-card h3");
  if (examHeading) {
    const text = examHeading.getAttribute("data-tooltip-text") || examHeading.textContent.trim();
    const badge = examHeading.getAttribute("data-tooltip-badge") || "";
    if (text) return { element: examHeading, text, badge };
  }

  // 4. Explicitly clamped-only elements
  const clampedOnlyEl = target.closest("[data-tooltip-clamped-only='true']");
  if (clampedOnlyEl) {
    if (!isTextClamped(clampedOnlyEl)) return null;
    const text = clampedOnlyEl.getAttribute("data-tooltip-text") || clampedOnlyEl.textContent.trim();
    return text ? { element: clampedOnlyEl, text, badge: "" } : null;
  }

  // 5. Generic direct data attributes (outside category cards)
  const directEl = target.closest("[data-tooltip-text], [data-tooltip-badge]");
  if (directEl && !directEl.closest('.item-card[data-card-kind="folder"]')) {
    const text = directEl.getAttribute("data-tooltip-text") || "";
    const badge = directEl.getAttribute("data-tooltip-badge") || "";
    if (text || badge) {
      return { element: directEl, text, badge };
    }
  }

  return null;
}

function positionTooltip(target) {
  if (!tooltipEl || !target) return;
  const rect = target.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const tooltipW = tooltipEl.offsetWidth;
  const tooltipH = tooltipEl.offsetHeight;

  // Horizontal: Center over target, clamp to viewport margins
  let left = rect.left + rect.width / 2 - tooltipW / 2;
  if (left < VIEWPORT_MARGIN_PX) left = VIEWPORT_MARGIN_PX;
  if (left + tooltipW > vw - VIEWPORT_MARGIN_PX) {
    left = vw - tooltipW - VIEWPORT_MARGIN_PX;
  }

  // Vertical: Default above, flip below if not enough clearance above
  let flipBelow = rect.top - tooltipH - GAP_PX < VIEWPORT_MARGIN_PX;
  let top = flipBelow ? rect.bottom + GAP_PX : rect.top - tooltipH - GAP_PX;

  // Clamp vertically within screen
  if (top < VIEWPORT_MARGIN_PX) top = VIEWPORT_MARGIN_PX;
  if (top + tooltipH > vh - VIEWPORT_MARGIN_PX) {
    top = vh - tooltipH - VIEWPORT_MARGIN_PX;
  }

  tooltipEl.classList.toggle("flip-below", flipBelow);
  tooltipEl.style.left = `${Math.round(left)}px`;
  tooltipEl.style.top = `${Math.round(top)}px`;
}

function show(data) {
  ensureTooltipDOM();
  activeTarget = data.element;

  if (data.badge) {
    badgeEl.textContent = data.badge;
    badgeEl.style.display = "inline-flex";
  } else {
    badgeEl.textContent = "";
    badgeEl.style.display = "none";
  }

  textEl.textContent = data.text;

  // Position before making visible so transition starts from correct coordinates
  tooltipEl.style.visibility = "hidden";
  tooltipEl.style.display = "flex";
  positionTooltip(data.element);

  requestAnimationFrame(() => {
    if (activeTarget !== data.element) return;
    tooltipEl.style.visibility = "visible";
    tooltipEl.classList.add("is-visible");
  });
}

export function hideTooltip() {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (!tooltipEl || !tooltipEl.classList.contains("is-visible")) {
    activeTarget = null;
    return;
  }
  tooltipEl.classList.remove("is-visible");
  activeTarget = null;
  lastHideTime = Date.now();
}

export function initCustomTooltips() {
  if (isInitialized || typeof window === "undefined") return;
  isInitialized = true;

  // Ignore pure touch devices (no hover)
  const canHover = window.matchMedia("(hover: hover)").matches;
  if (!canHover) return;

  document.addEventListener(
    "mouseover",
    (e) => {
      const data = resolveTooltipData(e.target);
      if (!data) {
        if (activeTarget && !activeTarget.contains(e.target)) {
          hideTooltip();
        }
        return;
      }

      if (activeTarget === data.element) return;

      if (showTimer) clearTimeout(showTimer);

      const isWarm = Date.now() - lastHideTime < WARM_TRANSITION_MS;
      const delay = isWarm ? 0 : HOVER_DELAY_MS;

      if (delay === 0) {
        show(data);
      } else {
        showTimer = setTimeout(() => {
          show(data);
        }, delay);
      }
    },
    true
  );

  document.addEventListener(
    "mouseout",
    (e) => {
      if (!activeTarget) return;
      const related = e.relatedTarget;
      if (related && activeTarget.contains(related)) return;
      hideTooltip();
    },
    true
  );

  document.addEventListener("pointerdown", hideTooltip, true);
  window.addEventListener("scroll", hideTooltip, { passive: true });
  window.addEventListener("resize", hideTooltip, { passive: true });
}


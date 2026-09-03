// ============================================================================
// public/src/components/side-menu/side-menu.js — Persistent collapsible icon-rail sidebar
// Desktop: 64px collapsed ↔ 240px expanded, state in localStorage
// Mobile (≤768px): bottom sheet with backdrop
// ============================================================================

import { mountSignInDialog, openSignInDialog } from "../log-in/sign-in.js";

mountSignInDialog();

// ── PWA Install Prompt — captured globally so it works on every page ─────────
(function () {
  let _deferredInstallPrompt = null;
  const installButtons = () => document.querySelectorAll(".install-app");
  const setInstallButtonsVisible = (visible) => {
    installButtons().forEach((btn) => {
      btn.classList.toggle("is-installable", visible);
      // Keep inline display in sync for pages that still read style.display,
      // but visibility is owned by `.is-installable` + CSS !important rules.
      btn.style.display = visible ? "flex" : "none";
    });
  };

  // Hide by default. It is revealed only when installability is confirmed.
  setInstallButtonsVisible(false);

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (isStandalone) {
    setInstallButtonsVisible(false);
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    // Already installed / running as app — never show the button.
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    ) {
      return;
    }
    e.preventDefault();
    _deferredInstallPrompt = e;
    setInstallButtonsVisible(true);
  });

  window.addEventListener("appinstalled", () => {
    _deferredInstallPrompt = null;
    setInstallButtonsVisible(false);
    if (typeof showNotification === "function") {
      showNotification("تم التثبيت", "تم تثبيت التطبيق بنجاح", "./favicon.png");
    }
  });

  window.installApp = async function () {
    console.log(
      "installApp triggered, prompt state:",
      _deferredInstallPrompt ? "Available" : "NULL",
    );
    if (!_deferredInstallPrompt) {
      if (typeof showNotification === "function") {
        showNotification(
          "غير متاح",
          "التطبيق غير قابل للتثبيت حالياً (قد يكون مثبتاً بالفعل أو المتصفح لا يدعم) جرّب من الصفحة الرئيسية",
          "warning",
        );
      }
      return;
    }

    const promptEvent = _deferredInstallPrompt;
    try {
      console.log("Calling prompt()...");
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      console.log("User choice outcome:", outcome);
      if (outcome === "accepted") {
        _deferredInstallPrompt = null;
        setInstallButtonsVisible(false);
        document.dispatchEvent(new CustomEvent("pwa-install-accepted"));
      }
    } catch (err) {
      console.error("PWA Prompt error:", err);
      if (typeof showNotification === "function") {
        showNotification("خطأ في التثبيت", err.message, "error");
      }
    }
  };
})();

(function () {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sideMenuBackdrop");
  const closeBtn = document.getElementById("closeMenuBtn"); // mobile-only
  const expandBtn = document.getElementById("sidebarExpandBtn"); // desktop expand trigger (collapsed rail favicon)
  const collapseBtn = document.getElementById("sidebarCollapseBtn"); // desktop collapse button (expanded header)
  const animationToggle = document.getElementById("animationToggle");
  const highPerformanceToggle = document.getElementById(
    "highPerformanceToggle",
  );
  const bottomNav = document.getElementById("bottomNav"); // mobile-only
  const moreBtn = document.getElementById("bottomNavMoreBtn"); // mobile-only, opens the sheet

  const MOBILE_BP = 768;
  const STORAGE_KEY = "sidebar_expanded";
  const FOCUSABLE =
    'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';

  // ── Helpers ────────────────────────────────────────────────────────────────

  function isMobile() {
    return window.innerWidth <= MOBILE_BP;
  }

  /** Apply sidebar expanded/collapsed state on desktop */
  function applyDesktopState(expanded) {
    if (expanded) {
      sidebar.classList.add("expanded");
      document.body.classList.add("sidebar-expanded");
    } else {
      sidebar.classList.remove("expanded");
      document.body.classList.remove("sidebar-expanded");
    }
  }

  /** Open the sidebar (mobile bottom-sheet mode) */
  function openMobileSidebar() {
    sidebar.classList.add("expanded");
    backdrop.classList.add("visible");
    if (moreBtn) {
      moreBtn.setAttribute("aria-expanded", "true");
      moreBtn.classList.add("active");
    }
    sidebar.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden"; // prevent scroll behind sheet
    // Focus first focusable item
    const first = sidebar.querySelectorAll(FOCUSABLE)[0];
    if (first) first.focus();
  }

  /** Close the sidebar (mobile bottom-sheet mode) */
  function closeMobileSidebar() {
    sidebar.classList.remove("expanded");
    backdrop.classList.remove("visible");
    if (moreBtn) {
      moreBtn.setAttribute("aria-expanded", "false");
      moreBtn.classList.remove("active");
    }
    sidebar.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (moreBtn) moreBtn.focus();
  }
  window.__closeMobileSidebar = closeMobileSidebar;

  /**
   * Keep the bottom nav's active tab in sync with the current page.
   * Mirrors the same `active` class already hardcoded per-page on the
   * desktop sidebar's matching <a class="menu-item active">. Also handles
   * pages (like the quiz page) that don't have a matching bottom-nav tab,
   * in which case nothing is marked active.
   */
  function syncBottomNavActiveState() {
    if (!bottomNav) return;
    const path = window.location.pathname.split("/").pop() || "index.html";
    const items = bottomNav.querySelectorAll(".bottom-nav-item[href]");
    items.forEach((item) => {
      const href = item.getAttribute("href");
      const itemPath = href === "/" ? "index.html" : href;
      const isActive =
        itemPath === path ||
        (href === "/" && (path === "" || path === "index.html"));
      item.classList.toggle("active", isActive);
      if (isActive) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  // ── Collapsed-rail hover tooltips ────────────────────────────────────────
  // .sidebar nav uses `overflow-x: clip` (see that rule's comment), which
  // clips anything painted past nav's edges — including a plain
  // [data-tooltip]::after positioned outside the icon. That's why labels
  // used to only work for the two .sidebar-pinned-actions buttons, the only
  // .menu-items that live OUTSIDE <nav>. Fixed the same way the profile
  // dropdown already escapes this exact clipping ancestor: one shared
  // element, `position: fixed`, positioned from the hovered/focused icon's
  // own getBoundingClientRect() instead of relying on CSS containment.
  function setupHoverTooltips() {
    let tooltipEl = document.querySelector(".sidebar-hover-tooltip");
    if (!tooltipEl) {
      tooltipEl = document.createElement("div");
      tooltipEl.className = "sidebar-hover-tooltip";
      tooltipEl.setAttribute("role", "tooltip");
      tooltipEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(tooltipEl);
    }

    let activeTarget = null;

    function positionTooltip(target) {
      const rect = target.getBoundingClientRect();
      const GAP = 10;
      tooltipEl.style.top = `${rect.top + rect.height / 2}px`;
      // RTL sidebar sits on the right edge — tooltip opens to the left of
      // the icon, toward the content area.
      tooltipEl.style.right = `${window.innerWidth - rect.left + GAP}px`;
      tooltipEl.style.left = "auto";
      tooltipEl.style.transform = "translateY(-50%)";
    }

    function showTooltip(target) {
      // Only relevant for the collapsed desktop rail — expanded sidebar
      // already shows full text labels inline, and mobile suppresses this
      // element entirely via CSS.
      if (isMobile() || sidebar.classList.contains("expanded")) return;
      const label = target.getAttribute("data-tooltip");
      if (!label) return;

      activeTarget = target;
      tooltipEl.textContent = label;
      positionTooltip(target);
      tooltipEl.classList.add("visible");
    }

    function hideTooltip() {
      activeTarget = null;
      tooltipEl.classList.remove("visible");
    }

    // Delegate from the sidebar itself so this covers every current and
    // future [data-tooltip] element (.menu-item links/buttons, the
    // collapsed-rail .theme-section-header, pinned actions) uniformly,
    // instead of re-querying and re-binding after every DOM change.
    sidebar.addEventListener("mouseover", (e) => {
      const target = e.target.closest("[data-tooltip]");
      if (target && sidebar.contains(target)) showTooltip(target);
    });

    sidebar.addEventListener("mouseout", (e) => {
      const target = e.target.closest("[data-tooltip]");
      if (target && target === activeTarget) hideTooltip();
    });

    sidebar.addEventListener(
      "focusin",
      (e) => {
        const target = e.target.closest("[data-tooltip]");
        if (target) showTooltip(target);
      },
      true,
    );

    sidebar.addEventListener(
      "focusout",
      (e) => {
        const target = e.target.closest("[data-tooltip]");
        if (target && target === activeTarget) hideTooltip();
      },
      true,
    );

    // Keep it glued to its target through scroll/resize/expand-collapse
    // instead of leaving a stale tooltip floating in place.
    window.addEventListener("scroll", () => {
      if (activeTarget) positionTooltip(activeTarget);
    }, true);
    window.addEventListener("resize", hideTooltip);
    sidebar.addEventListener("transitionend", (e) => {
      if (e.propertyName === "width") hideTooltip();
    });
  }

  // ── Initialise ─────────────────────────────────────────────────────────────

  function init() {
    if (!sidebar) return;

    if (isMobile()) {
      // Mobile: sidebar starts hidden
      sidebar.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    } else {
      // Desktop: restore saved preference. The expanded/collapsed class and
      // body.sidebar-expanded were already applied synchronously by the
      // inline anti-FOUC scripts in <head>/<body> before first paint — this
      // just brings our own bookkeeping (aria-hidden) in sync with that
      // already-applied state instead of re-deriving and re-toggling it.
      const expanded =
        typeof window.__sidebarExpandedInit === "boolean"
          ? window.__sidebarExpandedInit
          : localStorage.getItem(STORAGE_KEY) === "true";
      applyDesktopState(expanded);
      sidebar.setAttribute("aria-hidden", "false");
    }

    // Sync theme buttons pressed state
    const currentTheme =
      document.documentElement.getAttribute("data-theme") || "dark";
    sidebar.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.setAttribute(
        "aria-pressed",
        btn.dataset.theme === currentTheme ? "true" : "false",
      );
    });

    // Sync animation toggle state
    if (animationToggle) {
      const animsEnabled =
        document.documentElement.getAttribute("data-animations") !== "disabled";
      animationToggle.checked = animsEnabled;
    }

    // Sync high performance toggle state
    if (highPerformanceToggle) {
      if (typeof themeManager !== "undefined") {
        highPerformanceToggle.checked =
          themeManager.getHighPerformanceEnabled();
      }
      highPerformanceToggle.disabled = false;
      const highPerformanceContainer = highPerformanceToggle.closest(
        ".high-performance-toggle-container",
      );
      if (highPerformanceContainer) {
        highPerformanceContainer.classList.remove("is-disabled");
        highPerformanceContainer.removeAttribute("aria-disabled");
      }
    }

    // Sync bottom nav active tab (mobile)
    syncBottomNavActiveState();

    // Collapsed-rail hover tooltips (desktop only; no-ops safely on mobile)
    setupHoverTooltips();
  }

  // ── Desktop Expand/Collapse Toggles ────────────────────────────────────────

  if (expandBtn) {
    expandBtn.addEventListener("click", () => {
      applyDesktopState(true);
      try {
        localStorage.setItem(STORAGE_KEY, "true");
      } catch (_) {}
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener("click", () => {
      applyDesktopState(false);
      try {
        localStorage.setItem(STORAGE_KEY, "false");
      } catch (_) {}
    });
  }

  // ── Bottom Nav "المزيد" (More) Button ───────────────────────────────────────
  // Opens the same bottom-sheet drawer as the legacy hamburger, containing
  // whatever nav links don't fit in the 5 main bottom-nav tabs.

  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      if (sidebar.classList.contains("expanded")) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
    });
  }

  // ── Mobile Close Button ─────────────────────────────────────────────────────

  if (closeBtn) {
    closeBtn.addEventListener("click", closeMobileSidebar);
  }

  // ── Backdrop Click ──────────────────────────────────────────────────────────

  if (backdrop) {
    backdrop.addEventListener("click", closeMobileSidebar);
  }

  // ── Draggable Bottom Sheet (mobile) ─────────────────────────────────────────
  // Grab-and-drag the sheet up/down by its handle, YouTube-comments-style.
  // Dragging up snaps back open; dragging down past a distance/velocity
  // threshold and releasing dismisses the sheet.

  const dragHandle = document.getElementById("sidebarDragHandle");

  if (dragHandle && sidebar) {
    const DISMISS_DISTANCE_RATIO = 0.28; // fraction of sheet height
    const DISMISS_VELOCITY = 0.5; // px/ms, fast downward flick dismisses early

    let dragging = false;
    let startY = 0;
    let currentY = 0;
    let startTime = 0;
    let sheetHeight = 0;
    let pointerId = null;

    function onPointerDown(e) {
      if (!isMobile()) return;
      if (!sidebar.classList.contains("expanded")) return;

      dragging = true;
      pointerId = e.pointerId;
      startY = e.clientY;
      currentY = e.clientY;
      startTime = performance.now();
      sheetHeight = sidebar.getBoundingClientRect().height || 1;

      sidebar.classList.add("dragging");
      dragHandle.classList.add("dragging");

      try {
        dragHandle.setPointerCapture(pointerId);
      } catch (_) {}

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      currentY = e.clientY;
      const deltaY = Math.max(0, currentY - startY); // only allow downward drag
      sidebar.style.transform = `translateY(${deltaY}px)`;
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;

      sidebar.classList.remove("dragging");
      dragHandle.classList.remove("dragging");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      const deltaY = Math.max(0, currentY - startY);
      const elapsed = Math.max(1, performance.now() - startTime);
      const velocity = deltaY / elapsed; // px per ms

      // Clear the inline transform either way — closing uses the sheet's
      // own CSS transition (translateY(100%)); staying open just resets
      // back to the sheet's normal expanded position (translateY(0)).
      sidebar.style.transform = "";

      const shouldDismiss =
        deltaY > sheetHeight * DISMISS_DISTANCE_RATIO ||
        velocity > DISMISS_VELOCITY;

      if (shouldDismiss) {
        closeMobileSidebar();
      }
    }

    dragHandle.addEventListener("pointerdown", onPointerDown);
  }

  // ── Focus trap (mobile keyboard) ───────────────────────────────────────────

  if (sidebar) {
    sidebar.addEventListener("keydown", (e) => {
      if (!isMobile()) return;

      if (e.key === "Escape") {
        closeMobileSidebar();
        return;
      }

      if (e.key !== "Tab") return;
      const focusable = [...sidebar.querySelectorAll(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        e.shiftKey
          ? document.activeElement === first
          : document.activeElement === last
      ) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    });
  }

  // ── Resize: reset state on breakpoint cross ─────────────────────────────────

  let lastMobile = isMobile();
  window.addEventListener("resize", () => {
    const nowMobile = isMobile();
    if (nowMobile === lastMobile) return;
    lastMobile = nowMobile;

    if (!nowMobile) {
      // Switched to desktop — restore preference, remove overlay artefacts
      backdrop.classList.remove("visible");
      document.body.style.overflow = "";
      sidebar.setAttribute("aria-hidden", "false");
      const saved = localStorage.getItem(STORAGE_KEY);
      applyDesktopState(saved === "true");
      if (moreBtn) {
        moreBtn.setAttribute("aria-expanded", "false");
        moreBtn.classList.remove("active");
      }
    } else {
      // Switched to mobile — close/reset
      sidebar.classList.remove("expanded");
      document.body.classList.remove("sidebar-expanded");
      backdrop.classList.remove("visible");
      sidebar.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (moreBtn) {
        moreBtn.setAttribute("aria-expanded", "false");
        moreBtn.classList.remove("active");
      }
      syncBottomNavActiveState();
    }
  });

  // ── Action buttons (data-action) ────────────────────────────────────────────

  sidebar.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = btn.dataset.action;
      const fn = window[action];
      if (typeof fn === "function") {
        // For PWA install, we trigger it immediately to preserve user gesture
        fn();
      }
      // Close sidebar on mobile, unless it's the install app button (the browser prompt will cover it)
      if (isMobile() && action !== "installApp") {
        closeMobileSidebar();
      }
    });
  });

  // ── Action buttons (data-action) ────────────────────────────────────────────
  const nameDisplay = document.getElementById("userNameDisplay");
  if (nameDisplay) {
    const currentName = localStorage.getItem("username") || "مستخدم";
    nameDisplay.textContent = currentName;
  }

  // ── Theme buttons ───────────────────────────────────────────────────────────

  sidebar.querySelectorAll("[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (typeof themeManager !== "undefined" && themeManager.applyTheme) {
        themeManager.applyTheme(btn.dataset.theme);
      }
      // Update pressed states
      sidebar.querySelectorAll("[data-theme]").forEach((b) => {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
    });
  });

  // ── Animation toggle ────────────────────────────────────────────────────────

  if (animationToggle) {
    animationToggle.addEventListener("change", () => {
      if (typeof themeManager !== "undefined" && themeManager.applyAnimations) {
        themeManager.applyAnimations(animationToggle.checked);
      }
    });
  }

  // ── High Performance toggle ─────────────────────────────────────────────────

  if (highPerformanceToggle) {
    highPerformanceToggle.addEventListener("change", () => {
      if (
        typeof themeManager !== "undefined" &&
        themeManager.applyHighPerformance
      ) {
        themeManager.applyHighPerformance(highPerformanceToggle.checked);
      }
    });
  }

  // ── Theme Controls Accordion ────────────────────────────────────────────────
  // Retractable "المظهر والأداء" (appearance & performance) section. Persists
  // open/closed across page loads the same way the sidebar's own
  // expanded/collapsed state does. Only wired for the toggle button itself;
  // the collapsed-rail icon (.sidebar-collapsed-only) below just expands the
  // whole sidebar, matching how every other collapsed-rail icon behaves.

  const THEME_ACCORDION_KEY = "theme_controls_expanded";
  const themeControlsToggle = document.getElementById("themeControlsToggle");
  const themeControlsPanel = document.getElementById("themeControlsPanel");

  function setThemeControlsExpanded(expanded) {
    if (!themeControlsToggle || !themeControlsPanel) return;
    themeControlsToggle.setAttribute("aria-expanded", String(expanded));
    themeControlsPanel.classList.toggle("collapsed", !expanded);
    try {
      localStorage.setItem(THEME_ACCORDION_KEY, String(expanded));
    } catch (_) {}
  }

  if (themeControlsToggle && themeControlsPanel) {
    const savedAccordionState = localStorage.getItem(THEME_ACCORDION_KEY);
    // Defaults open (matches the toggle's markup-default aria-expanded="true")
    setThemeControlsExpanded(savedAccordionState !== "false");

    themeControlsToggle.addEventListener("click", () => {
      const isExpanded =
        themeControlsToggle.getAttribute("aria-expanded") === "true";
      setThemeControlsExpanded(!isExpanded);
    });
  }

  // Collapsed-rail entry point for the theme/animation section — same
  // pattern as clicking any other icon while collapsed doesn't itself do
  // anything special beyond normal navigation, except here there's no
  // href to follow, so clicking it simply opens the sidebar (desktop) so
  // the person can reach the actual controls.
  const themeSectionCollapsedIcon = sidebar.querySelector(
    ".theme-controls-section .sidebar-collapsed-only",
  );
  if (themeSectionCollapsedIcon) {
    themeSectionCollapsedIcon.addEventListener("click", () => {
      if (isMobile()) return; // not shown on mobile anyway (always expanded sheet)
      applyDesktopState(true);
      try {
        localStorage.setItem(STORAGE_KEY, "true");
      } catch (_) {}
    });
  }

  // ── Run ─────────────────────────────────────────────────────────────────────
  init();
})();

// ============================================================================
// User Avatar
// ============================================================================

import { avatarEngine, syncNavAvatars } from "../../shared/avatarEngine.js";

function initNavAvatars() {
  syncNavAvatars();

  window.addEventListener("avatarUpdated", () => {
    syncNavAvatars();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNavAvatars, { once: true });
} else {
  initNavAvatars();
}

// ============================================================================
// PROFILE AVATAR DROPDOWN — desktop sidebar only
// ============================================================================
// Converts the desktop sidebar's profile `.menu-item` from a plain link into
// a button that opens an avatar dropdown (Profile / Reports (disabled) /
// تغيير الإسم / Sign out for admins). Mobile bottom-nav profile tab is
// untouched — this whole block is a no-op if #sideMenuProfileTrigger isn't
// present in the page's markup (only profile.html has it for now).
import { getAdminRoleInfo } from "../../shared/adminAuth.js";
import { fullSignOut } from "../../shared/adminAuth.js";
import {
  getSharedSupabaseClient,
  ensureSharedSupabaseClient,
} from "../../shared/supabaseClientRegistry.js";

// ============================================================================
// ADMIN BADGE — post-load refresh
// ============================================================================
// Re-runs the same instant-badge-injection logic each page's inline <head>
// and post-nav <script> blocks already run pre-paint (reads the admin JWT
// from sessionStorage, injects/removes a .nav-badge-overlay <img> next to
// each avatar target). Exported so adminBadgeSync.js's recovery path (a
// Supabase-only session getting re-derived into a local JWT after the page
// has already painted) can refresh the badge WITHOUT a full reload.
function refreshNavBadges() {
  const targets = [{ imgId: "navSidebarAvatar" }, { imgId: "navBottomAvatar" }];

  let roleInfo = null;
  try {
    roleInfo = getAdminRoleInfo();
  } catch (_) {}

  targets.forEach(({ imgId }) => {
    const img = document.getElementById(imgId);
    if (!img) return;
    const parent = img.parentElement;
    if (!parent) return;

    const existing = parent.querySelector(".nav-badge-overlay");

    if (!roleInfo) {
      // No longer an admin (or session cleared) — remove any stale badge.
      if (existing) existing.remove();
      return;
    }

    if (existing) return; // already correctly showing a badge

    parent.style.position = "relative";
    const badgeIcon = roleInfo.isOwner
      ? "assets/images/white-icon.png"
      : "favicon.png";
    const b = document.createElement("img");
    b.className = "nav-badge-overlay";
    b.src = badgeIcon;
    b.alt = "";
    b.style.cssText = "position:absolute;z-index:10;display:block;";
    parent.appendChild(b);
  });
}

/**
 * Refreshes every piece of admin-dependent UI this module owns, in place,
 * without a page reload: the nav badge overlays, and — if the profile
 * dropdown has already been mounted on this page — its email/sign-out row.
 * Safe to call on pages without the dropdown (badge refresh still applies)
 * and safe to call repeatedly (idempotent).
 */
export function refreshAdminUI() {
  refreshNavBadges();
  const popover = document.getElementById("sideMenuProfileDropdown");
  if (popover && popover.classList.contains("open")) {
    // Dropdown is currently open — re-populate it immediately so an admin
    // recovery mid-session shows up without the user having to close/reopen.
    populateDropdownIfAvailable();
  }
  
  const mobileAdminBtn = document.getElementById("sideMenuMobileAdminSignIn");
  if (mobileAdminBtn) {
    const roleInfo = getAdminRoleInfo();
    const label = mobileAdminBtn.querySelector(".menu-label");
    if (label) label.textContent = roleInfo ? "تسجيل الخروج" : "دخول المشرفين";
  }
}

// populateDropdown() is defined further down (only when the dropdown markup
// exists on this page). This indirection lets refreshAdminUI() call it
// safely even though it's declared later in the same DOMContentLoaded scope.
let populateDropdownIfAvailable = () => {};

function initProfileDropdown() {
  const trigger = document.getElementById("sideMenuProfileTrigger");
  const popover = document.getElementById("sideMenuProfileDropdown");
  if (!trigger || !popover) return;

  let signInRow = popover.querySelector("#sideMenuDropdownSignIn");
  if (signInRow && signInRow.tagName !== "BUTTON") {
    const signInButton = document.createElement("button");
    signInButton.type = "button";
    signInButton.id = signInRow.id;
    signInButton.className = "side-menu-profile-dropdown-item side-menu-profile-dropdown-item-signin";
    signInButton.setAttribute("role", "menuitem");
    signInButton.innerHTML = `
      <svg class="side-menu-dropdown-google-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17Z"/>
        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"/>
        <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"/>
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"/>
      </svg>
      <span>تسجيل الدخول</span>
    `;
    signInRow.replaceWith(signInButton);
    signInRow = signInButton;
  }

  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let isOpen = false;

  function backgroundImageFor(value) {
    return /^linear-gradient\(/.test(value) ? value : `url("${value}")`;
  }

  function renderDropdownCover(coverEl) {
    const storedThumbnail = avatarEngine.getThumbnail();
    if (storedThumbnail) {
      coverEl.style.backgroundImage = backgroundImageFor(storedThumbnail);
      coverEl.classList.add("has-thumbnail");
      coverEl.classList.remove("is-default-thumbnail");
      return;
    }

    const name = localStorage.getItem("username") || "?";
    const grad = avatarEngine.thumbnailGradientForName(name);
    coverEl.style.backgroundImage = `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`;
    coverEl.classList.remove("has-thumbnail");
    coverEl.classList.add("is-default-thumbnail");
  }

  function populateDropdown() {
    const roleInfo = getAdminRoleInfo();
    const isAdmin = !!roleInfo;

    const nameEl = popover.querySelector("#sideMenuDropdownName");
    const emailRow = popover.querySelector("#sideMenuDropdownEmailRow");
    const emailEl = popover.querySelector("#sideMenuDropdownEmail");
    const signOutRow = popover.querySelector("#sideMenuDropdownSignOut");
    const currentSignInRow = popover.querySelector("#sideMenuDropdownSignIn");
    const avatarImg = popover.querySelector("#sideMenuDropdownAvatar");
    const avatarDefaultIcon = popover.querySelector(
      "#sideMenuProfileDropdown .side-menu-profile-dropdown-default-icon",
    );

    // Mirror whatever the trigger's own avatar is currently showing —
    // navSidebarAvatar is kept in sync by avatarEngine.js's syncNavAvatars()
    // (and the inline instant-injection script on first paint); rather than
    // duplicate that logic here, just copy its resolved state each time the
    // dropdown opens.
    const triggerAvatarImg = document.getElementById("navSidebarAvatar");
    const itemAvatarImg = popover.querySelector("#sideMenuDropdownItemAvatar");
    const itemAvatarIcon = popover.querySelector(
      "#sideMenuDropdownItemAvatarIcon",
    );
    let triggerHasAvatar = false;
    if (triggerAvatarImg) {
      triggerHasAvatar =
        triggerAvatarImg.style.display !== "none" && triggerAvatarImg.src;
    }
    if (avatarImg && triggerAvatarImg) {
      if (triggerHasAvatar) {
        avatarImg.src = triggerAvatarImg.src;
        avatarImg.style.display = "";
        if (avatarDefaultIcon) avatarDefaultIcon.style.display = "none";
      } else {
        avatarImg.style.display = "none";
        if (avatarDefaultIcon) avatarDefaultIcon.style.display = "";
      }
    }
    // Same mirror, applied to the small "الحساب" row icon.
    if (itemAvatarImg && triggerAvatarImg) {
      if (triggerHasAvatar) {
        itemAvatarImg.src = triggerAvatarImg.src;
        itemAvatarImg.style.display = "";
        if (itemAvatarIcon) itemAvatarIcon.style.display = "none";
      } else {
        itemAvatarImg.style.display = "none";
        if (itemAvatarIcon) itemAvatarIcon.style.display = "";
      }
    }

    // Mirror the cover strip the same way — #identityThumbnail is the
    // single source of truth profile.js's renderThumbnail() writes to
    // (background-image + has-thumbnail/is-default-thumbnail classes).
    // If the profile page itself isn't available, fall back to reading the
    // stored thumbnail value directly and rendering the same gradient/fallback
    // semantics here.
    const coverEl = popover.querySelector("#sideMenuDropdownCover");
    const sourceCoverEl = document.getElementById("identityThumbnail");
    if (coverEl) {
      if (sourceCoverEl) {
        coverEl.style.backgroundImage = sourceCoverEl.style.backgroundImage;
        coverEl.classList.toggle(
          "has-thumbnail",
          sourceCoverEl.classList.contains("has-thumbnail"),
        );
        coverEl.classList.toggle(
          "is-default-thumbnail",
          sourceCoverEl.classList.contains("is-default-thumbnail"),
        );
      } else {
        renderDropdownCover(coverEl);
      }
    }

    if (nameEl) {
      nameEl.textContent = localStorage.getItem("username") || "مستخدم";
    }

    if (isAdmin && roleInfo.email) {
      if (emailRow) emailRow.style.display = "flex";
      if (emailEl) emailEl.textContent = roleInfo.email;
    } else if (emailRow) {
      emailRow.style.display = "none";
    }

    if (signOutRow) signOutRow.style.display = isAdmin ? "flex" : "none";
    if (currentSignInRow) currentSignInRow.style.display = isAdmin ? "none" : "flex";
  }

  // Wire up the module-level indirection so refreshAdminUI() (called from
  // outside this closure, e.g. by adminBadgeSync.js) can re-populate the
  // dropdown without needing access to these closure-scoped variables.
  populateDropdownIfAvailable = populateDropdown;

  function positionDropdown() {
    // position: fixed popover anchored to the trigger's viewport rect —
    // required because .side-menu nav has overflow-x: clip, which would
    // silently clip an absolutely-positioned popover extending past it.
    const rect = trigger.getBoundingClientRect();
    const GAP = 10;
    popover.style.top = `${rect.top}px`;
    // RTL sidebar sits on the right edge — open the popover toward the
    // content area, i.e. to the left of the trigger.
    popover.style.right = `${window.innerWidth - rect.left + GAP}px`;
    popover.style.left = "auto";

    // Clamp so it never runs off the bottom of the viewport.
    const popoverHeight = popover.offsetHeight;
    const maxTop = window.innerHeight - popoverHeight - 8;
    if (popoverHeight && rect.top > maxTop) {
      popover.style.top = `${Math.max(8, maxTop)}px`;
    }
  }

  function openDropdown() {
    populateDropdown();
    popover.classList.add("open");
    positionDropdown();
    trigger.setAttribute("aria-expanded", "true");
    isOpen = true;

    const first = popover.querySelector(FOCUSABLE_SELECTOR);
    if (first) first.focus();

    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("keydown", onKeydown, true);
    window.addEventListener("resize", positionDropdown);
    window.addEventListener("scroll", positionDropdown, true);
  }

  function closeDropdown({ returnFocus = false } = {}) {
    popover.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    isOpen = false;

    document.removeEventListener("click", onDocumentClick, true);
    document.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("resize", positionDropdown);
    window.removeEventListener("scroll", positionDropdown, true);

    if (returnFocus) trigger.focus();
  }

  function onDocumentClick(e) {
    if (!popover.contains(e.target) && !trigger.contains(e.target)) {
      closeDropdown();
    }
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDropdown({ returnFocus: true });
      return;
    }

    if (e.key === "Tab") {
      const focusable = [...popover.querySelectorAll(FOCUSABLE_SELECTOR)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        e.shiftKey
          ? document.activeElement === first
          : document.activeElement === last
      ) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
  }

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    if (isOpen) closeDropdown();
    else openDropdown();
  });

  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");

  const signOutBtn = popover.querySelector("#sideMenuDropdownSignOut");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      signOutBtn.disabled = true;
      try {
        await fullSignOut(await ensureSharedSupabaseClient());
      } finally {
        window.location.reload();
      }
    });
  }

  if (signInRow) {
    signInRow.addEventListener("click", () => {
      closeDropdown();
      openSignInDialog();
    });
  }

  window.__closeProfileDropdown = closeDropdown;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initProfileDropdown, { once: true });
} else {
  initProfileDropdown();
}

// ============================================================================
// CHANGE USERNAME
// ============================================================================
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { _prompt, showNotification } from "../notifications/notifications.js";
import { validateUsername } from "../../shared/user-name-validation.js";

window.changeUsername = async function (message = "أدخل الإسم الجديد") {
  try {
    // Only force-close the sidebar on mobile (bottom-sheet mode). On desktop
    // this used to collapse/close the persistent sidebar too, which broke
    // the UI — closing was never meant to happen there.
    if (
      window.innerWidth <= 768 &&
      typeof window.__closeMobileSidebar === "function"
    ) {
      window.__closeMobileSidebar();
    }
    if (typeof window.__closeProfileDropdown === "function") {
      window.__closeProfileDropdown();
    }

    const currentName = getFromStorage("username", "User");
    const newName = await _prompt(message, currentName);

    if (newName === null) return;

    const validation = validateUsername(newName);
    if (!validation.valid) {
      _alert(validation.message);
      return;
    }

    const trimmedName = newName.trim();
    if (setInStorage("username", trimmedName)) {
      // For the main page's welcome message
      if (
        window.location.pathname.startsWith("/index") ||
        window.location.pathname === "/"
      ) {
        const { updateWelcomeMessage } =
          await import("../../features/home/welcome-message.js");
        updateWelcomeMessage();
      }
      // For the leaderboard name in profile page
      else if (window.location.pathname.startsWith("/profile")) {
        const { refreshUI } = await import("../../features/profile/profile.js");
        refreshUI();
      } else if (window.location.pathname.startsWith("/settings")) {
        const settingsNameInput = document.getElementById("settingsName");
        if (settingsNameInput) settingsNameInput.value = trimmedName;
      } else if (window.location.pathname.startsWith("/result")) {
        const resultUserName = document.getElementById("result-page-username");
        resultUserName.textContent = trimmedName;
      }

      const sideMemuNameDisplay = document.getElementById("userNameDisplay");
      if (sideMemuNameDisplay) {
        const currentName = localStorage.getItem("username") || "مستخدم";
        sideMemuNameDisplay.textContent = currentName;
      }

      showNotification(
        "تم التحديث",
        `تم تغيير اسمك إلى ${trimmedName}`,
        "./favicon.png",
      );
    }
  } catch (error) {
    console.error("Error changing username:", error);
    _alert("حدث خطأ أثناء تغيير الاسم. حاول مرة أخرى.");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const changeUsernameBtn = document.querySelector(".mobile-only-menu-item[onclick*='changeUsername']");
  if (changeUsernameBtn && changeUsernameBtn.parentNode) {
    const mobileAdminBtn = document.createElement("button");
    mobileAdminBtn.type = "button";
    mobileAdminBtn.className = "menu-item mobile-only-menu-item";
    mobileAdminBtn.id = "sideMenuMobileAdminSignIn";
    mobileAdminBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" height="22" width="22" fill="currentColor">
        <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z"/>
      </svg>
      <span class="menu-label">دخول المشرفين</span>
    `;

    const mobileReportsLink = document.createElement("a");
    mobileReportsLink.href = "reports.html";
    mobileReportsLink.className = "menu-item mobile-only-menu-item";
    mobileReportsLink.id = "sideMenuMobileReportsLink";
    const isReportsPage =
      window.location.pathname.endsWith("/reports.html") ||
      window.location.pathname.endsWith("/reports");
    if (isReportsPage) {
      mobileReportsLink.classList.add("active");
    }
    mobileReportsLink.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span class="menu-label">البلاغات</span>
    `;

    changeUsernameBtn.parentNode.insertBefore(mobileAdminBtn, changeUsernameBtn);
    changeUsernameBtn.parentNode.insertBefore(mobileReportsLink, changeUsernameBtn);

    mobileAdminBtn.addEventListener("click", () => {
      // Same as changeUsername: only force-close on mobile bottom-sheet mode.
      if (
        window.innerWidth <= 768 &&
        typeof window.__closeMobileSidebar === "function"
      ) {
        window.__closeMobileSidebar();
      }
      const roleInfo = getAdminRoleInfo();
      if (!roleInfo) {
        openSignInDialog();
      } else {
        fullSignOut(getIndexSupabaseClient()).then(() => window.location.reload());
      }
    });

    // Initial state setup
    const roleInfo = getAdminRoleInfo();
    const label = mobileAdminBtn.querySelector(".menu-label");
    if (label) {
      label.textContent = roleInfo ? "تسجيل الخروج" : "دخول المشرفين";
    }
  }
});
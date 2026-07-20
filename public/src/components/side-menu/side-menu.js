// ============================================================================
// public/src/components/side-menu/side-menu.js — Persistent collapsible icon-rail sidebar
// Desktop: 64px collapsed ↔ 240px expanded, state in localStorage
// Mobile (≤768px): bottom sheet with backdrop
// ============================================================================

// ── PWA Install Prompt — captured globally so it works on every page ─────────
(function () {
  let _deferredInstallPrompt = null;
  const installButtons = () => document.querySelectorAll(".install-app");
  const setInstallButtonsVisible = (visible) => {
    installButtons().forEach((btn) => {
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
        const btns = document.querySelectorAll(".install-app");
        btns.forEach((btn) => (btn.style.display = "none"));
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
  const toggleBtn = document.getElementById("sidebarToggle"); // desktop-only
  const animationToggle = document.getElementById("animationToggle");
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
        itemPath === path || (href === "/" && (path === "" || path === "index.html"));
      item.classList.toggle("active", isActive);
      if (isActive) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
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
      // Desktop: restore saved preference
      const saved = localStorage.getItem(STORAGE_KEY);
      const expanded = saved === null ? false : saved === "true";
      applyDesktopState(expanded);
      sidebar.setAttribute("aria-hidden", "false");
    }

    // Sync theme buttons pressed state
    const currentTheme =
      document.documentElement.getAttribute("data-theme") || "light";
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

    // Sync bottom nav active tab (mobile)
    syncBottomNavActiveState();
  }

  // ── Desktop Toggle ──────────────────────────────────────────────────────────

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const willExpand = !sidebar.classList.contains("expanded");
      applyDesktopState(willExpand);
      try {
        localStorage.setItem(STORAGE_KEY, String(willExpand));
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

  // ── Contact Developer button ────────────────────────────────────────────────

  const contactDevBtn = document.getElementById("contactDevBtn");
  if (contactDevBtn) {
    contactDevBtn.addEventListener("click", () => {
      if (isMobile()) closeMobileSidebar();
      else {
        // The side bar is expanded
        const sideBarIsNotExpanded = !sidebar.classList.contains("expanded");

        if (!sideBarIsNotExpanded) {
          applyDesktopState(sideBarIsNotExpanded);
          try {
            localStorage.setItem(STORAGE_KEY, String(sideBarIsNotExpanded));
          } catch (_) {}
        }
      }

      setTimeout(
        () => {
          if (typeof window.openContactOverlay === "function") {
            window.openContactOverlay();
          }
        },
        isMobile() ? 150 : 0,
      );
    });
  }

  // ── Run ─────────────────────────────────────────────────────────────────────
  init();
})();

// ============================================================================
// User Avatar
// ============================================================================

import { avatarEngine, syncNavAvatars } from "../../shared/avatarEngine.js";


document.addEventListener("DOMContentLoaded", async () => {
  syncNavAvatars();

  window.addEventListener("avatarUpdated", () => {
    syncNavAvatars();
  });
});


// ============================================================================
// CONTACT OVERLAY
// ============================================================================

const phoneNumber = "201118482193";
const emailAddress = "belalamrofficial@gmail.com";

window.openContactOverlay = function () {
  const overlay = document.getElementById("contactDevOverlay");
  if (overlay) overlay.style.display = "flex";
};

window.closeContactOverlay = function () {
  const overlay = document.getElementById("contactDevOverlay");
  if (overlay) overlay.style.display = "none";
};

window.contactViaWhatsApp = function () {
  window.open(`https://wa.me/${phoneNumber}`, "_blank");
  closeContactOverlay();
};

window.contactViaTelegram = function () {
  window.open("https://t.me/BelalAmrMohamed", "_blank");
  closeContactOverlay();
};

window.contactViaEmail = function () {
  window.location.href = `mailto:${emailAddress}`;
  closeContactOverlay();
};

document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("contactDevOverlay");
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeContactOverlay();
    });
  }
});

// ============================================================================
// CHANGE USERNAME
// ============================================================================
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { prompt_user, showNotification } from "../notifications/notifications.js";
import { validateUsername } from "../../shared/user-name-validation.js";

window.changeUsername = async function (message = "أدخل الإسم الجديد") {
  try {
    const currentName = getFromStorage("username", "User");
    const newName = await prompt_user(message, currentName);

    if (newName === null) return;

    const validation = validateUsername(newName);
    if (!validation.valid) {
      alert(validation.message);
      return;
    }

    const trimmedName = newName.trim();
    if (setInStorage("username", trimmedName)) {
      // For the main page's welcome message
      if (
        window.location.pathname.startsWith("/index") ||
        window.location.pathname === "/"
      ) {
        const { updateWelcomeMessage } = await import("../../features/main/index.js");
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
    alert("حدث خطأ أثناء تغيير الاسم. حاول مرة أخرى.");
  }
};
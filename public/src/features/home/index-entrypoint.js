// ============================================================================
// public/src/features/home/index-entrypoint.js
// HOME PAGE ENTRYPOINT — thin wiring module that bootstraps the home page.
// ============================================================================
// This replaces the bottom section of the original index.js (the module's
// top-level side effects: window globals, DOMContentLoaded listener, the
// keyboard-shortcut listener, and the global click listener for tooltip
// cleanup).
//
// Import order matters for side-effects:
//   1. console-ui.js — runs the branded dev-console IIFE immediately
//   2. Everything else — logic modules, no hard ordering requirement
//
// NOTE: showNotification and _confirm are NOT ES exports —
// they are runtime globals loaded via a non-module <script> tag from
// src/components/notifications.js. Referenced as bare globals below.
// ============================================================================

// 1. Dev console side-effect (IIFE inside, no exports needed)
import "./console-ui.js";

// 2. Logic imports
import { initPWA } from "../../shared/pwa-manager.js";
import { syncAdminSessionWithSupabase } from "./session-sync.js";
import { initApp, restoreViewFromURL } from "./navigation.js";
import { renderRootCategories } from "./root-view.js";
import { startQuiz } from "./quiz-navigation.js";
import { updateWelcomeMessage } from "./welcome-message.js";
import { showShortcutsOverlay } from "./shortcuts-overlay.js";
import { getCategoryTree, setRestoring } from "./app-state.js";
import { escapeHtml } from "./escape-html.js";
import { getFromStorage } from "../../shared/storage-helpers.js";
import { showNotification } from "../../components/notifications/notifications.js";

// ── Window globals ────────────────────────────────────────────────────────────
// These exist because other non-module scripts (e.g. side-menu.js, per the
// original file's own header comment) call them directly on window.
// Original lines 4741-4742.
window.startQuiz = startQuiz;
window.renderRootCategories = renderRootCategories;

// ── Global click listener: close course-info tooltips on outside click ───────
// Ported verbatim from original lines 5499-5513 (the last lines of index.js).
document.addEventListener("click", (e) => {
  if (!e.target.closest(".course-info-container")) {
    document
      .querySelectorAll(".course-info-tooltip.show")
      .forEach((tooltip) => {
        tooltip.classList.remove("show");
      });
  }
});

// ── Global error boundary ─────────────────────────────────────────────────────
// Ported from original lines 5401-5404.
window.addEventListener("unhandledrejection", (event) => {
  // supabase-js fires-and-forgets its auth token-refresh promise whenever it
  // finds a stored session on init (autoRefreshToken). During a Supabase
  // outage those refreshes fail at the network layer ("Failed to fetch" /
  // AuthRetryableFetchError) and surface here as unhandled rejections.
  // Expected and harmless — the manifest load has its own timeout, retry
  // path, and last-good snapshot cache — so report them concisely instead
  // of dumping a full stack trace on every outage request.
  if (event.reason instanceof Error && /Failed to fetch/.test(event.reason.message)) {
    console.warn("Supabase auth refresh suppressed (edge unreachable):", event.reason.message);
    return;
  }
  console.error("Unhandled promise rejection:", event.reason);
  // In production, send to error tracking service
});

// ── DOMContentLoaded ──────────────────────────────────────────────────────────
// Original lines 4811-4914.
document.addEventListener("DOMContentLoaded", () => {
  // ── PWA bootstrap (runs on EVERY page) ───────────────────────────────────
  // Must come before the isIndexPage guard so SW registration and the offline
  // banner are active regardless of which page the user is on.
  initPWA();

  // ── Page guard ────────────────────────────────────────────────────────────
  // index-entrypoint.js is imported as an ES module by side-menu.js (for the
  // exported updateWelcomeMessage function).  ES module imports cause the
  // ENTIRE module to execute, including this DOMContentLoaded listener, on
  // EVERY page that loads side-menu.js (quiz.html, result.html, etc.).
  //
  // Without this guard, initApp() would run on quiz.html and call
  // renderRootCategories() → history.replaceState("", "", pathname), stripping
  // the ?id= query parameter from the quiz URL before quiz.js could read it.
  //
  // /course/:name (and /course/:name/:sub/:sub2/...) is also a valid index
  // page: course and nested-folder pages render inside this same SPA shell
  // (see render-course.js's header comment), just at a real pathname
  // instead of a hash on "/" — nested subfolders now get their own real
  // path segments too (see navigation.js's restoreViewFromURL and
  // render-course.js's :path* handling), so the guard must match any depth
  // under /course/, not just the single-segment course path. /quiz/:id is
  // NOT affected here — quiz.html is a separate physical file (see
  // public/quiz.html) that never loads this module's DOMContentLoaded
  // listener in the first place, so no extra check is needed to keep that
  // path working.
  const p = window.location.pathname;
  const isIndexPage =
    p === "/" ||
    p.endsWith("/index.html") ||
    p.endsWith("/index") ||
    /^\/course\/[^/]+(\/[^/]+)*\/?$/.test(p);
  if (!isIndexPage) return;

  // Sync local admin session state with Supabase before anything renders
  // admin-dependent UI (log-in/log-out button, admin upload buttons, etc.)
  // so index.html and sign-in can never disagree about auth state.
  syncAdminSessionWithSupabase();

  // Initial load
  updateWelcomeMessage();

  // Show welcome notification with error handling
  // showNotification is a runtime global — not an ES export (see file header).
  try {
    const username = getFromStorage("username", "User");
    // eslint-disable-next-line no-undef
    showNotification(
      "منصة امتحانات بصمجي",
      `السلام عليكم يا ${escapeHtml(username)}`,
      "./assets/images/السلام عليكم.png",
    );
  } catch (error) {
    console.error("Error showing welcome notification:", error);
  }

  // ── Bug 1 Fix: listen for back / forward navigation ───────────────────────
  // Original lines 4851-4860.
  window.addEventListener("popstate", () => {
    // Guard: if the manifest hasn't loaded yet, categoryTree will be null —
    // restoreViewFromURL can handle a null tree (falls back to root) but the
    // guard mirrors the original's `if (!categoryTree) return;`.
    if (!getCategoryTree()) return;
    setRestoring(true);
    try {
      restoreViewFromURL();
    } finally {
      setRestoring(false);
    }
  });

  initApp().catch((err) => {
    console.error("Init error:", err);
    if (typeof renderRootCategories === "function") renderRootCategories();
  });

  // ── Keyboard shortcuts: "/" or Ctrl+K → open search; "?" → shortcuts overlay
  // Original lines 4867-4914.
  document.addEventListener("keydown", (e) => {
    // Ignore if focus is inside an input, textarea, or contenteditable
    const tag = document.activeElement?.tagName;
    const isEditable =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      document.activeElement?.isContentEditable;
    if (isEditable) return;

    const isSearchShortcut =
      e.key === "/" ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k");

    if (isSearchShortcut) {
      e.preventDefault();

      const headerSearchBtn = document.getElementById("headerSearchBtn");
      if (!headerSearchBtn) return;

      // If the search bar is already open, focus the input directly
      const searchInput = document.getElementById("courseSearch");
      const searchContainer = document.getElementById("searchContainer");
      const isOpen =
        searchContainer &&
        searchContainer.getAttribute("aria-hidden") !== "true";

      if (isOpen && searchInput) {
        searchInput.focus();
        searchInput.select();
      } else {
        headerSearchBtn.click();
        // Wait one frame for the panel to open before focusing
        requestAnimationFrame(() => {
          const input = document.getElementById("courseSearch");
          if (input) {
            input.focus();
            input.select();
          }
        });
      }
    }

    if (e.key === "?" && !isEditable) {
      e.preventDefault();
      showShortcutsOverlay();
    }
  });
});
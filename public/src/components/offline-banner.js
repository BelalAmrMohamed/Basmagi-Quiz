/**
 * offline-banner.js
 * Manages the persistent offline / online status banner.
 *
 * Usage:
 *   import { initOfflineBanner } from "../components/offline-banner.js";
 *   initOfflineBanner();   ← called once from pwa-manager.js → initPWA()
 *
 * The banner element (#offlineBanner) is injected into <body> if it does not
 * already exist in the DOM, so this module is safe to import on any page.
 *
 * All UI strings are Arabic (RTL) as required by the feature plan.
 */

// ── String constants (Arabic, do not translate) ────────────────────────────
const OFFLINE_TEXT = "أنت غير متصل بالإنترنت — تعمل في وضع عدم الاتصال";
const ONLINE_TEXT = "عدت للإنترنت";

// How long the "back online" flash stays visible before the banner hides (ms)
const ONLINE_FLASH_DURATION = 2000;

// ── Module-level reference so event handlers share the same element ────────
let banner = null;
let onlineFlashTimer = null; // tracks the auto-hide timeout

// ── Internal helpers ───────────────────────────────────────────────────────

/** Ensures the #offlineBanner element exists in the DOM and returns it. */
function getOrCreateBanner() {
  let el = document.getElementById("offlineBanner");
  if (!el) {
    el = document.createElement("div");
    el.id = "offlineBanner";
    // Accessibility: live region so screen readers announce state changes
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    document.body.appendChild(el);
  }
  return el;
}

/** Switches the banner to the offline (amber) state and shows it. */
function setOffline() {
  // Cancel any pending auto-hide from a previous "back online" flash
  if (onlineFlashTimer !== null) {
    clearTimeout(onlineFlashTimer);
    onlineFlashTimer = null;
  }

  banner.innerHTML = `<span class="banner-icon" aria-hidden="true">📡</span>${OFFLINE_TEXT}`;

  // Use the warning token (amber) — defined in every theme in themes.css
  banner.style.background = "var(--color-warning, #f59e0b)";

  banner.classList.add("is-visible");
}

/**
 * Switches the banner to the "back online" (green) state, keeps it visible
 * for ONLINE_FLASH_DURATION ms, then slides it away.
 */
function setOnline() {
  // Cancel any pending auto-hide that may still be running
  if (onlineFlashTimer !== null) {
    clearTimeout(onlineFlashTimer);
    onlineFlashTimer = null;
  }

  banner.innerHTML = `<span class="banner-icon" aria-hidden="true">✓</span>${ONLINE_TEXT}`;

  // Use the success token (green) — defined in every theme in themes.css
  banner.style.background = "var(--color-success, #10b981)";

  // Make sure the banner is visible (it may already be if we were offline)
  banner.classList.add("is-visible");

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "TRIGGER_SYNC" });
  }

  // Auto-hide after the flash duration
  onlineFlashTimer = setTimeout(() => {
    banner.classList.remove("is-visible");
    onlineFlashTimer = null;
  }, ONLINE_FLASH_DURATION);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialises the offline/online status banner.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * Call order matters: must be called after <body> exists (DOMContentLoaded
 * or later), which is guaranteed by initPWA() in pwa-manager.js.
 */
export function initOfflineBanner() {
  // Idempotency guard: if we already set up the listeners, do nothing
  if (banner !== null) return;

  banner = getOrCreateBanner();

  // React to future network changes
  window.addEventListener("offline", setOffline);
  window.addEventListener("online", setOnline);

  // Check the current state immediately (user may have loaded while offline)
  if (!navigator.onLine) {
    setOffline();
  }
  // If already online, the banner stays hidden (transform: translateY(100%))
}

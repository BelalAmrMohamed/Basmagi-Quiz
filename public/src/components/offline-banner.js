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
const OFFLINE_TEXT = "أنت غير متصل بالإنترنت";
const ONLINE_TEXT = "عدت للإنترنت";

// How long the "back online" flash stays visible before the banner hides (ms)
const ONLINE_FLASH_DURATION = 2000;

// ── Module-level reference so event handlers share the same element ────────
let banner = null;
let onlineFlashTimer = null; // tracks the auto-hide timeout
let connectivityCheckInterval = null;
let probeUrl = "";
const PROBE_TIMEOUT_MS = 4000;
let wasOfflineDuringSession = false;

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
  wasOfflineDuringSession = true;

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
    navigator.serviceWorker.controller.postMessage({
      type: "TRIGGER_SYNC",
      supabaseUrl: window.SUPABASE_URL || "",
      supabaseKey:
        window.SUPABASE_SERVICE_KEY || window.SUPABASE_ANON_KEY || "",
    });
  }

  // Auto-hide after the flash duration
  onlineFlashTimer = setTimeout(() => {
    banner.classList.remove("is-visible");
    onlineFlashTimer = null;
  }, ONLINE_FLASH_DURATION);
}

async function checkRealConnectivity() {
  if (!probeUrl) {
    return navigator.onLine;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    await fetch(probeUrl, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function updateBannerState({ isInitialCheck = false } = {}) {
  const isOnline = await checkRealConnectivity();
  if (isOnline) {
    if (wasOfflineDuringSession) {
      setOnline();
    } else if (isInitialCheck && banner) {
      // Normal fresh online load: keep banner hidden.
      banner.classList.remove("is-visible");
    }
  } else {
    setOffline();
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialises the offline/online status banner.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * Call order matters: must be called after <body> exists (DOMContentLoaded
 * or later), which is guaranteed by initPWA() in pwa-manager.js.
 */
export function initOfflineBanner(connectivityProbeUrl) {
  // Idempotency guard: if we already set up the listeners, do nothing
  if (banner !== null) return;

  probeUrl =
    typeof connectivityProbeUrl === "string" ? connectivityProbeUrl : "";
  wasOfflineDuringSession = false;
  banner = getOrCreateBanner();

  // React to future network changes
  window.addEventListener("offline", updateBannerState);
  window.addEventListener("online", updateBannerState);

  // Check the current state immediately and keep polling for silent drops.
  updateBannerState({ isInitialCheck: true });
  connectivityCheckInterval = setInterval(updateBannerState, 30_000);
}

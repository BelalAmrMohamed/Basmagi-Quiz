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
let bannerResizeObserver = null; // keeps reserved page space in sync with banner height

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

/**
 * The banner is `position: fixed`, so it sits on top of the page rather
 * than taking up layout space. Left alone, that means it permanently
 * overlaps whatever is at the bottom of the page (e.g. a footer with
 * privacy/terms links) and the page can't be scrolled far enough to
 * reveal the content underneath it.
 *
 * To fix that, whenever the banner is visible we measure its real
 * rendered height and reserve that much space at the bottom of the page
 * via `body` padding, so the footer is pushed up above the banner instead
 * of being hidden behind it.
 */
function reserveBannerSpace() {
  if (!banner) return;
  const height = banner.getBoundingClientRect().height;
  document.documentElement.style.setProperty(
    "--offline-banner-height",
    `${height}px`,
  );
}

/** Shows the banner and reserves matching space at the bottom of the page. */
function showBanner() {
  banner.classList.add("is-visible");
  document.body.classList.add("has-offline-banner");
  reserveBannerSpace();

  // The banner's text can wrap onto a second line on narrow screens, or on
  // orientation change, which changes its height while it's still visible.
  // Keep the reserved space in sync so the footer never gets re-covered.
  if (!bannerResizeObserver && "ResizeObserver" in window) {
    bannerResizeObserver = new ResizeObserver(reserveBannerSpace);
    bannerResizeObserver.observe(banner);
  }
}

/** Hides the banner and releases the reserved page space. */
function hideBanner() {
  banner.classList.remove("is-visible");
  document.body.classList.remove("has-offline-banner");
  if (bannerResizeObserver) {
    bannerResizeObserver.disconnect();
    bannerResizeObserver = null;
  }
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

  // Glass tint is driven by CSS classes now (see offline-banner.css), not an
  // inline background, so the amber gradient/rim-light can be composited
  // with the blur instead of painting over it.
  banner.classList.remove("state-online");
  banner.classList.add("state-offline");
  showBanner();
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

  // Glass tint is driven by CSS classes now (see offline-banner.css), not an
  // inline background, so the green gradient/rim-light can be composited
  // with the blur instead of painting over it.
  banner.classList.remove("state-offline");
  banner.classList.add("state-online");

  // Make sure the banner is visible (it may already be if we were offline)
  showBanner();

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
    hideBanner();
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
      hideBanner();
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
/**
 * public/src/shared/pwa-manager.js
 * Central PWA bootstrap for every page.
 *
 * Responsibilities:
 *   1. Register the service worker (network-only + offline page).
 *   2. Show/hide the offline/online banner (delegates to offline-banner.js).
 *
 * Does NOT:
 *   - Cache quizzes or static assets for offline use.
 *   - Intercept beforeinstallprompt (side-menu.js owns that).
 */

import { initOfflineBanner } from "../components/offline-banner/offline-banner.js";

let swRegistration = null;

/**
 * Registers /service-worker.js and wires up the auto-update flow.
 * Skips silently if the browser doesn't support service workers.
 */
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    console.warn("[PWA] Service workers not supported in this browser.");
    return;
  }

  try {
    swRegistration = await navigator.serviceWorker.register("/service-worker.js", {
      scope: "/",
      updateViaCache: "none",
    });

    console.log("[PWA] Service worker registered:", swRegistration.scope);

    swRegistration.addEventListener("updatefound", () => {
      const newWorker = swRegistration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: "SKIP_WAITING" });
          console.log("[PWA] New SW installed — SKIP_WAITING sent.");
        }
      });
    });
  } catch (err) {
    console.error("[PWA] Service worker registration failed:", err);
  }
}

/**
 * Bootstraps the PWA layer. Call once per page on DOMContentLoaded.
 */
export function initPWA() {
  registerServiceWorker();
}

export function initPWAWithBanner(probeUrl) {
  initOfflineBanner(probeUrl);
  initPWA();
}

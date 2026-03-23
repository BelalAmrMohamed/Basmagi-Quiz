/**
 * pwa-manager.js
 * Central PWA bootstrap for every page.
 *
 * Responsibilities (Step 1 — offline banner + SW registration):
 *   1. Register the service worker.
 *   2. Show/hide the offline/online banner (delegates to offline-banner.js).
 *   3. Listen for the "pwa-install-accepted" custom event dispatched by
 *      side-menu.js and trigger quiz caching (stub — wired up in Step 2).
 *   4. Handle messages posted back from the SW (stub — wired up in Step 2).
 *
 * Does NOT:
 *   - Intercept or re-capture beforeinstallprompt (side-menu.js owns that).
 *   - Touch IndexedDB or background sync (Step 2 / Step 3).
 *   - Import anything from quizManifest.js or filterUtils.js yet.
 *
 * Import this module on every page and call initPWA() on DOMContentLoaded:
 *
 *   <script type="module">
 *     import { initPWA } from "./src/scripts/pwa-manager.js";
 *     document.addEventListener("DOMContentLoaded", () => initPWA());
 *   </script>
 */

import { initOfflineBanner } from "../components/offline-banner.js";
import { showNotification }  from "../components/notifications.js";

// ── Module state ───────────────────────────────────────────────────────────
let swRegistration = null;

// ── 1. Service Worker Registration ────────────────────────────────────────

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
    swRegistration = await navigator.serviceWorker.register(
      "/service-worker.js",
      {
        scope: "/",
        // Always re-fetch the SW script on navigation so updates are caught
        // as soon as possible without waiting for a 24-hour HTTP cache expiry.
        updateViaCache: "none",
      },
    );

    console.log("[PWA] Service worker registered:", swRegistration.scope);

    // ── Auto-activate updates ──────────────────────────────────────────────
    // When a new SW is found, tell it to skip waiting so it becomes the
    // controller as soon as the installing phase completes.
    swRegistration.addEventListener("updatefound", () => {
      const newWorker = swRegistration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (
          newWorker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          // A previous SW is still controlling the page — send SKIP_WAITING
          // so the new SW activates immediately on next navigation.
          newWorker.postMessage({ type: "SKIP_WAITING" });
          console.log("[PWA] New SW installed — SKIP_WAITING sent.");
        }
      });
    });

    // ── Listen for messages from the SW (delegated to handleSWMessage) ─────
    navigator.serviceWorker.addEventListener("message", handleSWMessage);
  } catch (err) {
    console.error("[PWA] Service worker registration failed:", err);
  }
}

// ── 2. Install-acceptance listener ────────────────────────────────────────

/**
 * Listens for the "pwa-install-accepted" custom event dispatched by
 * side-menu.js after the user taps "Install" and accepts the prompt.
 *
 * This keeps pwa-manager.js entirely decoupled from the install-prompt flow
 * while still being able to react to a successful install.
 */
function initInstallListener() {
  document.addEventListener("pwa-install-accepted", async () => {
    console.log("[PWA] Install accepted — starting subscribed quiz cache.");
    await triggerSubscribedQuizCache();
  });
}

// ── 3. Quiz caching trigger (Step 2 stub) ─────────────────────────────────

/**
 * Fetches the user's subscribed categories and posts a message to the SW
 * instructing it to cache all matching quizzes in IndexedDB.
 *
 * Stub for Step 1 — full implementation added in Step 2.
 */
export async function triggerSubscribedQuizCache() {
  // Step 2: import getSubscribedCourses() from filterUtils.js, retry until
  // navigator.serviceWorker.controller is available, then postMessage.
  console.log("[PWA] triggerSubscribedQuizCache() — stub, wired up in Step 2.");
}

// ── 4. SW → page message handler (Step 2 stub) ────────────────────────────

/**
 * Handles messages posted back from the service worker.
 *
 * Stub for Step 1 — full implementation added in Step 2.
 *
 * @param {MessageEvent} event
 */
function handleSWMessage(event) {
  const { data } = event;
  if (!data) return;

  // Step 2: handle CACHE_COMPLETE, CACHE_PROGRESS, SYNC_COMPLETE, etc.
  console.log("[PWA] Message from SW:", data);
}

// ── 5. Public entry point ─────────────────────────────────────────────────

/**
 * Bootstraps the full PWA layer. Call once per page on DOMContentLoaded.
 *
 *   1. Initialises the offline/online banner.
 *   2. Registers the service worker.
 *   3. Sets up the install-acceptance listener.
 */
export function initPWA() {
  initOfflineBanner();      // must come first — body must exist
  registerServiceWorker();  // async, fire-and-forget is fine here
  initInstallListener();    // sync, just attaches an event listener
}

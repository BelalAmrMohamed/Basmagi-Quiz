/**
 * public/src/shared/pwa-manager.js
 * Central PWA bootstrap for every page.
 *
 * Responsibilities:
 *   1. Register the service worker.
 *   2. Show/hide the offline/online banner (delegates to offline-banner.js).
 *   3. Ask the service worker to cache everything the offline pages need (WARM_OFFLINE), but only for users
 *      who can benefit: installed app, local content in «محتواي», or the C++ Instant Compiler installed.
 *
 * Does NOT:
 *   - Intercept beforeinstallprompt (side-menu.js owns that).
 */

import { initOfflineBanner } from "../components/offline-banner/offline-banner.js";

let swRegistration = null;

const WARM_KEY = "basmagi_offline_warm"; // { sig, at } — what was last requested, so we do not re-download on every page
const INSTALLED_KEY = "basmagi_pwa_installed";
const WARM_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const CPP_WASM_CACHE = "basmagi-cpp-wasm-v2"; // runtimes/cpp/src/wasm-cache.ts

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

/** Running as an installed app (any display mode the manifest can produce), or an install was seen on this browser. */
export function isInstalledApp() {
  try {
    if (["standalone", "minimal-ui", "window-controls-overlay", "fullscreen"].some((m) => matchMedia(`(display-mode: ${m})`).matches)) return true;
  } catch { /* matchMedia unavailable */ }
  return navigator.standalone === true || safeGet(INSTALLED_KEY) === "1";
}

/** «محتواي» holds at least one local quiz / lesson / notebook. A length check: the JSON can be large, never parse it here. */
function hasLocalContent() {
  const raw = safeGet("user_quizzes");
  return !!raw && raw.length > 2;
}

async function hasInstantCompiler() {
  try { return typeof caches !== "undefined" && (await caches.has(CPP_WASM_CACHE)); } catch { return false; }
}

/**
 * Tells the service worker to cache the offline pages. Skipped when nothing changed since the last request
 * (the worker skips files it already has anyway, but this avoids waking it and re-checking ~200 URLs).
 */
export async function requestOfflineWarmup({ force = false } = {}) {
  if (!("serviceWorker" in navigator) || navigator.onLine === false) return;
  const compiler = await hasInstantCompiler();
  if (!force && !(isInstalledApp() || hasLocalContent() || compiler)) return;
  const sig = `1${compiler ? "c" : ""}`;
  try {
    const last = JSON.parse(safeGet(WARM_KEY) || "null");
    if (!force && last && last.sig === sig && Date.now() - last.at < WARM_MAX_AGE_MS) return;
  } catch { /* corrupt entry: warm again */ }
  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) return;
  worker.postMessage({ type: "WARM_OFFLINE" });
  safeSet(WARM_KEY, JSON.stringify({ sig, at: Date.now() }));
}

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

    // Let the page finish loading first: the warm-up downloads a few MB.
    const warm = () => requestOfflineWarmup().catch(() => { });
    if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 8000 });
    else setTimeout(warm, 3000);

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
  // Fires once when the user installs the app: remember it and cache everything right away.
  window.addEventListener("appinstalled", () => {
    safeSet(INSTALLED_KEY, "1");
    requestOfflineWarmup({ force: true }).catch(() => { });
  });
  // A new service worker version starts with a clean cache: ask it again.
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    try { localStorage.removeItem(WARM_KEY); } catch { /* ignore */ }
    requestOfflineWarmup().catch(() => { });
  });
}

export function initPWAWithBanner(probeUrl) {
  initOfflineBanner(probeUrl);
  initPWA();
}

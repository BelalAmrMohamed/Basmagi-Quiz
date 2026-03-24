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
import { getSubscribedCourses } from "../shared/filterUtils.js";
import { getManifest } from "./quizManifest.js";
import { userProfile } from "./userProfile.js";

// ── Module state ───────────────────────────────────────────────────────────
let swRegistration = null;

function getSupabaseCredentials() {
  const supabaseUrl = window.SUPABASE_URL || "";
  const supabaseKey = window.SUPABASE_SERVICE_KEY || window.SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseKey) {
    console.warn("[PWA] Supabase credentials are missing in window globals.");
  }

  return { supabaseUrl, supabaseKey };
}

async function buildQuizListForCategories(categoryKeys) {
  const safeKeys = Array.isArray(categoryKeys) ? categoryKeys : [];
  if (safeKeys.length === 0) return [];

  const manifest = await getManifest();
  const categoryTree = manifest?.categoryTree || {};
  const selectedSet = new Set(safeKeys);
  const quizList = [];

  for (const categoryKey of safeKeys) {
    const category = categoryTree[categoryKey];
    if (!category || !Array.isArray(category.exams)) continue;

    for (const exam of category.exams) {
      const rawPath = typeof exam?.path === "string" ? exam.path : "";
      const isDbQuiz = rawPath.startsWith("/api/quiz-data");
      const isStaticQuiz = rawPath.startsWith("/data/");

      if (!isDbQuiz && !isStaticQuiz) continue;

      quizList.push({
        id: isDbQuiz ? exam.id || null : null,
        category: categoryKey,
        path: isStaticQuiz ? rawPath : null,
        type: isDbQuiz ? "db" : "static",
      });
    }
  }

  // Safety guard if a future manifest item leaks from non-subscribed category keys.
  return quizList.filter((entry) => selectedSet.has(entry.category));
}

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
  let controller = navigator.serviceWorker.controller;

  for (let attempt = 0; attempt < 5 && !controller; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    controller = navigator.serviceWorker.controller;
  }

  if (!controller) {
    console.warn("[PWA] No active SW controller after retries; cache trigger skipped.");
    return;
  }

  const manifest = await getManifest();
  const categoryTree = manifest?.categoryTree || {};
  const subscribedIds = userProfile.getSubscribedCourseIds();
  const subscribedCategories = getSubscribedCourses(categoryTree, subscribedIds)
    .map((course) => course.key);

  if (!subscribedCategories || subscribedCategories.length === 0) {
    console.log("[PWA] No subscribed categories found; cache trigger skipped.");
    return;
  }

  const quizList = await buildQuizListForCategories(subscribedCategories);
  const { supabaseUrl, supabaseKey } = getSupabaseCredentials();

  controller.postMessage({
    type: "CACHE_SUBSCRIBED_QUIZZES",
    categories: subscribedCategories,
    quizList,
    supabaseUrl,
    supabaseKey,
  });
}

function arraysEqualByValue(a, b) {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((value, index) => value === bSorted[index]);
}

function initSubscriptionWatcher() {
  let previousCategories = [];
  let checkInFlight = false;
  let pollTimer = null;

  const checkForChanges = async () => {
    if (checkInFlight) return;
    checkInFlight = true;

    try {
      const manifest = await getManifest();
      const categoryTree = manifest?.categoryTree || {};
      const subscribedIds = userProfile.getSubscribedCourseIds();
      const currentCategories = getSubscribedCourses(categoryTree, subscribedIds)
        .map((course) => course.key);

      if (arraysEqualByValue(previousCategories, currentCategories)) return;

      const added = currentCategories.filter(
        (category) => !previousCategories.includes(category),
      );
      const removed = previousCategories.filter(
        (category) => !currentCategories.includes(category),
      );

      if (added.length === 0 && removed.length === 0) return;

      console.log("[PWA] Subscription changed — added:", added, "removed:", removed);
      previousCategories = currentCategories;

      if (!navigator.serviceWorker.controller) return;

      const quizList = await buildQuizListForCategories(currentCategories);
      const { supabaseUrl, supabaseKey } = getSupabaseCredentials();

      navigator.serviceWorker.controller.postMessage({
        type: "UPDATE_SUBSCRIBED_QUIZZES",
        allCategories: currentCategories,
        added,
        removed,
        quizList,
        supabaseUrl,
        supabaseKey,
      });
    } catch (error) {
      console.warn("[PWA] Failed to process subscription changes:", error);
    } finally {
      checkInFlight = false;
    }
  };

  const initWatcherState = async () => {
    try {
      const manifest = await getManifest();
      const categoryTree = manifest?.categoryTree || {};
      const subscribedIds = userProfile.getSubscribedCourseIds();
      previousCategories = getSubscribedCourses(categoryTree, subscribedIds)
        .map((course) => course.key);
    } catch (error) {
      previousCategories = [];
      console.warn("[PWA] Failed to initialize subscription watcher:", error);
    }
  };

  initWatcherState();
  window.addEventListener("storage", checkForChanges);
  window.addEventListener("focus", checkForChanges);
  document.addEventListener("subscriptions-changed", checkForChanges);
  pollTimer = window.setInterval(checkForChanges, 2000);

  window.addEventListener("beforeunload", () => {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  });
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

  if (data.type === "CACHE_COMPLETE") {
    showNotification(
      "تم التخزين",
      `تم حفظ ${data.count} اختبار للعمل دون اتصال ✓`,
      "success",
    );
    return;
  }

  if (data.type === "CACHE_PROGRESS") {
    console.log("[PWA] Cache progress:", data.cached, "/", data.total);
    return;
  }

  if (data.type === "SYNC_COMPLETE") {
    console.log("[PWA] Sync complete. Updated:", data.updated);
  }
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
  registerServiceWorker();  // async, fire-and-forget is fine here
  initInstallListener();    // sync, just attaches an event listener
  initSubscriptionWatcher();
}

export function initPWAWithBanner(probeUrl) {
  initOfflineBanner(probeUrl);
  initPWA();
}

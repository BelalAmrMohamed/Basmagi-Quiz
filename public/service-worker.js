// Service Worker for Basmagi Quiz Platform
// Provides offline support, caching, and performance improvements

const CACHE_VERSION = "basmagi-v6.2.2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const QUIZ_CACHE = `${CACHE_VERSION}-quizzes`;
const STATIC_QUIZ_CACHE = `${CACHE_VERSION}-static-quizzes`;

const QUIZ_API_PATH_PREFIXES = ["/api/quiz-data", "/api/quiz-manifest"];
const LATEX_CDN_ORIGIN = "https://cdn.jsdelivr.net";
const STATIC_QUIZ_PATH_PREFIXES = ["/data/", "/src/scripts/data/"];
let _supabaseUrl = null;
let _supabaseKey = null;

/*
 * HOW TO TEST STATIC QUIZ CACHING:
 * 1. Hard refresh the app while online
 * 2. Open a static quiz (one loaded from /data/...) while online
 * 3. DevTools → Application → Cache Storage → basmagi-v4.0.0-static-quizzes
 *    ✓ The quiz JSON URL should appear here
 * 4. DevTools → Application → IndexedDB → BasmagiQuizDB → staticQuizzes store
 *    ✓ An entry with 'path' matching the quiz pathname should appear here
 *
 * HOW TO TEST INDEXEDDB FALLBACK:
 * 1. Open a static quiz while online (confirms it's written to IDB per step above)
 * 2. DevTools → Application → Cache Storage → right-click basmagi-v4.0.0-static-quizzes → Delete
 * 3. Set Network to Offline
 * 4. Navigate to the same quiz
 *    ✓ Quiz should still load — served from IDB, not cache
 *    ✓ SW console should log: '[SW] IDB fallback used for: /data/...'
 * 5. If quiz fails to load, open the SW console and check for '[SW] IDB fallback failed'
 *    to confirm whether the path key lookup is the issue
 */

// Files to cache immediately.
// Everything except for signing in dependencies, since signing in requires
// internet, so caching its dependencies would be useless.
const STATIC_ASSETS = [
  // Pages
  "/",
  "/index.html",
  "/create-quiz.html",
  "/settings.html",

  // CSS
  "/src/styles/themes.css",
  "/src/features/home/index.css",
  "/src/features/create/create-quiz.css",
  "/src/features/settings/settings.css",

  "/src/styles/animations.css",
  "/src/styles/markdown.css",
  "/src/features/home/search.css",

  // JS (entry points)
  "/src/features/home/index-entrypoint.js",
  "/src/features/create/create-quiz.js",
  "/src/features/settings/settings.js",

  "/src/features/home/search-manager.js",
  "/src/shared/userProfile.js",
  "/src/shared/quizManifest.js",
  "/src/shared/quizId.js",
  "/src/shared/pwa-manager.js",

  "/src/shared/theme-controller.js",
  "/src/shared/canvas-animation.js",
  "/src/shared/gameEngine.js",
  "/src/shared/filterUtils.js",
  "/src/shared/markdown.js",
  "/src/shared/quiz-idb.js",
  "/src/shared/quiz-processor.js",
  "/src/shared/rate-essays.js",
  "/src/shared/storage-helpers.js",
  "/src/shared/user-name-validation.js",

  // Components
  "/src/components/side-menu/side-menu.css",
  "/src/components/side-menu/side-menu.js",
  "/src/components/notifications/notifications.css",
  "/src/components/notifications/notifications.js",
  "/src/components/offline-banner/offline-banner.css",
  "/src/components/offline-banner/offline-banner.js",

  // PWA shell files
  "/favicon.png",
  "/favicon.ico",
  "/favicon.svg",
  "/manifest.json",
];

const STATIC_ASSETS_SET = new Set(STATIC_ASSETS);

// Maximum number of items in dynamic cache
const CACHE_SIZE_LIMIT = {
  [DYNAMIC_CACHE]: 50,
  [IMAGE_CACHE]: 100,
  [QUIZ_CACHE]: 500,
  [STATIC_QUIZ_CACHE]: 300,
};

// Helper: Limit cache size. Trims oldest-first (cache.keys() returns
// insertion order) down to maxItems using a single keys() read and a loop,
// rather than recursing and re-reading keys() after every single deletion.
async function limitCacheSize(cacheName, maxItems) {
  if (!Number.isFinite(maxItems)) return; // no configured limit for this cache
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.length - maxItems;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

// Call sites intentionally don't await limitCacheSize (trimming shouldn't
// delay the response being returned to the page), but a bare fire-and-forget
// call whose promise rejects becomes an unhandled promise rejection. This
// wrapper keeps that behavior while making sure a failed trim is logged
// instead of silently escaping as an unhandled rejection.
function trimCacheAsync(cacheName, maxItems) {
  limitCacheSize(cacheName, maxItems).catch((error) => {
    console.warn(`[SW] Failed to trim cache "${cacheName}":`, error);
  });
}

// Helper: Check if request is for image
function isImageRequest(request) {
  return (
    request.destination === "image" ||
    /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(new URL(request.url).pathname)
  );
}

// Helper: Check if request is for a dynamically-generated OG image route.
// These come back as streamed ImageResponse bodies (no file extension, and
// destination is often "document" when hit via direct navigation), so the
// extension/destination checks in isImageRequest() miss them. They must
// never go through networkFirstStrategy's cache.put(), since attempting to
// clone+cache a streamed Satori response can throw and abort the response
// the browser actually receives, producing a blank page.
function isDynamicOGImageRequest(request) {
  try {
    const url = new URL(request.url);
    return url.origin === self.location.origin && url.pathname === "/api/og";
  } catch {
    return false;
  }
}

// Helper: Check if request is for audio/video media (should bypass cache to prevent stale media on reload)
function isMediaRequest(request) {
  return (
    request.destination === "audio" ||
    request.destination === "video" ||
    /\.(mp3|mp4|wav|webm|ogg|m4a|aac|mov|ogv)$/i.test(
      new URL(request.url).pathname,
    )
  );
}

// Helper: Check if request is for external resource
function isExternalRequest(request) {
  const url = new URL(request.url);
  const isLatexCDN = url.origin === LATEX_CDN_ORIGIN;
  return url.origin !== self.location.origin && !isLatexCDN;
}

function isQuizAPIRequest(request) {
  try {
    const url = new URL(request.url);
    return (
      url.origin === self.location.origin &&
      QUIZ_API_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
    );
  } catch {
    return false;
  }
}

function isStaticQuizRequest(request) {
  try {
    const url = new URL(request.url);
    return (
      url.origin === self.location.origin &&
      url.pathname.endsWith(".json") &&
      STATIC_QUIZ_PATH_PREFIXES.some((prefix) =>
        url.pathname.startsWith(prefix),
      )
    );
  } catch {
    return false;
  }
}

function supabaseFetch(path, options = {}) {
  if (!_supabaseUrl || !_supabaseKey) {
    console.warn(
      "[SW] Supabase credentials are unavailable in worker scope; skipping DB fetch.",
    );
    return null;
  }

  return fetch(`${_supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: _supabaseKey,
      Authorization: `Bearer ${_supabaseKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

// PostgREST embeds filter values directly in the query string (e.g.
// `id=eq.<value>`), so any value coming from IDB/postMessage data — quiz
// ids, category keys — must be encoded before interpolation. Without this,
// a crafted id/category containing `&`, `,`, `)`, or `.` could alter the
// filter's meaning or target a different row/table scope than intended.
// encodeURIComponent covers the URL-structural characters; PostgREST's own
// comma/paren list-syntax characters inside an `in.(...)` list are handled
// separately by quoting each value (see buildPostgrestInList below).
function encodePostgrestValue(value) {
  return encodeURIComponent(String(value));
}

function buildPostgrestInList(values) {
  return values
    .map((value) => `"${String(value).replace(/"/g, '\\"')}"`)
    .map(encodePostgrestValue)
    .join(",");
}

// Install Event - Cache static assets
self.addEventListener("install", (event) => {
  console.log("[SW] Installing service worker...");

  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => {
        console.log("[SW] Caching static assets");
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log("[SW] Static assets cached");
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error("[SW] Failed to cache static assets:", error);
      }),
  );
});

// Activate Event - Clean up old caches
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating service worker...");

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              return (
                cacheName.startsWith("basmagi-") &&
                cacheName !== STATIC_CACHE &&
                cacheName !== DYNAMIC_CACHE &&
                cacheName !== IMAGE_CACHE &&
                cacheName !== QUIZ_CACHE &&
                cacheName !== STATIC_QUIZ_CACHE
              );
            })
            .map((cacheName) => {
              console.log("[SW] Deleting old cache:", cacheName);
              return caches.delete(cacheName);
            }),
        );
      })
      .then(() => {
        console.log("[SW] Service worker activated");
        return self.clients.claim();
      }),
  );
});

// Fetch Event - Network-first with cache fallback strategy
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Skip Chrome extensions
  if (request.url.startsWith("chrome-extension://")) {
    return;
  }

  // Handle different types of requests with appropriate strategies
  if (isQuizAPIRequest(request)) {
    event.respondWith(staleWhileRevalidateStrategy(event, request, QUIZ_CACHE));
  } else if (isStaticQuizRequest(request)) {
    event.respondWith(
      networkFirstWithFallbackStrategy(request, STATIC_QUIZ_CACHE),
    );
  } else if (isMediaRequest(request)) {
    // Network-only for audio/video media to prevent stale cache issues on page reload
    // Media files should always be fetched fresh to ensure latest version is played
    event.respondWith(
      fetch(request).catch(() => {
        return new Response("Media unavailable offline", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }),
    );
  } else if (isDynamicOGImageRequest(request)) {
    // Network-only, no clone/cache.put(). /api/og returns a streamed
    // ImageResponse (Satori) body with no file extension, so it never
    // matched isImageRequest() and was falling into networkFirstStrategy's
    // catch-all — which clones the response and calls cache.put() on it.
    // That clone/put on a streamed body can throw, aborting the response
    // the browser receives and resulting in a blank page instead of the
    // thumbnail. Pass it straight through untouched.
    event.respondWith(fetch(request));
  } else if (isImageRequest(request)) {
    // Cache-first strategy for images
    event.respondWith(cacheFirstStrategy(request, IMAGE_CACHE));
  } else if (isExternalRequest(request)) {
    // Network-only for external resources (CDNs, fonts, etc.)
    event.respondWith(
      fetch(request).catch(() => {
        // Return offline page or fallback
        return new Response("Offline - External resource unavailable", {
          status: 503,
          statusText: "Service Unavailable",
          headers: new Headers({
            "Content-Type": "text/plain",
          }),
        });
      }),
    );
  } else {
    // Network-first with cache fallback for HTML/src/scripts/JS
    event.respondWith(networkFirstStrategy(request, DYNAMIC_CACHE));
  }
});

// Network-first strategy
async function networkFirstStrategy(request, cacheName) {
  const requestAccept = request.headers.get("accept") || "";
  const isHtmlDocumentRequest =
    request.destination === "document" || requestAccept.includes("text/html");

  try {
    // Try network first
    const networkResponse = await fetch(request);

    // Clone response before caching
    const responseToCache = networkResponse.clone();

    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      const urlPath = new URL(request.url).pathname;
      if (!STATIC_ASSETS_SET.has(urlPath)) {
        await cache.put(request, responseToCache);
      }

      // Limit cache size
      trimCacheAsync(cacheName, CACHE_SIZE_LIMIT[cacheName]);
    }

    return networkResponse;
  } catch (error) {
    // Network failed, try cache
    console.log("[SW] Network failed, trying cache:", request.url);

    const cachedResponse = isHtmlDocumentRequest
      ? await caches.match(request, { ignoreSearch: true })
      : await caches.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    // Return error for other requests
    return new Response("Offline", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

// Cache-first strategy
async function cacheFirstStrategy(request, cacheName) {
  // Try cache first
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  // Cache miss, fetch from network
  try {
    const networkResponse = await fetch(request);

    // Cache the response. Awaited (not fire-and-forget) so the write is
    // guaranteed to finish before this function's promise resolves — since
    // this is what event.respondWith() is awaiting, letting the SW live
    // long enough for the put() to land instead of racing termination.
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, networkResponse.clone());

      // Limit cache size
      trimCacheAsync(cacheName, CACHE_SIZE_LIMIT[cacheName]);
    }

    return networkResponse;
  } catch (error) {
    console.error("[SW] Failed to fetch resource:", request.url, error);

    // Return placeholder image for failed image requests
    if (isImageRequest(request)) {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="#f0f0f0" width="200" height="200"/><text x="50%" y="50%" text-anchor="middle" fill="#999" font-family="sans-serif" font-size="14">Image Offline</text></svg>',
        { headers: { "Content-Type": "image/svg+xml" } },
      );
    }

    return new Response("Resource unavailable offline", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

// Stale-while-revalidate strategy for quiz API calls.
// BUG FIX: when a cachedResponse exists, this function returns immediately
// and the caller's event.respondWith() is satisfied — but the background
// `networkFetch` revalidation was still running as a detached promise with
// nothing keeping the service worker alive for it. The SW is free to be
// terminated the instant the response is sent, silently dropping the cache
// update before cache.put() ever runs. Passing `event` through lets us call
// event.waitUntil() on the revalidation so it's guaranteed to complete.
async function staleWhileRevalidateStrategy(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const networkFetch = fetch(request)
    .then(async (networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        await cache.put(request, networkResponse.clone());
        trimCacheAsync(cacheName, CACHE_SIZE_LIMIT[cacheName]);
      }
      return networkResponse;
    })
    .catch(() => {
      console.warn("[SW] SWR network fetch failed:", request.url);
      return new Response("Offline", {
        status: 503,
        statusText: "Service Unavailable",
      });
    });

  if (cachedResponse) {
    // Keep the SW alive for the background revalidation even though we're
    // about to respond from cache immediately.
    event.waitUntil(networkFetch);
    return cachedResponse;
  }

  return networkFetch;
}

async function networkFirstWithFallbackStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      trimCacheAsync(cacheName, CACHE_SIZE_LIMIT[cacheName]);

      const data = await networkResponse.clone().json();
      const pathname = new URL(request.url).pathname;
      await storeStaticQuizInIDB(pathname, data);
    }
    return networkResponse;
  } catch (err) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    const pathname = new URL(request.url).pathname;
    return await idbFallbackResponse(pathname);
  }
}

// ── Shared IndexedDB schema ─────────────────────────────────────────────────
// BUG FIX: this file previously defined FIVE separate copies of the
// "open BasmagiQuizDB" logic (openQuizIDBForStatic, and local
// openQuizIDBLocal functions inside cacheQuizEntries, cacheSubscribedQuizzes,
// updateSubscriptionCache, updateCachedQuizzes). Each copy declared its own
// onupgradeneeded handler that only created the store(s) *that particular
// function* needed:
//   - openQuizIDBForStatic            → only "staticQuizzes"
//   - cacheQuizEntries's opener        → no onupgradeneeded at all
//   - cacheSubscribedQuizzes's opener  → only "meta"
//   - updateSubscriptionCache's opener → no onupgradeneeded at all
//   - updateCachedQuizzes's opener     → no onupgradeneeded at all
// IndexedDB only fires onupgradeneeded once per version bump (whichever
// open() call happens to run first after install/update), so which stores
// actually got created depended on call order — e.g. if
// cacheSubscribedQuizzes's partial handler won the race, "quizzes" and its
// "by-category" index were never created, and any later
// db.transaction("quizzes", ...) elsewhere would throw NotFoundError.
// Consolidating into one definition removes that race entirely.
const QUIZ_DB_NAME = "BasmagiQuizDB";
const QUIZ_DB_VERSION = 2;
const QUIZZES_STORE = "quizzes";
const STATIC_QUIZZES_STORE = "staticQuizzes";
const META_STORE = "meta";
const SUBSCRIBED_CATEGORIES_KEY = "subscribedCategories";

function openQuizIDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUIZ_DB_NAME, QUIZ_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction;

      let quizzesStore;
      if (!db.objectStoreNames.contains(QUIZZES_STORE)) {
        quizzesStore = db.createObjectStore(QUIZZES_STORE, { keyPath: "id" });
      } else {
        quizzesStore = tx.objectStore(QUIZZES_STORE);
      }
      if (!quizzesStore.indexNames.contains("by-category")) {
        quizzesStore.createIndex("by-category", "categoryKey", {
          unique: false,
        });
      }

      if (!db.objectStoreNames.contains(STATIC_QUIZZES_STORE)) {
        db.createObjectStore(STATIC_QUIZZES_STORE, { keyPath: "path" });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IDB open failed"));
  });
}

async function storeStaticQuizInIDB(pathname, data) {
  let db;
  try {
    db = await openQuizIDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STATIC_QUIZZES_STORE, "readwrite");
      tx.objectStore(STATIC_QUIZZES_STORE).put({
        path: pathname,
        data,
        cachedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error("Store static quiz failed"));
      tx.onabort = () =>
        reject(tx.error || new Error("Store static quiz aborted"));
    });
  } finally {
    if (db) db.close();
  }
}

async function getStaticQuizFromIDB(pathname) {
  let db;
  try {
    db = await openQuizIDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STATIC_QUIZZES_STORE, "readonly");
      const request = tx.objectStore(STATIC_QUIZZES_STORE).get(pathname);
      request.onsuccess = () => resolve(request.result?.data || null);
      request.onerror = () =>
        reject(request.error || new Error("Read static quiz failed"));
    });
  } finally {
    if (db) db.close();
  }
}

async function idbFallbackResponse(pathname) {
  try {
    const data = await getStaticQuizFromIDB(pathname);
    if (data) {
      console.log("[SW] IDB fallback used for:", pathname);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.warn("[SW] IDB fallback failed:", err);
  }
  return new Response("Quiz not available offline", { status: 503 });
}

function normalizeQuizPath(pathValue) {
  if (!pathValue || typeof pathValue !== "string") return null;
  try {
    return new URL(pathValue, self.location.origin).pathname;
  } catch {
    return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  }
}

function extractDbQuizIdFromApiPath(pathValue) {
  if (!pathValue || typeof pathValue !== "string") return null;
  try {
    const parsed = new URL(pathValue, self.location.origin);
    if (!parsed.pathname.startsWith("/api/quiz-data")) return null;
    const rawPath = parsed.searchParams.get("path") || "";
    if (!rawPath) return null;
    const filename = rawPath.split("/").pop() || "";
    const withoutExt = filename.replace(/\.json$/i, "");
    return withoutExt || null;
  } catch {
    return null;
  }
}

function cacheResponseByPath(cache, pathValue, response) {
  const request = new Request(
    new URL(pathValue, self.location.origin).toString(),
  );
  return cache.put(request, response);
}

async function cacheQuizEntries(quizList, client) {
  const safeQuizList = Array.isArray(quizList) ? quizList : [];
  const staticQuizCache = await caches.open(STATIC_QUIZ_CACHE);

  let db;
  let cached = 0;
  try {
    db = await openQuizIDB();

    for (const entry of safeQuizList) {
      try {
        if (entry?.type === "db") {
          const quizId = entry.id || extractDbQuizIdFromApiPath(entry.path);
          if (quizId) {
            const response = await supabaseFetch(
              `quizzes?id=eq.${encodePostgrestValue(quizId)}&select=id,category,data`,
            );
            if (response && response.ok) {
              const rows = await response.json();
              const row = Array.isArray(rows) ? rows[0] : null;
              if (row) {
                await new Promise((resolve, reject) => {
                  const tx = db.transaction(QUIZZES_STORE, "readwrite");
                  tx.objectStore(QUIZZES_STORE).put({
                    id: row.id,
                    categoryKey: row.category,
                    data: row.data,
                    cachedAt: Date.now(),
                  });
                  tx.oncomplete = () => resolve();
                  tx.onerror = () =>
                    reject(tx.error || new Error("Store quiz failed"));
                  tx.onabort = () =>
                    reject(tx.error || new Error("Store quiz aborted"));
                });
              }
            }
          }
        } else if (entry?.type === "static" && entry.path) {
          const normalizedPath = normalizeQuizPath(entry.path);
          if (normalizedPath) {
            const response = await fetch(normalizedPath);
            if (response.ok) {
              await cacheResponseByPath(
                staticQuizCache,
                normalizedPath,
                response.clone(),
              );
              const data = await response.clone().json();
              await new Promise((resolve, reject) => {
                const tx = db.transaction(STATIC_QUIZZES_STORE, "readwrite");
                tx.objectStore(STATIC_QUIZZES_STORE).put({
                  path: normalizedPath,
                  data,
                  cachedAt: Date.now(),
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () =>
                  reject(tx.error || new Error("Store static quiz failed"));
                tx.onabort = () =>
                  reject(tx.error || new Error("Store static quiz aborted"));
              });
            }
          }
        }
      } catch (entryError) {
        console.warn("[SW] Failed to cache quiz entry:", entry, entryError);
      } finally {
        cached++;
        if (client) {
          client.postMessage({
            type: "CACHE_PROGRESS",
            cached,
            total: safeQuizList.length,
          });
        }
      }
    }

    trimCacheAsync(QUIZ_CACHE, CACHE_SIZE_LIMIT[QUIZ_CACHE]);
    trimCacheAsync(STATIC_QUIZ_CACHE, CACHE_SIZE_LIMIT[STATIC_QUIZ_CACHE]);

    if (client) {
      client.postMessage({
        type: "CACHE_COMPLETE",
        count: cached,
      });
    }
  } finally {
    if (db) db.close();
  }
}

// Background Sync for offline actions
self.addEventListener("sync", (event) => {
  console.log("[SW] Background sync:", event.tag);

  if (event.tag === "update-subscribed-quizzes") {
    event.waitUntil(updateCachedQuizzes());
  }

  // Backwards compatibility with existing tag
  if (event.tag === "sync-quiz-results") {
    event.waitUntil(syncQuizResults());
  }
});

async function syncQuizResults() {
  try {
    // Get pending quiz results from IndexedDB
    // This is a placeholder - implement actual sync logic
    console.log("[SW] Syncing quiz results...");

    // Send results to server
    // await fetch('/api/sync-results', {...});

    console.log("[SW] Quiz results synced");
  } catch (error) {
    console.error("[SW] Failed to sync quiz results:", error);
    throw error;
  }
}

// Push Notifications
self.addEventListener("push", (event) => {
  console.log("[SW] Push notification received");

  // BUG FIX: event.data.text() can throw for a malformed/binary push
  // payload. That throw happened synchronously in the listener body,
  // before event.waitUntil() was ever reached — so showNotification()
  // never fired and the browser can flag the SW for showing no
  // notification for a push event. Wrapped so a bad payload still falls
  // back to a generic body instead of aborting the handler.
  let body = "لديك إشعار جديد";
  try {
    if (event.data) body = event.data.text();
  } catch (error) {
    console.warn("[SW] Failed to read push payload, using default:", error);
  }

  const options = {
    body,
    icon: "/assets/images/icon-192.png",
    badge: "/assets/images/badge-72.png",
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1,
    },
    actions: [
      {
        action: "explore",
        title: "عرض",
        icon: "/assets/images/checkmark.png",
      },
      {
        action: "close",
        title: "إغلاق",
        icon: "/assets/images/close.png",
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification("منصة إمتحانات بصمجي", options),
  );
});

// Notification Click
self.addEventListener("notificationclick", (event) => {
  console.log("[SW] Notification clicked:", event.action);

  event.notification.close();

  if (event.action === "explore") {
    event.waitUntil(clients.openWindow("/"));
  }
});

// Message handler for communication with the main thread
self.addEventListener("message", (event) => {
  console.log("[SW] Message received:", event.data);

  const { data } = event;
  if (!data) return;

  if (data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }

  if (data.type === "CLEAR_CACHE") {
    event.waitUntil(
      caches
        .keys()
        .then((cacheNames) =>
          Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName))),
        ),
    );
  }

  if (data.type === "CACHE_SUBSCRIBED_QUIZZES") {
    _supabaseUrl = data.supabaseUrl || _supabaseUrl;
    _supabaseKey = data.supabaseKey || _supabaseKey;
    event.waitUntil(
      cacheSubscribedQuizzes(
        data.categories || [],
        data.quizList || [],
        event.source,
      ),
    );
  }

  if (data.type === "TRIGGER_SYNC") {
    _supabaseUrl = data.supabaseUrl || _supabaseUrl;
    _supabaseKey = data.supabaseKey || _supabaseKey;
    event.waitUntil(
      self.registration.sync
        .register("update-subscribed-quizzes")
        .catch((error) => {
          // Background Sync isn't supported in every browser and
          // registration can also be denied by the user/permission policy;
          // don't let that surface as an unhandled rejection.
          console.warn("[SW] Failed to register background sync:", error);
        }),
    );
  }

  if (data.type === "UPDATE_SUBSCRIBED_QUIZZES") {
    _supabaseUrl = data.supabaseUrl || _supabaseUrl;
    _supabaseKey = data.supabaseKey || _supabaseKey;
    event.waitUntil(updateSubscriptionCache(data));
  }
});

// Periodic Background Sync (if supported)
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "update-quiz-content") {
    event.waitUntil(updateCachedQuizzes());
  }
});

async function cacheSubscribedQuizzes(categoryKeys, quizList, client) {
  function storeSubscribedCategoriesLocal(db, keys) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put({
        key: SUBSCRIBED_CATEGORIES_KEY,
        value: Array.isArray(keys) ? keys : [],
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Store meta failed"));
      tx.onabort = () => reject(tx.error || new Error("Store meta aborted"));
    });
  }

  const safeCategoryKeys = Array.isArray(categoryKeys) ? categoryKeys : [];
  const safeQuizList = Array.isArray(quizList) ? quizList : [];
  if (safeCategoryKeys.length === 0 && safeQuizList.length === 0) {
    if (client) client.postMessage({ type: "CACHE_COMPLETE", count: 0 });
    return;
  }

  let db;
  try {
    db = await openQuizIDB();
    await storeSubscribedCategoriesLocal(db, safeCategoryKeys);
    if (safeQuizList.length > 0) {
      await cacheQuizEntries(safeQuizList, client);
      return;
    }

    // Backward compatibility path: older clients only send categories.
    const categoryFilter = buildPostgrestInList(safeCategoryKeys);
    const response = await supabaseFetch(
      `quizzes?select=id,category&category=in.(${categoryFilter})`,
    );
    if (!response || !response.ok) {
      if (client) client.postMessage({ type: "CACHE_COMPLETE", count: 0 });
      return;
    }
    const rows = await response.json();
    const fallbackQuizList = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: row.id,
      category: row.category,
      path: null,
      type: "db",
    }));
    await cacheQuizEntries(fallbackQuizList, client);
  } catch (error) {
    console.error("[SW] Failed to cache subscribed quizzes:", error);
    throw error;
  } finally {
    if (db) db.close();
  }
}

async function updateSubscriptionCache(data) {
  const allCategories = Array.isArray(data?.allCategories)
    ? data.allCategories
    : [];
  const added = Array.isArray(data?.added) ? data.added : [];
  const removed = Array.isArray(data?.removed) ? data.removed : [];
  const allQuizList = Array.isArray(data?.quizList) ? data.quizList : [];

  const storeSubscribedCategoriesLocal = (db, keys) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put({
        key: SUBSCRIBED_CATEGORIES_KEY,
        value: Array.isArray(keys) ? keys : [],
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Store meta failed"));
      tx.onabort = () => reject(tx.error || new Error("Store meta aborted"));
    });

  const deleteQuizzesByCategoryLocal = (db, categoryKey) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(QUIZZES_STORE, "readwrite");
      const index = tx.objectStore(QUIZZES_STORE).index("by-category");
      const request = index.openCursor(IDBKeyRange.only(categoryKey));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () =>
        reject(request.error || new Error("Delete failed"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Delete failed"));
      tx.onabort = () => reject(tx.error || new Error("Delete aborted"));
    });

  const deleteStaticQuizzesByPathLocal = (db, pathSubstring) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STATIC_QUIZZES_STORE, "readwrite");
      const store = tx.objectStore(STATIC_QUIZZES_STORE);
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        if (
          typeof cursor.key === "string" &&
          cursor.key.includes(pathSubstring)
        ) {
          cursor.delete();
        }
        cursor.continue();
      };
      request.onerror = () =>
        reject(request.error || new Error("Delete failed"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Delete failed"));
      tx.onabort = () => reject(tx.error || new Error("Delete aborted"));
    });

  const deleteMatchingCacheEntries = async (cacheName, categoryKeys) => {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    await Promise.all(
      keys.map(async (request) => {
        const requestUrl = new URL(request.url);
        const haystack = `${requestUrl.pathname}${requestUrl.search}`;
        const shouldDelete = categoryKeys.some((category) => {
          const plain = `/${category}/`;
          const encoded = `/${encodeURIComponent(category)}/`;
          return haystack.includes(plain) || haystack.includes(encoded);
        });
        if (shouldDelete) {
          await cache.delete(request);
        }
      }),
    );
  };

  let db;
  try {
    db = await openQuizIDB();

    for (const category of removed) {
      await deleteQuizzesByCategoryLocal(db, category);
      await deleteStaticQuizzesByPathLocal(
        db,
        `/${encodeURIComponent(category)}/`,
      );
    }

    if (removed.length > 0) {
      await deleteMatchingCacheEntries(QUIZ_CACHE, removed);
      await deleteMatchingCacheEntries(STATIC_QUIZ_CACHE, removed);
    }

    const addedQuizList = allQuizList.filter((entry) =>
      added.includes(entry?.category),
    );
    await cacheQuizEntries(addedQuizList);
    await storeSubscribedCategoriesLocal(db, allCategories);
  } catch (error) {
    console.error("[SW] Failed to update subscription cache:", error);
    throw error;
  } finally {
    if (db) db.close();
  }

  const allClients = await self.clients.matchAll();
  allClients.forEach((client) =>
    client.postMessage({ type: "SYNC_COMPLETE", updated: added.length }),
  );
}

async function updateCachedQuizzes() {
  function getSubscribedCategoriesLocal(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const request = tx.objectStore(META_STORE).get(SUBSCRIBED_CATEGORIES_KEY);
      request.onsuccess = () => resolve(request.result?.value || []);
      request.onerror = () =>
        reject(request.error || new Error("Read subscribed categories failed"));
    });
  }

  function getQuizzesByCategoryLocal(db, categoryKey) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUIZZES_STORE, "readonly");
      const index = tx.objectStore(QUIZZES_STORE).index("by-category");
      const request = index.getAll(categoryKey);
      request.onsuccess = () =>
        resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () =>
        reject(request.error || new Error("Read quizzes by category failed"));
    });
  }

  function storeQuizInIDBLocal(db, quizEntry) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUIZZES_STORE, "readwrite");
      tx.objectStore(QUIZZES_STORE).put(quizEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Store quiz failed"));
      tx.onabort = () => reject(tx.error || new Error("Store quiz aborted"));
    });
  }

  let db;
  let updated = 0;

  try {
    db = await openQuizIDB();
    const subscribedCategories = await getSubscribedCategoriesLocal(db);
    const categoryKeys = Array.isArray(subscribedCategories)
      ? subscribedCategories
      : [];

    for (const categoryKey of categoryKeys) {
      const entries = await getQuizzesByCategoryLocal(db, categoryKey);
      for (const entry of entries) {
        try {
          const response = await supabaseFetch(
            `quizzes?id=eq.${encodePostgrestValue(entry.id)}&select=id,category,data`,
          );
          if (!response || !response.ok) continue;

          const rows = await response.json();
          const fresh = Array.isArray(rows) ? rows[0] : null;
          if (!fresh) continue;

          if (JSON.stringify(fresh.data) !== JSON.stringify(entry.data)) {
            await storeQuizInIDBLocal(db, {
              id: fresh.id,
              categoryKey: fresh.category,
              data: fresh.data,
              cachedAt: Date.now(),
            });
            updated++;
          }
        } catch (_) {
          // Ignore per-quiz network/update failures to keep sync resilient.
        }
      }
    }
  } catch (error) {
    console.error("[SW] Failed to update cached quizzes:", error);
    throw error;
  } finally {
    if (db) db.close();
  }

  const allClients = await self.clients.matchAll();
  allClients.forEach((client) =>
    client.postMessage({ type: "SYNC_COMPLETE", updated }),
  );
}

console.log("[SW] Service worker script loaded");
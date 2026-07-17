// Service Worker for Basmagi Quiz Platform
// Provides offline support, caching, and performance improvements

const CACHE_VERSION = "basmagi-v6.1.1";
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
  "/dashboard.html",
  "/onboarding.html",
  "/quiz.html",
  "/result.html",
  "/settings.html",

  // CSS
  "/src/styles/themes.css",

  "/src/styles/index.css",
  "/src/styles/create-quiz.css",
  "/src/styles/dashboard.css",
  "/src/styles/onboarding.css",
  "/src/styles/quiz.css",
  "/src/styles/result.css",
  "/src/styles/settings.css",

  "/src/styles/animations.css",
  "/src/styles/markdown.css",
  "/src/styles/search.css",

  // JS (entry points)
  "/src/scripts/index.js",
  "/src/scripts/create-quiz.js",
  "/src/scripts/dashboard.js",
  "/src/scripts/onboarding.js",
  "/src/scripts/quiz.js",
  "/src/scripts/result.js",
  "/src/scripts/settings.js",

  "/src/scripts/search-manager.js",
  "/src/scripts/userProfile.js",
  "/src/scripts/quizManifest.js",
  "/src/scripts/quizId.js",
  "/src/scripts/pwa-manager.js",
  "/src/scripts/keyboard-nav.js",

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
  "/src/components/side-menu.css",
  "/src/components/side-menu.js",
  "/src/components/notifications.css",
  "/src/components/notifications.js",
  "/src/components/offline-banner.css",
  "/src/components/offline-banner.js",

  // KaTeX (Markdown/LaTeX rendering, must work offline)
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_AMS-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Caligraphic-Bold.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Caligraphic-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Fraktur-Bold.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Fraktur-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-Bold.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-BoldItalic.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-Italic.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Math-BoldItalic.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Math-Italic.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_SansSerif-Bold.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_SansSerif-Italic.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_SansSerif-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Script-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size1-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size2-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size3-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size4-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Typewriter-Regular.woff2",

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

// Helper: Limit cache size
async function limitCacheSize(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    limitCacheSize(cacheName, maxItems);
  }
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
    const match =
      url.origin === self.location.origin &&
      QUIZ_API_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
    if (match) console.log("[SW] Quiz API intercepted:", request.url);
    return match;
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

  if (request.url.includes("supabase")) {
    console.log(
      "[SW] Supabase request seen:",
      request.url,
      "| matched quiz:",
      isQuizAPIRequest(request),
    );
  }

  // Handle different types of requests with appropriate strategies
  if (isQuizAPIRequest(request)) {
    event.respondWith(staleWhileRevalidateStrategy(request, QUIZ_CACHE));
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
      limitCacheSize(cacheName, CACHE_SIZE_LIMIT[cacheName]);
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

    // Return offline page for HTML requests
    if (isHtmlDocumentRequest) {
      return (
        caches.match("/offline.html") ||
        new Response(getOfflineHTML(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      );
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

    // Cache the response
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());

      // Limit cache size
      limitCacheSize(cacheName, CACHE_SIZE_LIMIT[cacheName]);
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

// Stale-while-revalidate strategy for quiz API calls
async function staleWhileRevalidateStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const networkFetch = fetch(request)
    .then(async (networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        await cache.put(request, networkResponse.clone());
        limitCacheSize(cacheName, CACHE_SIZE_LIMIT[cacheName]);
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

  return cachedResponse || networkFetch;
}

async function networkFirstWithFallbackStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      limitCacheSize(cacheName, CACHE_SIZE_LIMIT[cacheName]);

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

function openQuizIDBForStatic() {
  const QUIZ_DB_NAME = "BasmagiQuizDB";
  const QUIZ_DB_VERSION = 2;
  const STATIC_QUIZZES_STORE = "staticQuizzes";

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUIZ_DB_NAME, QUIZ_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STATIC_QUIZZES_STORE)) {
        db.createObjectStore(STATIC_QUIZZES_STORE, { keyPath: "path" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IDB open failed"));
  });
}

async function storeStaticQuizInIDB(pathname, data) {
  const STATIC_QUIZZES_STORE = "staticQuizzes";
  let db;
  try {
    db = await openQuizIDBForStatic();
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
  const STATIC_QUIZZES_STORE = "staticQuizzes";
  let db;
  try {
    db = await openQuizIDBForStatic();
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
  const QUIZ_DB_NAME = "BasmagiQuizDB";
  const QUIZ_DB_VERSION = 2;
  const QUIZZES_STORE = "quizzes";
  const STATIC_QUIZZES_STORE = "staticQuizzes";
  const safeQuizList = Array.isArray(quizList) ? quizList : [];
  const staticQuizCache = await caches.open(STATIC_QUIZ_CACHE);

  const openQuizIDBLocal = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(QUIZ_DB_NAME, QUIZ_DB_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("IDB open failed"));
    });

  let db;
  let cached = 0;
  try {
    db = await openQuizIDBLocal();

    for (const entry of safeQuizList) {
      try {
        if (entry?.type === "db") {
          const quizId = entry.id || extractDbQuizIdFromApiPath(entry.path);
          if (quizId) {
            const response = await supabaseFetch(
              `quizzes?id=eq.${quizId}&select=id,category,data`,
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

    limitCacheSize(QUIZ_CACHE, CACHE_SIZE_LIMIT[QUIZ_CACHE]);
    limitCacheSize(STATIC_QUIZ_CACHE, CACHE_SIZE_LIMIT[STATIC_QUIZ_CACHE]);

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

// Offline HTML fallback
function getOfflineHTML() {
  return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>غير متصل - منصة إمتحانات بصمجي</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: "Tajawal", -apple-system, sans-serif;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          text-align: center;
          padding: 2rem;
        }
        .container {
          max-width: 500px;
        }
        .icon {
          font-size: 5rem;
          margin-bottom: 1.5rem;
        }
        h1 {
          font-size: 2rem;
          margin-bottom: 1rem;
        }
        p {
          font-size: 1.125rem;
          margin-bottom: 2rem;
          opacity: 0.9;
        }
        button {
          background: white;
          color: #667eea;
          border: none;
          padding: 1rem 2rem;
          font-size: 1rem;
          font-weight: 600;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: transform 0.2s;
        }
        button:hover {
          transform: translateY(-2px);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">📡</div>
        <h1>أنت غير متصل بالإنترنت</h1>
        <p>يبدو أن اتصالك بالإنترنت مفقود. يرجى التحقق من الاتصال والمحاولة مرة أخرى.</p>
        <button onclick="location.reload()">إعادة المحاولة</button>
      </div>
    </body>
    </html>
  `;
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

  const options = {
    body: event.data ? event.data.text() : "لديك إشعار جديد",
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
      self.registration.sync.register("update-subscribed-quizzes"),
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
  const QUIZ_DB_NAME = "BasmagiQuizDB";
  const QUIZ_DB_VERSION = 2;
  const META_STORE = "meta";
  const SUBSCRIBED_CATEGORIES_KEY = "subscribedCategories";

  function openQuizIDBLocal() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(QUIZ_DB_NAME, QUIZ_DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("IDB open failed"));
    });
  }

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
    db = await openQuizIDBLocal();
    await storeSubscribedCategoriesLocal(db, safeCategoryKeys);
    if (safeQuizList.length > 0) {
      await cacheQuizEntries(safeQuizList, client);
      return;
    }

    // Backward compatibility path: older clients only send categories.
    const categoryFilter = safeCategoryKeys
      .map((key) => `"${String(key).replace(/"/g, '\\"')}"`)
      .join(",");
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
  const QUIZ_DB_NAME = "BasmagiQuizDB";
  const QUIZ_DB_VERSION = 2;
  const QUIZZES_STORE = "quizzes";
  const META_STORE = "meta";
  const STATIC_QUIZZES_STORE = "staticQuizzes";
  const SUBSCRIBED_CATEGORIES_KEY = "subscribedCategories";
  const allCategories = Array.isArray(data?.allCategories)
    ? data.allCategories
    : [];
  const added = Array.isArray(data?.added) ? data.added : [];
  const removed = Array.isArray(data?.removed) ? data.removed : [];
  const allQuizList = Array.isArray(data?.quizList) ? data.quizList : [];

  const openQuizIDBLocal = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(QUIZ_DB_NAME, QUIZ_DB_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("IDB open failed"));
    });

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
    db = await openQuizIDBLocal();

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
  const QUIZ_DB_NAME = "BasmagiQuizDB";
  const QUIZ_DB_VERSION = 2;
  const QUIZZES_STORE = "quizzes";
  const META_STORE = "meta";
  const SUBSCRIBED_CATEGORIES_KEY = "subscribedCategories";

  function openQuizIDBLocal() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(QUIZ_DB_NAME, QUIZ_DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(QUIZZES_STORE)) {
          const quizzesStore = db.createObjectStore(QUIZZES_STORE, {
            keyPath: "id",
          });
          quizzesStore.createIndex("by-category", "categoryKey", {
            unique: false,
          });
        } else {
          const quizzesStore =
            event.target.transaction.objectStore(QUIZZES_STORE);
          if (!quizzesStore.indexNames.contains("by-category")) {
            quizzesStore.createIndex("by-category", "categoryKey", {
              unique: false,
            });
          }
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
    db = await openQuizIDBLocal();
    const subscribedCategories = await getSubscribedCategoriesLocal(db);
    const categoryKeys = Array.isArray(subscribedCategories)
      ? subscribedCategories
      : [];

    for (const categoryKey of categoryKeys) {
      const entries = await getQuizzesByCategoryLocal(db, categoryKey);
      for (const entry of entries) {
        try {
          const response = await supabaseFetch(
            `quizzes?id=eq.${entry.id}&select=id,category,data`,
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
// Service Worker for Basmagi Quiz Platform
// Provides offline support, caching, and performance improvements

const CACHE_VERSION = "basmagi-v4.0.1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const QUIZ_CACHE = `${CACHE_VERSION}-quizzes`;

// Inject these at build/deploy time from Vercel environment variables.
// They must map to the public Supabase values used by the client.
const SUPABASE_URL = self.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = self.SUPABASE_SERVICE_KEY || "";

// Files to cache immediately.
// Everything except for signing in dependencies, since signing in requires
// internet, so caching its dependencies would be useless.
const STATIC_ASSETS = [
  // Pages
  "/",
  "/index.html",
  "/create-quiz.html",
  "/onboarding.html",
  "/quiz.html",
  "/result.html",
  "/dashboard.html",

  // CSS
  "/src/styles/index.css",
  "/src/styles/create-quiz.css",
  "/src/styles/themes.css",

  // JS (entry points)
  "/src/scripts/index.js",
  "/src/scripts/create-quiz.js",
  "/src/shared/theme-controller.js",
  "/src/shared/canvas-animation.js",

  // Components
  "/src/components/side-menu.css",
  "/src/components/side-menu.js",
  "/src/components/notifications.css",
  "/src/components/notifications.js",
  "/src/components/offline-banner.css",
  "/src/components/offline-banner.js",

  // PWA shell files
  "/favicon.png",
  "/favicon.ico",
  "/favicon.svg",
  "/manifest.json",
];

// Maximum number of items in dynamic cache
const CACHE_SIZE_LIMIT = {
  [DYNAMIC_CACHE]: 50,
  [IMAGE_CACHE]: 100,
  [QUIZ_CACHE]: 500,
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

// Helper: Check if request is for external resource
function isExternalRequest(request) {
  return !request.url.startsWith(self.location.origin);
}

function isQuizAPIRequest(request) {
  if (!SUPABASE_URL) return false;
  return request.url.startsWith(`${SUPABASE_URL}/rest/v1/`);
}

function supabaseFetch(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "[SW] Missing SUPABASE_URL/SUPABASE_SERVICE_KEY. Inject Vercel env values before serving service-worker.js.",
    );
  }

  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

function fetchQuizAPIRequest(request) {
  const url = new URL(request.url);
  const path = `${url.pathname.replace("/rest/v1/", "")}${url.search}`;
  return supabaseFetch(path, {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
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
                cacheName !== QUIZ_CACHE
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
    event.respondWith(staleWhileRevalidateStrategy(request, QUIZ_CACHE));
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
  try {
    // Try network first
    const networkResponse = await fetch(request);

    // Clone response before caching
    const responseToCache = networkResponse.clone();

    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, responseToCache);

      // Limit cache size
      limitCacheSize(cacheName, CACHE_SIZE_LIMIT[cacheName]);
    }

    return networkResponse;
  } catch (error) {
    // Network failed, try cache
    console.log("[SW] Network failed, trying cache:", request.url);

    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline page for HTML requests
    if (request.headers.get("accept").includes("text/html")) {
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

  const networkFetch = fetchQuizAPIRequest(request)
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
    event.waitUntil(
      cacheSubscribedQuizzes(data.categories || [], event.source),
    );
  }

  if (data.type === "TRIGGER_SYNC") {
    event.waitUntil(
      self.registration.sync.register("update-subscribed-quizzes"),
    );
  }
});

// Periodic Background Sync (if supported)
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "update-quiz-content") {
    event.waitUntil(updateCachedQuizzes());
  }
});

async function cacheSubscribedQuizzes(categoryKeys, client) {
  const QUIZ_DB_NAME = "BasmagiQuizDB";
  const QUIZ_DB_VERSION = 1;
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

  function storeQuizInIDBLocal(db, quizEntry) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUIZZES_STORE, "readwrite");
      tx.objectStore(QUIZZES_STORE).put(quizEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Store quiz failed"));
      tx.onabort = () => reject(tx.error || new Error("Store quiz aborted"));
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
  if (safeCategoryKeys.length === 0) {
    if (client) client.postMessage({ type: "CACHE_COMPLETE", count: 0 });
    return;
  }

  let db;
  try {
    const response = await supabaseFetch(
      `quizzes?select=id,category,data&category=in.(${safeCategoryKeys.join(",")})`,
    );
    if (!response.ok) {
      throw new Error(`Supabase fetch failed: ${response.status}`);
    }
    const rows = await response.json();
    const quizRows = Array.isArray(rows) ? rows : [];

    db = await openQuizIDBLocal();
    await storeSubscribedCategoriesLocal(db, safeCategoryKeys);

    let cached = 0;
    for (const row of quizRows) {
      const quizEntry = {
        id: row.id,
        categoryKey: row.category,
        data: row.data,
        cachedAt: Date.now(),
      };

      await storeQuizInIDBLocal(db, quizEntry);
      cached++;

      if (client) {
        client.postMessage({
          type: "CACHE_PROGRESS",
          cached,
          total: quizRows.length,
        });
      }
    }

    if (client) {
      client.postMessage({
        type: "CACHE_COMPLETE",
        count: cached,
      });
    }
  } catch (error) {
    console.error("[SW] Failed to cache subscribed quizzes:", error);
    throw error;
  } finally {
    if (db) db.close();
  }
}

async function updateCachedQuizzes() {
  const QUIZ_DB_NAME = "BasmagiQuizDB";
  const QUIZ_DB_VERSION = 1;
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
          if (!response.ok) continue;

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

// Service Worker for Basmagi Quiz Platform
//
// Design (bandwidth-conscious, see PERFORMANCE_PLAN.md):
//  * install precaches ONLY the offline page, favicon and "/" (no dependency
//    crawl, no cache:"reload"), so a release no longer makes every returning
//    user re-download ~200 files.
//  * static files are served cache-first (/assets, images) or
//    stale-while-revalidate (/src, /dist). Background refreshes go through the
//    HTTP cache, so they obey the Cache-Control headers set in vercel.json.
//  * navigations stay network-first with an offline fallback.
//  * bump CACHE_VERSION only when the SW logic itself changes.

const CACHE_VERSION = "basmagi-v9.0.0";
const OFFLINE_CACHE = `${CACHE_VERSION}-offline`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/favicon.png", "/"];

function isAppAsset(url) {
  return url.origin === self.location.origin &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/supabase/");
}

async function cacheResponse(cache, key, response) {
  try {
    await cache.put(key, response);
  } catch (error) {
    console.warn("[SW] Could not store app resource:", key, error);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      await Promise.all(PRECACHE.map(async (path) => {
        try {
          const response = await fetch(path);
          if (response.ok) await cacheResponse(cache, path, response);
        } catch (error) {
          console.warn("[SW] Could not precache:", path, error);
        }
      }));
      // No skipWaiting() here: pwa-manager.js sends SKIP_WAITING when it is safe.
    })().catch((error) => console.error("[SW] Install failed:", error)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== OFFLINE_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

function isNavigationRequest(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return request.destination === "document" || accept.includes("text/html");
}

async function offlinePageResponse() {
  const cached = await caches.match(OFFLINE_URL);
  if (cached) return cached;
  return new Response(
    "<!DOCTYPE html><html lang='ar' dir='rtl'><head><meta charset='UTF-8'><title>غير متصل</title></head><body><h1>أنت غير متصل بالإنترنت</h1></body></html>",
    { status: 503, statusText: "Service Unavailable", headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function offlineNavigationResponse(request) {
  const url = new URL(request.url);
  if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/my-content")) {
    const appShell = await caches.match("/");
    if (appShell) return appShell;
  }
  return offlinePageResponse();
}

const CACHE_FIRST = /^\/(?:assets\/|dist\/chunks\/|.*\.(?:png|jpe?g|webp|avif|svg|ico|woff2?)$)/i;

async function revalidate(request) {
  const response = await fetch(request); // honours HTTP cache + Cache-Control
  if (response.ok) {
    const cache = await caches.open(OFFLINE_CACHE);
    await cacheResponse(cache, request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  if (request.url.startsWith("chrome-extension://")) return;
  const url = new URL(request.url);

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).then(async (response) => {
        if (response.ok && isAppAsset(url) && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/my-content"))) {
          const cache = await caches.open(OFFLINE_CACHE);
          await cacheResponse(cache, url.pathname, response.clone());
        }
        return response;
      }).catch(() => offlineNavigationResponse(request)),
    );
    return;
  }

  // Never touch API or cross-origin traffic.
  if (!isAppAsset(url)) return;

  // Stable-named bundle entries must always revalidate (they reference hashed chunks).
  if (/^\/dist\/home\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith(revalidate(request).catch(async () => (await caches.match(request)) || new Response("Offline", { status: 503 })));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      // cache-first for immutable-ish files; SWR (refresh in background) for code.
      if (!CACHE_FIRST.test(url.pathname)) event.waitUntil(revalidate(request).catch(() => {}));
      return cached;
    }
    try {
      return await revalidate(request);
    } catch (_) {
      const fallback = await caches.match(request, { ignoreSearch: true });
      return fallback || new Response("Offline", { status: 503, statusText: "Service Unavailable" });
    }
  })());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }

  const options = {
    body: data.body || "لديك إشعار جديد",
    icon: "/favicon.png",
    badge: "/favicon.png",
    data: data.url ? { url: data.url } : {},
    actions: [
      { action: "explore", title: "عرض", icon: "/assets/images/checkmark.png" },
      { action: "close", title: "إغلاق", icon: "/assets/images/close.png" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || "منصة امتحانات بصمجي",
      options,
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "close") return;

  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(targetUrl);
      }),
  );
});

self.addEventListener("message", (event) => {
  const { data } = event;
  if (!data) return;

  if (data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }

  // Legacy clients may still send CLEAR_CACHE — wipe everything except offline page.
  if (data.type === "CLEAR_CACHE") {
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name !== OFFLINE_CACHE)
              .map((name) => caches.delete(name)),
          ),
        ),
    );
  }
});

console.log("[SW] Service worker script loaded (app-shell offline support)");

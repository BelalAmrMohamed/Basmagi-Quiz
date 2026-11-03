// Service Worker for Basmagi Quiz Platform

const CACHE_VERSION = "basmagi-v8.3.5";
const OFFLINE_CACHE = `${CACHE_VERSION}-offline`;
const OFFLINE_URL = "/offline";
const OFFLINE_ASSETS = [OFFLINE_URL, "/favicon.png"];

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

async function cacheAppShell(cache) {
  const visited = new Set();

  async function cacheResource(resourceUrl) {
    const url = new URL(resourceUrl, self.location.origin);
    if (!isAppAsset(url) || visited.has(url.href)) return;
    visited.add(url.href);

    let response;
    try {
      response = await fetch(new Request(url.href, { cache: "reload" }));
    } catch (error) {
      console.warn("[SW] Could not precache app resource:", url.pathname, error);
      return;
    }
    if (!response.ok || response.type === "opaque") return;
    await cacheResponse(cache, url.href, response.clone());

    const contentType = response.headers.get("content-type") || "";
    let source;
    try {
      if (contentType.includes("text/html") || /\.(?:html?)$/i.test(url.pathname)) {
        source = await response.text();
      } else if (contentType.includes("javascript") || /\.m?js$/i.test(url.pathname)) {
        source = await response.text();
      } else if (contentType.includes("text/css") || /\.css$/i.test(url.pathname)) {
        source = await response.text();
      }
    } catch (error) {
      console.warn("[SW] Could not inspect cached app resource:", url.pathname, error);
      return;
    }
    if (!source) return;

    const dependencies = [];
    if (contentType.includes("text/html") || /\.(?:html?)$/i.test(url.pathname)) {
      const tags = source.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)=["']([^"']+)["'][^>]*>/gi);
      for (const [, path] of tags) {
        if (/\.(?:css|m?js)(?:[?#]|$)/i.test(path)) dependencies.push(path);
      }
    } else if (contentType.includes("javascript") || /\.m?js$/i.test(url.pathname)) {
      const imports = source.matchAll(/(?:\bimport\s+(?:[^'"]*?\s+from\s+)?|\bimport\s*\()\s*["']([^"']+)["']/g);
      for (const [, path] of imports) dependencies.push(new URL(path, url).href);
    } else {
      const imports = source.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)|url\(["']?([^"')]+)["']?\)/gi);
      for (const match of imports) {
        const path = match[1] || match[2];
        if (path) dependencies.push(new URL(path, url).href);
      }
    }

    await Promise.all(dependencies.map(cacheResource));
  }

  await Promise.all([
    cacheResource("/"),
    ...OFFLINE_ASSETS.map(cacheResource),
  ]);
}

self.addEventListener("install", (event) => {
  console.log("[SW] Installing app-shell and offline caches...");
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      await cacheAppShell(cache);
      await self.skipWaiting();
    })().catch((error) => {
      console.error("[SW] Install failed:", error);
    }),
  );
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Activating — clearing legacy caches...");
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== OFFLINE_CACHE)
          .map((name) => {
            console.log("[SW] Deleting cache:", name);
            return caches.delete(name);
          }),
      );
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
    {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

async function offlineNavigationResponse(request) {
  const url = new URL(request.url);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const appShell = await caches.match("/");
    if (appShell) return appShell;
  }
  return offlinePageResponse();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  if (request.url.startsWith("chrome-extension://")) return;

  // Keep navigations fresh when online, but use the cached app shell for
  // local-content routes when offline.
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).then(async (response) => {
        const url = new URL(request.url);
        if (response.ok && isAppAsset(url) && (url.pathname === "/" || url.pathname === "/index.html")) {
          const cache = await caches.open(OFFLINE_CACHE);
          await cacheResponse(cache, url.pathname, response.clone());
        }
        return response;
      }).catch(() => offlineNavigationResponse(request)),
    );
    return;
  }

  // Cache same-origin app assets as they are requested; never cache API data.
  event.respondWith(
    fetch(request).then(async (response) => {
      const url = new URL(request.url);
      if (response.ok && isAppAsset(url)) {
        const cache = await caches.open(OFFLINE_CACHE);
        await cacheResponse(cache, request, response.clone());
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      return new Response("Offline", {
        status: 503,
        statusText: "Service Unavailable",
      });
    }),
  );
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

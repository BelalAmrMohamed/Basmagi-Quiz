// Service Worker for Basmagi Quiz Platform

const CACHE_VERSION = "basmagi-v7.1.0";
const OFFLINE_CACHE = `${CACHE_VERSION}-offline`;
const OFFLINE_URL = "/offline.html";
const OFFLINE_ASSETS = [OFFLINE_URL, "/favicon.png"];

self.addEventListener("install", (event) => {
  console.log("[SW] Installing (offline-page only)...");
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      await Promise.all(
        OFFLINE_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })),
        ),
      );
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

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  if (request.url.startsWith("chrome-extension://")) return;

  // Never serve cached app content — network only.
  // Navigations fall back to the offline page when the network fails.
  if (isNavigationRequest(request)) {
    event.respondWith(fetch(request).catch(() => offlinePageResponse()));
    return;
  }

  // Assets: network first; allow the tiny offline asset set (favicon) from cache.
  event.respondWith(
    fetch(request).catch(async () => {
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
      data.title || "منصة إمتحانات بصمجي",
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

console.log("[SW] Service worker script loaded (offline-page only)");

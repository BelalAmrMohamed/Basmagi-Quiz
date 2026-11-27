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
//  * generated bundles with STABLE names (notebook runtimes + worker, tiptap) are never cache-first:
//    they are revalidated on every load (cheap 304), otherwise a rebuilt runtime is not seen for weeks.
//  * bump CACHE_VERSION only when the SW logic itself changes (it also drops older caches).
//
// Offline support (see docs/offline.md):
//  * install also caches the plain page shells /quiz, /lesson, /notebook (small HTML, no id injected).
//  * pages that hold local content (/my-content, ?type=user, /notebook/new) fall back to those shells
//    when the network is down; the page JS then reads the item from localStorage / IndexedDB.
//  * the heavy part (every JS/CSS chunk of home, quiz, lesson and notebook, the MATLAB runtime, the editor,
//    KaTeX, fonts) is cached on a WARM_OFFLINE message that pwa-manager.js sends only to installed users,
//    users who have local content, or users who installed the C++ Instant Compiler. The C++ runtime is
//    cached only for the last group.

const CACHE_VERSION = "basmagi-v10.0.0";
const OFFLINE_CACHE = `${CACHE_VERSION}-offline`;
const CACHE_PREFIX = "basmagi-v"; // only caches with this prefix belong to the service worker and may be pruned
// Owned by the C++ runtime (runtimes/cpp/src/wasm-cache.ts): the ~60 MB Instant Compiler. NEVER delete it.
const CPP_WASM_CACHE = "basmagi-cpp-wasm-v2";
const OFFLINE_URL = "/offline";
const SHELL_PAGES = ["/quiz", "/lesson", "/notebook"];
const PRECACHE = [OFFLINE_URL, "/favicon.png", "/favicon-48.png", "/", ...SHELL_PAGES];
// Cross-origin hosts the pages load scripts / styles / fonts from. Cached so the pages render offline.
const CDN_HOSTS = new Set(["cdn.jsdelivr.net", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"]);
const RUNTIMES = {
  matlab: ["/assets/notebook-runtime/runtime.js", "/assets/notebook-runtime/runtime.css", "/assets/notebook-runtime/worker.js"],
  cpp: ["/assets/notebook-runtime-cpp/runtime.js", "/assets/notebook-runtime-cpp/runtime.css", "/assets/notebook-runtime-cpp/worker.js"],
};
const EDITOR_ASSETS = ["/assets/vendor/tiptap/tiptap.js", "/assets/vendor/tiptap/hljs-extra.js", "/assets/fonts/Tajawal-Bold.ttf"];

// Notification action icons as inline SVG data URLs (a classic service worker cannot import icons.js,
// and data URLs need no cached file). Same lucide check / x glyphs as the app icons.
const svgIcon = (body) =>
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`);
const ACTION_ICON_CHECK = svgIcon('<path d="M20 6 9 17l-5-5"/>');
const ACTION_ICON_CLOSE = svgIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

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
      // Only drop OUR older caches. Other caches (the C++ Instant Compiler's ~60 MB toolchain) are not ours.
      await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== OFFLINE_CACHE).map((n) => caches.delete(n)));
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
  const cached = await matchOffline(OFFLINE_URL);
  if (cached) return cached;
  return new Response(
    "<!DOCTYPE html><html lang='ar' dir='rtl'><head><meta charset='UTF-8'><title>غير متصل</title></head><body><h1>أنت غير متصل بالإنترنت</h1></body></html>",
    { status: 503, statusText: "Service Unavailable", headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Which cached shell can render this URL without the network? null = none (show the offline page).
 * Only URLs whose content lives in the browser are served from a shell: local items (?type=user, ids with
 * the user_* prefix), the notebook editor for new / local notebooks, and the home SPA («محتواي»).
 * A published item (/quiz/<uuid>) is rendered by the server, so offline it still gets the offline page.
 */
function offlineShellFor(url) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const local = url.searchParams.get("type") === "user";
  if (p === "/" || p === "/index.html" || p === "/ai-agent" || p === "/my-content" || p.startsWith("/my-content/")) return "/";
  if (p === "/quiz" || p === "/lesson" || p === "/notebook") return p;
  if (p === "/notebook/new" || /^\/notebook\/edit\/user_notebook_/.test(p)) return "/notebook";
  if (/^\/(?:quiz|q)\/[^/]+$/.test(p) && (local || /^\/(?:quiz|q)\/user_/.test(p))) return "/quiz";
  if (/^\/lesson\/[^/]+$/.test(p) && (local || /^\/lesson\/user_lesson_/.test(p))) return "/lesson";
  if (/^\/notebook\/[^/]+$/.test(p) && (local || /^\/notebook\/user_notebook_/.test(p))) return "/notebook";
  return null;
}

async function offlineNavigationResponse(request) {
  const shell = offlineShellFor(new URL(request.url));
  if (shell) {
    const cached = await matchOffline(shell);
    if (cached) return cached;
  }
  return offlinePageResponse();
}

async function matchOffline(request, options) {
  const cache = await caches.open(OFFLINE_CACHE);
  return cache.match(request, options);
}

const CACHE_FIRST = /^\/(?:assets\/|dist\/chunks\/|.*\.(?:png|jpe?g|webp|avif|svg|ico|woff2?)$)/i;

// Stable-named generated bundles: files change without their URL changing.
const ALWAYS_REVALIDATE = /^\/assets\/(?:notebook-runtime[^/]*|vendor\/tiptap)\//;

async function revalidate(request, init) {
  const response = await fetch(request, init); // honours HTTP cache + Cache-Control unless init overrides
  if (response.ok) {
    const cache = await caches.open(OFFLINE_CACHE);
    await cacheResponse(cache, request, response.clone());
  }
  return response;
}


// ── Cross-origin (CDN) assets ───────────────────────────────────────────────────
// Versioned files and font binaries never change: cache-first. Unpinned ones (supabase-js@2, the Google
// Fonts stylesheet) are served from the cache and refreshed in the background.
const isImmutableCdn = (url) => url.hostname === "fonts.gstatic.com" || /@\d+\.\d+\.\d+/.test(url.pathname);

async function fetchCors(url) {
  // An explicit CORS request gives a readable (non-opaque) response, which is cheap to store and can be parsed.
  const response = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function refreshCdn(cache, url) {
  const response = await fetchCors(url);
  await cacheResponse(cache, url, response.clone());
  return response;
}

async function cdnResponse(event, request, url) {
  const cache = await caches.open(OFFLINE_CACHE);
  const cached = await cache.match(url.href);
  if (cached) {
    if (!isImmutableCdn(url)) event.waitUntil(refreshCdn(cache, url.href).catch(() => { }));
    return cached;
  }
  try {
    return await refreshCdn(cache, url.href);
  } catch (_) {
    return fetch(request); // not CORS-enabled after all, or offline: behave as if the worker was not here
  }
}

// ── Offline warm-up ─────────────────────────────────────────────────────────────
const isStableUrl = (u) => !/^\/dist\/(?:chunks|assets)\//.test(u); // hashed files never change; everything else is revalidated

async function cacheUrl(cache, url) {
  const stable = !url.startsWith("https://") && isStableUrl(url);
  if (!stable && (await cache.match(url))) return;
  try {
    const response = url.startsWith("https://") ? await fetchCors(url) : await fetch(url, stable ? { cache: "no-cache" } : undefined);
    if (response.ok) await cacheResponse(cache, url, response);
  } catch (error) {
    console.warn("[SW] Could not cache:", url, error);
  }
}

async function runPool(items, worker, size = 6) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

/** url(...) targets of a stylesheet, resolved against the stylesheet's own URL. Google Fonts: Arabic + Latin subsets only. */
function cssAssetUrls(cssText, baseUrl) {
  let text = cssText;
  if (baseUrl.includes("fonts.googleapis.com")) {
    text = cssText.split(/\/\*\s*([a-z-]+)\s*\*\//).reduce((out, part, i, arr) => (i % 2 === 0 && i > 0 && ["arabic", "latin"].includes(arr[i - 1]) ? out + part : out), "");
  }
  const urls = new Set();
  for (const m of text.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)) {
    if (m[1].startsWith("data:")) continue;
    try { urls.add(new URL(m[1], baseUrl).href); } catch (_) { /* ignore */ }
  }
  return [...urls];
}

/** Third-party scripts / styles a shell page references (KaTeX, supabase-js, Google Fonts), read from the shell itself so this list can never drift. */
async function crossOriginRefs(cache) {
  const refs = new Set();
  for (const shell of SHELL_PAGES) {
    const response = await cache.match(shell);
    if (!response) continue;
    const html = await response.clone().text();
    for (const m of html.matchAll(/(?:src|href)=["'](https:\/\/[^"']+)["']/g)) {
      const href = m[1].replace(/&amp;/g, "&");
      try { if (CDN_HOSTS.has(new URL(href).hostname) && !/\.(?:png|jpe?g|svg|ico)(?:\?|$)/i.test(href)) refs.add(href); } catch (_) { /* ignore */ }
    }
  }
  return [...refs];
}

async function warmOffline({ cpp = false } = {}) {
  const cache = await caches.open(OFFLINE_CACHE);

  // 1. Shells (always refreshed: they are the entry points and must track deploys).
  await runPool(["/", ...SHELL_PAGES], async (u) => { await cacheUrl(cache, u); });

  // 2. Every JS / CSS file the four pages need (the build writes the list: hashed names are unknowable here).
  let manifest = null;
  try {
    const res = await fetch("/dist/offline-manifest.json", { cache: "no-cache" });
    if (res.ok) manifest = await res.json();
  } catch (_) { /* offline or old build: the pages still get cached as they are visited */ }
  const files = new Set([...EDITOR_ASSETS, ...RUNTIMES.matlab, ...(cpp ? RUNTIMES.cpp : [])]);
  for (const list of Object.values(manifest?.pages || {})) for (const u of list) files.add(u);
  await runPool([...files], (u) => cacheUrl(cache, u));

  // 3. Runtime stylesheets reference their fonts relatively (./fonts/KaTeX_*.woff2).
  for (const css of [...RUNTIMES.matlab, ...(cpp ? RUNTIMES.cpp : [])].filter((u) => u.endsWith(".css"))) {
    const res = await cache.match(css);
    if (res) await runPool(cssAssetUrls(await res.clone().text(), new URL(css, self.location.origin).href).map((u) => new URL(u).pathname), (u) => cacheUrl(cache, u));
  }

  // 4. Third-party assets; their stylesheets pull in font files.
  const refs = await crossOriginRefs(cache);
  await runPool(refs, (u) => cacheUrl(cache, u));
  for (const ref of refs.filter((u) => /\.css(?:$|\?)|fonts\.googleapis\.com/.test(u))) {
    const res = await cache.match(ref);
    if (res) await runPool(cssAssetUrls(await res.clone().text(), ref), (u) => cacheUrl(cache, u));
  }

  // 5. Drop /dist files that no longer exist (hashed chunks of earlier deploys).
  if (manifest?.all) {
    const live = new Set(manifest.all);
    for (const req of await cache.keys()) {
      const u = new URL(req.url);
      if (u.origin === self.location.origin && u.pathname.startsWith("/dist/") && !live.has(u.pathname) && u.pathname !== "/dist/offline-manifest.json") await cache.delete(req);
    }
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  if (request.url.startsWith("chrome-extension://")) return;
  const url = new URL(request.url);

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).then(async (response) => {
        // Keep the home SPA shell fresh (it also serves /my-content/*). The quiz / lesson / notebook shells are
        // refreshed from their plain URLs only: a /quiz/<id> response carries an injected id and must not become the shell.
        if (response.ok && isAppAsset(url) && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/my-content"))) {
          const cache = await caches.open(OFFLINE_CACHE);
          await cacheResponse(cache, "/", response.clone());
        }
        if (response.ok && isAppAsset(url) && SHELL_PAGES.includes(url.pathname) && !url.search) {
          const cache = await caches.open(OFFLINE_CACHE);
          await cacheResponse(cache, url.pathname, response.clone());
        }
        return response;
      }).catch(() => offlineNavigationResponse(request)),
    );
    return;
  }

  // Scripts / styles / fonts from the CDNs the pages use (KaTeX, supabase-js, Google Fonts): cached for offline.
  if (url.origin !== self.location.origin && CDN_HOSTS.has(url.hostname)) {
    event.respondWith(cdnResponse(event, request, url));
    return;
  }

  // Never touch API or other cross-origin traffic.
  if (!isAppAsset(url)) return;

  // Stable-named bundle entries must always revalidate (they reference hashed chunks).
  if (/^\/dist\/(?:home|pages\/[^/]+)\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith(revalidate(request).catch(async () => (await matchOffline(request)) || new Response("Offline", { status: 503 })));
    return;
  }

  // Notebook runtime / worker bundles: always ask the server (cache:"no-cache" also ignores a still-"fresh"
  // copy in the HTTP cache, e.g. one stored earlier under a 30-day max-age). Offline: last good copy.
  if (ALWAYS_REVALIDATE.test(url.pathname)) {
    event.respondWith(revalidate(request, { cache: "no-cache" }).catch(async () => (await matchOffline(request)) || new Response("Offline", { status: 503, statusText: "Service Unavailable" })));
    return;
  }

  event.respondWith((async () => {
    const cached = await matchOffline(request);
    if (cached) {
      // cache-first for immutable-ish files; SWR (refresh in background) for code.
      if (!CACHE_FIRST.test(url.pathname)) event.waitUntil(revalidate(request).catch(() => { }));
      return cached;
    }
    try {
      return await revalidate(request);
    } catch (_) {
      const fallback = await matchOffline(request, { ignoreSearch: true });
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
      { action: "explore", title: "عرض", icon: ACTION_ICON_CHECK },
      { action: "close", title: "إغلاق", icon: ACTION_ICON_CLOSE },
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

  if (data.type === "WARM_OFFLINE") {
    event.waitUntil(
      (async () => {
        // The C++ runtime is cached only for users who installed the Instant Compiler (its toolchain cache exists).
        const cpp = await caches.has(CPP_WASM_CACHE);
        await warmOffline({ cpp });
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const c of clients) c.postMessage({ type: "OFFLINE_READY", cpp });
      })().catch((error) => console.warn("[SW] Offline warm-up failed:", error)),
    );
  }

  // Legacy clients may still send CLEAR_CACHE — wipe everything except offline page.
  if (data.type === "CLEAR_CACHE") {
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith(CACHE_PREFIX) && name !== OFFLINE_CACHE)
              .map((name) => caches.delete(name)),
          ),
        ),
    );
  }
});

console.log("[SW] Service worker script loaded (app-shell offline support)");

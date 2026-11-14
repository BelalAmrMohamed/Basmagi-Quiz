// public/src/shared/analytics-beacon.js
// Tiny, cookie-less page-view beacon for the platform-wide counter on about.html.
//
//   * One "track" call per page view (also when the home SPA navigates via
//     history.pushState to a different pathname).
//   * One "ping" every 2 min while the tab is visible, so "online now" stays
//     accurate on long reads without counting extra views.
//   * Nothing is stored in the browser and no identifier is sent: the server
//     derives an anonymous, daily-rotating hash from the request (see
//     api/_analytics.js). Skipped on localhost, for automated browsers, and for admins.
(function () {
  "use strict";
  if (window.__basmagiBeacon) return;
  window.__basmagiBeacon = true;

  var host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /\.local$/.test(host)) return;
  if (navigator.webdriver) return;

  function isAdmin() {
    try {
      if (sessionStorage.getItem("__bq_adm") || localStorage.getItem("basmagi_admin_token")) return true;
    } catch (_) {}
    return false;
  }

  if (isAdmin()) return;

  var ENDPOINT = "https://esdfdzhtavraczrhxnmp.supabase.co/functions/v1/pulse";
  var HEARTBEAT_MS = 240000; // 4 min; server "online now" window is 7 min
  var IDLE_STOP_MS = 30 * 60 * 1000;
  var lastActive = Date.now();
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach(function (ev) {
    window.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true });
  });
  var MIN_GAP_MS = 5000;
  var lastPath = location.pathname;
  var lastSent = 0;
  var lastBeat = Date.now();

  function post(action) {
    if (isAdmin()) return;
    try {
      var body = JSON.stringify({ action: action });
      // text/plain Blob keeps this a "simple" request (no CORS preflight).
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: body,
        keepalive: true,
        credentials: "omit",
        cache: "no-store",
      }).catch(function () {});
    } catch (_) {}
  }

  function trackView() {
    var now = Date.now();
    if (now - lastSent < MIN_GAP_MS) return;
    lastSent = now;
    lastBeat = now;
    post("track");
  }

  function whenVisible(fn) {
    if (document.visibilityState === "visible") return fn();
    var onChange = function () {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onChange);
      fn();
    };
    document.addEventListener("visibilitychange", onChange);
  }

  whenVisible(trackView);

  // Home-page SPA: a new pathname is a new view (query-only or hash-only changes are ignored to prevent inflating views on search/filter).
  var origPush = history.pushState;
  if (typeof origPush === "function") {
    history.pushState = function () {
      var result = origPush.apply(this, arguments);
      try {
        var p = location.pathname;
        if (p !== lastPath) {
          lastPath = p;
          trackView();
        }
      } catch (_) {}
      return result;
    };
  }

  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastActive > IDLE_STOP_MS) return;
    lastBeat = Date.now();
    post("ping");
  }, HEARTBEAT_MS);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && Date.now() - lastBeat > HEARTBEAT_MS) {
      lastBeat = Date.now();
      post("ping");
    }
  });
})();

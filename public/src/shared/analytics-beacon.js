// public/src/shared/analytics-beacon.js
// Tiny, cookie-less page-view beacon for the platform-wide counter on about.html.
//
//   * One "track" call per page view (also when the home SPA navigates via
//     history.pushState to a different path/query).
//   * One "ping" every 2 min while the tab is visible, so "online now" stays
//     accurate on long reads without counting extra views.
//   * Nothing is stored in the browser and no identifier is sent: the server
//     derives an anonymous, daily-rotating hash from the request (see
//     api/_analytics.js). Skipped on localhost and for automated browsers.
(function () {
  "use strict";
  if (window.__basmagiBeacon) return;
  window.__basmagiBeacon = true;

  var host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /\.local$/.test(host)) return;
  if (navigator.webdriver) return;

  var ENDPOINT = "/api/admin";
  var HEARTBEAT_MS = 120000;
  var MIN_GAP_MS = 800;
  var lastPath = location.pathname + location.search;
  var lastSent = 0;
  var lastBeat = Date.now();

  function post(action) {
    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action }),
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

  // Home-page SPA: a new path/query is a new view (hash-only changes are not).
  var origPush = history.pushState;
  if (typeof origPush === "function") {
    history.pushState = function () {
      var result = origPush.apply(this, arguments);
      try {
        var p = location.pathname + location.search;
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

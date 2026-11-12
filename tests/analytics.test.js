import test from "node:test";
import assert from "node:assert/strict";
import {
  isBotUserAgent,
  visitorHash,
  normalizeLiveStats,
  handleAnalyticsTrack,
} from "../api/_analytics.js";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function fakeRes() {
  const res = { headers: {}, statusCode: 0, body: undefined };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}
function fakeDb() {
  const calls = [];
  return { calls, rpc: async (fn, args) => { calls.push([fn, args]); return { error: null }; } };
}
const req = (over = {}) => ({
  body: { action: "track" },
  headers: { "user-agent": CHROME, host: "basmagi.vercel.app", "x-forwarded-for": "10.1.2.3" },
  ...over,
});

test("bot filter: real browsers pass, crawlers/tools/empty UA are dropped", () => {
  assert.equal(isBotUserAgent(CHROME), false);
  assert.equal(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(isBotUserAgent("curl/8.4.0"), true);
  assert.equal(isBotUserAgent(""), true);
});

test("visitorHash: stable per day+ip+ua, rotates daily, never contains the IP", () => {
  const d1 = new Date("2026-11-04T10:00:00Z");
  const d2 = new Date("2026-11-05T10:00:00Z");
  const a = visitorHash("10.1.2.3", CHROME, d1, "s");
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, visitorHash("10.1.2.3", CHROME, new Date("2026-11-04T23:59:00Z"), "s"));
  assert.notEqual(a, visitorHash("10.1.2.3", CHROME, d2, "s"));
  assert.notEqual(a, visitorHash("10.1.2.4", CHROME, d1, "s"));
  assert.notEqual(a, visitorHash("10.1.2.3", CHROME, d1, "other-secret"));
  assert.ok(!a.includes("10.1.2.3"));
});

test("normalizeLiveStats: defensive shape, 30 days max, bad values become 0", () => {
  const daily = Array.from({ length: 35 }, (_, i) => ({
    day: `2026-10-${String(i + 1).padStart(2, "0")}`,
    visitors: i,
    views: i * 2,
  }));
  const n = normalizeLiveStats({
    totalVisitors: "500",
    visitorsToday: 25,
    totalViews: "1234",
    viewsToday: -5,
    onlineNow: null,
    daily: [...daily, { day: "bad", visitors: 5, views: 9 }],
  });
  assert.equal(n.totalVisitors, 500);
  assert.equal(n.visitorsToday, 25);
  assert.equal(n.totalViews, 1234);
  assert.equal(n.viewsToday, 0);
  assert.equal(n.onlineNow, 0);
  assert.equal(n.daily.length, 30);
  assert.equal(typeof n.daily[0].visitors, "number");
  assert.equal(typeof n.daily[0].views, "number");
  assert.deepEqual(normalizeLiveStats(null), {
    totalVisitors: 0,
    visitorsToday: 0,
    totalViews: 0,
    viewsToday: 0,
    onlineNow: 0,
    daily: [],
  });
});

test("track handler: records a view, always 204, ignores bots / foreign origins, maps ping to heartbeat", async () => {
  let db = fakeDb(), res = fakeRes();
  await handleAnalyticsTrack(req(), res, db);
  assert.equal(res.statusCode, 204);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0][0], "analytics_track_view");
  assert.match(db.calls[0][1].p_visitor, /^[0-9a-f]{32}$/);

  db = fakeDb(); res = fakeRes();
  await handleAnalyticsTrack(req({ body: { action: "ping" }, headers: { ...req().headers, "x-forwarded-for": "10.9.9.9" } }), res, db);
  assert.equal(db.calls[0][0], "analytics_heartbeat");

  db = fakeDb(); res = fakeRes();
  await handleAnalyticsTrack(req({ headers: { ...req().headers, "user-agent": "Googlebot/2.1" } }), res, db);
  assert.equal(res.statusCode, 204);
  assert.equal(db.calls.length, 0);

  db = fakeDb(); res = fakeRes();
  await handleAnalyticsTrack(req({ headers: { ...req().headers, origin: "https://evil.example" } }), res, db);
  assert.equal(res.statusCode, 204);
  assert.equal(db.calls.length, 0);

  res = fakeRes();
  await handleAnalyticsTrack(req({ body: { action: "nope" } }), res, fakeDb());
  assert.equal(res.statusCode, 400);
});

import { parseRange, normalizeRangeStats, MAX_RANGE_DAYS } from "../api/_analytics.js";

test("parseRange: default 30 days returns null, days/from-to are clamped", () => {
  const now = new Date("2026-11-11T10:00:00Z");
  assert.equal(parseRange({}, now), null);
  assert.equal(parseRange({ days: "30" }, now), null);
  assert.equal(parseRange({ days: "abc" }, now), null);
  assert.deepEqual(parseRange({ days: "7" }, now), { from: "2026-11-05", to: "2026-11-11" });
  const year = parseRange({ days: "365" }, now);
  assert.equal(year.to, "2026-11-11");
  assert.equal(year.from, "2025-11-12");
  const huge = parseRange({ days: "99999" }, now);
  assert.equal((Date.parse(huge.to) - Date.parse(huge.from)) / 86400000, MAX_RANGE_DAYS - 1);
  assert.deepEqual(parseRange({ from: "2026-11-01", to: "2026-11-05" }, now), { from: "2026-11-01", to: "2026-11-05" });
  assert.deepEqual(parseRange({ from: "2026-11-09", to: "2030-01-01" }, now), { from: "2026-11-09", to: "2026-11-11" });
  assert.deepEqual(parseRange({ from: "2026-11-09", to: "2026-11-02" }, now), { from: "2026-11-02", to: "2026-11-02" });
  assert.equal(parseRange({ from: "nope" }, now), null);
});

test("normalizeRangeStats: keeps long ranges, drops bad rows", () => {
  const daily = Array.from({ length: 400 }, (_, i) => ({ day: new Date(Date.UTC(2025, 9, 1 + i)).toISOString().slice(0, 10), visitors: i, views: i }));
  const n = normalizeRangeStats({ from: "2025-10-01", to: "2026-11-04", rangeVisitors: "10", daily: [...daily, { day: "x" }] });
  assert.equal(n.daily.length, 400);
  assert.equal(n.rangeVisitors, 10);
  assert.equal(n.firstDay, null);
});

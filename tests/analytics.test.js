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
  headers: { "user-agent": CHROME, host: "basmagi-quiz.vercel.app", "x-forwarded-for": "10.1.2.3" },
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
  const daily = Array.from({ length: 35 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, views: i }));
  const n = normalizeLiveStats({ totalViews: "1234", viewsToday: -5, onlineNow: null, daily: [...daily, { day: "bad", views: 9 }] });
  assert.equal(n.totalViews, 1234);
  assert.equal(n.viewsToday, 0);
  assert.equal(n.onlineNow, 0);
  assert.equal(n.daily.length, 30);
  assert.deepEqual(normalizeLiveStats(null), { totalViews: 0, viewsToday: 0, onlineNow: 0, daily: [] });
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

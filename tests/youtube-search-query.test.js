import test from "node:test";
import assert from "node:assert/strict";
import handler from "../supabase/functions/youtube/handler.js";
import { validateSearchQuery, YOUTUBE_LIMITS } from "../public/src/shared/youtube-rules.js";

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

async function search(q, fetchImpl) {
  const prevKey = process.env.YOUTUBE_DATA_API_KEY;
  const prevFetch = globalThis.fetch;
  process.env.YOUTUBE_DATA_API_KEY = "test-key-123";
  globalThis.fetch = fetchImpl;
  try {
    const res = mockRes();
    const remoteAddress = `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    await handler({ method: "GET", query: { action: "search", q }, headers: {}, socket: { remoteAddress } }, res);
    return res;
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
    else process.env.YOUTUBE_DATA_API_KEY = prevKey;
  }
}

test("search accepts symbols, emoji, Arabic and mixed text", () => {
  for (const q of ["a|b", "C++ / Java?", "50% off #1", "a@b.com", "🎓 مقدمة في البرمجة", "ذكاء اصطناعي"]) {
    assert.equal(validateSearchQuery(q).ok, true, q);
  }
});

test("search rejects empty input and names the rule", () => {
  const r = validateSearchQuery("   ");
  assert.equal(r.ok, false);
  assert.equal(r.code, "empty");
  assert.ok(r.message.length > 0);
});

test("search allows up to 100 characters, counted by code point", () => {
  const max = YOUTUBE_LIMITS.searchQueryMax;
  assert.equal(validateSearchQuery("x".repeat(max)).ok, true);
  assert.equal(validateSearchQuery("😀".repeat(max)).ok, true);
  assert.equal(validateSearchQuery("x".repeat(max + 1)).code, "too-long");
});

test("search rejects control characters", () => {
  for (const q of ["a\nb", "a\tb", "a\u0000b", "a\u007fb"]) {
    assert.equal(validateSearchQuery(q).code, "control-chars", JSON.stringify(q));
  }
});

test("server lets a search containing | through to YouTube", async () => {
  let calledUrl = "";
  const res = await search("a|b", async (url) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });
  assert.equal(res.statusCode, 200);
  assert.match(calledUrl, /q=a(%7C|\|)b/);
});

test("server explains a rejected search instead of a generic error", async () => {
  const res = await search("a\nb", async () => { throw new Error("YouTube must not be called"); });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "bad_request");
  assert.equal(res.body.reason, "control-chars");
  assert.match(res.body.error, /محارف/);
});

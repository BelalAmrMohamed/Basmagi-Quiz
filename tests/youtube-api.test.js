import test from "node:test";
import assert from "node:assert/strict";
import handler from "../supabase/functions/youtube/handler.js";

const ID = "dQw4w9WgXcQ";

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

async function call(query, { fetchImpl, key = "test-key-123" } = {}) {
  const prevKey = process.env.YOUTUBE_DATA_API_KEY;
  const prevFetch = globalThis.fetch;
  process.env.YOUTUBE_DATA_API_KEY = key;
  globalThis.fetch = fetchImpl;
  try {
    const res = mockRes();
    await handler({ method: "GET", query, headers: {}, socket: { remoteAddress: `10.0.0.${Math.floor(Math.random() * 250)}` } }, res);
    return res;
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
    else process.env.YOUTUBE_DATA_API_KEY = prevKey;
  }
}

const ok = (body) => async () => new Response(JSON.stringify(body), { status: 200 });
const fail = (status, reason) => async () =>
  new Response(JSON.stringify({ error: { code: status, errors: [{ reason }] } }), { status });

test("rejects unknown actions and malformed IDs before calling Google", async () => {
  let calls = 0;
  const f = async () => { calls++; return new Response("{}"); };
  assert.equal((await call({ action: "nope" }, { fetchImpl: f })).statusCode, 400);
  assert.equal((await call({ action: "video", ids: "bad id" }, { fetchImpl: f })).statusCode, 400);
  assert.equal((await call({ action: "search", q: "a\u0000b" }, { fetchImpl: f })).statusCode, 400);
  assert.equal(calls, 0);
});

test("missing server key yields a stable error and never calls Google", async () => {
  const res = await call({ action: "search", q: "درس" }, { fetchImpl: async () => { throw new Error("should not run"); }, key: "" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "not_configured");
});

test("search normalizes results and never echoes the API key", async () => {
  const seen = [];
  const res = await call({ action: "search", q: "شرح الشبكات" }, {
    fetchImpl: async (url) => {
      seen.push(String(url));
      return ok({
        items: [{ id: { videoId: ID }, snippet: { title: "شرح", channelTitle: "قناة", thumbnails: { high: { url: "https://i.ytimg.com/vi/x/hq.jpg" } } } }],
        nextPageToken: "CAUQAA",
      })();
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items[0].videoId, ID);
  assert.equal(res.body.nextPageToken, "CAUQAA");
  assert.match(seen[0], /googleapis\.com\/youtube\/v3\/search/);
  assert.equal(JSON.stringify(res.body).includes("test-key-123"), false);
});

test("quota exhaustion maps to a stable 429 with no Google message", async () => {
  const res = await call({ action: "video", ids: ID }, { fetchImpl: fail(403, "quotaExceeded") });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, "quota");
});

test("a missing playlist is reported, not saved as an empty playlist", async () => {
  const res = await call({ action: "playlist", id: "PLabcdefghijklmnop" }, { fetchImpl: ok({ items: [] }) });
  assert.equal(res.statusCode, 404);
});

test("playlist pages mark deleted entries unavailable and keep the next token", async () => {
  let n = 0;
  const f = async () => {
    n++;
    if (n === 1) return ok({ items: [{ id: "PLabcdefghijklmnop", snippet: { title: "قائمة", channelTitle: "c" }, contentDetails: { itemCount: 3 } }] })();
    return ok({
      items: [
        { snippet: { title: "درس 1", thumbnails: {} }, contentDetails: { videoId: ID } },
        { snippet: { title: "Deleted video" }, contentDetails: { videoId: "abcdefghijk" } },
      ],
      nextPageToken: "NEXT1",
    })();
  };
  const res = await call({ action: "playlist", id: "PLabcdefghijklmnop" }, { fetchImpl: f });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items[0].videoId, ID);
  assert.equal(res.body.items[1].unavailable, true);
  assert.equal(res.body.items[1].videoId, null);
  assert.equal(res.body.nextPageToken, "NEXT1");
});

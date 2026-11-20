import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/ai-agent/chat.js";

function responseStub() {
  return {
    statusCode: 200, headers: {}, chunks: [], ended: false, jsonBody: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    flushHeaders() { this.flushed = true; },
    write(chunk) { this.chunks.push(String(chunk)); return true; },
    end() { this.ended = true; return this; },
    json(body) { this.jsonBody = body; this.ended = true; return this; },
    on() {},
  };
}

function makeRequest(ownKey) {
  return {
    method: "POST", headers: { "x-forwarded-for": "198.51.100.20" },
    body: { provider: "google", messages: [{ role: "user", content: "hello" }], useOwnKey: true, ownKey, stream: true },
  };
}

test("chat route emits SSE headers, deltas and one final full-result event", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "hello" }] } }] })}\n\n`));
      controller.close();
    },
  }), { status: 200 });
  try {
    const res = responseStub();
    await handler(makeRequest(`test-key-${Date.now()}-ok`), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /text\/event-stream/);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.ended, true);
    assert.match(res.chunks.join(""), /event: text/);
    assert.match(res.chunks.join(""), /event: done/);
    assert.deepEqual(JSON.parse(res.chunks.join("").match(/event: done\ndata: (.+)\n/)[1]), { text: "hello" });
  } finally { globalThis.fetch = originalFetch; }
});

test("upstream failure before stream open remains a normal mapped JSON error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("busy", { status: 429 });
  try {
    const res = responseStub();
    await handler(makeRequest(`test-key-${Date.now()}-429`), res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers["content-type"], undefined);
    assert.equal(res.chunks.length, 0);
    assert.equal(res.jsonBody.transient, true);
  } finally { globalThis.fetch = originalFetch; }
});

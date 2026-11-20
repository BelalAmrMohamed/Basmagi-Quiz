import test from "node:test";
import assert from "node:assert/strict";
import { callProvider } from "../api/ai-agent/_providerClients.js";

const encoder = new TextEncoder();
function sseResponse(events) {
  const bytes = encoder.encode(events.map(([name, value]) => `${name ? `event: ${name}\n` : ""}data: ${JSON.stringify(value)}\n\n`).join(""));
  const chunks = [...bytes].map((byte) => Uint8Array.of(byte));
  return new Response(new ReadableStream({ start(c) { chunks.forEach((part) => c.enqueue(part)); c.close(); } }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
const originalFetch = globalThis.fetch;
const capture = async (response, assertion) => {
  let request;
  globalThis.fetch = async (url, init) => { request = { url: String(url), init }; return response; };
  try {
    const events = [];
    const result = await callProvider("google", "key", [{ role: "user", content: "go" }], "", [], undefined, undefined, {
      onOpen() {}, onEvent(event) { events.push(event); },
    });
    assertion(request, result, events);
  } finally { globalThis.fetch = originalFetch; }
};

test("Gemini stream assembles Arabic text and multiple complete tool calls", async () => {
  await capture(sseResponse([["", { candidates: [{ content: { parts: [{ text: "مر" }, { text: "حباً" }, { functionCall: { name: "search_library", args: { query: "a" } }, thoughtSignature: "sig" }, { functionCall: { name: "search_library", args: { query: "b" } } }] } }] }]]), (request, result, events) => {
    assert.match(request.url, /:streamGenerateContent\?alt=sse&key=key$/);
    assert.equal(result.text, "مرحباً");
    assert.equal(result.toolCalls.length, 2);
    assert.equal(result.toolCalls[0].thoughtSignature, "sig");
    assert.equal(events.filter((e) => e.type === "toolCall").length, 2);
  });
});

test("DeepSeek stream assembles indexed fragmented tool arguments", async () => {
  let request;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body);
    return sseResponse([
      ["", { choices: [{ delta: { content: "Hi", tool_calls: [{ index: 0, id: "c1", function: { name: "search_", arguments: "{\"query\":" } }] } }] }],
      ["", { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "library", arguments: "\"x\"}" } }, { index: 1, id: "c2", function: { name: "parse_item_info", arguments: "{}" } }] } }] }],
      ["", "[DONE]"],
    ]);
  };
  try {
    const result = await callProvider("deepseek", "key", [{ role: "user", content: "go" }], "", [], undefined, undefined, { onOpen() {}, onEvent() {} });
    assert.equal(request.stream, true);
    assert.equal(result.text, "Hi");
    assert.deepEqual(result.toolCalls.map((c) => c.name), ["search_library", "parse_item_info"]);
    assert.deepEqual(result.toolCalls[0].input, { query: "x" });
  } finally { globalThis.fetch = originalFetch; }
});

test("Claude stream joins JSON deltas and returns text and thinking", async () => {
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.stream, true);
    return sseResponse([
      ["content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } }],
      ["content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "reason" } }],
      ["content_block_start", { index: 1, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { index: 1, delta: { type: "text_delta", text: "Hello" } }],
      ["content_block_start", { index: 2, content_block: { type: "tool_use", id: "tc", name: "edit_item", input: {} } }],
      ["content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: "{\"target" } }],
      ["content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: "Title\":\"Q\"}" } }],
      ["content_block_stop", { index: 2 }],
    ]);
  };
  try {
    const result = await callProvider("claude", "key", [{ role: "user", content: "go" }], "", [], undefined, undefined, { onOpen() {}, onEvent() {} });
    assert.equal(result.text, "Hello");
    assert.equal(result.thinking, "reason");
    assert.deepEqual(result.toolCalls, [{ id: "tc", name: "edit_item", input: { targetTitle: "Q" } }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("provider errors before stream open keep upstream status for JSON mapping", async () => {
  globalThis.fetch = async () => new Response("busy", { status: 429 });
  try {
    await assert.rejects(
      callProvider("google", "key", [{ role: "user", content: "go" }], "", [], undefined, undefined, { onEvent() {} }),
      (error) => error.upstreamStatus === 429,
    );
  } finally { globalThis.fetch = originalFetch; }
});

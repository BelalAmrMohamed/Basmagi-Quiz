import test from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../public/src/components/ai-agent/core/agent-loop.js";

function eventStream(events) {
  const body = events.map(([name, value]) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`).join("");
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("agent loop consumes SSE text and complete tool calls and keeps the final answer", async () => {
  const original = globalThis.fetch;
  const requests = [];
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    count++;
    if (count === 1) return eventStream([
      ["text", { delta: "مرحباً" }],
      ["toolCall", { id: "search1", name: "search_library", input: { query: "x" } }],
      ["done", { text: "مرحباً", toolCalls: [{ id: "search1", name: "search_library", input: { query: "x" } }] }],
    ]);
    return eventStream([["text", { delta: "تم" }], ["done", { text: "تم" }]]);
  };
  try {
    const history = [{ role: "user", content: "ابحث" }];
    const updates = [];
    const result = await runAgentLoop({
      history, systemPrompt: "sys", provider: "google", apiUrl: (path) => path,
      signal: new AbortController().signal,
      executeToolCall: async () => "found",
      onAssistantStream: (partial) => updates.push(partial),
    });
    assert.equal(result.success, true);
    assert.deepEqual(history.filter((m) => m.role === "assistant").map((m) => m.content), ["مرحباً", "تم"]);
    assert.equal(history.find((m) => m.role === "tool").content, "found");
    assert.equal(requests[0].stream, true);
    assert.equal(requests[0].turnId, requests[1].turnId);
    assert.equal(updates.at(-1).text, "تم");
  } finally { globalThis.fetch = original; }
});

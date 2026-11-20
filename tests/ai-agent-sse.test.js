import test from "node:test";
import assert from "node:assert/strict";
import { readSse } from "../public/src/components/ai-agent/core/sse.js";

function byteStream(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
}

test("SSE parser handles every byte boundary, CRLF, comments, multi-line data and Arabic UTF-8", async () => {
  const events = await readSse(byteStream(": keepalive\r\nevent: text\r\ndata: مرح\r\ndata: با\r\n\r\nevent: done\ndata: {}\n\n"));
  assert.deepEqual(events, [
    { event: "text", data: "مرح\nبا" },
    { event: "done", data: "{}" },
  ]);
});

test("SSE parser flushes a final event without a trailing blank line", async () => {
  assert.deepEqual(await readSse(byteStream("event: error\ndata: {\"error\":\"x\"}")), [
    { event: "error", data: "{\"error\":\"x\"}" },
  ]);
});

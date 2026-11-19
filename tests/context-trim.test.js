import test from "node:test";
import assert from "node:assert/strict";
import { trimContext, estimateWireBytes, summarizeToolInput, TOOL_RESULT_LIMIT, MAX_WIRE_BYTES } from "../public/src/components/ai-agent/core/context-trim.js";

const big = (n, ch = "x") => ch.repeat(n);
const att = (name, n = 1000) => ({ mimeType: "application/pdf", name, base64: big(n, "A") });

function conversation() {
  return [
    { role: "user", content: "PAGE CONTEXT" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "create_quiz", input: { title: "T", questions: [1, 2, 3] }, thoughtSignature: "sig" }] },
    { role: "tool", toolCallId: "c1", toolName: "create_quiz", content: big(2000) },
    { role: "assistant", content: "done" },
    { role: "user", content: "second", attachments: [att("a.pdf")] },
    { role: "user", content: "third", attachments: [att("b.pdf")] },
    { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "search_library", input: { query: "q" } }] },
    { role: "tool", toolCallId: "c2", toolName: "search_library", content: big(2000) },
    { role: "user", content: "current", attachments: [att("c.pdf")] },
    { role: "assistant", content: "", toolCalls: [{ id: "c3", name: "create_quiz", input: { title: "N", questions: [1] } }] },
    { role: "tool", toolCallId: "c3", toolName: "create_quiz", content: big(5000) },
  ];
}

test("the current turn is untouched", () => {
  const msgs = conversation();
  const out = trimContext(msgs);
  assert.deepEqual(out.slice(8), msgs.slice(8));
});

test("older long tool results are trimmed, pairing and order are intact", () => {
  const out = trimContext(conversation());
  assert.ok(out[2].content.length < TOOL_RESULT_LIMIT);
  assert.match(out[2].content, /…\[trimmed 1700 chars\]$/);
  assert.equal(out[2].toolCallId, "c1");
  assert.equal(out.length, conversation().length);
  const callIds = new Set(out.flatMap((m) => (m.toolCalls || []).map((t) => t.id)));
  for (const m of out.filter((x) => x.role === "tool")) assert.ok(callIds.has(m.toolCallId));
});

test("short old tool results are left alone", () => {
  const msgs = conversation();
  msgs[2].content = "short";
  assert.equal(trimContext(msgs)[2].content, "short");
});

test("attachments are kept for the last 2 user turns only", () => {
  const out = trimContext(conversation());
  assert.equal(out[4].attachments, undefined);
  assert.match(out[4].content, /\[attachment: a\.pdf\]/);
  assert.ok(out[5].attachments?.length);
  assert.ok(out[8].attachments?.length);
});

test("the input is never mutated", () => {
  const msgs = conversation();
  const snapshot = JSON.stringify(msgs);
  trimContext(msgs, { trimOldToolInputs: true });
  assert.equal(JSON.stringify(msgs), snapshot);
});

test("idempotent", () => {
  const once = trimContext(conversation(), { trimOldToolInputs: true });
  assert.deepEqual(trimContext(once, { trimOldToolInputs: true }), once);
});

test("history[0] page context is preserved", () => {
  assert.equal(trimContext(conversation())[0].content, "PAGE CONTEXT");
});

test("size guard strips oldest attachments, never the current turn", () => {
  const msgs = conversation();
  msgs[5].attachments = [att("b.pdf", 2000)];
  msgs[8].attachments = [att("c.pdf", 2000)];
  const out = trimContext(msgs, { maxBytes: 3000 });
  assert.equal(out[5].attachments, undefined);
  assert.ok(out[8].attachments?.length);
});

test("default limit is 3.5MB", () => {
  assert.equal(MAX_WIRE_BYTES, 3.5 * 1024 * 1024);
  assert.ok(estimateWireBytes(conversation()) > 0);
});

test("stage 2 is off by default; when on it keeps id/name/thoughtSignature", () => {
  const off = trimContext(conversation());
  assert.deepEqual(off[1].toolCalls[0].input, { title: "T", questions: [1, 2, 3] });
  const on = trimContext(conversation(), { trimOldToolInputs: true });
  const tc = on[1].toolCalls[0];
  assert.equal(tc.id, "c1");
  assert.equal(tc.name, "create_quiz");
  assert.equal(tc.thoughtSignature, "sig");
  assert.deepEqual(tc.input, { title: "T", questions_count: 3, _trimmed: true });
  // non-heavy tools and the current turn are unchanged
  assert.deepEqual(on[6].toolCalls[0].input, { query: "q" });
  assert.deepEqual(on[9], conversation()[9]);
});

test("summarizeToolInput handles non-objects", () => {
  assert.equal(summarizeToolInput(null), null);
});

test("acceptance: a 3-quiz conversation shrinks by at least 40%", () => {
  const msgs = [{ role: "user", content: "ctx" }];
  for (let i = 0; i < 3; i++) {
    msgs.push({ role: "user", content: `make quiz ${i}`, attachments: [att(`f${i}.pdf`, 200_000)] });
    msgs.push({ role: "assistant", content: "", toolCalls: [{ id: `q${i}`, name: "create_quiz", input: { title: `Q${i}`, questions: new Array(20).fill({ text: big(300) }) } }] });
    msgs.push({ role: "tool", toolCallId: `q${i}`, toolName: "create_quiz", content: big(4000) });
    msgs.push({ role: "assistant", content: "done" });
  }
  msgs.push({ role: "user", content: "one more" });
  const before = estimateWireBytes(msgs);
  const after = estimateWireBytes(trimContext(msgs));
  assert.ok(after <= before * 0.6, `before ${before} after ${after}`);
});

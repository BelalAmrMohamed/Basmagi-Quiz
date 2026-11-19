import test from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop, DEFAULT_MAX_DEPTH } from "../public/src/components/ai-agent/core/agent-loop.js";
import { installFakeChat, apiUrl } from "./helpers/fake-chat.js";

function makeCard() {
  const card = { statuses: [], updateStatus(status, info) { card.statuses.push({ status, info }); } };
  return card;
}

function baseParams(overrides = {}) {
  return {
    history: [{ role: "user", content: "hi" }],
    systemPrompt: "sys",
    provider: "google",
    signal: new AbortController().signal,
    apiUrl,
    executeToolCall: async () => "ok",
    ...overrides,
  };
}

const call = (name, input = {}, id) => ({ name, input, ...(id ? { id } : {}) });

test("two search_library calls with different queries both execute", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "a" }), call("search_library", { query: "b" })] },
    { text: "done" },
  ]);
  try {
    const executed = [];
    const result = await runAgentLoop(baseParams({ executeToolCall: async (tc) => { executed.push(tc.input.query); return "r"; } }));
    assert.equal(result.success, true);
    assert.deepEqual(executed, ["a", "b"]);
  } finally { fake.restore(); }
});

test("three create_quiz calls in one turn all execute", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("create_quiz", { title: "A" }), call("create_quiz", { title: "B" }), call("create_quiz", { title: "C" })] },
    { text: "done" },
  ]);
  try {
    let n = 0;
    const result = await runAgentLoop(baseParams({ executeToolCall: async () => { n++; return "created"; } }));
    assert.equal(result.success, true);
    assert.equal(n, 3);
  } finally { fake.restore(); }
});

test("exact duplicate (different key order) gets the already-done result and the turn continues", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("create_quiz", { title: "A", n: 1 })] },
    { toolCalls: [call("create_quiz", { n: 1, title: "A" })] },
    { text: "final" },
  ]);
  try {
    let executed = 0;
    const history = [{ role: "user", content: "hi" }];
    const texts = [];
    const result = await runAgentLoop(baseParams({
      history,
      executeToolCall: async () => { executed++; return "created"; },
      onAssistantMessage: (t) => texts.push(t),
    }));
    assert.equal(result.success, true);
    assert.equal(executed, 1);
    assert.deepEqual(texts, ["final"]);
    const toolMsgs = history.filter((m) => m.role === "tool");
    assert.equal(toolMsgs.length, 2);
    assert.match(toolMsgs[1].content, /مسبقاً/);
  } finally { fake.restore(); }
});

test("three consecutive all-duplicate steps stop the loop with success", async () => {
  const dup = { toolCalls: [call("create_quiz", { title: "A" })] };
  const fake = installFakeChat([dup, dup, dup, dup, dup, { text: "never reached" }]);
  try {
    let executed = 0;
    const result = await runAgentLoop(baseParams({ executeToolCall: async () => { executed++; return "ok"; } }));
    assert.equal(result.success, true);
    assert.equal(executed, 1);
    // step 1 executes, steps 2-4 are duplicates (3 in a row) -> halt
    assert.equal(fake.calls, 4);
  } finally { fake.restore(); }
});

test("a tool that fails 5 times then succeeds keeps going; errors are isError tool messages", async () => {
  const steps = [];
  for (let i = 0; i < 6; i++) steps.push({ toolCalls: [call("create_quiz", { title: "A", attempt: i })] });
  steps.push({ text: "done" });
  const fake = installFakeChat(steps);
  try {
    const sessionExecutedTools = new Set();
    const history = [{ role: "user", content: "hi" }];
    let attempts = 0;
    const result = await runAgentLoop(baseParams({
      history,
      sessionExecutedTools,
      executeToolCall: async () => {
        attempts++;
        if (attempts <= 5) throw new Error(`boom ${attempts}`);
        return "created";
      },
    }));
    assert.equal(result.success, true);
    assert.equal(attempts, 6);
    const toolMsgs = history.filter((m) => m.role === "tool");
    assert.equal(toolMsgs.length, 6);
    assert.equal(toolMsgs.filter((m) => m.isError).length, 5);
    assert.equal(toolMsgs[5].isError, undefined);
    // failed signatures were removed, the successful one stays
    assert.equal(sessionExecutedTools.size, 1);
    assert.ok([...sessionExecutedTools][0].includes('"attempt":5'));
  } finally { fake.restore(); }
});

test("a failed signature is not kept in sessionExecutedTools", async () => {
  const fake = installFakeChat([{ toolCalls: [call("create_quiz", { title: "A" })] }, { text: "done" }]);
  try {
    const sessionExecutedTools = new Set();
    await runAgentLoop(baseParams({ sessionExecutedTools, executeToolCall: async () => { throw new Error("x"); } }));
    assert.equal(sessionExecutedTools.size, 0);
  } finally { fake.restore(); }
});

test("abort during a tool call returns aborted and marks remaining cards aborted", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("create_quiz", { title: "A" }), call("create_quiz", { title: "B" }), call("create_quiz", { title: "C" })] },
  ]);
  try {
    const controller = new AbortController();
    const cards = [];
    const result = await runAgentLoop(baseParams({
      signal: controller.signal,
      onToolCallStart: () => { const c = makeCard(); cards.push(c); return c; },
      executeToolCall: async (tc) => {
        if (tc.input.title === "A") { controller.abort(); }
        return "ok";
      },
    }));
    assert.equal(result.aborted, true);
    assert.equal(result.success, false);
    assert.equal(cards[0].statuses.at(-1).status, "aborted");
    assert.equal(cards[1].statuses.at(-1).status, "aborted");
    assert.equal(cards[2].statuses.at(-1).status, "aborted");
  } finally { fake.restore(); }
});

test("maxDepth reached returns the Arabic error; Infinity does not", async () => {
  const mk = () => Array.from({ length: 80 }, (_, i) => ({ toolCalls: [call("search_library", { query: `q${i}` })] }));
  let fake = installFakeChat(mk());
  try {
    const result = await runAgentLoop(baseParams({ maxDepth: 3 }));
    assert.equal(result.success, false);
    assert.match(result.error, /توقف/);
    assert.equal(fake.calls, 3);
  } finally { fake.restore(); }

  const steps = Array.from({ length: DEFAULT_MAX_DEPTH + 5 }, (_, i) => ({ toolCalls: [call("search_library", { query: `q${i}` })] }));
  steps.push({ text: "done" });
  fake = installFakeChat(steps);
  try {
    const result = await runAgentLoop(baseParams({ maxDepth: Infinity }));
    assert.equal(result.success, true);
    assert.equal(fake.calls, DEFAULT_MAX_DEPTH + 6);
  } finally { fake.restore(); }
});

test("history shape: each tool call id has exactly one tool reply, in call order", async () => {
  const fake = installFakeChat([
    { text: "working", toolCalls: [call("search_library", { query: "a" }, "id_a"), call("create_quiz", { title: "B" }, "id_b"), call("search_library", { query: "a" }, "id_c")] },
    { text: "done" },
  ]);
  try {
    const history = [{ role: "user", content: "hi" }];
    await runAgentLoop(baseParams({ history, executeToolCall: async (tc) => (tc.name === "create_quiz" ? "made" : "found") }));
    const assistant = history.find((m) => m.role === "assistant" && m.toolCalls);
    assert.deepEqual(assistant.toolCalls.map((t) => t.id), ["id_a", "id_b", "id_c"]);
    const toolMsgs = history.filter((m) => m.role === "tool");
    assert.deepEqual(toolMsgs.map((m) => m.toolCallId), ["id_a", "id_b", "id_c"]);
  } finally { fake.restore(); }
});

test("a server error stops the turn with the message", async () => {
  const fake = installFakeChat([{ status: 429, body: { error: "limit" } }]);
  try {
    const result = await runAgentLoop(baseParams());
    assert.equal(result.success, false);
    assert.equal(result.error, "limit");
  } finally { fake.restore(); }
});

test("every request of one turn carries the same turnId; a new turn gets a new one", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "a" })] },
    { toolCalls: [call("search_library", { query: "b" })] },
    { text: "done" },
  ]);
  try {
    await runAgentLoop(baseParams());
    const ids = fake.requests.map((r) => r.body.turnId);
    assert.equal(ids.length, 3);
    assert.match(ids[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(new Set(ids).size, 1);
  } finally { fake.restore(); }

  const fake2 = installFakeChat([{ text: "one" }, { text: "two" }]);
  try {
    await runAgentLoop(baseParams());
    await runAgentLoop(baseParams());
    assert.notEqual(fake2.requests[0].body.turnId, fake2.requests[1].body.turnId);
  } finally { fake2.restore(); }
});

test("an explicit turnId is used as given", async () => {
  const fake = installFakeChat([{ text: "ok" }]);
  try {
    await runAgentLoop(baseParams({ turnId: "11111111-2222-4333-8444-555555555555" }));
    assert.equal(fake.requests[0].body.turnId, "11111111-2222-4333-8444-555555555555");
  } finally { fake.restore(); }
});

// ── Phase 3: parallel read-only tools ───────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("three delayed searches run in parallel (about the time of one)", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "a" }), call("search_library", { query: "b" }), call("search_library", { query: "c" })] },
    { text: "done" },
  ]);
  try {
    const t0 = Date.now();
    await runAgentLoop(baseParams({ executeToolCall: async () => { await sleep(120); return "r"; } }));
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 300, `expected ~120ms, took ${elapsed}ms`);
  } finally { fake.restore(); }
});

test("with parallelSafeTools disabled the same calls run one after another", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "a" }), call("search_library", { query: "b" }), call("search_library", { query: "c" })] },
    { text: "done" },
  ]);
  try {
    const t0 = Date.now();
    await runAgentLoop(baseParams({ parallelSafeTools: new Set(), executeToolCall: async () => { await sleep(80); return "r"; } }));
    assert.ok(Date.now() - t0 >= 230);
  } finally { fake.restore(); }
});

test("batched results are written to history in call order even when they finish out of order", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "slow" }, "id1"), call("search_library", { query: "mid" }, "id2"), call("search_library", { query: "fast" }, "id3")] },
    { text: "done" },
  ]);
  try {
    const delays = { slow: 90, mid: 45, fast: 5 };
    const history = [{ role: "user", content: "hi" }];
    await runAgentLoop(baseParams({
      history,
      executeToolCall: async (tc) => { await sleep(delays[tc.input.query]); return `res-${tc.input.query}`; },
    }));
    const tools = history.filter((m) => m.role === "tool");
    assert.deepEqual(tools.map((m) => m.toolCallId), ["id1", "id2", "id3"]);
    assert.deepEqual(tools.map((m) => m.content), ["res-slow", "res-mid", "res-fast"]);
  } finally { fake.restore(); }
});

test("one failing call in a batch does not block the others", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "a" }, "i1"), call("parse_item_info", { id: "x" }, "i2"), call("search_library", { query: "c" }, "i3")] },
    { text: "done" },
  ]);
  try {
    const history = [{ role: "user", content: "hi" }];
    const sessionExecutedTools = new Set();
    const result = await runAgentLoop(baseParams({
      history,
      sessionExecutedTools,
      executeToolCall: async (tc) => {
        if (tc.name === "parse_item_info") throw new Error("nope");
        return `ok-${tc.input.query}`;
      },
    }));
    assert.equal(result.success, true);
    const tools = history.filter((m) => m.role === "tool");
    assert.deepEqual(tools.map((m) => !!m.isError), [false, true, false]);
    assert.equal(tools[0].content, "ok-a");
    assert.equal(tools[2].content, "ok-c");
    // only the failed signature was released
    assert.equal(sessionExecutedTools.size, 2);
  } finally { fake.restore(); }
});

test("[search, create_quiz, search] runs strictly in order (a mutating call is a barrier)", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "a" }), call("create_quiz", { title: "Q" }), call("search_library", { query: "b" })] },
    { text: "done" },
  ]);
  try {
    const log = [];
    await runAgentLoop(baseParams({
      executeToolCall: async (tc) => {
        log.push(`start:${tc.name}:${tc.input.query || tc.input.title}`);
        await sleep(tc.name === "search_library" ? 30 : 5);
        log.push(`end:${tc.name}:${tc.input.query || tc.input.title}`);
        return "ok";
      },
    }));
    assert.deepEqual(log, [
      "start:search_library:a", "end:search_library:a",
      "start:create_quiz:Q", "end:create_quiz:Q",
      "start:search_library:b", "end:search_library:b",
    ]);
  } finally { fake.restore(); }
});

test("a mutating call waits for the whole batch before it, and the batch after it waits for the mutation", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "a" }), call("search_library", { query: "b" }), call("create_quiz", { title: "Q" }), call("search_library", { query: "c" }), call("search_library", { query: "d" })] },
    { text: "done" },
  ]);
  try {
    let running = 0;
    let maxRunning = 0;
    const startedBeforeQuiz = [];
    let quizDone = false;
    await runAgentLoop(baseParams({
      executeToolCall: async (tc) => {
        running++; maxRunning = Math.max(maxRunning, running);
        if (tc.name === "create_quiz") { assert.equal(running, 1, "mutation must run alone"); }
        else if (!quizDone) startedBeforeQuiz.push(tc.input.query);
        await sleep(25);
        running--;
        if (tc.name === "create_quiz") quizDone = true;
        return "ok";
      },
    }));
    assert.deepEqual(startedBeforeQuiz, ["a", "b"]);
    assert.equal(maxRunning, 2);
  } finally { fake.restore(); }
});

test("an exact duplicate inside one batch runs once", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "a" }, "d1"), call("search_library", { query: "a" }, "d2"), call("search_library", { query: "b" }, "d3")] },
    { text: "done" },
  ]);
  try {
    const executed = [];
    const history = [{ role: "user", content: "hi" }];
    await runAgentLoop(baseParams({ history, executeToolCall: async (tc) => { executed.push(tc.input.query); return "r"; } }));
    assert.deepEqual(executed.sort(), ["a", "b"]);
    const tools = history.filter((m) => m.role === "tool");
    assert.deepEqual(tools.map((m) => m.toolCallId), ["d1", "d2", "d3"]);
    assert.match(tools[1].content, /مسبقاً/);
  } finally { fake.restore(); }
});

test("history is persisted once per batch, not once per call", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "a" }), call("search_library", { query: "b" }), call("search_library", { query: "c" })] },
    { text: "done" },
  ]);
  try {
    let persists = 0;
    await runAgentLoop(baseParams({ onHistoryPersist: async () => { persists++; } }));
    // 1 for the assistant tool-call message + 1 for the whole batch + 1 for the final text
    // (3 calls in the batch would have made it 5 if persisted per call)
    assert.equal(persists, 3);
  } finally { fake.restore(); }
});

test("abort during a batch marks every card of the batch and the rest aborted", async () => {
  const fake = installFakeChat([
    { toolCalls: [call("search_library", { query: "a" }), call("search_library", { query: "b" }), call("create_quiz", { title: "Q" })] },
  ]);
  try {
    const controller = new AbortController();
    const cards = [];
    const result = await runAgentLoop(baseParams({
      signal: controller.signal,
      onToolCallStart: () => { const c = makeCard(); cards.push(c); return c; },
      executeToolCall: async (tc) => { await sleep(10); if (tc.input.query === "a") controller.abort(); return "ok"; },
    }));
    assert.equal(result.aborted, true);
    for (const c of cards) assert.equal(c.statuses.at(-1).status, "aborted");
  } finally { fake.restore(); }
});

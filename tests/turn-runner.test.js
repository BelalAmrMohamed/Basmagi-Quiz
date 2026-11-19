import test from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../public/src/components/ai-agent/core/turn-runner.js";
import { installFakeChat } from "./helpers/fake-chat.js";

function makeDeps(over = {}) {
  const log = [];
  const cards = [];
  const deps = {
    history: [{ role: "user", content: "hi" }],
    signal: new AbortController().signal,
    sessionExecutedTools: new Set(),
    pendingUndoNotes: [],
    settings: { provider: "google", model: "m", hasOwnKey: false, systemPrompt: "sys", enableTools: true, toolNames: ["create_quiz"] },
    auth: { isAdminAuthenticated: () => false, getAdminToken: () => null, isJwtExpired: () => false, getUserToken: async () => "USER_TOKEN" },
    apiUrl: (p) => p,
    serializeWireMessage: (m) => ({ role: m.role, content: m.content }),
    onToolCall: async () => "✅ done",
    getAttachmentToolHandler: () => null,
    renderResultCard: () => null,
    renderCreatorCard: () => null,
    persist: async () => { log.push("persist"); },
    ui: {
      onThinking: (t) => log.push(`thinking:${t}`),
      onAssistantMessage: (t) => log.push(`assistant:${t}`),
      setStep: () => {},
      resetToolGroup: () => log.push("resetGroup"),
      addToolCard: (tc) => { const c = { id: tc.id, setUndo: (label) => (c.undoLabel = label), updateStatus: (s) => (c.status = s) }; cards.push(c); return c; },
      flushResultCards: (c) => log.push(`flush:${c.length}`),
      showError: (m) => log.push(`error:${m}`),
      finish: () => log.push("finish"),
    },
    ...over,
  };
  return { deps, log, cards };
}

test("a tool turn: card created, undo registered via ctx, final text shown, finish once", async () => {
  const fake = installFakeChat([
    { toolCalls: [{ name: "create_quiz", input: { title: "A" } }] },
    { text: "تم" },
  ]);
  try {
    const { deps, log, cards } = makeDeps({
      onToolCall: async (tc, ctx) => { ctx.registerUndo({ label: "UNDO-ME", run: () => {} }); return "✅ done"; },
    });
    const res = await runTurn(deps);
    assert.equal(res.success, true);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].undoLabel, "UNDO-ME");
    assert.equal(cards[0].status, "success");
    assert.ok(log.includes("assistant:تم"));
    assert.equal(log.filter((l) => l === "finish").length, 1);
    assert.equal(log.at(-1), "finish");
    assert.ok(log.indexOf("flush:0") < log.indexOf("finish"));
  } finally { fake.restore(); }
});

test("a successful undo queues a note for the next user message", async () => {
  const fake = installFakeChat([{ toolCalls: [{ name: "create_quiz", input: { title: "A" } }] }, { text: "ok" }]);
  try {
    const { deps, cards } = makeDeps({ onToolCall: async (tc, ctx) => { ctx.registerUndo({ label: "L", run: () => {} }); return "x"; } });
    // setUndo in the fake card stores only the label; call the real wrapped run through a custom card
    deps.ui.addToolCard = (tc) => { const c = { setUndo: (label, run) => (c.run = run), updateStatus() {} }; cards.push(c); return c; };
    await runTurn(deps);
    await cards[0].run();
    assert.deepEqual(deps.pendingUndoNotes, ["L"]);
  } finally { fake.restore(); }
});

test("without an own key the user token is sent; with one it is not", async () => {
  let fake = installFakeChat([{ text: "a" }]);
  try {
    await runTurn(makeDeps().deps);
    assert.equal(fake.requests[0].headers.Authorization, "Bearer USER_TOKEN");
  } finally { fake.restore(); }
  fake = installFakeChat([{ text: "a" }]);
  try {
    const { deps } = makeDeps();
    deps.settings = { ...deps.settings, hasOwnKey: true, ownKey: "K" };
    await runTurn(deps);
    assert.equal(fake.requests[0].headers.Authorization, undefined);
    assert.equal(fake.requests[0].body.ownKey, "K");
    assert.equal(fake.requests[0].body.useOwnKey, true);
  } finally { fake.restore(); }
});

test("page context is prepended to history[0] on the wire only", async () => {
  const fake = installFakeChat([{ text: "a" }]);
  try {
    const { deps } = makeDeps();
    deps.settings = { ...deps.settings, contextPrompt: () => "CTX", contextSummary: [{ title: "T", questionCount: 3 }] };
    await runTurn(deps);
    const sent = fake.requests[0].body.messages[0].content;
    assert.match(sent, /^CTX/);
    assert.match(sent, /- T \(3 سؤال/);
    assert.equal(deps.history[0].content, "hi");
  } finally { fake.restore(); }
});

test("a network failure shows the Arabic error and still finishes", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("down"); };
  const origErr = console.error; console.error = () => {};
  try {
    const { deps, log } = makeDeps();
    await runTurn(deps);
    assert.ok(log.some((l) => l.startsWith("error:تعذر الاتصال")));
    assert.equal(log.at(-1), "finish");
  } finally { globalThis.fetch = orig; console.error = origErr; }
});

test("a server error message from the loop is shown", async () => {
  const fake = installFakeChat([{ status: 429, body: { error: "limit" } }]);
  try {
    const { deps, log } = makeDeps();
    await runTurn(deps);
    assert.ok(log.includes("error:limit"));
  } finally { fake.restore(); }
});

test("abort: no error bubble, result cards flushed, finish called", async () => {
  const controller = new AbortController();
  const fake = installFakeChat([{ toolCalls: [{ name: "create_quiz", input: { title: "A" } }] }]);
  try {
    const { deps, log } = makeDeps({ signal: controller.signal, onToolCall: async () => { controller.abort(); return "x"; } });
    const res = await runTurn(deps);
    assert.equal(res.aborted, true);
    assert.ok(!log.some((l) => l.startsWith("error:")));
    assert.ok(log.includes("flush:0"));
    assert.equal(log.at(-1), "finish");
  } finally { fake.restore(); }
});

test("a missing tool handler becomes a tool error, not a crash", async () => {
  const fake = installFakeChat([{ toolCalls: [{ name: "create_quiz", input: { title: "A" } }] }, { text: "ok" }]);
  try {
    const { deps, cards } = makeDeps({ onToolCall: null });
    const res = await runTurn(deps);
    assert.equal(res.success, true);
    assert.equal(cards[0].status, "error");
  } finally { fake.restore(); }
});

test("result cards produced by tools are flushed once, before finish", async () => {
  const fake = installFakeChat([{ toolCalls: [{ name: "create_quiz", input: { title: "A" } }] }, { text: "ok" }]);
  try {
    const { deps, log } = makeDeps({ renderResultCard: () => ({ el: 1 }) });
    await runTurn(deps);
    assert.ok(log.includes("flush:1"));
    assert.ok(log.indexOf("flush:1") < log.indexOf("finish"));
  } finally { fake.restore(); }
});

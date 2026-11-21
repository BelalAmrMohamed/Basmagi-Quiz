import test from "node:test";
import assert from "node:assert/strict";
import { resolvePanelOptions, createUnsupportedToolError } from "../public/src/components/ai-agent/ai-agent-panel-options.js";
import { runAgentLoop } from "../public/src/components/ai-agent/core/agent-loop.js";
import { HOME_TOOL_NAMES } from "../public/src/components/ai-agent/ai-agent-page-tools.js";
import { installFakeChat, apiUrl } from "./helpers/fake-chat.js";

// Mimics ai-agent.js: one cached panel per pageKey, built from the first opener,
// refreshed by later page (non-launcher) opens.
function makePanelCache() {
  const panels = new Map();
  return {
    open(options) {
      const key = options.pageKey;
      let panel = panels.get(key);
      const next = resolvePanelOptions(!!panel, options);
      if (!panel) { panel = { ...options }; panels.set(key, panel); }
      else if (next) Object.assign(panel, next);
      return panel;
    },
  };
}

const launcherOptions = () => ({
  pageKey: "home", launcher: true, suggestedPrompts: ["s"], toolNames: ["fetch_attached_quiz"],
  onToolCall: async (tc) => { throw createUnsupportedToolError(tc.name); },
});
const homeOptions = () => ({
  pageKey: "home", suggestedPrompts: ["a", "b"], toolNames: HOME_TOOL_NAMES,
  onToolCall: async (tc) => `ok:${tc.name}`,
});

for (const tool of ["create_quiz", "create_lesson", "create_notebook"]) {
  test(`launcher-first panel still runs ${tool} (no attachment chat)`, async () => {
    const cache = makePanelCache();
    cache.open(launcherOptions()); // e.g. YouTube card "Ask AI" opened first
    const panel = cache.open(homeOptions()); // then the user opens the main agent
    assert.equal(await panel.onToolCall({ name: tool, input: {} }), `ok:${tool}`);
    assert.deepEqual(panel.suggestedPrompts, ["a", "b"]);
    assert.ok(panel.toolNames.includes(tool));
  });
}

test("a launcher never downgrades an existing page panel", async () => {
  const cache = makePanelCache();
  cache.open(homeOptions());
  const panel = cache.open(launcherOptions());
  assert.equal(await panel.onToolCall({ name: "create_quiz", input: {} }), "ok:create_quiz");
});

test("YouTube attachment: home panel keeps tools; lesson fetch tool is offered", () => {
  assert.ok(HOME_TOOL_NAMES.includes("fetch_attached_lesson"));
  assert.ok(HOME_TOOL_NAMES.includes("add_youtube"));
});

test("unsupported-tool error is non-retryable and the loop does not auto-correct it", async () => {
  const fake = installFakeChat([{ toolCalls: [{ name: "create_quiz", input: { t: 1 } }] }, { text: "done" }]);
  try {
    const statuses = [];
    const history = [{ role: "user", content: "hi" }];
    await runAgentLoop({
      history, systemPrompt: "s", provider: "google", signal: new AbortController().signal, apiUrl,
      onToolCallStart: () => ({ updateStatus: (s, i) => statuses.push([s, i]) }),
      executeToolCall: async () => { throw createUnsupportedToolError("create_quiz"); },
    });
    const err = statuses.find(([s]) => s === "error")[1];
    assert.equal(err.retrying, false);
    const tool = history.find((m) => m.role === "tool");
    assert.match(tool.content, /لا تعد المحاولة/);
  } finally { fake.restore(); }
});

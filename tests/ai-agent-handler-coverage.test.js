import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOME_TOOL_NAMES } from "../public/src/components/ai-agent/ai-agent-page-tools.js";
import { ATTACHMENT_TOOLS } from "../public/src/components/ai-agent/core/turn-runner.js";
import { createItemCardResult, platformItemCardModelSummary } from "../public/src/components/ai-agent/ai-agent-result-cards.js";

// A tool the page offers (and the server therefore sends to the model) must have a client
// handler, or the model calls it and the user sees a failure (the B1 class of bug).
const src = readFileSync(new URL("../public/src/features/home/user-content-view.js", import.meta.url), "utf8");

test("every home tool is handled by user-content-view.js or by the attachment path", () => {
  const missing = HOME_TOOL_NAMES.filter((name) => !ATTACHMENT_TOOLS.includes(name) && !src.includes(`case "${name}":`));
  assert.deepEqual(missing, []);
});

test("an already-saved YouTube item gets a card the model is told about", () => {
  const card = createItemCardResult({ kind: "youtube_video", id: "x", title: "V", existing: true });
  assert.match(platformItemCardModelSummary(card), /موجود بالفعل/);
});

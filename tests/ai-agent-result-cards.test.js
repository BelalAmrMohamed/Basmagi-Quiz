import test from "node:test";
import assert from "node:assert/strict";
import { createItemCardResult, platformItemCardModelSummary } from "../public/src/components/ai-agent/ai-agent-result-cards.js";

test("model summary covers notebooks and YouTube items", () => {
  assert.match(platformItemCardModelSummary(createItemCardResult({ kind: "notebook", title: "C++" })), /الدفتر «C\+\+»/);
  assert.match(platformItemCardModelSummary(createItemCardResult({ kind: "youtube_video", title: "V" })), /الفيديو «V»/);
  assert.match(platformItemCardModelSummary(createItemCardResult({ kind: "youtube_playlist", title: "P" })), /قائمة التشغيل «P»/);
});

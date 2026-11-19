import test from "node:test";
import assert from "node:assert/strict";
import { MAX_TOOL_LOOPS, TOOL_LOOP_TIME_BUDGET_MS, toolLoopPhase } from "../api/ai-agent/_botLoop.js";

test("the ceiling is higher than the old fixed 5 and the budget leaves room under 60 s", () => {
  assert.ok(MAX_TOOL_LOOPS > 5);
  assert.ok(TOOL_LOOP_TIME_BUDGET_MS < 60_000);
});

test("rounds continue while within budget and under the ceiling", () => {
  const startedAt = 1_000_000;
  for (let loop = 0; loop < MAX_TOOL_LOOPS - 1; loop++) {
    assert.equal(toolLoopPhase({ loop, startedAt, now: startedAt + 10_000 }), "continue");
  }
});

test("the last allowed round is a wrap-up", () => {
  assert.equal(toolLoopPhase({ loop: MAX_TOOL_LOOPS - 1, startedAt: 0, now: 1 }), "wrapup");
});

test("after the time budget the next round is a wrap-up", () => {
  const startedAt = 5_000;
  assert.equal(toolLoopPhase({ loop: 2, startedAt, now: startedAt + TOOL_LOOP_TIME_BUDGET_MS - 1 }), "continue");
  assert.equal(toolLoopPhase({ loop: 2, startedAt, now: startedAt + TOOL_LOOP_TIME_BUDGET_MS }), "wrapup");
});

test("the very first round never wraps up on time alone", () => {
  assert.equal(toolLoopPhase({ loop: 0, startedAt: 0, now: 10 * TOOL_LOOP_TIME_BUDGET_MS }), "continue");
});

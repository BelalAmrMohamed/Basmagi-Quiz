import test from "node:test";
import assert from "node:assert/strict";
import { buildNotebookContext, runNotebookTool, NOTEBOOK_AGENT_TOOLS } from "../public/src/features/notebook/notebook-agent-tools.js";
import { NOTEBOOK_PAGE_SYSTEM_PROMPT } from "../public/src/components/ai-agent/ai-agent-default-prompts.js";
import { NOTEBOOK_PAGE_SUGGESTED_PROMPTS } from "../public/src/components/ai-agent/ai-agent-suggested-prompts.js";
import { getPageActions } from "../public/src/components/ai-agent/ai-agent-actions.js";
import * as tools from "../api/ai-agent/_tools.js";

function fakeHandle(cells) {
  const h = {
    cells,
    getCells: () => h.cells.map((c, i) => ({ id: `cell-${i}`, ...c })),
    setCells: (next) => { h.cells = next; },
    describe: () => h.cells.map((c, i) => ({ n: i + 1, type: c.type, source: c.source, output: i === 0 ? "ans = 5\n" : "", ran: i === 0, failed: false, ...(c.challenge ? { challenge: { expectedOutput: c.challenge.expectedOutput, matchMode: "trimmed", status: "fail" } } : {}) })),
    runCellAt: async (n) => (h.cells[n - 1]?.type === "code" ? { n, output: "5\n", failed: false, challenge: { status: "pass" } } : null),
  };
  return h;
}
const call = (name, input, handle, runtime = "matlab") => runNotebookTool({ name, input }, { handle, runtime });

test("every agent tool has a server schema and the page has prompts and slash commands", () => {
  for (const n of NOTEBOOK_AGENT_TOOLS) assert.ok(Object.values(tools).some((t) => t?.name === n), n);
  assert.ok(NOTEBOOK_PAGE_SYSTEM_PROMPT.includes("notebook_edit_cell") && NOTEBOOK_PAGE_SUGGESTED_PROMPTS.length >= 3);
  const cmds = getPageActions("notebook").map((a) => a.command);
  for (const c of ["add-cell", "edit-cell", "delete-cell", "fix-error", "add-challenge"]) assert.ok(cmds.includes(c), c);
});

test("context lists numbered cells with outputs and challenge status, and respects the cap", () => {
  const ctx = buildNotebookContext({ title: "T", runtime: "matlab", language: "ar", cells: fakeHandle([{ type: "code", source: "x=5" }, { type: "code", source: "disp(1)", challenge: { expectedOutput: "1" } }]).describe() });
  assert.match(ctx, /Cell 1 \[code\]/); assert.match(ctx, /Cell 2 \[code · CHALLENGE\]/); assert.match(ctx, /ans = 5/); assert.match(ctx, /Status: fail/);
  const big = Array.from({ length: 60 }, (_, i) => ({ n: i + 1, type: "markdown", source: "x".repeat(1400), output: "", failed: false }));
  const capped = buildNotebookContext({ title: "T", runtime: "cpp", language: "en", cells: big });
  assert.ok(capped.length < 16000 && /omitted/.test(capped));
});

test("add / edit / delete / run work through the handle", async () => {
  const h = fakeHandle([{ type: "markdown", source: "# Hi" }, { type: "code", source: "x=1" }]);
  await call("notebook_add_cell", { type: "code", source: "y=2", position: 2 }, h);
  assert.deepEqual(h.cells.map((c) => c.source), ["# Hi", "y=2", "x=1"]);
  await call("notebook_add_cell", { type: "markdown", source: "end" }, h);
  assert.equal(h.cells.at(-1).source, "end");
  await call("notebook_edit_cell", { cell: 3, source: "x=10" }, h);
  assert.equal(h.cells[2].source, "x=10");
  await call("notebook_delete_cell", { cell: 4 }, h);
  assert.equal(h.cells.length, 3);
  assert.match(await call("notebook_run_cell", { cell: 2 }, h), /الناتج:\n5/);
  await assert.rejects(call("notebook_run_cell", { cell: 1 }, h), /ليست خلية كود/);
});

test("challenges: add, normalize, edit, remove; invalid input is rejected without touching the notebook", async () => {
  const h = fakeHandle([{ type: "code", source: "x" }]);
  await call("notebook_add_cell", { type: "code", source: "% TODO", challenge: { expectedOutput: "3", hint: " h ", bogus: 1 } }, h);
  assert.deepEqual(h.cells[1].challenge, { expectedOutput: "3", hint: "h" });
  await call("notebook_edit_cell", { cell: 2, challenge: { expectedOutput: "3.14", matchMode: "numeric", tolerance: 0.01 } }, h);
  assert.equal(h.cells[1].challenge.matchMode, "numeric");
  await call("notebook_edit_cell", { cell: 2, removeChallenge: true }, h);
  assert.equal(h.cells[1].challenge, undefined);
  const before = JSON.stringify(h.cells);
  await assert.rejects(call("notebook_add_cell", { type: "code", source: "a", challenge: { expectedOutput: "(", matchMode: "regex" } }, h));
  await assert.rejects(call("notebook_add_cell", { type: "markdown", source: "a", challenge: { expectedOutput: "1" } }, h), /الكود فقط/);
  await assert.rejects(call("notebook_edit_cell", { cell: 9, source: "z" }, h), /رقم الخلية/);
  assert.equal(JSON.stringify(h.cells), before);
  await call("notebook_add_cell", { type: "code", source: "a", challenge: { expectedOutput: "1", testStdin: "1" } }, h, "matlab");
  assert.equal(h.cells.at(-1).challenge.testStdin, undefined, "stdin is C++ only and dropped for MATLAB");
  await call("notebook_add_cell", { type: "code", source: "cin", challenge: { expectedOutput: "7", testStdin: "3 4" } }, fakeHandle([{ type: "code", source: "a" }]), "cpp");
});

test("the last remaining cell cannot be deleted", async () => {
  await assert.rejects(call("notebook_delete_cell", { cell: 1 }, fakeHandle([{ type: "code", source: "a" }])), /الوحيدة/);
});

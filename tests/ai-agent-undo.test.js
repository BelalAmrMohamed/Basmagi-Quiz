import "./helpers/dom-stub.js";
import { storage } from "./helpers/dom-stub.js";
import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint, isUnchangedSince, createToolContext, prependUndoNotes } from "../public/src/components/ai-agent/core/undo.js";
import { createToolCallCard } from "../public/src/components/ai-agent/components/tool-call-card.js";
import { moveToTrash, restoreTrashBatch, hasTrashBatch } from "../public/src/features/home/user-content-trash.js";

const undoButton = (card) => card.children[0].children[2].children[1]; // header > meta > [timer, undo, toggle]

test("fingerprint / isUnchangedSince detect later edits", () => {
  const item = { id: "1", questions: [1, 2] };
  const fp = fingerprint(item);
  assert.ok(isUnchangedSince({ id: "1", questions: [1, 2] }, fp));
  assert.ok(!isUnchangedSince({ id: "1", questions: [1, 2, 3] }, fp));
});

test("createToolContext: registerUndo reaches the card; onUndone only after a real success", async () => {
  const calls = [];
  const card = { setUndo: (label, run, isStale) => calls.push({ label, run, isStale }) };
  const undone = [];
  const ctx = createToolContext(card, (l) => undone.push(l));
  ctx.registerUndo({ label: "L", run: async () => {}, isStale: () => true });
  assert.equal(calls[0].label, "L");
  assert.equal(calls[0].isStale(), true);
  assert.deepEqual(await calls[0].run(), { ok: true });
  assert.deepEqual(undone, ["L"]);

  ctx.registerUndo({ label: "F", run: () => ({ ok: false, reason: "no" }) });
  assert.deepEqual(await calls[1].run(), { ok: false, reason: "no" });
  assert.deepEqual(undone, ["L"]);
});

test("createToolContext tolerates a missing card or run", () => {
  assert.doesNotThrow(() => createToolContext(null).registerUndo({ label: "x", run() {} }));
  assert.doesNotThrow(() => createToolContext({ setUndo() {} }).registerUndo({ label: "x" }));
});

test("prependUndoNotes", () => {
  assert.equal(prependUndoNotes("hi", []), "hi");
  const out = prependUndoNotes("hi", ["A", "B"]);
  assert.match(out, /A/);
  assert.match(out, /B/);
  assert.ok(out.endsWith("hi"));
});

test("card: the undo button appears on success only and reverts once", async () => {
  const card = createToolCallCard({ id: "c", name: "delete_quiz", input: { title: "T" }, status: "running" });
  let runs = 0;
  card.setUndo("استعادة", async () => { runs++; }, () => false);
  const btn = undoButton(card);
  assert.equal(btn.hidden, true, "hidden while running");
  card.updateStatus("success", { result: "ok" });
  assert.equal(btn.hidden, false);
  assert.equal(btn.disabled, false);
  await btn.click();
  assert.equal(runs, 1);
  assert.equal(btn.hidden, true);
  assert.equal(card.dataset.reverted, "true");
  await btn.click();
  assert.equal(runs, 1, "second click does nothing");
});

test("card: a stale item disables the button with an explanation", async () => {
  const card = createToolCallCard({ id: "c", name: "edit_quiz", input: {}, status: "running" });
  let stale = true;
  let runs = 0;
  card.setUndo("x", async () => { runs++; }, () => stale);
  card.updateStatus("success", {});
  const btn = undoButton(card);
  assert.equal(btn.disabled, true);
  assert.match(btn.title, /تم تعديل/);
  await btn.click();
  assert.equal(runs, 0);
  stale = false;
  for (const fn of card.listeners.mouseenter) fn(); // re-evaluated on hover
  assert.equal(btn.disabled, false);
});

test("card: a failed undo keeps the button and shows the reason", async () => {
  const card = createToolCallCard({ id: "c", name: "edit_quiz", input: {}, status: "running" });
  card.setUndo("x", () => ({ ok: false, reason: "لم يعد موجوداً" }), () => false);
  card.updateStatus("success", {});
  const btn = undoButton(card);
  await btn.click();
  assert.equal(btn.hidden, false);
  assert.equal(btn.disabled, false);
  assert.equal(btn.title, "لم يعد موجوداً");
  assert.notEqual(card.dataset.reverted, "true");
});

test("card: an errored or aborted call has no undo button", () => {
  const card = createToolCallCard({ id: "c", name: "edit_quiz", input: {}, status: "running" });
  card.setUndo("x", async () => {}, () => false);
  card.updateStatus("error", { error: "boom" });
  assert.equal(undoButton(card).hidden, true);
});

test("trash round trip: delete -> hasTrashBatch -> restore puts the quiz back exactly once", () => {
  storage.clear();
  const quiz = { id: "q1", meta: { id: "q1", title: "امتحان 1", parentId: null }, questions: [{ q: "?" }] };
  localStorage.setItem("user_quizzes", JSON.stringify([quiz]));

  // what handleDeleteQuizToolCall does
  const batchId = moveToTrash([quiz], quiz.meta.title);
  localStorage.setItem("user_quizzes", JSON.stringify([]));
  assert.ok(hasTrashBatch(batchId));

  const res = restoreTrashBatch(batchId);
  assert.equal(res.ok, true);
  const restored = JSON.parse(localStorage.getItem("user_quizzes"));
  assert.equal(restored.length, 1);
  assert.equal(restored[0].meta.title, "امتحان 1");
  assert.equal(restored[0].questions.length, 1);
  assert.ok(!hasTrashBatch(batchId));
  assert.equal(restoreTrashBatch(batchId).ok, false, "cannot restore twice");
});

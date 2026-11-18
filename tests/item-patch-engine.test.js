import test from "node:test";
import assert from "node:assert/strict";
import { applyDraftPatch, replaceTextDeep } from "../public/src/components/ai-agent/core/item-patch-engine.js";

test("item-patch-engine: replaceTextDeep modifies strings recursively and detects absence", () => {
  const obj = {
    title: "Old Title",
    nested: {
      description: "This has Old text in it",
      count: 42,
      list: ["Old one", "Keep this"],
    },
  };
  const c1 = { n: 0 };
  const updated = replaceTextDeep(obj, "Old", "New", c1);
  assert.equal(c1.n, 3);
  assert.equal(updated.title, "New Title");
  assert.equal(updated.nested.description, "This has New text in it");
  assert.equal(updated.nested.list[0], "New one");
  assert.equal(updated.nested.list[1], "Keep this");

  const c2 = { n: 0 };
  replaceTextDeep(obj, "NonExistent", "Something", c2);
  assert.equal(c2.n, 0);
});

test("item-patch-engine: quiz patching applies metadata updates and question ops", () => {
  const quiz = {
    title: "Original Quiz",
    description: "Initial description",
    questions: [
      { q: "Q1", options: ["A", "B"], correct: 0 },
      { q: "Q2", options: ["C", "D"], correct: 1 },
    ],
  };

  const patch = {
    meta: { title: "Updated Quiz", description: "Updated description" },
    ops: [
      { op: "set_question", at: 1, question: { q: "Q1 Modified", options: ["A1", "B1"], correct: 1 } },
      { op: "append_questions", questions: [{ q: "Q3", options: ["E", "F"], correct: 0 }] },
      { op: "delete_question", at: 2 },
    ],
  };

  const res = applyDraftPatch("quiz", quiz, patch);
  assert.ok(!res.error, res.error);
  assert.equal(res.data.title, "Updated Quiz");
  assert.equal(res.data.description, "Updated description");
  assert.equal(res.data.questions.length, 2);
  assert.equal(res.data.questions[0].q, "Q1 Modified");
  assert.equal(res.data.questions[1].q, "Q3");
});

test("item-patch-engine: notebook patching supports cell insertion, modification, and deletion", () => {
  const notebook = {
    title: "Lab Notebook",
    cells: [
      { type: "markdown", source: "# Introduction" },
      { type: "code", source: "print('hello')", language: "python" },
    ],
  };

  const patch = {
    ops: [
      { op: "insert_cell", at: 2, cell: { type: "code", source: "x = 10", language: "python" } },
      { op: "set_cell", at: 1, cell: { type: "markdown", source: "# Updated Intro" } },
      { op: "append_cells", cells: [{ type: "markdown", source: "## Summary" }] },
    ],
  };

  const res = applyDraftPatch("notebook", notebook, patch);
  assert.ok(!res.error, res.error);
  assert.equal(res.data.cells.length, 4);
  assert.equal(res.data.cells[0].source, "# Updated Intro");
  assert.equal(res.data.cells[1].source, "x = 10");
  assert.equal(res.data.cells[2].source, "print('hello')");
  assert.equal(res.data.cells[3].source, "## Summary");
});

test("item-patch-engine: lesson patching supports section and block operations", () => {
  const lesson = {
    title: "Physics Lesson",
    sections: [
      {
        title: "Section 1",
        blocks: [
          { type: "markdown", body: "Newton's Laws" },
        ],
      },
    ],
  };

  const patch = {
    ops: [
      { op: "append_blocks", section: 1, blocks: [{ type: "markdown", body: "First law details" }] },
      { op: "append_sections", sections: [{ title: "Section 2", blocks: [] }] },
    ],
  };

  const res = applyDraftPatch("lesson", lesson, patch);
  assert.ok(!res.error, res.error);
  assert.equal(res.data.sections.length, 2);
  assert.equal(res.data.sections[0].blocks.length, 2);
  assert.equal(res.data.sections[0].blocks[1].body, "First law details");
  assert.equal(res.data.sections[1].title, "Section 2");
});

test("item-patch-engine: invalid operation returns clear error object", () => {
  const quiz = { title: "Quiz", questions: [] };
  const res = applyDraftPatch("quiz", quiz, {
    ops: [{ op: "unknown_operation_xyz" }],
  });
  assert.ok(res.error);
  assert.match(res.error, /عملية غير معروفة/);
});

test("item-patch-engine: replace_text op succeeds when text exists and fails when text missing", () => {
  const quiz = {
    title: "Arabic Quiz",
    questions: [{ q: "سؤال تجريبي", options: ["أ", "ب"], correct: 0 }],
  };

  const success = applyDraftPatch("quiz", quiz, {
    ops: [{ op: "replace_text", find: "تجريبي", replace: "نهائي" }],
  });
  assert.ok(!success.error, success.error);
  assert.equal(success.data.questions[0].q, "سؤال نهائي");

  const fail = applyDraftPatch("quiz", quiz, {
    ops: [{ op: "replace_text", find: "كلمة غير موجودة", replace: "شيء" }],
  });
  assert.ok(fail.error);
  assert.match(fail.error, /غير موجود/);
});

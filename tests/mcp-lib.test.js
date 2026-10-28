import test from "node:test";
import assert from "node:assert/strict";
import { validateQuiz, validateLesson, makeDraftCode, DRAFT_CODE_RE, draftUrl, AUTHORING_GUIDE, CREATOR_INFO } from "../supabase/functions/mcp/lib.ts";

const mcq = { q: "2+2؟", options: ["3", "4"], correct: 1, explanation: "لأن 2+2=4" };

test("quiz: valid MCQ + essay passes; essay gets NO fake options", () => {
  const v = validateQuiz({ title: "t", description: "d", questions: [mcq, { q: "اشرح", answer: "نموذج" }] });
  assert.equal(v.ok, true);
  assert.equal(v.data.questions[1].options, undefined);
  assert.equal(v.data.questions[1].answer, "نموذج");
  assert.deepEqual(v.data.questions[0].correct, [1]);
  assert.equal(v.stats.essay, 1);
});

test("quiz: missing / out-of-range correct is an error, never guessed", () => {
  const a = validateQuiz({ title: "t", questions: [{ q: "x", options: ["a", "b"], explanation: "e" }] });
  assert.equal(a.ok, false);
  assert.match(a.errors[0], /السؤال 1.*correct/);
  const b = validateQuiz({ title: "t", questions: [{ q: "x", options: ["a", "b"], correct: 5 }] });
  assert.equal(b.ok, false);
  assert.match(b.errors.join(), /خارج النطاق/);
});

test("quiz: multi-select inferred, source must be a URL, warnings reported", () => {
  const v = validateQuiz({ title: "t", source: "lecture 3", questions: [{ q: "x", options: ["a", "b", "c"], correct: [0, 2] }] });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /source/);
  const w = validateQuiz({ title: "t", source: "https://x.y/z", questions: [{ q: "x", options: ["a", "b", "c"], correct: [0, 2] }] });
  assert.equal(w.ok, true);
  assert.equal(w.data.questions[0].multiSelect, true);
  assert.ok(w.warnings.some((x) => /explanation/.test(x)));
});

test("quiz: empty / oversize title rejected, duplicates warned", () => {
  assert.equal(validateQuiz({ title: "", questions: [mcq] }).ok, false);
  assert.equal(validateQuiz({ title: "x".repeat(101), questions: [mcq] }).ok, false);
  assert.ok(validateQuiz({ title: "t", description: "d", questions: [mcq, mcq] }).warnings.some((w) => /مكرر/.test(w)));
});

test("lesson: valid lesson with all block kinds", () => {
  const v = validateLesson({
    title: "درس", description: "d", source: "",
    sections: [{ title: "s1", blocks: [
      { type: "markdown", body: "# hi" },
      { type: "media", kind: "image", url: "https://a.b/c.png" },
      { type: "question", questionKind: "mcq", prompt: "p", options: ["a", "b"], correctIndex: 1, explanation: "e" },
      { type: "question", questionKind: "essay", prompt: "p2", modelAnswer: "m" },
      { type: "quizRef", quizId: "abc12345" },
    ] }],
  });
  assert.equal(v.ok, true, v.errors.join("\n"));
  assert.equal(v.stats.questions, 2);
  assert.equal(v.data.sections[0].blocks[2].correctIndex, 1);
});

test("lesson: bad blocks produce located errors", () => {
  const v = validateLesson({ title: "t", sections: [{ title: "s", blocks: [
    { type: "question", prompt: "p", options: ["a", "b"] },
    { type: "nope" },
    { type: "media" },
  ] }] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /القسم 1 \/ العنصر 1.*correctIndex/.test(e)));
  assert.ok(v.errors.some((e) => /type="nope"/.test(e)));
  assert.ok(v.errors.some((e) => /العنصر 3.*url/.test(e)));
});

test("lesson: legacy shapes (content string, correct) still accepted", () => {
  const v = validateLesson({ title: "t", sections: [{ title: "s", content: "text" }] });
  assert.equal(v.ok, true);
  assert.equal(v.data.sections[0].blocks[0].body, "text");
});

test("draft codes: unguessable format, URL shape", () => {
  const codes = new Set(Array.from({ length: 500 }, () => makeDraftCode()));
  assert.equal(codes.size, 500);
  for (const c of codes) assert.match(c, DRAFT_CODE_RE);
  assert.match(draftUrl("quiz", "abcdefghjk"), /^https:\/\/basmagi-quiz\.vercel\.app\/create-quiz\?draft=abcdefghjk$/);
  assert.ok(draftUrl("lesson", "abcdefghjk").length < 80); // vs. thousands of chars for base64
});

test("static content exposes the expected sections", () => {
  assert.deepEqual(Object.keys(AUTHORING_GUIDE).sort(), ["lesson", "markdown", "quiz", "workflow"]);
  assert.deepEqual(Object.keys(CREATOR_INFO).sort(), ["contact", "links", "pages", "platform", "profile"]);
  assert.match(CREATOR_INFO.contact, /belalamrofficial@gmail\.com/);
});

import { applyDraftPatch, outlineQuiz, outlineLesson, quizToDraftInput, lessonToDraftInput } from "../supabase/functions/mcp/lib.ts";

const baseQuiz = () => validateQuiz({ title: "t", description: "d", questions: [
  { q: "one", options: ["a", "b"], correct: 0, explanation: "e" },
  { q: "two", options: ["a", "b"], correct: 1, explanation: "e" },
  { q: "three", answer: "m", explanation: "e" },
] }).data;

test("patch quiz: set/insert/delete/move/append/meta are 1-based and atomic-validated", () => {
  let r = applyDraftPatch("quiz", baseQuiz(), { meta: { title: "new" }, ops: [
    { op: "set_question", at: 2, question: { q: "TWO", options: ["x", "y", "z"], correct: 2, explanation: "e" } },
    { op: "insert_question", at: 1, question: { q: "zero", answer: "a", explanation: "e" } },
    { op: "delete_question", at: 4 },
    { op: "move_question", at: 3, to: 1 },
    { op: "append_questions", questions: [{ q: "last", answer: "a", explanation: "e" }] },
  ] });
  assert.ok(!r.error, r.error);
  assert.equal(r.data.meta.title, "new");
  assert.deepEqual(r.data.questions.map((q) => q.q), ["TWO", "zero", "one", "last"]);
  const v = validateQuiz({ ...r.data.meta, questions: r.data.questions });
  assert.equal(v.ok, true, v.errors.join());
});

test("patch quiz: bad index / unknown op / empty patch give clear errors; input not mutated", () => {
  const d = baseQuiz(); const snap = JSON.stringify(d);
  assert.match(applyDraftPatch("quiz", d, { ops: [{ op: "delete_question", at: 9 }] }).error, /العملية 1.*خارج النطاق/);
  assert.match(applyDraftPatch("quiz", d, { ops: [{ op: "fly" }] }).error, /غير معروفة/);
  assert.match(applyDraftPatch("quiz", d, {}).error, /فارغ/);
  assert.equal(JSON.stringify(d), snap);
});

test("patch quiz: set_question that breaks validation is caught by re-validation", () => {
  const r = applyDraftPatch("quiz", baseQuiz(), { ops: [{ op: "set_question", at: 1, question: { q: "x", options: ["a", "b"], correct: 7 } }] });
  const v = validateQuiz({ ...r.data.meta, questions: r.data.questions });
  assert.equal(v.ok, false);
});

test("patch: replace_text hits every string and errors when absent", () => {
  const r = applyDraftPatch("quiz", baseQuiz(), { ops: [{ op: "replace_text", find: "two", replace: "اثنان" }] });
  assert.equal(r.data.questions[1].q, "اثنان");
  assert.match(applyDraftPatch("quiz", baseQuiz(), { ops: [{ op: "replace_text", find: "zzz", replace: "" }] }).error, /غير موجود/);
});

test("patch lesson: sections and blocks ops + outline numbering", () => {
  const lesson = validateLesson({ title: "L", description: "d", sections: [
    { title: "A", blocks: [{ type: "markdown", body: "a1" }, { type: "markdown", body: "a2" }] },
    { title: "B", blocks: [{ type: "markdown", body: "b1" }] },
  ] }).data;
  const r = applyDraftPatch("lesson", lesson, { meta: { description: "dd" }, ops: [
    { op: "insert_block", section: 1, at: 2, block: { type: "question", questionKind: "essay", prompt: "p", modelAnswer: "m" } },
    { op: "delete_block", section: 1, at: 1 },
    { op: "append_blocks", section: 2, blocks: [{ type: "markdown", body: "b2" }] },
    { op: "move_section", at: 2, to: 1 },
    { op: "append_sections", sections: [{ title: "C", blocks: [] }] },
  ] });
  assert.ok(!r.error, r.error);
  assert.equal(r.data.description, "dd");
  assert.deepEqual(r.data.sections.map((s) => s.title), ["B", "A", "C"]);
  assert.equal(validateLesson(r.data).ok, true);
  assert.match(outlineLesson(r.data), /2\.1 \[question\] essay: p/);
});

test("outline + clone helpers", () => {
  assert.match(outlineQuiz(baseQuiz()), /3\. \[essay\] three/);
  const clone = quizToDraftInput({ meta: { id: "X", path: "p", author_id: "a", title: "T", source: "not a url" }, questions: [{ q: "q", options: ["a", "b"], correct: 1 }] });
  assert.equal(clone.source, "");
  assert.equal(validateQuiz(clone).ok, true);
  const l = lessonToDraftInput({ title: "T", description: "d", source: "https://a.b", content: { sections: [{ title: "s", blocks: [{ type: "markdown", body: "x" }] }] } });
  assert.equal(validateLesson(l).ok, true);
});

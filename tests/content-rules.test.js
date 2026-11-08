import test from "node:test";
import assert from "node:assert/strict";
import { checkQuiz, checkLesson, cleanSource, LEGACY_AI_SOURCE } from "../public/src/shared/content-rules.js";
import { validateQuiz, validateLesson } from "../supabase/functions/mcp/lib.ts";
import { validateQuizPayload, computeStats } from "../api/_validateQuiz.js";
import { validateLessonContent } from "../api/_validateLesson.js";

const mcq = { q: "2+2؟", options: ["3", "4"], correct: 1, explanation: "e" };
const uploadQuiz = (meta, questions) => ({
  meta: { id: "ABCDEFGH", ...meta },
  questions,
  stats: computeStats(questions),
});

// Each fixture must be rejected by the shared rules, the MCP wrapper and the upload API.
const quizBad = {
  "title too long": { title: "x".repeat(101), questions: [mcq] },
  "description too long": { title: "t", description: "d".repeat(501), questions: [mcq] },
  "source not a link": { title: "t", source: LEGACY_AI_SOURCE, questions: [mcq] },
  "essay without answer": { title: "t", questions: [{ q: "اشرح", explanation: "e" }] },
  "correct missing": { title: "t", questions: [{ q: "x", options: ["a", "b"], explanation: "e" }] },
  "correct out of range": { title: "t", questions: [{ q: "x", options: ["a", "b"], correct: 5 }] },
  "empty option": { title: "t", questions: [{ q: "x", options: ["a", ""], correct: 0 }] },
  "one option": { title: "t", questions: [{ q: "x", options: ["a"], correct: 0 }] },
};

for (const [name, input] of Object.entries(quizBad)) {
  test(`quiz parity (rejected everywhere): ${name}`, () => {
    assert.ok(checkQuiz(input).errors.length > 0, "shared");
    assert.equal(validateQuiz(input).ok, false, "mcp");
    // upload receives stored shape (no empty-string source; essay keeps answer)
    const questions = input.questions.map((q) => ({ ...q }));
    assert.throws(
      () => validateQuizPayload(uploadQuiz({ title: input.title, description: input.description, source: input.source }, questions)),
      undefined,
      "upload",
    );
  });
}

test("quiz parity: valid quiz passes everywhere; empty source is fine", () => {
  const input = { title: "t", description: "d", source: "", questions: [mcq, { q: "اشرح", answer: "نموذج", explanation: "e" }] };
  assert.equal(checkQuiz(input).errors.length, 0);
  assert.equal(validateQuiz(input).ok, true);
  assert.doesNotThrow(() => validateQuizPayload(uploadQuiz({ title: "t", description: "d", source: "" }, input.questions)));
});

test("quiz: plain-text math and T/F language mismatch are warnings, not errors", () => {
  const r = checkQuiz({
    title: "t",
    questions: [
      { q: "Solve x^2 = 4", options: ["2", "3"], correct: 0, explanation: "e" },
      { q: "Is the sky blue today?", options: ["صح", "خطأ"], correct: 0, explanation: "e" },
      { q: "حل $x^2=4$", options: ["2", "3"], correct: 0, explanation: "e" },
    ],
  });
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => w.code === "PLAIN_TEXT_MATH" && /1/.test(w.message) && !/3/.test(w.message.split("—")[0])));
  assert.ok(r.warnings.some((w) => w.code === "TF_LABEL_LANGUAGE"));
});

test("cleanSource drops the legacy sentence and non-links", () => {
  assert.equal(cleanSource(LEGACY_AI_SOURCE), "");
  assert.equal(cleanSource("lecture 3"), "");
  assert.equal(cleanSource(" https://a.b/c "), "https://a.b/c");
});

const lessonBad = {
  "too many blocks": { title: "t", sections: [{ title: "s", blocks: Array.from({ length: 41 }, () => ({ type: "markdown", body: "x" })) }] },
  "source not a link": { title: "t", source: "some note", sections: [{ title: "s", blocks: [{ type: "markdown", body: "x" }] }] },
  "essay without model answer": { title: "t", sections: [{ title: "s", blocks: [{ type: "question", questionKind: "essay", prompt: "p" }] }] },
  "lesson-reference not uuid": { title: "t", sections: [{ title: "s", blocks: [{ type: "lesson-reference", lessonId: "local-1" }] }] },
  "notebook-reference not uuid": { title: "t", sections: [{ title: "s", blocks: [{ type: "notebook-reference", notebookId: "nb-1" }] }] },
  "folder-reference missing id": { title: "t", sections: [{ title: "s", blocks: [{ type: "folder-reference" }] }] },
  "course-reference not uuid": { title: "t", sections: [{ title: "s", blocks: [{ type: "courseRef", courseId: "c" }] }] },
};

test("lesson: shared + MCP reject the same fixtures", () => {
  for (const [name, input] of Object.entries(lessonBad)) {
    assert.ok(checkLesson(input, { publish: true }).errors.length > 0, `shared: ${name}`);
    assert.equal(validateLesson(input).ok, false, `mcp: ${name}`);
  }
});

test("lesson upload rejects too many blocks / bad refs with the shared Arabic list", () => {
  const sec = (blocks) => ({ content: { sections: [{ id: "s1", title: "s", blocks }] } }).content;
  assert.throws(
    () => validateLessonContent(sec(Array.from({ length: 41 }, (_, i) => ({ type: "markdown", id: `b${i}`, body: "x" })))),
    /مشكلة/,
  );
  assert.throws(() => validateLessonContent(sec([{ type: "lesson-reference", lessonId: "local-1" }])), /UUID|lessonId/);
});

test("lesson: valid lesson passes shared + MCP", () => {
  const input = { title: "t", description: "d", sections: [{ title: "s", blocks: [{ type: "markdown", body: "نص $x^2$" }] }] };
  assert.equal(checkLesson(input, { publish: true }).errors.length, 0);
  assert.equal(validateLesson(input).ok, true);
});

const UUID_A = "11111111-1111-4111-8111-111111111111";

test("lesson: notebook/folder/course references (kebab + aliases) pass shared + MCP + upload validators", () => {
  const input = {
    title: "t", description: "d",
    sections: [{ title: "s", blocks: [
      { type: "notebook-reference", notebookId: UUID_A },
      { type: "folderRef", folderId: UUID_A },
      { type: "courseRef", courseId: UUID_A },
    ] }],
  };
  assert.equal(checkLesson(input, { publish: true }).errors.length, 0);
  assert.equal(validateLesson(input).ok, true);
  // MCP normalizes aliases to the kebab type.
  assert.deepEqual(validateLesson(input).data.sections[0].blocks.map((b) => b.type), ["notebook-reference", "folder-reference", "course-reference"]);
  const content = { sections: [{ id: "s1", title: "s", blocks: [
    { type: "notebook-reference", notebookId: UUID_A },
    { type: "folder-reference", folderId: UUID_A },
    { type: "course-reference", courseId: UUID_A },
  ] }] };
  assert.doesNotThrow(() => validateLessonContent(content));
  assert.throws(() => validateLessonContent({ sections: [{ id: "s1", title: "s", blocks: [{ type: "folder-reference", folderId: "x" }] }] }), /UUID/);
});

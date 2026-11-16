import test from "node:test";
import assert from "node:assert/strict";
import { parseComplete, gradeComplete, completeToPlain, completeToFirstAnswers } from "../public/src/shared/complete-question.js";

test("parses blanks and variants", () => {
  const p = parseComplete("The {{sun|star}} is {{hot}}.");
  assert.equal(p.blanks.length, 2);
  assert.deepEqual(p.blanks[0].answers, ["sun", "star"]);
  assert.equal(p.errors.length, 0);
  assert.equal(completeToPlain("The {{sun}} is"), "The _____ is");
  assert.equal(completeToFirstAnswers("A {{x|y}} b"), "A x b");
});

test("escapes, code and math are ignored", () => {
  const p = parseComplete("\\{{not}} `{{code}}` $x^{{2}}$ {{a\\|b}}");
  assert.equal(p.blanks.length, 1);
  assert.deepEqual(p.blanks[0].answers, ["a|b"]);
  assert.ok(p.marked.startsWith("{{not}}"));
});

test("reports syntax errors", () => {
  assert.equal(parseComplete("a {{b").errors[0].code, "COMPLETE_SYNTAX");
  assert.equal(parseComplete("a {{}}").errors[0].code, "COMPLETE_BLANK_EMPTY");
  assert.equal(parseComplete("a {{b|}}").errors[0].code, "COMPLETE_BLANK_EMPTY");
});

test("grades per blank with partial credit", () => {
  const { blanks } = parseComplete("{{cat|kitten}} and {{dog}} and {{bird}}");
  const g = gradeComplete(blanks, ["KITTEN", "dog", ""], false);
  assert.equal(g.correct, 2);
  assert.equal(g.total, 3);
  assert.equal(g.allCorrect, false);
  assert.ok(Math.abs(g.earned - 2 / 3) < 1e-9);
  assert.equal(g.perBlank[2].empty, true);
});

test("lenient ignores Arabic diacritics, alef forms and digits; strict does not", () => {
  const { blanks } = parseComplete("{{أحمد}} {{3}}");
  assert.equal(gradeComplete(blanks, ["احمد", "٣"], false).allCorrect, true);
  assert.equal(gradeComplete(blanks, ["احمد", "٣"], true).correct, 0);
  assert.equal(gradeComplete(parseComplete("{{Cat}}").blanks, ["cat"], true).allCorrect, false);
  assert.equal(gradeComplete(parseComplete("{{العِلم}}").blanks, ["العلم"], false).allCorrect, true);
});

import { degradeCompleteForExport } from "../public/src/shared/complete-question.js";
test("static exports degrade Complete to an open question with an answer key", () => {
  const { questions, userAnswers } = degradeCompleteForExport(
    [{ q: "A {{x|y}} B {{z}}", questionKind: "complete" }, { q: "m", options: ["1", "2"], correct: [0] }],
    [["x", ""], 0],
  );
  assert.equal(questions[0].q, "A _____ B _____");
  assert.equal(questions[0].answer, "1) x / y   2) z");
  assert.equal(questions[0].questionKind, undefined);
  assert.equal(userAnswers[0], "1) x  2) —");
  assert.equal(userAnswers[1], 0);
});

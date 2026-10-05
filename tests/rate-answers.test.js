import test from "node:test";
import assert from "node:assert/strict";

import { gradeEssay } from "../public/src/shared/rate-answers.js";

test("gradeEssay awards partial credit for a valid singular essay answer", () => {
  assert.equal(gradeEssay("assignment", "assignment (assignments)"), 3);
});

test("gradeEssay remains case- and punctuation-insensitive", () => {
  assert.equal(gradeEssay("The ASSIGNMENT!", "assignment"), 5);
});

test("gradeEssay gives no credit for a blank response", () => {
  assert.equal(gradeEssay("   ", "assignment"), 0);
});

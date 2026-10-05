import test from "node:test";
import assert from "node:assert/strict";

import { validatePath } from "../api/_validateQuiz.js";

test("validatePath accepts folder names with parentheses", () => {
  assert.doesNotThrow(() => {
    validatePath({
      name: "Unit 1 (From Doctor)",
      folderSegments: "Biology/Unit 1 (From Doctor)",
    });
  });
});

test("validatePath continues to reject traversal and disallowed characters", () => {
  assert.throws(
    () => validatePath({ name: "../private" }),
    /INVALID_PATH/,
  );
  assert.throws(
    () => validatePath({ name: 'Unit 1 "From Doctor"' }),
    /contains disallowed characters/,
  );
});

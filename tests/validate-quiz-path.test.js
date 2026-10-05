import test from "node:test";
import assert from "node:assert/strict";

import { validatePath } from "../api/_validateQuiz.js";

test("validatePath accepts international names and common punctuation", () => {
  assert.doesNotThrow(() => {
    validatePath({
      name: "Unit 1 | Study Guide & Exercises (By Ziad Ayman)",
      folderSegments: "Biology/Unit 1 | Study Guide & Exercises (By Ziad Ayman)",
    });
    validatePath({
      name: "Français – 日本語 – الأحياء",
    });
  });
});

test("validatePath continues to reject traversal and backslashes", () => {
  assert.throws(
    () => validatePath({ name: "../private" }),
    /INVALID_PATH/,
  );
  assert.throws(
    () => validatePath({ name: "..\\private" }),
    /contains disallowed characters/,
  );
});

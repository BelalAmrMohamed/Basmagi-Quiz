import test from "node:test";
import assert from "node:assert/strict";

import { validatePath, validateQuizPayload } from "../api/_validateQuiz.js";

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

test("validateQuizPayload accepts quizzes larger than the former 50 KB limit", () => {
  const question = "س".repeat(60_000);
  assert.doesNotThrow(() => validateQuizPayload({
    meta: { id: "AAAAAAAA", title: "Large quiz" },
    stats: { questionCount: 1, questionTypes: ["Essay"] },
    questions: [{ q: question }],
  }));
});

test("validateQuizPayload reports a clear error above the 1 MB limit", () => {
  const question = "س".repeat(1_000_000);
  assert.throws(
    () => validateQuizPayload({
      meta: { id: "AAAAAAAA", title: "Too large quiz" },
      stats: { questionCount: 1, questionTypes: ["Essay"] },
      questions: [{ q: question }],
    }),
    /حجم بيانات الامتحان كبير جدًا.*1 ميجابايت/,
  );
});

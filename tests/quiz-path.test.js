import test from "node:test";
import assert from "node:assert/strict";

import { validateTrackPath } from "../scripts/lib/quizPath.js";

test("validateTrackPath accepts configured university years above year two", () => {
  assert.doesNotThrow(() => {
    validateTrackPath("University", {
      college: "Computer Science",
      year: "3",
      term: "1",
      subject: "English II",
    });
  });
});

test("validateTrackPath explains invalid university year and term values", () => {
  assert.throws(
    () => validateTrackPath("University", {
      college: "Computer Science",
      year: "13",
      term: "1",
      subject: "English II",
    }),
    /السنة الدراسية غير صالحة.*1 إلى 12/,
  );
  assert.throws(
    () => validateTrackPath("University", {
      college: "Computer Science",
      year: "3",
      term: "5",
      subject: "English II",
    }),
    /الترم الدراسي غير صالح.*1 إلى 4/,
  );
});

test("validateTrackPath explains missing university placement values", () => {
  assert.throws(
    () => validateTrackPath("University", {
      college: "Computer Science",
      year: "",
      term: "1",
      subject: "English II",
    }),
    /اختر السنة الدراسية/,
  );
});

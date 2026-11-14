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

test("gradeEssay ignores Arabic diacritics (tashkeel) and tatweel", () => {
  assert.equal(gradeEssay("الْعِلْمُ نُورٌ", "العلم نور"), 5);
  assert.equal(gradeEssay("العلم نور", "الْعِلْمُ نُورٌ"), 5);
  assert.equal(gradeEssay("الإســـلام", "الاسلام"), 5);
});

test("gradeEssay treats alef variants as the same letter", () => {
  assert.equal(gradeEssay("احمد", "أحمد"), 5);
  assert.equal(gradeEssay("اسلام", "إسلام"), 5);
  assert.equal(gradeEssay("القران", "القرآن"), 5);
});

test("gradeEssay is not thrown off by Arabic punctuation", () => {
  assert.equal(gradeEssay("الماء والهواء", "الماء، والهواء؟"), 5);
  assert.equal(gradeEssay("«الماء» والهواء", "الماء والهواء"), 5);
});

test("gradeEssay reads Arabic-Indic digits and decimal separator", () => {
  assert.equal(gradeEssay("٤٢", "42"), 5);
  assert.equal(gradeEssay("42", "٤٢"), 5);
  assert.equal(gradeEssay("٣٫٥", "3.5"), 5);
});

test("gradeEssay compares LaTeX answers with what a student types", () => {
  assert.equal(gradeEssay("x^2", "$x^2$"), 5);
  assert.equal(gradeEssay("x^2 + 1", "\\(x^2 + 1\\)"), 5);
  assert.equal(gradeEssay("1/2", "$\\frac{1}{2}$"), 5);
  assert.equal(gradeEssay("نصف قطر الدائرة", "$$\\text{نصف قطر الدائرة}$$"), 5);
  assert.equal(gradeEssay("sin x", "$\\left(\\sin x\\right)$"), 5);
});

test("gradeEssay still gives no credit to unrelated answers", () => {
  assert.equal(gradeEssay("القاهرة", "العلم نور"), 0);
  assert.equal(gradeEssay("x^3", "$x^2$"), 1);
});

test("gradeEssay stays self-contained (it is embedded via toString())", () => {
  const embedded = new Function(`return (${gradeEssay.toString().replace(/^export\s+/, "")})`)();
  assert.equal(embedded("الْعِلْمُ نُورٌ", "العلم نور"), 5);
  assert.equal(embedded("٤٢", "$42$"), 5);
});

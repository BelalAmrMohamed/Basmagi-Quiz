// Markdown <-> rich input: parser round-trip, markdown property, essay grading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "../public/src/shared/rich-input/markdown-parser.js";
import { toMarkdown } from "../public/src/shared/rich-input/markdown-serializer.js";
import { gradeEssay } from "../public/src/shared/rate-answers.js";

const SAMPLE = [
  "# Title",
  "",
  "Hello **bold** and *it* and ~~x~~ `c` <u>u</u>",
  "",
  "- a",
  "- b",
  "  - nested",
  "",
  "1. one",
  "2. two",
  "",
  "> quote",
  "",
  "```js",
  "let a = 1;",
  "```",
].join("\n");

test("parseMarkdown is the inverse of toMarkdown", () => {
  assert.equal(toMarkdown(parseMarkdown(SAMPLE)), SAMPLE);
});

test("plain multi-line text (legacy textarea answers) keeps its line breaks", () => {
  const doc = parseMarkdown("first\nsecond");
  assert.equal(doc.content.length, 1);
  assert.deepEqual(doc.content[0].content.map((n) => n.type), ["text", "hardBreak", "text"]);
});

test("empty input gives an empty paragraph, never an invalid doc", () => {
  assert.deepEqual(parseMarkdown(""), { type: "doc", content: [{ type: "paragraph" }] });
});

test("gradeEssay compares words, not markdown syntax", () => {
  const model = "الإجابة هي **القيمة** المثلى\n\n- أول\n- ثاني";
  assert.equal(gradeEssay("# الإجابة هي القيمة المثلى\n\n- أول\n- ثاني", model), gradeEssay(model, model));
  assert.equal(gradeEssay(model, model), 5);
});

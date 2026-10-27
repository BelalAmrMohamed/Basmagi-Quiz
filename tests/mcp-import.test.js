import test from "node:test";
import assert from "node:assert/strict";

function decodeBase64Utf8(str) {
  const binary = atob(str);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary);
}

test("MCP 1-click import: Arabic UTF-8 Base64 roundtrip", () => {
  const quizObj = {
    meta: {
      title: "امتحان تجريبي في مادة التشريح",
      description: "أسئلة مراجعة للجهاز الدوري",
      source: "توليد Claude / ChatGPT",
    },
    questions: [
      {
        q: "ما هو العضو الرئيسي في الجهاز الدوري للإنسان؟",
        options: ["القلب", "الرئة", "الكبد", "المعدة"],
        correct: [0],
        explanation: "القلب هو المضخة المركزية المسؤولة عن ضخ الدم.",
      },
    ],
  };

  const jsonStr = JSON.stringify(quizObj);
  const base64Str = encodeBase64Utf8(jsonStr);
  const decodedStr = decodeBase64Utf8(base64Str);
  const parsed = JSON.parse(decodedStr);

  assert.equal(parsed.meta.title, quizObj.meta.title);
  assert.equal(parsed.questions[0].q, quizObj.questions[0].q);
  assert.equal(parsed.questions[0].options[0], "القلب");
  assert.deepEqual(parsed.questions[0].correct, [0]);
});

import test from "node:test";
import assert from "node:assert/strict";

function decodeBase64Utf8(str) {
  let cleaned = String(str || "").trim().replace(/\s+/g, "+").replace(/-/g, "+").replace(/_/g, "/");
  while (cleaned.length % 4 !== 0) {
    cleaned += "=";
  }
  const binary = atob(cleaned);
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

test("MCP 1-click import: Base64URL and spaces resilience (Claude / ChatGPT payload)", () => {
  const userPayload = "eyJtZXRhIjp7InRpdGxlIjoiRW5nbGlzaCBRdWl6OiBHcmFtbWFyLCBWb2NhYnVsYXJ5ICYgUmVhZGluZyIsImRlc2NyaXB0aW9uIjoiQSBzaG9ydCAzLXF1ZXN0aW9uIEVuZ2xpc2ggcXVpeiBjb3ZlcmluZyBncmFtbWFyLCB2b2NhYnVsYXJ5LCBhbmQgcmVhZGluZyBjb21wcmVoZW5zaW9uLiIsInNvdXJjZSI6Itiq2YjZhNmK2K8gQ2xhdWRlIC8gQ2hhdEdQVCJ9LCJxdWVzdGlvbnMiOlt7InEiOiIqKkdyYW1tYXI6KiogQ2hvb3NlIHRoZSBjb3JyZWN0IG9wdGlvbiB0byBjb21wbGV0ZSB0aGUgc2VudGVuY2UuXG5cbj4gQnkgdGhlIHRpbWUgd2UgYXJyaXZlZCBhdCB0aGUgc3RhdGlvbiwgdGhlIHRyYWluIF9fX19fXy4iLCJvcHRpb25zIjpbImhhcyBhbHJlYWR5IGxlZnQiLCJoYWQgYWxyZWFkeSBsZWZ0IiwiYWxyZWFkeSBsZWF2ZXMiLCJ3YXMgYWxyZWFkeSBsZWF2aW5nIl0sImNvcnJlY3QiOlsxXSwibXVsdGlTZWxlY3QiOmZhbHNlLCJleHBsYW5hdGlvbiI6IldlIHVzZSB0aGUgcGFzdCBwZXJmZWN0IChoYWQgKyBwYXN0IHBhcnRpY2lwbGUpIGZvciBhbiBhY3Rpb24gdGhhdCB3YXMgY29tcGxldGVkIGJlZm9yZSBhbm90aGVyIHBhc3QgYWN0aW9uLiBUaGUgdHJhaW4gbGVmdCBiZWZvcmUgd2UgYXJyaXZlZCwgc28gJ2hhZCBhbHJlYWR5IGxlZnQnIGlzIGNvcnJlY3QuIn0seyJxIjoiKipWb2NhYnVsYXJ5OioqIFdoaWNoIHdvcmQgaXMgY2xvc2VzdCBpbiBtZWFuaW5nIHRvIHRoZSB1bmRlcmxpbmVkIHdvcmQ_XG5cbj4gVGhlIG1hbmFnZXIgZ2F2ZSBhICoqY29uY2lzZSoqIHN1bW1hcnkgb2YgdGhlIHJlcG9ydCwgc28gdGhlIG1lZXRpbmcgZmluaXNoZWQgZWFybHkuIiwib3B0aW9ucyI6WyJsb25nIGFuZCBkZXRhaWxlZCIsImJyaWVmIGFuZCBjbGVhciIsImNvbmZ1c2luZyIsImVtb3Rpb25hbCJdLCJjb3JyZWN0IjpbMV0sIm11bHRpU2VsZWN0IjpmYWxzZSwiZXhwbGFuYXRpb24iOiInQ29uY2lzZScgbWVhbnMgZXhwcmVzc2luZyBhIGxvdCBpbiBmZXcgd29yZHMsIHNvIGl0IGlzIGNsb3Nlc3QgdG8gJ2JyaWVmIGFuZCBjbGVhcicuIFRoaXMgYWxzbyBleHBsYWlucyB3aHkgdGhlIG1lZXRpbmcgZmluaXNoZWQgZWFybHkuIn0seyJxIjoiKipSZWFkaW5nIENvbXByZWhlbnNpb246KiogUmVhZCB0aGUgcGFzc2FnZSwgdGhlbiBhbnN3ZXIgdGhlIHF1ZXN0aW9uLlxuXG4-IFNsZWVwIGlzIGVzc2VudGlhbCBmb3IgbGVhcm5pbmcuIFdoaWxlIHdlIHNsZWVwLCB0aGUgYnJhaW4gb3JnYW5pemVzIHdoYXQgd2Ugc3R1ZGllZCBkdXJpbmcgdGhlIGRheSBhbmQgbW92ZXMgaW1wb3J0YW50IGluZm9ybWF0aW9uIGludG8gbG9uZy10ZXJtIG1lbW9yeS4gU3R1ZGVudHMgd2hvIHNsZWVwIHdlbGwgYmVmb3JlIGFuIGV4YW0gdXN1YWxseSByZW1lbWJlciBtb3JlIHRoYW4gc3R1ZGVudHMgd2hvIHN0YXkgdXAgYWxsIG5pZ2h0IHN0dWR5aW5nLlxuXG4qKldoYXQgaXMgdGhlIG1haW4gaWRlYSBvZiB0aGUgcGFzc2FnZT8qKiIsIm9wdGlvbnMiOlsiU3R1ZGVudHMgc2hvdWxkIHN0dWR5IG9ubHkgYXQgbmlnaHQuIiwiR29vZCBzbGVlcCBoZWxwcyB0aGUgYnJhaW4gc3RvcmUgYW5kIHJlbWVtYmVyIHdoYXQgd2UgbGVhcm4uIiwiRXhhbXMgYXJlIGVhc2llciBmb3IgcGVvcGxlIHdobyBzbGVlcCBsZXNzLiIsIkxvbmctdGVybSBtZW1vcnkgZG9lcyBub3QgZGVwZW5kIG9uIHRoZSBicmFpbi4iXSwiY29ycmVjdCI6WzFdLCJtdWx0aVNlbGVjdCI6ZmFsc2UsImV4cGxhbmF0aW9uIjoiVGhlIHBhc3NhZ2UgZXhwbGFpbnMgdGhhdCBkdXJpbmcgc2xlZXAgdGhlIGJyYWluIG9yZ2FuaXplcyBpbmZvcm1hdGlvbiBhbmQgc3RvcmVzIGl0IGluIGxvbmctdGVybSBtZW1vcnksIHNvIGdvb2Qgc2xlZXAgaW1wcm92ZXMgcmVtZW1iZXJpbmcuIFRoZSBvdGhlciBvcHRpb25zIGNvbnRyYWRpY3QgdGhlIHRleHQuIn1dfQ==";

  // Convert to URL-safe by replacing + with - and / with _
  const urlSafe = userPayload.replace(/\+/g, "-").replace(/\//g, "_");
  const decodedUrlSafe = decodeBase64Utf8(urlSafe);
  const parsedUrlSafe = JSON.parse(decodedUrlSafe);
  assert.equal(parsedUrlSafe.questions.length, 3);
  assert.equal(parsedUrlSafe.meta.title, "English Quiz: Grammar, Vocabulary & Reading");

  // With spaces (like when passed through URLSearchParams)
  const withSpaces = userPayload.replace(/\+/g, " ");
  const decodedSpaces = decodeBase64Utf8(withSpaces);
  const parsedSpaces = JSON.parse(decodedSpaces);
  assert.equal(parsedSpaces.questions.length, 3);
});

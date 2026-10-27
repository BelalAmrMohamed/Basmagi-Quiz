import test from "node:test";
import assert from "node:assert/strict";

function decodeBase64Utf8(str) {
  let raw = String(str || "").trim();

  if (/%[0-9a-fA-F]{2}/.test(raw)) {
    try {
      raw = decodeURIComponent(raw);
    } catch (_) {
      raw = raw.replace(/%20/gi, " ");
    }
  }

  const candidateStrip = raw.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const candidateReplace = raw.replace(/\s+/g, "+").replace(/-/g, "+").replace(/_/g, "/");

  const candidates = candidateStrip === candidateReplace ? [candidateStrip] : [candidateStrip, candidateReplace];

  for (const cand of candidates) {
    let cleaned = cand;
    while (cleaned.length % 4 !== 0) {
      cleaned += "=";
    }
    try {
      const binary = atob(cleaned);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const decoded = new TextDecoder().decode(bytes);
      const trimmed = decoded.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          JSON.parse(trimmed);
          return decoded;
        } catch (_) {}
      } else {
        return decoded;
      }
    } catch (_) {}
  }

  let cleaned = candidateStrip;
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

test("MCP 1-click import: ChatGPT %20 line-wrap payload resilience", () => {
  const chatGptPayload = "eyJtZXRhIjp7InRpdGxlIjoiRXRoaWNzLCBNb3JhbGl0eSwgSW50ZWdyaXR5LCBhbmQgTGF3cyDigJQgVHJ1ZSBvciBGYWxzZSIsImRlc2NyaXB0aW9uIjoiQSBmaXZlLXF1ZXN0aW9uIFRydWUg%20b3IgRmFsc2UgcXVpeiBhYm91dCBldGhpY3MgYW5kIHByb2Zlc3Npb25hbCBjb25kdWN0LiIsInNvdXJjZSI6IlVzZXItcHJvdmlkZWQgcXVlc3Rpb25zIn0sInF1ZXN0aW9ucyI6W3sicSI6IkV0aGljcyBpcyBkZWZpbmVkIGFzIHRoZSBzdHVkeSBvZiB3aGF0IGl0IG1lYW5zIHRvIFwiZG8gdGhlIHJpZ2h0IHRoaW5nLlwiIiwib3B0aW9ucyI6WyJUcnVlIiwiRmFsc2UiXSwiY29ycmVjdCI6WzBdLCJtdWx0aVNlbGVjdCI6ZmFsc2UsImV4cGxhbmF0aW9uIjoiRXRoaWNzIGV4YW1pbmVzIHByaW5jaXBsZXMgb2YgcmlnaHQgYW5kIHdyb25nIGFuZCB3aGF0IGl0IG1lYW5zIHRvIGFjdCByaWdodGx5LiJ9LHsicSI6Ik1vcmFsaXR5IHJlZmVycyB0byBzb2NpZXR5J3MgcnVsZXMgb2YgY29uZHVjdCBiYXNlZCBvbiBldGhpY2FsIGJlbGllZnMuIiwib3B0aW9ucyI6WyJUcnVlIiwiRmFsc2UiXSwiY29ycmVjdCI6WzBdLCJtdWx0aVNlbGVjdCI6ZmFsc2UsImV4cGx%20hbmF0aW9uIjoiTW9yYWxpdHkgY29uY2VybnMgbm9ybXMgYW5kIGJlbGllZnMgYWJvdXQgcmlnaHQgYW5kIHdyb25nIHRoYXQgZ3VpZGUgY29uZHVjdCwgb2Z0ZW4gd2l0aGluIGEgc29jaWV0eS4ifSx7InEiOiJJbnRlZ3JpdHkgbWVhbnMgYWN0aW5nIGFjY29yZGluZyB0byBjb252ZW5pZW5jZSByYXRoZXIgdGhhbiBtb3JhbCBwcmluY2lwbGVzLiIsIm9wdGlvbnMiOlsiVHJ1ZSIsIkZhbHNlIl0sImNvcnJlY3QiOlsxXSwibXVsdGlTZWxlY3QiOmZhbHNlLCJleHBsYW5hdGlvbiI6IkludGVncml0eSBtZWFucyBhZGhlcmluZyB0byBtb3JhbCBhbmQgZXRoaWNhbCBwcmluY2lwbGVzLCBldmVuIHdoZW4gZG9pbmcgc28gaXMgaW5jb252ZW5pZW50LiJ9LHsicSI6Ikxhd3MgYXJlIGFsd2F5cyBlcXVpdmFsZW50IHRvIGV0aGljcyBhbmQgY292ZXIgYWxsIG1vcmFsIHNpdHVhdGlvbnMuIiwib3B0aW9ucyI6WyJUcnVlIiwiRmFsc2UiXSwiY29ycmVjdCI6WzFdLCJtdWx0aVNlbGVjdCI6ZmFsc2UsImV4cGx%20hbmF0aW9uIjoiTGF3IGFuZCBldGhpY3Mgb3ZlcmxhcCBidXQgYXJlIG5vdCBpZGVudGljYWw7IGxhd3MgZG8gbm90IGFkZHJlc3MgZXZlcnkgbW9yYWwgc2l0dWF0aW9uLiJ9LHsicSI6IkNvcnBvcmF0ZSBjb2RlcyBvZiBldGhpY3MgYXJlIHVzdWFsbHkgbWVhbnQgdG8gZ3VpZGUgZW1wbG95ZWVzJyBiZWhhdmlvciBhbmQgZGVjaXNpb24tbWFraW5nLiIsIm9wdGlvbnMiOlsiVHJ1ZSIsIkZhbHNlIl0sImNvcnJlY3QiOlswXSwibXVsdGlTZWxlY3QiOmZhbHNlLCJleHBsYW5hdGlvbiI6IkNvcnBvcmF0ZSBjb2RlcyBvZiBldGhpY3Mgc2V0IGV4cGVjdGF0aW9ucyBhbmQgcHJvdmlkZSBndWlkYW5jZSBmb3Igd29ya3BsYWNlIGNvbmR1Y3QgYW5kIGRlY2lzaW9ucy4ifV19";

  const decoded = decodeBase64Utf8(chatGptPayload);
  const parsed = JSON.parse(decoded);

  assert.equal(parsed.meta.title, "Ethics, Morality, Integrity, and Laws — True or False");
  assert.equal(parsed.questions.length, 5);
  assert.equal(parsed.questions[0].q, "Ethics is defined as the study of what it means to \"do the right thing.\"");
  assert.equal(parsed.questions[0].options[0], "True");
  assert.deepEqual(parsed.questions[0].correct, [0]);
});

test("MCP 1-click import: Lesson JSON Base64 roundtrip with sections, media, MCQ, and Essay", async () => {
  const { normalizeLessonJson } = await import("../public/src/features/lesson/lesson-json.js");

  const lessonObj = {
    title: "مقدمة في علم وظائف الأعضاء (Physiology)",
    description: "درس تفاعلي يغطي وظائف الخلية والجهاز العصبي مع أسئلة تقييمية ومصادر مرئية.",
    source: "توليد Claude / ChatGPT",
    sections: [
      {
        title: "مقدمة الخلية والوظائف الحيوية",
        defaultHidden: false,
        blocks: [
          {
            type: "markdown",
            body: "# وظائف الخلية\n\nالخلية هي **الوحدة الأساسية** للحياة وتتكون من الغشاء البلازمي والسيتوبلازم والنواة.",
          },
          {
            type: "media",
            url: "https://example.com/cell-diagram.jpg",
            kind: "image",
            alt: "مخطط تركيب الخلية الحية",
          },
          {
            type: "question",
            questionKind: "mcq",
            prompt: "ما هو العضو المسؤول عن إنتاج الطاقة (ATP) في الخلية؟",
            options: ["الميتوكوندريا", "الريبوسوم", "جهاز جولجي", "النوية"],
            correctIndex: 0,
            explanation: "الميتوكوندريا تُعرف ببيت الطاقة في الخلية.",
          },
        ],
      },
      {
        title: "السيال العصبي ونقل الإشارات",
        defaultHidden: true,
        blocks: [
          {
            type: "markdown",
            body: "ينتقل السيال العصبي عبر الخلايا العصبية عبر مضخة الصوديوم والبوتاسيوم $Na^+/K^+$ pump.",
          },
          {
            type: "question",
            questionKind: "essay",
            prompt: "اشرح آلية عمل مضخة الصوديوم والبوتاسيوم في إبقاء جهد الراحة.",
            modelAnswer: "تقوم المضخة بنقل 3 أيونات صوديوم خارج الخلية مقابل أيوني بوتاسيوم لداخل الخلية باستهلاك جزيء ATP.",
            explanation: "تعتمد الاستقطابية على التوزيع غير المتكافئ للشحنات عبر غشاء الخلية العصبية.",
          },
        ],
      },
    ],
  };

  const jsonStr = JSON.stringify(lessonObj);
  const base64Str = encodeBase64Utf8(jsonStr);

  // Test URL-safe conversion (- and _)
  const urlSafe = base64Str.replace(/\+/g, "-").replace(/\//g, "_");
  const decodedStr = decodeBase64Utf8(urlSafe);
  const parsed = JSON.parse(decodedStr);

  const normalized = normalizeLessonJson(parsed);

  assert.equal(normalized.title, lessonObj.title);
  assert.equal(normalized.sections.length, 2);
  assert.equal(normalized.sections[0].title, "مقدمة الخلية والوظائف الحيوية");
  assert.equal(normalized.sections[0].blocks[0].type, "markdown");
  assert.equal(normalized.sections[0].blocks[1].type, "media");
  assert.equal(normalized.sections[0].blocks[2].type, "question");
  assert.equal(normalized.sections[0].blocks[2].questionKind, "mcq");
  assert.equal(normalized.sections[0].blocks[2].correctIndex, 0);

  assert.equal(normalized.sections[1].defaultHidden, true);
  assert.equal(normalized.sections[1].blocks[1].type, "question");
  assert.equal(normalized.sections[1].blocks[1].questionKind, "essay");
  assert.equal(normalized.sections[1].blocks[1].modelAnswer, lessonObj.sections[1].blocks[1].modelAnswer);
  assert.equal(normalized.questionCount, 2);
});


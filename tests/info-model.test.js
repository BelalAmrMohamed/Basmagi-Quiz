import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSource, formatInfoDate, parseQuizPath, buildInfoModel } from "../public/src/components/quiz-info-modal/info-model.js";
import { buildInfoBodyHtml, buildQuizInfoModalHtml } from "../public/src/components/quiz-info-modal/quiz-info-html.js";

test("normalizeSource hides the catalog flag but keeps real sources", () => {
  assert.equal(normalizeSource("platform"), null);
  assert.equal(normalizeSource(" Platform "), null);
  assert.equal(normalizeSource(""), null);
  assert.equal(normalizeSource(null), null);
  assert.equal(normalizeSource("https://example.com/x"), "https://example.com/x");
});

test("formatInfoDate gives YYYY-MM-DD for every stored shape", () => {
  assert.equal(formatInfoDate("2026-11-05"), "2026-11-05");
  assert.equal(formatInfoDate("2026-11-05T10:00:00+00:00"), "2026-11-05");
  assert.equal(formatInfoDate("11/5/2026"), "2026-11-05");
  assert.equal(formatInfoDate("11/5/2026, 3:04:05 PM"), "2026-11-05");
  assert.equal(formatInfoDate(new Date(2026, 10, 5)), "2026-11-05");
  assert.equal(formatInfoDate(null), null);
  assert.equal(formatInfoDate("garbage"), null);
});

test("parseQuizPath never mistakes the term for the course", () => {
  const p = parseQuizPath("quizzes/University/Computer Science/3/1/Data Mining/Midterms/quiz.json");
  assert.equal(p.eduType, "University");
  assert.equal(p.college, "Computer Science");
  assert.equal(p.year, "3");
  assert.equal(p.term, "1");
  assert.equal(p.course, "Data Mining");
  assert.deepEqual(p.folders, ["Midterms"]);
  const f = parseQuizPath("Featured Courses/IELTS/Cambridge 2020/test2.json");
  assert.equal(f.course, "IELTS");
  assert.deepEqual(f.folders, ["Cambridge 2020"]);
  assert.equal(parseQuizPath("a/1/b/q.json").course, "b");
});

test("buildInfoModel: same date format, no equal updated date, hides 'All' college", () => {
  const m = buildInfoModel("lesson", { createdAt: "2026-11-05", updatedAt: "11/6/2026", college: "All", source: "platform" });
  assert.equal(m.created, "2026-11-05");
  assert.equal(m.updated, "2026-11-06");
  assert.equal(m.source, null);
  assert.equal(m.classification.length, 0);
  assert.equal(buildInfoModel("quiz", { createdAt: "2026-11-05", updatedAt: "11/5/2026" }).updated, null);
});

test("shared renderer omits empty parts and never prints 'platform' or a fake source", () => {
  const html = buildInfoBodyHtml(buildInfoModel("notebook", { title: "T", source: "platform", local: true, createdAt: "2026-01-01" }));
  assert.ok(!/platform/i.test(html));
  assert.ok(!html.includes("المصدر"));
  assert.ok(!html.includes("فارغ"));
  assert.ok(html.includes("محلي"));
  assert.ok(!html.includes("info-chips"));
});

test("renderer shows classification chips, trail and escaped values", () => {
  const html = buildInfoBodyHtml(buildInfoModel("lesson", {
    title: "<b>x</b>", eduType: "University", college: "CS", year: 3, term: 1, course: "Data Mining", folders: ["A", "B"],
    createdAt: "2026-11-05", updatedAt: "2026-11-06",
  }));
  assert.ok(html.includes("جامعي") && html.includes("Data Mining") && html.includes("info-trail"));
  assert.ok(html.includes("2026-11-05") && html.includes("2026-11-06"));
  assert.ok(!html.includes("<b>x</b>"));
});

test("quiz modal: المادة is the course, not '1 → course'", () => {
  const html = buildQuizInfoModalHtml({ id: "abc", title: "Q", category: "1 → Data Mining", createdAt: "2026-11-05", syncedAt: "2026-11-06T10:00:00Z", source: "platform" }, 10, null);
  assert.ok(html.includes("Data Mining"));
  assert.ok(!html.includes("1 →") && !html.includes("1 ›"));
  assert.ok(!/platform/i.test(html));
  assert.ok(html.includes("2026-11-06"));
});

// Opening /my-content?draft=<code> saves the item straight into «محتواي».
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};
const notes = [];
let currentUrl = "https://x.test/my-content";
globalThis.window = { get location() { return new URL(currentUrl); }, addEventListener() {} };
globalThis.history = { state: null, replaceState: (_s, _t, u) => { currentUrl = new URL(u, currentUrl).href; } };
const fakeEl = () => new Proxy(function () {}, { get: (_t, k) => (k === "classList" ? { add() {}, remove() {}, contains: () => false } : k === "style" || k === "dataset" ? {} : k === "children" ? [] : fakeEl()), apply: () => fakeEl(), set: () => true });
globalThis.document = { getElementById: () => null, createElement: () => fakeEl(), body: fakeEl(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
const drafts = {};
const deleted = [];
globalThis.fetch = async (url, opts = {}) => {
  const m = String(url).match(/\/api\/mcp\/draft\/([^/?]+)/);
  if (!m) return { ok: false, status: 404 };
  if (opts.method === "DELETE") { deleted.push(m[1]); delete drafts[m[1]]; return { ok: true, status: 200 }; }
  const d = drafts[m[1]];
  return d ? { ok: true, status: 200, json: async () => d } : { ok: false, status: 404 };
};

const { importMcpDraftFromUrl, peekPendingHighlight, takePendingHighlight } = await import("../public/src/features/home/mcp-draft-import.js");
const items = () => JSON.parse(store.get("user_quizzes") || "[]");
const open = (code) => { currentUrl = `https://x.test/my-content?draft=${code}`; return importMcpDraftFromUrl(); };

const quiz = { meta: { title: "Quiz A", source: "not a url" }, questions: [{ q: "2+2?", options: ["3", "4"], correct: 1 }, { q: "Essay", answer: "model" }] };
const lesson = { title: "Lesson A", sections: [{ title: "S1", blocks: [{ type: "markdown", body: "hi" }, { type: "question", prompt: "p", options: ["a", "b"], correct: 0 }] }] };
const notebook = { title: "NB A", runtime: "matlab", language: "en", cells: [{ type: "markdown", source: "# t" }, { type: "code", source: "x = 1" }] };

test("no ?draft= → does nothing", async () => {
  currentUrl = "https://x.test/my-content";
  assert.equal(await importMcpDraftFromUrl(), null);
  assert.equal(items().length, 0);
});

test("quiz link saves a quiz at the root, cleans the URL, deletes the draft, marks it for highlight", async () => {
  drafts.aaaaaaaaaa = { kind: "quiz", payload: quiz, assets: [] };
  const r = await open("aaaaaaaaaa");
  assert.equal(r.kind, "quiz");
  assert.equal(items().length, 1);
  const row = items()[0];
  assert.equal(row.meta.title, "Quiz A");
  assert.equal(row.meta.parentId, null);
  assert.equal(row.meta.source, undefined); // non-URL source dropped
  assert.equal(row.questions.length, 2);
  assert.ok(!currentUrl.includes("draft="));
  assert.deepEqual(deleted, ["aaaaaaaaaa"]);
  assert.equal(peekPendingHighlight(), row.id);
  assert.equal(takePendingHighlight(), row.id);
  assert.equal(takePendingHighlight(), null);
});

test("re-opening the same link does not duplicate; it re-highlights the existing item", async () => {
  const r = await open("aaaaaaaaaa");
  assert.equal(r.existing, true);
  assert.equal(items().length, 1);
  assert.equal(takePendingHighlight(), items()[0].id);
});

test("lesson link → lesson row with sections/question counts", async () => {
  drafts.bbbbbbbbbb = { kind: "lesson", payload: lesson, assets: [] };
  const r = await open("bbbbbbbbbb");
  assert.equal(r.kind, "lesson");
  const row = items().find((x) => x.meta.type === "lesson");
  assert.equal(row.meta.title, "Lesson A");
  assert.equal(row.stats.sectionCount, 1);
  assert.equal(row.stats.questionCount, 1);
  assert.equal(row.lesson.sections[0].blocks.length, 2);
  takePendingHighlight();
});

test("notebook link → notebook row for anyone (no admin), runtime + cells kept", async () => {
  drafts.cccccccccc = { kind: "notebook", payload: notebook, assets: [] };
  const r = await open("cccccccccc");
  assert.equal(r.kind, "notebook");
  const row = items().find((x) => x.meta.type === "notebook");
  assert.match(row.id, /^user_notebook_/);
  assert.equal(row.notebook.runtime, "matlab");
  assert.equal(row.stats.cellCount, 2);
  takePendingHighlight();
});

test("same title as an existing item at the root → '(2)' instead of failing", async () => {
  drafts.dddddddddd = { kind: "quiz", payload: quiz, assets: [] };
  await open("dddddddddd");
  const titles = items().filter((x) => (x.meta.type || "quiz") === "quiz").map((x) => x.meta.title);
  assert.deepEqual(titles.sort(), ["Quiz A", "Quiz A (2)"]);
  takePendingHighlight();
});

test("expired/unknown link → nothing saved, URL cleaned, no highlight", async () => {
  const before = items().length;
  assert.equal(await open("eeeeeeeeee"), null);
  assert.equal(items().length, before);
  assert.ok(!currentUrl.includes("draft="));
  assert.equal(takePendingHighlight(), null);
});

test("invalid draft content (notebook without runtime) → nothing saved", async () => {
  const before = items().length;
  drafts.ffffffffff = { kind: "notebook", payload: { title: "bad", cells: [{ type: "code", source: "x" }] }, assets: [] };
  assert.equal(await open("ffffffffff"), null);
  assert.equal(items().length, before);
});

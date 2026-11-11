import test from "node:test";
import assert from "node:assert/strict";
import { rowToNotebook, collectNotebookInfo, notebookToIpynb, notebookToMScript, notebookToHtml, notebookToCppScript, notebookToJson, notebookAttachmentPayload, safeFileName } from "../public/src/shared/notebook-export.js";
import { notebookFromIpynb, notebookFromFile } from "../public/src/shared/notebook-convert.js";
import { detectNotebookLang, resolveNotebookLang } from "../public/src/shared/notebook-lang.js";
import { normalizeNotebookContent, checkNotebook } from "../public/src/shared/content-rules.js";

const cells = [
  { type: "markdown", source: "# Intro\n\nSome *text* with $x^2$." },
  { type: "code", source: "x = 1:3;\ny = x.^2\n" },
  { type: "code", source: "disp('hi')" },
];
const local = { id: "user_notebook_1", meta: { type: "notebook", title: "My NB", description: "d", source: "https://e.com", createdAt: "1/1/2026", updatedAt: "2026-01-01T00:00:00Z" }, notebook: { runtime: "matlab", content: { schemaVersion: 1, language: "en", cells } } };
const platform = { id: "uuid-1", slug: "my-nb", title: "My NB", description: "d", source: "", runtime: "matlab", content: { schemaVersion: 1, cells }, created_at: "2026-01-01" };

test("rowToNotebook handles local and platform rows", () => {
  const a = rowToNotebook(local), b = rowToNotebook(platform);
  assert.equal(a.local, true); assert.equal(b.local, false);
  assert.equal(a.cells.length, 3); assert.equal(b.slug, "my-nb");
  assert.equal(a.language, "en"); assert.equal(b.language, "en");
});

test("info counts", () => {
  const i = collectNotebookInfo(local);
  assert.equal(i.cellCount, 3); assert.equal(i.codeCount, 2); assert.equal(i.markdownCount, 1);
});

test(".ipynb export round-trips through the importer", () => {
  const ipynb = notebookToIpynb(local);
  assert.equal(ipynb.nbformat, 4);
  const back = notebookFromIpynb(JSON.stringify(ipynb));
  assert.deepEqual(back.content.cells.map((c) => [c.type, c.source]), cells.map((c) => [c.type, c.source]));
});

test(".m export uses %% sections and keeps code verbatim", () => {
  const m = notebookToMScript(local);
  assert.match(m, /^% My NB/);
  assert.match(m, /%% Intro/);
  assert.match(m, /%%\nx = 1:3;\ny = x\.\^2/);
  assert.match(m, /%%\ndisp\('hi'\)/);
});

test("HTML export escapes, sets direction and uses the injected renderer", () => {
  const html = notebookToHtml({ ...local, notebook: { ...local.notebook, content: { ...local.notebook.content, language: "ar", cells: [{ type: "code", source: "a < b && c" }] } } }, { renderMarkdown: (s) => `<p>${s}</p>` });
  assert.match(html, /dir="rtl"/); assert.match(html, /a &lt; b &amp;&amp; c/);
  assert.match(notebookToHtml(local, { renderMarkdown: (s) => `<b>${s.length}</b>` }), /<b>\d+<\/b>/);
});

test("attachment payload carries every cell", () => {
  const p = notebookAttachmentPayload(platform);
  assert.equal(p.content.cells.length, 3); assert.equal(p.content.type, "notebook");
});

test("language: explicit wins, otherwise detected", () => {
  assert.equal(resolveNotebookLang("ar", { title: "english" }), "ar");
  assert.equal(detectNotebookLang({ title: "مرحبا بك في الدفتر", cells: [{ type: "markdown", source: "شرح" }] }), "ar");
  assert.equal(detectNotebookLang({ title: "Hello", cells: [{ type: "code", source: "تعليق" }] }), "en");
});

test("content.language is kept by normalization and validated", () => {
  assert.equal(normalizeNotebookContent([{ type: "code", source: "x" }], "ar").language, "ar");
  assert.equal(normalizeNotebookContent([{ type: "code", source: "x" }], "fr").language, undefined);
  const bad = checkNotebook({ title: "t", runtime: "matlab", language: "fr", content: { schemaVersion: 1, cells: [{ id: "a", type: "code", source: "x" }] } });
  assert.ok(bad.errors.some((e) => e.code === "NOTEBOOK_LANGUAGE_INVALID"));
});

test("safeFileName", () => {
  assert.equal(safeFileName('a/b:c*"d'), "a b c d");
  assert.equal(safeFileName("   "), "notebook");
  assert.equal(safeFileName("دفتر المصفوفات"), "دفتر المصفوفات");
});

test("C++ notebooks export as .cpp with //%% cells and import back as the same cells", () => {
  const nb = { title: "Pointers", description: "d", source: "https://x.y", runtime: "cpp", language: "en", cells: [
    { type: "markdown", source: "# Intro\ntext" }, { type: "code", source: "#include <iostream>\nint main() { return 0; }" }, { type: "code", source: "int x = 1;" } ], assets: [] };
  const cpp = notebookToCppScript(nb);
  assert.match(cpp, /^\/\/ Pointers/); assert.equal((cpp.match(/^\/\/%%$/gm) || []).length, 3);
  const back = notebookFromFile("Pointers.cpp", cpp);
  assert.equal(back.runtime, "cpp");
  assert.deepEqual(back.content.cells.map((c) => [c.type, c.source]), [["markdown", "# Intro\ntext"], ["code", "#include <iostream>\nint main() { return 0; }"], ["code", "int x = 1;"]]);
  assert.equal(notebookFromFile("plain.cpp", "int main() {}\n").content.cells.length, 1);
});

test("JSON export keeps title, description, source, language, runtime and every cell field", () => {
  const j = notebookToJson({ title: "T", description: "D", source: "https://s", runtime: "cpp", language: "ar", createdAt: null, updatedAt: null, assets: [], cells: [
    { id: "a", type: "code", source: "x", stdin: "5", challenge: { expectedOutput: "5" } }, { id: "b", type: "markdown", source: "m" } ] });
  assert.equal(j.format, "basmagi-notebook");
  assert.deepEqual([j.title, j.description, j.source, j.runtime, j.language], ["T", "D", "https://s", "cpp", "ar"]);
  assert.deepEqual(j.cells[0], { type: "code", source: "x", stdin: "5", challenge: { expectedOutput: "5" } });
  assert.equal(notebookToIpynb({ title: "T", description: "D", source: "s", runtime: "cpp", language: "en", cells: [], assets: [] }).metadata.basmagi.runtime, "cpp");
});

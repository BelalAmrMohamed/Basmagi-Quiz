import test from "node:test";
import assert from "node:assert/strict";
import { checkNotebook, LIMITS } from "../public/src/shared/content-rules.js";
import { validateNotebook as mcpValidate, applyDraftPatch, draftUrl, AUTHORING_GUIDE, outlineNotebook, notebookToDraftInput } from "../supabase/functions/mcp/lib.ts";
import { validateNotebook, validateNotebookContent, validateNotebookRuntime } from "../api/_validateNotebook.js";
import { notebookFromIpynb, notebookFromMScript, notebookFromFile, parseCompilerLesson, compilerLessonToNotebook } from "../public/src/shared/notebook-convert.js";
import { loadSeedNotebooks } from "../scripts/seed-notebooks.mjs";
import { notebookUrl } from "../api/_urls.js";

const cells = [
  { id: "cell-1", type: "markdown", source: "# مرحبا" },
  { id: "cell-2", type: "code", source: "x = 1" },
];
const ok = { title: "t", description: "d", source: "", runtime: "matlab", cells };

// Each fixture must be rejected by the shared rules, the MCP wrapper and the upload API.
const bad = {
  "missing runtime": { ...ok, runtime: "" },
  "unknown runtime": { ...ok, runtime: "python" },
  "title too long": { ...ok, title: "x".repeat(LIMITS.notebookTitle + 1) },
  "source not a link": { ...ok, source: "lecture 3" },
  "no cells": { ...ok, cells: [] },
  "unknown cell type": { ...ok, cells: [{ type: "raw", source: "x" }] },
  "non-string source": { ...ok, cells: [{ type: "code", source: 5 }] },
  "cell too long": { ...ok, cells: [{ type: "code", source: "x".repeat(LIMITS.notebookCellSource + 1) }] },
  "too many cells": { ...ok, cells: Array.from({ length: LIMITS.notebookCells + 1 }, () => ({ type: "code", source: "x" })) },
  "duplicate ids": { ...ok, cells: [{ id: "a", type: "code", source: "x" }, { id: "a", type: "code", source: "y" }] },
  "bad id chars": { ...ok, cells: [{ id: "a b", type: "code", source: "x" }] },
  "too large": { ...ok, cells: Array.from({ length: 40 }, () => ({ type: "code", source: "x".repeat(10000) })) },
};
for (const [name, input] of Object.entries(bad)) {
  test(`notebook parity (rejected everywhere): ${name}`, () => {
    assert.ok(checkNotebook(input).errors.length > 0, "shared");
    assert.equal(mcpValidate(input).ok, false, "mcp");
    assert.throws(() => validateNotebook({ ...input, content: { schemaVersion: 1, cells: input.cells } }), undefined, "upload");
  });
}

test("notebook: valid passes everywhere and ids are assigned", () => {
  const input = { ...ok, cells: [{ type: "markdown", source: "a" }, { type: "code", source: "b" }] };
  assert.equal(checkNotebook(input).errors.length, 0);
  const m = mcpValidate(input);
  assert.equal(m.ok, true);
  assert.deepEqual(m.data.cells.map((c) => c.id), ["cell-1", "cell-2"]);
  const u = validateNotebook({ ...input, content: { schemaVersion: 1, cells: input.cells } });
  assert.equal(u.content.schemaVersion, 1);
  assert.equal(u.runtime, "matlab");
});

test("upload validator rejects unknown keys, bad schemaVersion, learner outputs", () => {
  assert.throws(() => validateNotebookContent({ schemaVersion: 2, cells }), /schemaVersion/);
  assert.throws(() => validateNotebookContent({ schemaVersion: 1, cells, extra: 1 }), /غير مسموح/);
  assert.throws(() => validateNotebookContent({ schemaVersion: 1, cells: [{ type: "code", source: "x", outputs: [] }] }), /outputs/);
  assert.throws(() => validateNotebookRuntime(undefined));
  assert.equal(validateNotebookRuntime("matlab"), "matlab");
});

test("ipynb conversion: order kept, raw skipped and reported, outputs dropped and reported", () => {
  const nb = JSON.stringify({
    metadata: { language_info: { name: "python" } },
    cells: [
      { cell_type: "markdown", source: ["# T\n", "text"] },
      { cell_type: "raw", source: "raw" },
      { cell_type: "code", source: ["a=1;\n", "b=2"], outputs: [{ output_type: "stream" }] },
    ],
  });
  const r = notebookFromIpynb(nb);
  assert.deepEqual(r.content.cells.map((c) => [c.type, c.source]), [["markdown", "# T\ntext"], ["code", "a=1;\nb=2"]]);
  assert.equal(r.warnings.length, 3);
  assert.throws(() => notebookFromIpynb("{"), /JSON/);
  assert.throws(() => notebookFromIpynb(JSON.stringify({ cells: [] })), /لا توجد خلايا/);
  assert.throws(() => notebookFromIpynb(JSON.stringify({})), /cells/);
});

test(".m becomes ONE code cell; file dispatch rejects other types", () => {
  const r = notebookFromMScript("a = 1;\r\n%% part\r\nb = 2;\r\n");
  assert.equal(r.content.cells.length, 1);
  assert.equal(r.content.cells[0].source, "a = 1;\n%% part\nb = 2;");
  assert.equal(notebookFromFile("My_script.m", "x=1").title, "My script");
  assert.throws(() => notebookFromFile("x.py", "print(1)"), /غير مدعوم/);
  assert.throws(() => notebookFromMScript("   "), /فارغ/);
});

test("all ten compiler lessons convert, validate, and are unique/ordered", () => {
  const list = loadSeedNotebooks();
  assert.equal(list.filter((n) => n.runtime === "matlab").length, 10);
  assert.equal(list.filter((n) => n.runtime === "cpp").length, 2);
  assert.equal(new Set(list.map((n) => n.migrationKey)).size, 12);
  assert.equal(new Set(list.map((n) => n.slug)).size, 12);
  assert.deepEqual(list.slice(0, 10).map((n) => n.sortOrder), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const n of list) {
    assert.equal(checkNotebook({ ...n, content: n.content }).errors.length, 0, n.migrationKey);
  }
});

test("compiler lesson conversion preserves cell order, code and markdown exactly", () => {
  const text = "@id lecture-9\n@title T\n@files a.png\n%% md\n# H\n\nbody\n%% code\nx = imread('a.png');\n%% code\ny = 2\n";
  const n = compilerLessonToNotebook(parseCompilerLesson(text));
  assert.deepEqual(n.content.cells.map((c) => [c.type, c.source]), [["markdown", "# H\n\nbody"], ["code", "x = imread('a.png');"], ["code", "y = 2"]]);
  assert.deepEqual(n.assets, ["a.png"]);
  assert.throws(() => compilerLessonToNotebook(parseCompilerLesson("%% code\nx")), /@id/);
});

test("MCP: draft url, guide, outline, patch ops, round-trip", () => {
  assert.equal(draftUrl("notebook", "abcdefghjk"), "https://basmagi-quiz.vercel.app/notebook/new?draft=abcdefghjk");
  assert.match(AUTHORING_GUIDE.notebook, /NOT MathWorks MATLAB/);
  const v = mcpValidate(ok);
  assert.match(outlineNotebook(v.data), /cells: 2/);
  const p = applyDraftPatch("notebook", v.data, { ops: [{ op: "append_cells", cells: [{ type: "code", source: "y=2" }] }, { op: "move_cell", at: 3, to: 1 }, { op: "delete_cell", at: 2 }], meta: { runtime: "matlab" } });
  assert.equal(p.error, undefined);
  assert.deepEqual(p.data.cells.map((c) => c.source), ["y=2", "x = 1"]);
  assert.match(applyDraftPatch("notebook", v.data, { ops: [{ op: "set_section", at: 1 }] }).error, /set_cell/);
  const input = notebookToDraftInput({ title: "t", runtime: "matlab", content: { cells } });
  assert.equal(mcpValidate(input).ok, true);
  assert.equal(mcpValidate({ ...input, runtime: "cpp" }).ok, true);
});

test("notebookUrl", () => {
  assert.match(notebookUrl("a b"), /\/notebook\/a%20b$/);
});

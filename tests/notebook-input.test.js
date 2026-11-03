import test from "node:test";
import assert from "node:assert/strict";
import { parseNotebookInput, validateNotebookRecord, NOTEBOOK_CREATION_PROMPT, NotebookInputError } from "../public/src/features/home/notebook-input.js";

const good = { title: "T", description: "d", source: "", runtime: "matlab", cells: [{ type: "markdown", source: "# hi" }, { type: "code", source: "x=1" }] };

test("prompt documents the JSON shape", () => {
  assert.match(NOTEBOOK_CREATION_PROMPT, /"runtime": "matlab"/);
  assert.match(NOTEBOOK_CREATION_PROMPT, /"cells"/);
});

test("pasted notebook JSON (also inside a code fence) parses and validates", () => {
  for (const text of [JSON.stringify(good), "```json\n" + JSON.stringify(good) + "\n```"]) {
    const rec = parseNotebookInput({ text });
    assert.equal(rec.title, "T");
    assert.equal(rec.content.cells.length, 2);
    assert.equal(rec.content.cells[0].id, "cell-1");
    assert.deepEqual(validateNotebookRecord(rec).errors, []);
  }
});

test("raw .ipynb JSON pasted as text is converted", () => {
  const ipynb = { nbformat: 4, cells: [{ cell_type: "markdown", source: ["# a"] }, { cell_type: "code", source: ["y = 2"], outputs: [] }], metadata: {} };
  const rec = parseNotebookInput({ text: JSON.stringify(ipynb) });
  assert.equal(rec.content.cells.length, 2);
  assert.equal(rec.content.cells[1].type, "code");
});

test(".m and .ipynb files convert; unsupported extension throws", () => {
  const m = parseNotebookInput({ fileName: "demo.m", text: "%% Title\nx = 1;\n" });
  assert.equal(m.runtime, "matlab");
  assert.ok(m.content.cells.length >= 1);
  assert.throws(() => parseNotebookInput({ fileName: "a.py", text: "print(1)" }));
});

test("validation rejects bad runtime, bad cell type and empty title; empty/invalid input throws", () => {
  assert.ok(validateNotebookRecord(parseNotebookInput({ text: JSON.stringify({ ...good, runtime: "python" }) })).errors.length);
  assert.ok(validateNotebookRecord(parseNotebookInput({ text: JSON.stringify({ ...good, cells: [{ type: "raw", source: "x" }] }) })).errors.length);
  assert.ok(validateNotebookRecord(parseNotebookInput({ text: JSON.stringify({ ...good, title: "" }) })).errors.length);
  assert.throws(() => parseNotebookInput({ text: "  " }));
  assert.throws(() => parseNotebookInput({ text: "{nope" }), NotebookInputError);
});

test("raw line breaks inside strings (the common AI mistake) are repaired and reported", () => {
  const bad = '{"title":"T","runtime":"matlab","cells":[{"type":"code","source":"a = 1;\nb = 2;"},{"type":"markdown","source":"```matlab\nx\n```"}]}'.replace(/\\n/g, "\n");
  assert.throws(() => JSON.parse(bad));
  const rec = parseNotebookInput({ text: bad });
  assert.equal(rec.content.cells[0].source, "a = 1;\nb = 2;");
  assert.ok(rec.content.cells[1].source.startsWith("```matlab"));
  assert.ok(rec.warnings.some((w) => /فاصل سطر/.test(w)));
});

test("invalid escapes and trailing commas are repaired", () => {
  const rec = parseNotebookInput({ text: '{"title":"T","runtime":"matlab","cells":[{"type":"markdown","source":"$\\x$ \\q",},]}'.replace('\\\\x', '\\x') });
  assert.equal(rec.content.cells.length, 1);
});

test("unrecoverable JSON reports line, column and a snippet", () => {
  try {
    parseNotebookInput({ text: '{\n "title": "x",\n "cells": [ {"type": "code" "source": "a"} ]\n}' });
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof NotebookInputError);
    assert.equal(e.loc.line, 3);
    assert.ok(e.loc.snippet.includes('"source"'));
    assert.ok(e.details.length >= 2);
  }
});

test("missing cells and non-object roots give specific messages", () => {
  assert.throws(() => parseNotebookInput({ text: '{"title":"x"}' }), (e) => e instanceof NotebookInputError && /cells/.test(e.headline));
  assert.throws(() => parseNotebookInput({ text: "[1]" }), (e) => e instanceof NotebookInputError);
  assert.throws(() => parseNotebookInput({ text: "" }), (e) => e instanceof NotebookInputError);
});

test("fenced answers unwrap, but a ```matlab fence inside a cell is preserved", () => {
  const rec = parseNotebookInput({ text: "Here you go:\n```json\n" + JSON.stringify({ ...good, cells: [{ type: "markdown", source: "```matlab\nx=1\n```" }] }) + "\n```" });
  assert.ok(rec.content.cells[0].source.includes("```matlab"));
});

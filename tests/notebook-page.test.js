import test from "node:test";
import assert from "node:assert/strict";
import { parseNotebookRef, prepareNotebook } from "../public/src/features/notebook/notebook-data.js";
import * as M from "../public/src/features/notebook/notebook-editor-model.js";

test("parseNotebookRef", () => {
  assert.equal(parseNotebookRef("/notebook/matlab-section-1"), "matlab-section-1");
  assert.equal(parseNotebookRef("/notebook", "?id=abc"), "abc");
  assert.equal(parseNotebookRef("/notebook", "?id=user_notebook_123&type=user"), "user_notebook_123");
  assert.equal(parseNotebookRef("/notebook/"), null);
});
test("prepareNotebook: missing/malformed/unsupported are explicit", () => {
  assert.equal(prepareNotebook(null).kind, "unavailable");
  assert.equal(prepareNotebook({ runtime: "python", content: {} }).kind, "unsupported");
  assert.equal(prepareNotebook({ runtime: "matlab", content: { schemaVersion: 9, cells: [] } }).kind, "malformed");
  const ok = prepareNotebook({ id: "i", title: "t", runtime: "matlab", content: { schemaVersion: 1, cells: [{ type: "code", source: "x=1" }] } });
  assert.equal(ok.ok, true);
  assert.equal(ok.notebook.cells[0].id, "cell-1");
});
test("editor model: reorder, validate, never default runtime", () => {
  let s = M.notebookFromPayload({ title: "t", cells: [{ type: "code", source: "a" }, { type: "code", source: "b" }] });
  assert.ok(M.validateState(s).errors.some((e) => /runtime/.test(e)));
  s = { ...s, runtime: "matlab" };
  s = M.moveCell(s, 1, -1);
  assert.deepEqual(s.cells.map((c) => c.source), ["b", "a"]);
  assert.equal(M.validateState(s).errors.length, 0);
  assert.equal(M.buildPayload(s).content.cells[0].id, "cell-1");
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseNotebookRoute } from "../public/src/features/notebook/notebook-data.js";

test("notebook routes: view / new / edit", () => {
  assert.deepEqual(parseNotebookRoute("/notebook/new"), { mode: "new", ref: null });
  assert.deepEqual(parseNotebookRoute("/notebook/new/"), { mode: "new", ref: null });
  assert.deepEqual(parseNotebookRoute("/notebook/edit/user_notebook_1"), { mode: "edit", ref: "user_notebook_1" });
  assert.deepEqual(parseNotebookRoute("/notebook/edit/"), { mode: "view", ref: "edit" });
  assert.deepEqual(parseNotebookRoute("/notebook/my-slug"), { mode: "view", ref: "my-slug" });
  assert.deepEqual(parseNotebookRoute("/notebook", "?id=abc"), { mode: "view", ref: "abc" });
  assert.deepEqual(parseNotebookRoute("/notebook", "?mode=new"), { mode: "new", ref: null });
  assert.deepEqual(parseNotebookRoute("/notebook", "?mode=edit&id=xyz"), { mode: "edit", ref: "xyz" });
});

import test from "node:test";
import assert from "node:assert/strict";
import { planSync, notebookFolderName } from "../public/src/shared/folder-sync.js";
import { routeFile } from "../public/src/shared/runtime-config.js";

const T0 = 1_000_000;
test("first sync: copies missing files each way, newest wins for clashes", () => {
  const p = planSync([{ path: "a.png", mtime: T0 }, { path: "both.png", mtime: T0 + 10_000 }], [{ path: "b.png", mtime: T0 }, { path: "both.png", mtime: T0 }], {});
  assert.deepEqual(p.toDisk.sort(), ["a.png", "both.png"]);
  assert.deepEqual(p.toBrowser, ["b.png"]);
});
test("changes since the last sync move in the right direction", () => {
  const snap = { "x.png": { l: T0, r: T0 }, "y.png": { l: T0, r: T0 } };
  const p = planSync([{ path: "x.png", mtime: T0 + 60_000 }, { path: "y.png", mtime: T0 }], [{ path: "x.png", mtime: T0 }, { path: "y.png", mtime: T0 + 60_000 }], snap);
  assert.deepEqual(p.toDisk, ["x.png"]);
  assert.deepEqual(p.toBrowser, ["y.png"]);
});
test("deletions are never automatic: previously synced + missing on one side => ask", () => {
  const snap = { "gone-disk.png": { l: T0, r: T0 }, "gone-browser.png": { l: T0, r: T0 } };
  const p = planSync([{ path: "gone-disk.png", mtime: T0 }], [{ path: "gone-browser.png", mtime: T0 }], snap);
  assert.deepEqual(p.askDeleteBrowser, ["gone-disk.png"]);
  assert.deepEqual(p.askDeleteDisk, ["gone-browser.png"]);
  assert.deepEqual(p.toDisk.concat(p.toBrowser), []);
});
test("unchanged files do nothing; tolerance ignores tiny clock differences", () => {
  const snap = { "a.png": { l: T0, r: T0 } };
  const p = planSync([{ path: "a.png", mtime: T0 + 500 }], [{ path: "a.png", mtime: T0 + 900 }], snap);
  assert.deepEqual(p, { toDisk: [], toBrowser: [], askDeleteBrowser: [], askDeleteDisk: [] });
});
test("folder names are safe and stable", () => {
  assert.equal(notebookFolderName('Lecture: 1/2*?', "user_notebook_abcdef123456"), "Lecture 1 2-123456");
});
test("import routing per runtime", () => {
  assert.equal(routeFile("matlab", "Lecture_01.m"), "code");
  assert.equal(routeFile("matlab", "x.ipynb"), "code");
  assert.equal(routeFile("matlab", "Test.PNG"), "workspace");
  assert.equal(routeFile("matlab", "My Nb.notebook.zip"), "bundle");
  assert.equal(routeFile("matlab", "Lecture_01.pdf"), "unsupported");
  assert.equal(routeFile("matlab", "all files.zip"), "unsupported");
});

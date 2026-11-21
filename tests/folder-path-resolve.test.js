import test from "node:test";
import assert from "node:assert/strict";
import { resolveFolderPath } from "../api/_folderPath.js";

const db = (rows, error = null) => ({ from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: rows, error }) }) }) }) });
const rows = [
  { id: "f1", name: "محاضرات", parent_folder_id: null },
  { id: "f2", name: "الأسبوع 1", parent_folder_id: "f1" },
  { id: "f3", name: "الأسبوع 1", parent_folder_id: null },
  { id: "f4", name: "مكرر", parent_folder_id: null },
  { id: "f5", name: "مكرر", parent_folder_id: null },
];

test("empty path means the course root", async () => {
  assert.deepEqual(await resolveFolderPath(db(rows), "c", []), { ok: true, folderId: null });
});
test("walks nested names by parent", async () => {
  assert.deepEqual(await resolveFolderPath(db(rows), "c", ["محاضرات", "الأسبوع 1"]), { ok: true, folderId: "f2" });
  assert.deepEqual(await resolveFolderPath(db(rows), "c", ["الأسبوع 1"]), { ok: true, folderId: "f3" });
});
test("missing, duplicate and db errors are reported", async () => {
  assert.equal((await resolveFolderPath(db(rows), "c", ["غير موجود"])).ok, false);
  assert.equal((await resolveFolderPath(db(rows), "c", ["مكرر"])).ok, false);
  assert.equal((await resolveFolderPath(db(null, { message: "x" }), "c", ["a"])).ok, false);
});

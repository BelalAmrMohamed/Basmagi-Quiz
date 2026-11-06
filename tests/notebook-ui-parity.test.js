import test from "node:test";
import assert from "node:assert/strict";
import { slotForLabel, orderSlots } from "../public/src/features/home/item-menu-order.js";
import { isGoogleDriveUrl, sourceIconHtml } from "../public/src/shared/source-link.js";
import { classifyDroppedFile, partitionDroppedFiles, dedupeTitle, baseNameOf, buildLocalNotebookEntry } from "../public/src/features/home/local-notebook.js";
import { getFolderContentsCount, formatFolderAndQuizCount } from "../public/src/features/home/folder-counts.js";
import { formatItemCounts } from "../public/src/features/home/upload-counts.js";

test("menu slots: one fixed order for every item type", () => {
  const notebook = ["إدارة", "اسأل الباشـمبصمج", "معلومات الدفتر", "مشاركة الرابط", "نسخ الرابط"];
  const quiz = ["معلومات الامتحان", "إدارة", "اسأل الباشـمبصمج", "نسخ إلى محتواي", "مشاركة الرابط", "نسخ كود التضمين", "نسخ الرابط"];
  const finalOf = (labels) => orderSlots(labels).order.map((i) => labels[i]);
  assert.deepEqual(finalOf(notebook), ["معلومات الدفتر", "اسأل الباشـمبصمج", "نسخ الرابط", "مشاركة الرابط", "إدارة"]);
  assert.deepEqual(finalOf(quiz), ["نسخ إلى محتواي", "معلومات الامتحان", "اسأل الباشـمبصمج", "نسخ الرابط", "مشاركة الرابط", "نسخ كود التضمين", "إدارة"]);
});

test("menu slots: divider sits before the management zone, none when it would lead", () => {
  const labels = ["نسخ الرابط", "إدارة"];
  assert.equal(orderSlots(labels).dividerBefore, 1);
  assert.equal(orderSlots(["إدارة", "حذف"]).dividerBefore, -1);
  assert.equal(slotForLabel("تحميل"), "primary");
  assert.equal(slotForLabel("شيء غريب"), "other");
});

test("my-content menu: info/ask first, select/edit/move/delete last", () => {
  const labels = ["حذف", "نقل إلى", "تعديل", "تحديد", "اسأل الباشـمبصمج", "معلومات الدفتر"];
  const out = orderSlots(labels).order.map((i) => labels[i]);
  assert.deepEqual(out, ["معلومات الدفتر", "اسأل الباشـمبصمج", "تحديد", "تعديل", "نقل إلى", "حذف"]);
});

test("Google Drive source detection", () => {
  assert.equal(isGoogleDriveUrl("https://drive.google.com/drive/folders/abc"), true);
  assert.equal(isGoogleDriveUrl("https://docs.google.com/document/d/1"), true);
  assert.equal(isGoogleDriveUrl("https://evil.com/drive.google.com"), false);
  assert.equal(isGoogleDriveUrl("javascript:alert(1)"), false);
  assert.equal(isGoogleDriveUrl("not a url"), false);
  assert.match(sourceIconHtml("https://drive.google.com/x"), /google-drive-icon\.webp/);
  assert.equal(sourceIconHtml("https://example.com"), "");
});

test("drop router classifies and partitions by extension", () => {
  assert.equal(classifyDroppedFile("a.IPYNB"), "notebook");
  assert.equal(classifyDroppedFile("a.m"), "notebook");
  assert.equal(classifyDroppedFile("a.zip"), "notebook-zip");
  assert.equal(classifyDroppedFile("q.json"), "quiz");
  assert.equal(classifyDroppedFile("x.png"), "unsupported");
  const files = ["1.ipynb", "2.ipynb", "3.m", "4.zip", "q.json", "x.txt"].map((name) => ({ name }));
  const p = partitionDroppedFiles(files);
  assert.equal(p.notebookFiles.length, 4);
  assert.equal(p.quizFiles.length, 1);
  assert.equal(p.unsupported.length, 1);
  assert.equal(baseNameOf("Lecture 1.ipynb"), "Lecture 1");
});

test("dedupeTitle adds (2), (3)…", () => {
  const taken = new Set(["A", "A (2)"]);
  assert.equal(dedupeTitle("A", (t) => taken.has(t)), "A (3)");
  assert.equal(dedupeTitle("B", () => false), "B (2)");
});

test("buildLocalNotebookEntry shape", () => {
  const e = buildLocalNotebookEntry({ rec: { description: " d ", source: "", runtime: "matlab", content: { cells: [{}, {}] } }, title: "T", parentId: "f1", id: "user_notebook_x" });
  assert.equal(e.meta.type, "notebook");
  assert.equal(e.meta.parentId, "f1");
  assert.equal(e.meta.description, "d");
  assert.equal(e.stats.cellCount, 2);
  assert.equal(e.notebook.runtime, "matlab");
});

test("folder counts include notebooks (no more «فارغ» for notebook-only folders)", () => {
  const rows = [
    { id: "f", meta: { type: "folder", parentId: null } },
    { id: "n1", meta: { type: "notebook", parentId: "f" } },
    { id: "n2", meta: { type: "notebook", parentId: "f" } },
    { id: "s", meta: { type: "folder", parentId: "f" } },
    { id: "l", meta: { type: "lesson", parentId: "s" } },
    { id: "q", meta: { parentId: "s" } },
  ];
  const c = getFolderContentsCount(rows, "f");
  assert.deepEqual(c, { subfolderCount: 1, quizCount: 1, lessonCount: 1, notebookCount: 2 });
  assert.equal(formatFolderAndQuizCount(0, 0, 0, 2), "دفتران");
  assert.equal(formatFolderAndQuizCount(0, 0, 0, 0), "فارغ");
  assert.equal(formatFolderAndQuizCount(1, 3, 0, 1), "مجلد واحد · 3 امتحانات · دفتر واحد");
});

test("upload summary names notebooks", () => {
  assert.equal(formatItemCounts({ notebooks: 3 }), "3 دفتر");
  assert.equal(formatItemCounts({ quizzes: 2, lessons: 1, notebooks: 1 }), "2 امتحان و1 درس و1 دفتر");
  assert.equal(formatItemCounts({}), "0 عنصر");
});

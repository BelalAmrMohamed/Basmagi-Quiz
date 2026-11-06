import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/notebook.html", import.meta.url), "utf8");
const editor = await readFile(new URL("../public/src/features/notebook/notebook-editor.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/src/features/notebook/notebook-editor.css", import.meta.url), "utf8");

test("compact notebook metadata retains editor and publishing hooks", () => {
  const ids = [
    "cnbShell", "cnbForm", "cnbHeading", "cnbSave", "cnbTitle", "cnbDescription",
    "cnbSource", "cnbLanguage", "cnbRuntime", "cnbPlacementRow", "cnbCourse",
    "cnbFolder", "cnbSlug", "cnbCompressRow", "cnbCompress", "cnbStorage",
    "cnbIssues", "cnbEditor",
  ];
  for (const id of ids) {
    const idPattern = new RegExp("\\bid=\"" + id + "\"");
    assert.match(html, idPattern, "missing form/editor hook: " + id);
    assert.equal((html.match(new RegExp("\\bid=\"" + id + "\"", "g")) || []).length, 1, "duplicate id: " + id);
  }
  assert.match(html, /id="cnbPlacementRow"[^>]*hidden/);
  assert.match(html, /id="cnbCompressRow"[^>]*hidden/);
  assert.match(html, /id="cnbIssues"[^>]*role="alert"[^>]*aria-live="assertive"/);
  assert.match(editor, /prepareNotebookAssets\([\s\S]*compress: \$\("cnbCompress"\)\.checked/);
  assert.match(editor, /courseId: \$\("cnbCourse"\)\.value, folderId: \$\("cnbFolder"\)\.value/);
  assert.match(editor, /history\.replaceState\(history\.state, "", `\/notebook\/edit\//);
  assert.match(editor, /t\(editId \? "saveEdit" : "save"\)/);
  assert.match(editor, /t\(editId \? "headingEdit" : "heading"\).*Basmagi Quiz/);
});

test("metadata form is concise, localized, accessible, and responsive", () => {
  for (const id of ["cnbLblTitle", "cnbLblDesc", "cnbLblSrc", "cnbLblLang", "cnbLblRuntime", "cnbRuntimeLockNote"]) {
    assert.match(html, new RegExp("\\bid=\"" + id + "\""));
  }
  assert.doesNotMatch(html, /cnbTopDescription|cnbFormIntro|cnbTitleHint|cnbRuntimeHint|cnbRuntimeBadge|cnbCompressHint/);
  assert.match(editor, /runtimeLock:/);
  assert.match(editor, /cnbShell"\)\.setAttribute\("dir"/);
  assert.match(css, /var\(--color-surface\)/);
  assert.match(css, /var\(--color-background\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /\.cnb-field-grid--placement\[hidden\]/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
});

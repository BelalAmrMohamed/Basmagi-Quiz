// The creation guide carries one stable anchor per content type; the helper's keys match them.
// (The creation forms are not wired to it yet.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CREATE_GUIDE_ANCHORS, CREATE_GUIDE_PAGE, createGuideAction, createGuideHref } from "../public/src/shared/create-guide-anchors.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const html = fs.readFileSync(path.join(ROOT, "public/how-to-create-content.html"), "utf8");

test("six content types, each key matching its anchor id", () => {
  assert.deepEqual(Object.keys(CREATE_GUIDE_ANCHORS), ["course", "folder", "quiz", "lesson", "notebook", "youtube"]);
  for (const [key, { id, label }] of Object.entries(CREATE_GUIDE_ANCHORS)) {
    assert.equal(id, `create-${key}`);
    assert.ok(label.ar && label.en, `${key}: needs an Arabic and an English label`);
  }
});

test("every anchor exists exactly once in the generated guide, on a heading with a section stub", () => {
  for (const { id } of Object.values(CREATE_GUIDE_ANCHORS)) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id} must appear once in how-to-create-content.html`);
    assert.match(html, new RegExp(`<h3 id="${id}">[^<]+</h3>\\s*<p>[^<]+</p>`), `#${id} has no heading + stub paragraph`);
  }
});

test("createGuideHref / createGuideAction", () => {
  assert.equal(CREATE_GUIDE_PAGE, "/how-to-create-content");
  assert.equal(createGuideHref("quiz"), "/how-to-create-content#create-quiz");
  assert.equal(createGuideHref("youtube"), "/how-to-create-content#create-youtube");
  assert.equal(createGuideHref("nope"), undefined);
  assert.equal(createGuideHref("toString"), undefined);
  assert.deepEqual(createGuideAction("lesson", "en"), { href: "/how-to-create-content#create-lesson", label: CREATE_GUIDE_ANCHORS.lesson.label.en });
  assert.equal(createGuideAction("lesson").label, CREATE_GUIDE_ANCHORS.lesson.label.ar);
  assert.equal(createGuideAction("nope"), undefined);
});

test("not wired yet: no creation form imports the helper", () => {
  const forms = ["features/create-quiz/create-quiz.js", "features/create-lesson/create-lesson.js", "features/notebook/notebook-editor.js", "features/home/adminUpload.js"];
  for (const f of forms) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "public/src", f), "utf8"), /create-guide-anchors/, `${f} already uses the helper`);
});

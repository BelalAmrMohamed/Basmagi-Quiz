// Source mode of the rich input (create-quiz / create-lesson authoring fields): jsdom.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(path.resolve("runtimes/package.json"));
const { JSDOM } = require("jsdom");

let mountSourceField;
let host;

before(async () => {
  const dom = new JSDOM("<!doctype html><body><textarea id='f' class='md-source wp-textarea' placeholder='اكتب'>$x^2$\n\n  ```py\nprint(1)\n  ```</textarea></body>", { pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "Event", "CustomEvent", "MutationObserver", "DOMParser", "Range", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "KeyboardEvent", "ClipboardEvent", "DocumentFragment", "Text", "HTMLInputElement", "HTMLTextAreaElement"]) {
    try { Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true }); } catch {}
  }
  w.document.createRange = () => ({ setStart() {}, setEnd() {}, getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }), commonAncestorContainer: w.document.body });
  w.Element.prototype.getClientRects = () => [];
  w.Element.prototype.scrollIntoView = () => {};
  globalThis.__RMCI_VENDOR_URL__ = pathToFileURL(path.resolve("public/assets/vendor/tiptap/tiptap.js")).href;
  ({ mountSourceField } = await import("../public/src/shared/rich-input/source-field.js"));
  host = mountSourceField(document.getElementById("f"), { maxHeight: 200 });
  await new Promise((r) => host.addEventListener("rmci-ready", r, { once: true }));
});

test("takes over the textarea: id, classes, no toolbar or bar, no second box", () => {
  assert.equal(host.id, "f");
  assert.ok(host.classList.contains("md-source") && host.classList.contains("wp-textarea"));
  const root = host.closest(".rmci-root");
  assert.ok(root.classList.contains("rmci-root--source"));
  assert.equal(root.querySelector(".rmci-bar"), null);
  assert.equal(root.querySelector(".rmci-toolbar-slot"), null);
  assert.equal(root.querySelector(".rmci-icon-btn"), null);
  assert.equal(document.querySelector("textarea"), null);
});

test("the markdown source is kept verbatim (blank lines, indentation, fences, LaTeX)", () => {
  assert.equal(host.value, "$x^2$\n\n  ```py\nprint(1)\n  ```");
  assert.equal(host.markdown, host.value);
  host.value = "**b** ==h==(red)\n- x\n\n\n  y  ";
  assert.equal(host.value, "**b** ==h==(red)\n- x\n\n\n  y  ");
});

test("replaceRange edits one range as an undoable step and fires input", async () => {
  host.value = "ab\ncd\nef";
  await new Promise((r) => setTimeout(r, 600)); // ProseMirror groups edits closer than 500ms into one undo step
  let inputs = 0;
  host.addEventListener("input", () => inputs++);
  host.replaceRange(1, 4, "X\nY\nZ"); // "b\nc" -> "X\nY\nZ"
  assert.equal(host.value, "aX\nY\nZd\nef");
  assert.equal(host.selectionStart, 1 + "X\nY\nZ".length);
  assert.ok(inputs >= 1);
  assert.equal(host.canHistory("undo"), true);
  host.runHistory("undo");
  assert.equal(host.value, "ab\ncd\nef");
  host.runHistory("redo");
  assert.equal(host.value, "aX\nY\nZd\nef");
});

test("wrapping a selection works through the shared toolbar action", async () => {
  const { applyMarkdownToolbarAction } = await import("../public/src/shared/markdown-toolbar-actions.js");
  host.value = "hello world";
  host.setSelectionRange(0, 5);
  assert.equal(applyMarkdownToolbarAction({ cmd: "bold", textarea: host }), true);
  assert.equal(host.value, "**hello** world");
});

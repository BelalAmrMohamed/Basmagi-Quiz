// Smoke tests for the AI Agent rich input's <textarea> adapter (jsdom).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(path.resolve("runtimes/package.json"));
const { JSDOM } = require("jsdom");

let createRichInput;
let rich;

before(async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "Event", "CustomEvent", "MutationObserver", "DOMParser", "Range", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "KeyboardEvent", "ClipboardEvent", "DocumentFragment", "Text", "HTMLInputElement"]) {
    try { Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true }); } catch {}
  }
  w.document.createRange = () => ({ setStart() {}, setEnd() {}, getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }), commonAncestorContainer: w.document.body });
  w.Element.prototype.getClientRects = () => [];
  w.Element.prototype.scrollIntoView = () => {};
  globalThis.__RMCI_VENDOR_URL__ = pathToFileURL(path.resolve("public/assets/vendor/tiptap/tiptap.js")).href;
  ({ createRichInput } = await import("../public/src/shared/rich-input/rich-input.js"));
  rich = createRichInput({ placeholder: "اسأل", getCommands: () => [{ command: "quiz" }], getMentions: () => [{ name: "امتحاناتي" }] });
  document.body.appendChild(rich.el);
  await rich.ready;
});

test("boots and reports empty", () => {
  assert.ok(rich.editor, "editor created");
  assert.equal(rich.isEmpty(), true);
  assert.equal(rich.textarea.value, "");
});

test("value setter / getter round-trips, multi-line included", () => {
  rich.textarea.value = "hello";
  assert.equal(rich.textarea.value, "hello");
  rich.textarea.value = "line1\nline2";
  assert.equal(rich.textarea.value, "line1\nline2");
  assert.equal(rich.getMarkdown(), "line1\n\nline2");
});

test("selectionStart / setSelectionRange map plain-text offsets", () => {
  rich.textarea.value = "abc\ndef";
  rich.textarea.setSelectionRange(5, 5);
  assert.equal(rich.textarea.selectionStart, 5);
  rich.textarea.setSelectionRange(2, 2);
  assert.equal(rich.textarea.selectionStart, 2);
});

test("mention-style splice keeps the rest of the draft", () => {
  rich.textarea.value = "hi @";
  rich.textarea.setSelectionRange(4, 4);
  const caret = rich.textarea.selectionStart;
  const v = rich.textarea.value;
  rich.textarea.value = v.slice(0, caret - 1) + "@quiz " + v.slice(caret);
  assert.equal(rich.textarea.value, "hi @quiz ");
});

test("programmatic changes are silent, typing fires one synthetic input", () => {
  let n = 0;
  rich.textarea.addEventListener("input", () => n++);
  rich.textarea.value = "silent";
  assert.equal(n, 0);
  rich.editor.commands.insertContent("x");
  assert.equal(n, 1);
});

test("code fence + Enter shortcut is detected as structural; markdown has fence", () => {
  rich.textarea.value = "";
  rich.editor.commands.setContent("<pre><code class=\"language-js\">let a = 1;</code></pre>", { emitUpdate: false });
  assert.equal(rich.enterIsStructural(), true);
  assert.match(rich.getMarkdown(), /^```js\nlet a = 1;\n```$/);
});

test("disabled toggles editability", () => {
  rich.textarea.disabled = true;
  assert.equal(rich.textarea.disabled, true);
  assert.equal(rich.editor.isEditable, false);
  rich.textarea.disabled = false;
  assert.equal(rich.editor.isEditable, true);
});

test("markdown property restores formatting and round-trips", () => {
  rich.textarea.markdown = "**bold** text\n\n- a\n- b";
  assert.equal(rich.getMarkdown(), "**bold** text\n\n- a\n- b");
  assert.equal(rich.textarea.value.trim(), "bold text\na\nb"); // StarterKit appends a trailing empty paragraph
});

test("initialMarkdown set before the editor boots is restored; lockable hides controls via class", async () => {
  const r = createRichInput({ initialMarkdown: "# Hi\n\n`x`", hideControlsWhenDisabled: true });
  document.body.appendChild(r.el);
  assert.equal(r.getMarkdown(), "# Hi\n\n`x`", "readable before boot");
  await r.ready;
  assert.equal(r.getMarkdown(), "# Hi\n\n`x`");
  assert.ok(r.el.classList.contains("rmci-root--lockable"));
  r.textarea.disabled = true;
  assert.ok(r.el.classList.contains("is-disabled"));
  assert.equal(r.editor.isEditable, false);
  r.destroy();
});

test("mountEssayFields swaps the textarea for the rich host and keeps its contract", async () => {
  const { mountEssayFields } = await import("../public/src/shared/rich-input/essay-field.js");
  document.body.insertAdjacentHTML("beforeend", '<div id="w"><textarea data-essay-field id="essayInput-0" class="essay-textarea" oninput="window.handleEssay(0)">**a** b</textarea></div>');
  mountEssayFields(document.getElementById("w"));
  assert.equal(document.querySelector("#w textarea"), null, "textarea replaced");
  const host = document.getElementById("essayInput-0");
  assert.ok(host.classList.contains("rmci-host") && host.classList.contains("essay-textarea"));
  assert.equal(host.markdown, "**a** b", "readable before the editor boots");
  for (let i = 0; i < 100 && !host.closest(".rmci-root").classList.contains("is-ready"); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(host.markdown, "**a** b");
  host.disabled = true;
  assert.equal(host.closest(".rmci-root").classList.contains("is-disabled"), true);
  host.disabled = false;
  // jsdom here doesn't execute inline handlers; what matters is that the attribute moved to the host.
  assert.equal(host.getAttribute("oninput"), "window.handleEssay(0)", "inline oninput forwarded to the host");
  mountEssayFields(document.getElementById("w")); // idempotent
  assert.equal(document.querySelectorAll("#w .rmci-root").length, 1);
});

test("clear() empties the editor", () => {
  rich.textarea.value = "something";
  rich.clear();
  assert.equal(rich.isEmpty(), true);
});

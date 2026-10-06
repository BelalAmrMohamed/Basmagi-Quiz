import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { _processElement } from "../public/src/shared/markdown.js";

function createList() {
  return {
    tagName: "OL",
    direction: null,
    matches: (selector) =>
      selector === "ol.md-list, ul.md-list" ||
      selector === "p, div.md-p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd, div.katex-display",
    getAttribute(name) {
      return name === "dir" ? this.direction : null;
    },
    setAttribute(name, value) {
      if (name === "dir") this.direction = value;
    },
  };
}

test("Markdown list containers use native automatic direction", () => {
  const list = createList();

  _processElement(list);

  assert.equal(list.direction, "auto");
});

test("AI Agent list markers stay inside the text column and follow its direction", () => {
  const css = readFileSync(
    new URL("../public/src/components/ai-agent/ai-agent.css", import.meta.url),
    "utf8"
  );
  assert.match(css, /\.ai-agent-msg \.md-list\s*\{[^}]*padding-inline-start:\s*1\.5em/s);
  assert.match(css, /\.ai-agent-msg \.md-list\s*\{[^}]*list-style-position:\s*inside/s);
  assert.match(css, /\.ai-agent-msg \.md-list\s*>\s*li\s*\{[^}]*text-align:\s*start/s);
});

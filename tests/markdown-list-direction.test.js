import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { _processElement } from "../public/src/shared/markdown.js";

function createList(firstItemText) {
  const firstItem = {
    childNodes: [{ nodeType: 3, textContent: firstItemText }],
  };

  return {
    tagName: "OL",
    direction: null,
    matches: (selector) => selector === "ol.md-list, ul.md-list",
    querySelector: () => firstItem,
    getAttribute(name) {
      return name === "dir" ? this.direction : null;
    },
    setAttribute(name, value) {
      if (name === "dir") this.direction = value;
    },
  };
}

function createListItem(text) {
  return {
    tagName: "LI",
    direction: null,
    matches: (selector) => selector === "li",
    childNodes: [{ nodeType: 3, textContent: text }],
    setAttribute(name, value) {
      if (name === "dir") this.direction = value;
    },
  };
}

test("Markdown list items explicitly use RTL direction for Arabic text", () => {
  const item = createListItem("إدارة الامتحانات والدروس والملفات");

  _processElement(item);

  assert.equal(item.direction, "rtl");
});

test("Markdown list items explicitly use LTR direction for English text", () => {
  const item = createListItem("Create and manage exams");

  _processElement(item);

  assert.equal(item.direction, "ltr");
});

test("Markdown lists explicitly use RTL direction when their first item is Arabic", () => {
  const list = createList("إنشاء وإدارة الامتحانات");

  _processElement(list);

  assert.equal(list.direction, "rtl");
});

test("Markdown lists explicitly use LTR direction when their first item is English", () => {
  const list = createList("Create and manage exams");

  _processElement(list);

  assert.equal(list.direction, "ltr");
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

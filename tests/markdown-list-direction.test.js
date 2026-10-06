import test from "node:test";
import assert from "node:assert/strict";

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
    setAttribute(name, value) {
      if (name === "dir") this.direction = value;
    },
  };
}

test("Markdown lists use RTL direction when the first item is Arabic", () => {
  const list = createList("1. إنشاء وإدارة الامتحانات");

  _processElement(list);

  assert.equal(list.direction, "rtl");
});

test("Markdown lists use LTR direction when the first item is English", () => {
  const list = createList("Create and manage exams");

  _processElement(list);

  assert.equal(list.direction, "ltr");
});

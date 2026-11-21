import test from "node:test";
import assert from "node:assert/strict";
import {
  cornerFromPoint, cornerRect, resolveOverlap, clampToViewport, readCorner,
} from "../public/src/shared/floating-window.js";

test("cornerFromPoint picks the nearest corner", () => {
  assert.equal(cornerFromPoint(10, 10, 1000, 800), "top-left");
  assert.equal(cornerFromPoint(900, 700, 1000, 800), "bottom-right");
  assert.equal(cornerFromPoint(900, 10, 1000, 800), "top-right");
});

test("cornerRect places a pill with margins and bottom inset", () => {
  assert.deepEqual(cornerRect("bottom-right", 300, 48, 1000, 800), { left: 684, top: 736 });
  assert.deepEqual(cornerRect("top-left", 300, 48, 1000, 800), { left: 16, top: 16 });
  assert.equal(cornerRect("bottom-left", 300, 48, 400, 800, { margin: 8, bottomInset: 66 }).top, 678);
});

test("resolveOverlap stacks bottom pills upward and top pills downward", () => {
  const pill = { left: 684, top: 736, width: 300, height: 48 };
  const other = { left: 684, top: 736, width: 300, height: 48 };
  assert.equal(resolveOverlap(pill, [other], "bottom-right", 800).top, 680);
  const topPill = { left: 16, top: 16, width: 300, height: 48 };
  assert.equal(resolveOverlap(topPill, [{ ...topPill }], "top-left", 800).top, 72);
  assert.equal(resolveOverlap(pill, [{ left: 0, top: 0, width: 10, height: 10 }], "bottom-right", 800).top, 736);
});

test("clampToViewport keeps the window reachable", () => {
  assert.deepEqual(clampToViewport(2000, 2000, 300, 48, 1000, 800), { left: 692, top: 744 });
  assert.deepEqual(clampToViewport(-50, -50, 300, 48, 1000, 800), { left: 8, top: 8 });
});

test("readCorner falls back for bad values", () => {
  assert.equal(readCorner("k", "bottom-right", { getItem: () => "nope" }), "bottom-right");
  assert.equal(readCorner("k", "bottom-right", { getItem: () => "top-left" }), "top-left");
});

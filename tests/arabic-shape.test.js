import test from "node:test";
import assert from "node:assert/strict";
import { toVisual, hasArabic } from "../api/_arabicShape.js";

const cps = (s) => Array.from(s).map((c) => c.codePointAt(0).toString(16));

test("joins a dual-joining word and reverses it into visual order", () => {
  // بصمجي → initial ب, medial ص, medial م, medial ج, final ي — then reversed for LTR paint
  assert.deepEqual(cps(toVisual("بصمجي")), ["fef2", "fea0", "fee4", "febc", "fe91"]);
});

test("right-joining letters break the join", () => {
  // دار → د, ا, ر all isolated → plain base letters (the font has no isolated presentation forms)
  assert.deepEqual(cps(toVisual("دار")), ["631", "627", "62f"]);
  // بار → ب initial, ا final (connects back), ر isolated (ا doesn't connect forward)
  assert.deepEqual(cps(toVisual("بار")), ["631", "fe8e", "fe91"]);
});

test("lam-alef ligature, isolated and final", () => {
  assert.deepEqual(cps(toVisual("لا")), ["fefb"]);
  assert.deepEqual(cps(toVisual("بلا")), ["fefc", "fe91"]);
});

test("word order is mirrored; digits and Latin stay left-to-right", () => {
  const out = toVisual("المستوى 12");
  assert.ok(out.startsWith("12 "), out);
  assert.equal(toVisual("a b"), "a b");
  assert.equal(toVisual("Node.js"), "Node.js");
});

test("Latin run inside Arabic keeps internal order and sits in logical position", () => {
  const out = toVisual("مع React و Vue");
  // visual left→right: "Vue" word comes before "و"? — runs are reversed: Vue, و, React, مع
  assert.ok(out.indexOf("Vue") < out.indexOf("React"), out);
});

test("diacritics are stripped", () => {
  assert.equal(toVisual("مُطَوِّر"), toVisual("مطور"));
});

test("brackets are mirrored inside RTL runs", () => {
  const out = toVisual("(مشرف)");
  assert.equal(out[0], "(");
  assert.equal(out[out.length - 1], ")");
});

test("pure LTR text (with trailing ellipsis) is returned unchanged", () => {
  assert.equal(toVisual("Sharing everything with the Basmag…"), "Sharing everything with the Basmag…");
});

test("hasArabic", () => {
  assert.equal(hasArabic("abc"), false);
  assert.equal(hasArabic("a ب"), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { clampSplit, mapDetailsForInfo, readSplit, writeSplit, SPLIT_DEFAULT_LIST } from "../public/src/features/home/youtube-window-utils.js";

test("clampSplit keeps >=320px video and >=180px list", () => {
  assert.equal(clampSplit(100, 900), 180);
  assert.equal(clampSplit(300, 900), 300);
  assert.equal(clampSplit(800, 900), 900 - 8 - 320);
  assert.equal(clampSplit(NaN, 900), 300);
  assert.equal(clampSplit(500, 400), 180); // window too narrow: list minimum wins
});

test("split is remembered and survives broken storage", () => {
  const mem = new Map();
  const ok = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(readSplit(ok), SPLIT_DEFAULT_LIST);
  writeSplit(412.4, ok);
  assert.equal(readSplit(ok), 412);
  const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(readSplit(bad), SPLIT_DEFAULT_LIST);
  assert.doesNotThrow(() => writeSplit(300, bad));
});

test("mapDetailsForInfo tolerates missing fields", () => {
  assert.deepEqual(mapDetailsForInfo(undefined), { publishedAt: "", description: "" });
  assert.deepEqual(mapDetailsForInfo({ publishedAt: "2024-01-02T00:00:00Z", description: "  hi " }), { publishedAt: "2024-01-02T00:00:00Z", description: "hi" });
});

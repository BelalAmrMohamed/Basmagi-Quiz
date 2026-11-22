import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { refreshEmptyState } from "../public/src/components/ai-agent/ai-agent-suggested-prompts.js";

test("empty state is rendered first, suggestion chips after it", () => {
  const calls = [];
  const done = refreshEmptyState({
    historyLength: 0,
    renderEmptyState: () => calls.push("empty"),
    renderSuggestions: () => calls.push("chips"),
  });
  assert.equal(done, true);
  assert.deepEqual(calls, ["empty", "chips"]);
});

test("a conversation with history is left untouched", () => {
  const calls = [];
  const done = refreshEmptyState({
    historyLength: 2,
    renderEmptyState: () => calls.push("empty"),
    renderSuggestions: () => calls.push("chips"),
  });
  assert.equal(done, false);
  assert.deepEqual(calls, []);
});

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("active suggestion tab text is readable (>= 4.5:1) in every theme", () => {
  const css = readFileSync(new URL("../public/src/styles/themes.css", import.meta.url), "utf8");
  const fills = [...css.matchAll(/--color-primary-dark:\s*(#[0-9a-fA-F]{6});\s*\r?\n\s*--color-on-primary:\s*(#[0-9a-fA-F]{6})/g)];
  assert.equal(fills.length, 3, "light, dark and dark-slate each define --color-on-primary");
  for (const [, fill, text] of fills) assert.ok(contrast(fill, text) >= 4.5, `${text} on ${fill}`);
});

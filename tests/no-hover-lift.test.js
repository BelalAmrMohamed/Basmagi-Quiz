// Regression guard for the "buggy hover" issue: a :hover rule must never translate the
// hovered element itself. Moving the element out from under the cursor flips :hover off,
// which moves it back, which flips it on again → flicker (worst when the cursor is near
// a border). Use box-shadow / border / background / filter / top-strip / spotlight instead.
// Scale-up and translating a CHILD of the hovered element are fine and not flagged.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PUBLIC = new URL("../public/", import.meta.url).pathname;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(css|js|html)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function splitTopLevel(sel) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < sel.length; i++) {
    if (sel[i] === "(") depth++;
    else if (sel[i] === ")") depth--;
    else if (sel[i] === "," && depth === 0) { parts.push(sel.slice(start, i)); start = i + 1; }
  }
  parts.push(sel.slice(start));
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** The hovered element is the rule's subject (last compound), not an ancestor of it. */
function subjectIsHovered(selector) {
  return splitTopLevel(selector).some((part) => {
    let depth = 0, last = 0;
    for (let i = 0; i < part.length; i++) {
      if (part[i] === "(") depth++;
      else if (part[i] === ")") depth--;
      else if (" >+~".includes(part[i]) && depth === 0) last = i + 1;
    }
    const subject = part.slice(last);
    return subject.includes(":hover") || subject.includes(".is-revealed");
  });
}

const MOVING = /translate[XYZ]?\((?!\s*-?50%)/i; // centring translates (-50%) don't move on hover

test("no :hover rule translates the hovered element itself", () => {
  const offenders = [];
  for (const file of walk(PUBLIC)) {
    const text = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, " ");
      if (!selector.includes(":hover") && !selector.includes(".is-revealed")) continue;
      if (!subjectIsHovered(selector)) continue;
      const transform = /transform\s*:\s*([^;}]+)/i.exec(m[2]);
      if (!transform || !MOVING.test(transform[1])) continue;
      // Allow rules whose translate is part of a centring pair (e.g. translate(-50%, -50%))
      if (/translate[XY]?\(\s*-?50%/.test(transform[1])) continue;
      // doc-toc peeks OUT toward the cursor on hover (it grows the hit-box, never leaves it)
      if (file.endsWith("doc-toc.css")) continue;
      offenders.push(`${path.relative(PUBLIC, file)} :: ${selector.slice(0, 80)} → ${transform[1].trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

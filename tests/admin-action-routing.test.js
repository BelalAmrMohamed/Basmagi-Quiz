import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// A handler branch in handleItemActions is unreachable unless its action is
// also routed by the default export (ITEM_ACTIONS / CONTROL_ACTIONS). The
// YouTube actions were missing once and fell through to the profile-sync
// handler ("Nothing to sync").
const src = fs.readFileSync(new URL("../api/admin.js", import.meta.url), "utf8");
const setItems = (name) => {
  const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  return new Set([...(m?.[1] || "").matchAll(/"([a-z-]+)"/g)].map((x) => x[1]));
};

test("YouTube admin actions are routed to handleItemActions", () => {
  const items = setItems("ITEM_ACTIONS");
  for (const a of ["publish-youtube", "list-youtube-public", "unpublish-youtube"]) assert.ok(items.has(a), a);
});

test("every youtube/notebook/lesson branch in handleItemActions is routable", () => {
  const body = src.slice(src.indexOf("async function handleItemActions"), src.indexOf("// admin-stats handlers"));
  const dispatched = [...body.matchAll(/action === "([a-z-]+)"/g)].map((m) => m[1]);
  const routed = new Set([...setItems("ITEM_ACTIONS"), ...setItems("CONTROL_ACTIONS")]);
  const missing = dispatched.filter((a) => /youtube|notebook|trash|folder|course|item/.test(a) && !routed.has(a));
  assert.deepEqual(missing, []);
});

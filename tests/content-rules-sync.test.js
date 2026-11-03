import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("public/src/shared/content-rules.js", "utf8");

for (const copy of ["supabase/functions/mcp/content-rules.js", "scripts/lib/content-rules.js"]) {
  test(`content-rules copy is in sync: ${copy}`, () => {
    assert.equal(readFileSync(copy, "utf8"), source, "run `npm run sync:mcp`");
  });
}

test("notebook-convert copy is in sync", () => {
  assert.equal(
    readFileSync("scripts/lib/notebook-convert.js", "utf8"),
    readFileSync("public/src/shared/notebook-convert.js", "utf8"),
    "run `npm run sync:mcp`",
  );
});

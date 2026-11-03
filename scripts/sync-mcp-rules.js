// Copies the shared content rules (single source of truth:
// public/src/shared/content-rules.js) to the two places that cannot import
// from public/src:
//   - supabase/functions/mcp/content-rules.js   (MCP edge function, Deno)
//   - scripts/lib/content-rules.js              (api/ serverless functions — same
//                                                pattern as scripts/lib/quizId.js)
// Run after editing the source file:  npm run sync:mcp
// (tests/content-rules-sync.test.js fails when a copy differs.)
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "public/src/shared/content-rules.js");
const targets = ["supabase/functions/mcp/content-rules.js", "scripts/lib/content-rules.js"];

for (const target of targets) {
  copyFileSync(source, join(root, target));
  console.log(`Synced content-rules.js -> ${target}`);
}

// notebook-convert.js: pure converters used by api/ (upload) and scripts/ (seed).
copyFileSync(join(root, "public/src/shared/notebook-convert.js"), join(root, "scripts/lib/notebook-convert.js"));
console.log("Synced notebook-convert.js -> scripts/lib/notebook-convert.js");

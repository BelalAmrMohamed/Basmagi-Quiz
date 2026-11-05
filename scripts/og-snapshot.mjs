// Renders every OG image type (mocked data) into tests/og-output/ for eyeballing.
//   npm run og:snapshot
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "tests", "og-output");
const r = spawnSync(process.execPath, ["--test", "tests/og-render.test.js"], {
  cwd: root, stdio: "inherit", env: { ...process.env, OG_SNAPSHOT_DIR: out },
});
console.log(`\nPNG snapshots: ${out}`);
process.exit(r.status ?? 1);

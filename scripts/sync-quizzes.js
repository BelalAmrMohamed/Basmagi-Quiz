// =============================================================================
// scripts/sync-quizzes.js
// Pulls un-synced quizzes from Supabase → writes JSON files → rebuilds manifest.
//
// Usage:
//   node scripts/sync-quizzes.js                 ← sync un-synced rows
//   node scripts/sync-quizzes.js --dry-run        ← preview only
//   node scripts/sync-quizzes.js --all            ← sync ALL rows (re-sync)
//   node scripts/sync-quizzes.js --delete-synced  ← also delete synced rows
//   node scripts/sync-quizzes.js --status         ← just show DB row counts
//
// Add to package.json:
//   "sync:quizzes":       "node scripts/sync-quizzes.js",
//   "sync:quizzes:clean": "node scripts/sync-quizzes.js --delete-synced",
//   "sync:status":        "node scripts/sync-quizzes.js --status"
// The command below syncs all quizzes locally and deltes them from the database to emtpy it.
// > node scripts/sync-quizzes.js --all --delete-synced
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { parseDbPath } from "./lib/quizPath.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// ── Load .env.local manually (no dotenv dep needed) ──────────────────────────
function loadEnv() {
  const candidates = [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
    break; // use the first found
  }
}
loadEnv();

// ── Validate env ──────────────────────────────────────────────────────────────
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(red("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_KEY."));
  console.error(
    dim("    Add them to .env.local or set as environment variables."),
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const QUIZZES_DIR = path.join(ROOT, "public", "data", "quizzes");
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const DELETE_SYNCED = args.includes("--delete-synced");
const SYNC_ALL = args.includes("--all");
const STATUS_ONLY = args.includes("--status");

// ── Terminal colors ───────────────────────────────────────────────────────────
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${bold("🔄  بصمجي Quiz Sync — Supabase → Codebase")}`);
  if (DRY_RUN) console.log(yellow("   [DRY RUN — no files will be written]\n"));

  // Status mode — just show counts and exit
  if (STATUS_ONLY) {
    return await showStatus();
  }

  // Fetch rows
  let query = supabase
    .from("quizzes")
    .select("id, path, category, subject, subfolder, filename, data, synced_at, education_type")
    .order("created_at", { ascending: true });

  if (!SYNC_ALL) query = query.is("synced_at", null);

  const { data: rows, error } = await query;
  if (error) {
    console.error(red(`❌  Supabase fetch failed: ${error.message}`));
    process.exit(1);
  }
  if (!rows?.length) {
    console.log(
      green("✅  Nothing to sync — all quizzes are already in the codebase.\n"),
    );
    await showStatus();
    return;
  }

  console.log(cyan(`📦  Found ${rows.length} quiz(zes) to sync.\n`));
  await showStatus();
  console.log();

  const syncedIds = [];
  let written = 0,
    skipped = 0;

  for (const row of rows) {
    let rawPath = row.path;
    let parsed = parseDbPath(rawPath);
    
    if (!parsed && row.education_type === 'University') {
       console.warn(yellow(`   ⚠️  Legacy path detected: ${row.path}, appending University root`));
       rawPath = `University/${row.path}`;
       parsed = parseDbPath(rawPath);
    }
    
    if (!parsed) {
      console.warn(red(`   ⚠️  SKIPPED (unparseable): ${row.path}`));
      skipped++;
      continue;
    }

    const segments = rawPath.split("/");
    const dirPath = path.join(QUIZZES_DIR, ...segments);

    // Security: block path traversal
    if (!path.resolve(dirPath).startsWith(path.resolve(QUIZZES_DIR))) {
      console.warn(red(`   ⚠️  SKIPPED (traversal): ${row.path}`));
      skipped++;
      continue;
    }

    const filePath = path.join(dirPath, row.filename);
    const relPath = path.relative(ROOT, filePath);

    if (fs.existsSync(filePath) && !SYNC_ALL) {
      console.log(yellow(`   ⏭  Exists: ${relPath}`));
      syncedIds.push(row.id);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(cyan(`   [DRY RUN] Would write: ${relPath}`));
      written++;
      continue;
    }

    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(row.data, null, 2), "utf-8");
    console.log(green(`   ✅  ${relPath}`));
    syncedIds.push(row.id);
    written++;
  }

  console.log(`\n   Written: ${green(written)}  Skipped: ${yellow(skipped)}\n`);

  if (DRY_RUN) {
    console.log(yellow("   [DRY RUN complete]\n"));
    return;
  }

  // Mark as synced
  if (syncedIds.length) {
    console.log(`🏷️   Marking ${syncedIds.length} row(s) as synced...`);
    const { error: ue } = await supabase
      .from("quizzes")
      .update({ synced_at: new Date().toISOString() })
      .in("id", syncedIds);
    if (ue) console.warn(yellow(`   ⚠️  Could not mark synced: ${ue.message}`));
    else console.log(green("   ✅  Marked.\n"));
  }

  // Regenerate manifest
  console.log("🔁  Regenerating quiz manifest...");
  try {
    execSync("node scripts/generate-quiz-manifest.js", {
      stdio: "inherit",
      cwd: ROOT,
    });
    console.log(green("   ✅  Manifest done.\n"));
  } catch (e) {
    console.error(red(`   ❌  Manifest failed: ${e.message}`));
    console.error(
      "       Run manually: node scripts/generate-quiz-manifest.js",
    );
  }

  if (DELETE_SYNCED) {
    await deleteSynced();
  } else {
    console.log(dim("   💡  After committing to Git, reclaim Supabase space:"));
    console.log(dim("       node scripts/sync-quizzes.js --delete-synced\n"));
  }

  console.log(bold(green("🎉  Sync complete!\n")));
}

async function showStatus() {
  const { count: total } = await supabase
    .from("quizzes")
    .select("*", { count: "exact", head: true });
  const { count: pending } = await supabase
    .from("quizzes")
    .select("*", { count: "exact", head: true })
    .is("synced_at", null);
  const { count: synced } = await supabase
    .from("quizzes")
    .select("*", { count: "exact", head: true })
    .not("synced_at", "is", null);
  console.log(
    `   ${bold("Supabase:")} ${cyan(total ?? "?")} total  |  ${yellow(pending ?? "?")} pending  |  ${green(synced ?? "?")} synced`,
  );
}

async function deleteSynced() {
  console.log("🗑️   Deleting synced rows from Supabase...");
  const { error, count } = await supabase
    .from("quizzes")
    .delete({ count: "exact" })
    .not("synced_at", "is", null);
  if (error) console.error(red(`   ❌  ${error.message}`));
  else
    console.log(
      green(`   ✅  Deleted ${count ?? "?"} rows. Space reclaimed.\n`),
    );
}

main().catch((e) => {
  console.error(red(`\n❌  ${e.message}`));
  process.exit(1);
});

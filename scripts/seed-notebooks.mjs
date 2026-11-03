// =============================================================================
// scripts/seed-notebooks.mjs
// Idempotent import of the ten online-matlab-compiler lessons as notebooks.
//
//   node scripts/seed-notebooks.mjs --dry-run
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/seed-notebooks.mjs \
//        --course-id <uuid> [--folder-id <uuid>] [--created-by <admin uuid>]
//
// Each notebook carries migration_key "matlab-compiler:<lesson id>" (unique
// index), so re-running updates the existing row in place and never
// duplicates. Image assets are not stored in the database: they ship with the
// runtime under public/assets/notebook-runtime/assets/.
// =============================================================================
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCompilerLesson, compilerLessonToNotebook, COMPILER_LESSON_ORDER } from "./lib/notebook-convert.js";
import { validateNotebook } from "../api/_validateNotebook.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LESSON_DIR = path.join(root, "online-matlab-compiler/apps/web/lessons");
const ASSET_DIR = path.join(root, "public/assets/notebook-runtime/assets");

export function loadSeedNotebooks(dir = LESSON_DIR) {
  const notebooks = readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => compilerLessonToNotebook(parseCompilerLesson(readFileSync(path.join(dir, f), "utf8"))))
    .sort((a, b) => COMPILER_LESSON_ORDER.indexOf(a.sourceLessonId) - COMPILER_LESSON_ORDER.indexOf(b.sourceLessonId));
  return notebooks.map((n) => ({ ...n, valid: validateNotebook(n) }));
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const notebooks = loadSeedNotebooks();
  const missing = [...new Set(notebooks.flatMap((n) => n.assets))].filter((a) => !existsSync(path.join(ASSET_DIR, `${a}.json`)));
  if (missing.length) throw new Error(`Missing runtime assets: ${missing.join(", ")}`);
  if (notebooks.length !== 10) throw new Error(`Expected 10 lessons, found ${notebooks.length}`);

  if (process.argv.includes("--dry-run")) {
    for (const n of notebooks) console.log(`${n.sortOrder}. ${n.migrationKey}  "${n.title}"  cells=${n.content.cells.length} assets=[${n.assets.join(", ")}]`);
    console.log("dry run: nothing written");
    return;
  }

  const courseId = arg("course-id");
  const folderId = arg("folder-id") || null;
  if (!courseId) throw new Error("--course-id is required");
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let created = 0, updated = 0;
  for (const n of notebooks) {
    const row = {
      title: n.valid.title, description: n.valid.description || null, source: n.valid.source || null,
      runtime: n.valid.runtime, content: n.valid.content, slug: n.slug, sort_order: n.sortOrder,
      migration_key: n.migrationKey, course_id: courseId, folder_id: folderId,
    };
    const { data: existing, error: findErr } = await supabase.from("notebooks").select("id").eq("migration_key", n.migrationKey).maybeSingle();
    if (findErr) throw findErr;
    if (existing) {
      const { error } = await supabase.from("notebooks").update({ ...row, updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (error) throw error;
      updated++;
    } else {
      const { error } = await supabase.from("notebooks").insert({ ...row, created_by: arg("created-by") || null });
      if (error) throw error;
      created++;
    }
  }
  console.log(`seed complete: ${created} created, ${updated} updated`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}

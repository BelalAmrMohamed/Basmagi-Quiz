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

export function loadCppSeedNotebooks() {
  const examples = [
    { title: "2D & 3D arrays", slug: "cpp-2d-3d-arrays", sortOrder: 101, content: { schemaVersion: 1, language: "en", cells: [
      { id: "cell-1", type: "markdown", source: "# 2D and 3D arrays\nCreate nested arrays, loop through dimensions, and pass arrays to functions." },
      { id: "cell-2", type: "code", source: "#include <iostream>\nvoid print2d(int a[2][3]) { for(int i=0;i<2;i++){ for(int j=0;j<3;j++) std::cout << a[i][j] << ' '; std::cout << '\\n'; } }" },
      { id: "cell-3", type: "code", source: "int a[2][3]={{1,2,3},{4,5,6}}; print2d(a);" },
      { id: "cell-4", type: "code", source: "int cube[2][2][2]={{{1,2},{3,4}},{{5,6},{7,8}}}; std::cout << cube[1][0][1];" },
    ] } },
    { title: "OOP: classes and polymorphism", slug: "cpp-oop-polymorphism", sortOrder: 102, content: { schemaVersion: 1, language: "en", cells: [
      { id: "cell-1", type: "markdown", source: "# Object oriented programming\nClasses, encapsulation, inheritance, abstract classes, and virtual dispatch." },
      { id: "cell-2", type: "code", source: "#include <iostream>\n#include <vector>\nclass Base { public: virtual int value() const = 0; virtual ~Base()=default; };\nclass Square: public Base { int side; public: explicit Square(int s):side(s){} int value() const override {return side*side;} };\nclass Cube: public Base { int side; public: explicit Cube(int s):side(s){} int value() const override {return side*side*side;} };" },
      { id: "cell-3", type: "code", source: "std::vector<Base*> shapes={new Square(3),new Cube(2)}; for(auto* s:shapes) std::cout << s->value() << ' '; for(auto* s:shapes) delete s;" },
    ] } },
  ];
  return examples.map((n) => ({ ...n, migrationKey: `cpp-seed:${n.slug}`, runtime: "cpp", description: "C++17 notebook", source: "", valid: validateNotebook({ ...n, runtime: "cpp", description: "C++17 notebook", source: "" }) }));
}

export function loadSeedNotebooks(dir = LESSON_DIR) {
  const notebooks = readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => compilerLessonToNotebook(parseCompilerLesson(readFileSync(path.join(dir, f), "utf8"))))
    .sort((a, b) => COMPILER_LESSON_ORDER.indexOf(a.sourceLessonId) - COMPILER_LESSON_ORDER.indexOf(b.sourceLessonId));
  return [...notebooks.map((n) => ({ ...n, valid: validateNotebook(n) })), ...loadCppSeedNotebooks()];
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const notebooks = loadSeedNotebooks();
  const missing = [...new Set(notebooks.flatMap((n) => n.assets))].filter((a) => !existsSync(path.join(ASSET_DIR, `${a}.json`)));
  if (missing.length) throw new Error(`Missing runtime assets: ${missing.join(", ")}`);
  if (notebooks.filter(n => n.runtime === "matlab").length !== 10) throw new Error(`Expected 10 MATLAB lessons`);

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

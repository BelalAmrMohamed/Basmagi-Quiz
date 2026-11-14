import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".js")) out.push(full);
  }
  return out;
}

test("migration hides quizzes.password from browsers and adds the safe pieces", () => {
  const sql = readFileSync(
    path.join(root, "supabase/migrations/20261114120000_quiz_password_private.sql"),
    "utf8",
  );
  assert.match(sql, /REVOKE SELECT ON public\.quizzes FROM anon, authenticated/);
  const grant = sql.match(/GRANT SELECT \(([\s\S]*?)\) ON public\.quizzes TO anon, authenticated/);
  assert.ok(grant, "column-level GRANT is present");
  assert.doesNotMatch(grant[1], /\bpassword\b/);
  assert.match(sql, /CREATE VIEW public\.quiz_public/);
  assert.match(sql, /password_protected/);
  assert.match(sql, /FUNCTION public\.verify_quiz_password/);
});

test("browser code never selects the quizzes.password column", () => {
  // quizManifest.js keeps one legacy query for the window before the migration
  // is applied; it reduces the value to a boolean on the spot.
  const allowed = new Set(["public/src/shared/quizManifest.js"]);
  const pattern = /from\(\s*["']quizzes["']\s*\)\s*\.select\(\s*[`"'][^`"']*\bpassword\b/;
  const offenders = walk(path.join(root, "public/src"))
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .filter((rel) => !allowed.has(rel))
    .filter((rel) => pattern.test(readFileSync(path.join(root, rel), "utf8")));
  assert.deepEqual(offenders, []);
});

test("anon-keyed API code reads password_protected from quiz_public", () => {
  for (const file of ["api/_catalog.js", "api/render-course.js"]) {
    const src = readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(src, /select\(\s*"[^"]*\bpassword\b(?!_)/, file);
    assert.match(src, /quiz_public/, file);
  }
});

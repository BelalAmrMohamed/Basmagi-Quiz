import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { resolveCourse, resolveFolderPath } from "../api/_courseFolders.js";
import { buildDbColumns, buildDbPath, parseDbPath } from "./lib/quizPath.js";
import { generateQuizId } from "./lib/quizId.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const QUIZZES_DIR = path.join(ROOT, "public", "data", "quizzes");
const REPORT_PATH = path.join(ROOT, "scripts", "migration-local-quizzes-report.json");
const DRY_RUN = process.argv.includes("--dry-run");

async function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const fullPath = path.join(ROOT, file);
    try {
      const contents = await fs.readFile(fullPath, "utf8");
      for (const line of contents.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
        }
      }
      return;
    } catch (_) {}
  }
}

function inferQuestionType(question) {
  if (!Array.isArray(question.options) || question.options.length === 0) return "Essay";
  if (question.options.length === 2) return "True/False";
  return "MCQ";
}

function computeStats(questions) {
  return {
    questionCount: questions.length,
    questionTypes: [...new Set(questions.map(inferQuestionType))].sort(),
  };
}

function normalizeQuiz(raw, canonicalPath, fallbackTitle) {
  const oldMeta = raw.meta || raw.metadata || {};
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  const meta = {
    ...oldMeta,
    title: String(raw.title || oldMeta.title || fallbackTitle).trim(),
    id: oldMeta.id || generateQuizId(canonicalPath),
    path: canonicalPath,
  };
  delete meta.password;
  return { meta, stats: computeStats(questions), questions };
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  }));
  return nested.flat();
}

function parseLocalFile(filePath) {
  const relative = path.relative(QUIZZES_DIR, filePath).split(path.sep).join("/");
  const lastSlash = relative.lastIndexOf("/");
  if (lastSlash < 1 || !relative.toLowerCase().endsWith(".json")) return null;
  const dbPath = relative.slice(0, lastSlash);
  const filename = relative.slice(lastSlash + 1);
  const parsed = parseDbPath(dbPath, filename);
  if (!parsed) throw new Error(`Unrecognized quiz path: ${relative}`);
  return { relative, filename, parsed };
}

async function findCourse(supabase, placement) {
  let query = supabase
    .from("courses")
    .select("id, name")
    .eq("education_type", placement.education_type)
    .eq("name", placement.course);
  if (placement.education_type === "University") query = query.eq("college", placement.college).eq("year", Number(placement.year)).eq("term", Number(placement.term));
  else if (["Primary", "Middle", "High"].includes(placement.education_type)) query = query.is("college", null).eq("year", Number(placement.year)).eq("term", Number(placement.term));
  else query = query.is("college", null).is("year", null).is("term", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function findFolder(supabase, courseId, segments) {
  if (!segments.length) return null;
  let parentId = null;
  for (const name of segments) {
    let query = supabase.from("folders").select("id").eq("course_id", courseId).eq("name", name);
    query = parentId ? query.eq("parent_folder_id", parentId) : query.is("parent_folder_id", null);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return null;
    parentId = data.id;
  }
  return parentId;
}

async function main() {
  await loadEnv();
  if (!DRY_RUN && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY.");
  }
  const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;
  const files = (await walk(QUIZZES_DIR)).filter((filePath) => filePath.toLowerCase().endsWith(".json"));
  const report = { generatedAt: new Date().toISOString(), dryRun: DRY_RUN, sourceCount: files.length, created: [], skipped: [], failed: [] };
  const courseCache = new Map();
  const folderCache = new Map();

  for (const filePath of files.sort()) {
    let source;
    try {
      source = parseLocalFile(filePath);
      if (!source) continue;
      const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
      const canonicalPath = `quizzes/${source.relative}`;
      const quiz = normalizeQuiz(raw, canonicalPath, path.basename(source.filename, ".json"));
      const { parsed } = source;
      const subfolder = parsed.subfolders.join("/") || undefined;
      const dbPath = buildDbPath({ education_type: parsed.education_type, college: parsed.college, year: parsed.year, term: parsed.term, subject: parsed.course, subfolder });
      const dbCols = buildDbColumns(parsed);
      const courseKey = [parsed.education_type, parsed.college || "", parsed.year || "", parsed.term || "", parsed.course].join("\u0000");
      let course = courseCache.get(courseKey);
      if (!course) {
        course = DRY_RUN ? await findCourse(supabase, parsed) : await resolveCourse(supabase, {
          educationType: parsed.education_type,
          college: parsed.college || null,
          year: parsed.year || null,
          term: parsed.term || null,
          name: parsed.course,
        });
        if (!course && DRY_RUN) {
          course = { id: `dry-run:${courseKey}`, name: parsed.course, wouldCreate: true };
        }
        courseCache.set(courseKey, course);
      }
      const folderKey = `${course?.id || courseKey}\u0000${parsed.subfolders.join("/")}`;
      let folderId = folderCache.get(folderKey);
      if (folderId === undefined) {
        folderId = DRY_RUN && course.wouldCreate
          ? (parsed.subfolders.length ? `dry-run:${folderKey}` : null)
          : DRY_RUN
            ? await findFolder(supabase, course.id, parsed.subfolders)
            : await resolveFolderPath(supabase, { courseId: course.id, segments: parsed.subfolders });
        folderCache.set(folderKey, folderId);
      }
      let existing = null;
      if (supabase && !course.wouldCreate) {
        let duplicateQuery = supabase
          .from("quizzes")
          .select("id")
          .eq("course_id", course.id)
          .eq("title", quiz.meta.title);
        duplicateQuery = folderId
          ? duplicateQuery.eq("folder_id", folderId)
          : duplicateQuery.is("folder_id", null);
        const { data, error } = await duplicateQuery.maybeSingle();
        if (error) throw error;
        existing = data;
      }
      const record = { localPath: source.relative, courseId: course?.id || null, folderId: folderId || null, quizId: quiz.meta.id, title: quiz.meta.title, dbPath, filename: source.filename, ...(course?.wouldCreate && { courseWouldBeCreated: true }) };
      if (existing) report.skipped.push({ ...record, reason: "duplicate title at same course/folder" });
      else if (DRY_RUN) report.created.push(record);
      else {
        const { data, error } = await supabase.from("quizzes").insert({ path: dbPath, filename: source.filename, title: quiz.meta.title, data: quiz, education_type: parsed.education_type, college: dbCols.college || null, year: dbCols.year || null, term: dbCols.term || null, category: dbCols.category, subject: dbCols.subject, subfolder: dbCols.subfolder, course_id: course.id, folder_id: folderId || null }).select("id").single();
        if (error) throw error;
        report.created.push({ ...record, databaseId: data.id });
      }
    } catch (error) {
      report.failed.push({ localPath: source?.relative || path.relative(ROOT, filePath), reason: error.message });
    }
  }
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ report: path.relative(ROOT, REPORT_PATH), sourceCount: report.sourceCount, created: report.created.length, skipped: report.skipped.length, failed: report.failed.length, dryRun: DRY_RUN }, null, 2));
  if (report.failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

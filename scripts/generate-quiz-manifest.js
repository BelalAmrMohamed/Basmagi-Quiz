// scripts/generate-quiz-manifest.js
// Run: node scripts/generate-quiz-manifest.js
//
// Two responsibilities in one pass:
//  1. Enrich each local quiz JSON file in-place:
//     - Migrate old schema → new (meta + stats + questions)
//     - Recompute stats.questionCount and stats.questionTypes
//     - Set/update meta.path (canonical path for ID stability)
//     - Set meta.title from filename if missing
//     - Do NOT overwrite meta.id or meta.createdAt if they already exist
//  2. Build quiz-manifest.json in the new subjects format.
// ========================================================================
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { generateQuizId } from "./lib/quizId.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Question type inference ──────────────────────────────────────────────────
function inferQuestionType(q) {
  if (!Array.isArray(q.options) || q.options.length === 0) return "Essay";
  if (q.options.length === 2) return "True/False";
  return "MCQ";
}

function computeStats(questions) {
  const types = new Set(questions.map(inferQuestionType));
  return {
    questionCount: questions.length,
    questionTypes: Array.from(types).sort(),
  };
}

/** Copy optional per-question fields used by large-format / language exams. */
function copyOptionalQuestionFields(q, out) {
  if (q.image?.trim()) out.image = q.image.trim();
  if (q.audio?.trim()) out.audio = q.audio.trim();
  if (q.video?.trim()) out.video = q.video.trim();
  if (q.passage?.trim()) out.passage = q.passage.trim();
  if (q.lang?.trim()) out.lang = q.lang.trim();
  if (q.explanation?.trim()) out.explanation = q.explanation.trim();
}

/** Normalize a single question to the canonical schema. */
function sanitizeQuestion(q) {
  const out = {};
  if (q.q) out.q = q.q;
  copyOptionalQuestionFields(q, out);

  if (Array.isArray(q.options) && q.options.length === 1) {
    out.answer = q.options[0] || q.answer || "";
  } else if (Array.isArray(q.options) && q.options.length > 1) {
    out.options = q.options;
    if (q.correct !== undefined && q.correct !== null)
      out.correct = q.correct;
  } else if (q.answer !== undefined) {
    out.answer = q.answer;
  } else if (Array.isArray(q.options)) {
    out.options = q.options;
    if (q.correct !== undefined && q.correct !== null)
      out.correct = q.correct;
  }

  return out;
}

// ─── Schema migration ─────────────────────────────────────────────────────────
/**
 * Migrate a quiz object (any old format) to the new canonical schema.
 * Preserves existing meta.id and meta.createdAt.
 * Does NOT set meta.path or meta.id — caller handles those.
 */
function migrateQuiz(raw) {
  const oldMeta = raw.meta || raw.metadata || {};
  const questions = (raw.questions || []).map(sanitizeQuestion);

  // Already new format?
  if (raw.meta && raw.questions && !raw.title && !raw.metadata) {
    const meta = { ...raw.meta };
    if (oldMeta.lang?.trim()) meta.lang = oldMeta.lang.trim();
    return {
      meta,
      stats: computeStats(questions),
      questions,
    };
  }

  const meta = {};

  // --- title ---
  // Old formats: raw.title, raw.meta.title, raw.metadata.title
  meta.title =
    (typeof raw.title === "string" && raw.title.trim()) ||
    (typeof oldMeta.title === "string" && oldMeta.title.trim()) ||
    "Untitled";

  // --- description ---
  const desc =
    oldMeta.description ||
    (typeof raw.description === "string" ? raw.description : undefined);
  if (desc && desc.trim()) meta.description = desc.trim();

  // --- source ---
  const src = raw.source || oldMeta.source;
  if (src && typeof src === "string" && src.trim()) meta.source = src.trim();

  // --- author ---
  const author = oldMeta.author || raw.author;
  if (author && typeof author === "string" && author.trim())
    meta.author = author.trim();

  // --- author_email ---

  const author_email = oldMeta.author_email || raw.author_email;
  if (author_email && typeof author_email === "string" && author_email.trim())
    meta.author_email = author_email.trim();

  // --- password ---

  const password = oldMeta.password || raw.password;
  if (password && typeof password === "string" && password.trim())
    meta.password = password.trim();

  // --- preserve id and createdAt ---
  if (oldMeta.id) meta.id = oldMeta.id;
  if (oldMeta.createdAt) meta.createdAt = oldMeta.createdAt;
  if (oldMeta.lang?.trim()) meta.lang = oldMeta.lang.trim();

  return {
    meta,
    stats: computeStats(questions),
    questions,
  };
}

function titleCase(name) {
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  let hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${year}/${month}/${day} | ${hours}:${minutes} ${ampm}`;
}

// ─── Directory walker ─────────────────────────────────────────────────────────
async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => {
      const res = path.resolve(dir, e.name);
      return e.isDirectory() ? walk(res) : res;
    }),
  );
  return Array.prototype.concat(...files);
}

// ─── Main build function ──────────────────────────────────────────────────────
async function build(examsDir, repoRoot) {
  // subjectsMap: courseKey → { id, name, faculty, year, term, quizzes[] }
  const subjectsMap = new Map();

  // public/data/ directory (used as base for relative path computation)
  const dataDir = path.join(repoRoot, "public", "data");

  /**
   * Scan directory tree with depth tracking.
   * Depth 0 = Faculty, 1 = Year, 2 = Term, 3 = Course, 4+ = Subfolder
   */
  async function scanDir(dir, depth = 0, metadata = {}) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (depth === 0) {
          console.log(`  📁 Faculty: ${entry.name}`);
          await scanDir(fullPath, 1, { faculty: entry.name });
        } else if (depth === 1) {
          console.log(`    📅 Year: ${entry.name}`);
          await scanDir(fullPath, 2, { ...metadata, year: entry.name });
        } else if (depth === 2) {
          console.log(`      📆 Term: ${entry.name}`);
          await scanDir(fullPath, 3, { ...metadata, term: entry.name });
        } else if (depth === 3) {
          // Course root
          const courseKey = `${metadata.faculty}/${metadata.year}/${metadata.term}/${entry.name}`;
          const courseRelDir = `quizzes/${courseKey}`;
          const courseId = generateQuizId(courseRelDir);

          console.log(`        📚 Course: ${entry.name} (ID: ${courseId})`);

          subjectsMap.set(courseKey, {
            id: courseId,
            name: entry.name,
            faculty: metadata.faculty,
            year: parseInt(metadata.year, 10),
            term: parseInt(metadata.term, 10),
            quizzes: [],
          });

          await scanDir(fullPath, 4, {
            ...metadata,
            courseName: entry.name,
            courseKey,
            subfolderPath: null,
          });
        } else {
          // Subfolder (depth 4+)
          const sfPath = metadata.subfolderPath
            ? `${metadata.subfolderPath}/${entry.name}`
            : entry.name;
          console.log(`          📂 Subfolder: ${sfPath}`);
          await scanDir(fullPath, depth + 1, {
            ...metadata,
            subfolderPath: sfPath,
          });
        }
      } else if (entry.name.endsWith(".json") || entry.name.endsWith(".js")) {
        if (depth < 4 || !metadata.courseKey) {
          if (depth < 4)
            console.warn(
              `WARNING: Quiz "${entry.name}" found at depth ${depth}, skipping`,
            );
          continue;
        }

        const fileName = entry.name;
        const isJson = fileName.toLowerCase().endsWith(".json");
        const baseName = fileName.replace(/\.(json|js)$/i, "");
        const otherExt = isJson ? ".js" : ".json";
        const hasOther = entries.some((e) => e.name === baseName + otherExt);
        if (!isJson && hasOther) continue; // prefer .json over .js

        // Canonical relative path from public/data/ (always .json)
        const canonicalRelPath = path
          .relative(dataDir, fullPath)
          .split(path.sep)
          .join("/")
          .replace(/\.js$/, ".json");

        // Remove "quizzes/" prefix to get the path segment stored in meta.path
        // Actually canonical form IS "quizzes/..."
        const examId = generateQuizId(canonicalRelPath);

        // ── Enrich quiz file in-place ──────────────────────────────────────
        let quizObj;
        try {
          const raw = JSON.parse(await fs.readFile(fullPath, "utf8"));
          quizObj = migrateQuiz(raw);
        } catch (e) {
          console.warn(`WARNING: Could not parse ${fullPath}: ${e.message}`);
          continue;
        }

        // Set/update fields
        if (!quizObj.meta.id) {
          quizObj.meta.id = examId;
        }
        if (!quizObj.meta.createdAt) {
          quizObj.meta.createdAt = new Date()
            .toISOString()
            .slice(0, 16)
            .replace("T", " - ");
        }
        if (!quizObj.meta.title || quizObj.meta.title === "Untitled") {
          quizObj.meta.title = titleCase(baseName);
        }
        // Always update path and stats (they must be accurate)
        quizObj.meta.path = canonicalRelPath;
        quizObj.stats = computeStats(quizObj.questions);

        // Write enriched file back (only if changed)
        const enriched = JSON.stringify(quizObj, null, 2);
        const existing = await fs.readFile(fullPath, "utf8").catch(() => null);
        if (existing !== enriched) {
          // Write as .json (rename .js → .json if needed)
          const writePath = fullPath.replace(/\.js$/, ".json");
          await fs.writeFile(writePath, enriched, "utf8");
          if (!isJson) {
            // Remove old .js file
            await fs.unlink(fullPath).catch(() => {});
          }
          console.log(`            ✏️  Enriched: ${path.basename(writePath)}`);
        }

        // ── Build path for manifest ─────────────────────────────────────────
        // Store as an absolute-from-root path ("/data/quizzes/...")
        // so quiz.js can fetch with: new URL(path, window.location.origin)
        // regardless of where quiz.js itself lives.
        const dataRelPath =
          "/data/" +
          path
            .relative(
              path.join(repoRoot, "public", "data"),
              fullPath.replace(/\.js$/, ".json"),
            )
            .split(path.sep)
            .join("/");

        const title = quizObj.meta.title || titleCase(baseName);
        const stats = quizObj.stats;

        console.log(`            📝 Quiz: ${title} (ID: ${quizObj.meta.id})`);

        const quizEntry = {
          id: quizObj.meta.id,
          title,
          path: dataRelPath,
          questionCount: stats.questionCount,
          questionTypes: stats.questionTypes,
        };

        // Optional manifest fields
        if (quizObj.meta.description)
          quizEntry.description = quizObj.meta.description;
        if (quizObj.meta.author) quizEntry.author = quizObj.meta.author;
        if (quizObj.meta.author_email) quizEntry.author_email = quizObj.meta.author_email;
        if (quizObj.meta.password) quizEntry.password = quizObj.meta.password;
        if (quizObj.meta.source) quizEntry.source = quizObj.meta.source;
        if (quizObj.meta.createdAt)
          quizEntry.createdAt = quizObj.meta.createdAt;
        if (quizObj.meta.lang) quizEntry.lang = quizObj.meta.lang;

        const subject = subjectsMap.get(metadata.courseKey);
        if (subject) {
          subject.quizzes.push(quizEntry);
        } else {
          console.warn(`WARNING: Subject "${metadata.courseKey}" not found`);
        }
      }
    }
  }

  console.log("\n🔍 Scanning exam directory structure...\n");
  await scanDir(examsDir);
  console.log("\n✅ Scan complete!\n");

  return Array.from(subjectsMap.values());
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function generate() {
  const repoRoot = path.resolve(__dirname, "..");
  const examsDir = path.join(repoRoot, "public", "data", "quizzes");
  const outputDir = path.join(repoRoot, "public", "data");

  console.log("📦 Starting exam manifest generation...");
  console.log(`📂 Exams directory: ${examsDir}`);
  console.log(`📂 Output directory: ${outputDir}\n`);

  const subjects = await build(examsDir, repoRoot);

  // ── Duplicate ID checks ────────────────────────────────────────────────────
  const quizIdCounts = {};
  const subjectIdCounts = {};

  for (const subject of subjects) {
    if (subject.id) {
      subjectIdCounts[subject.id] = (subjectIdCounts[subject.id] || 0) + 1;
    }
    for (const quiz of subject.quizzes) {
      quizIdCounts[quiz.id] = (quizIdCounts[quiz.id] || 0) + 1;
    }
  }

  const quizDuplicates = Object.entries(quizIdCounts).filter(([, c]) => c > 1);
  const subjectDuplicates = Object.entries(subjectIdCounts).filter(
    ([, c]) => c > 1,
  );

  if (quizDuplicates.length > 0) {
    console.error("❌ ERROR: Duplicate quiz IDs found:");
    quizDuplicates.forEach(([id, count]) =>
      console.error(`  - "${id}" appears ${count} times`),
    );
    process.exit(1);
  }

  if (subjectDuplicates.length > 0) {
    console.error("❌ ERROR: Duplicate subject IDs found:");
    subjectDuplicates.forEach(([id, count]) =>
      console.error(`  - "${id}" appears ${count} times`),
    );
    process.exit(1);
  }

  // ── Write manifest ─────────────────────────────────────────────────────────
  const totalQuizzes = subjects.reduce((sum, s) => sum + s.quizzes.length, 0);

  const payload = {
    generatedAt: new Date().toISOString(),
    dataRoot: "data/quizzes",
    subjects,
  };

  const outFile = path.join(outputDir, "quiz-manifest.json");
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");

  console.log("✅ Success!");
  console.log(`📄 Wrote: ${outFile}`);
  console.log(
    `📊 Generated ${totalQuizzes} quizzes across ${subjects.length} subjects\n`,
  );

  // Summary
  const faculties = new Set(subjects.map((s) => s.faculty).filter(Boolean));
  const years = new Set(subjects.map((s) => s.year).filter(Boolean));
  const terms = new Set(subjects.map((s) => s.term).filter(Boolean));

  console.log("📈 Summary:");
  console.log(`   • Subjects: ${subjects.length}`);
  console.log(`   • Total Quizzes: ${totalQuizzes}`);
  console.log(`\n🏫 Metadata Coverage:`);
  console.log(`   • Faculties: ${Array.from(faculties).sort().join(", ")}`);
  console.log(`   • Years: ${Array.from(years).sort().join(", ")}`);
  console.log(`   • Terms: ${Array.from(terms).sort().join(", ")}`);
  console.log("Generated at: " + formatDateTime());
}

generate().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});

// public/src/shared/quiz-json.js
// JSON-only quiz import/export helpers. Document/text parsers were removed —
// quizzes are authored and exchanged as JSON.
import { generateQuizId } from "./quizId.js";

/**
 * Parse quiz JSON text into { questions, meta }.
 * Accepts: `{ questions, meta? }`, `{ title, questions }`, or a bare questions array.
 *
 * @param {string} content
 * @param {string} [defaultTitle]
 * @returns {{ questions: Array, meta: object|null }}
 */
export function parseQuizJson(content, defaultTitle = "") {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw new Error("Empty JSON content");

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (e) {
    throw new Error("JSON parse error: " + e.message);
  }

  if (Array.isArray(data)) {
    return {
      questions: data,
      meta: defaultTitle ? { title: defaultTitle } : null,
    };
  }

  if (!data || typeof data !== "object") {
    throw new Error("JSON must be an object or an array of questions");
  }

  const questions = Array.isArray(data.questions) ? data.questions : null;
  if (!questions) throw new Error("No questions array found in the provided JSON");

  const meta =
    data.meta ||
    (data.title
      ? { title: data.title, description: data.description || "", source: data.source || "" }
      : defaultTitle
        ? { title: defaultTitle }
        : null);

  return { questions, meta };
}

/**
 * Read and parse a .json quiz File.
 *
 * @param {File} file
 * @param {string} [defaultTitle]
 * @returns {Promise<{ questions: Array, meta: object|null }>}
 */
export async function processQuizJsonFile(file, defaultTitle = "") {
  const name = (file?.name || "").toLowerCase();
  if (!name.endsWith(".json")) {
    throw new Error("Only JSON quiz files are supported");
  }

  try {
    const text = await file.text();
    return parseQuizJson(text, defaultTitle);
  } catch (e) {
    throw new Error(`Failed to read ${file.name}: ${e.message}`);
  }
}

/**
 * Build a full JSON export payload for a quiz.
 *
 * @param {string}  title
 * @param {string}  description
 * @param {string}  source
 * @param {Array}   questions
 * @param {string|null} [createdAt]
 * @returns {Promise<object>}
 */
export async function buildJsonQuizExport(
  title,
  description,
  source,
  questions,
  createdAt = null,
) {
  const exportQuestions = questions.map((q) => {
    const out = { q: q.q };
    if (q.image?.trim()) out.image = q.image;
    if (Array.isArray(q.options) && q.options.length === 1) {
      out.answer = q.options[0] || "";
    } else if (!Array.isArray(q.options) || q.options.length === 0) {
      out.answer = q.answer || "";
    } else {
      out.options = q.options;
      if (q.correct !== undefined && q.correct !== null) out.correct = q.correct;
    }
    if (q.explanation?.trim()) out.explanation = q.explanation;
    return out;
  });

  const safeFilename = (title || "quiz")
    .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  const statsTypes = new Set();
  exportQuestions.forEach((q) => {
    if (!Array.isArray(q.options) || q.options.length === 0) statsTypes.add("Essay");
    else if (q.options.length === 2) statsTypes.add("True/False");
    else statsTypes.add("MCQ");
  });

  const meta = {
    id: await generateQuizId(`quizzes/draft/${safeFilename}.json`),
    title: title || "",
    createdAt:
      createdAt || new Date().toISOString().slice(0, 16).replace("T", " - "),
  };
  if (description?.trim()) meta.description = description.trim();
  if (source?.trim()) meta.source = source.trim();

  return {
    meta,
    stats: {
      questionCount: exportQuestions.length,
      questionTypes: Array.from(statsTypes).sort(),
    },
    questions: exportQuestions,
  };
}

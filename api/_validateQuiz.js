// =============================================================================
// api/_validateQuiz.js
// Validates and sanitizes quiz JSON payloads (new schema: meta + stats + questions).
// All validation is whitelist-based (unknown keys are REJECTED, not stripped).
// =============================================================================

const MAX_SIZE_BYTES = 50_000; // 50 KB hard cap per quiz file

const ALLOWED_TOP_KEYS = new Set(["meta", "stats", "questions"]);

const ALLOWED_META_KEYS = new Set([
  "id",
  "title",
  "description",
  "source",
  "path",
  "createdAt",
  "author",
  "author_email",
  "author_handle",
  "password",
  "view",
  "mode",
]);

const ALLOWED_STATS_KEYS = new Set(["questionCount", "questionTypes"]);

const ALLOWED_QUESTION_KEYS = new Set([
  "q",
  "image",
  "audio",
  "video",
  "options",
  "correct",
  "explanation",
  "answer",
]);

// Base32-style 8-character ID: uppercase A-Z plus digits 2-7
const ID_REGEX = /^[A-Z2-7]{8}$/;

// Basic URL validation
const URL_REGEX = /^https?:\/\/.{3,}/;

// Only allow Arabic letters, Latin letters, digits, spaces, hyphens, slashes, dots
const SAFE_PATH_REGEX = /^[\u0600-\u06FF\w\s\-\/\.]+$/u;

// ─── Question type inference ──────────────────────────────────────────────────
/**
 * Infer the type of a single question.
 * @param {object} q
 * @returns {"MCQ"|"True/False"|"Essay"}
 */
export function inferQuestionType(q) {
  if (!Array.isArray(q.options) || q.options.length === 0) return "Essay";
  if (q.options.length === 2) return "True/False";
  return "MCQ";
}

/**
 * Compute { questionCount, questionTypes } from a questions array.
 * @param {Array} questions
 * @returns {{ questionCount: number, questionTypes: string[] }}
 */
export function computeStats(questions) {
  const types = new Set();
  for (const q of questions) {
    types.add(inferQuestionType(q));
  }
  return {
    questionCount: questions.length,
    questionTypes: Array.from(types).sort(),
  };
}

// ─── Main payload validator ───────────────────────────────────────────────────
/**
 * Validates and sanitizes a quiz JSON payload (new schema).
 * Returns a clean copy with recomputed stats. Throws a typed Error on violation.
 *
 * @param {unknown} raw - The raw parsed body from the request
 * @returns {object} sanitized quiz object
 */
export function validateQuizPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("INVALID_PAYLOAD: must be a JSON object");
  }

  // 1. Size check
  const serialized = JSON.stringify(raw);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SIZE_BYTES) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }

  // 2. Re-parse to kill prototype pollution & non-serializable values
  const quiz = JSON.parse(serialized);

  // 3. Top-level key whitelist
  for (const key of Object.keys(quiz)) {
    if (!ALLOWED_TOP_KEYS.has(key)) {
      throw new Error(`INVALID_KEY: "${key}" is not permitted at top level`);
    }
  }

  // ── 4. Validate meta ────────────────────────────────────────────────────────
  const meta = quiz.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    throw new Error("MISSING_FIELD: meta object is required");
  }
  for (const key of Object.keys(meta)) {
    if (!ALLOWED_META_KEYS.has(key)) {
      throw new Error(`INVALID_META_KEY: "${key}" is not permitted in meta`);
    }
  }

  // meta.id — required, must match ID format
  if (typeof meta.id !== "string" || !ID_REGEX.test(meta.id)) {
    throw new Error(
      "INVALID_META: id must be an 8-character uppercase base32 string (A-Z, 2-7)",
    );
  }

  // meta.title — required
  if (typeof meta.title !== "string" || !meta.title.trim()) {
    throw new Error("MISSING_META_FIELD: title is required in meta");
  }
  if (meta.title.trim().length > 200) {
    throw new Error("INVALID_META_FIELD: title exceeds 200 characters");
  }

  // meta.description — optional string
  if (meta.description !== undefined) {
    if (typeof meta.description !== "string") {
      throw new Error("INVALID_META_FIELD: description must be a string");
    }
    if (meta.description.length > 1000) {
      throw new Error(
        "INVALID_META_FIELD: description exceeds 1000 characters",
      );
    }
  }

  // meta.source — optional URL
  if (meta.source !== undefined) {
    if (typeof meta.source !== "string" || !URL_REGEX.test(meta.source)) {
      throw new Error(
        "INVALID_META_FIELD: source must be a valid http/https URL",
      );
    }
  }

  // meta.author — optional string
  if (meta.author !== undefined) {
    if (typeof meta.author !== "string") {
      throw new Error("INVALID_META_FIELD: author must be a string");
    }
    if (meta.author.length > 100) {
      throw new Error("INVALID_META_FIELD: author exceeds 100 characters");
    }
  }

  // meta.author_email — optional string (legacy)
  if (meta.author_email !== undefined) {
    if (typeof meta.author_email !== "string") {
      throw new Error("INVALID_META_FIELD: author_email must be a string");
    }
    if (meta.author_email.length > 150) {
      throw new Error("INVALID_META_FIELD: author exceeds 150 characters");
    }
  }

  // meta.author_handle — optional string
  if (meta.author_handle !== undefined) {
    if (typeof meta.author_handle !== "string") {
      throw new Error("INVALID_META_FIELD: author_handle must be a string");
    }
    if (meta.author_handle.length > 50) {
      throw new Error("INVALID_META_FIELD: author_handle exceeds 50 characters");
    }
  }

  // Phase 2 new fields validation
  if (meta.password !== undefined && typeof meta.password !== "string") {
    throw new Error("INVALID_META_FIELD: password must be a string");
  }
  if (meta.view !== undefined && typeof meta.view !== "string") {
    throw new Error("INVALID_META_FIELD: view must be a string");
  }
  if (meta.mode !== undefined && typeof meta.mode !== "string") {
    throw new Error("INVALID_META_FIELD: mode must be a string");
  }

  // ── 5. Validate questions ───────────────────────────────────────────────────
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    throw new Error("MISSING_FIELD: questions array must not be empty");
  }
  if (quiz.questions.length > 500) {
    throw new Error("INVALID_FIELD: too many questions (max 500)");
  }

  quiz.questions.forEach((q, i) => {
    if (!q || typeof q !== "object" || Array.isArray(q)) {
      throw new Error(`INVALID_QUESTION[${i}]: must be an object`);
    }
    for (const key of Object.keys(q)) {
      if (!ALLOWED_QUESTION_KEYS.has(key)) {
        throw new Error(`INVALID_QUESTION[${i}]: unknown key "${key}"`);
      }
    }
    const text = q.q;
    if (!text || typeof text !== "string" || !text.trim()) {
      throw new Error(`INVALID_QUESTION[${i}]: missing question text (q)`);
    }
    // Essay question must have `answer` field or at least be recognizable
    if (Array.isArray(q.options) && q.options.length === 0) {
      throw new Error(
        `INVALID_QUESTION[${i}]: options array must not be empty if present`,
      );
    }
  });

  // ── 6. Validate stats — recompute and compare ───────────────────────────────
  const computedStats = computeStats(quiz.questions);

  if (!quiz.stats || typeof quiz.stats !== "object") {
    throw new Error("MISSING_FIELD: stats object is required");
  }
  for (const key of Object.keys(quiz.stats)) {
    if (!ALLOWED_STATS_KEYS.has(key)) {
      throw new Error(`INVALID_STATS_KEY: "${key}" is not permitted in stats`);
    }
  }

  if (quiz.stats.questionCount !== computedStats.questionCount) {
    throw new Error(
      `STATS_MISMATCH: questionCount ${quiz.stats.questionCount} ≠ actual ${computedStats.questionCount}`,
    );
  }

  const clientTypes = Array.isArray(quiz.stats.questionTypes)
    ? [...quiz.stats.questionTypes].sort().join(",")
    : "";
  if (clientTypes !== computedStats.questionTypes.join(",")) {
    throw new Error(
      `STATS_MISMATCH: questionTypes [${clientTypes}] ≠ actual [${computedStats.questionTypes.join(",")}]`,
    );
  }

  // ── 7. Sanitize ─────────────────────────────────────────────────────────────
  quiz.meta.title = meta.title.trim();

  return quiz;
}

// ─── Path validator ───────────────────────────────────────────────────────────
export function validatePath(fields) {
  const parts = Object.values(fields).filter(v => typeof v === 'string' && v.trim());
  for (const part of parts) {
    if (!SAFE_PATH_REGEX.test(part)) {
      throw new Error(`INVALID_PATH: "${part}" contains disallowed characters`);
    }
    if (part.includes("..") || part.includes("//")) {
      throw new Error("INVALID_PATH: traversal pattern detected");
    }
    if (part.trim().length > 100) {
      throw new Error("INVALID_PATH: segment too long (max 100 chars)");
    }
  }
}

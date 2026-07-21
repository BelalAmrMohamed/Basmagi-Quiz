// ============================================================================
// QUIZ SCHEMA HELPERS — reading fields across old/new user-quiz storage
// schemas, normalizing legacy question shapes, and building new entries.
// ============================================================================

/** Read a field from either old or new schema */
export function qz(quiz, field) {
  switch (field) {
    // Always prefer the top-level id (the storage key); fall back to meta.id for
    // legacy payloads that accidentally stored it only inside meta.
    case "id":
      return quiz.meta?.id || "";
    // path is a top-level field on manifest exams, not stored in user quizzes
    case "path":
      return quiz.meta?.path || "";
    case "title":
      return quiz.meta?.title || "";
    case "description":
      return quiz.meta?.description || "";
    case "source":
      return quiz.meta?.source || "";
    case "createdAt":
      return quiz.meta?.createdAt || "";
    case "author":
      return quiz.meta?.author || "";
    case "author_email":
      return quiz.meta?.author_email || "";
    case "password":
      return quiz.meta?.password || "";
    case "view":
      return quiz.meta?.view || "";
    case "mode":
      return quiz.meta?.mode || "";
    case "count":
      return quiz.stats?.questionCount ?? quiz.questions?.length ?? 0;
    // FIX: guard against undefined questionTypes before calling .join()
    case "type":
      return (quiz.stats?.questionTypes || []).join(" · ");
    default:
      return undefined;
  }
}

/** Normalize essay questions from old 1-option format to new answer field */
export function normalizeQuestions(questions) {
  return (questions || []).map((q) => {
    if (Array.isArray(q.options) && q.options.length === 1) {
      const { options, correct, ...rest } = q;
      return { ...rest, answer: options[0] ?? "" };
    }
    return q;
  });
}

/** Build a new-schema quiz entry for localStorage */
export function buildUserQuizEntry(id, parsed, titleFallback) {
  const questions = normalizeQuestions(parsed.questions || []);
  const types = new Set();
  questions.forEach((q) => {
    if (!Array.isArray(q.options) || q.options.length === 0) types.add("Essay");
    else if (q.options.length === 2) types.add("True/False");
    else types.add("MCQ");
  });

  // Preserve ALL original meta fields (including id, createdAt, source, etc.)
  // Only fill in fields that are genuinely missing.
  const meta = {
    ...(parsed.meta || {}),
    title: parsed.meta?.title || titleFallback || "Untitled",
  };
  if (!meta.createdAt) {
    meta.createdAt = new Date().toLocaleString("en-US");
  }

  // Preserve original stats if present; otherwise compute from questions.
  const stats = parsed.stats || {
    questionCount: questions.length,
    questionTypes: Array.from(types).sort(),
  };

  return {
    id,
    meta,
    stats,
    questions,
  };
}

/** Normalize a questionTypes value (raw array or already-joined string) into
 * a display string, or null if empty/absent. Mirrors formatQuestionTypes()
 * in result.js so both pages render this field identically. */
export function formatQuestionTypesForDownload(questionTypes) {
  if (!questionTypes) return null;
  if (Array.isArray(questionTypes))
    return questionTypes.length ? questionTypes.join(" · ") : null;
  return String(questionTypes) || null;
}

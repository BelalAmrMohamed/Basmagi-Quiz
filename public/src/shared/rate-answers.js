// public/src/shared/rate-answers.js
// Global Helper functions for rating questions
// Import: import { gradeEssay, isEssayQuestion, calculateQuizMetrics } from "../shared/rate-answers.js";

// === Helper: Check if Essay Question ===
export const isEssayQuestion = (q) => {
  return !Array.isArray(q.options) && q.answer !== undefined;
};

// === Helper: Check if a question's UI should render checkboxes (multi-
// select) vs. radio buttons (single-select) ===
// Storage format going forward: `correct` is ALWAYS an array (even for a
// single correct answer, e.g. [2]) — `multiSelect` is the sole, explicit
// signal for which input control to render, completely independent of
// `correct`'s shape.
// Backward compatibility: older questions saved before this field existed
// don't have `multiSelect` at all. For those (and only those — the `in`
// check below is what detects "predates this field"), fall back to the old
// heuristic (Array.isArray(q.correct)) so already-saved quizzes keep
// rendering exactly as before.
export const isMultiSelectQuestion = (q) => {
  if (q && typeof q === "object" && "multiSelect" in q) {
    return Boolean(q.multiSelect);
  }
  return Array.isArray(q?.correct);
};

// === Helper: the single correct option index for a single-select question,
// regardless of whether `correct` is stored as the new always-array format
// ([2]) or the legacy bare-number format (2). Only meaningful when
// isMultiSelectQuestion(q) is false — a multi-select question should use
// q.correct (or q.correct ?? q.answer) as an array directly instead.
export const singleCorrectIndex = (q) => {
  const c = q?.correct ?? q?.answer;
  return Array.isArray(c) ? c[0] : c;
};

// === Helper: Check if answer is correct (handles single value or array) ===
// `correctValue` (q.correct) may be:
//   - an array (current/new format, always used going forward — including
//     single-answer questions, e.g. [2])
//   - a bare number (legacy format, still present on old unmigrated rows)
// `userAnswer` mirrors whichever shape the quiz UI collected it in, which
// itself follows isMultiSelectQuestion(q) — so a multi-select question's
// userAnswer is always an array, and a single-select question's is always
// a bare number, regardless of which shape `correctValue` happens to be.
export function isAnswerCorrect(userAnswer, correctValue) {
  if (userAnswer === undefined || userAnswer === null) return false;
  if (Array.isArray(correctValue)) {
    if (Array.isArray(userAnswer)) {
      if (userAnswer.length !== correctValue.length) return false;
      return correctValue.every(c => userAnswer.includes(c));
    }
    // Single-select UI (bare number answer) against an always-array
    // single-correct-answer question, e.g. correct: [2], userAnswer: 2.
    return correctValue.length === 1 && correctValue[0] === userAnswer;
  }
  return userAnswer === correctValue;
}

export function gradeEssay(userInput, modelAnswer) {
  const normalize = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[.,;:!?()\[\]{}\"'\/\\`]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const userNorm = normalize(userInput);
  const modelNorm = normalize(modelAnswer);

  if (!userNorm) return 0;

  const extractNums = (s) => (s.match(/\d+(\.\d+)?/g) || []).map(Number);
  const modelNums = extractNums(modelNorm);
  const userNums = extractNums(userNorm);
  const modelNoNums = modelNorm.replace(/\d+(\.\d+)?/g, "").trim();
  if (modelNums.length > 0 && modelNoNums.length < 8) {
    const allMatch = modelNums.every((mn) =>
      userNums.some((un) => Math.abs(un - mn) / (Math.abs(mn) || 1) < 0.02),
    );
    return allMatch ? 5 : userNums.length > 0 ? 1 : 0;
  }

  const stopWords = new Set([
    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "to",
    "of",
    "in",
    "on",
    "at",
    "by",
    "for",
    "with",
    "from",
    "and",
    "or",
    "but",
    "if",
    "as",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "we",
    "they",
    "not",
    "no",
    "so",
    "also",
  ]);
  const keywords = modelNorm
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  if (keywords.length === 0)
    return userNorm.includes(modelNorm) || modelNorm.includes(userNorm) ? 5 : 0;

  const matched = keywords.filter((kw) => userNorm.includes(kw)).length;
  const ratio = matched / keywords.length;

  if (ratio >= 0.8) return 5;
  if (ratio >= 0.6) return 4;
  if (ratio >= 0.4) return 3;
  if (ratio >= 0.2) return 2;
  if (matched > 0) return 1;
  return 0;
}

// === Centralised Quiz Metrics Calculator ===
// Returns a single metrics object used by the result page and any future consumers.
//
// Percentage logic:
//   • Essay-only quiz  → percentage = (essayScoreTotal / essayMaxTotal) * 100
//   • Mixed / MCQ-only → percentage = (mcqCorrect / mcqTotal) * 100
//     (essay score is intentionally excluded from the percentage in mixed quizzes)
export function calculateQuizMetrics(questions, userAnswers) {
  let mcqCorrect = 0,
    mcqWrong = 0,
    mcqSkipped = 0,
    mcqTotal = 0;
  let essayCount = 0,
    essayScoreTotal = 0,
    essayMaxTotal = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const ua = userAnswers[i];

    if (isEssayQuestion(q)) {
      essayCount++;
      essayScoreTotal += gradeEssay(ua, q.answer ?? "");
      essayMaxTotal += 5;
    } else {
      mcqTotal++;
      const correctIdx = q.correct ?? q.answer;
      if (ua === undefined || ua === null) mcqSkipped++;
      else if (isAnswerCorrect(ua, correctIdx)) mcqCorrect++;
      else mcqWrong++;
    }
  }

  const isEssayOnly = mcqTotal === 0;

  let percentage = 0;
  if (isEssayOnly) {
    percentage =
      essayMaxTotal > 0
        ? Math.round((essayScoreTotal / essayMaxTotal) * 100)
        : 0;
  } else {
    percentage = mcqTotal > 0 ? Math.round((mcqCorrect / mcqTotal) * 100) : 0;
  }

  // Comprehensive percentage: combines MCQ correct points + essay score points
  // against the total possible points across all question types.
  // Edge cases:
  //   • Essay-only  → same as `percentage` (no MCQ denominator to skew result)
  //   • MCQ-only    → same as `percentage` (no essay denominator)
  //   • Mixed       → holistic view that weights both question types by their point value
  //   • Empty quiz  → 0 (guarded by totalPossible check)
  const totalEarned = mcqCorrect + essayScoreTotal;
  const totalPossible = mcqTotal + essayMaxTotal;
  const actualPercentage =
    totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : 0;

  return {
    mcqCorrect,
    mcqWrong,
    mcqSkipped,
    mcqTotal,
    essayCount,
    essayScoreTotal,
    essayMaxTotal,
    isEssayOnly,
    percentage,
    actualPercentage,
  };
}
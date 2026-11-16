// public/src/shared/rate-answers.js
// Global Helper functions for rating questions
// Import: import { gradeEssay, isEssayQuestion, calculateQuizMetrics } from "../shared/rate-answers.js";

import { parseComplete, gradeComplete } from "./complete-question.js";

// === Helper: Check if Complete (fill-in-the-blank) Question ===
// Explicit marker: `questionKind: "complete"` (quiz questions and lesson blocks).
export const isCompleteQuestion = (q) => q?.questionKind === "complete";

// === Helper: Check if Essay Question ===
export const isEssayQuestion = (q) => {
  return !isCompleteQuestion(q) && !Array.isArray(q.options) && q.answer !== undefined;
};

// === Helper: "complete" | "essay" | "mcq" ===
export const getQuestionKind = (q) =>
  isCompleteQuestion(q) ? "complete" : isEssayQuestion(q) ? "essay" : "mcq";

// === Helper: stats label of one quiz question (single source for all copies) ===
export const inferQuestionType = (q) => {
  if (isCompleteQuestion(q)) return "Complete";
  if (!Array.isArray(q?.options) || q.options.length === 0) return "Essay";
  if (q.options.length === 2) return "True/False";
  return "MCQ";
};

// === Helper: grade a Complete quiz question; `userAnswer` is a string[] ===
export const gradeCompleteQuestion = (q, userAnswer) =>
  gradeComplete(parseComplete(q?.q).blanks, userAnswer, q?.strictMatch === true);

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

// NOTE: gradeEssay is embedded into generated standalone files through
// `gradeEssay.toString()` (export-to-quiz.js, lesson-download.js,
// api/ai-agent/_botGenerators.js), so it must stay fully self-contained: no
// helpers or constants defined outside the function body.
export function gradeEssay(userInput, modelAnswer) {
  // Answers typed in the rich essay field are stored as markdown, and model
  // answers are markdown too: compare the words, not the syntax around them.
  const stripMd = (raw) =>
    String(raw ?? "")
      .replace(/^[ \t]*```[\w+#.-]*[ \t]*$/gm, "") // code fence lines (content kept)
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "") // headings
      .replace(/^[ \t]*>[ \t]?/gm, "") // blockquote markers
      .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, "") // list markers
      .replace(/<\/?u>/g, "")
      .replace(/\*\*([^\n]+?)\*\*/g, "$1")
      .replace(/~~([^\n]+?)~~/g, "$1")
      .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,;:!?])/g, "$1$2")
      .replace(/(`+)([^`\n]+?)\1/g, "$2");
  userInput = stripMd(userInput);
  modelAnswer = stripMd(modelAnswer);

  const toAsciiDigits = (s) =>
    String(s ?? "")
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/\u066B/g, ".")
      .replace(/\u066C/g, "");

  // Convert common LaTeX and Unicode spellings into a compact expression.
  // This is deliberately a small offline normalizer, not a symbolic algebra
  // system. It handles notation variants without claiming semantic proof.
  const mathForm = (raw) => {
    let s = toAsciiDigits(raw)
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (d) => `^${"⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(d)}`)
      .normalize("NFKC");
    for (let i = 0; i < 8; i++) {
      const before = s;
      s = s
        .replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1")
        .replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
        .replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)");
      if (s === before) break;
    }
    s = s
      .replace(/\^\s*\{([^{}]*)\}/g, "^$1")
      .replace(/\\(?:left|right|displaystyle|textstyle|scriptstyle|limits)(?![a-z])/g, "")
      .replace(/\\(?:times|cdot|ast)/g, "*")
      .replace(/\\(?:div)/g, "/")
      .replace(/\\(?:pm)/g, "+-")
      .replace(/\\(?:leq?|le)/g, "<=")
      .replace(/\\(?:geq?|ge)/g, ">=")
      .replace(/\\(?:neq|ne)/g, "!=")
      .replace(/\\pi/g, "pi")
      .replace(/\\([a-zA-Z]+)/g, "$1")
      .replace(/\\[,;:! ]/g, " ")
      .replace(/\$\$|\$|\\\(|\\\)|\\\[|\\\]/g, " ")
      .replace(/[×·⋅]/g, "*")
      .replace(/[÷]/g, "/")
      .replace(/[−–]/g, "-")
      .replace(/[≤]/g, "<=")
      .replace(/[≥]/g, ">=")
      .replace(/[≠]/g, "!=")
      .replace(/[π]/g, "pi")
      .replace(/[√]\s*([a-zA-Z0-9]+)/g, "sqrt($1)")
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (d) => `^${"⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(d)}`)
      .toLowerCase();
    s = s.replace(/\b(sin|cos|tan|log|ln|sqrt)\s+([a-z0-9]+)/g, "$1($2)");
    s = s
      .replace(/\s*([=<>+*/^(),])\s*/g, (m, op) => op)
      .replace(/(?<=[0-9])(?=[a-z(])/g, "*")
      .replace(/(?<=[a-z)])(?=[0-9(])/g, "*")
      .replace(/(?<=\))(?=[a-z])/g, "*")
      .replace(/\s+/g, "*")
      .replace(/\((\d+(?:\.\d+)?)\)/g, "$1");

    const splitTopLevel = (value, separators) => {
      const parts = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (depth === 0 && separators.includes(ch) && i > start) {
          if ((ch === "+" || ch === "-") && /[+\-*/^=<>]$/.test(value.slice(start, i))) continue;
          parts.push(value.slice(start, i));
          start = i;
        }
      }
      if (start < value.length) parts.push(value.slice(start));
      return parts;
    };
    const canonicalSide = (value) => {
      const terms = splitTopLevel(value, "+-").map((term) => {
        const sign = term.startsWith("-") ? "-" : "";
        const body = /^[+-]/.test(term) ? term.slice(1) : term;
        const factors = splitTopLevel(body, "*");
        return sign + (factors.length > 1 ? factors.sort().join("*") : body);
      });
      return terms.sort().join("|");
    };
    const sides = splitTopLevel(s, "=");
    return sides.length > 1
      ? sides.map(canonicalSide).sort().join("=")
      : canonicalSide(s);
  };

  const normalizeText = (raw) =>
    toAsciiDigits(raw)
      .normalize("NFKC")
      .replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1 $2")
      .replace(/\\(?:left|right|bigg?|Bigg?)(?![a-zA-Z])/g, "")
      .replace(/\\[,;:! ]/g, " ")
      .replace(/\$\$|\$|\\\(|\\\)|\\\[|\\\]/g, " ")
      .replace(/\\([a-zA-Z]+)/g, "$1")
      .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
      .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
      .replace(/\u0649/g, "\u064a")
      .replace(/[\u060C\u061B\u061F\u00AB\u00BB\u2026]/g, " ")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const userRaw = String(userInput ?? "");
  const modelRaw = String(modelAnswer ?? "");
  const userNorm = normalizeText(userRaw);
  const modelNorm = normalizeText(modelRaw);
  if (!userNorm) return 0;

  const parseScalar = (raw) => {
    const compact = toAsciiDigits(raw)
      .normalize("NFKC")
      .replace(/\\\(|\\\)|\\\[|\\\]|\$/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    const match = compact.match(/^([-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)(%|°?[a-z][a-z0-9/^*-]*)?$/i);
    return match ? { value: Number(match[1]), unit: match[2] || "" } : null;
  };
  const userScalar = parseScalar(userRaw);
  const modelScalar = parseScalar(modelRaw);
  if (userScalar && modelScalar) {
    if (userScalar.unit !== modelScalar.unit) return 0;
    const tolerance = Math.max(Math.abs(modelScalar.value) * 0.005, 1e-9);
    return Math.abs(userScalar.value - modelScalar.value) <= tolerance ? 5 : 0;
  }

  const mathSignal = (s) =>
    /\\(?:frac|sqrt|times|cdot|sin|cos|tan|pi)|[$=<>^+*/×·÷√π≤≥≠]|[-−]\s*\d|(?:^|[^a-z])(?:[a-z]\s*\^\s*\d+|[a-z]\d+|\d+\s*[a-z])(?:$|[^a-z])/i.test(s);
  const isMath = mathSignal(userRaw) || mathSignal(modelRaw);
  if (isMath) {
    const userMath = mathForm(userRaw);
    const modelMath = mathForm(modelRaw);
    if (userMath && userMath === modelMath) return 5;

    const tokenizeMath = (s) => s.match(/[a-z]+|\d+(?:\.\d+)?|[=<>+\-*/^()]/g) || [];
    const userTokens = tokenizeMath(userMath);
    const modelTokens = tokenizeMath(modelMath);
    if (modelTokens.length === 0) return 0;
    const remaining = [...userTokens];
    let matched = 0;
    for (const token of modelTokens) {
      const at = remaining.indexOf(token);
      if (at >= 0) {
        matched++;
        remaining.splice(at, 1);
      }
    }
    const precision = matched / Math.max(userTokens.length, 1);
    const recall = matched / modelTokens.length;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    const wrongNumber = modelTokens.some((t) => /^\d/.test(t) && !userTokens.includes(t));
    const score = f1 >= 0.9 ? 5 : f1 >= 0.72 ? 4 : f1 >= 0.52 ? 3 : f1 >= 0.3 ? 2 : matched ? 1 : 0;
    return wrongNumber ? Math.min(score, 1) : score;
  }

  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "on", "at",
    "by", "for", "with", "from", "and", "or", "but", "if", "as", "it", "its",
    "this", "that", "these", "those", "i", "you", "he", "she", "we", "they",
    "not", "no", "so", "also", "في", "من", "إلى", "الى", "على", "عن", "مع",
    "هو", "هي", "هم", "هن", "هذا", "هذه", "ذلك", "تلك", "الذي", "التي",
    "و", "أو", "ثم", "أن", "إن", "كان", "كانت", "يكون", "تكون", "ما", "لا",
  ]);
  const normalizeWord = (word) => {
    let value = word.replace(/\u0629$/g, "\u0647");
    if (/[\u0600-\u06FF]/.test(value)) {
      value = value.replace(/^(?:وال|بال|كال|فال|لل|ال)/, (prefix) =>
        value.length - prefix.length >= 3 ? "" : prefix,
      );
      value = value.replace(/^[وفبكل]/, (prefix) =>
        value.length - prefix.length >= 4 ? "" : prefix,
      );
    }
    return value;
  };
  const tokens = (s) => s.split(/\s+/).flatMap((original) => {
    const word = normalizeWord(original);
    return word.length > 1 && !stopWords.has(word) && !stopWords.has(original) ? [word] : [];
  });
  const userTokens = tokens(userNorm);
  const modelTokens = tokens(modelNorm);
  if (modelTokens.length === 0) return userNorm === modelNorm ? 5 : 0;

  const remaining = [...userTokens];
  let matched = 0;
  for (const token of modelTokens) {
    const at = remaining.indexOf(token);
    if (at >= 0) {
      matched++;
      remaining.splice(at, 1);
    }
  }
  const precision = matched / Math.max(userTokens.length, 1);
  const recall = matched / modelTokens.length;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  let score = f1 >= 0.9 ? 5 : f1 >= 0.72 ? 4 : f1 >= 0.52 ? 3 : f1 >= 0.3 ? 2 : matched ? 1 : 0;

  // Numbers and negation change the meaning of an answer. Do not award high
  // credit merely because the surrounding words happen to overlap.
  const extractNumbers = (s) => (s.match(/[-+]?\d+(?:\.\d+)?/g) || []).map(Number);
  const modelNumbers = extractNumbers(modelNorm);
  const userNumbers = extractNumbers(userNorm);
  const hasWrongNumber = modelNumbers.some((expected) =>
    !userNumbers.some((actual) => Math.abs(actual - expected) <= Math.max(Math.abs(expected) * 0.005, 1e-9)),
  );
  const isNegated = (s) =>
    /\b(?:not|no|never)\b/.test(s) ||
    s.split(/\s+/).some((word) => ["لا", "ليس", "لم", "لن"].includes(word));
  const modelNegated = isNegated(modelNorm);
  const userNegated = isNegated(userNorm);
  if (hasWrongNumber || modelNegated !== userNegated) score = Math.min(score, 2);
  return score;
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
  let completeCount = 0,
    completeEarned = 0,
    completeCorrect = 0,
    completeSkipped = 0,
    completePartial = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const ua = userAnswers[i];

    if (isCompleteQuestion(q)) {
      completeCount++;
      const g = gradeCompleteQuestion(q, ua);
      completeEarned += g.earned;
      if (g.allCorrect) completeCorrect++;
      else if (g.answered === 0) completeSkipped++;
      else completePartial++;
    } else if (isEssayQuestion(q)) {
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

  const objectiveTotal = mcqTotal + completeCount;
  const isEssayOnly = objectiveTotal === 0;

  let percentage = 0;
  if (isEssayOnly) {
    percentage =
      essayMaxTotal > 0
        ? Math.round((essayScoreTotal / essayMaxTotal) * 100)
        : 0;
  } else {
    percentage = Math.round(((mcqCorrect + completeEarned) / objectiveTotal) * 100);
  }

  // Comprehensive percentage: combines MCQ correct points + essay score points
  // against the total possible points across all question types.
  // Edge cases:
  //   • Essay-only  → same as `percentage` (no MCQ denominator to skew result)
  //   • MCQ-only    → same as `percentage` (no essay denominator)
  //   • Mixed       → holistic view that weights both question types by their point value
  //   • Empty quiz  → 0 (guarded by totalPossible check)
  const totalEarned = mcqCorrect + completeEarned + essayScoreTotal;
  const totalPossible = objectiveTotal + essayMaxTotal;
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
    completeCount,
    completeEarned,
    completeCorrect,
    completeSkipped,
    completePartial,
    isEssayOnly,
    percentage,
    actualPercentage,
  };
}

// src/export/export-to-text.js
// Builds a plain-text representation of a quiz (with optional user answers).
// Exposes buildQuizText() for callers that need the string,
// and exportToText() that copies to clipboard + downloads as .txt.
// No external libraries used.

// ========= Issues =========
// Weird overall score

import { showNotification } from "../components/notifications.js";

// Question helpers
import {
  gradeEssay,
  isEssayQuestion,
  calculateQuizMetrics,
} from "../shared/rate-answers.js";

/**
 * Build a plain-text string for the quiz.
 * @param {Object}  config       - { title, description, source }
 * @param {Array}   questions    - normalised question objects
 * @param {Array}   userAnswers  - optional; present in results mode
 * @returns {string}
 */
export function buildQuizText(config, questions, userAnswers = []) {
  const isResultsMode =
    userAnswers &&
    (Array.isArray(userAnswers)
      ? userAnswers.length > 0
      : Object.keys(userAnswers).length > 0);

  let text = `Title: ${config.title || "Untitled"}\n`;
  if (config.description) text += `Description: ${config.description}\n`;
  text += "\n";
  if (config.source) text += `Source: ${config.source}\n`;
  text += "\n\n" + "─".repeat(40) + "\n\n";

  // ── Score summary (results mode only) ─────────────────────────────────────
  if (isResultsMode) {
    const {
      mcqCorrect,
      mcqWrong,
      mcqSkipped,
      mcqTotal,
      essayCount,
      essayScoreTotal,
      essayMaxTotal,
      percentage: MCQ_percentage,
      actualPercentage: percentage,
    } = calculateQuizMetrics(questions, userAnswers);
    const totalScore = mcqCorrect + essayScoreTotal;
    const totalPoss = mcqTotal + essayMaxTotal;
    const passed = percentage >= 60;

    text += "=== Your Results ===\n";
    text += `Overall Score : ${totalScore} / ${totalPoss} (${percentage}%)\n`;
    text += `MCQ Score : ${mcqCorrect} / ${mcqTotal} (${MCQ_percentage}%)\n`;
    text += `Status        : ${passed ? "✅ Passed" : "❌ Not Passed"}\n`;
    text += `Questions     : ${mcqTotal + essayCount}\n`;
    if (essayCount > 0) {
      text += `  ✏ Essay     : ${essayScoreTotal} / ${essayMaxTotal} pts\n`;
    }
    if (mcqTotal > 0) {
      text += `  ✓ Correct   : ${mcqCorrect} / ${mcqTotal}\n`;
      text += `  ✗ Wrong     : ${mcqWrong}\n`;
      text += `  ⚪ Skipped   : ${mcqSkipped}\n`;
    }

    text += "\n" + "─".repeat(40) + "\n\n";
  }

  // ── Questions ──────────────────────────────────────────────────────────────
  questions.forEach((q, i) => {
    const userAns = userAnswers[i];
    text += `${i + 1}. ${q.q}\n\n`;

    if (isEssayQuestion(q)) {
      if (isResultsMode) {
        const userText = userAns || "";
        const score = gradeEssay(userText, q.answer);
        const stars = "★".repeat(score) + "☆".repeat(5 - score);
        text += `   Your Answer: ${userText || "لم تُجِب"}\n`;
        text += `   Score        : ${score}/5  ${stars}\n\n`;
      }
      text += `   Formal Answer: ${q.answer || ""}\n`;
    } else {
      const opts = Array.isArray(q.options) ? q.options : [];
      opts.forEach((opt, j) => {
        text += `   ${String.fromCharCode(65 + j)}. ${opt}\n`;
      });

      if (isResultsMode) {
        const isSkipped = userAns === undefined || userAns === null;
        const userLetter = isSkipped
          ? "Skipped"
          : String.fromCharCode(65 + userAns);
        text += `\n   Your Answer  : ${userLetter}${isSkipped ? "" : `. ${opts[userAns] || ""}`}\n`;
      }

      if (q.correct !== undefined && q.correct !== null) {
        let correctLabel = q.correct;
        if (
          typeof q.correct === "number" ||
          (typeof q.correct === "string" && /^\d+$/.test(q.correct))
        ) {
          correctLabel = String.fromCharCode(65 + Number(q.correct));
        }
        const opts = Array.isArray(q.options) ? q.options : [];
        text += `\n   Correct: ${correctLabel}. ${opts[q.correct] || ""}\n`;
      }
    }

    if (q.explanation) text += `\n   Explanation: ${q.explanation}\n`;
    text += "\n" + "─".repeat(40) + "\n\n";
  });

  return text;
}

/**
 * Copy quiz text to clipboard and trigger a .txt download.
 * Returns a Blob (useful for callers that want to re-download without re-building).
 *
 * @param {Object}   config
 * @param {Array}    questions
 * @param {Array}    [userAnswers=[]]
 * @returns {Promise<Blob>}
 */
export async function exportToText(config, questions, userAnswers = []) {
  const text = buildQuizText(config, questions, userAnswers);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard may be unavailable in some contexts; still proceed with download
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${config.title || "quiz"}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNotification(
    "تم التصدير",
    "تم نسخ وتحميل نص الإختبار",
    "./assets/images/mardownIcon.png",
  );

  return blob;
}

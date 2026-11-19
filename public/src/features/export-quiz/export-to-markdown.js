// public/src/features/export-quiz/export-to-markdown.js
// Downloads the quiz as markdown (.md)
// Deals with the export from both main page and results page
// No libraries used
import { degradeCompleteForExport } from "../../shared/complete-question.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { MD_ICON_SVG } from "../home/icons.js";

// Question helpers
import {
  gradeEssay,
  isEssayQuestion,
  calculateQuizMetrics,
} from "../../shared/rate-answers.js";

// Converts \n to markdown line breaks (two trailing spaces + newline).
// Backtick code blocks and inline code pass through as-is since .md renders them natively.
const mdLineBreaks = (str) => {
  if (str === null || str === undefined) return "";
  return String(str).replace(/\n/g, "  \n");
};

/**
 * @param {object} config
 * @param {Array} questions
 * @param {Array|object} [userAnswers]
 * @param {object} [mdOptions] — settings collected from the download
 *   modal's Settings Panel: { includeAnswers, includeUserAnswers,
 *   includeExplanations, answerPlacement: "inline" | "final-page" }.
 *   Defaults preserve the previous always-on behavior when omitted (e.g.
 *   the instant "copy as markdown" button, which has no settings step).
 */
export function buildQuizMarkdown(config, questions, userAnswers = [], mdOptions = {}) {
  ({ questions, userAnswers } = degradeCompleteForExport(questions, userAnswers));
  const {
    includeAnswers = true,
    includeUserAnswers = true,
    includeExplanations = true,
    answerPlacement = "inline",
  } = mdOptions;

  let hasMCQ = false,
    hasTrueFalse = false,
    hasEssay = false;

  questions.forEach((q) => {
    if (isEssayQuestion(q)) hasEssay = true;
    else if (q.options && q.options.length === 2) hasTrueFalse = true;
    else hasMCQ = true;
  });

  let questionType = "";
  if (hasEssay && !hasMCQ && !hasTrueFalse) questionType = "Essay/Definitions";
  else if (hasEssay) questionType = "Mixed (MCQ, True/False, Essay)";
  else if (hasMCQ && hasTrueFalse) questionType = "MCQ and True/False";
  else if (hasTrueFalse) questionType = "True/False only";
  else questionType = "MCQ only";

  // Determine if we are in "Summary Mode" (user answers provided AND
  // the person exporting chose to include them — includeUserAnswers
  // gates this the same way it does for PPTX).
  const isResultsMode =
    includeUserAnswers &&
    userAnswers &&
    (Array.isArray(userAnswers)
      ? userAnswers.length > 0
      : Object.keys(userAnswers).length > 0);

  // Collected while iterating questions below, used to build a grouped
  // "Answer Key" section at the end when answerPlacement === "final-page".
  const answerKeyEntries = [];

  let markdown = `# ${config.title || "Quiz"}\n- **Number of questions:** ${questions.length
    }\n- **Questions' type:** ${questionType}\n\n`;

  // ── Score summary (only in results mode, and only when answers are
  // included — a score summary inherently reveals how many the user got
  // right/wrong, which is itself an answer-adjacent reveal). ──
  if (isResultsMode && includeAnswers) {
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
    const passed = percentage >= 70;
    const status = passed ? "✅ Passed" : "❌ Not Passed";

    markdown += `## 📊 Your Results\n\n`;
    markdown += `| Metric | Value |\n|--------|-------|\n`;
    markdown += `| **Overall Score** | ${totalScore} / ${totalPoss} pts (${percentage}%) |\n`;
    markdown += `| **Status** | ${status} |\n`;
    if (mcqTotal > 0) {
      markdown += `| ✓ MCQ Correct | ${mcqCorrect} / ${mcqTotal} (${MCQ_percentage}%)|\n`;
      markdown += `| ✗ MCQ Wrong | ${mcqWrong} |\n`;
      markdown += `| ⚪ Skipped | ${mcqSkipped} |\n`;
    }
    if (essayCount > 0) {
      const totalStars = Math.round((essayScoreTotal / essayMaxTotal) * 5);
      const summaryStars = "★".repeat(totalStars) + "☆".repeat(5 - totalStars);
      markdown += `| ✏️ Essay Score | ${essayScoreTotal} / ${essayMaxTotal} pts  ${summaryStars} |\n`;
    }
    markdown += `\n---\n\n`;
  } else {
    markdown += `---\n\n`;
  }

  questions.forEach((q, index) => {
    const userAns = userAnswers[index];

    markdown += `## Question ${index + 1}\n`;
    markdown += `${mdLineBreaks(q.q)}\n\n`;

    if (isEssayQuestion(q)) {
      // Fix #exportOptions: user's essay answer/score still needs
      // includeUserAnswers (already folded into isResultsMode above), but
      // the score itself reveals correctness so it's additionally gated
      // by includeAnswers.
      if (isResultsMode) {
        const userText = userAns || "";
        markdown += `**Your Answer:**\n\n${mdLineBreaks(userText || "لم تُجِب")}\n\n`;
        if (includeAnswers) {
          const score = gradeEssay(userText, q.answer);
          const stars = "★".repeat(score) + "☆".repeat(5 - score);
          const scoreLabel = score >= 3 ? "✅" : score >= 1 ? "⚠️" : "❌";
          markdown += `**Score:** ${scoreLabel} ${score}/5  ${stars}\n\n`;
        }
      }
      if (includeAnswers) {
        if (answerPlacement === "final-page") {
          answerKeyEntries.push({
            index,
            answerText: `**Formal Answer:** ${mdLineBreaks(q.answer)}`,
          });
        } else {
          markdown += `**Formal Answer:** ${mdLineBreaks(q.answer)}\n\n`;
        }
      }
    } else if (!Array.isArray(q.options) || q.options.length === 0) {
      if (includeAnswers && q.answer) {
        if (answerPlacement === "final-page") {
          answerKeyEntries.push({
            index,
            answerText: `**Answer:** ${mdLineBreaks(q.answer)}`,
          });
        } else {
          markdown += `**Answer:** ${mdLineBreaks(q.answer)}\n\n`;
        }
      } else {
        markdown += `*No answer options available for this question.*\n\n`;
      }
    } else {
      q.options.forEach((opt, i) => {
        const letter = String.fromCharCode(48 + i + 1);
        markdown += `${letter}. ${mdLineBreaks(opt)}\n`;
      });
      markdown += `\n`;

      // Fix #multi-correct: q.correct can be an array (e.g. [0, 2]) for
      // multi-select questions — the old code treated it as a scalar
      // index everywhere, so multi-select questions rendered a garbage
      // "Correct Answer" letter (String.fromCharCode on a non-numeric
      // array) and a skip/match check that never worked.
      const correctIdxRaw = q.correct ?? q.answer;
      const correctIdxList = Array.isArray(correctIdxRaw)
        ? correctIdxRaw
        : [correctIdxRaw];
      const userAnsList = Array.isArray(userAns) ? userAns : [userAns];
      const isSkipped =
        userAns === undefined ||
        userAns === null ||
        (Array.isArray(userAns) && userAns.length === 0);

      // Only append "Your Answer" if we are in summary mode
      if (isResultsMode) {
        const userLetters = isSkipped
          ? "Skipped"
          : userAnsList
            .filter((i) => Number.isInteger(i))
            .map((i) => `${String.fromCharCode(48 + i + 1)}. ${mdLineBreaks(q.options[i])}`)
            .join("; ");
        markdown += `**Your Answer:** ${userLetters || "Skipped"}\n\n`;
      }

      if (includeAnswers) {
        const correctText = correctIdxList
          .filter((i) => Number.isInteger(i) && q.options[i] !== undefined)
          .map((i) => `${String.fromCharCode(48 + i + 1)}. ${mdLineBreaks(q.options[i])}`)
          .join("; ");
        if (answerPlacement === "final-page") {
          answerKeyEntries.push({
            index,
            answerText: `**Correct Answer:** ${correctText}`,
          });
        } else {
          markdown += `**Correct Answer:** ${correctText}\n\n`;
        }
      }
    }

    if (includeExplanations && q.explanation) {
      if (answerPlacement === "final-page") {
        const entry = answerKeyEntries.find((e) => e.index === index);
        if (entry) entry.explanationText = mdLineBreaks(q.explanation);
        else markdown += `> **Explanation:**\n${mdLineBreaks(q.explanation)}\n\n`;
      } else {
        markdown += `> **Explanation:**\n${mdLineBreaks(q.explanation)}\n\n`;
      }
    }
    markdown += `---\n\n`;
  });

  // ── Grouped Answer Key section (answerPlacement === "final-page") ──
  // Each entry gets its own heading + bullet list rather than a flat run
  // of bold-label lines, so the answer/explanation pairing per question
  // stays visually distinct once separated from the question text itself.
  if (includeAnswers && answerPlacement === "final-page" && answerKeyEntries.length) {
    markdown += `## 🔑 Answer Key\n\n`;
    answerKeyEntries.forEach((entry) => {
      markdown += `### Question ${entry.index + 1}\n\n`;
      markdown += `- ${entry.answerText}\n`;
      if (entry.explanationText) {
        markdown += `- **Explanation:** ${entry.explanationText}\n`;
      }
      markdown += `\n`;
    });
  }

  return markdown;
}

/**
 * @param {object} config
 * @param {Array} questions
 * @param {Array|object} [userAnswers]
 * @param {object} [mdOptions] — see buildQuizMarkdown's docstring.
 */
export function exportToMarkdown(config, questions, userAnswers = [], mdOptions = {}) {
  const markdown = buildQuizMarkdown(config, questions, userAnswers, mdOptions);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${config.title || "quiz_export"}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const MD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
    <defs>
      <linearGradient id="markGradient" gradientUnits="userSpaceOnUse" x1="6" y1="32" x2="58" y2="32">
        <stop offset="0%" stop-color="#6018A8" />
        <stop offset="48%" stop-color="#2B67D9" />
        <stop offset="100%" stop-color="#00B5FF" />
      </linearGradient>
    </defs>

    <g fill="none" stroke="url(#markGradient)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <!-- Document Outline -->
      <path d="M14 40 V10 A3 3 0 0 1 17 7 H36 L50 21 V40" />

      <!-- Folded Corner -->
      <path d="M36 7 V21 H50" />

      <!-- 3 Horizontal Lines -->
      <path d="M18.5 14.5 H31.5" />
      <path d="M18.5 21.5 H29.5" />
      <path d="M18.5 28.5 H27.5" />

      <!-- Bottom Label Box -->
      <rect x="6" y="40" width="52" height="18" rx="3.5" ry="3.5" />

      <!-- Letter M -->
      <path d="M12.5 53.5 V47.5 A2.2 2.2 0 0 1 16.9 47.5 V53.5 M16.9 47.5 A2.2 2.2 0 0 1 21.3 47.5 V53.5" />

      <!-- Letter A -->
      <path d="M25.5 53.5 L29 45 L32.5 53.5 M26.8 50.8 H31.2" />

      <!-- Letter R -->
      <path d="M36.8 53.5 V45 H40.5 A2.3 2.3 0 0 1 40.5 49.6 H36.8 M40.2 49.6 L43.2 53.5" />

      <!-- Letter K -->
      <path d="M47.5 45 V53.5 M52.5 45 L47.5 49.5 L52.5 53.5" />
    </g>
  </svg>`;

  showNotification(
    "Markdown file downloaded.",
    "You have it now",
    MD_ICON_SVG,
  );
}
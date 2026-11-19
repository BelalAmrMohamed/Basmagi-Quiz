// =============================================================================
// public/src/shared/ai-agent-authoring.js
// Authoring rules for AI-written quizzes/lessons, kept in ONE place and used by
// the web agent (get_authoring_guide in tool-registry.js) and the Telegram bot
// (generate_quiz_file / generate_lesson_file descriptions), so the rules can
// not drift apart. Plain strings only: importable from the browser and from api/.
// =============================================================================

export const AUTHORING_RULES = {
  latex: "Math is always LaTeX: $...$ inline, $$...$$ display.",
  correct: "`correct` is an array of ZERO-based option indexes (e.g. [1]); set multiSelect: true when several options are correct.",
  trueFalse: "True/False questions use exactly two options written in the quiz's language (e.g. [\"صح\", \"خطأ\"] for Arabic, [\"True\", \"False\"] for English); correct: [0] or [1].",
  essay: "Essay questions have no options: give a full model `answer` and an `explanation`.",
  complete: "Fill-in-the-blank: set questionKind: \"complete\" and write each blank inline in `q` as {{answer}} or {{answer|alt1|alt2}}; strictMatch: true makes case/diacritics matter.",
};

/** The rules as one block of text (appended to tool descriptions / prompts). */
export function authoringRulesText() {
  return Object.values(AUTHORING_RULES).map((r) => `- ${r}`).join("\n");
}

// =============================================================================
// api/ai-agent/_schemas.js
// Tool-input schemas shared by the web agent tools (_tools.js) and the Telegram
// bot tools (_botTools.js), so a field added for one (e.g. `questionKind:
// "complete"`) can never be silently missing from the other.
// =============================================================================

/** One quiz question, as sent by the model (create_quiz, edit_quiz, generate_quiz_file, ...). */
export const QUESTION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    q: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    // NOTE: Gemini's proto-based tool schema rejects JSON-Schema union
    // types (e.g. type: ["integer","array"]) with a 400 — "Proto
    // field is not repeating, cannot start list." Always use an
    // array of 0-based indices here; the save path (buildUserQuizEntry
    // in quiz-schema.js) unwraps a single-element array to a plain
    // integer for single-answer questions, so no behavior changes.
    correct: { type: "array", items: { type: "integer" } },
    // Independent of `correct`'s length — see isMultiSelectQuestion()
    // in rate-answers.js. Omitting this falls back to the legacy
    // Array.isArray(correct) heuristic, which is always true now
    // that `correct` is always an array, so the model should set
    // this explicitly rather than rely on the fallback.
    multiSelect: { type: "boolean" },
    answer: { type: "string" },
    questionKind: {
      type: "string",
      enum: ["complete"],
      description: "Set to 'complete' for fill-in-the-blank questions whose blanks are written inline in q as {{answer|alt}}.",
    },
    strictMatch: { type: "boolean" },
    explanation: { type: "string" },
  },
  required: ["q"],
};

/** One block of a lesson section: Markdown text or an embedded question. */
export const LESSON_BLOCK_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["markdown", "question"] },
    body: { type: "string" },
    questionKind: {
      type: "string",
      enum: ["mcq", "essay", "complete"],
      description: "mcq for single/multiple choice and true/false; essay for free-text answers; complete for fill-in-the-blank (blanks written inline in prompt as {{answer|alt}}).",
    },
    prompt: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    correctIndex: { type: "integer", description: "Zero-based index of the correct option for a single-answer MCQ." },
    correctIndexes: { type: "array", items: { type: "integer" }, description: "Zero-based indexes of all correct options for a multi-select MCQ." },
    multiSelect: { type: "boolean" },
    modelAnswer: { type: "string" },
    strictMatch: { type: "boolean" },
    explanation: { type: "string", description: "Explain the correct answer; used in the reader's answer feedback." },
  },
};

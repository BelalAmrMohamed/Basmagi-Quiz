// =============================================================================
// api/ai-agent/_tools.js
// Shared tool schema(s) the AI Helper backend can offer to providers. Kept
// provider-agnostic here; each provider adapter in _providerClients.js
// translates this into its own native tool/function-calling shape.
// =============================================================================

// Mirrors the JSON shape parseQuizJson()/buildUserQuizEntry() (in
// public/src/shared/quiz-json.js and public/src/features/home/quiz-schema.js)
// already expect — no new parsing code needed on the save side.
export const CREATE_QUIZ_TOOL = {
  name: "create_quiz",
  description:
    "Create a new quiz and save it for the user. Only call this when the user has explicitly confirmed they want the quiz created (e.g. after you've shown them a preview and they said yes/أنشئ/تمام). " +
    "For MCQ/True-False questions, `correct` MUST always be an array of 0-based option indices — use a single-element array like [2] for one correct answer, or multiple indices like [0, 2] if more than one option is correct. Omit `correct` (and `options`) entirely for essay/free-text questions and use `answer` instead.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      questions: {
        type: "array",
        items: {
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
            answer: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["q"],
        },
      },
    },
    required: ["title", "questions"],
  },
};
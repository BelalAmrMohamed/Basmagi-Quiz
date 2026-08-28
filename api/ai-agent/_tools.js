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
    "Create a new quiz and save it for the user. Only call this when the user has explicitly confirmed they want the quiz created (e.g. after you've shown them a preview and they said yes/أنشئ/تمام).",
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
            correct: { type: ["integer", "array"] },
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

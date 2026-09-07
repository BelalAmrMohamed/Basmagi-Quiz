# AI Agent "الباشـمبصمج" — Update Implementation Plan

## Quiz-page AI scoring override

**Goal:** the assistant can review a question and its formal answer + the user's answer and override the platform's default correctness/score, especially for only for essay questions, specially essays from Math or Arabic answers where `gradeEssay`'s keyword-overlap heuristic is unreliable.

This will not be a normal integration of the AI Agent in the quiz page, because we don't want users to get help from AI.

### 1a. Backend: new tool + endpoint mode
- In `api/ai-agent/_tools.js`, add a new tool schema `REGRADE_ANSWER_TOOL`:
```js
  export const REGRADE_ANSWER_TOOL = {
    name: "regrade_answer",
    description:
      "Override the platform's automatic scoring for one question when the automatic grader is likely wrong — e.g. an essay/short-answer response that's mathematically or semantically correct but phrased differently than the model answer, a LaTeX-formatted answer that's equivalent but not textually identical, or Arabic text with different diacritics/spelling variants than the reference answer. Only call this when you have reviewed the question, the model's reference answer, and the user's actual answer.",
    input_schema: {
      type: "object",
      properties: {
        questionIndex: { type: "integer", description: "0-based index of the question in the quiz" },
        isCorrect: { type: "boolean" },
        score: { type: "number", description: "0-5 partial-credit score for essay questions; omit for MCQ/True-False" },
        reasoning: { type: "string", description: "Short explanation shown to the user for why the override was made" },
      },
      required: ["questionIndex", "isCorrect", "reasoning"],
    },
  };
```
- Wire it into `api/ai-agent/chat.js` the same way `create_quiz`/`edit_quiz` already are (check how those are conditionally included based on `pageKey`/context — likely a `pageKey === "quiz"` or similar gate you'll need to add). Add a new `pageKey` value (e.g. `"quiz"`) distinct from the existing `"home"`/`"result"` so the system prompt and tool list can be scoped correctly.
- Backend does NOT need to persist the override — it returns the tool call in the response; the client applies it (see 1b). No DB schema change needed for this phase.

### 1b. Frontend: mount + wire the override
- In `public/src/features/quiz/quiz.js`, mount `createAIAgentFab` (mirror the pattern in `result.js`) with:
  - `pageKey: "quiz"`
  - `contextPrompt` built from the current question set + the user's answers so far (reuse whatever context-building helper `result.js`/`user-quizzes-view.js` already use as a template — check for a shared `buildContextSummary`-style helper before writing a new one).
  - An `onToolCall` (or equivalent hook — check `ai-agent-chat.js`'s existing tool-call dispatch for `create_quiz`/`edit_quiz` to find the right extension point) that handles `regrade_answer` calls: given `questionIndex`/`isCorrect`/`score`, update local override state.
- **Do not rewrite `rate-answers.js`'s grading itself.** Instead, introduce an override layer: an in-memory (per quiz-attempt) map `{ [questionIndex]: { isCorrect, score, reasoning, source: "ai" } }`. At every one of the ~6 call sites in `quiz.js` that currently do:
```js
  const essayScore = gradeEssay(...);
  isCorrect = essayScore >= 3;
  // or
  isCorrect = isAnswerCorrect(...);
```
  check the override map first; if an override exists for that question index, use it instead of calling `gradeEssay`/`isAnswerCorrect`. Centralize this as one new helper (e.g. `getEffectiveGrade(questionIndex, defaultGradeFn)`) in `rate-answers.js` so all ~6 sites (and `calculateQuizMetrics`, which also needs to respect overrides for the final percentage) call through one place instead of duplicating the override-check logic six times.
- UI: when a question's grade is AI-overridden, show a small badge/icon next to the check/wrong indicator (e.g. a sparkle icon reusing `SPARKLE_ICON_SVG` from `ai-agent.js`) with the `reasoning` as a tooltip — the user should be able to tell an override happened and why.
- Overrides are attempt-scoped (don't persist across a fresh quiz retake) — store in the same in-memory/session state `quiz.js` already uses for the current attempt, not IndexedDB.

### 1c. `gradeEssay` improvements (independent of the AI override, still worth doing)
Since this is flagged as a scoring-quality problem generally, not just an "AI can fix it" problem: add basic LaTeX-aware and Arabic-diacritic-aware normalization to `gradeEssay`'s `normalize()` function in `rate-answers.js` — strip Arabic diacritics (tashkeel, `\u064B-\u0652`), normalize alef variants (`أ`/`إ`/`آ` → `ا`), and strip/normalize common LaTeX delimiters (`$...$`, `\(...\)`) before comparing text, so the *baseline* algorithm improves too — the AI override should be a safety net for cases even improved normalization misses, not a crutch for a normalizer that could trivially be better.
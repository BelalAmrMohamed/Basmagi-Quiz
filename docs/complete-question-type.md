# New question type: Complete (fill-in-the-blank)

Goal: add a "Complete" question type to the quiz page, lesson page, editors, inline create modals, AI Agent, MCP server and exports | Done when: a Complete question can be authored (editor, JSON, AI Agent, MCP), uploaded, played on the quiz and lesson pages with per-blank feedback and partial credit, shown on the result page, and `node --test tests/` passes.

> Executor instructions: Facts under Verified are checked; treat them as true. Read a file only if you are about to edit it or a Read-only entry lists it. Do not scan or read the whole repo. If something contradicts the plan on contact, fix it and continue; do not stop to re-audit. Keep each file's existing CRLF line endings. Do not edit `PROJECT_STRUCTURE.md`. Never hand-edit generated files (`supabase/functions/*/index.ts` except `mcp`, `public/dist`).

## Verified (trust these; do not re-check)

- Quiz questions have NO type field. Kind is inferred from shape: `isEssayQuestion = !Array.isArray(q.options) && q.answer !== undefined` (`public/src/shared/rate-answers.js:6`). A question with no `options` and no `answer` currently falls into the MCQ branch and breaks.
- Lesson question blocks DO have a discriminator: `questionKind` = `"mcq"` (default when absent) | `"essay"` (`api/_validateLesson.js:171`, `lesson-blocks.js:284`).
- Quiz type labels `Essay` / `True/False` / `MCQ` are inferred in 5 duplicated copies by `options.length`: `api/_validateQuiz.js:57`, `public/src/shared/quiz-json.js:115`, `home/quiz-schema.js:73`, `home/user-quizzes-folders.js:1514`, `home/adminUpload.js:1555`, `create-quiz/create-quiz.js:4683`. The upload API recomputes stats and rejects a mismatch (`api/_validateQuiz.js:204-217`), so every copy must change together.
- Upload API is whitelist-based: unknown question keys are rejected (`ALLOWED_QUESTION_KEYS`, `api/_validateQuiz.js:28`; lesson `question` whitelist at `api/_validateLesson.js:48`).
- Content rules live in `public/src/shared/content-rules.js` (`checkQuiz` ~l.204-286, `checkLesson` question branch ~l.386-435, `LIMITS` at top). Copies at `supabase/functions/mcp/content-rules.js` and `scripts/lib/content-rules.js` are produced by `npm run sync:mcp`; a test fails if out of sync.
- Quiz editor treats a truthy `question.answer` as the essay marker everywhere (`create-quiz.js:2286, 3548, 3973, 5085`); convert helpers are `convertEssayToMcq` / `convertMcqToEssay` (`create-quiz.js:3611, 3645`).
- Quiz page state: `userAnswers[idx]` (MCQ = number or number[], essay = markdown string), `lockedQuestions[idx]`. Two render paths: vertical (`buildVerticalQuestionBodyHTML` l.1872, `patchQuestionAnswerState` l.2039, `window.checkAnswerForQuestion` l.328) and paginated (`buildQuestionBodyHTML` l.2330, `checkAnswer` l.2845, `handleSelect` l.2576). Scoring in `finish()` l.2679; navigator items in `createGridItem` l.1720 / `createListItem` l.1808. All branch on `isEssayQuestion`.
- Scoring: `calculateQuizMetrics` in `rate-answers.js` (~l.303). `result/result.js` uses `isEssayQuestion`/`gradeEssay` at l.415, 422, 804, 812 and `calculateQuizMetrics` at l.288.
- Standalone exports embed graders with `fn.toString()` (`export-quiz/export-to-quiz.js:2975`, `home/lesson-download.js:25`), so an embedded function must be self-contained (no outside helpers or constants), as `gradeEssay` is (`rate-answers.js:61-65`).
- Lesson progress is localStorage only: `recordQuestionAnswer(lessonId, qid, wasCorrect, selectedIndexes)` and `appendEssayAnswerText(lessonId, qid, text)` (`lesson/lesson-schema.js:295, 340`). Nothing server-side stores answers.
- Lesson essay blocks REJECT `onWrong`/`onCorrect` rules because essay grading is fuzzy (`api/_validateLesson.js:198`). Complete grading is deterministic, so rules are allowed for it.
- `{{ }}` is unused by `markdown.js` and the rich input (only JSDoc matches).
- AI Agent tool schemas: `api/ai-agent/_tools.js` (`create_quiz` ~l.15-46, lesson question tool ~l.358-368, `create_lesson` blocks ~l.398-404). Telegram bot reuses them via `_botTools.js` / `_botGenerators.js`; `supabase/functions/ai-bot/index.ts` is GENERATED from `api/ai-agent/bot.js`.
- MCP server: question normalisation `supabase/functions/mcp/lib.ts` (~l.52-90 quiz, ~l.193-217 lesson, guides ~l.334-360, summaries ~l.444-460) and tool text in `supabase/functions/mcp/index.ts`.
- Quizzes and lessons are stored as JSON validated in JS; no SQL migration is needed.
- `lesson/lesson-ai-quiz.js` is a separate ephemeral reader-side quiz with its own kinds (`choice`/`text`); it does not use authored question types.

## Decisions

- Discriminator: `questionKind: "complete"` on BOTH quiz questions and lesson blocks. Reason: explicit beats shape inference, and lessons already use this field. Quiz MCQ/essay stay shape-inferred (no migration of old data).
- Quiz question shape: `{ q, questionKind: "complete", strictMatch?: true, explanation? }`. Lesson block: `{ type: "question", questionKind: "complete", prompt, strictMatch?, explanation?, onWrong?, onCorrect? }`. NO `options`, NO `answer`/`modelAnswer` on a Complete question (validator errors if present). Reason: one source of truth, no text/blanks mismatch.
- Authoring syntax (stored as-is in `q` / `prompt`): `{{answer}}` or `{{answer|alt1|alt2}}`. `\{{` is a literal `{{`; `\|` is a literal pipe inside a blank. Blanks inside fenced code, inline code and `$...$` / `$$...$$` math are ignored. Inside a markdown table cell the author must write `\|`. Reason: best practice for cloze authoring: readable in raw JSON, writable by AI/MCP in one string, diff-friendly.
- Editor UX on top of the syntax: a "Make blank" toolbar button that wraps the selected text in `{{ }}`, plus a live preview row showing each detected blank with its accepted answers and any syntax error.
- Limits (add to `LIMITS`): `completeBlanksMax: 20`, `completeAnswerMax: 200`, `completeVariantsMax: 10`. Min 1 blank. Empty blank or empty variant = error. Unbalanced `{{` = error `COMPLETE_SYNTAX`.
- Grading: per blank, correct if the normalized input equals ANY normalized accepted variant. Question score = correct blanks / total blanks (0..1). `allCorrect` is true only if every blank is correct. Reason: matches the chosen "per-blank, accepted variants, partial credit".
- `strictMatch` is a single per-question toggle. Default lenient: trim, collapse whitespace, NFKC, lower-case, Arabic-Indic digits to ASCII, strip tashkeel and tatweel, fold alef forms, same Arabic folds `gradeEssay` already applies (copy its normalizer block verbatim). Strict: trim and collapse whitespace only; case, diacritics and alef forms count.
- Answer storage: `userAnswers[idx]` = `string[]` of length = blank count (`""` = empty). Lesson: `recordQuestionAnswer(..., allCorrect)` then `appendEssayAnswerText(..., JSON.stringify(answers))`; parse with try/catch on reload. Reason: no progress-schema change; adaptive `onWrong`/`onCorrect` keys off `allCorrect`.
- Scoring in quiz metrics: a Complete question is worth 1 point with fractional credit. `percentage` = (mcqCorrect + completeEarned) / (mcqTotal + completeCount). The essay-only rule is unchanged; new returned fields: `completeCount`, `completeEarned`, `completeCorrect`, `completeSkipped`. Existing `mcq*` fields keep their meaning.
- Stats label: `"Complete"` (Arabic label `إكمال` in `api/render-quiz.js` and `api/_og/quiz.js`). One shared `inferQuestionType` replaces all 6 copies.
- Rendering: parser swaps each blank for a private-use token `\uE000{i}\uE001` before `renderMarkdown`; after render the tokens in the HTML string become `<input class="complete-blank" data-blank="i" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false">`. Leftover tokens are stripped. Input width: `min-width: 8ch`, grows with typed text (`field-sizing: content` plus an `input` handler fallback). Reason: width must not leak answer length.
- Per-blank feedback after Check (or at finish in exam modes): correct input green with a check icon; wrong or empty input red, followed by a chip showing the first accepted answer; a score line `(2/3)` like the essay stars; then the shared explanation.
- Check button enabled when at least one blank is non-empty. Enter moves focus to the next blank; Enter on the last blank triggers Check.
- Converting a question to Complete in the quiz editor keeps `q`, drops options/`answer`, and the author adds blanks. Converting away from Complete replaces each `{{a|b}}` with `a`: to Essay, `answer` = the blank answers as a numbered list; to MCQ, default 4 empty options.
- Old cached pages or old offline downloads will mis-render Complete questions. Accepted; mitigated by `build:web` (service-worker asset hash).
- Out of scope per your answers: hints and "show answer" extras, drag-and-drop word bank, per-blank dropdowns.

## Steps (each leaves the project working; stop anywhere)

1. Core module, metrics, unit tests
   Edit: `public/src/shared/complete-question.js` (new, self-contained functions only: `parseComplete(text)` -> `{ segments, blanks:[{answers[]}], errors[] }`, `gradeComplete(text, userAnswers, strictMatch)` -> `{ total, correct, earned, allCorrect, perBlank:[{given, ok, empty, expected}] }`, `completeToMarkers(text)`, `stripCompleteSyntax(text)`), `public/src/shared/rate-answers.js` (add `isCompleteQuestion`, `getQuestionKind`, `inferQuestionType`; guard `isEssayQuestion`; extend `calculateQuizMetrics`), `tests/complete-question.test.js` (new), `tests/rate-answers.test.js`
   Read only: `public/src/shared/rate-answers.js` lines 65-200 (copy the Arabic normalizer)
   Check: `node --test tests/complete-question.test.js tests/rate-answers.test.js` (cover: variants, escapes, math/code ignored, tashkeel, alef, Arabic digits, strict vs lenient, partial credit, unbalanced `{{`)

2. Content rules, upload API, labels
   Edit: `public/src/shared/content-rules.js` (LIMITS; `checkQuiz` and `checkLesson` Complete branches with codes `COMPLETE_NO_BLANKS`, `COMPLETE_TOO_MANY_BLANKS`, `COMPLETE_BLANK_EMPTY`, `COMPLETE_SYNTAX`, `COMPLETE_HAS_OPTIONS`, `COMPLETE_HAS_ANSWER`, `COMPLETE_ANSWER_TOO_LONG`; reject any `questionKind` on a quiz question other than `"complete"`; Arabic messages like the existing ones), `api/_validateQuiz.js` (allow `questionKind`, `strictMatch`; boolean check; `inferQuestionType` returns `"Complete"`), `api/_validateLesson.js` (whitelist `strictMatch`; `complete` branch in `validateBlock`; allow `onWrong`/`onCorrect`; line ~311 rule-target filter), `api/render-quiz.js`, `api/_og/quiz.js` (label map), `tests/content-rules.test.js`
   Read only: none
   Check: `npm run sync:mcp && node --test tests/content-rules.test.js tests/content-rules-sync.test.js tests/validate-quiz-path.test.js`

3. Quiz page and result page
   Edit: `public/src/features/quiz/quiz.js` (every `isEssayQuestion` branch in both render paths, `patchQuestionAnswerState`, input handlers, both check functions, `finish()` scoring, grid/list navigator status), `public/src/features/quiz/quiz.css` (blank input, correct/wrong states, chip), `public/src/features/quiz/keyboard-nav.js` (do not hijack keys while typing in a blank; Enter = next blank), `public/src/features/result/result.js` (answer display, wrong-only filter treats `allCorrect` as correct, partial score, `formatQuestionTypes`), `public/src/features/result/result.css`
   Read only: `public/src/shared/markdown.js` (only `renderMarkdown` signature, to confirm the token survives)
   Check: open a quiz with one MCQ, one essay and one Complete question in vertical, paginated and exam modes; answers survive reload; result page shows `2/3` credit

4. Lesson page
   Edit: `public/src/features/lesson/lesson-blocks.js` (`renderQuestionBlock`, new `renderCompleteQuestionBody`, `equipQuestionBlocks`, `resetQuestionElement`, `revealCompleteAnswer`, recap), `public/src/features/lesson/lesson.css`, `public/src/features/lesson/lesson-json.js` (`normalizeLessonJson` + `normalizeLessonDraft` keep `questionKind: "complete"` and `strictMatch`), `public/src/features/lesson/lesson-schema.js` (only if `collectQuestionBlocks` drops unknown kinds), `public/src/features/home/lesson-download.js` (embed `gradeComplete`/`parseComplete`)
   Read only: `public/src/features/lesson/lesson-schema.js` lines 199-230
   Check: a lesson with a Complete block: answer, reload shows prior answers, retry-wrong resets it, an `onWrong` rule reveals its section

5. Quiz editor and type-inference dedupe
   Edit: `public/src/features/create-quiz/create-quiz.js` (kind switch at the `isEssay` sites l.2286, 3548, 3973, 5085 must test `getQuestionKind` first so a Complete question is never read as essay/MCQ; Complete card UI, "Make blank" button, live preview, `strictMatch` checkbox, convert helpers, `questionTypes` at l.4683, validation through shared rules), `public/src/features/create-quiz/create-quiz.css`, `public/src/features/home/quiz-schema.js`, `public/src/shared/quiz-json.js`, `public/src/features/home/user-quizzes-folders.js`, `public/src/features/home/adminUpload.js` (these four: import the shared `inferQuestionType`)
   Read only: none
   Check: create, edit, save, reload and upload a quiz containing a Complete question; stats show `Complete`; upload API accepts it

6. Lesson editor
   Edit: `public/src/features/create-lesson/create-lesson.js` (`makeBlock`, `hydrateBlock` l.1403, `questionBlockInnerHtml` l.3077, `wireQuestionBlock` l.3168, convert handlers ~l.3305-3360, `lessonToRuleInput` l.3514, `validateLesson` l.3529, `addLessonQuestionFromAgent` l.1069 accepts `complete`; reveal-rule dropdowns available for Complete), `public/src/features/create-lesson/create-lesson.css`
   Read only: none
   Check: add, convert, save and publish a lesson with a Complete block and an `onWrong` rule

7. Inline create modals and prompts
   Edit: `public/src/features/home/create-quiz-modal.js` (JSON template/prompt shows the Complete shape), `public/src/features/home/create-lesson-modal.js` (template at l.23-33 gets a `complete` example), `public/src/features/home/ai-prompts.js` (rules paragraph near l.41), `public/src/components/ai-agent/ai-agent-default-prompts.js`
   Read only: none
   Check: paste the modal's generated JSON for a Complete question into `.create-quiz-inline-modal` and the lesson modal; both create the item without errors

8. AI Agent, Telegram bot and MCP server
   Edit: `api/ai-agent/_tools.js` (`create_quiz` question schema: `questionKind` enum + `strictMatch`; lesson question tool enum `["mcq","essay","complete"]`; `create_lesson` block enum; guidance text with syntax and an Arabic example), `api/ai-agent/_botTools.js`, `api/ai-agent/_botGenerators.js` (l.287 type label), `supabase/functions/mcp/lib.ts` (quiz normaliser passes `questionKind`/`strictMatch`, stats gain `complete`; lesson block conversion l.193-217; guide text l.334-360; summaries l.444-460), `supabase/functions/mcp/index.ts` (tool descriptions that list question kinds)
   Read only: `tests/mcp-lib.test.js`, `tests/mcp-import.test.js`
   Check: `node --test tests/mcp-lib.test.js tests/mcp-import.test.js tests/mcp-draft-import.test.js tests/ai-agent-usage.test.js` plus new cases for a Complete quiz and lesson block

9. Exports and offline downloads
   Edit: `public/src/features/export-quiz/export-to-quiz.js` (standalone quiz: embed `parseComplete`/`gradeComplete`, interactive blanks), `export-to-html.js`, `export-to-markdown.js`, `export-to-word.js`, `export-to-pdf.js`, `export-to-pptx.js` (static formats: blanks printed as `_____`, answers in the answer key as `1) a / b`; type label `Mixed (…, Complete)`)
   Read only: none
   Check: export one mixed quiz to each format; the standalone HTML grades a Complete question offline

10. Regenerate and verify
   Edit: none by hand
   Read only: none
   Check: `npm run sync:mcp && npm run build:edge && npm run build:web && node --test tests/ && npm run dist:check`; then you deploy edge functions (`upload-quiz`, `ai-chat`, `ai-bot`, `mcp`) yourself. No SQL migration to run.

## Out of scope

- Hints, "show answer" button, word bank, per-blank dropdowns, per-blank custom weights.
- The reader-side `lesson-ai-quiz.js` mini quiz.
- Fuzzy/typo-tolerant matching of blanks (matching is exact after normalization).
- Migrating existing quizzes; old essay/MCQ data is untouched.

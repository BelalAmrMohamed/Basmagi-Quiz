# `/lesson/` Revamp — Execution Plan

Status: nothing built yet. Execute phases in order. Don't skip ahead — later phases assume earlier ones exist.

Stack: Vanilla JS · Supabase · Vercel

## Non-negotiable constraints (read once, apply everywhere)

- AI-generated quizzes are **ephemeral**: never write to `quizzes`/`user_quizzes`, never call `saveNewUserQuiz()`, never appear in the global exam system (`امتحاناتك`). In-memory only, per page session.
- File attachments to the AI: reuse the existing `api/ai-agent/chat.js` pipeline as-is. No new permanent file storage.
- Reuse, don't fork: lesson renderer, progress tracking, reader prefs, TTS, AI Agent, comments API all already exist — extend them.
- Theme = site's existing dark/light system. Reader prefs (font, speed, highlight) are separate from theme and must not fight it.
- RTL (Arabic) support required throughout.
- Comment author actions (edit/delete/moderate) must be authorized **server-side** with verified identity — never trust a client-supplied author ID.

## Key existing files (extend, don't replace)

```
public/src/features/lesson/lesson-view.js          # page init, paint(), AI tool handler, lessonAgentContext()
public/src/features/lesson/lesson-blocks.js         # content blocks + embedded questions
public/src/features/lesson/lesson-schema.js         # normalization + local progress (source of truth)
public/src/features/lesson/lesson-progress.js
public/src/features/lesson/lesson-progress-sync.js
public/src/features/lesson/lesson-toc.js
public/src/features/lesson/lesson-tts.js            # window.speechSynthesis, section-level today
public/src/features/lesson/lesson-reader-prefs.js   # getReaderPrefs()/setReaderPrefs()
public/src/features/lesson/lesson-comments.js       # submits to api/college-quiz.js
public/src/features/lesson/lesson.css
public/src/components/ai-agent/ai-agent.js
public/src/components/ai-agent/ai-agent-chat.js
public/src/components/ai-agent/ai-agent.css
public/src/components/ai-agent/ai-agent-default-prompts.js
public/src/components/ai-agent/ai-agent-suggested-prompts.js
api/college-quiz.js                                 # lesson comments API (+ other quiz stuff)
api/ai-agent/chat.js                                # AI requests, attachments, provider integration
```

Critical: `lesson-view.js`'s `handleLessonAgentToolCall()` currently routes `create_quiz` → `saveNewUserQuiz()` → global exam system. **This must be cut in Phase 2.**

---

## Phase 1 — Foundation (layout, theme, page state)

1. **Inspect first**: `lesson.css`, `lesson-view.js`, global theme tokens, existing modal styles.
2. **Layout**: Refactor `paint()` in `lesson-view.js` into semantic regions — header (title/breadcrumbs/reading time/progress), main content, sticky-on-desktop TOC sidebar, unobtrusive AI Agent entry point, community discussion below content. Mobile: TOC becomes a collapsible drawer/horizontal nav. Keep `#contentArea` and the standalone `/lesson/:id` bootstrap intact. Keep `lesson-view__info-btn` behavior, integrate into new controls. Don't change data loading in this step.
3. **Theme tokens**: In `lesson.css`, add CSS custom properties for surface colors (page/card/menu/input), text colors, borders, accent/focus-ring, radii, spacing, shadows, transition duration — sourced from the site's existing theme variables, not a new system. Solid readable surfaces for content; glass effects only on floating controls. Clear heading hierarchy, comfortable line length, consistent section spacing, hover/active/disabled/focus-visible states, `prefers-reduced-motion` support, no horizontal overflow, full RTL (icons, controls, nav direction).
4. **Reader prefs vs theme**: Reader prefs = font, speed, highlight color, reading width/text size. Theme = dark/light, applies to all lesson surfaces including menus/cards/forms/modals/comments. Changing font/highlight updates immediately. Prefs persist via existing localStorage convention; invalid/stale values fall back to defaults safely.
5. **Page state**: Add explicit state object for active section, reading mode, active temp AI quiz, comment sort/reply state, modal/menu visibility. Keep `lesson-schema.js` as the sole progress source of truth — don't duplicate it. Rerenders must not reset an in-progress AI quiz, comment draft, or reading state.

**Done when**: dashboard layout renders on desktop+mobile, theme switch affects every lesson surface, reader-pref changes are instant, answering a question or opening a menu doesn't blow away unrelated state.

---

## Phase 2 — Ephemeral AI quizzes (highest-risk, do independently, test before integrating)

1. **Cut the global-exam path**: In `handleLessonAgentToolCall()`, remove the `create_quiz` → `saveNewUserQuiz()` call and its success toast. Do not touch `saveNewUserQuiz()` itself or any other caller of it.
2. **New file `lesson-ai-quiz.js`** — normalized quiz schema:
   - Question: stable id, text, type, options (if applicable), correct/accepted answers, optional explanation, optional points.
   - Types: multiple choice (1+ correct options), true/false, fill-in-blank (normalized exact match against accepted answers), short answer (accepted-answer match or clearly-disclosed simple grading — never claim semantic understanding).
   - Validate generated JSON before rendering; reject malformed questions outright. Never execute/interpret generated HTML.
   - Grading: MC/TF instant + deterministic. Fill-blank normalizes whitespace/case. Short answer shows reference answer + explanation, not a false-confidence grade. Never reveal correct answers pre-submission unless user explicitly asks.
3. **New file `lesson-ai-quiz.css`** + render in `lesson-view.js`: dedicated container with title, question count, progress indicator, question nav, answer controls, submit/check, immediate feedback, final score, retry, dismiss. Visually consistent with lesson but visually distinct from authored questions.
4. **Ephemeral lifecycle**: no `quizzes` row, no `user_quizzes` row, no `saveNewUserQuiz()` call, doesn't appear in global exam listing, doesn't touch scores/rankings/levels. In-memory for the page session only; page reset may discard it.
5. **AI menu actions** — add to slash/action-menu (`ai-agent-actions.js`, `ai-agent-default-prompts.js`, `ai-agent-suggested-prompts.js`): "generate quiz from this lesson," "generate from current section," "explain this concept," "give me a hint," "summarize this section," "ask me one question at a time." Reuse existing slash-command infra — no second command system. Keep this distinct from the home page's `إنشاء امتحان`.
6. **Context**: Expand `lessonAgentContext()` to include lesson title/metadata, section titles+order, full text content, structured block data, existing question prompts/explanations, captions/transcripts only if present in source data (never invent them), current section + relevant surrounding content, whether lesson is user-created. Don't silently truncate — for long lessons, send current section + structure, fetch more on demand. User-created lessons must work without a Supabase lesson record.
7. **Regenerate-quiz behavior**: define explicitly — either confirm before replacing an in-progress quiz, or offer "keep current / generate new." Never silently discard an attempt. Keep quiz state independent of DOM so AI-Agent re-renders don't wipe it.

**Done when**: quiz generates and grades correctly for all 4 types, zero rows appear in `quizzes`/`user_quizzes`, global exam listing is unaffected, regenerating a quiz doesn't silently nuke progress, AI answers section-specific questions correctly using real lesson content.

---

## Phase 3 — Reader upgrade (TTS, highlighting, progress)

1. **TTS controls** in `lesson-tts.js`: persistent toolbar with play/pause/resume/stop, speed 0.75×–2×, voice selection if browser supports it. Use existing `getReaderPrefs()`/`setReaderPrefs()`. Toolbar reflects real speech state; disable unavailable actions; handle no-speechSynthesis browsers gracefully.
2. **Paragraph-level highlighting** (`lesson-tts.js`, `lesson-blocks.js`, `lesson.css`): replace the current "whole section as one utterance" approach. Split into per-paragraph/text-block utterances, excluding buttons/nav/quiz controls/decorative elements. Highlight the active block with a dedicated CSS class (don't inject markup into stored lesson content), optionally scroll into view, auto-advance on utterance end, clear highlight on stop/error.
3. **Reading modes** (`lesson-view.js`, `lesson-reader-prefs.js`, `lesson.css`): focus mode (hide secondary nav/controls), comfortable width, larger text option, progress display, "resume last section" action. Use existing local progress mechanism only.
4. **Question reset** (`lesson-blocks.js`): inspect current answer/grading/lock representation, add reset action — clears selection, feedback, score, locked state; restores original button labels/disabled states; doesn't touch unrelated progress; no full-page rerender unless architecture requires it.

**Done when**: TTS toolbar works end-to-end with accurate state, active paragraph highlights and auto-advances, focus mode and resume-reading work, a graded question can be retried without page refresh and behaves identically to first attempt.

---

## Phase 4 — Community discussion

1. **Inspect the DB first**: `lesson_comments` table, indexes, RLS policies, existing moderation flow (`api/college-quiz.js`, `docs/Database-Schema-Context.md`). Extend, don't fork.
2. **Schema additions** (new migration, following project convention, only after inspection confirms need):
   - nullable `parent_id` for replies
   - reaction table, unique constraint on (user, comment)
   - report table: reporter, reason, status, timestamps
   - author identity fields if not already present
3. **Rename UI section**: `أسئلة الطلاب` → `مجتمع الدرس` (or `النقاش`). Sort options: الأحدث / الأكثر تفاعلاً / الأكثر فائدة. All counts/actions must reflect real app state — no fake numbers.
4. **Build interactions in this order** (each needs real server persistence + authorization, not just UI):
   1. Replies (reasonable nesting limit)
   2. Reactions (like/helpful, one per user per comment, no duplicates)
   3. Sorting (newest / most-reacted / most-discussed)
   4. Edit/delete own content (server-enforced ownership via verified identity, never client-supplied author ID)
   5. Report action for inappropriate content
   6. Pagination
   7. Permalinks to a specific comment
   8. Local draft preservation across navigation/accidental close
5. **Secure `api/college-quiz.js`**: validate lesson/comment IDs, validate body length/content, authenticate writes per current account model, enforce ownership server-side, rate-limit submissions/reports, block unauthorized moderation, escape user-generated content on render, validate reply `parent_id` belongs to same lesson, prevent duplicate reactions, consistent error/loading responses. Preserve the existing moderation-status workflow.
6. **UX polish**: optimistic UI only where rollback is reliable, skeleton loading, empty states, inline error recovery, character count, cancelable reply composer, accessible reaction buttons, confirm destructive actions, mobile-friendly cards.

**Done when**: replies/reactions/sort/edit/delete/report/pagination/permalinks all work through the real API, persist across refresh and devices, unauthorized attempts are rejected server-side, existing moderation still works.

---

## Phase 5 — Controls and deeper AI integration

1. **Lesson info modal** (`lesson-info-modal.js`, `lesson-view.js`, `lesson.css`): reuse existing modal, don't build a new framework. Sections: lesson info, reading prefs, bookmarks, progress, reading mode, AI study actions. Keep frequently-used controls on the page itself, not buried in modal.
2. **Bookmarks** — new `lesson-bookmarks.js`: bookmark current section or a reliably-identifiable block. Store locally via existing storage helper convention: `{lessonId, sectionOrBlockId, createdAt}`. Add/remove, list in controls, jump-to, empty state. Must work for both DB-backed and user-created lessons.
3. **Progress controls** (`lesson-progress.js`, `lesson-progress-sync.js`, `lesson-view.js`): visual summary of sections visited, current section, overall completion, resume-reading, mark-section-complete (if compatible with existing model). Opening a lesson ≠ completing it. Handle adaptive/conditional sections consistently.
4. **More AI actions** (`ai-agent-actions.js`, `ai-agent-default-prompts.js`, `ai-agent-suggested-prompts.js`, `lesson-view.js`): explain selection, simplify paragraph, generate flashcards (session-only), temp quiz from current section, summarize full lesson, explain wrong answer, generate practice questions for weak topic. Capture text selection *before* opening the AI UI — don't let the click destroy it. Every action must clearly separate lesson content from user instructions in the prompt.
5. **File attachments** (`ai-agent-attach-launcher.js`, `ai-agent-chat.js`, `ai-agent.css`, `api/ai-agent/chat.js`): reuse existing pipeline as-is. Support PDF/image/supported-text, show filename+status, allow removal before send, show errors clearly, keep attachment scoped to its message in the current conversation, no permanent storage. **Updated limit** (was 1 file / 4MB decoded, changed after confirming the actual constraint is Vercel Hobby's 4.5MB total request body, not an arbitrary file count): up to 10 files per message, each individually capped at 4MB decoded, but gated together by a combined 3MB decoded budget across all files on one message (not an equal per-file split — a 4MB file and a 50KB file can coexist as long as the total fits). Verify actual provider support per MIME type before exposing it in UI.

**Done when**: modal is organized and usable, bookmarks work for both lesson types, progress summary is accurate, new AI actions work with correct text-selection capture, attachments flow through without becoming permanent lesson assets.

---

## Phase 6 — Integration, regression, polish

Run `npm run dev` (local Vercel dev server, so API routes/Supabase/AI Agent all run together).

**Test matrix** (minimum):
- Valid lesson loads; invalid lesson ID → friendly error
- User-created lesson: no student-discussion section shown
- AI answers about a specific section using that section's real content
- Quiz: generate → renders in-page; finish+retry resets cleanly; check `quizzes`/`user_quizzes` tables — nothing new; generate a second quiz — first attempt not silently lost
- TTS: play/pause/resume/stop reflect real state; speed change applies to new speech; multi-paragraph read highlights active paragraph
- Reader prefs: font/highlight change is instant
- Theme switch: every lesson component adapts
- Question reset: becomes answerable again, no refresh
- Comments: submit respects moderation; reply+react persists; unauthorized edit attempt is server-rejected
- Bookmarks: add → revisit → correct section opens
- Progress: leave and return → preserved
- Attachments: upload supported PDF/image/text → AI receives it
- Responsive: narrow mobile viewport → no clipping/overflow
- Accessibility: full keyboard nav; reduced-motion respected
- Cover: desktop light, desktop dark, mobile, DB-backed lesson, user-created lesson, lesson with embedded questions, lesson with media/structured blocks, unauth + auth sessions

**Regression checklist** (must still work):
- Home page `إنشاء درس` action
- Slash menu
- AI Agent "More" button on `/lesson`
- Global exam creation — completely unchanged
- Existing quiz pages
- Comment moderation interface compatibility
- Existing reader prefs not discarded
- Progress tracking storage format unchanged
- All API routes preserve prior behavior

---

## Definition of done

1. Coherent, responsive dashboard layout
2. Dark/light theme works on every lesson component
3. AI quizzes fully interactive, zero footprint in `امتحاناتك`
4. AI context includes full relevant lesson content, no silent truncation
5. TTS: speed control + active-paragraph highlighting works
6. Embedded questions reset without page refresh
7. Community discussion: all agreed interactions work with real server-side authorization
8. Bookmarks/progress/prefs work for both DB-backed and user-created lessons
9. Lesson control modal is genuinely useful
10. Attachments work through existing pipeline, no unintended permanent storage
11. Home page, global exam system, other quiz pages: unaffected

## Order of risk (validate these in isolation before wiring into the full dashboard)

1. Temporary quiz lifecycle (Phase 2) — cut the global-exam path *before* adding new quiz UI
2. Comment DB/API extensions (Phase 4) — inspect real RLS/policies *before* writing migrations
3. Paragraph-level speech highlighting (Phase 3)

Don't start by rewriting the whole page. Preserve existing data/rendering contracts first, then build new pieces around them.
# Lessons feature (`/lesson/` + `/create-lesson`) — implementation plan

This is a new content type alongside quizzes: **Course → Folder → {Quiz | Lesson}**.
Read this whole doc before writing any code — later phases assume decisions
made in earlier ones, and several "obvious" shortcuts are explicitly wrong
for reasons explained inline (marked ⚠️).

Read these existing files before starting, so you're extending established
patterns instead of reinventing them:
1. `supabase/migrations/20260901195646_courses_and_folders.sql` — the
   courses/folders design, and why courses have no parent column.
2. `api/_catalog.js` — how courses/folders/quizzes get assembled into one
   public catalog for SEO surfaces.
3. `api/_itemActions.js` — placement + naming validation shared across
   admin actions.
4. `public/src/features/home/user-quizzes-folders.js` — the generic
   client-side `{type, parentId}` tree (drag/drop, move, context menu).
   This already operates on `type`, so adding `"lesson"` as a third type
   is additive, not a rewrite.
5. `public/src/features/home/quiz-schema.js` — the pattern to mirror for
   `lesson-schema.js` (field accessors, local-storage entry builder,
   same-level collision check on save).
6. `public/src/shared/markdown.js` + `markdown-css.js` — the shared
   rendering engine you're extending in Phase 2, used by 15+ call sites.
   Do not fork a lesson-only copy of this.
7. `api/render-course.js` — the file Phase 1 adds a branch to. Read it
   fully; it already does "resolve a content node by slug/id, inject OG
   tags + a data-island into `public/index.html`, let the client SPA
   router take over," which is the exact shape a lesson page needs.
8. `docs/Database-Schema-Context.md` — current live schema, for column
   naming consistency in new tables/migrations.

## Ground rules that constrain every phase

- **Vercel Hobby plan is capped at 12 serverless functions and the project
  is already at exactly 12** (`api/render-quiz.js`, `api/seo.js`,
  `api/render-course.js`, `api/render-profile.js`, `api/ai-agent/chat.js`,
  `api/upload-quiz.js`, `api/auth.js`, `api/admin.js`, `api/og.js`,
  `api/upload-folder.js`, `api/college-quiz.js`, `api/user-profile.js` —
  every non-`_`-prefixed `.js` file under `api/` is one function; `_`-prefixed
  files and files under `api/ai-agent/_*`/`api/user-profile/_*` are imported
  modules, not separate functions). **Do not create a new top-level
  `api/*.js` file for anything in this plan.** Every new server-side need
  must be added as a branch inside an existing function (see per-phase
  notes) or, if it's genuinely new and non-HTML, as a **Supabase Edge
  Function** (project has none yet; free tier allows 500k invocations/mo
  across up to 28 functions — effectively unused capacity, but only fits
  work that doesn't need to read `public/index.html` off disk the way the
  `render-*.js` functions do, since Edge Functions run on Deno with no
  access to the Vercel build's filesystem).
- **Lessons are never scored.** No result page, no interaction with
  `passed_quizzes_count` / `current_level` / the points system on
  `admin_users`. If you find yourself wiring a lesson event into anything
  under `api/user-profile.js`'s existing level/points logic, stop — that's
  out of scope by explicit product decision, not an oversight.
- **A lesson is a sibling leaf next to a quiz, not a new hierarchy level.**
  No "module/chapter" table — `folders` already nests arbitrarily deep
  (self-referencing `parent_folder_id`), so a folder named "Chapter 3" is
  already that concept, for free.

---

## Phase 1 — Data model, placement, and the `/lesson/:id` route

**Goal:** a lesson can be created (via direct DB insert / admin API stub is
fine for now — the authoring UI is Phase 3), placed in the course/folder
tree, and viewed at a real URL with correct SEO meta. No lesson *content
features* yet (sections, embeds, fonts) — just the skeleton: a lesson with
a title and one plain markdown body renders.

1. **Migration** — new `lessons` table, modeled directly on how `quizzes`
   is placed (see the courses_and_folders migration's comments on why
   `course_id` is denormalized alongside `folder_id`):
   ```sql
   CREATE TABLE public.lessons (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     course_id uuid REFERENCES courses(id) ON DELETE CASCADE,
     folder_id uuid REFERENCES folders(id) ON DELETE CASCADE,
     title text NOT NULL,
     slug text,                    -- for readable URLs; nullable, fall back to id
     content jsonb NOT NULL,       -- sections/blocks, see Phase 2 for shape
     reader_prefs_default jsonb,   -- optional author-set default font/theme, Phase 2
     created_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
     updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
   );
   ```
   Add RLS matching `quizzes`' `public_read` policy (public SELECT, no
   password concept for lessons — there is no password-protected lesson
   requirement in scope; don't add one speculatively). Add an index on
   `course_id` and `folder_id` mirroring the existing folder/quiz indexes.

2. **`api/_catalog.js`** — add a fourth parallel query (`lessons`,
   `Promise.all`'d alongside courses/folders/quizzes/profiles), with its
   own guard clauses (skip empty title, skip missing id) following the
   exact pattern already used for quizzes. This feeds sitemap/feed/llms-full
   — skipping this step means lessons are invisible to SEO entirely.

3. **`api/_itemActions.js`** — `canPlaceItemServer` and
   `hasQuizNameCollision` are currently quiz/folder/course-specific by
   name. Add a lesson-placement check (same rule as quizzes: can go under
   a course directly or under any folder, never top-level-only like a
   course) and a `hasLessonNameCollision` following the exact shape of
   `hasQuizNameCollision` (same-course, same-folder-scope, `ilike` on
   title, race-condition caveat already documented there applies
   identically — don't re-litigate it).

4. **Route wiring** — in `vercel.json`, add:
   ```json
   { "source": "/lesson/:id", "destination": "/api/render-course?contentType=lesson&id=:id" }
   ```
   ⚠️ This reuses `render-course.js` on purpose (see ground rules —
   function budget is at the cap). Inside `render-course.js`, branch near
   the top of the handler on `req.query.contentType === "lesson"`: skip
   the slug-chain course/folder resolution entirely, do a direct
   `lessons` table lookup by `id` (or `slug` if you added it), and inject
   OG tags from the lesson's title + a short plain-text excerpt of its
   first content block instead of the course-specific OG image endpoint
   (`/api/og-course`) — lessons don't need a new OG image variant for v1,
   a generic site OG image is an acceptable fallback; don't scope a new
   `api/og.js` branch unless it's trivial, since `og.js` is already one of
   the 12.
   Keep the course-resolution code path and the lesson-resolution code
   path visually separate in the file (e.g. two clearly-named internal
   functions called from one small dispatcher) rather than interleaving
   `if` checks through the existing course logic line-by-line — this file
   is a shared function now and the two responsibilities need to stay
   easy to read independently, or it will accumulate the same kind of
   scar tissue `create-quiz.js` has.

5. **Client-side data-island + router hook** — `render-course.js` injects
   a `<meta name="course:*">` island that `navigation.js` reads to decide
   what to render inside the SPA shell. Do the same for lessons
   (`<meta name="lesson:id" ...>`), and add a minimal branch in
   `navigation.js` that, for now, just renders the lesson's title and raw
   markdown body via `renderMarkdown()` with no chrome. This is
   intentionally the smallest possible viewer — Phase 2 builds the real
   one.

**Phase 1 is done when:** a manually-inserted `lessons` row is reachable
at `/lesson/<id>`, shows correct OG tags to a scraper (test by curling the
route, not just viewing in-browser — SEO injection bugs don't show up in
a normal browser load), and appears in `/sitemap-dynamic.xml`.

---

## Phase 2 — Lesson viewer: sections, blocks, embeds, fonts, adaptive reveal

**Goal:** the real `/lesson/` reading experience — this is the bulk of the
product value and the bulk of the work.

1. **Content shape** (stored in `lessons.content` jsonb):
   ```json
   {
     "sections": [
       {
         "id": "s1",
         "title": "Introduction",
         "defaultHidden": false,
         "blocks": [
           { "type": "markdown", "body": "..." },
           { "type": "media", "url": "...", "kind": "image" },
           { "type": "quizRef", "quizId": "<uuid>" },
           {
             "type": "question",
             "id": "q1",
             "prompt": "...",
             "options": ["...", "..."],
             "correctIndex": 0,
             "explanation": "...",
             "onWrong": { "revealSection": "s3" }
           }
         ]
       }
     ]
   }
   ```
   Keep `onWrong`/`onCorrect` limited to a single `revealSection` target
   in v1 — no chained multi-step branching, no "reveal section AND hide
   another section" combos. If this needs to grow later it's an additive
   change to the rule object, not a breaking one.

2. **`lesson-schema.js`** (new file, `public/src/features/home/` or a new
   `public/src/features/lessons/` dir — prefer the latter, this is a big
   enough feature to warrant its own feature directory rather than
   crowding into `home/`). Mirror `quiz-schema.js`'s shape: field
   accessors, a `buildLocalLessonProgressEntry` equivalent, and the
   same-level collision check reused from `hasSameLevelCollision` in
   `user-quizzes-folders.js` (extend that function's `type` union to
   include `"lesson"` — check every call site of `hasSameLevelCollision`
   first, since it's currently called with a closed set of type strings
   in a few places and a new type may need those call sites' surrounding
   logic reviewed, not just the function signature).

3. **Local progress state** — one `localStorage` key per lesson (naming
   convention: mirror `user_quizzes`'s existing key style), storing:
   ```json
   {
     "visitedSections": ["s1", "s2"],
     "questions": { "q1": { "answered": true, "wasCorrect": false } }
   }
   ```
   This is the single source of truth for: the ToC checkmarks, the
   adaptive-reveal logic (checking `questions[id].wasCorrect` to decide
   whether a `defaultHidden` section should render), and Phase 4's
   cross-lesson aggregation. Get this shape right now — Phase 4 reads it
   as-is with no lesson-side changes, so a shape mistake here becomes a
   migration problem later, not just a viewer bug.
   ⚠️ Never write to any Supabase table from this flow in v1. This state
   is local-only, deliberately, per the "no scoring" ground rule.

4. **Section rendering + ToC** — reuse `doc-toc.js` (from
   `public/src/features/documents/`) as the starting point for the
   section jump-nav; it already solves "generate a clickable outline from
   headed content," check whether it can be imported directly or needs a
   lesson-specific variant given it currently serves static doc pages
   (`about.html`-style), not dynamic jsonb-sourced sections.

5. **Embedded quiz reference block** — renders a compact, read-only
   preview of the referenced quiz (title, question count, a "take this
   quiz" link to `/quiz/:id`) rather than inlining the full quiz-taking
   UI into the lesson page. Inlining full quiz-taking interaction here is
   out of scope — that duplicates `quiz.js`'s state machine inside a
   different page for no clear benefit; linking out is simpler and
   keeps scoring unambiguously confined to the real quiz page.

6. **Embedded question block** — its own smaller UI, not a reuse of
   `quiz.js`'s question renderer (that component is built around a
   multi-question flow with a submit-the-whole-quiz model; an embedded
   question is single, standalone, revealed immediately on answer). Build
   it as a small self-contained component. Reveal-only: show
   correct/incorrect + `explanation` immediately, write to the local
   progress state from step 3, done — never a network call.

7. **Fonts & highlight — extend `markdown.js`/`markdown-css.js` directly**,
   not a lesson-only fork. Add:
   - Inline highlight syntax, e.g. `==highlighted text==` → wraps in a
     `<mark>`-equivalent span with a CSS variable for color
     (`--md-highlight-color`), default yellow-equivalent if unset.
   - A font-family CSS variable (`--md-font-family`) that the existing
     rendered output already respects if `markdown-css.js`'s base styles
     use `var(--md-font-family, <existing default>)` instead of a
     hardcoded family.
   ⚠️ `export-to-quiz.js` `.toString()`-serializes several `markdown.js`
   functions into standalone offline quiz HTML exports (see
   `docs/plans/md-engine-prompt.md` for the exact mechanism and why it
   exists). If your highlight-syntax parsing touches any function in that
   serialization block, you must update the block to match or exported
   quizzes will throw `ReferenceError`s — check for `.toString()` in that
   file before assuming a change is self-contained.
   The lesson viewer's font/color **picker UI** (the control the reader
   uses to choose these) is lesson-page-only: a small settings popover
   that sets `--md-font-family` / `--md-highlight-color` on the lesson
   container's inline style, persisted to `localStorage`, applied on
   load. This picker itself is not part of the shared markdown engine —
   only the CSS-variable *hook* is.

8. **Math (KaTeX) and AI explain trigger** — port the `renderMathIn()`
   call from `create-quiz.js` verbatim (call it after any markdown block
   render, same as that file does). For the AI trigger, reuse
   `ai-agent.js`'s component as-is; add a new prompt to
   `ai-agent-default-prompts.js` (a `LESSON_PAGE_SYSTEM_PROMPT` sibling to
   the existing `CREATE_QUIZ_PAGE_SYSTEM_PROMPT`) that explicitly
   instructs the model not to produce scores/grades for embedded
   questions if asked — state this constraint in the prompt text itself,
   don't assume the model infers it from lesson context.

9. **Read-aloud (TTS)** — client-only, `window.speechSynthesis`. A
   play/pause control per section, voice + rate persisted in the same
   `localStorage` reader-prefs object as font/highlight choices (one
   combined key, not three separate ones). No backend, no new function.
   Feature-detect (`'speechSynthesis' in window`) and hide the control
   entirely if unsupported rather than showing a broken button.

**Phase 2 is done when:** a lesson with 3+ sections, at least one embedded
question with an adaptive reveal rule, one embedded quiz reference, custom
highlight/font applied, and math notation all render correctly, and the
adaptive section actually reveals/stays hidden based on the answer.

---

## Phase 3 — `/create-lesson` authoring page

**Goal:** admins can author everything Phase 1–2 can render, without
touching `create-quiz.js`.

⚠️ **Do not extend `create-quiz.js`.** That file is ~5,900 lines carrying
two mutually-exclusive edit modes, bulk mode, reorder mode, a templates
panel, and its own KaTeX/media/AI-agent wiring already. Threading a second
content type through it turns every future quiz-editor change into a
"does this also affect lessons" question. Build a new
`public/create-lesson.html` + `public/src/features/lessons/create-lesson.js`
that **imports** shared pieces (`markdown.js`, `ai-agent.js`, the same
media-upload helpers `create-quiz.js` uses if they're not quiz-specific —
check `media-resolve.js`/`media-url.js` for that) rather than sharing the
file itself.

1. Section-list editor (add/remove/reorder sections — reordering can
   reuse the drag-and-drop pattern already in `user-quizzes-folders.js`
   even though that file's drag/drop is for the folder tree, not
   in-page block reordering; check `question-navigator.js` first, since
   ordering questions within a quiz is the closer analog to ordering
   sections/blocks within a lesson).
2. Per-block editors: markdown (with the write/preview toggle
   `create-quiz.js` already established as the UX pattern), media upload,
   quiz-reference picker (a search-existing-quizzes UI — check whether
   `search_library` from `api/ai-agent/_tools.js` already implements
   quiz search you can reuse the query logic from), embedded-question
   editor (prompt/options/correct/explanation — structurally almost
   identical to a single question in `create-quiz.js`'s question editor;
   port that specific sub-piece rather than the whole file).
3. Adaptive-rule authoring UI: on a question block, a simple "if
   answered wrong, reveal section: [dropdown of this lesson's sections]"
   control. Keep it to the one-rule-per-question shape from Phase 2's
   schema — don't build UI for branching you didn't scope in the data
   model.
4. Save path: new `admin.js` action branches (`create-lesson`,
   `update-lesson`, `delete-lesson`, `reorder-lesson-sections` if needed
   as a distinct action, or just fold reordering into `update-lesson`).
   Follow the exact existing pattern of `handleRenameItem`/`handleMoveItem`
   in `admin.js` for auth-check + validation + Supabase write + friendly
   error mapping (23505 collisions etc., using the new
   `hasLessonNameCollision` from Phase 1).
5. Placement: use the existing move-to-dialog / folder-tree picker UI
   from `user-quizzes-folders.js` unchanged, once `"lesson"` is a
   recognized `type` there (Phase 2, step 2's extension of
   `hasSameLevelCollision`) — this is the payoff of that earlier change.

**Phase 3 is done when:** an admin can author a complete lesson matching
everything in the Phase 2 "done" criteria, entirely through the UI, with
no direct DB writes required.

---

## Phase 4 — Cross-lesson progress + comments (two independent sub-scopes)

These two are unrelated to each other; do them as separate PRs even
though they're grouped in one phase here for planning purposes.

### 4a. Course-level lesson progress

- **Same-device view (no new backend):** compute client-side, on the
  course page, by reading every lesson-progress `localStorage` key for
  lessons under that course (you already have the course→lesson mapping
  from the catalog) and rendering "4 of 12 lessons completed." No new
  table, no new endpoint — this alone delivers the visible feature.
- **Cross-device sync (optional, do only if time remains):** this is the
  one piece of this entire plan that should be a **Supabase Edge
  Function**, not a Vercel function — it's genuinely new, self-contained,
  and doesn't render HTML (unlike everything in Phase 1). New table:
  ```sql
  CREATE TABLE public.lesson_progress (
    device_id uuid NOT NULL,
    lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, lesson_id)
  );
  ```
  Mirror the device-identity JWT pattern already established in
  `api/user-profile.js` (`action=identify`/`action=sync-progress`) for
  auth — do not invent a second identity scheme. ⚠️ This is a real
  cross-device *lesson-completion* sync, deliberately **not** wired into
  `passed_quizzes_count`/`current_level` — a separate table, separate
  endpoint, no shared code path with the quiz progress/points system.

### 4b. Comments / questions-to-instructor

- New table `lesson_comments` (lesson_id, device_id or admin display
  name, body, created_at, status — mirror the `status` pattern already
  on the `reports` table: `pending`/`resolved`/etc., don't invent new
  status vocabulary).
- Moderation UI: build as a sibling to the existing reports-review flow
  (`public/src/features/reports/reports.js` + `reports-view.js` under
  `features/control/`) rather than a new paradigm — same list/resolve/
  dismiss shape.
- Decide identity before building: regular readers are currently only
  device-identified (no display name concept outside `admin_users`).
  Either (a) require setting a display name once before commenting
  (stored alongside `deviceId` in localStorage, sent with each comment),
  or (b) show comments as anonymous/"Student". Don't default to (a)
  silently — confirm which is wanted before writing the schema, since it
  changes the table shape (a nullable `display_name` column vs. none).
- Write path: new `admin.js` action for posting/moderating (same
  function-budget reasoning as everywhere else in this plan), or a second
  Supabase Edge Function if `admin.js` is getting unwieldy by this point
  — reassess file size at this point rather than deciding now.

**Phase 4 is done when:** 4a's same-device view is live (cross-device
sync only if pursued), and 4b's comment posting + moderation queue both
work end-to-end.

---

## Explicitly out of scope for this plan (do not build unless asked)

- Any scoring, points, badges, or level interaction for lessons.
- A module/chapter table separate from `folders`.
- Multi-step/chained adaptive branching beyond one rule per question.
- Inlining full quiz-taking UI inside the lesson page (quiz refs link out).
- A real (non-browser) TTS API integration.
- A new top-level `api/*.js` file for anything — see ground rules.

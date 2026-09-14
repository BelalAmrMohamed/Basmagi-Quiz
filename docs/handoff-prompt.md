# Handoff prompt — Basmagi Quiz: markdown engine fix + media migration completion

This is the back up I made earlier for the db before the media migration [backup](basmagi_quiz_backup_pre_media_migration.json)

---

## Context

I'm migrating a quiz platform ("Basmagi Quiz") away from legacy dedicated
`image`/`audio`/`video` fields on question objects, toward embedding media
inline inside the question body text using Markdown-style bracket syntax:
`![alt](url)` for images, `![audio](url)` for audio, `![video](url)` for
video (YouTube links auto-embed as an iframe).

A previous assistant session already did most of the code-side work and
started the database migration, but made a **process mistake I need you to
avoid repeating**, and left **two functional bugs unfixed** that are
higher priority than finishing the migration. Read this whole prompt
before doing anything — it's meant to be fully self-contained, so you
should not need to hunt through repo docs to reconstruct this context.

There is a plan document at `docs/plans/markdown-media-migration-plan.md`
in the repo from earlier sessions, but **do not read it** — it has grown
very large and reading it in full is expensive. Everything you actually
need to know is below. If you want to double-check something specific
against it later, search/grep for a narrow term rather than reading the
whole file. Trust the actual current source code over any doc, including
this prompt, if the two ever disagree.

## The mistake to avoid: DO NOT hand-edit quiz rows one at a time

The previous session was told explicitly: **do not manually update the
legacy quizzes one by one.** It was supposed to write a migration script,
run it once (or twice: once to compute, once to apply), and be done in a
small, fixed number of tool calls. Instead it:

- Wrote a Python transform, validated it correctly against a local backup
  copy of the data (this part was fine and can be reused/trusted).
- Then applied the transform to the live Supabase database by **manually
  constructing and pasting giant raw SQL `UPDATE` statements one row (or
  a batch of rows) at a time**, burning a huge number of tool calls and
  a large amount of the user's usage budget in the process.
- In the middle of this, it **truncated one of the pasted SQL statements
  by mistake**, which executed successfully but **wiped the `questions`
  array of one live quiz row down to empty** before the mistake was
  caught and fixed from the backup.

**Do not repeat this pattern.** If you need to write data to Supabase:

1. Prefer running the actual transformation **as a script Supabase can
   execute in one shot** — e.g., a single `UPDATE ... FROM (SELECT ...
   jsonb_array_elements/jsonb_build_object...) ...` pure-SQL statement
   that does the fold *inside Postgres* using `jsonb` functions, computed
   from the existing `data` column directly, so there's no need to
   generate or paste any per-row JSON blobs at all. This is almost
   certainly possible for this transform (see "The actual migration
   logic" below) and avoids ever having a client-side copy of full quiz
   JSON in a tool call.
2. If a pure-SQL approach genuinely isn't feasible and you must generate
   JSON payloads client-side, do it as an actual script file executed via
   the bash/code tool, writing results to a file, and use that file's
   content (or a checksum of it) to drive the DB write — never
   hand-copy/paste large per-row JSON blobs into chat or into a tool
   call's arguments, since that's exactly what caused the truncation
   accident.
3. Whatever approach you take, the whole live-database write should be
   expressible in **one or two tool calls total**: one to run the backup
   query (already done — see below, don't redo it unless you have reason
   to believe the data has changed) and one to run the actual migration
   `UPDATE`. If your plan involves more than ~2 Supabase write calls,
   stop and find a way to batch it into fewer.
4. After writing, run **one verification query** that checks the whole
   table at once (e.g., aggregate counts of remaining legacy-field rows,
   a checksum, or a `jsonb_array_length` sanity check across all 215
   rows) rather than checking rows one by one.

## What's already done (backup + validated transform — reusable)

A full backup of the `quizzes` table (215 rows, columns `id` + `data`) was
taken and verified before any writes began. It's independently
checksummed: 215 unique rows, and re-confirmed against a fresh live query
that **13 rows have a legacy `image` field, 5 have `audio`, 6 have
`video`** somewhere in their `questions` array (some rows overlap
categories, and there are 20 unique rows total needing changes). This
backup file may still be attached to this conversation or may need to be
re-derived — check first via:

```sql
select
  count(*) as total_quizzes,
  count(*) filter (
    where exists (
      select 1 from jsonb_array_elements(data->'questions') q
      where (q->>'image') is not null and trim(q->>'image') <> ''
    )
  ) as quizzes_with_image,
  count(*) filter (
    where exists (
      select 1 from jsonb_array_elements(data->'questions') q
      where (q->>'audio') is not null and trim(q->>'audio') <> ''
    )
  ) as quizzes_with_audio,
  count(*) filter (
    where exists (
      select 1 from jsonb_array_elements(data->'questions') q
      where (q->>'video') is not null and trim(q->>'video') <> ''
    )
  ) as quizzes_with_video
from quizzes;
```

Expected result: `total_quizzes = 215`, `quizzes_with_image = 13`,
`quizzes_with_audio = 5`, `quizzes_with_video = 6`. **If this doesn't
match, stop and investigate before touching anything** — it means the
live data has changed since the last backup and you need a fresh one
before migrating.

**Take a fresh backup regardless**, even if the counts match, since "the
counts match" doesn't prove byte-identical content. A fast way to do this
in one call:

```sql
select jsonb_agg(jsonb_build_object('id', id, 'data', data) order by id) as backup
from quizzes;
```

Save/present that result to the user as a downloadable file before
writing anything, per the project's own standing instruction ("the backup
must be taken and presented before any migration write happens").

## The actual migration logic (what the transform does)

For every question object that has a non-empty `image`, `audio`, and/or
`video` field:

1. Build a markdown tag per present field, **in this exact order**:
   image first, then audio, then video:
   - `image` → `` `![صورة توضيحية للسؤال](${image_url})` `` (note: the
     alt text is the literal Arabic string "صورة توضيحية للسؤال", meaning
     "illustrative image for the question" — reuse exactly this string
     for consistency with content already migrated)
   - `audio` → `` `![audio](${audio_url})` ``
   - `video` → `` `![video](${video_url})` ``
2. Join present tags with a single newline (`\n`) between them.
3. Append the joined tags to the question's existing `q` (question body)
   text: if `q` already has non-whitespace content, append as
   `${trimmed_q}\n\n${joined_tags}` (blank line separator); if `q` is
   empty, the tags become the entire `q` content.
4. Delete the `image`, `audio`, and `video` keys from the question object
   entirely — do not leave them present-but-empty.
5. Leave every other field on the question (options, correct, answer,
   explanation, id, etc.) completely untouched.
6. Leave every other part of the quiz row's `data` (meta, stats, and any
   questions that had no legacy media fields) completely untouched.

This is a pure, mechanical, per-question transform with no ambiguity —
it's a strong candidate for expressing directly in `jsonb` SQL functions
(`jsonb_agg`, `jsonb_build_object`, `jsonb_array_elements`, `||` for
merging/removing keys via `- 'image' - 'audio' - 'video'`) run as a single
`UPDATE quizzes SET data = jsonb_set(data, '{questions}', <transformed
array>) WHERE <row has any legacy field>`. Strongly prefer building this
as one SQL statement over generating JSON client-side.

A previous session already computed and validated this exact transform
against all 20 affected rows using a Python script and a rigorous
per-question check (confirmed: legacy keys removed, correct tag(s)
present in the right order, all other fields byte-identical) — that
validation work is sound and you can trust the transform logic above, you
just need to actually execute it correctly and efficiently, which the
previous session failed to do.

**5 of the 20 affected rows were already correctly migrated and verified
before the mistake was caught** (ids: `0a1b7bcd-e3b9-4e0b-995a-4396c395e638`,
`1baab4c8-0ade-4d7e-ae2a-addbc87350c4`, `1c96003b-7fa7-4789-831b-26960db5a893`,
`28a62adc-fc70-4ba0-8e4e-4425cba085f7`, `2b47c833-71e8-4568-b3de-9d73afa423aa`
— the last of these is the one that was briefly wiped to empty and then
correctly restored from backup, confirmed 40/40 questions, no legacy
keys). **Verify these 5 are still correct** (no legacy keys, question
counts match the backup) before deciding whether your migration query
should target only the remaining 15 or can safely re-run against all 20
(re-running against an already-migrated row should be a safe no-op if
your `WHERE` clause correctly checks for the *presence* of legacy fields,
so targeting all 20 uniformly is fine and simpler — just confirm the
already-done 5 don't get double-processed into some broken state, e.g. by
testing your query's `WHERE` condition excludes rows with no legacy keys
left).

## Priority 1 (before touching the DB migration further): fix the markdown engine bug

**This is more urgent than finishing the database migration and should be
done first.** The user reports:

> I tested the markdown engine, I uploaded an image to a question on the
> create-quiz page, then pressed the "المعاينة" (preview) button on the
> quiz, but I didn't see the image, I saw the literal `<>` object, not the
> rendered image. I saved the quiz and went to take it on the quiz.html
> page — same thing. So it's a problem in the markdown engine itself.

Investigate this as a real bug, from scratch — don't assume you know the
cause. Some things worth checking, based on prior investigation of this
codebase (but verify all of this yourself against the actual current
code, don't trust it blindly):

- `public/src/shared/markdown.js` implements the current bracket-syntax
  media rendering (`![alt](url)`, `![audio](url)`, `![video](url)`) and
  is the only place that recognizes media tags today — there is no raw
  HTML `<img>`/`<video>`/`<audio>` tag sanitizer/renderer in the file
  (it was intentionally removed in an earlier migration step, as part of
  moving from raw HTML media tags to the bracket syntax).
- `public/src/features/create/create-quiz.js` has a drag-and-drop/paste
  media upload system (`setupMarkdownMediaDropzone`,
  `handleMarkdownMediaFile`, `MEDIA_TAG_BUILDERS`) that inserts a tag into
  the textarea after upload completes. A previous session changed
  `MEDIA_TAG_BUILDERS` to emit the bracket syntax (`![alt](url)` etc.)
  instead of raw HTML tags, and verified via a **jsdom-only, non-browser**
  harness that the new tag format renders correctly through
  `markdown.js`'s `renderMarkdown()` function in isolation.
- **That jsdom verification was never actually checked against the real
  running app in a browser** — the user's report of literally seeing
  `<>` (or similar) suggests either: (a) the fix didn't actually get
  built/deployed/reloaded before the user tested it, (b) there's a
  caching issue, (c) there's a second, different code path that still
  produces or mishandles the media tag that the jsdom test didn't cover
  (e.g. some other function upstream double-escaping the tag before it
  reaches `renderMarkdown`), or (d) the fix has some other bug not caught
  by the narrow jsdom test. **Don't assume which of these it is — trace
  it from the actual current source.**
- Check `escapeHtml`/`escHtml`-style functions and confirm exactly where
  in the pipeline (from textarea input, to save, to storage, to load, to
  render) the question body text gets HTML-escaped and where markdown
  parsing happens, and confirm the ordering is: raw markdown text with
  media tags → HTML-escape any *other* raw HTML the author typed → THEN
  run the media-tag regex/parser → producing final safe HTML with real
  `<img>`/`<audio>`/`<video>` elements. If the media-tag parsing happens
  *before* HTML-escaping, or if escaping is applied a second time to its
  own output, that would explain literal `<...>` text showing up instead
  of a rendered element.
- Check both the create-quiz preview path AND the quiz-taking
  (`quiz.js`)/result (`result.js`) rendering paths — the user says it
  fails in both places, so look for whichever code is shared between them
  (likely `markdown.js`'s `renderMarkdown` itself, but confirm).

Fix the actual root cause, then verify with **both** an automated
string/DOM-level check (comparable to before) **and**, since you may not
have real browser access either, be explicit and honest with the user
about which verification method you used and what its limits are — don't
imply real-browser verification if you only did another jsdom-style
check. If you do have access to a headless browser or similar in your
environment, use it and say so.

## Priority 2 (also before/alongside finishing the DB migration): fix the radio-button vs. checkbox regression

The user reports:

> Before this update, quizzes could have 1 correct answer or multiple
> answers. When it's one correct answer, the quiz page would show radio
> buttons on the options. When it's multiple answers, the quiz page would
> show checkboxes. I remember the quiz page showed radio buttons when the
> `correct` field was an integer, and checkboxes when it was an array.
> That design wasn't perfect, because in the create-quiz page, creators
> didn't have the ability to force checkboxes on a question with only 1
> correct answer (for "choose one or more" type quizzes). That got even
> worse — now all questions created through the create-quiz page show
> checkboxes on all questions, regardless of how many correct answers
> there are.

Investigate and fix this properly:

1. Confirm the current behavior in `quiz.js` (or wherever the
   radio/checkbox rendering decision is made): verify whether it's
   currently keying off `Array.isArray(question.correct)` (matching the
   user's memory of the old behavior) or something else, and confirm
   whether `create-quiz.js` (or its question-templates / save logic) now
   *always* produces an array for `correct` regardless of how many
   correct answers the creator actually selected — this would explain
   "all questions now show checkboxes."
2. **Design fix, don't just patch the symptom.** The old design
   conflated two independent concerns into one field's *type*: (a) how
   many answers are actually correct, and (b) what UI control the
   quiz-taker should see. That's fragile — exactly the kind of coupling
   that caused this regression. Recommended approach (proposed by the
   user, refine as needed): add an explicit, separate boolean field on
   the question object — e.g. `multiSelect: true | false` — that solely
   controls whether the quiz-taking UI renders checkboxes (multi-select)
   or radio buttons (single-select), completely independent of whether
   `correct` is stored as an integer or an array. Then:
   - `quiz.js`'s rendering logic reads `question.multiSelect` (falling
     back to the old `Array.isArray(question.correct)` heuristic *only*
     for old questions that predate this field, for backward
     compatibility with already-saved quizzes) — not `correct`'s type —
     to decide radio vs. checkbox.
   - `create-quiz.js` gets a real UI control (the user suggested a
     toggle in each question's "more options" menu, labeled something
     like "اختر إجابة واحدة أو أكثر" / "select one or more answers") that
     sets `multiSelect` explicitly, independent of how many options the
     creator has currently marked correct. This directly fixes the gap
     the user identified in the *old* design too (no way to force
     checkboxes for a single-correct-answer question) — that's a
     genuine improvement opportunity here, not scope creep, since the
     user explicitly asked for it.
   - Decide (and clearly state your decision and reasoning to the user)
     whether `correct` should always be stored as an array going forward
     (simpler, one format, `multiSelect: false` just means "only one
     array entry is allowed/enforced at answer-check time") or should
     keep varying in type based on `multiSelect`. Recommend the
     always-array approach for consistency and to avoid ever needing to
     branch on `correct`'s type again, but flag this as a design decision
     worth the user's sign-off on rather than silently picking one.
   - Make sure the answer-checking/scoring logic (wherever a submitted
     answer is compared against `correct` to grade the question) is
     updated consistently with whatever storage format you land on.
3. Trace *why* `create-quiz.js` currently always produces an array
   (this is likely a simple, findable bug — e.g. a toggle/checkbox input
   that always wraps the value in `[...]` regardless of context) before
   deciding on the full fix — understanding the actual regression's cause
   will make the fix more precise and reduce the risk of missing another
   related bug nearby.
4. Verify your fix handles all these cases correctly: a brand-new
   single-answer question created after your fix; a brand-new
   multi-answer question; an old pre-migration question loaded from a
   quiz authored before this fix existed (backward compatibility); and a
   question imported via the JSON import flow.

## Suggested order of work

1. Fix the markdown-engine media-rendering bug (Priority 1). Verify
   thoroughly and be honest about verification method/limits.
2. Fix the radio/checkbox regression with the proper `multiSelect` design
   (Priority 2). Get the user's sign-off on the storage-format decision
   before writing it if you're unsure.
3. Only then, finish the database migration for the remaining 15 (or all
   20, if reprocessing already-done rows safely) affected quiz rows,
   using a single efficient SQL-side transform as described above — not
   one-row-at-a-time manual SQL. Take a fresh backup first and present it
   to the user. Run one verification query afterward confirming the
   whole table is in the expected state (0 rows with legacy
   image/audio/video keys, 215 total rows, no row's `questions` array
   unexpectedly empty/shrunk vs. the backup).
4. Check whether `public/src/features/home/ai-prompts.js` still tells the
   AI-quiz-generation prompt to emit legacy `"audio"`/`"video"` JSON keys
   instead of inline bracket-syntax tags (grep for `"audio"` and
   `"video"` in that file). If so, update its example JSON and
   instructions to match the current bracket syntax. This is low priority
   — only do it after 1–3 above are genuinely done.
5. Briefly summarize what you changed and verified at the end, so the
   user has a clear record — but there's no separate plan document to
   update as part of this work; a normal end-of-task summary is enough.

## Constraints and reminders

- No Supabase writes without a fresh, presented backup immediately
  before them.
- No more than ~2 Supabase write calls for the entire remaining
  migration.
- Do not paste large per-row JSON blobs into tool calls as a way of
  writing data — that's what caused the previous accident.
- Verify with whole-table queries, not per-row spot checks, as the
  primary verification method (spot checks are fine as an *additional*
  sanity check, not instead of an aggregate one).
- Be transparent with the user about tool/credit usage as you go,
  especially before starting the DB write step — confirm your planned
  approach (ideally: "1 backup query + 1 migration query + 1
  verification query") before executing it, given the user's stated
  sensitivity to this after the previous session's inefficiency.
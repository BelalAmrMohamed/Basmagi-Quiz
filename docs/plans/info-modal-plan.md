# Plan: unified info modals (quiz / lesson / notebook)

## Decisions (settled in grilling)
- Classification for lessons/notebooks: **new columns** `education_type, college, year, term` on `lessons` and `notebooks`, kept correct by a **DB trigger + backfill** from the course.
- Notebook views: **add counter** (`view_count` + RPCs), mirroring lessons.
- Dates: **`YYYY-MM-DD` for both** created and updated, LTR, one shared formatter; full timestamp in `title` tooltip.
- Local items (محتواي): omit missing fields, show a **«محلي»** badge instead of course/folder. Never placeholders.
- Layout: one shared shell, designed (see Design). Type-specific stats go in their own section.
- Source: the literal `platform` (any case) is treated as "no source". No fake source, no literal text.

## Root causes (verified in code)
1. `platform` leak: catalog entities carry `source: "platform"` (see `lesson-blocks.js` quizRef). `collectLessonInfo` (`home/lesson-info-modal.js`), `collectNotebookInfo` (`shared/notebook-export.js`) and the quiz config pass it to `infoSourceHtml` unfiltered.
2. `1 → Data Mining`: `updateBreadcrumb()` in `features/quiz/quiz.js` (~L916) takes `parts[quizzesIdx+4]` as the course, so a numeric path segment lands in the course slot; `fullBreadcrumb` (`A → B`) is then passed as `config.category`, and `buildQuizInfoModalHtml` shows `categorySegments[0]`. Home modal uses the DB course name, hence correct there.
3. Date mismatch: lesson/notebook modals run the updated date through `toLocaleString("en-US")` (`11/5/2026`) before `formatDateForInfo`; created date stays ISO.
4. Lesson "المحتوى: فارغ": rendered whenever `blockCounts` is empty. Platform lesson summaries from the manifest have no `lesson` content, so it is always empty there.

## Step 0: preconditions
- `cd` repo root; `npm test` passes baseline (`tests/` uses node tests; see `package.json`).
- Read `supabase/migrations/20260915000000_lessons.sql`, `20261102100000_notebooks.sql`, `20261101130000_lesson_view_count.sql`, `20261028120000_quiz_attempt_count_drop_quiz_access.sql` and copy their conventions (RLS, `SECURITY DEFINER`, `REVOKE/GRANT`).
- Confirm `courses` columns for education_type/college/year/term (migration `20260904000000_colleges.sql` / `20260904010000_public_relational_reads.sql`) and the exact value formats (e.g. college `"All"`).

## Step 1: migrations (new files, timestamp > 20261109160000)
1. `20261111100000_lesson_notebook_classification.sql`
   - `ALTER TABLE lessons, notebooks ADD COLUMN education_type text, college text, year <same type as quizzes.year>, term <same type as quizzes.term>`.
   - Function `copy_course_classification()` (BEFORE INSERT OR UPDATE OF course_id): when `course_id` is not null, set the four columns from `courses`. Attach to both tables (mirror `lessons_enforce_course_consistency`).
   - Backfill: `UPDATE ... SET ... FROM courses WHERE course_id = courses.id`.
   - Also trigger on `courses` UPDATE of those columns to cascade to its lessons/notebooks (so editing a course doesn't leave drift).
2. `20261111100100_notebook_view_count.sql`: `notebooks.view_count bigint NOT NULL DEFAULT 0`, `increment_notebook_view(uuid)`, `get_notebook_view_count(uuid)`; same grants as the lesson ones (`anon, authenticated`).
3. Check `api/` and MCP import paths (`mcp-draft-import.js`, `api/mcp/*`): they insert with `course_id`, so the trigger handles them. Confirm none use a column allow-list that rejects the new ones.

## Step 2: shared helpers (`public/src/shared/` or `components/quiz-info-modal/`)
New `info-model.js` (pure, unit-testable):
- `normalizeSource(v)`: trim; return `null` if empty or `/^platform$/i`. Use everywhere before `infoSourceHtml`.
- `formatInfoDate(raw)`: accepts ISO string, Date, `"11/5/2026"`-style legacy, `"2026-11-05 - ..."`; returns `YYYY-MM-DD` (use UTC-safe slicing for ISO; for `Date` use local y-m-d). Replace `formatDateForInfo` body (keep the export name so existing imports work). Delete the `toLocaleString("en-US")` calls.
- `courseTrail(courseName, folderPath[])`: returns `{course, folders[]}`; `cleanSegment()` drops purely numeric/ordering segments (`/^\d+$/`) and empty strings.
- `buildInfoModel(kind, raw)`: normalizes to
  `{kind, title, description, classification:{eduType,college,year,term}, location:{course,folders,local}, dates:{created,updated}, source, link, engagement:{label,count}, specific:[{label,value}], creator, id, passwordProtected}`.

## Step 3: shared renderer `buildInfoHtml(model)` (reuse existing `.quiz-info-*` shell + new CSS)
Sections, each omitted when empty:
1. **Hero**: kind icon, title, description, big engagement stat (`مرة تم حل هذا الامتحان` / `مشاهدة`), 🔒 pill if protected.
2. **Classification chips**: edu type · college · year · term as 4 compact chips (icon + value), wrapping. Not a list.
3. **Location**: breadcrumb `المادة › المجلد › المجلد الفرعي` as clickable-looking trail (plain text if no router link). «محلي» badge when local.
4. **Dates**: two side-by-side tiles, `تاريخ الإنشاء` / `آخر تعديل`, same format; hide the updated tile when equal to created.
5. **Type-specific** (collapsible `<details open>` on desktop, closed on phone):
   - Quiz: question count, question types, forced mode/view.
   - Lesson: sections, embedded questions, hidden sections, block-type counts (only non-zero), reader font.
   - Notebook: runtime, language, code/markdown cells, code lines.
6. **Links**: source row (only if `normalizeSource`) and platform link row, each with the existing copy button.
7. Creator card (existing `buildCreatorSectionHtml`), ID badge in a muted footer.
Keep RTL, escape every value, reuse `bindInfoCopyButtons`, skeleton helpers, and dark-mode tokens already in `quiz-info-modal-css.js`. Add the new CSS there (chips, tiles, trail); no hover-lift animations (`tests/no-hover-lift.test.js`). 

## Step 4: wire each modal
- **Quiz**: `buildQuizInfoModalHtml` becomes a thin wrapper over `buildInfoHtml(buildInfoModel("quiz", config…))`. Callers: `home/quiz-info-modal.js` (both fns), `quiz/quiz.js` (~L1339), `result/result.js` (~L332).
  - Fix المادة: in `quiz.js` pass the DB/course name when known (`details`/catalog course), else use `courseTrail` with numeric segment filtering; never pass the `→` string as `category`.
  - Add `updated` from `details.synced_at`, `created` from `created_at`.
  - User quiz modal (`showUserQuizInfoModal`): local ⇒ «محلي» badge.
- **Lesson**: rewrite `collectLessonInfo` to also return classification/course/folder/dates; `buildLessonInfoBodyHtml` → shared renderer (still used by `features/lesson/lesson-info-modal.js` control dialog, which appends progress/bookmarks sections; keep that working). Remove the `"المحتوى: فارغ"` row (omit when no blocks; for platform summaries without content use `section_count` only). Course/folder: fetch names by `course_id`/`folder_id` (extend `info-details.js` with `fetchLessonDetails(id)` selecting `education_type,college,year,term,course_id,folder_id,created_at,updated_at,created_by`; resolve names from the in-memory category tree first, DB second). Hydrate async like `hydrateLessonCreator`.
- **Notebook**: same via `fetchNotebookDetails`; `collectNotebookInfo` returns classification/course/folder; views via `get_notebook_view_count`; call `increment_notebook_view` once per session when a notebook opens (copy `recordLessonView` with a `notebook_viewed_` key; hook where the notebook page loads, check `features/notebook`).
- Also update the ⋮ submenu rows (`appendNotebookMenuEntries`, lesson/quiz submenus) only if trivial; otherwise leave as is.

## Step 5: tests (`tests/`, match existing node-test style)
- `info-model.test.js`: `normalizeSource("platform"|"Platform"|" ")→null`, real URL kept; `formatInfoDate` for ISO, `11/5/2026`, Date, null; `courseTrail("Data Mining",["1","Sec"])` drops `1`; `buildInfoHtml` omits empty sections, no literal `platform`, no `فارغ`, same date format in both tiles.
- Update `notebook-export.test.js` / `notebook-ui-parity.test.js` if `collectNotebookInfo` shape changes.
- Migration sanity: run `supabase db reset` locally if available, else review SQL by hand.

## Step 6: verify
- `npm test`.
- Playwright (preinstalled) screenshots at 390px and 1280px, light and dark, for: platform quiz, local quiz, platform lesson, local lesson, platform notebook, local notebook. Check chips wrap, no overflow, RTL correct, no `platform`, dates identical format.
- Manual check of the three original bugs: quiz page المادة equals home page; `platform` gone from info rows; lesson/notebook show type/college/year/term, course/folder, date, views.

## Out of scope / flagged
- Existing rows with `course_id IS NULL` get empty classification (chips hidden).
- Course edits cascading via trigger touches many rows only when classification actually changes.
- Quiz `quizzes.college = 'All'` is already hidden in the quiz modal; apply the same rule to lessons/notebooks.

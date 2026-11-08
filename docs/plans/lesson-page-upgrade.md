# Lesson Page Upgrade: copy fix, quiz-grade questions, sidebar navigator, embeds with thumbnails

Goal: upgrade `/lesson/:id` (public/lesson.html) with the 8 items below | Done when: every step's Check passes and `npm test` (node --test) is green.

> Facts under Verified are checked; treat them as true. Read a file only if you are about to edit it or a Read-only entry lists it. Do not scan or read the whole repo. If something contradicts the plan on contact, fix it and continue; do not stop to re-audit.

Rules from the owner: do NOT edit `PROJECT_STRUCTURE.md` (auto-updated on push). No Supabase migration is needed in this plan. Lessons are never scored: nothing here may write to Supabase or touch points/levels. Prefer native HTML/CSS over JS (docs/issues.md "Performance" rule): reveal states via CSS classes/attributes, no re-rendering on answer.

## Verified (trust these; do not re-check)
- Copy-button bug: the lesson page's modal `showLessonControlModal` builds `dialog.innerHTML` with `buildLessonInfoBodyHtml(info)` (which emits `.info-copy-btn` buttons via `infoSourceHtml`/`infoItemLinkHtml`) but never calls `bindInfoCopyButtons(dialog)`. The home-page variant does (`features/home/lesson-info-modal.js:246`). `shared/info-link.js` exports it; `quiz-info-modal.css` (button styles) is already linked in lesson.html. (public/src/features/lesson/lesson-info-modal.js:113-133)
- Section DOM ids are `lesson-section-${section.id}` (lesson-view.js:429); hidden/adaptive sections carry class `lesson-section--adaptive`; section order/titles come from `normalizeLessonContent()`; visited sections are in `getLessonProgress(lessonId).visitedSections`; `markSectionVisited` exists (lesson-schema.js:257).
- The floating TOC is intentionally disabled: `const tocHtml = "" && renderLessonToc(...)` (lesson-view.js ~983). Leave `lesson-toc.js` and that line untouched.
- Sidebar: `<aside id="sidebar" class="sidebar">` > `<nav>` containing `.menu-item` links, a `.menu-divider`, then `.theme-controls-section` (lesson.html). Collapsed rail uses `.sidebar-collapsed-only` buttons that just expand the sidebar (pattern: `.theme-section-header.sidebar-collapsed-only`, handled in side-menu.js ~864). Mobile uses the same `<aside>` as a bottom sheet.
- `shared/toc-scroll-spy.js` exports `createGeometryTocScrollSpy({...})` (used by lesson-toc.js:101-123).
- Embedded question markup is in `lesson-blocks.js`: `renderMcqQuestionBody`, `renderEssayQuestionBody`, `equipQuestionBlocks`, `revealMcqAnswer`, `revealEssayAnswer`; classes `.lesson-question__*`; essay graded by `gradeEssay()` (>=3/5 counts as close); answers stored via `recordQuestionAnswer`/`appendEssayAnswerText`. Quiz-page look lives in quiz.css (`.essay-textarea` ~2720, `.formal-answer` ~2771, `.option-row` ~2830) and quiz.js feedback markup (~1930-1990: `.mcq-explanation-label`, `.feedback-body`, `.formal-answer-score`).
- Existing embeds: block types `quizRef` (`quizId`, UUID or 8-char code) and `lesson-reference` (`lessonId`, alias `lessonRef`); rendered by `renderReferenceCard` (lesson-blocks.js ~88-135); lookups built in lesson-view.js (`fetchQuizRefs` ~155, `fetchLessonRefs` ~219, `collectQuizRefIds` ~270) and passed as `ctx.{quizLookup,lessonLookup}`; unknown block types render as empty string (older builds stay safe).
- Files that enumerate reference block types and must stay in sync: `public/src/shared/content-rules.js` (~275, 354-357, 413 error text), `api/_validateLesson.js` (36-37, 111-125, 250), `public/src/features/lesson/lesson-json.js` (81-97, 213-218), `public/src/features/lesson/lesson-schema.js` (`normalizeLessonReferenceBlock` 129, `collect*ReferenceIds` 149-170), `public/src/features/create-lesson/create-lesson.js` (editor: ~94, 1393, 2206, 2353, 2437, 2454, 3028, 3321), `public/src/features/home/create-lesson-modal.js`, `public/src/features/home/lesson-info-modal.js`, `api/_og/lesson.js`, `supabase/functions/mcp/lib.ts` + `index.ts`, `tests/content-rules.test.js`, `tests/mcp-lib.test.js`.
- `content-rules.js` is the single source; copies in `supabase/functions/mcp/content-rules.js` and `scripts/lib/content-rules.js` are produced by `npm run sync:mcp` (a test fails if they differ).
- No SQL mentions block types, and `lessons.content` is jsonb: no migration needed.
- Thumbnails already exist server-side (Edge): `/api/og?quizId=<8-char id>`, `?lesson=<id|slug>`, `?notebook=<id|slug>`, `?course=<uuid>`, `?course=<uuid>&folder=A/B` (raw folder names joined by `/`), each with cache-bust `&v=<layoutVersion>-<updated_at epoch ms>`. Layout versions live in `api/_og/version.js` (`OG_LAYOUT_VERSION`: quiz 4, course 6, lesson 1, notebook 1).
- Data for new embeds: `notebook_public` view (id, slug, title, description, runtime, course_id, folder_id, cell_count, updated_at...), `courses` (id uuid, name, icon, updated_at), `folders` (id, course_id, parent_folder_id, name, icon, updated_at). All uuid ids.
- Route shapes: `/notebook/:id`, `/lesson/:id`, `/quiz/:id`, `/course/<slug>/<slug>...` where each part is `toSlug(name)` (category-view.js:104).

## Decisions
- New block types use the existing kebab style: `notebook-reference` (`notebookId`), `folder-reference` (`folderId`), `course-reference` (`courseId`); accept aliases `notebookRef`, `folderRef`, `courseRef` and normalize to kebab (same as `lessonRef`): consistency with `lesson-reference`.
- New reference ids must be UUIDs when `publish=true`: same rule as `lesson-reference`.
- Embeds stay link-out cards (no inline execution): scoring/runtime stays on the real pages; same stance as `quizRef`.
- Card layout: thumbnail beside text on desktop (>=640px), stacked 16:9 on mobile: owner's choice.
- Thumbnail source is `/api/og` with a version stamp; a client mirror of the layout versions goes in `public/src/shared/og-thumb.js`, guarded by a test that compares it to `api/_og/version.js`: the client cannot import from `api/`.
- No thumbnail request for password-protected or unavailable items, or items without a published id (local drafts): show a gradient placeholder with the kind icon (+ lock icon if protected): avoids leaking titles/content and broken images. Also use the placeholder on `<img>` `error`.
- Folder/course/notebook lookups: three parallel `.in("id", ids)` queries next to the existing two in `lesson-view.js`; for folders also fetch `folders` by the involved `course_id`s to build the path in memory: no new endpoint.
- Section navigator lives inside the sidebar `<nav>` (new module, not lesson-toc.js); on the collapsed rail it is one icon button that expands the sidebar; on mobile it appears in the bottom sheet.
- Navigator shows only sections with titles, hides `defaultHidden` ones until revealed, marks visited, highlights the current one (scroll spy), shows read time (`ceil(words / 180)` min over markdown block bodies, min 1).
- Heading anchor copy copies `${origin}/lesson/${slug||id}#lesson-section-${id}` (existing hash format).
- Keyboard shortcuts: new tiny listener in the navigator module, not `initKeyboardNav` (its map is quiz-specific): `j` = next section, `k` = previous; ignored in inputs/textareas/contenteditable, with modifiers, or while a `<dialog>` is open; hint shown in the buttons' `title`.
- Question restyle keeps class names `.lesson-question__*`, local-only progress, no scoring; only markup/CSS/feedback change. Explanation and correct answer are already in the DOM at first render: reveal with attributes/classes, never re-render.
- Recap card: appears after the last section when at least one question exists; "retry wrong" clears only the wrong questions' stored answers via a new schema helper and then follows the same refresh path as the existing reset-all handler.

## Steps (each leaves the project working; stop anywhere)

1. Fix the dead copy buttons
   Edit: public/src/features/lesson/lesson-info-modal.js (import `bindInfoCopyButtons` from `../../shared/info-link.js`; call `bindInfoCopyButtons(dialog)` right after `dialog.innerHTML = ...`)
   Read only: none
   Check: open a lesson, open "معلومات الدرس", click copy on source and link: icon turns into a check for ~1.8s and the clipboard holds the URL.

2. Quiz-grade question UI
   Edit: public/src/features/lesson/lesson-blocks.js, public/src/features/lesson/lesson.css
   Read only: public/src/features/quiz/quiz.css (~2700-3000, option/essay/formal-answer rules), public/src/features/quiz/quiz.js (~1930-1990 feedback markup)
   Do: mirror quiz-page option rows (marker, hover, selected, correct, wrong, disabled), a verdict banner with icon and color, "الشرح" label for the explanation, multi-select shows missed-correct options (dashed) besides wrong picks; essay: locked textarea style from `.essay-textarea.locked`, score badge + stars styled like `.formal-answer-score`, model answer in `.formal-answer` style; light + dark + dark-slate themes; reduced-motion respected via existing `data-motion`.
   Check: answer MCQ (single, multi) and essay in all three themes; reload restores revealed state; no layout jump on reveal.

3. Sidebar section navigator + anchors + shortcuts
   Edit: public/src/features/lesson/lesson-section-nav.js (new), public/src/features/lesson/lesson-view.js (call it after render; add heading anchor button markup in the section header near line 429), public/src/components/side-menu/side-menu.css (nav block styles), public/src/features/lesson/lesson.css (anchor button)
   Read only: public/src/shared/toc-scroll-spy.js, public/src/components/side-menu/side-menu.js (~855-870, collapsed-rail pattern)
   Check: desktop expanded sidebar lists sections with read time, current one highlights while scrolling, visited marked, click scrolls; collapsed rail icon expands the sidebar; mobile bottom sheet shows the list; heading anchor button copies the deep link and opening it scrolls to the section; `j`/`k` move between sections and do nothing while typing in an essay box.

4. Thumbnail cards for existing quiz/lesson embeds
   Edit: public/src/shared/og-thumb.js (new: `ogThumbUrl(kind, {id, updatedAt, folderPath})` + layout version mirror), tests/og-thumb.test.js (new: asserts mirror equals `api/_og/version.js`), public/src/features/lesson/lesson-blocks.js (`renderReferenceCard`: thumbnail + placeholder + `onerror` fallback), public/src/features/lesson/lesson.css (desktop side-by-side, mobile stacked)
   Read only: api/_og/version.js
   Check: `node --test tests/og-thumb.test.js`; a lesson with quizRef and lesson-reference shows thumbnails; protected/unavailable ones show the placeholder; broken image falls back.

5. New block types: data layer, validation, JSON, MCP
   Edit: public/src/shared/content-rules.js, api/_validateLesson.js, public/src/features/lesson/lesson-json.js, public/src/features/lesson/lesson-schema.js, supabase/functions/mcp/lib.ts (+ index.ts only where it lists block types), tests/content-rules.test.js, tests/mcp-lib.test.js
   Read only: none (use the line anchors in Verified)
   Do: add the three kebab types plus aliases everywhere `lesson-reference` is handled (whitelists, normalizers, id collectors, UUID-on-publish rule, error text in `UNKNOWN_BLOCK_TYPE`, MCP guides/prompts that list block types). Then run `npm run sync:mcp`.
   Check: `npm test` green including content-rules sync test; MCP/upload/create-lesson validators accept and reject the same inputs.

6. Render notebook/folder/course embeds
   Edit: public/src/features/lesson/lesson-blocks.js (renderers + `renderBlock` cases + shared card with kind labels/icons/counts: notebook `cell_count`, course/folder item counts only if already in the fetched rows, otherwise omit), public/src/features/lesson/lesson-view.js (parallel fetch of notebooks/courses/folders, build folder paths, extend `ctx`, extend `equipReferenceCardActions` for open/info/ask where it applies), public/src/features/lesson/lesson-icons.js (notebook/folder/course icons if missing)
   Read only: public/src/features/home/category-view.js (~95-110, `toSlug` and course URL), public/src/features/lesson/lesson-view.js (~357-420, card actions)
   Check: a lesson JSON with one of each new block renders cards with thumbnails (`?notebook=`, `?course=`, `?course=&folder=`) and correct links; unknown ids show the "no longer available" card.

7. Editor pickers for the new embeds
   Edit: public/src/features/create-lesson/create-lesson.js, public/src/features/home/create-lesson-modal.js, public/src/features/home/lesson-info-modal.js (counts/summary if it tallies references)
   Read only: public/src/features/create-lesson/create-lesson.js (~94, 2206-2215, 2353, 2437-2454, 3028, 3321: mirror the lesson-reference picker exactly)
   Check: in /create-lesson add "+ دفتر مرتبط", "+ مجلد مرتبط", "+ مادة مرتبطة", pick items, save, publish: validators pass, the lesson page renders them; publishing with a non-UUID id is rejected with the same message style as lesson-reference.

8. Recap card with retry-wrong
   Edit: public/src/features/lesson/lesson-schema.js (add `resetQuestionAnswersByIds(lessonId, ids)`), public/src/features/lesson/lesson-blocks.js (recap markup + `data-retry-wrong` handled beside the reset-all handler), public/src/features/lesson/lesson-view.js (mount recap after last section; refresh on `onAnswered`), public/src/features/lesson/lesson.css
   Read only: public/src/features/lesson/lesson-schema.js (~252-330)
   Check: answer some questions wrong: recap shows answered/total and correct count, lists wrong ones with jump links; "retry wrong" clears only those, correct ones keep their state; reset-all still works; nothing is sent to the network.

## Out of scope
- Scoring/points for lessons; inline execution of notebooks/quizzes inside lessons.
- New DB columns or custom thumbnail uploads.
- Replacing the disabled floating TOC (`lesson-toc.js` stays as is).
- Editing PROJECT_STRUCTURE.md, CHANGELOG.md.
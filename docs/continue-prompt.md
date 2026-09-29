### Task 1 — Fix Global Markdown / LaTeX Dropdown Toggles
Fix the state system for both `create-lesson` and `create-quiz` toggles (`.gmd-btn.gmd-btn-latex.gmd-dropdown-toggle`, `.gmd-btn.gmd-dropdown-toggle`, `#gmdHeadingToggle`, `#gmdHighlightToggle`, `#gmdLatexMoreToggle`).
- Implement one shared dropdown state system.
- Exactly ONE toolbar dropdown may be open at a time.
- Clicking the currently-open toggle again must close it.
- Opening another dropdown must automatically close the previously-open dropdown.
- Clicking outside or pressing Escape must close the open dropdown.
- Keyboard operation must work for all dropdown toggles (Enter and Space).
- ARIA state (`aria-expanded="true|false"`) must stay synchronized.
- Preserve the textarea/input selection and caret position while opening a dropdown, interacting with options, inserting formatting, and closing the dropdown. Focus must not be lost to a detached popup.

(Relevant existing file: `public/src/shared/global-markdown-toolbar.js`, already used by both pages via `setupGlobalMdBar()` in `create-quiz.js` / `create-lesson.js`.)

### Task 2 — Prevent Toolbar Dropdown Clipping / Scroll Problems
Fix the positioning architecture so dropdown menus on the global Markdown toolbar:
- Are not clipped by `.global-md-bar`.
- Do not break horizontal toolbar scrolling.
- Remain visually attached to their triggering control.
- Reposition safely when near the viewport edges.
- Remain usable on mobile and when the toolbar itself is horizontally scrolled.
- Do not introduce horizontal page overflow.

### Task 3 — Update create-lesson #menuBar to Match create-quiz
Update `#menuBar` in `public/create-lesson.html` so its implementation, design, and interaction model identically match the `create-quiz` page. Note: `create-lesson.js` currently has **no** menu-bar JS at all (`toggleMenu`, `closeAllMenus`, `toggleSubmenu`, `activateMenuKeyboardNav`, `_wireMenuBarAria`, `_setMenuExpanded`, `setupMenuBarListeners` all exist only in `create-quiz.js`, around lines 1040–1250). Port/share this system so create-lesson's menu bar works identically.
- Unify opening/closing behavior, active item states, submenu/dropdown behavior, click handling, outside-click closing, keyboard accessibility, mobile behavior, RTL alignment, icons, spacing, and responsive layout.
- Reuse shared code/components to prevent divergent menu implementations.

### Task 4 — Redesign create-lesson Details Card
Redesign the `lesson-editor-details` card to match the visual language and interaction pattern of the `quiz-metadata` card from `create-quiz`.
- Add the missing `source` field.
- Keep all supported lesson functionality intact: title, description, source, font, password controls, and existing metadata.
- Do not copy quiz-specific fields that do not belong to lessons.
- Ensure it is responsive, RTL-correct, keyboard accessible, visually consistent, and usable on both mobile and desktop.

### Task 5 — Fix lessonFontSelect
Fix `#lessonFontSelect` and ensure these exact behaviors are strictly preserved:
- Changing the select immediately updates the lesson editor font visually.
- The preview area uses the selected font.
- `lessonData.fontId` updates immediately.
- Undo/redo history records the change correctly.
- Autosave captures the font.
- Opening a local draft, opening a local saved lesson, editing a published lesson, and reader rendering all restore and use the selected font.
- A missing/legacy font ID falls back safely.

(Relevant: `FONT_CHOICES` is already imported into `create-lesson.js` from `lesson/lesson-reader-prefs.js`.)

### Task 6 — Resolve the Lesson Reference Implementation
Fix all missing imports, incorrect module paths, and browser-global assumptions for `lesson-reference` content blocks.
- Ensure the reference module properly handles schema definition, normalization, editor insertion, editor state, persistence, and rendering.
- The implementation must render a normal lesson even if a referenced lesson is deleted, has a malformed ID, cannot be fetched, is corrupted, points back to the current lesson, or if multiple references exist.
- A broken reference must NEVER prevent the rest of the lesson from rendering.

(Note: `normalizeLessonReferenceBlock`, `collectLessonReferenceIds`, `collectQuizReferenceIds` already exist and look solid in `lesson-schema.js`; `fetchLessonRefs`/`fetchQuizRefs` in `lesson-view.js` already handle self-reference filtering, batched `.in()` lookups, and try/catch fallback. Audit the *editor-insertion* side in `create-lesson.js` for the same class of gaps, since that side hasn't been reviewed yet.)

### Task 7 — Update Embedded Quiz & Lesson Reference Cards
Apply the polished card architecture to BOTH referenced quizzes and referenced lessons.
- Support: Start / Open, Download, Info, and "اسأل الباشـمبصمج" (AI).
- Use proper icons (no raw emojis), keyboard-accessible buttons, and appropriate ARIA labels/tooltips.
- Clicking an action must NOT trigger the parent card click.
- Maintain mobile layout usability and RTL/LTR alignment.
- Actions must preserve existing authentication/password behavior.
- Info must reuse existing home-page information UI.
- Download must reuse existing download/export handlers.
- AI must attach the entity to the existing AI agent without duplicating the chat UI.
- Never expose credentials for protected quizzes/lessons.

(Relevant: `equipReferenceCardActions` in `lesson-view.js` already implements most of this for the reader side — start/download/info/ask actions with `stopPropagation`, reusing `showQuizInfoModal`/`showLessonInfoModal`/`downloadLesson`/`openAIAgentWithAttachment`. Verify it fully, then check whether create-lesson/create-quiz editor previews of these cards match.)

### Task 8 — Fix Lesson Description Integration
Implement the canonical optional `description` field end-to-end: create-lesson UI, live character count, autosave, local drafts, local saved lessons, editing, publish payload, server validation, database, lesson reader, home/library cards, and fallback behavior when omitted. Use one canonical field name everywhere — do not support aliases (`desc`, `lessonDescription`) unless the existing backward-compatibility layer explicitly requires it.

(Note: `create-lesson.js`'s `validateLesson()` already checks `lessonData.description.length > 1200`, and `lesson-view.js` already renders `lesson.description` in the header — verify the rest of the chain: UI char-count widget, autosave payload, publish payload, `api/_validateLesson.js`, Supabase schema, home/library cards.)

### Task 9 — Fix Lesson Password Protection
Standardize the password implementation for lessons: optional password, show/hide, copy, update existing password, remove existing password. Implement protected reader gating with no protected-content flash before unlock. Ensure protected download/export, server-side verification, no public password hash exposure, no plaintext password persistence. Handle legacy, unpublished, and local lessons correctly. Follow existing security patterns (see `lesson-access.js`: `isLessonProtected`, `requestLessonPassword`, `unlockRemoteLesson`, `verifyLocalLessonPassword`, `sha256Hex`, `validateLessonPasswordInput`) rather than inventing a new mechanism.

**This task touches auth/security-sensitive code paths — review each change carefully rather than applying in bulk, and pay particular attention to: no plaintext password ever written to localStorage or Supabase, no password hash ever sent in a public/unauthenticated API response, and the no-flash gating already partially implemented in `lesson-view.js`'s protected-lesson branch (content is nulled out before the DOM paints, only restored after `unlock()` resolves truthy).**

### Task 10 — Resolve Theme / Background Regressions
Fix the background-animation implementation across `create-lesson.css`, `create-quiz.css`, `themes.css`, and `flow-field.js`.
- `flow-field` must remain visible when `data-animations="enabled"`.
- A solid fallback must exist when `data-animations="disabled"`.
- No opaque body background should hide the canvas.
- No black/white flash during initial paint.
- Reduced-motion support remains correct.
- Ensure no new page-level overflow or regressions on create-quiz.

### Task 11 — Responsive & Accessibility Fixes
Ensure all modified areas (Markdown/LaTeX toolbar, toolbar dropdowns, menuBar, details card, description input, password controls, reference cards, action buttons) meet these standards:
- No horizontal page overflow.
- Comfortable touch targets for mobile.
- Visible focus states and logical tab order.
- Escape key and ARIA states function correctly.
- RTL text direction remains correct; LTR content (URLs/source values) aligns properly.
- Dialogs/modals manage focus properly.

### Task 12 — Canonical Schema/API Consistency
Standardize canonical structures for `description`, `password metadata`, `lesson-reference block`, and `quiz-reference block` across `lesson-schema.js`, `api/_validateLesson.js`, `api/admin.js`, `api/_catalog.js`, local storage models, Supabase schema/migrations, lesson reader, lesson editor, home/library components, and reference lookup logic. Do not introduce incompatible duplicate field structures. Preserve backward compatibility for old saved lesson data.

## Working approach for the new chat

Given the size of this remaining scope, work through the tasks in focused groups rather than one giant pass, verifying each group before moving to the next:
- Group A: Tasks 1–2 (shared dropdown state + positioning)
- Group B: Tasks 3–4 (menuBar parity + details card)
- Group C: Task 5 (font select)
- Group D: Tasks 6–7 (lesson reference resolution + reference cards)
- Group E: Task 8 (description end-to-end)
- Group F: Task 9 (password protection — security-sensitive, review carefully)
- Group G: Task 10 (theme/background)
- Group H: Tasks 11–12 (accessibility polish + schema consistency pass, done last since it spans everything above)

For each group, before writing code: locate every existing relevant file/function first (this codebase already has substantial working infrastructure — e.g. `lesson-access.js`, `lesson-schema.js`, `global-markdown-toolbar.js` — so most tasks are about *fixing/extending* existing systems, not building new ones from scratch). Then output complete, ready-to-paste updated files for that group only, plus any required Supabase migration, before moving to the next group.

### Output format for each group
1. **Implementation Summary** — brief, direct list of the exact technical fixes applied in that group.
2. **Database Changes** — any Supabase migration required (only if that group touches schema).
3. **Updated Files** — complete, modified code blocks, ready to paste directly into the project.
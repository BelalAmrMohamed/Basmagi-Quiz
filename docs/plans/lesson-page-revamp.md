# `/lesson/` Revamp — Implementation Plan

Ready for execution

Vanilla JS · Supabase · Vercel

## 1. Objective

Transform `/lesson/:id` from a basic lesson reader into a polished, interactive learning environment, while preserving the existing lesson format, authentication model, AI Agent, and global exam system.

The implementation will follow these decisions:

* Visual design: Modern learning dashboard, with elevated cards, refined typography, consistent spacing, and proper dark/light theme support.

* Student comments: A public community discussion with replies, reactions, sorting, and moderation.

* AI-generated quizzes: Temporary, interactive quizzes that exist only inside the current lesson session. They must never create records in `امتحاناتك`.

* File attachments: Supplementary files are available to the AI during the current conversation, without introducing permanent file storage.

* Existing functionality: Reuse the lesson renderer, progress tracking, reader preferences, text-to-speech, AI Agent, and existing comments API wherever possible.

## 2. Existing implementation and important findings

The supplied project already contains several pieces of the requested functionality. The implementation should extend them instead of creating parallel systems.

|
Existing file

|

Current responsibility

|
| --- | --- |
|

`public/src/features/lesson/lesson-view.js`

|

Lesson loading, rendering, preferences, AI integration, and page initialization

|
|

`public/src/features/lesson/lesson-blocks.js`

|

Rendering lesson content blocks and interactive questions

|
|

`public/src/features/lesson/lesson-schema.js`

|

Lesson normalization and local progress

|
|

`public/src/features/lesson/lesson-progress.js`

|

Lesson progress state

|
|

`public/src/features/lesson/lesson-progress-sync.js`

|

Progress synchronization

|
|

`public/src/features/lesson/lesson-toc.js`

|

Section navigation

|
|

`public/src/features/lesson/lesson-tts.js`

|

Browser-based speech synthesis

|
|

`public/src/features/lesson/lesson-reader-prefs.js`

|

Font, highlight, voice, and reading-speed preferences

|
|

`public/src/features/lesson/lesson-comments.js`

|

Existing student discussion submission and rendering

|
|

`public/src/features/lesson/lesson.css`

|

Lesson-specific styling

|
|

`public/src/components/ai-agent/ai-agent.js`

|

AI Agent initialization

|
|

`public/src/components/ai-agent/ai-agent-chat.js`

|

Chat interactions and tool calls

|
|

`public/src/components/ai-agent/ai-agent.css`

|

AI Agent styling

|
|

`public/src/components/ai-agent/ai-agent-default-prompts.js`

|

Agent system prompts

|
|

`public/src/components/ai-agent/ai-agent-suggested-prompts.js`

|

Suggested prompts

|
|

`api/college-quiz.js`

|

Existing lesson-comment API and other college-quiz functionality

|
|

`api/ai-agent/chat.js`

|

AI requests, tool handling, attachment validation, and provider integration

|

### Critical architectural decision

The current lesson AI tool handler in `lesson-view.js` calls `saveNewUserQuiz()`. That sends a lesson-generated quiz into the global exam system.

Replace this behavior with a lesson-local quiz renderer. Do not modify the global exam creation flow to accommodate this feature.

The current TTS implementation also needs an enhancement rather than a replacement: it already uses `window.speechSynthesis`, stores reading preferences, and creates section-level controls.

The existing comments feature is similarly a foundation, not a new feature to build from scratch. It already submits comments to `api/college-quiz.js` and displays approved entries.


## 3. Implementation order

Phase 1

Establish the lesson-page foundation

Layout, page state, theme tokens, and custom-lesson detection.

Phase 2

Build the ephemeral AI quiz experience

Tool handling, quiz rendering, grading, retries, and lesson context.

Phase 3

Upgrade the lesson reader

TTS controls, highlighting, reading preferences, and progress.

Phase 4

Build the community discussion

Replies, reactions, sorting, moderation, and responsive UI.

Phase 5

Unify lesson controls and AI actions

Lesson control modal, bookmarks, settings, and shortcuts.

Phase 6

Integration, regression testing, and polish

Verify existing functionality and validate the full experience.

# Phase 1 — Lesson dashboard and design system

## 1.1 Redesign the page layout

File: `public/src/features/lesson/lesson-view.js`

Restructure the markup produced by `paint()` into clear, semantic regions.

Recommended desktop layout:

Lesson header

Title · Breadcrumbs · Reading time · Progress

Lesson content

Sections, media, questions, reading controls

Contents

Section navigation and progress

Audio controls

Community discussion

Questions, replies, reactions, and helpful discussions

This is a layout direction, not a requirement to force every region into a permanent sidebar. On mobile, the contents panel should become a collapsible drawer or compact horizontal navigation.

Implementation details:

* Add a dedicated lesson overview/header region.

* Keep the lesson body as the primary content area.

* Place the table of contents in a sticky desktop sidebar where space permits.

* Give the AI Agent a persistent but unobtrusive entry point.

* Keep community discussions below the lesson content.

* Preserve the existing `lesson-view__info-btn` behavior, but integrate it into the new control system.

* Keep all content inside the existing `#contentArea` and retain the current standalone `/lesson/:id` bootstrap.

## 1.2 Modernize the visual styling

File: `public/src/features/lesson/lesson.css`

Introduce a consistent set of page-level CSS custom properties:

* Surface colors for the page, cards, elevated menus, and inputs.

* Primary and secondary text colors.

* Border and separator colors.

* Accent colors and focus-ring colors.

* Standard radii, spacing, and shadows.

* A shared transition duration.

Use the site's existing theme variables as the source of truth wherever available. Do not introduce a competing theme system.

Design requirements:

* Restrained glass effects for floating controls only.

* Solid, readable surfaces for lesson content.

* Clear heading hierarchy and comfortable line lengths.

* Consistent spacing between sections and blocks.

* Distinct hover, active, disabled, and focus-visible states.

* Reduced-motion support.

* Responsive layouts without horizontal overflow.

* RTL support for Arabic, including icons, controls, and directional navigation.

Avoid excessive shadows, gradients, and nested cards. The lesson itself should remain easy to read.

## 1.3 Correct preference and theme behavior

Files:

* `public/src/features/lesson/lesson-view.js`

* `public/src/features/lesson/lesson-reader-prefs.js`

* `public/src/features/lesson/lesson.css`

Separate reader preferences from site appearance settings.

Reader preferences should control:

* Font family.

* Reading speed.

* Text highlighting.

* Optional reading width or text size.

The site's existing theme controls dark/light appearance. All lesson surfaces must follow the active theme.

Acceptance criteria:

* Changing the highlight color updates the lesson immediately.

* Changing the font updates the lesson immediately.

* Theme changes affect menus, cards, forms, modals, and comments.

* Preferences persist according to the existing local-storage convention.

* Invalid or obsolete preference values safely fall back to defaults.

## 1.4 Establish a stable page state

File: `public/src/features/lesson/lesson-view.js`

The current `paint()` function replaces the lesson DOM. This is important because any new feature that stores DOM references or attaches listeners must account for rerenders.

Implement a small, explicit page state for:

* Active lesson section.

* Current reading mode.

* Active temporary AI quiz.

* Current comment sort and reply state.

* Modal and menu visibility.

Preserve the existing progress source of truth in `lesson-schema.js`. Do not duplicate progress state unnecessarily.

Acceptance criteria: Answering an embedded question or changing a setting must not unexpectedly reset the AI quiz, comment draft, or active reading state.

# Phase 2 — AI-generated quizzes inside the lesson

This is the most important functional change.

## 2.1 Replace the global exam creation handler

File: `public/src/features/lesson/lesson-view.js`

Modify `handleLessonAgentToolCall()`.

Current behavior:

1. Receives a `create_quiz` tool call.

2. Calls `saveNewUserQuiz()`.

3. Adds the result to the global exam system.

Required behavior:

1. Validate the generated questions.

2. Normalize the supported question types.

3. Create a temporary quiz state object.

4. Render the quiz inside the lesson page.

5. Return a concise confirmation to the AI Agent.

Remove the lesson-specific use of `saveNewUserQuiz()` and its associated success notification.

Do not remove or change the global exam creation functionality used elsewhere.

## 2.2 Define the temporary quiz schema

New file: `public/src/features/lesson/lesson-ai-quiz.js`

Use a normalized internal representation for every generated quiz.

Supported types:

|
Type

|

Interaction

|

Grading

|
| --- | --- | --- |
|

Multiple choice

|

Select one or more options as specified

|

Compare selected answers

|
|

True/false

|

Select True or False

|

Compare against the correct value

|
|

Fill in the blank

|

Enter a missing word or phrase

|

Normalized exact match, with explicitly defined accepted answers

|
|

Short answer

|

Enter a short response

|

Compare against accepted answers or a reference answer using a clearly disclosed grading method

|

Each question should support:

* A stable question ID.

* Question text.

* Type.

* Options when applicable.

* Correct answer or accepted answers.

* Optional explanation.

* Optional points.

Validate the generated data before rendering it. Reject malformed questions instead of attempting to execute or interpret arbitrary generated HTML.

### Grading rules

* Multiple-choice and true/false questions receive immediate deterministic grading.

* Fill-in-the-blank grading should normalize whitespace and case where appropriate.

* Short answers should use accepted answers where supplied.

* For open-ended answers, show a reference answer and explanatory feedback rather than claiming that a simple string comparison understands semantic correctness.

* Never expose correct answers before submission unless the user explicitly chooses to reveal them.

## 2.3 Render the quiz in the lesson

New file: `public/src/features/lesson/lesson-ai-quiz.css`

Integration file: `public/src/features/lesson/lesson-view.js`

Render the quiz in a dedicated in-page container. A generated quiz should include:

* Quiz title and question count.

* Progress indicator.

* Question navigation.

* Answer controls.

* Submit/check-answer action.

* Immediate feedback.

* Final score or completion summary.

* Retry/reset button.

* Dismiss action.

The quiz should be visually consistent with the rest of the lesson, but clearly distinguishable from authored lesson questions.

### Ephemeral lifecycle

The quiz must not:

* Create a row in the `quizzes` table.

* Add an item to `user_quizzes`.

* Call `saveNewUserQuiz()`.

* Appear in the global exam listing.

* Affect global exam scores, rankings, or user levels.

Keep its state in memory for the current page session. Resetting the page may discard the quiz.

## 2.4 Add quiz actions to the lesson AI menu

Files:

* `public/src/features/lesson/lesson-view.js`

* `public/src/components/ai-agent/ai-agent-actions.js`

* `public/src/components/ai-agent/ai-agent-default-prompts.js`

* `public/src/components/ai-agent/ai-agent-suggested-prompts.js`

Add lesson-specific actions such as:

* Generate a quiz from this lesson.

* Generate questions from the current section.

* Explain a difficult concept.

* Give me a hint.

* Summarize this section.

* Ask me one question at a time.

The existing action menu should be context-aware. The home page's `إنشاء امتحان` action must remain distinct from the lesson page's temporary quiz action.

Use the existing slash-command menu infrastructure rather than implementing a second command system.

## 2.5 Improve lesson context sent to the AI

File: `public/src/features/lesson/lesson-view.js`

Extend `lessonAgentContext()` so it provides all available, relevant lesson information:

* Lesson title and metadata.

* Section titles and ordering.

* Complete text content.

* Relevant structured block data.

* Existing question prompts and explanations.

* Captions and transcripts when present in the lesson data.

* The current section and relevant surrounding content.

* Whether the lesson is user-created.

Do not send only the current section when the user asks about the entire lesson.

For long lessons, use a deliberate context strategy: include the current section and relevant lesson structure, and retrieve additional sections when needed. Avoid silently truncating the context.

Acceptance criteria:

* The AI can answer questions about different sections.

* Quiz generation uses the lesson content rather than generic knowledge alone.

* The AI does not invent transcripts for media that has no transcript.

* User-created lessons work without requiring a Supabase lesson record.

## 2.6 Preserve conversation and quiz state

The AI Agent may regenerate its interface or re-render the lesson. Keep the quiz's state separate from the DOM.

If the user generates another quiz, define the behavior explicitly: replace the current quiz only after confirmation, or offer a way to keep the current quiz and generate another. Do not silently discard an in-progress attempt.

# Phase 3 — Reader controls, TTS, and progress

## 3.1 Upgrade text-to-speech

File: `public/src/features/lesson/lesson-tts.js`

Extend the existing speech implementation with a persistent reader toolbar.

Required controls:

* Play.

* Pause.

* Resume.

* Stop.

* Reading speed from 0.75× to 2×.

* Voice selection when supported by the browser.

Use the existing `getReaderPrefs()` and `setReaderPrefs()` functions.

The toolbar should reflect the actual speech state. Disable unavailable actions and handle browsers that do not support speech synthesis.

## 3.2 Highlight the active paragraph

Files:

* `public/src/features/lesson/lesson-tts.js`

* `public/src/features/lesson/lesson-blocks.js`

* `public/src/features/lesson/lesson.css`

The existing implementation extracts all text from a section into a single utterance. This does not provide reliable paragraph-level highlighting.

Change the reader to process readable text blocks individually.

Implementation approach:

1. Identify speakable paragraphs and text blocks.

2. Exclude buttons, navigation, embedded quiz controls, and decorative elements.

3. Create a speech utterance for each block.

4. Highlight the currently spoken block.

5. Optionally scroll the active block into view.

6. Continue to the next block when speech ends.

7. Clear highlighting when stopped or when an error occurs.

Use a dedicated CSS class for the active reading block. Do not modify the original lesson text or inject speech-specific markup into stored lesson content.

## 3.3 Add reading modes

Files:

* `public/src/features/lesson/lesson-view.js`

* `public/src/features/lesson/lesson-reader-prefs.js`

* `public/src/features/lesson/lesson.css`

Add:

* Focus mode: hide secondary navigation and nonessential controls.

* Comfortable reading width.

* Optional larger text.

* Reading progress display.

* A quick action to return to the last visited section.

Use the existing local progress mechanism and avoid introducing a second progress database.

## 3.4 Fix embedded question reset

File: `public/src/features/lesson/lesson-blocks.js`

Inspect how question answers, grading, and locked states are currently represented.

Add a reset action that restores the question to its initial state:

* Clear the selected answer.

* Clear feedback and score display.

* Remove locked/graded state.

* Restore the original button labels and disabled states.

* Preserve unrelated lesson progress.

Ensure that the reset action does not trigger a full page rerender unless the existing component architecture requires it.

Acceptance criteria: A user can retry a graded question without refreshing the page, and the question behaves exactly as it did before the first attempt.

# Phase 4 — Community discussion

The comments section should become a meaningful community feature, not merely a form for submitting questions.

## 4.1 Define the discussion experience

Files:

* `public/src/features/lesson/lesson-comments.js`

* `public/src/features/lesson/lesson.css`

Rename the user-facing section from `أسئلة الطلاب` to a more inclusive title such as `مجتمع الدرس` or `النقاش`.

Recommended layout:

## مجتمع الدرس

شارك فكرة أو اسأل أو ناقش نقطة في الدرس.

اكتب تعليقك

شارك سؤالاً أو ملاحظة أو شرحاً مفيداً لزملائك.

Markdown

معاينة

الأحدث

الأكثر تفاعلاً

الأكثر فائدة

Student

منذ فترة قصيرة

شرح إضافي أو سؤال مرتبط بمحتوى الدرس.

إعجاب

رد

This is a design specification; all displayed counts, actions, and data must come from actual application state.

## 4.2 Add community interactions

Implement the following features in stages:

1. Replies: Allow users to respond to a comment, with a reasonable nesting limit.

2. Reactions: Support a simple like/helpful reaction.

3. Sorting: Newest, most reacted-to, and most discussed.

4. Editing and deletion: Allow users to manage their own contributions, subject to the site's authorization rules.

5. Reporting: Provide a report action for inappropriate content.

6. Pagination: Load discussions in manageable batches.

7. Permalinks: Allow a specific comment to be linked or referenced.

8. Comment drafts: Preserve an unsent draft locally during navigation or accidental UI closure, where appropriate.

Do not build all of these as client-only visual controls. Each action must have a corresponding validated persistence and authorization path.

## 4.3 Inspect and extend the existing database

Files:

* `api/college-quiz.js`

* `docs/Database-Schema-Context.md`

* A new SQL migration file under the project's established migration convention, if one exists.

The current API already reads and submits records in `lesson_comments`. Before implementing replies and reactions, inspect the actual table definition, indexes, row-level security policies, and existing moderation workflow.

Extend the existing schema rather than creating a parallel discussion system.

Potential schema additions, subject to the existing database design:

* A nullable `parent_id` for replies.

* A reaction table with a unique constraint on user and comment.

* A report table with reporter, reason, status, and timestamps.

* Author identity fields if the existing schema does not already provide them.

Do not assume that the displayed name `Student` is sufficient for author authorization. Editing and deleting must be enforced using a verified identity, not a client-supplied author ID.

## 4.4 Secure the comment API

File: `api/college-quiz.js`

The existing endpoint handles lesson-comment listing, submission, and moderation. Extend its current routing conventions.

Required protections:

* Validate lesson and comment IDs.

* Validate body length and content.

* Authenticate write operations where required by the site's current account model.

* Enforce author ownership server-side.

* Rate-limit submissions and reports.

* Prevent unauthorized moderation.

* Escape or safely render user-generated content.

* Validate reply parent IDs and ensure they belong to the same lesson.

* Prevent duplicate reactions.

* Return consistent errors and loading states.

The existing submission flow uses a moderation status. Preserve that workflow unless the product's moderation policy is deliberately changed.

## 4.5 Improve the discussion UX

Add:

* Optimistic UI only where rollback is reliable.

* Skeleton loading states.

* Clear empty states.

* Inline error recovery.

* Character count.

* Reply composer with cancel action.

* Accessible reaction buttons.

* Confirmation for destructive actions.

* Mobile-friendly comment cards.

Acceptance criteria: Community interactions work across refreshes and devices, unauthorized actions are rejected by the server, and existing moderation remains functional.

# Phase 5 — Lesson controls and deeper AI integration

## 5.1 Revamp the lesson information modal

Files:

* `public/src/features/lesson/lesson-view.js`

* `public/src/features/home/lesson-info-modal.js`

* `public/src/features/lesson/lesson.css`

Reuse the existing modal rather than introducing a separate modal framework.

Organize it into clear sections:

* Lesson information.

* Reading preferences.

* Bookmarks.

* Progress.

* Reading mode.

* AI study actions.

Keep the modal focused. Frequently used controls should remain available directly on the page.

## 5.2 Add bookmarks

New file: `public/src/features/lesson/lesson-bookmarks.js`

Allow users to bookmark:

* The current section.

* A specific content block when it can be identified reliably.

Store bookmarks locally using the existing storage helper conventions.

Each bookmark should include the lesson ID, section or block identifier, and creation time.

Provide:

* Add/remove bookmark.

* A list of bookmarks in the lesson controls.

* Jump to bookmarked content.

* A useful empty state.

Bookmarks must work for both database-backed and user-created lessons.

## 5.3 Improve lesson progress controls

Files:

* `public/src/features/lesson/lesson-progress.js`

* `public/src/features/lesson/lesson-progress-sync.js`

* `public/src/features/lesson/lesson-view.js`

Expose the existing progress in a useful visual summary:

* Sections visited.

* Current section.

* Overall completion.

* Resume reading.

* Mark a section as completed, if compatible with the existing progress model.

Do not equate simply opening a lesson with completing it.

Ensure adaptive or conditionally revealed sections are handled consistently.

## 5.4 Expand lesson-specific AI actions

Files:

* `public/src/components/ai-agent/ai-agent-actions.js`

* `public/src/components/ai-agent/ai-agent-default-prompts.js`

* `public/src/components/ai-agent/ai-agent-suggested-prompts.js`

* `public/src/features/lesson/lesson-view.js`

Add contextual actions for:

* Explaining selected text.

* Simplifying a difficult paragraph.

* Generating flashcards in the current session.

* Creating a temporary quiz from the current section.

* Summarizing the full lesson.

* Explaining why an answer is incorrect.

* Generating practice questions for a weak topic.

For selected-text actions, capture the selected text before opening the AI interface. Do not let opening a modal or clicking the AI button destroy the selection before it is read.

Every AI action should clearly distinguish lesson content from user-provided instructions.

## 5.5 File upload integration

Files:

* `public/src/components/ai-agent/ai-agent-attach-launcher.js`

* `public/src/components/ai-agent/ai-agent-chat.js`

* `public/src/components/ai-agent/ai-agent.css`

* `api/ai-agent/chat.js`

The AI Agent already supports attachments, with server-side validation and provider-specific handling. Reuse that pipeline.

Required behavior:

* Allow supplementary PDFs, images, and supported text documents.

* Display the selected filename and attachment status.

* Allow removing an attachment before sending.

* Show upload/processing errors clearly.

* Preserve the attachment's relationship to the message in the current conversation.

* Do not upload files to permanent storage merely to make them available to the model.

The existing API has a one-attachment-per-message limit and a 4 MB decoded-size limit. Preserve these limits initially unless testing justifies a deliberate change.

Verify actual provider support and extraction behavior for each accepted MIME type. Do not advertise a file type that the active provider cannot process.

Acceptance criteria: A user can attach a supported file, ask a question about it alongside the lesson, and continue the conversation without the file becoming a permanent lesson asset.

# Phase 6 — Integration and regression testing

## 6.1 Required test matrix

|
Area

|

Test

|

Expected result

|
| --- | --- | --- |
|

Lesson loading

|

Open a valid lesson

|

Content and metadata render

|
|

Lesson loading

|

Open an invalid lesson ID

|

Friendly error state

|
|

Custom lessons

|

Open a user-created lesson

|

No student discussion section

|
|

AI context

|

Ask about a specific section

|

Answer uses that section's content

|
|

AI quiz

|

Generate a quiz

|

Quiz renders inside the lesson

|
|

AI quiz

|

Finish and retry

|

Answers and grading reset

|
|

AI quiz

|

Inspect global exams

|

No generated lesson quiz appears

|
|

AI quiz

|

Generate a second quiz

|

Existing attempt is not silently lost

|
|

TTS

|

Play, pause, resume, stop

|

Controls reflect speech state

|
|

TTS

|

Change reading speed

|

New speech uses selected speed

|
|

TTS

|

Read multiple paragraphs

|

Active paragraph is highlighted

|
|

Reader preferences

|

Change font/highlight

|

Immediate visual update

|
|

Theme

|

Switch dark/light mode

|

All lesson components adapt

|
|

Questions

|

Grade and reset

|

Question becomes answerable again

|
|

Comments

|

Submit a comment

|

Existing moderation rules apply

|
|

Comments

|

Reply and react

|

Changes persist correctly

|
|

Comments

|

Attempt unauthorized edit

|

Server rejects the action

|
|

Bookmarks

|

Add and revisit bookmark

|

Correct section opens

|
|

Progress

|

Leave and return

|

Existing progress is preserved

|
|

Attachments

|

Upload supported PDF/image/text

|

AI receives supported content

|
|

Responsive

|

Use a narrow mobile viewport

|

No clipping or horizontal overflow

|
|

Accessibility

|

Keyboard-only navigation

|

All controls are reachable

|
|

Accessibility

|

Reduced-motion preference

|

Unnecessary animation is disabled

|

## 6.2 Browser testing

Test using the project's existing development workflow:

Bash

```
npm run dev
```

Use the local Vercel development server so that API routes, Supabase interactions, and the AI Agent work in the same environment.

Test at minimum:

* Desktop, light theme.

* Desktop, dark theme.

* Mobile viewport.

* A database-backed lesson.

* A user-created lesson.

* A lesson with embedded questions.

* A lesson containing media or structured blocks.

* An unauthenticated session and an authenticated session, where supported.

## 6.3 Regression checks

Before considering the work complete:

* Verify the home-page `إنشاء درس` action still works.

* Verify the slash menu remains accessible.

* Verify the AI Agent's More button remains available on `/lesson`.

* Verify global exam creation is unchanged.

* Verify existing quiz pages still work.

* Verify lesson comments remain compatible with the moderation interface.

* Verify existing reader preferences are not discarded.

* Verify progress tracking still uses the established storage format.

* Verify all relevant API routes preserve their existing behavior.

# 4. File-by-file execution checklist

The following is the recommended implementation sequence for the coding agent.

### Execution tracker

0/26

### Phase 1 — Foundation

Inspect

Read lesson.css, lesson-view.js, the global theme tokens, and the current modal styles.

Layout

Refactor lesson-view.js into dashboard regions without changing data loading.

Theme

Update lesson.css and reader preference application to use theme-aware variables.

State

Make rerender behavior explicit and preserve active feature state.

### Phase 2 — AI quizzes

Quiz module

Create lesson-ai-quiz.js and lesson-ai-quiz.css.

Tool handler

Replace saveNewUserQuiz() in lesson-view.js with temporary quiz creation.

Question types

Implement validation, rendering, grading, feedback, retry, and dismissal.

AI context

Expand lessonAgentContext() and ensure context is not silently truncated.

AI actions

Add lesson-specific slash and action-menu entries.

### Phase 3 — Reader

TTS

Extend lesson-tts.js with play, pause, resume, stop, and rate controls.

Highlighting

Coordinate paragraph-level speech with lesson-blocks.js.

Preferences

Add reading width, text size, and focus mode.

Question reset

Implement reset behavior in lesson-blocks.js.

### Phase 4 — Community

Schema

Inspect lesson_comments, policies, and moderation before changing the schema.

API

Extend api/college-quiz.js with authorized replies, reactions, edits, and reports.

UI

Upgrade lesson-comments.js and lesson.css.

Validation

Test moderation, authorization, pagination, and persistence.

### Phase 5 — Controls

Modal

Extend lesson-info-modal.js with organized lesson controls.

Bookmarks

Create lesson-bookmarks.js and integrate it with the reader.

Progress

Expose the existing progress model in the dashboard.

Attachments

Verify and extend the existing AI Agent attachment pipeline.

Contextual AI

Add selection-aware and section-aware study actions.

### Phase 6 — Verification

Functional tests

Run the complete test matrix above.

Visual tests

Check desktop, mobile, dark mode, and light mode.

Regression

Verify global exams, home-page actions, and existing lesson behavior.

Final review

Inspect errors, accessibility, security, and unintended persistence.

# 5. Definition of done

The revamp is complete only when all of the following are true:

1. The lesson page has a coherent, responsive dashboard design.

2. Dark and light themes work across every lesson component.

3. AI-generated quizzes are fully interactive and remain independent of `امتحاناتك`.

4. Lesson context includes all relevant content available to the application.

5. The reader supports speech controls, adjustable speed, and active-paragraph highlighting.

6. Existing embedded questions can be reset without refreshing the page.

7. The community discussion supports the agreed interactions with proper server-side authorization.

8. Lesson bookmarks, progress, and preferences work for both standard and user-created lessons.

9. The lesson control modal provides convenient access to the relevant settings.

10. File attachments work through the existing AI pipeline without unintended permanent storage.

11. The existing home page, global exam system, and other quiz pages continue to work.

## Final implementation guidance

Execute the phases in order. The highest-risk changes are the temporary quiz lifecycle, the comment database/API extensions, and paragraph-level speech highlighting. Complete and test those independently before integrating the full dashboard.

Do not start by rewriting the entire lesson page. First preserve the existing data and rendering contracts, then introduce the new components around them. This minimizes regressions and keeps the work compatible with the current project architecture.

For the community section, inspect the actual database policies before writing migrations. For the AI quiz, remove the global persistence path before adding new quiz interactions. Those two constraints are essential to meeting the requested behavior.

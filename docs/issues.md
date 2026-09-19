# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### امتحاناتك
- Sometimes makes duplicates of the same item when editing.
- Select mode: Pressing on a folder/course correctly selects it, but pressing on a quiz/lesson doesn't select it, I have to press on the `.user-quiz-select-checkbox` itself to select the quiz. Fix: Pressing the quiz/lesson card should select it.

### Performance (Globally, but specially the main page)
Performance Improvements: Currently, there are many custom mechanism fucntionalities built in JS that works perfectly, but it may exist natively in HTML, CSS, or as a browser API. In that case we shouldn't reinvent the wheel, specially if it exists natively. Anything that exists natively in HTML, CSS, or as a browser API should be used that way and we should delete any custom JS implementation that has native alternatives. That would improve performance very well. Search for everything, anything that can be implemented in HTML & CSS directly without JS should be done so. You can search the web for modern HTML & CSS, because sometimes they add new things, but watch out for compatibility with different browsers (minimum requirenment: Chrome). But I don't want to miss up any functionality, this is just for performance, not to change any fucntionality.

Example: I lately found out that the `/quiz` page was rendering questions through the JS once, then when the user submits their answer, the JS renders the question again to add the explanation & formal answer, I removed it and depended fully on CSS & HTML, the whole question including explanation & formal answer is inserted at the first render, then I make things visible when the user submits the answer using CSS classes. That approach to get away from JS improved performance alot.  

## New Features

### Lessons Page
Last session partially implemented phase 3: `docs\docs\plans\lessons-feature-plan.md`. But since it was big, it still needs work.
- The `#menuBar` doesn't have any of the dropdowns from create-quiz, which means create-lesson is missing alot of tools.
- Inside the user workspace, lessons should be a different type than quizzes (not the same type, but a forth type). So they should be styled differently, The download button on them should appear dispabled for now (because lessons will get their export features later). You can choose to give lessons an emoji or not. And the start button should redirect to `/lesson/` not `/quiz/`.
- The create-quiz and create-lesson render math by themsleves, but the MD Engine (markdown.js) might also be rendering math, check the engine, if it's rendering math, then the pages shouldn't render again.
- Drafts from the create-quiz and create-lesson shouldn't be saved until the draft is saved as a quiz/lesson
- The `#gmdHighlightToggle` was designed in the UI extremely poorly, it has lables on the colors, and it doesn't have a custom color picker. Redesign the whole dropdown, it should be how color dropdowns usually look like in advanced professional appas like canva.com or Google Docs.

Things that also should be done to continue the 3rd phase:
1. Fix the stale "admin-only" comments, and mount #lessonCreatorForm as display:flex. I haven't edited the file yet.
2. **`create-lesson.css`:** add `.gmd-select`, `.lesson-preview-overlay` and its panel classes, `body.lesson-preview-open`, and `.lesson-question-type-actions`. Also remove or repurpose the old `.lesson-metadata` and `.entry-not-admin-message` rules.
3. **Workspace wiring (biggest remaining gap):** `user-quizzes-view.js` and `user-quiz-card.js` have zero lesson handling, and the viewer only reads the Supabase `lessons` table. So a saved local lesson won't display or open from امتحاناتك yet. It needs three things:
   - a lesson card that renders instead of the quiz card;
   - an open action that mirrors `playUserQuiz` (`sessionStorage` plus `?type=user`);
   - a local-source path in `lesson-view.js`'s `fetchLesson`.

   Also check `user-quizzes-trash.js` and `move-to-dialog.js`, since they treat non-folder rows as quizzes.
4. **Cleanup:** the old admin `create-lesson`, `update-lesson` and `delete-lesson` actions in `api/admin.js` are now unused by this page. They're harmless, and I'd keep them until lesson publishing is decided.
5. Then start on the workspace wiring.


### Result Pages

#### Videos (Easy to make, but very important)
- Add a result-page feature that displays themed meme videos based on the user’s degree or score.
- Suggested themes include:
  - دعوية
  - إسلامية
  - قرآن
  - ميمز تشجيع سلبية
  - ميمز تشجيع إيجابية
- Some vidoes will be displayed based on the percentage of the result.

#### Score Guage
- The result page displays the score increase, but doesn't display the updated score. Bring the `#identityLevel` from the profile page to the result page.

### `public/src/shared/markdown.js`
- Resize Handle Issues:
  - Images don't get the resize handles, and they appear aligned to the left or right instead of the middle. ![screenshot](image-2.png).
  *Tested on localhost*

- `docs\plans\md-engine-prompt.md`


### Home Page

#### Info Modals
- Quizzes, Folders, and Courses store so much info (Check their tables in [DB Context](Database-Schema-Context.md)):
  - Extend the info in the quiz info modal `quiz-info-dialog` (don't show the password ofcourse, but you can show an indication like (privacy: has password) or a similar label)
  - Extend the info in the course info modal, too.
  - Make an info modal for Folders.
  - (Suggestion) Add: Number of Views or people who solved a quiz on each quiz.

### `public\control.html` Page
- Give `#collegeForm` an advanced loading skeleton/animation like the others.

### `public\about.html` Page
- Suggestion: Add an open-source Angle.
- Suggestion: Add a short testimonial or review.
`المنصة بالأرقام` should have the number of views (maybe try to integraet vercel insights or even something custom).

### Create Quiz Page
- `create-quiz.js` is 5000+ lines in one file — This is a good candidate to split into modules.

### Dynamic AI Agent Allowance (الباشــمبصمج)
Currently the AI Agent is open for all admins and for users who have level 10 or more. But I want to make that dynamic. 2 phases.

#### Control Page
Allow the owner to change the level where users can use the (الباشــمبصمج), so if there is not that much usage, I can manually make the required level 1 or 2, and if there is so much usage I can make it 10 or more.

#### Monitor Usage
I want an Idea to implement usage monitoring so I can monitor the uasge of the API Keys (specially of the free Google API Keys I got from Google AI Studio, they are the only ones that actually exist, and they are 2 free-tier api keys), so monitoring usage is actually important.

I'm thinking of implementing it in about.html how-to-use-ai-agen.html or in another page. I want ideas.

### Connect Canva
Think of a new way to download quizzes, maybe throug canva.

### Download as Python
Think about this suggestion, a new way to download quizzes.

### Translation and content expansion (Suggestion)
- Add English translation support.

### Offline Page
- Should match the theme mode stored in localStorage.

### `api\og.js`
- Special courses that get the (مادة مميزة) badge, since there is no info table displayed, the middle of the image becomes emtpy, I need to fill it with something, or make the content bigger.
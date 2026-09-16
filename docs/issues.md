# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Quiz Page
- On `vertical` mode, the `#menuNavContainer` doesn't go through the questions when the user scrolls through the page, so if the user scrolls from question 1 -> 4, the `#menuNavContainer` doesn't update.
- The page's loading skeleton animation isn't properly excluded from the "الاداء الفائق" `[data-motion="reduced"]` like the other pages are. See `public\src\styles\themes.css` for proper exclusion.

### امتحاناتك Rules
- See `docs\plans\amtihanatak-naming-rule-audit.md` and `docs\plans\naming-rule-audit-handoff-prompt.md`
- See `docs\plans\content-rules.md`

### `.create-quiz-inline-modal`
- Fix the `.copyAiPromptBtn` with its arrow in the `.create-quiz-inline-modal`, the arrow's animation is broken on "الأداء الفائق" mode (data-motion="reduced"), and the button is too wide.

### `.sidebar-brand-link`
- Put a better transition on it. Because when opening/closing the `#sidebar`, it appears instantly while the `#sidebar` has a nice transition/animation.

## New Features

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
- Users should be able to resize media with the resize handles. I don't know why the fucking AI removed them. Implement it in the markdown engine itself so it works on the `/result`, `/create-quiz`, and `/quiz`.
  - Media appears with size that is already in the objects like `<img>`, it appears with handles that the user can use to resize the media himself.
  - Images / videos get 4 resize handles, one on each corner.
  - Audio get 2 handles, one on the right, other on the left, since its height doesn't change.

### Home Page

#### Animations
These animations should be excluded from the "الأداء الفائق" (`html[data-motion="reduced"]`) mode, meaning they should work even when the mode is on, these are features that shouldn't be dispabled when that mode is on when `data-motion` is set to "reduced":
- The hover state of the icons on the `#sidebar`; `.menu-item`. In the `quiz.html` page, and on the rest of the platform.
- The loading shimmer/skeleton on all pages, including these (control.html, index.html, create-quiz.html, profile.html, quiz.html, and any other page that has a loading skeleton).
- The profile page's icons; `.section-icon`.

#### Info
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
- Performance: create-quiz.js is 5000+ lines in one file — This is a good candidate to split into modules.
- Add a button for converting all MCQ questions that have 1 correct option only that are set to checkboxes (multi correct options) to radio buttons (one correct options). This will save users from editing quizzes that have that issue, instead of going through each question one-by-one, opening the more menu, pressing the button that changes that, this new button will save so much time.
- The background animations doesn't work on the page, `themes.css` updated variabled used by elements to give them a bit of opacity, so the bg animations can appear through them, the create-quiz page might not be using them. 

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
# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Courses & Folders OG Images
- Right Column of the info table aren't all on the same x access, some are slightly to the left, others to the right slightly.
- (On Folders OG Images) When the course name is Arabic (like "اللغة العربية"), it gets reversed (e.g., "العربية اللغة")

### امتحاناتك Rules
Check the rules for creating امتحانات and copying them and moving them.
**No 2 elements of the same type and the same name should exist at the same course/folder (or root امتحاناتك)**
- The `نسخ لامتحاناتي` button doesn't show the animations when copying courses and folders, clicking it quits the menu instantly, then after a while, the course/folder gets copied. Between my press to the button the first time, and the course/folder being actually copied, I got confused, so I opened the menu again and pressed the `نسخ لامتحاناتي` button again, after the lag/loading time finished, the course/folder was copied many times.
- Fix the `.copyAiPromptBtn` with its arrow in the `.create-quiz-inline-modal`, the arrow's animation is broken on "الأداء الفائق" mode (data-motion="reduced"), and the button is too wide.

### Menus in امتحاناتك
- Pressing the more button on a quiz, the dropdown shows, then pressing another more button on anohter quiz, the first one closes, the second shows (Correct Behavior).
- Right cliking a quiz shows the right-click menu "#userQuizContextMenu", then pressing the more button, opens `.exam-dropdown-menu` on top of the right-click menu (Incorrect Behavior): Only one menu should be open.

### `.sidebar-brand-link`
But a transition on the `.sidebar-brand-link` for opening/closing side-menu on desktops, because the `.sidebar-brand-link` appears instantly while the side-menu on desktops has a transition.

### Google Sign in on localhost.
- Signing in doesn't work on localhost for somereason. ![alt text](image-6.png) See [last solution attempt with AI](unsolved-localhost-sign-in-issue--maybe-related-to-AOth-console-config-or-DB-config.md)
- See ![screenshot of browser console errors](image.png)

### Create Quiz Page
- While I was testing, I found these errors in the console:
```
create-quiz.html:1947  GET http://localhost:8080/_vercel/insights/script.js net::ERR_ABORTED 404 (Not Found)
create-quiz.html:1350 Uncaught ReferenceError: chooseEntryAction is not defined
    at HTMLButtonElement.onclick (create-quiz.html:1350:120)
onclick @ create-quiz.html:1350
```

## New Features

### Admin actions and deletion flow (New Features)
See [Implementation Plan](<plans/Admin actions and deletion flow for quizzes.md>)

### Markdown engine enhancement
- Update the markdown engine to behave more like GitHub markdown rendering, with embeded media like vidoes, audio, and images.
- It should be implemented after implementing media inside the quiz body in the `quiz.html` page.
  - Because for some reason, the quiz page rerenders each time the user interacts with the quiz (presses a button), which reloads every videos, images, and audio. that's why media is currently out of the quiz body. We should fix that issue first, before migrating the media to be rendered through the markdown engine.
  - The `export-to-quiz.js` feature renders media inside the question body, and doesn't rerender the question after each interaction, so you can learn from it.
- After implementing this feature, migrate all quizzes to embed the media in the question body itself, and delete all legacy code related to the object media rendering, because now media will be in the question body itself.
- This will allow quiz creators to add multiple pieces of media to each question or add media to options, explanations, and formal answers.
- Now all quizzes created from the home page (index.html), create-quiz.html, or through the AI Agent, should use YouTube, images, audio, and vidoes using this way only. Users shouldn't be able to create Legacy YouTube, audio, images, and videos objects. 

### Meme videos on result pages (Easy to make, but very important)
- Add a result-page feature that displays themed meme videos based on the user’s degree or score.
- Suggested themes include:
  - دعوية
  - إسلامية
  - قرآن
  - ميمز تشجيع سلبية
  - ميمز تشجيع إيجابية

### Quiz Page
- Advanced Loading skeletong on the quiz.html page that works also when the `الاداء الفائق` mode is on.

### App SEO and GEO 
- Improve the SEO and GEO of the platform, take them to the next level, the objective is that whenever a new quiz, folder, or course get added to the platform, Google knows about it, just like when a new YouTube video dropds Google knows about it. AI and search engines should know about the whole platform.

### Settings Page
- The page shows false/placeholder values at start, which confuses some users. Implement a loading skeleton/state before displaying any info.
- The carrot on the dropdowns is too close to the left border, fix the padding/margin or whatever is wrong.

### Translation and content expansion (Suggestion)
- Add English translation support.

### Home Page

#### Onboarding Pop Up `.landing-card`
Make it a full screen, instead of a modal. Not a different page, but takes full width/height, no rounded corners.

#### Improvements
- The side menu admin badge and favicon size should be improved visually.
- Quizzes, Folders, and Courses store so much info (Check their tables in [DB Context](Database-Schema-Context.md)):
  - Extend the info in the quiz info modal `quiz-info-dialog` (don't show the password ofcourse, but you can show an indication like (privacy: has password) or a similar label)
  - Extend the info in the course info modal, too.
  - Make an info modal for Folders.
  - Add: Number of Views or people who solved a quiz on each quiz. (Suggestion)
  - Allow users to switch view on the quiz page (Between Pagination and Vertical), when there is not a compulsory view.

#### Password
Connect Password typing memory on the main page to the quiz page: When there is a quiz with a password, and the user downloads the quiz, he has to enter the password once, and they can download the quiz many times, because it's remembered that they know that password. The objective is to connect that to the quiz page, so when the user enters the password to download the quiz, then takes it in the quiz page, he shouldn't be asked for it again. 

### URLs
- Remove `.html` from the end of each page link. so `/result.html` becomes `/result`, and `/onboarding.html` becomes `/onboarding`, and so on. Also Update any redirects to redirect to these updated links.

### Testing Issue
`npm run dev` doesn't do hot reload.

### Control.html
`#collegeForm` doesn't have a loading skeleton/animation.

### About.html
- Open-source Angle
- Add a short testimonial or review

### Create Quiz Page
- Performance: create-quiz.js is 5000+ lines in one file — This is a good candidate to split into modules

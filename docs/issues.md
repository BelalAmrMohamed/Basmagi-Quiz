# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Lesson Page (`public\lesson.html`, `public\lesson-comments.html`, & `public\src\features\lesson\`)
Issues:
* Fix: The `.lesson-selection-popup` buttons (e.g., "اشرحها" and "بسّطها") don't work when I select a text then press them, they don't do anything at all.
* Fix: The loading skeleton doesn't appear at the start of the page, it appears after a long while for a moment right before the content loads, as if it flashes.
* New: Add `اقرأها` in the `.lesson-selection-popup` so the options become: 
  * اشرحها
  * بسّطها
  * اقرأها
* New: Redesign the `lesson-view__header`


### Create-lesson Page
* Fix: Changing the value of `#lessonFontSelect` doesn't change anything, fix it or remove it.
* Fix (On the create-lesson and create-quiz):
  * The `gmd-btn gmd-btn-latex gmd-dropdown-toggle` toggle when it opens, it messes up the `global-md-bar`. 
  * The 2 `gmd-btn gmd-dropdown-toggle` toggles doesn't even work at all, pressing it does nothing.
* Fix: Background animations (animations.css) are broken on the create-lesson page, probably because it doesn't use the variables in `themes.css` like how the create-quiz does. The variables in `themes.css` get upadted when the animations are on to be slightly opace.

New: 
* Add a new `+ درس مرتبط` feature so users can embed other lessons just like how they embed quizzes `+ امتحان مرتبط`.
* Redesing how the embedded quizzes/lessons display `+ امتحان مرتبط`, instead of just a start button, it should be full featured: 
  * Start button: Already exists.
  * Download button: To download the quiz/lesson (similar to the home page).
  * Info button: To show the info of the quiz/lesson (similar to the home page)
  * Ask AI (اسأل الباشـمبصمج): To ask AI about that quiz/lesson (similar to the home page).
* Add password and description fields just like `create-quiz` does, and update the lesson page accordingly.


### Global Issue
This issue appears on almost all pages, it's related to this script: `<script defer src="/_vercel/insights/script.js"></script>`
```
script.js:1  Failed to load resource: the server responded with a status of 404 (Not Found)
```
That issue is local only, if it's not harmful, then no problem.

The issue doesn't affect production.

### AI Agent
Fix Dictation: The dictation feature is so messed up, it doesn't work on Brave browser, even though other websites I built worked fine on Brave Browser.

### Performance (Globally, but specially the main page)
Performance Improvements: Currently, there are many custom mechanism fucntionalities built in JS that works perfectly, but it may exist natively in HTML, CSS, or as a browser API. In that case we shouldn't reinvent the wheel, specially if it exists natively. Anything that exists natively in HTML, CSS, or as a browser API should be used that way and we should delete any custom JS implementation that has native alternatives. That would improve performance very well. Search for everything, anything that can be implemented in HTML & CSS directly without JS should be done so. You can search the web for modern HTML & CSS, because sometimes they add new things, but watch out for compatibility with different browsers (minimum requirenment: Chrome). But I don't want to miss up any functionality, this is just for performance, not to change any fucntionality.

Example: I lately found out that the `/quiz` page was rendering questions through the JS once, then when the user submits their answer, the JS renders the question again to inject the explanation & formal answer, I removed it and depended fully on CSS & HTML, the whole question including explanation & formal answer is now injected all at the first render, then I make things visible when the user submits the answer using CSS classes. That approach to get away from JS improved performance alot.  

## New Features

### Result Pages

#### Videos (Easy to make, but very important)
* Add a result-page feature that displays themed meme videos based on the user’s degree or score.
* Suggested themes include:
  * دعوية
  * إسلامية
  * قرآن
  * ميمز تشجيع سلبية
  * ميمز تشجيع إيجابية
* Some vidoes will be displayed based on the percentage of the result.

#### Score Guage
* The result page displays the score increase, but doesn't display the updated score. Bring the `#identityLevel` from the profile page to the result page.

### `public/src/shared/markdown.js`
* Resize Handle Issues:
  * Images don't get the resize handles, 
  * Images appear aligned to the left instead of the middle. ![screenshot](image.png).

* See `docs\plans\md-engine-prompt.md` and execute its remaining parts.
* Then implement [live render plan](plans/live-render-md-prompt.md)

*Tested on localhost*

### Home Page

#### Info Modals
* Quizzes, Lessons, Folders, and Courses store so much info (Check their tables in [DB Context](Database-Schema-Context.md)):
  * Extend the info in the info modal `quiz-info-dialog` (don't show the password ofcourse, but you can show an indication like (privacy: has password) or a similar label)
  * Extend the info in the course info modal, too.
  * Make an info modal for Folders.
  * (Suggestion) Add: Number of Views or people who solved a quiz on each quiz.

#### New 
* Add `مادة جديدة` In the `class="btn create-folder-btn mobile-only-flex"` button's dropdown.
* Redesign the `#userQuizContextMenu` Element: 
  * Move all the button for creating ("إنشاء مادة", "إنشاء مجلد", "إنشاء امتحان",  and the new "انشاء درس") to a submenu dropdown, so you will have to design a submenu for the `#userQuizContextMenu`.

### `public\control.html` Page
* Give `#collegeForm` an advanced loading skeleton/animation like the sections/forms.

### `public\about.html` Page
* Suggestion: Add an open-source Angle (Since the repo is currently open source).
* Suggestion: Add a short testimonial or review.
* Add the number of views of the whole platform (try to integrate vercel insights if possible) to the `المنصة بالأرقام` section.

### Create Quiz Page
`create-quiz.js` is 5000+ lines in one file — It's the right time to split it into modules.

### Connect Canva
Think of a new way to download quizzes and lessons, maybe through canva.

### Download as Python
Think about this suggestion, a new way to download quizzes.

### Translation and content expansion (Suggestion)
* Add English translation support.

### Offline Page
Improve:
* It's theme Should match the theme of the platform (see themes.css and theme-controller.js), but it shouldn't import these files, it should be independent. It should also default to the default theme of the platform.

### `api\og.js`
* Special courses that get the (مادة مميزة) badge, since there is no info table displayed, the middle of the image becomes emtpy, I need to fill it with something, or ideas to improve it when it has the  (مادة مميزة) badge. 
* Lessons in the `lesson.html` don't get custom OGs like quizzes do.
# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### AI Agent

#### Dictation
Fix Dictation: The dictation doesn't work on Brave browser, even though other websites I built worked fine on Brave Browser when using the browser api for dictation.

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
* Implement [live render plan](plans/live-render-md-prompt.md)

### Home Page

#### Info Modals
* Quizzes, Lessons, Folders, and Courses store so much info (Check their tables in [DB Context](Database-Schema-Context.md)):
  * Extend the info in the info modal `quiz-info-dialog` (don't show the password ofcourse, but you can show an indication like (privacy: has password) or a similar label)
  * Extend the info in the course info modal, too.
  * Make an info modal for Folders.
  * (Suggestion) Add: Number of Views or people who solved a quiz on each quiz.

#### New 
* Implement an inline create modal for `مادة جديدة` In the `class="btn create-folder-btn mobile-only-flex"` button's dropdown And the "إنشاء مادة" in the `#userQuizContextMenu`. See the inline create modal for quizzes.

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
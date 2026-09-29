# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Lesson Page (`public\lesson.html`, `public\lesson-comments.html`, & `public\src\features\lesson\`)
Issues:
* The `لون التظليل` item isn't doing anything at all, if it's broken fix it, and if it's useless remove it.
* The `وضع التركيز` isn't synced between the 2 `lesson-prefs__panel`s, the one in the main lesson page, and the other inside the info modal.
* `.lesson-section` isn't centered in the page. See ![screenshot](image-3.png).
* The read-aloud (dictation) feature in the lesson page is broken; it doesn't do anything.
* Messed up layout at the bottom of `.quiz-info-dialog-inner`, the `.lesson-prefs__panel` doesn't blend in or isn't placed correctly. Make `.quiz-info-dialog-inner` it's own design of the preferences panel, instead of reusing `.lesson-prefs__panel`. See ![screenshot](image-1.png).
* Each question in the lesson has `lesson-question__reset`. Remove it and make one lesson-wide questions reset with confirmation. 
* `.lesson-tts__btn--stop` is always visible, even when the read-aloud (dictation) feature is off.
* The interactive quiz has many UI issues. See ![screenshot 5](image_5.png).
* Panels Behavio:
  * Clicking outside of a panel (e.g., `.lesson-prefs__panel` or `.lesson-bookmarks__panel`) when it's open doesn't close it. 
  * Opening a different panel doesn't close the first one that was open.
* The `.lesson-selection-popup` buttons (e.g., "اشرحها" and "بسّطها") don't work.
* Improve `.lesson-toc`, make it like the other perfect toc I made before for the document pages `.doc-toc`, see `public\src\features\documents\doc-toc.js`:
  * `.lesson-toc` should be smaller to match `.doc-toc`'s size.
  * `.lesson-toc` should be in the same position to match `.doc-toc`.
  * `.lesson-toc` should be collapsable and expandable just like `.doc-toc` with the same styles for it.

Console log when testing:
```console
script.js:1  Failed to load resource: the server responded with a status of 404 (Not Found)
esdfdzhtavraczrhxnmp.supabase.co/rest/v1/quizzes?select=data&id=in.%28AHMTTSRO%29:1  Failed to load resource: the server responded with a status of 400 ()
lesson-view.js:128 [lesson-view] quizRef lookup failed: invalid input syntax for type uuid: "AHMTTSRO"
fetchQuizRefs @ lesson-view.js:128
user_lesson_1789827664545?type=user:1  Failed to load resource: the server responded with a status of 503 (Service Unavailable)
service-worker.js:161 [SW] Service worker script loaded (offline-page only)
```

* Tested on localhost (URL: `http://localhost:8080/lesson/user_lesson_1789827664545?type=user`).
* Tested lesson: Created in the "امتحاناتك" section, not an uploaded lesson.

New:
* Design and implement an advanced loading skeleton and remove the placeholder loading `جاري تحميل الدرس…`.

### Global Issue
This issue appears on almost all pages, it's related to this script: `<script defer src="/_vercel/insights/script.js"></script>`
```
script.js:1  Failed to load resource: the server responded with a status of 404 (Not Found)
```
That issue is local only, if it's not harmful, then no problem.

The issue doesn't affect production.

### AI Agent
Fix Dictation: The dictation feature is so messed up, it doesn't work on Brave browser, even though other websites I built worked fine on Brave Browser.

### Create-lesson Page
* Changing the value of `#lessonFontSelect` doesn't change anything.

New: 
* Add password field and description field just like `create-quiz` does, and update the lesson page accordingly.
* Redesign the whole `.entry-screen`, find ideas and generate an ipmlementation plan suggesting any improvements. The plan must be an (implementation plan) that is ready to execute. 

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
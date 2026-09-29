# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Create-lesson Page
* Fix (On the create-lesson and create-quiz): The `gmd-btn gmd-btn-latex gmd-dropdown-toggle` toggle and the 2 `gmd-btn gmd-dropdown-toggle` toggles, pressing once opens, but pressing again doesn't close. And opening one of them, then opening a different one, doesn't close the original. 
* Fix: The functionality and form of the `#menuBar` element in create-lesson page doesn't match that of the create-quiz page, make sure opening and closing items inside of it matches the design and function of that element on the create-quiz page.
* Fix: The `quiz-metadata card` for ( معلومات عن الامتحان) in create-quiz.html is perfect in design and function. The `lesson-editor-details card` in create-lesson.html isn't perfect, and it doesn't include the source, redesign it to match that of the create-quiz.html.
* These are issues when trying to run a lesson after the last update ![screenshot](image-1.png).
```
service-worker.js:161 [SW] Service worker script loaded (offline-page only)
inpage.js:1 [23:07:10] ERROR Unable to obtain channel secret for broadcast system
(anonymous) @ inpage.js:1
import_loglevel.default.error @ inpage.js:1
acquireSecret @ inpage.js:1
await in acquireSecret
ExtendedBroadcastMessage @ inpage.js:1
ProvidersManager @ inpage.js:1
init @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
Promise.then
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
inpage.js:1 [23:07:11] ERROR Unable to find node id to create broadcast system Error: Channel secret not available yet
    at ExtendedBroadcastMessage.initBroadcastMessage (inpage.js:1:85369)
    at ExtendedBroadcastMessage.loadBroadcastMessage (inpage.js:1:84189)
(anonymous) @ inpage.js:1
import_loglevel.default.error @ inpage.js:1
loadBroadcastMessage @ inpage.js:1
await in loadBroadcastMessage
getBroadcastMessage @ inpage.js:1
ExtendedBroadcastMessage @ inpage.js:1
ProvidersManager @ inpage.js:1
init @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
Promise.then
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
inpage.js:1 [23:07:11] ERROR Error: Broadcast channel unavailable
    at ExtendedBroadcastMessage.emit (inpage.js:1:85649)
    at async TonAdapter.start (inpage.js:1:2197273)
(anonymous) @ inpage.js:1
import_loglevel.default.error @ inpage.js:1
start @ inpage.js:1
await in start
(anonymous) @ inpage.js:1
start @ inpage.js:1
init @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
Promise.then
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
inpage.js:1 [23:07:11] ERROR Error: Broadcast channel unavailable
    at ExtendedBroadcastMessage.emit (inpage.js:1:85649)
    at async SolanaAdapter.setDefaultWallet (inpage.js:1:1692857)
    at async SolanaAdapter.start (inpage.js:1:1691623)
(anonymous) @ inpage.js:1
import_loglevel.default.error @ inpage.js:1
start @ inpage.js:1
await in start
(anonymous) @ inpage.js:1
start @ inpage.js:1
init @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
Promise.then
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
inpage.js:1 [23:07:11] ERROR Error: Broadcast channel unavailable
    at ExtendedBroadcastMessage.emit (inpage.js:1:85649)
    at async TronAdapter.setConnectionUrl (inpage.js:1:3178817)
    at async TronAdapter.start (inpage.js:1:3178943)
(anonymous) @ inpage.js:1
import_loglevel.default.error @ inpage.js:1
start @ inpage.js:1
await in start
(anonymous) @ inpage.js:1
start @ inpage.js:1
init @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
Promise.then
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
inpage.js:1 [23:07:11] ERROR Error: Broadcast channel unavailable
    at ExtendedBroadcastMessage.emit (inpage.js:1:85649)
    at async BitcoinAdapter.setDefaultWallet (inpage.js:1:148297)
    at async BitcoinAdapter.start (inpage.js:1:147239)
(anonymous) @ inpage.js:1
import_loglevel.default.error @ inpage.js:1
start @ inpage.js:1
await in start
(anonymous) @ inpage.js:1
start @ inpage.js:1
init @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
Promise.then
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
inpage.js:1 [23:07:11] ERROR Error: Broadcast channel unavailable
    at ExtendedBroadcastMessage.emit (inpage.js:1:85649)
    at async EthereumAdapter.setChainId (inpage.js:1:1296881)
    at async Promise.all (index 0)
(anonymous) @ inpage.js:1
import_loglevel.default.error @ inpage.js:1
Promise.catch
start @ inpage.js:1
(anonymous) @ inpage.js:1
start @ inpage.js:1
init @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
Promise.then
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
inpage.js:1 [23:07:11] ERROR Error: Broadcast channel unavailable
    at ExtendedBroadcastMessage.emit (inpage.js:1:85649)
    at async EthereumAdapter.setDefaultEthereumWallet (inpage.js:1:1296770)
(anonymous) @ inpage.js:1
import_loglevel.default.error @ inpage.js:1
Promise.catch
start @ inpage.js:1
(anonymous) @ inpage.js:1
start @ inpage.js:1
init @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
Promise.then
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
inpage.js:1 [23:07:11] ERROR Error: Broadcast channel unavailable
    at ExtendedBroadcastMessage.emit (inpage.js:1:85649)
    at async Web3RpcProvider.call (inpage.js:1:92061)
    at async BinanceInjectedProvider.boot (inpage.js:1:93836)
(anonymous) @ inpage.js:1
import_loglevel.default.error @ inpage.js:1
Promise.catch
(anonymous) @ inpage.js:1
setTimeout
start @ inpage.js:1
(anonymous) @ inpage.js:1
start @ inpage.js:1
init @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
Promise.then
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
content.js:1 Uncaught (in promise) Error: Timeout exceeded
    at content.js:1:199968
(anonymous) @ content.js:1
setTimeout
(anonymous) @ content.js:1
(anonymous) @ content.js:1
d @ content.js:1
l.value @ content.js:1
(anonymous) @ content.js:1
asyncGeneratorStep @ content.js:1
i @ content.js:1
(anonymous) @ content.js:1
(anonymous) @ content.js:1
_waitLoaded @ content.js:1
waitLoaded @ content.js:1
(anonymous) @ content.js:1
d @ content.js:1
l.value @ content.js:1
(anonymous) @ content.js:1
asyncGeneratorStep @ content.js:1
i @ content.js:1
Promise.then
asyncGeneratorStep @ content.js:1
i @ content.js:1
(anonymous) @ content.js:1
(anonymous) @ content.js:1
_createClass.value @ content.js:1
e @ content.js:1
(anonymous) @ content.js:1
inpage.js:1 [23:07:16] ERROR Unable to find node id to create broadcast system Error: Channel secret not available yet
    at ExtendedBroadcastMessage.initBroadcastMessage (inpage.js:1:85369)
    at ExtendedBroadcastMessage.loadBroadcastMessage (inpage.js:1:84189)
(anonymous) @ inpage.js:1
import_loglevel.default.error @ inpage.js:1
loadBroadcastMessage @ inpage.js:1
await in loadBroadcastMessage
getBroadcastMessage @ inpage.js:1
emit @ inpage.js:1
(anonymous) @ inpage.js:1
forwardErrorToBackground @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
setTimeout
(anonymous) @ inpage.js:1
loadBroadcastMessage @ inpage.js:1
await in loadBroadcastMessage
getBroadcastMessage @ inpage.js:1
ExtendedBroadcastMessage @ inpage.js:1
ProvidersManager @ inpage.js:1
init @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
Promise.then
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
(anonymous) @ inpage.js:1
lesson-view.js:667 [lesson-view] Lesson content preparation failed: ReferenceError: collectLessonRefIds is not defined
    at renderLessonView (lesson-view.js:662:7)
renderLessonView @ lesson-view.js:667
await in renderLessonView
(anonymous) @ lesson-page.js:9


```

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
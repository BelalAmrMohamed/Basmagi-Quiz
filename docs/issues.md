# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Lesson Page
Issues:
* `لون التظليل` isn't doing anything at all, if it's useless, remove it.
* `وضع التركيز` isn't synced between the 2 `lesson-prefs__panel`.
* `.lesson-section` isn't centered in the page. See the second screenshot.
* Issue when I tried to run the `supabase db push`: 

```bash
PS D:\Code projects\Websites\منصة إمتحانات بصمجي> supabase db push
Initialising login role...
Connecting to remote database...
Remote migration versions not found in local migrations directory.

Make sure your local git repo is up-to-date. If the error persists, try repairing the migration history table:
supabase migration repair --status reverted 20260927060207

And update local migrations to match remote database:
supabase db pull

PS D:\Code projects\Websites\منصة إمتحانات بصمجي> 
```

* The read-aloud feature for the lesson is broken; it doesn't do anything.
* Messed up layout at the bottom of `.quiz-info-dialog-inner`, the `.lesson-prefs__panel` doesn't blend in. See ![screenshot](image-1.png).
* Each question in the lesson has `lesson-question__reset`. Remove it and make one lesson-wide confirmation instead of per question. 
* `.lesson-tts__btn--stop` always appears even when the dictation (read-aloud) feature is off.
* The interactive quiz has many UI issues. See ![screenshot 5](image_5.png).
* When the `.lesson-prefs__panel` is open, clicking out of it doesn't close it. And opening the `.lesson-bookmarks__panel` also doesn't close it.

Console log when testing:

```
script.js:1  Failed to load resource: the server responded with a status of 404 (Not Found)
content.js:1 Uncaught (in promise) Error: Timeout exceeded
    at content.js:1:199968
esdfdzhtavraczrhxnmp.supabase.co/rest/v1/quizzes?select=data&id=in.%28AHMTTSRO%29:1  Failed to load resource: the server responded with a status of 400 ()
lesson-view.js:128 [lesson-view] quizRef lookup failed: invalid input syntax for type uuid: "AHMTTSRO"
fetchQuizRefs @ lesson-view.js:128
user_lesson_1789827664545?type=user:1  Failed to load resource: the server responded with a status of 503 (Service Unavailable)
service-worker.js:161 [SW] Service worker script loaded (offline-page only)
```

### AI Agent
Fix Dictation: The dictation feature is so messed up, it doesn't work on Brave browser, even though other websites I built worked fine on Brave Browser.

### Lessons Page

#### Changes
- The `/lesson/` page should have the lesson's info modal, and I want new ideas to give the user control over the lessons.
- The `الباشــمبصمج`: 
  - Users should be able to tell it to create questions about that lesson, and the الباشــمبصمج should be able to create an interactive quiz that users can actually solve and get graded (all types of questions) in the lessons page itself, this is different than creating quizzes in the "امتحاناتك" section. This should be full integration, with suggested prompts and it should get the full context of the lesson.
  - Users should be able to upload content.
- Complete the implementation of the page:
  - Custom design for the page, because it's currently flat. Add any new elements you are totally free to do what ever.
- There is no way to reset the page (qustions stay locked after answer).
- Implement a lesson reader (read aloud) using the browser's api.
- `أسئلة الطلاب` section shouldn't appear for user-created lessons.
- The `lesson-prefs__panel` element is broken, changing the colors in it doesn't do anything, and the `lesson-prefs__panel` itself is always white on all different themes. It's dropdown has bad design.
- The lesson page should get the `ai-agent-more-btn` like the other pages. Users should be allowed to upload content.
- Add `/create-lesson` to the AI Aggent's action menu on the home page.
- Add a button in the `ai-agent-dropdown-menu` to open the slash menu, so users can open it without typing `/` 

### Create-lesson Page
- Changing the value of `#lessonFontSelect` doesn't change anything.
- `.entry-item` is too tall, improve it's design. And I also want to improve the design of the whole `.entry-screen`, generate an ipmlementation plan suggesting any improvements. 

### Performance (Globally, but specially the main page)
Performance Improvements: Currently, there are many custom mechanism fucntionalities built in JS that works perfectly, but it may exist natively in HTML, CSS, or as a browser API. In that case we shouldn't reinvent the wheel, specially if it exists natively. Anything that exists natively in HTML, CSS, or as a browser API should be used that way and we should delete any custom JS implementation that has native alternatives. That would improve performance very well. Search for everything, anything that can be implemented in HTML & CSS directly without JS should be done so. You can search the web for modern HTML & CSS, because sometimes they add new things, but watch out for compatibility with different browsers (minimum requirenment: Chrome). But I don't want to miss up any functionality, this is just for performance, not to change any fucntionality.

Example: I lately found out that the `/quiz` page was rendering questions through the JS once, then when the user submits their answer, the JS renders the question again to add the explanation & formal answer, I removed it and depended fully on CSS & HTML, the whole question including explanation & formal answer is inserted at the first render, then I make things visible when the user submits the answer using CSS classes. That approach to get away from JS improved performance alot.  

## New Features

### Implement [plan](plans/live-render-md-prompt.md)

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
Improve
- It's colors Should match the theme of the platform (see themes.css and theme-controller.js), but it shouldn't import these files, it should be independent. It should also default to the default theme of the platform.

### `api\og.js`
- Special courses that get the (مادة مميزة) badge, since there is no info table displayed, the middle of the image becomes emtpy, I need to fill it with something, or ideas to improve it when it has the  (مادة مميزة) badge. 
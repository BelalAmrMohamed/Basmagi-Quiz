# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Globa Issue with buttons
* Hovering buttons on their border make cause them to flash in a buggy way, that issue is probably related to their transition changing their location or something similar.

### Update OG Titles & Descriptions (`api/og.js`)
Folders and Courses' OG titles & OG desciptions should updated to include lessons and notebooks. 

Update SEO and GEO, too, they haven't been updated in a long while and are probably missing alot.

### Bottom Nav on phones
* Phones bottom nav has 2 create buttons, they are missing the 3rd (create-notebook), although its reachable from the sidebar that pops from the bottom. Swap it with settings.
* I honestly don't know what is the best decision, maybe keeping settings 

### Quiz Passwords are exposed
The home page downloads every quiz’s password to the browser, so passwords are readable by anyone. Which is a security flaw that needs to be fixed.

### AI Agent

#### Dictation
Fix Dictation: The dictation doesn't work on Brave browser, even though other websites I built worked fine on Brave Browser when using the browser api for dictation.

### Performance (Globally, but specially the main page)
Performance Improvements: Currently, there are many custom mechanism fucntionalities built in JS that works perfectly, but it may exist natively in HTML, CSS, or as a browser API. In that case we shouldn't reinvent the wheel, specially if it exists natively. Anything that exists natively in HTML, CSS, or as a browser API should be used that way and we should delete any custom JS implementation that has native alternatives. That would improve performance very well. Search for everything, anything that can be implemented in HTML & CSS directly without JS should be done so. You can search the web for modern HTML & CSS, because sometimes they add new things, but watch out for compatibility with different browsers (minimum requirenment: Chrome). But I don't want to miss up any functionality, this is just for performance, not to change any fucntionality.

Example 1: I lately found out that the `/quiz` page was rendering questions through the JS once, then when the user submits their answer, the JS renders the question again to inject the explanation & formal answer, I removed it and depended fully on CSS & HTML, the whole question including explanation & formal answer is now injected all at the first render, then I make things visible when the user submits the answer using CSS classes. That approach to get away from JS improved performance alot. (This is already patched and tested).

Example 2: The markdown engine was manually detecting the direction of sentences to determine their `direction`. A previous performance update deleted all of the related code and forced it to use the native attribute `dir="auto"`. (This is already patched and tested). 

Example 3 (The Sidebar/Side-menu's): The sidebar component is a part that is common to all pages. Its JS and CSS are the same and are imported in all pages, but the HTML is duplicated, which means it's extremely hard to maintain and update. And it became to messy. And it's not even the same, the docuement pages don't have the HTML directly in them, it's inserted from a JS file. 

## New Features

### Tooltips
* Standing on a quiz card, lesson card, or notebook card, and hovering the title or description should show a tooltip with their full content (since long title/descriptions get truncated).

### Content Card Design
* The current design of notebook cards, lesson cards, and quiz cards on the whome page is a mess.
* Notebooks and lessons basically cannot be told apart from each other.
* The naming of things is messed up, because of how much things were reused when implementing new features, for example, the dropdown menu used on all 3 of them is called (exam-dropdown-menu), even though exams on the platform are typically called `quizzes`, and this UI element isn't used on quizzes only anyways. The code quality needs to be improved.
* When lessons & notebooks are mixed with quizzes in a course, it looks like a mess with some cards taller than others. ![screenshot](image.png), we need to redeisgn the hight, width, and how much of the title & description can be shown to control the card styles better.
* The user content section is named (امتحانك), aside from the platform now supporting lessons and notebooks, too, so not only quizzes, but even that name was confusing when it was only quizzes, because users thought it was the history not content they create, name it something expressive like (إنشاء) or (إنشاء محتوى) or your recommendation.
* The user content section can't be accessed offline, because it's inside the content area of the other courses too, I need an idea on how to solve that to make that area accessible, since it depends on localStorage, so it doesn't need to be online, specially for people who have the app installed.
* The user content card doesn't display the number of notebooks or courses.

### Update the MCP Server
* Improve the MCP Server for usages similar to this: 
  * A user connects Basmagi Quiz + Google Drive to Claude, shares a specific drive folder, and tells Claude to convert its content onto the Basmaig Quiz Platform.
  * Expected Behavior: Claude recognises which of them can be converted into quizz, or lessons, or notebooks (with which runtime), and converts them properly. 
  * Optional: Claude asks the user what content to convert to what for verification before deciding.

### Dictation for Essay Questions (Lesson & Quiz Pages)
Add dictation feature for essays in quizzes and lessons

### Result Pages

#### Videos (Easy to make and intersting idea)
* Add a result-page feature that displays themed meme videos based on the user’s degree or score.
* Suggested themes include:
  * دعوية
  * إسلامية
  * قرآن
  * ميمز تشجيع سلبية
  * ميمز تشجيع إيجابية
* Some vidoes will be displayed based on the percentage of the result.

### `public\about.html` Page
* Suggestion: Add an open-source Angle (Since the repo is currently open source).
* Suggestion: Add a short testimonial or review.
* Suggestion: Add the number of views of the whole platform (try to integrate vercel insights if possible) to the `المنصة بالأرقام` section.
* Extend the `كيف بُنيت المنصة؟` section to include `SEO (Search Engine Optimization)`, `GEO (Generative Engine Optimization)`, and MCP Server.

### Create Quiz Page
`create-quiz.js` is 5000+ lines in one file — It's the right time to split it into modules.

### Connect Canva
Think of a new way to download quizzes and lessons, maybe through canva.

### Download Lessons as Python Manim (MCP Server Export)
[plan](plans/lesson-video-export-plan.md).
* Claude sometimes gets confused and doesn't know how to install Manim to render the code, so tell it context on how to do it.
* Test the VO That can be downloaded in the Claude Sandbox.

### Translation and content expansion (Suggestion)
* Native English translation support with native LTR pages.

### Offline Page
Improve:
* It's theme Should match the theme of the platform (see themes.css and theme-controller.js), but it shouldn't import these files, it should be independent. It should also default to the default theme of the platform.

### `api\og.js`
* Special courses that get the (مادة مميزة) badge, since there is no info table displayed, the middle of the image becomes emtpy, I need to fill it with something, or ideas to improve it when it has the  (مادة مميزة) badge. 

### Notebooks

#### Improve the Image Tool modal
* There are many missing functionalities, even if they are too hard to add, add the important ones like that feature that zooming into the pixels shows their info.
* It shouldn't be a modal that has a set location/width/height, it should be a draggable and resizable window, just like the actual MATLAB Program.
* Scrolling into the image and zooming is really bad, it's unexpectable, not intuitive to the user.
* When Pressing "Run All" or using image tool multiple times at once, the image tool windows shouldn't be exactly on top of each other.

#### Workspace
* When creating a new notebook, adding new images, saving the notebook, and uploading it to the platform, the notebook doesn't include the uploaded images.
* I don't want all users to be able to upload images to the platform (I'm on Supabase free-tier), only admins should, and also admins shouldn't do it all the time, because not all notebooks they create are going to be published. I haven't thought of a way to solve this issue.
* MCP Server should be able to add images to the workspace, too, but if the draft isn't saved, they should be deleted.

DB Note:
* Since we are expanding our usage of the DB based on that update, I want to put a limit on uploaded content to the DB (Like images, videos, etc...) [For all pages, not just the notebook page], this way notebooks, lessons, quizzes, and other items can still be uploaded and preserved even when the limit of the uploaded images and content is reached.

#### What’s not done:

* Shortcuts: Jupyter command-mode shortcuts (A, B, D D, M, Y) are not built—Shift+Enter, Ctrl+Enter, and the toolbar work.
* Exports: they contain no cell outputs, because outputs aren’t stored. Exporting from within a notebook should give the user the option to include the outputs.
* Not tested: the admin publish flow and a live Supabase.
* The runtime bundle in public/assets/notebook-runtime/ was rebuilt from the changed source, so commit it along with the rest. The notes are in docs/NOTEBOOKS.md.
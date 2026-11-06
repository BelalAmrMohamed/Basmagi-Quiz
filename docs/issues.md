# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Home Page (index.html)

#### Info Modals
* Info modals for quizzes, lessons, and notebooks, should use the drive icon when the source is from Google Drive, or the YouTube icon if it's Youtube
  * `public\assets\images\google-drive-icon.webp`
  * `public\assets\images\youtube-icon.webp`

#### Downlaod modals
* Notebook: The download modal doesn't have copying for copyable exports.
* Download modals should use the Drive icon when the link is in Google Drive: 
  * `public\assets\images\google-drive-icon.webp`
  * `public\assets\images\youtube-icon.webp`

---

### Notebook Page

### Bottom Nav on phones
* Phones bottom nav has 2 create buttons, they are missing the 3rd (create-notebook), although its reachable from the sidebar that pops from the bottom. Swap it with settings.
* I honestly don't know what is the best decision, maybe keeping settings 

### Quiz Passwords are exposed
The home page downloads every quiz’s password to the browser, so passwords are readable by anyone. Which is a security flaw that needs to be fixed.

### AI Agent (الباشــمبصمج)

#### Redesign
* Implement my personal component from 21st.dev: Rich Markdown AI Input Field with code blocks.
* Instead of a modal, make it a window like `image-tool-window`, don't copy it or import it in the AI Agent files, I want you to implement a better version that is resposive when the window itself is smaller/bigger. Features:

#### Dictation
Fix Dictation: The dictation doesn't work on Brave browser, even though other websites I built worked fine on Brave Browser when using the browser api for dictation.

### Performance (Globally, but specially the main page)
Performance Improvements: Currently, there are many custom mechanism fucntionalities built in JS that works perfectly, but it may exist natively in HTML, CSS, or as a browser API. In that case we shouldn't reinvent the wheel, specially if it exists natively. Anything that exists natively in HTML, CSS, or as a browser API should be used that way and we should delete any custom JS implementation that has native alternatives. That would improve performance very well. Search for everything, anything that can be implemented in HTML & CSS directly without JS should be done so. You can search the web for modern HTML & CSS, because sometimes they add new things, but watch out for compatibility with different browsers (minimum requirenment: Chrome). But I don't want to miss up any functionality, this is just for performance, not to change any fucntionality.

Example 1: I lately found out that the `/quiz` page was rendering questions through the JS once, then when the user submits their answer, the JS renders the question again to inject the explanation & formal answer, I removed it and depended fully on CSS & HTML, the whole question including explanation & formal answer is now injected all at the first render, then I make things visible when the user submits the answer using CSS classes. That approach to get away from JS improved performance alot. (This is already patched and tested).

Example 2: The markdown engine was manually detecting the direction of sentences to determine their `direction`. A previous performance update deleted all of the related code and forced it to use the native attribute `dir="auto"`. (This is already patched and tested). 

Example 3 (The Sidebar/Side-menu's): The sidebar component is a part that is common to all pages. Its JS and CSS are the same and are imported in all pages, but the HTML is duplicated, which means it's extremely hard to maintain and update. And it became to messy. And it's not even the same, the docuement pages don't have the HTML directly in them, it's inserted from a JS file. 

So these are 3 examples of performance issues that I found and fixed, there are probably alot of other issues, too, some like the examples, others aren't.

## New Features

### Dictation for Essay Questions (Lesson & Quiz Pages)
Add dictation feature for essays in quizzes and lessons

### "معلومات المجلد" and "معلومات المادة" 
They both should be updated to include notebooks now.


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
* **The `المنصة بالأرقام` section:**
  * The number "كلية ومرحلة تعليمية" is incorrect, it's showing 1, even though its supposed to be 2: CS College (Exists on the platform with many courses and content) and High Schools (Exists on the platform with a course and its content)
  * The section only shows the number of published quizzes, it doesn't show lessons or notebooks.
  * It says that "مادة وتصنيف" is `5`, but there is no way, a single term of CS College on the platform probably has more than 5 courses. It's no way that the whole platform has 5, or maybe the label wasn't intended for "courses", douple check and fix.


### Create Quiz Page
`create-quiz.js` is 5000+ lines in one file — It's the right time to split it into modules.

### Connect Canva
Think of a new way to download quizzes and lessons, maybe through canva.

### Download Lessons as Python Manim (MCP Server Export)
[plan](plans/lesson-video-export-plan.md).
* Claude sometimes gets confused and doesn't know how to install Manim to render the code, so tell it context on how to do it. Or maybe Manim isn't even the best way to make videos, maybe chromium is.
* Test the VO That can be downloaded in the Claude Sandbox.

*The plan has been delayed until we implement this plan first: [Proper Voice-Over](plans/advanced-read-aloud.md). Because it's going to be reused for the videos' VO, too.*

### Translation and content expansion (Suggestion)
* Native English translation support with native LTR pages.

### Offline Page
Improve:
* It's theme Should match the theme of the platform (see themes.css and theme-controller.js), but it shouldn't import these files, it should be independent. It should also default to the default theme of the platform.

### Notebooks

#### Workspace
* When creating a new notebook, adding new images, saving the notebook, and uploading it to the platform, the notebook doesn't include the uploaded images.
* I don't want all users to be able to upload images to the platform (I'm on Supabase free-tier), only admins should, and also admins shouldn't do it all the time, because not all notebooks they create are going to be published. I haven't thought of a way to solve this issue.
* MCP Server should be able to add images to the workspace, too, but if the draft isn't saved, they should be deleted.

DB Note:
* Since we are expanding our usage of the DB based on that update, I want to put a limit on uploaded content to the DB (Like images, videos, etc...) [For all pages, not just the notebook page], this way notebooks, lessons, quizzes, and other items can still be uploaded and preserved even when the limit of the uploaded images and content is reached.

#### Awaiting decision (not implemented)

4. **Notebook image asset lifecycle:** Define how images added to the workspace are carried through local save, import drafts, and publication. Decide how to restrict platform uploads to admins, clean up uncommitted draft assets, support MCP-created workspace assets, and enforce shared storage limits before implementing this.
5. **Notebook reliability and end-to-end coverage:** Test local and published notebook flows in a browser, including the admin publish path against staging/live Supabase. Review execution interruption and worker-error reporting, and add coverage for failures and recovery. Do not change runtime behavior until this scope is approved.
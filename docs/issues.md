# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Global Issue: Buggy Hover Interactions (Buttons & Cards)

Investigate the entire project for buttons, cards, and other interactive elements that exhibit buggy or flickering behavior when hovered, particularly when the cursor moves near or along their borders.

**Likely root cause:**
Some hover effects may change an element's position, dimensions, or boundaries (e.g., translating it upward while simultaneously increasing its scale). This can cause the element to move away from the cursor, trigger `mouseleave`, and repeatedly toggle the hover state, resulting in a flickering or flashing effect.

**Requirements:**
1. Audit the entire project and identify all instances of problematic hover implementations.
2. Investigate the actual root cause rather than blindly modifying CSS transitions.
3. Fix each affected element using the most appropriate approach. Consider alternatives such as `transform`, `box-shadow`, background-color transitions, and other visual effects that don't unintentionally alter the element's hover boundaries.
4. Preserve the original design intent and individuality of each element. **Do NOT apply one universal hover effect to every button or card.**
5. Avoid unnecessary changes to elements that already have smooth, bug-free hover interactions.
6. Check for similar issues involving nested elements, overlapping interactive areas, pseudo-elements, and conflicting hover states.

**Objective:** Eliminate buggy hover behavior throughout the project while preserving the existing visual identity, design variety, and intended interaction effects of every component.

Make the necessary changes directly in the existing codebase. Do not merely provide recommendations or a list of potential fixes.

### `api\og.js`
* Special courses that get the (مادة مميزة) badge, since there is no info table displayed, the middle of the image becomes emtpy, I need to fill it with something, or ideas to improve it when it has the  (مادة مميزة) badge. 

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

So these are 3 examples of performance issues that I found and fixed, there are probably alot of other issues, too, some like the examples, others aren't.

## New Features

### Update the MCP Server
* Improve the MCP Server for usages similar to this: 
  * A user connects Basmagi Quiz + Google Drive to Claude, shares a specific drive folder, and tells Claude to convert its content onto the Basmaig Quiz Platform.
  * Expected Behavior: Claude recognises which of them can be converted into quizz, or lessons, or notebooks (with which runtime), and converts them properly. 
  * Optional: Claude asks the user what content to convert to what type for verification before deciding.

*If you believe the MCP Server already works good for that, leave it as it is.*

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
* Add the number of views of the whole platform (try to integrate vercel insights if possible) to the `المنصة بالأرقام` section. Or create a custom one with new migrations in the `supabase/migrations` directory, and implement the live counter that counts all of the views to the platform + Advanced analytics. 

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
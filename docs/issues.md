# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Notebooke Page: C++ Runtime
* **![Screenshot](image.png)**
* When I try to run any C++ code, it either return an error, or doesn't return anything.

### Missing element in sidebar
Add the link to the notebook page to the sidebar in document pages. See: `public\src\features\documents\documents-shell.js`

### Bottom Nav on phones
* Phones bottom nav has 2 create buttons, they are missing the 3rd (create-notebook), although its reachable from the sidebar that pops from the bottom. Swap it with settings.
* I honestly don't know what is the best decision, maybe keeping settings 

### Quiz Passwords are exposed
The home page downloads every quiz’s password to the browser, so passwords are readable by anyone. Which is a security flaw that needs to be fixed.

### AI Agent (الباشــمبصمج)

#### Redesign
* Implement my personal component from 21st.dev: Rich Markdown AI Input Field with code blocks.
* Instead of a modal, make it a window like `image-tool-window`, don't copy it or import it in the AI Agent files, I want you to implement a a copy of it. Features:
  * Same UI of Basmagi but in a window instead of a modal. Include all features and resposiveness of that window: 
    * Aero Snap with the thumbnail/preview
    * Mac-style control buttons at the top
    * الباشــمبصمج's own title and logo at the top instead of that of `image-tool-window`.
    * When window is open, maximized or minimized, the الباشــمبصمج's fab becomes hidden, until the window is closed.
    * When the window is minimized and there was a prompt running, it should continue running with an animation on the minimized state indicating so.

#### Dictation
Fix Dictation: The dictation doesn't work on Brave browser, even though other websites I built worked fine on Brave Browser when using the browser api for dictation.

### Performance (Globally, but specially the main page)
Performance Improvements: Currently, there are many custom mechanism fucntionalities built in JS that works perfectly, but it may exist natively in HTML, CSS, or as a browser API. In that case we shouldn't reinvent the wheel, specially if it exists natively. Anything that exists natively in HTML, CSS, or as a browser API should be used that way and we should delete any custom JS implementation that has native alternatives. That would improve performance very well. Search for everything, anything that can be implemented in HTML & CSS directly without JS should be done so. You can search the web for modern HTML & CSS, because sometimes they add new things, but watch out for compatibility with different browsers (minimum requirenment: Chrome). But I don't want to miss up any functionality, this is just for performance, not to change any fucntionality.

Example 1: I lately found out that the `/quiz` page was rendering questions through the JS once, then when the user submits their answer, the JS renders the question again to inject the explanation & formal answer, I removed it and depended fully on CSS & HTML, the whole question including explanation & formal answer is now injected all at the first render, then I make things visible when the user submits the answer using CSS classes. That approach to get away from JS improved performance alot. (This is already patched and tested).

Example 2: The markdown engine was manually detecting the direction of sentences to determine their `direction`. A previous performance update deleted all of the related code and forced it to use the native attribute `dir="auto"`. (This is already patched and tested). 

Example 3 (The Sidebar/Side-menu's): The sidebar component is a part that is common to all pages. Its JS and CSS are the same and are imported in all pages, but the HTML is duplicated, which means it's extremely hard to maintain and update. And it became to messy. And it's not even the same, the docuement pages don't have the HTML directly in them, it's inserted from a JS file. 

So these are 3 examples of performance issues that I found and fixed, there are probably alot of other issues, too, some like the examples, others aren't.

## New Features

### Creating in MCP Server
* Open drafts in user content directly, not inside the create pages.

### Dictation for Essay Questions (Lesson & Quiz Pages)
Add dictation feature for essays in quizzes and lessons

### Notebook Page: 

#### Improvements
* Implement cursor animation similar to that of VS Code

#### MATLAB Runtime
* **Current Folder Improvements**:
  * Add a more menu (3 vertical dots).
  * Move the **Remove** and **Download** into it.
  * Add these: 
    * **Copy Name**: Copies the name of the item (with its extension).
    * **Rename**: Renames the item. Use the platform's `_prompt()` for it, its in `notifications.js`.
    * **Copy Image**: Copies the image to clipboard.
    * Recommend to me other functionalities to add.

#### C++ Runtime 
* There is no error handling while typing, if users forget a simple thing like a semi-column or something it doesn't get highlighted.
* When I write this in a cell: `cout << "Hello World\n";`, it doesn't return an error that I didn't write the `int main()` function or that I forgot to add `#include <iostream>` at the top, it runs whithout an error, and as usual, nothing shows up. I don't understand why, I need an explanation 

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

#### Redesign
Redesign the whole page:
* Journey style page with different scroll effects for each different sections.
* It should use its own CSS styling instead of importing from the main page or other pages.
* It sill should be resposive to the themes of the platform, even if new themes get added.
* It shouldn't use the shared animations, it should get its own animations.
* It lacks images or visual elements.

#### Suggestions
* Suggestion: Add an open-source Angle (Since the repo is currently open source).
* Suggestion: Add a short testimonial or review.

#### المنصة بالأرقام
1. **Better more Advanced analytics:** Allow the user to extend the `المشاهدات في آخر 30 يومًا` to cover more/less time, like a year or a week or custom.
2. **Rich Tooltips**: Give rich tooltips to:
   1. `مسار تعليمي نشط`: Shows the actual `Active learning paths`
   2. `صانع محتوى`: Shows the top admins/developers. 
      1. Suggestion (Not Confirmed): with a link to see all of them.

`مقرر دراسي`: Change it to: `مقرر دراسي (مادة)`

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
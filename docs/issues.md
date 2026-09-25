# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Redesign the sidebar and bottom nav
- The bottom nav on phones is missing the `create-lesson` link, I need a unique way to redesign it. I'll list 3 design roads, either implement on, or recommend a different one. To make the sidebar and bottom nav have the same set of links.
  1. Merge the create-quiz and create-lesson buttons in one button named (إنشاء), pressing that new button opens a small simple modal, that modal contains 2 links `create-quiz` and `create-lesson`.
  2. Merge the `.enty-screen` of create-quiz and create-lesson. So the sidebar and bottom nav will have a create button (إنشاء), and that button leads to a new `/create` page, which is the new and redesigned entry screen that contains the 2 merged entry screens.
  3. Just keep sidebar as it is, and add the `create-lesson` link to the bottom nav, but rearrange the links, since now the profile link isn't going to be centered.

Q: Based on what should you choose a way?
A: Based on the best UX. Not based on how easy it is to implement, because I have all the time, but based on the best User Experience.

### AI Agent

#### Fix
- The `.ai-agent-dictation-wave` has 2 issues
  - It covers the whole input, so users can't see the text as it being recognised.
  - When it gets activated, the `.ai-agent-chat-input-controls` grows in height slightly, which causes some elements to get misaligned.
- The `.ai-agent-chat-input` is too narrow, the width is dynamic but it defaults to smaller width than expected. Fix it. 

#### New
- The AI Agent modal should be self contained, meaning it shouldn't reuse other components like the exam dropdown and the `.modal-overlay` or any other thing, doing that makes it harder to integrate it in new pages that don't import/use these components + they weren't made for the agent anyways. It should have custom elements, and custom advanced dropdowns with actual icons.
- Implement a new modular actions feature:
  - The user can call an action by typing `/` in the input field.
  - A dropdown appears where the user can choose to make an action.
  - Actions are super dynamic, each page that uses the agent should have its own set of actions, or pages can have no actions at all.
  - Pages like create-lesson and create-quiz have their own set of actions each.
  - The home page for example should have its own set of actions like (create quiz, which creates quizzes in the "امتحاناتك" section), while creating quizzes on the lessons page, creates them in the page itself, or inside the section that the user asked about.
  - Mentioning an action using `/`, means the AI shouldn't verify it. If I mentioned an action using `/`, the AI shouldn't say (do you want me to do...), it should just do it.
  - I should be able to paste images inside the input field
  - The AI Agent should be for all normal users but, with a limit, it's currently available only for users who are above level 10. 

### Lessons Page

#### Changes
- The `/lesson/` page should have the lesson's info modal, and I want new ideas to give the user control over the lessons.
- The `الباشــمبصمج`: 
  - Users should be able to tell it to create questions about that lesson, and the الباشــمبصمج should be able to create an interactive quiz that users can actually solve and get graded (all types of questions) in the lessons page itself, this is different than creating quizzes in the "امتحاناتك" section. This should be full integration, with suggested prompts and it should get the full context of the lesson.
- Complete the implementation of the page:
  - Custom og meta
  - The sidebar and bottom nav.
  - Custom design for the page, because it's currently flat.
  - Add all missing elements like the `notifications.css` to the <head>.
  - Everything else, too.
- There is no way to reset the page (qustions stay locked after answer).
- Implement a lesson reader (read aloud) using the browser's api.
- `أسئلة الطلاب` section shouldn't appear for user-created lessons.

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
- Should match the theme mode stored in localStorage.

### `api\og.js`
- Special courses that get the (مادة مميزة) badge, since there is no info table displayed, the middle of the image becomes emtpy, I need to fill it with something, or make the content bigger.
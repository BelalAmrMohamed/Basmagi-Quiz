# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### AI Agent

#### Fix Dictation
The dictation feature is so messed up, it doesn't work on Brave browser, even though other websites I built worked fine on Brave Browser.

#### Bug Fixes
1. **`.ai-agent-dictation-wave` overlaps input text**
   - Currently covers the entire input field, hiding the text as it's being transcribed.
   - Fix: reposition/resize so the wave animation doesn't obscure in-progress text (e.g. constrain it to a small indicator area, or render it behind/beside the text rather than on top).
2. **`.ai-agent-dictation-wave` causes layout shift**
   - When activated, `.ai-agent-chat-input-controls` grows slightly in height, misaligning sibling elements.
   - Fix: reserve space for the wave state up front (e.g. fixed-height container or something) so activation doesn't change the controls' height.

I tried to fix the issues but couldn't, they are still the same. 

Files: `public\src\components\ai-agent\`

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

### Create-lesson Page
- Changing the value of `#lessonFontSelect` doesn't change anything.
- `.entry-item` is too tall, improve it's design. And I also want to improve the design of the whole `.entry-screen`, generate an ipmlementation plan suggesting any improvements. 

### Performance (Globally, but specially the main page)
Performance Improvements: Currently, there are many custom mechanism fucntionalities built in JS that works perfectly, but it may exist natively in HTML, CSS, or as a browser API. In that case we shouldn't reinvent the wheel, specially if it exists natively. Anything that exists natively in HTML, CSS, or as a browser API should be used that way and we should delete any custom JS implementation that has native alternatives. That would improve performance very well. Search for everything, anything that can be implemented in HTML & CSS directly without JS should be done so. You can search the web for modern HTML & CSS, because sometimes they add new things, but watch out for compatibility with different browsers (minimum requirenment: Chrome). But I don't want to miss up any functionality, this is just for performance, not to change any fucntionality.

Example: I lately found out that the `/quiz` page was rendering questions through the JS once, then when the user submits their answer, the JS renders the question again to add the explanation & formal answer, I removed it and depended fully on CSS & HTML, the whole question including explanation & formal answer is inserted at the first render, then I make things visible when the user submits the answer using CSS classes. That approach to get away from JS improved performance alot.  

## New Features

### AI Agent

#### New: Self-Contained Modal
The AI Agent modal currently reuses shared components (e.g. the exam dropdown, `.modal-overlay`) that weren't built for it. This creates tight coupling and makes it hard to drop the agent into new pages that don't already import those components.
**Requirement:** Rebuild the modal as fully self-contained:
- No dependency on shared/external components — custom overlay, custom modal shell, etc.
- Build custom dropdown components (with icon support) specific to the agent, replacing reused ones like the exam dropdown.
- Goal: the agent should be a drop-in feature for any page, with no prerequisite imports.

#### New: Modular Actions (Slash Commands)
Add a `/` command system to the agent input:
- Typing `/` in the input opens a dropdown of available actions.
- **Actions are page-specific and configurable per page:**
  - Each page defines its own action set (or none at all).
  - Example: `create-lesson` and `create-quiz` pages each have their own distinct actions.
  - Example: on the home page, a "Create Quiz" action creates the quiz inside the "امتحاناتك" (Your Exams) section. On a lesson page, the equivalent action creates the quiz within that page/lesson, or within whichever section the user specifies.
  - Needs an architecture that lets each page register its own action list without the agent core needing to know about all of them (plugin/registry pattern, TBD by implementation).
- **No confirmation step for slash actions:** if the user explicitly invokes an action via `/`, the AI executes it immediately — it should *not* ask for confirmation ("do you want me to...?"). Confirmation prompts are reserved for actions inferred from free-text/natural language, not explicit slash commands.
- **Image paste support:** users should be able to paste images directly into the input field (not just type text) and that image must appear as an attachment.

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
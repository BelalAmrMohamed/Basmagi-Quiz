# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches

### Performance (Globally, but specially the main page)
Performance Improvements: Currently, there are many custom mechanism fucntionalities built in JS that works perfectly, but it may exist natively in HTML, CSS, or as a browser API. In that case we shouldn't reinvent the wheel, specially if it exists natively. Anything that exists natively in HTML, CSS, or as a browser API should be used that way and we should delete any custom JS implementation that has native alternatives. That would improve performance very well. Search for everything, anything that can be implemented in HTML & CSS directly without JS should be done so. You can search the web for modern HTML & CSS, because sometimes they add new things, but watch out for compatibility with different browsers (minimum requirenment: Chrome). But I don't want to miss up any functionality, this is just for performance, not to change any fucntionality.

Example: I lately found out that the `/quiz` page was rendering questions through the JS once, then when the user submits their answer, the JS renders the question again to add the explanation & formal answer, I removed it and depended fully on CSS & HTML, the whole question including explanation & formal answer is inserted at the first render, then I make things visible when the user submits the answer using CSS classes. That approach to get away from JS improved performance alot.  

### Quiz Page
- On `vertical` mode, the `#menuNavContainer` doesn't go through the questions when the user scrolls through the page, so if the user scrolls from question 1 -> 4, the `#menuNavContainer` doesn't update.
- The page's loading skeleton animation isn't properly excluded from the "الاداء الفائق" `[data-motion="reduced"]` like the other pages are. See `public\src\styles\themes.css` for proper exclusion.

### `.create-quiz-inline-modal`
- Fix the `.copyAiPromptBtn` with its arrow in the `.create-quiz-inline-modal`, the arrow's animation is broken on "الأداء الفائق" mode (data-motion="reduced"), it should be properly excluded from that mode. See `public/src/styles/themes.css`. And the `.copyAiPromptBtn` button should be above inside the `.create-quiz-modal__header`, because it's small, and also to give space for the arrow on its right to move.
- Remove the "الإغلاق" button from the `.prompt-selection-modal`, and make it a normal `x` button at the top left of the modal.
- But before you do any of these 2, think with me what is the best way to implement this?
  - Should we keep things as they currently are? `.copyAiPromptBtn` on the `.create-quiz-inline-modal` that opens another modal just for 3 buttons?
  - Should we instead delete the whole `.copyAiPromptBtn` with the `.prompt-selection-modal` and put the 3 buttons directly on `.create-quiz-inline-modal`?
  - What do you think is the better approach?

### `.sidebar-brand-link`
- Put a better transition on it. Because when expanding/collapsing the `#sidebar`, it appears instantly while the `#sidebar` has a nice transition/animation. I tried solving this issue many times and tried many things, but no matter what transitions I put on `.sidebar-brand-link` or `.sidebar-brand-text`, nothing actually gets affected when expanding/collapsing the `#sidebar`

### AI Agent Icons At `901px`
- At `900px` screen width, the expand and collapse icons of the side-menu on the AI Agent are wrong, both `.ai-agent-sidebar-collapse-btn.ai-agent-mobile-sidebar-toggle` and `.ai-agent-sidebar-collapse-btn` show the same 2 icons (`SIDEBAR_COLLAPSE_DEFAULT_ICON_SVG` and `SIDEBAR_COLLAPSE_HOVER_ICON_SVG`). The icons are correct for when the assistant's sidebar is open, meaning they are correct for `.ai-agent-sidebar-collapse-btn` only, but `.ai-agent-sidebar-collapse-btn.ai-agent-mobile-sidebar-toggle` should show `SIDEBAR_EXPAND_ICON_SVG` when hovered, and this one normally: ``

*Note: The icons are correct at desktops, don't touch them their, just fix them on screens less than 901px in width*

## New Features

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
- Users should be able to resize media with the resize handles. I don't know why the fucking AI removed them. Implement it in the markdown engine itself so it works on the `/result`, `/create-quiz`, and `/quiz`.
  - Media appears with size that is already in the objects like `<img>`, it appears with handles that the user can use to resize the media himself.
  - Images / videos get 4 resize handles, one on each corner.
  - Audio get 2 handles, one on the right, other on the left, since its height doesn't change.
- Performance Improvements: Currently the markdown engine has a custom text-direction detection mechanism, which works perfectly, but recently I discovered that there is an HTML attribute `dir="auto"`, which does basically the same thing. So to improve performance, I want to do an overhaul of the engine, anything that exists natively in HTML, CSS, or as a browser API, should be used as it's, we shouldn't reinvent the wheel, specially if it exists natively. That would improve performance extremely well. But the only thing that I found that has a native alternative is the text-direction detection engine, my own search didn't find anything else, so I want you to search in that engine for anything that can be done natively in HTML or CSS and is being reinvented in JS, look for everything, you can search the web for modern CSS & HTML, because sometimes they add new things, but look for compatibility with browsers ofcourse (minimum requirenment: Chrome). But I don't want to miss up any functionality, this is just for performance, not to change any fucntionality.

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
- Performance: create-quiz.js is 5000+ lines in one file — This is a good candidate to split into modules.
- Add a button for converting all MCQ questions that have 1 correct option only that are set to checkboxes (multi correct options) to radio buttons (one correct options). This will save users from editing quizzes that have that issue, instead of going through each question one-by-one, opening the more menu, pressing the button that changes that, this new button will save so much time.
- The background animations doesn't work on the page, `themes.css` updated variabled used by elements to give them a bit of opacity, so the bg animations can appear through them, the create-quiz page might not be using them. 

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
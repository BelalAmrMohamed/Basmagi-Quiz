# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Broken Elements

### Courses & Folders OG Images
- Don't show the info correctly: 
  - ![Course with Arabic info not formatted well](image-7.png)
  - ![Folder with messed up Arabic](image-8.png)

### Move-To Dialog Guide Overhaul
- The `.move-to-dialog-guide` system to tell the users the folder structure is not perfect, because `.move-to-dialog-rail` aren't connected toghether (they are visually different pieces).
- Expected Design:
  - A dialog guide that visualize the structure similar to a context map of a project: ![./map/context-map.md](image-4.png)

### User experience improvements in quiz creation
- The “إنشاء اختبار” `create-quiz-inline-modal` flow currently creates quizzes directly under the main “امتحاناتك” section directly instead of the folder or course that I'm currently sitting inside.
  - So if I'm standing in `/#my-quizzes/math/algebra` and I create a quiz through that modal, it gets created inside of `/#my-quizzes` directly, not in `/#my-quizzes/math/algebra` as intended.

### Sign in title on Google Sign in.
- When user sign in using Google, they don't see the name or the logo of the platform, they see a sequence of charachters that seem to be related to the Supabase DB something. ![screenshot](image-5.png)
- Signing in doesn't work on localhost for somereason. ![alt text](image-6.png) See [last solution attempt with AI](unsolved-localhost-sign-in-issue--maybe-related-to-AOth-console-config-or-DB-config.md)

1. "Continue to esdfdzhtavraczrhxnmp.supabase.co" — this can't be fixed in code

Confirmed via Supabase's own docs/issue tracker: Google's OAuth consent screen always shows the domain of the OAuth callback URL, and with Supabase Auth that's always https://<project-ref>.supabase.co — there is no application-side setting that changes it. There are exactly two real fixes, both outside this codebase:

Google OAuth consent screen verification (free) — in Google Cloud Console → OAuth consent screen, set your app name/logo and go through Google's verification process. Once verified, Google shows your app name ("منصة امتحانات بصمجي") instead of the raw domain, even while the domain stays *.supabase.co underneath. Several teams in the Supabase community got this working for free this way.

### But a transition on the `.sidebar-brand-link` when opening/closing side-menu on desktops.


### AI Agnet Error 
- ![screenshot 1](image-1.png)
- ![screenshot 2](image-2.png)


Tested on localhost:
```
hook.js:1  POST http://localhost:8080/api/ai-agent/chat 502 (Bad Gateway)
apply @ hook.js:1
resendLastUserTurn @ ai-agent-chat.js:2231
resendLastUserTurn @ ai-agent-chat.js:2395
await in resendLastUserTurn
sendMessage @ ai-agent-chat.js:2455
(anonymous) @ ai-agent-chat.js:2472
ai-agent-chat.js:2257 [ai-agent-chat] /api/ai-agent/chat responded 502: {error: 'فشل الاتصال بمزوّد الذكاء الاصطناعي', detail: 'fetch failed'}detail: "fetch failed"error: "فشل الاتصال بمزوّد الذكاء الاصطناعي"[[Prototype]]: Object
resendLastUserTurn @ ai-agent-chat.js:2257
await in resendLastUserTurn
resendLastUserTurn @ ai-agent-chat.js:2395
await in resendLastUserTurn
sendMessage @ ai-agent-chat.js:2455
(anonymous) @ ai-agent-chat.js:2472
```

#### User Prompt
Makrdown rendering gets applied on the AI Agent Answer but not the user prompt. 

## New Features

### Search and navigation refinements (Home Page)
- The footer may sit too high and does not always remain pinned to the bottom of the page when the content area is short.
- The home page search icon and input placement need refinement.
- The search button should be aligned at the lower-right rather than upper-right.
- The search bar should appear within the header itself.
- When the search bar is visible, the header search button should be hidden to avoid duplication. And try to align the search input's search icon in place of the header search button.
- The search icon disappears when I enter a course that only has subfolders in its first level, this issue is probably due to the folders & courses not being actual objects in the DB, we may choose to solve this issue after we migrate the whole platform to be DB quizzes only, and give up on relative-path quizzes uploaded with the code.

### Admin actions and deletion flow (New Features)
- Admins should be able to delete folders and courses from the main quizzes area. Admin can currently delete quizzes.
- Deletion should not be immediate; a trash can or recovery workflow is needed for courses, folders and quizzes.
- Trash can or recovery workflow for the user-quizzes section `/@my-quizzes` first.
- The trash can should support recovery, configurable retention time, emptying, and permanent deletion.
- Deleting a quiz must remove all associated media files as well.
- Similar consideration should be given to the “امتحاناتك” section.
- So new trash can for main quizzes (shared), and new trash can for users “امتحاناتك” section.
- Admins should be able to Edit quizzes public quizzes, these needs a new button on quizzes, and create-quiz page update.
- Admins should be able to move folders and quizzes (similar to the امتحاناتك section)

### Meme videos on result pages (Easy to make, but very important)
- Add a result-page feature that displays themed meme videos based on the user’s degree or score.
- Suggested themes include:
  - دعوية
  - إسلامية
  - قرآن
  - ميمز تشجيع سلبية
  - ميمز تشجيع إيجابية

### Markdown engine enhancement
- Update the markdown engine to behave more like GitHub markdown rendering, with embeded media like vidoes, audio, and images.
- It should be implemented after implementing media inside the quiz body in the `quiz.html` page.
  - Because for some reason, the quiz page rerenders each time the user interacts with the quiz (presses a button), which reloads every videos, images, and audio. that's why media is currently out of the quiz body. We should fix that issue first, before migrating the media to be rendered through the markdown engine.
  - The `export-to-quiz.js` feature renders media inside the question body, and doesn't rerender the question after each interaction, so you can learn from it.
- After implementing this feature, migrate all quizzes to embed the media in the question body itself, and delete all legacy code related to the object media rendering, because now media will be in the question body itself.
- This will allow quiz creators to add multiple pieces of media to each question.
- Now all quizzes created from the home page (index.html), create-quiz.html, or through the AI Agent, should use images, audio, and vidoes using this way only. Users shouldn't be able to create Legacy YouTube, audio, images, and videos. 

### User upload flow
- Allow normal users to upload quizzes as a new feature.

### Translation and content expansion (Suggestion)
- Add English translation support.

### Home Page Improvements
- The side menu admin badge and favicon size should be improved visually.

### Quizzes Improvement (Suggestions)
- Number of Views or people who solved a quiz on each quiz.
- Detailed info: Instead of listing the questions types and question number (["Essay", "MCQ", "True/False"] [30]) we should count the number of each individual type, so we now the number of essays, the number of MCQs, and the number of True/False.
- Connect Password typing memory on the main page to the quiz page, so if the user had to type the password on the main page to download it, they don't have to type it again for the same quiz on the quiz.html page on the same visit.
- Allow users to switch view on the home page, when there is not a compulsory view.

### Home Page Loading
*Important Note: This update comes after converting the platform to have DB quizzes only. Before that, it depended on relative-path quizzes updated with the code, and a relative path manifest with logic to merge them with quizzes coming from the DB. Now the Platform depends on the DB only, with all legacy code deleted*

- امتحاناتك section should load independantly.
- Don't load the whole DB for the manifest, just the courses, then when the initial view loads (which is top view, which is courses only), start loading their subfolder in the background.
- When a course or folder is visited directly (e.g., `http://basmagi-quiz.vercel.app/course/Website-Demo/All-Features`) load only what is enough to show its elements, then when it loads, start loading everything else in the background. This would speed up loading time significantly.
- On localhost, sometimes the home page (index.html) takes too much time to load, the animation shimmer on the skeleton cards just keeps going, the cards never actually load, and I have to reload the whole page for it to work.

### App SEO and GEO 
- List all unlisted pages (document pages, and reports page)
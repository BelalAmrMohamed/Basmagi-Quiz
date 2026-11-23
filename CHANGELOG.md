# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## Contextual deep links on errors
- Error toasts link to the guide section that explains them; nothing extra is shown otherwise (`shared/guide-links.js`).
  - expired draft link (404) -> `/how-to-connect-mcp#s8` (FAQ);
  - failed MCP import / draft (server error, wrong kind, storage full) -> `/how-to-connect-mcp#faq-item-missing`, the new id on the "opened the link, can't find the item" FAQ entry; `doc-steps.js` opens a `<details>` targeted by the URL hash;
  - failed or partly failed upload in the admin wizard -> `/how-to-upload-content#s4` (verifying the upload). Session-expiry failures and network errors carry no link.
- Toasts with a guide link stay 25 s (`GUIDE_TOAST_SECONDS`) instead of the 5-10 s defaults, so they can be read in full.
- `tests/guide-links.test.js` checks that every link target exists in the generated guide pages.

## Docs discoverability
- Sidebar item «الأدلة والمساعدة» on every page that has the sidebar; docs links in the sign-in dialog, the admin upload wizard, the lesson editor help menu and the notebook creator.
- «محتواي»: the MCP URL with a copy button and a guide link now appears only inside the empty state (no content at all), via `connect-card.js`.
- One-time admin welcome toast after the first successful sign-in (`admin-welcome-toast.js`); `llms.txt` lists the guides and the MCP URL; MCP page video chapters restored for the new video.
- `showNotification` takes an optional 5th argument `{ action: { label, href } }`; the MCP import toast uses it once per browser.

## MCP docs: new video
- `how-to-connect-mcp`: embedded the new MCP video (`ysckQBfLFFw`), removed the "recorded before the update" note and the old chapter chips (timestamps belonged to the deleted video), bumped `updated`. Plan `docs/plans/documentation-pages.md` updated: new screenshots dropped, draft links save directly to «محتواي».

## Agent settings and attachment preview inside the window; summarize_youtube transcript fix
- Settings are a view INSIDE the agent window (back button, Esc, focus returns to the gear), redesigned in grouped sections: provider + own API key, system prompt, phone/Telegram access. Model and reasoning effort are no longer settings (they live in the chat's model bar; the storage keys are unchanged). The attachment preview opens inside the window too, with image, platform-item (quiz, lesson, notebook, YouTube, course, folder) and file layouts and an "open" action. Both use the new `openWindowLayer()` (`ai-agent-window.js`); the chat panel underneath is untouched, so a running reply keeps running.
- Fix: `summarize_youtube` always answered «الوصف فقط». The transcript is now read through the InnerTube player as the ANDROID, then IOS client (caption URLs without a web `pot` token), then the watch page; each caption URL is tried as json3, XML, srv3 and vtt. Failures are logged as one JSON line per call (`supabase functions logs youtube`) and `GET /api/youtube?action=transcript&id=VIDEO&debug=1` returns the per-step `debug` object (statuses, counts, byte lengths only).
- Deploy: `npm run build:edge`, then `supabase functions deploy youtube` (the Vercel app too, for the front-end). Check: `curl -s "https://<project-ref>.supabase.co/functions/v1/youtube?action=transcript&id=<VIDEO_ID_WITH_CAPTIONS>&debug=1"` (add the `apikey` header if the function enforces JWT). If `debug.steps` shows the `player` steps as `LOGIN_REQUIRED` or 403/429 from every source, YouTube is blocking the datacenter IP; the next step is an external transcript provider behind an env secret (not built).

## YouTube videos and playlists
- «فيديو يوتيوب» and «قائمة تشغيل» items in «محتواي»: search or paste a link, import preview, full-width 16:9 cards (duration / video-count badge, hover glyph, stacked bars for playlists), resizable player and playlist windows (snap, minimize, maximize, split with a description pane), per-device split width, local history.
- MCP: import links for videos and playlists, plus search over published items.
- Admin: YouTube videos and playlists are published through the normal upload wizard («رفع المجلد إلى المنصة» / «رفع إلى المنصة»), alone or inside a folder or course; the separate YouTube publish modal is gone. The wizard now uses icons instead of emoji. Deleting a course or folder also deletes its published YouTube items (not restorable from the trash).
- Course and folder OG thumbnails now include the الفيديوهات and قوائم التشغيل counts.
- Local dev: `npm run dev:vercel` loads `.env.local` itself (`dev:vercel:raw` is the old command). Missing Supabase variables now answer 503 naming the variable instead of crashing.
- Fix: the three YouTube admin actions are routed in `api/admin.js` (they fell through to the profile sync and answered "Nothing to sync").
- Deploy: apply `20261120120000_youtube_public_and_import_kinds.sql` and `20261120130000_youtube_public_placement.sql` (`supabase db push`), run `deno check` and deploy the `mcp` function (`supabase functions deploy mcp`), then deploy the Vercel app. Then check: create an MCP video import link, open it signed out; publish a video and a playlist as admin, list them, unpublish one.
- Published YouTube items now appear on course and folder pages (catalog reads `youtube_public`; folder cards count them). Deploy also `20261121100000_youtube_public_grants.sql`.
- The publish flow remembers the last destination (`bq-youtube-publish-last`) and opens on the review step.
- Not built: a per-video OG thumbnail / deep link.

## محتواي naming cleanup
- Renamed the `user-quizzes-*` / `user-quiz-*` modules, CSS classes and identifiers to `user-content-*` (and `copy-to-my-quizzes` to `copy-to-my-content`); «امتحاناتك» became «محتواي» in the UI. Storage keys and legacy routes are unchanged (see NOTES.md).
- Local محتواي items no longer show or expose a link; only published items do.

## Protected quizzes: questions locked server-side + rate-limited password checks
- Security: the questions of a password-protected quiz are no longer downloadable. Browsers can't read `quizzes.data` anymore; `quiz_public` returns only `meta` + `stats` for a protected quiz, and the questions come from the new `unlock_quiz(quiz_id, password)` RPC after the server verifies the password (same model as lessons). This closes the API read, copy-to-my-quizzes, "ask the assistant" and embedded-lesson-quiz bypasses.
- Security: password guessing is rate limited inside the database (`verify_quiz_password` / `unlock_quiz`): 8 wrong guesses per client per quiz per 10 minutes, and 150 per quiz overall per 10 minutes. The UI shows how long to wait.
- Protected quizzes now ask for the password wherever their questions are needed (quiz page, download, copy). The assistant attach, the Telegram bot and lesson embeds never read protected questions. The admin editor loads a quiz through the new `get-quiz` admin action.
- `api/render-quiz.js` and the OG image routes read `quiz_public` instead of `quizzes`.
- Deploy: apply `20261118120000_quiz_questions_private.sql` together with this release (the previous front-end still selects `quizzes.data`).

## AI agent deep link
- New shareable route `/ai-agent` (alias `/my-content/ai-agent`): opens «محتواي» with الباشــمبصمج already open and maximized. Maximizing the agent on «محتواي» now changes the address bar to `/ai-agent`; restoring, minimizing or closing puts the previous URL back.
- `api/render-ai-agent.js` serves these routes with the agent's own title, description and thumbnail (`ai-agent-thumbnail.png?v=3`) so shared links get a proper preview.

## C++ notebooks round 2
- Local compiler: gzip copies (about 19 MB instead of 60 MB) in `public/assets/wasm-clang/`, unpacked in the browser; the download no longer blocks the page (close the dialog, keep editing; the toolbar button shows progress) and the button shows a "warming up" state until the first run is instant.
- Pasting a whole program into an empty cell offers to split it into cells (header, prototypes, each function, main).
- "Run" on one cell now explains that a function defined in a later cell needs "Run all".
- Fixed page scroll jumping when running or adding cells (scroll position is kept by cell, never animated).
- Notebook download: C++ notebooks offer `.cpp` (not `.m`); new `.json` export with title, description, source, language, runtime and all cells. `.cpp` files with `//%%` separators import back as separate cells.
- Fixed `main` after a leading comment trapping at the end instead of returning 0.
- Image Tool (`imtool`): the window now opens sized to the image (100%; tiny images at the largest whole zoom up to 320 px so pixel values are readable; huge images shrunk to the screen) instead of a fixed 680x520, and is titled like MATLAB, `Image Tool 1 - I` (variable or file name; nothing for expressions). Saved/exported file names use that name too.
- Image Tool on phones: tapping or dragging a pixel keeps its info in the status bar after the finger lifts, with a yellow marker that follows pan and zoom.
- Image Tool: the per-figure remembered window size was removed (it fought with fit-to-image sizing). Needs `npm run build:runtimes` for the title to include the variable name.
- Image Tool toolbar: Zoom, Fit, 100%, Values and Info stay as flat buttons; View overlays, Export and Help moved into one `...` More menu. The menu floats above the page, so it is never clipped by a small window.
- Image Tool: click (or tap) a pixel to pin it. Its value stays in the status bar ("Pinned: ...") with a marker that follows pan and zoom; click it again to unpin.
- Image Tool: windows now snap to the edges of neighbouring windows (moving and resizing), not only the screen edges, so before/after images tile cleanly.
- Image Tool: minimized tabs show a thumbnail, the window number and the image name.

## [8.3.5] - 2026-11-07
### Changed
- Updated issues.md & notebook-editor.js.
- Updated issues.md, package.json, & notebook.html.

### Added
- Added a C++17 notebook runtime backed by the cpp-run Edge Function, with per-cell stdin and C++ notebook import/export.
- Notebook OG thumbnail (`/api/og?notebook=`) and server-rendered `/notebook/:id` meta tags.
- `tests/og-render.test.js`, `npm run og:test`, `npm run og:snapshot`.
### Changed
- Course/folder OG image: counts in the table, course info + Featured badge under it; SVG icons instead of emoji.
- `api/og.js` split into `api/_og/*` modules; shared card blocks; self-hosted Tajawal (`public/assets/fonts`).
- OG versions centralised in `api/_og/version.js` with content stamps; course page cache shortened.
### Fixed
- `seo.js` built quiz OG URLs as `?type=quiz&id=` (unsupported); now `?quizId=`.
- OG render failures redirect to a static thumbnail instead of a 500.

---

## [8.3.4] - 2026-09-16
### Changed
- Updated ackage.json
- Updated issues.md, naming-rule-audit-handoff-prompt.md, side-menu.css, category-view.js, copy-to-my-quizzes.js, exam-dropdown-menu.js, index.css, root-view.js, user-quizzes-folders.js, quiz.css, themes.css, & commit.js. Deleted amtihanatak-naming-rule-audit.md & content-rules.md. Added git-changes.js & release.js.
- Updated PROJECT_STRUCTURE.md, issues.md, & ai-agent-on-quiz-page-prompt.md.
- Updated CHANGELOG.md, _itemActions.js, admin.js, issues.md, package-lock.json, package.json, privacy-policy.html, service-worker.js, create-quiz.js, quiz-file-import.js, user-quizzes-view.js, console-core.js, & terms-of-service.html. Deleted amtihanatak-naming-rule-audit.md. Added amtihanatak-naming-rule-audit.md, content-rules.md, & naming-rule-audit-handoff-prompt.md.
- Added amtihanatak-naming-rule-audit.md.
- Updated quiz.css.
- Updated issues.md, create-quiz.html, index.html, profile.html, quiz.html, reports.html, result.html, settings.html, side-menu.css, documents-shell.js, & quiz.css.
- Updated og.js.
- Updated create-quiz.html, index.html, profile.html, quiz.html, reports.html, result.html, settings.html, ai-agent.css, side-menu.css, documents-shell.js, quiz.css, & themes.css.
- Updated issues.md, create-quiz.html, index.html, profile.html, quiz.html, reports.html, result.html, settings.html, side-menu.css, control.css, create-quiz.css, about.css, documents-shell.js, index.css, profile.css, quiz.css, settings.css, & themes.css.
- Updated issues.md, settings.html, index.css, root-view.js, settings.css, & settings.js.
- Updated PROJECT_STRUCTURE.md, issues.md, create-quiz.html, index.html, profile.html, reports.html, result.html, settings.html, side-menu.css, documents-shell.js, & navRoleBadge.js.
- Updated issues.md.
- Updated create-quiz.html, index.html, profile.html, reports.html, result.html, settings.html, ai-agent.css, side-menu.css, exam-dropdown-menu.css, index.css, profile.css, & navRoleBadge.js.
- Updated issues.md. Deleted image-1.png, image-2.png, image-5.png, image.png, & unsolved-localhost-sign-in-issue--maybe-related-to-AOth-console-config-or-DB-config.md.
- Updated PROJECT_STRUCTURE.md, ai-agent.css, side-menu.css, control.css, create-quiz.css, about.css, index.css, profile.css, quiz.css, & result.css.
- Updated PROJECT_STRUCTURE.md, create-quiz.html, index.html, profile.html, result.html, settings.html, side-menu.css, side-menu.js, profile.css, profile.js, quiz.css, quiz.js, & avatarEngine.js. Added menu-icon-draw.js & navRoleBadge.js.
- Updated issues.md & profile.css.
- Updated PROJECT_STRUCTURE.md, render-profile.js, issues.md, profile.html, profile.css, profile.js, & profileWidgets.js.
- Updated PROJECT_STRUCTURE.md, issues.md, profile.css, & profile.js. Added image-2.png.
- Updated PROJECT_STRUCTURE.md, issues.md, side-menu.css, profile.css, profile.js, & profileWidgets.js.
- Updated PROJECT_STRUCTURE.md, admin.js, issues.md, profile.html, leaderboardIdentity.js, profile.css, profile.js, & profileWidgets.js.
- Updated issues.md, package-lock.json, package.json, control.html, create-quiz.html, index.html, offline.html, onboarding.html, privacy-policy.html, profile.html, reports.html, result.html, service-worker.js, settings.html, sign-in.js, side-menu.css, side-menu.js, create-quiz.css, documents-shell.js, index-entrypoint.js, index.css, sign-in.js, profile.css, profile.js, console-core.js, & terms-of-service.html.
- Fixed Broken admins profiles
- Updated PROJECT_STRUCTURE.md.
- Updated issues.md. Deleted SEO-GEO-plan.md. Added NOTES.md.
- Updated _catalog.js, seo.js, & SEO-GEO-plan.md.
- Updated _catalog.js, seo.js, SEO-GEO-plan.md, llms.txt, & seo-check.mjs.
- Updated issues.md, package.json, & result.html. Added seo-check.mjs.
- Updated _courseFolders.js, admin.js, college-quiz.js, render-course.js, render-profile.js, render-quiz.js, seo.js, upload-folder.js, upload-quiz.js, issues.md, sitemap.xml, & vercel.json. Deleted Claude-SEO-GEO plan implementation adjustments-20260914-1621.md. Added llms.txt & sitemap-static.xml.
- Updated PROJECT_STRUCTURE.md. Deleted reports.js.
- Updated offline.html.
- Fixed old-style links. Added seo.js and other /api routs. Still didn't delete old /api routes that got merged.
- Updated issues.md. Added Claude-SEO-GEO plan implementation adjustments-20260914-1621.md.
- Added SEO-GEO-plan.md.
- Updated issues.md. Deleted basmagi_quiz_backup_pre_media_migration.json.
- Updated issues.md & landing-screen.js.
- Updated issues.md & commit.js.
- Updated commit.js.
- Updated create-quiz.js, exam-card.js, user-quiz-card.js, user-quizzes-folders.js, & vercel.json.
- Updated PROJECT_STRUCTURE.md & issues.md.
- Updated render-profile.js, issues.md, package-lock.json, package.json, manifest.json, quiz.html, sitemap.xml, download-password.js, quiz.css, quiz.js, & vercel.json. Added commit.js.
- Updated issues.md
- Updated quiz.js
- Removed legacy image, video, audio object logic
- Updated create-quiz
- Updated create-quizjs and others
- Updated docs
- Updated ai-prompts.js
- Updated markdown-media-migration-plan.md
- Updated create-quiz.js
- Deleted file
- Fixed Create-Quiz Page
- Partial Markdown Engine Enhancements #3
- Documented create-quiz page failure, not yet resolved
- Partial Markdown Engine Enhancements #2
- Partial Markdown Engine Enhancements
- Fixed search
- .
- Partially fixed search for the الله اعلم times
- updated search.css
- Partially fixed search
- Updated search.css
- Fixed search partially
- Updated side-menu
- Updated docs/issues.md
- Updated AI Agent favicon. Now size matched when side-bar expands/minimizes
- updated home page search
- Updated search

## [8.3.3] - 2026-9-16

### Fixed امتحاناتك naming-rule gaps
Audited every path that can create/rename/move/copy a quiz, folder, or course against the existing rule ("no 2 elements of the same type and the same name at the same level") — see [docs/amtihanatak-naming-rule-audit.md](docs/amtihanatak-naming-rule-audit.md) for the full trace. Found 7 paths that skipped the guard other paths already used, plus one closely-related twin gap found while fixing them:

**Local "امتحاناتك" (`user_quizzes`)** — all now route through the existing `hasSameLevelCollision()`:
- JSON file import (`quiz-file-import.js`) no longer silently creates duplicate root-level quizzes; colliding files are skipped with a warning listing which ones.
- The quiz editor's "save new quiz" and "update existing quiz" paths (`create-quiz.js`) now reject a same-level title collision instead of saving over it.
- The quiz editor's own rename button (`window.renameEntryItem`, a second implementation separate from the home page's `renameItem()`) now checks the same rule.
- The AI Helper's `edit_quiz` tool call now checks the rule when the model actually changes a quiz's title, matching what the human rename path already enforced.

**Shared/Supabase-backed quizzes** — folders and courses already had DB uniqueness constraints backing this rule; quizzes didn't, so a new `hasQuizNameCollision()` helper (`api/_itemActions.js`) does the equivalent app-level check, scoped to `course_id`/`folder_id`:
- Renaming a shared quiz (`action=rename-item`) now rejects a same-level duplicate title.
- Editing a shared quiz's title (`action=update-quiz`) now rejects a same-level duplicate title.
- Moving a shared quiz into a folder/course that already holds a same-titled quiz (`action=move-item`) is now blocked, matching the behavior folders already had via their DB constraint.

## [8.3.1] - 2026-9-9

### Updated og.js

## [8.2.8] - 2026-9-9

### Updated og.js

## [8.2.7] - 2026-9-9

### Updated og.js

## [8.2.6] - 2026-9-9

### Updated og.js

## [8.2.5] - 2026-9-9

### Updated og.js

## [8.2.4] - 2026-9-9

### Updated og.js

## [8.2.3] - 2026-9-9

### Fixed Og Images for folders and courses

## [8.2.2] - 2026-9-8

### Fixed Production Home-Page Freeze (Endless Skeleton)
- **Root cause**: the Supabase project API was unreachable (Cloudflare `522: Connection timed out`; Supabase status reported "Partially Degraded Service"). The home page fired its manifest queries with no timeout, so when Supabase hung instead of erroring, `getManifest()` never settled and the skeleton spinner spun forever.
- `quizManifest.js`: wrapped the three Supabase manifest queries (`quizzes`/`courses`/`folders`) in a 15-second timeout — a hung request now fails fast instead of wedging the page.
- `navigation.js`: a manifest load failure now sets the category tree to `null` (reserved `{}` for a genuinely empty catalog) and adds `retryLoadManifest()` so the page can retry without a full reload.
- `root-view.js`: `renderRootCategories()` detects the `null` tree and shows a clear "تعذّر تحميل المحتوى" error state with **إعادة المحاولة** + **تحديث الصفحة** buttons instead of the misleading "لا توجد مواد متاحة حالياً" empty state or the perpetual skeleton.
- **Last-good snapshot fallback**: `quizManifest.js` now persists the last successful catalog load (slimmed metadata only — never full quiz bodies, and capped well under localStorage's quota) and serves it when Supabase is unreachable, so returning users still see their courses during an outage instead of an error. A snapshot-aware fast timeout (~5 s) means the fallback kicks in quickly, and a healthy load always refreshes the snapshot. When serving from cache, the home page shows a "وضع عدم الاتصال" toast.
- `index-entrypoint.js`: expected auth-refresh rejections during a Supabase outage ("Failed to fetch" from supabase-js's auto-refresh of a stored session) are now logged as a single concise warning instead of a full stack trace.

## [8.2.1] - 2026-9-7

### Updated OG Images
- Folders and Courses get custom URLs now.

### Changed URLs
- `/quiz/` for quizzes and `/course/` for courses

### Updated the امتحاناتك section
- Copying rules and more 

## [2.1.0] - 2026-02-11

### 🌍 Localization
- **Major change**: Transitioned the entire platform interface to Arabic Language.
- Full RTL (Right-to-Left) support across all pages (Dashboard, Quiz Player, Summary).
- Localized PWA manifest and shortcuts for an Arabic-first native experience.
- Improved accessibility with Arabic-optimized typography.

### 📁 Custom Quiz Management
- Added "امتحاناتك" (Your Quizzes) dedicated card/folder on the main dashboard.
- Implemented quiz backup/download functionality for user-created content.

### 📤 Advanced Exports
- Added support for Microsoft PowerPoint (PPTX) exports with simulated transitions.
- Added support for Microsoft Word (DOCX) exports with professional formatting.
- Fixed image embedding issues in PDF, Markdown, and HTML exports.

### 🛠️ Creator Tools
- Overhauled `create-quiz` page with improved state persistence.
- Refined quiz creation workflow and error handling.

### 🎨 UI/UX Improvements
- Redesigned side menu for better mobile responsiveness and aesthetic.
- Implemented high-octane notification system in the quiz player.
- Updated FTUE (First-Time User Experience) wizard for localized onboarding.

### 🔧 Bug Fixes & Stability
- Resolved memory leaks in quiz timers.
- Fixed synchronization issues for bookmarks and streaks across sessions.
- Optimized service worker caching for Arabic assets.

---

## [2.0.0] - 2025-01-23

### 🎮 Gamification System

#### Added
- Complete point-based progression system with dynamic leveling algorithm
- 40+ achievement badges with diverse unlock criteria (completion, performance, speed, streaks)
- Daily streak tracking with consecutive day monitoring
- Leaderboard system for competitive learning
- Performance-based point multipliers (perfect score +30%, speed bonus +50pts, timed mode +20%)
- Level system with 30+ tiers from Beginner to Grandmaster
- `gameEngine.js` module managing all gamification logic
- Streak bonuses (+15% for 3+ day streaks)
- Consecutive perfect score tracking
- Badge categories: Starter, Completion, Performance, Speed, Streak, Points, Bookmarks, Categories, and Special Achievements

### 📊 Dashboard & Analytics

#### Added
- Comprehensive dashboard page with tabbed navigation
- Quiz history display with chronological order and detailed statistics
- Bookmarked questions section with quick access across all exams
- Badge collection showcase with visual icons and descriptions
- Performance analytics per category (attempts, best scores)
- Level progress visualization with XP bar
- Total points and current rank display
- Recent activity timeline
- Locked vs unlocked badge indicators

### 📥 Export & Sharing Capabilities

#### Added
- PDF export functionality with professional formatting
- Markdown (.md) export for documentation and note-taking
- Static HTML page export with syntax highlighting
- Interactive quiz export (.html) - fully functional standalone quizzes
- Export from main page (clean quiz without answers)
- Export from summary page (includes user answers and results)
- Download options menu with file format selection
- Auto-generated filenames based on quiz title
- Print-optimized layouts for PDF exports

### 🎨 Visual & UX Enhancements

#### Added
- 3 premium theme options: Light, Dark, and Dark Slate
- Theme selector in settings with instant preview
- Theme persistence across sessions via localStorage
- Animated gradient backgrounds (subtle, non-distracting)
- CSS animations for smooth transitions
- In-app notification system on summary page
- Achievement unlock animations
- Level-up celebration effects
- Improved card-based layout design
- Enhanced color schemes for better readability
- Micro-interactions on buttons and interactive elements
- Loading states and skeleton screens
- Toast notifications for user actions

#### Improved
- Mobile responsiveness across all pages
- Touch-friendly interface elements
- Accessibility with proper ARIA labels
- Contrast ratios for WCAG compliance
- Font sizing and readability

### 📱 Progressive Web App (PWA)

#### Added
- Full PWA support with service worker implementation
- App manifest with multiple icon sizes
- "Install App" button on main page header
- Offline functionality for cached quizzes
- Add to home screen capability
- Splash screen configuration
- App-like navigation without browser UI
- Fast, reliable performance with caching strategies
- Background sync for future features

### 🎓 Multi-Faculty Support System

#### Added
- User profile setup wizard (first-time users)
- Faculty selection with predefined options
- Academic year configuration (1st, 2nd, 3rd, 4th year)
- Term/semester selection (Term 1, Term 2)
- Student name personalization
- Dynamic course loading based on profile
- Custom course management (add/remove courses)
- Cross-faculty content support
- Profile editing capability
- Profile persistence in localStorage
- Automatic quiz filtering based on profile

### 📁 Architecture & Performance

#### Added
- Nested subdirectory support up to 5 levels deep
- Exam module caching system with LRU eviction strategy (max 10 modules)
- Debounced navigation rendering (100ms delay)
- Debounced state saving (300ms delay)
- DocumentFragment-based DOM updates for better performance
- Smart module preloading
- Lazy loading for quiz content
- Optimized localStorage read/write operations (reduced by 80%)
- Memory management for long quiz sessions

#### Changed
- Migrated hosting from GitHub Pages to Vercel
- New production URL: https://divquizzes.vercel.app
- Improved build and deployment pipeline
- Enhanced error boundaries and crash recovery

#### Improved
- Load time reduction of up to 70% with caching
- Smoother animations with requestAnimationFrame
- Reduced bundle size through code splitting
- Better memory usage in list/grid view rendering

### 🐛 Bug Fixes

#### Fixed
- Critical crash when `user.streaks` object is undefined during quiz submission
- TypeError: Cannot read properties of undefined (reading 'lastLoginDate')
- Auto-submit countdown timer removed for instant user experience
- Bookmark synchronization issues across multiple sessions
- Flag persistence problems after page refresh
- Progress bar calculation errors for essay-type questions
- Timer interval memory leaks during rapid navigation
- State save conflicts between debounced and immediate saves
- Incorrect percentage calculation when essay questions present
- Double-counting of badges in some edge cases
- LocalStorage quota exceeded errors with large histories

#### Improved
- Error handling in `gameEngine.js` for missing data structures
- Initialization sequence to prevent undefined object access
- State recovery logic for corrupted localStorage data
- Validation for user input in essay questions

### 🔧 Technical Improvements

#### Added
- Comprehensive JSDoc comments throughout codebase
- Input validation and sanitization
- HTML escaping for user-generated content (XSS prevention)
- Try-catch blocks for critical operations
- Graceful degradation for unsupported browsers
- Console logging for debugging (development mode only)

#### Improved
- Code organization with clear separation of concerns
- ES6 module structure for better maintainability
- Variable naming conventions for consistency
- Function documentation and type hints
- Error messages for user-friendly feedback

### 📚 Documentation

#### Added
- Comprehensive README with feature overview
- Installation instructions for local development
- Contribution guidelines
- Code of Conduct
- Detailed CHANGELOG
- Inline code comments for complex logic
- API documentation for gameEngine
- Quiz format specification guide

---

## [1.0.0] - 2024-XX-XX

### Added
- Initial release of the quiz application
- Full implementation of quiz logic and state management
- Multiple-choice question support (2-4 options)
- 40 curated HTML fundamental questions
- State persistence using localStorage
- Progress tracking (answered questions, score, time)
- Intuitive single-question view with navigation
- Dynamic progress bar and real-time timer
- Summary page with detailed results breakdown
- Modular architecture with ES6 modules
- Responsive design for all devices
- Question review mode showing correct/wrong answers
- Retry mechanism for individual questions
- "Finish Quiz" button with completion validation
- Animated feedback for user interactions

### Technical
- ES6 JavaScript with module imports
- Vanilla CSS with gradient aesthetics
- LocalStorage for client-side persistence
- Semantic HTML5 structure
- Mobile-first responsive design

---

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/belalamrmohamed/Quiz.git
cd Quiz

# No dependencies to install - pure vanilla JavaScript!
```

### Local Development

Option 1: Using Python
```bash
python -m http.server 8000
# Open http://localhost:8000
```

Option 2: Using Node.js
```bash
npx http-server
# Open http://localhost:8080
```

Option 3: Using VS Code Live Server
- Install "Live Server" extension
- Right-click `index.html` → "Open with Live Server"

### Production Deployment

The project is automatically deployed to Vercel on every push to the main branch.

**Live URL:** https://divquizzes.vercel.app

---

## Upgrade Guide

### From v1.0.0 to v2.0.0

#### For End Users
1. Your quiz history will be automatically migrated
2. Bookmarked questions remain accessible
3. New gamification features start fresh - complete a quiz to initialize
4. Set up your profile on first launch of v2.0.0
5. Choose your preferred theme in settings

#### For Developers/Contributors

**Breaking Changes:**
- None! v2.0.0 is fully backward compatible

**New Features to Integrate:**
1. Update `examManifest.js` for nested directory support:
```javascript
{
  id: "unique-id",
  path: "./Exams/Faculty/Year/Term/Course/Quiz.js",
  title: "Quiz Title",
  category: "Course Name",
  faculty: "Engineering", // NEW
  year: 1, // NEW
  term: 1  // NEW
}
```

2. Optional question enhancements:
```javascript
{
  q: "Question text",
  options: ["Option 1", "Option 2"],
  correct: 0,
  explanation: "Detailed explanation", // NEW - recommended
  difficulty: "medium", // NEW - optional
  tags: ["tag1", "tag2"] // NEW - optional
}
```

**Recommended Updates:**
- Add explanations to all questions for better learning
- Organize quizzes in faculty/year/term structure
- Test PWA installation on your local setup

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Contribution Guide
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/NewFeature`)
3. Make your changes with clear commit messages
4. Test thoroughly on multiple browsers
5. Submit a Pull Request with description

### Areas We Need Help
- 📝 Additional quiz content for various subjects
- 🌍 Translations for internationalization (i18n)
- 🎨 UI/UX design improvements
- ⚡ Performance optimizations
- 🐛 Bug reports with reproducible steps
- 📚 Documentation improvements

---

## Support

- **Bug Reports:** [GitHub Issues](https://github.com/belalamrmohamed/Quiz/issues)
- **Feature Requests:** [GitHub Discussions](https://github.com/belalamrmohamed/Quiz/discussions)
- **Questions:** Open a discussion thread

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Happy Learning! 🎓✨**
## Lesson page revamp follow-up

- Added local lesson-section bookmarks with add/remove, an in-page bookmark list, and smooth navigation back to saved sections.
- Bookmarks are scoped by lesson ID and stored locally; they work for database-backed and session/user-created lessons without adding backend storage.
- Added focus-visible section navigation styling and reduced-motion handling for lesson interactions.
- Verified JavaScript syntax across all `public` and `api` JavaScript/MJS files with `node --check`.

## Round 3
- Admins now get "رفع لقاعدة البيانات" on local notebook cards (⋮ menu) and notebooks can be bulk-uploaded with other items.
- Markdown cells in RTL notebooks use one direction for the whole cell (headings, lists, tables align with the paragraphs); math/code stay LTR, display math centered.
- Fix: uploading a folder or course that contains YouTube items no longer fails with "questions array must not be empty" (`api/upload-quiz.js` publishes them to `youtube_public`).
- Published YouTube cards have a ⋮ menu: «نسخ إلى محتواي», «اسأل الباشــمبصمج» (title, description, channel, publish date), and for admins «إدارة» → نقل / حذف (`move-item` accepts the new `youtube` type).

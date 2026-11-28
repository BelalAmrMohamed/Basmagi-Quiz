# Project Issues and Follow-up Work

## What is this file
`docs/issues.md` is were I draft my notes/ideas on updated that I'm currently doing, or things I found while testing the pages. These are mostly either fixes or new features ideas. These are drafts that changes constantly, not actual plans that are ready to be implemented. 

Issues in here have to be studies and tested well, then turned into a plan, before actually implementing it.

## Patches 

## New Features

### Replace the "تغيير الإسم" button in the `#sideMenuProfileDropdown`
Replace the "تغيير الإسم" button in the `#sideMenuProfileDropdown` with a pen icon next to the name itself (i.e., `#sideMenuDropdownName`) that does the same thing.


### Admin Sign-In: Multi-Device & Multi-Account Support
- **Multi-Device Sessions (Important):** Allow the same Admin/Developer email to remain signed in across multiple devices simultaneously without session conflicts or forced logouts. Ensure sessions/tokens are tracked per device so logging in on one doesn't invalidate another.
- **Multi-Account Switcher (Multiple Emails):** Allow Admins to sign in with multiple emails in the same browser and switch between them seamlessly in the profile UI.
  - **Verification:** Each added account must independently pass full authentication and Admin/Developer role verification (on sign-in and switch).
  - **State Isolation:** Ensure switching accounts cleanly updates the active session token, invalidates stale cached data, and scopes local state per user so requests and UI always match the active account.

### Admin Dashboard & Develpers Dashaboard
* Admins & Developers can also see `/reports` to solve reports.
* Admins need their own control page, too, separate from that of the developers:
  * Admins should be able to see the trash that is related to their scope only: Admins with `المرحلة الجامعية` as a scope only see trash related to it. Developers keep seeing all.
  * "إرسال إعلان للمشرفين": In admins of a specific scope can send a notification to the other admins in the same scope.

### Result Pages

#### Videos (Easy to make and are an intersting idea)
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
* Natural Scrolling smoothness, don't make it too smooth like how typical AI-made scroll effects look. See standards, or search.
* It should use its own CSS styling instead of importing from the main page or other pages.
* It sill should be resposive to the themes of the platform, even if new themes get added.
* It shouldn't use the shared animations, it should get its own animations (or no animations).
* It lacks images or visual elements. Tell me what you need to add.

#### Suggestions
* Add a short testimonial or review.
* **Make all the docs measurable.** We already have an analytics beacon, so add one event for "copied MCP URL" and one for "opened My Content from a draft link". That tells us whether people finish setup. A "Was this helpful?" thumbs row per section would also show which steps confuse people.

#### Measure what works. 

We already have cookieless analytics. Tagging the entry points (sidebar, sign-in, upload wizard, toast, empty state) with a ?from= value would show which one actually brings people to the guides. Then you can drop the ones nobody uses instead of guessing.

### Connect Canva
Think of a new way to download quizzes and lessons, maybe through canva.

### Download Lessons as Video (MCP Server Export)
[plan](plans/lesson-video-export-plan.md).
* Claude sometimes gets confused and doesn't know how to install Manim to render the code, so tell it context on how to do it. Or maybe Manim isn't even the best way to make videos, maybe chromium is.
* Test the VO That can be downloaded in the Claude Sandbox.

*The plan has been delayed until we implement this plan first: [Proper Voice-Over](plans/advanced-read-aloud.md). Because it's going to be reused for the videos' VO, too.*

### Translation and content expansion (Suggestion)
* Native English translation support with native LTR pages.

## Suggestions

### Public profile for all users
* Public profile for all users, so all users get a public `/@userName` instead of a localOnly `/profile`.
* That profile would be public for everyone.
* The local `المتصدرين` leaderboard (i.e., `#localLeaderboardCard`) will be replaced with a real leaderboard: Shows the top 10 students.
* Sync is really bad between admins' profile and their localStorage.

### YouTube Update: Recommendations (not requested; propose, do not build without a go-ahead)

2. **Admin «نقل» for several items** and the bulk bar for published items. Today move and delete are per item. The bulk bar exists only for «محتواي».
3. **Rename and edit description for a published item** (admin): `rename-item` and `update-item-metadata` could accept the `youtube` type like `move-item` now does. Titles from YouTube are sometimes bad for a course page.
4. **Refresh metadata.** Titles, descriptions and thumbnails change on YouTube, and videos become private or deleted. An admin action (and maybe a scheduled job) to re-fetch and flag unavailable items, plus a graceful "unavailable video" state in the player window instead of a blank iframe.
5. **Watch progress.** Remember the playback position and mark watched videos per device (a thin localStorage layer), show a progress bar on the card thumbnail, and a "continue" state for playlists. The history helper `local-youtube-history.js` is a base.
6. **Playlist window quality of life:** next/previous and autoplay, a "currently playing" highlight in the list, search inside long lists (up to 200 items), and remembering the last played item.
7. **Player window:** playback speed and picture-in-picture are already in the YouTube iframe UI, but keyboard shortcuts for the window itself (Esc to minimize, F to maximize) and a visible focus trap/return-focus on close would help accessibility.
8. **Accessibility pass** on cards and windows: roles, `aria-label`s in Arabic, focus order, and contrast of the badge on bright thumbnails.
9. **Upload wizard polish:** show a thumbnail and a type icon for each YouTube row in the review tree, warn about a duplicate before upload (the server already answers 23505), and show per-item results for YouTube in the final step. And make all loading animations excluded from the High Performance Mode, see `themes.css` to see how to do that.
10. **Quota and performance:** cache `channels.list` and `videos.list` results, batch ids, and lazy-load card images. Consider moving published playlist `items` out of the catalog fetch (already lazy) and paginating long lists.
11. **Tests worth adding:** copy-tree with YouTube (§1.5), the embed/link builders (§2), the window snap math, the attachment kind mapping (§1.3), and the admin `move-item` with the `youtube` type (extend `admin-action-routing`).
12. **Code health:** the two copies of `youtube-mcp-model.js` (`public/src/shared/` and `scripts/lib/`) can drift. Add a test that fails when they differ, or generate one from the other in the build.

### Concentrate on gamefied experience and reward scheduele

### Admin & Developer Suggestions
1. "إفراغ السلة" for scoped admins. It permanently deletes everything in their scopes, including items other admins deleted. Consider letting scoped admins purge only their own deletions, or requiring a developer for the rest.
2. Announcement guardrails. The scoped send loops one database call per recipient, with no cooldown and no history. Add a per-admin rate limit and a small sent-announcements log. Better still, do the send as a single SQL function like broadcast_admin_notification.
Audit log. Record who restored or purged trash, added or removed an admin, or changed scopes. Today only deleted_by on trash items is tracked.
3. Trash usability. Search, multi-select restore, the deleter's name and the scope on each card, and a warning when an item is close to expiring.
4. Scope stats on /admin. Counts of content items and open reports per scope, if reports can be tied to a scope.
Last-active time on the developer's admins list.
5. Storage panel. It's developer-only now, which is right because it deletes unused files across the whole platform. It could use a per-scope usage breakdown.
# YouTube Videos — implementation plan

> Handoff: this document is the source of truth for the next conversation. Start from `basmagi.zip` and apply the patch stack in §1.1 in order. Do not restart from the ZIP alone.

## 1. Status

### 1.1 Patch stack (apply in order with `git apply --ignore-whitespace`)

1. `youtube-videos-phase-1.patch`: shared rules, server proxy, import modal and in-app player, personal `youtube_video` entries, `/my-content` integration, tests.
2. `youtube-videos-phase-1-fix-1.patch`: modal fixes (stale requests after a tab switch, pasted links in search, real HTTP status in errors).
3. `youtube-videos-phase-1-fix-2.patch`: `supabase/config.toml` gets `verify_jwt = false` for `youtube`.
4. `youtube-videos-phase-1-fix-3.patch`: `env-shim.ts` guards `process.env` writes; the handler falls back to `Deno.env` for the key.
5. `youtube-videos-plan-update.patch`: this document.
6. `youtube-videos-phase-a.patch`: Phase A (UI fixes, §2.1–§2.5).
7. `youtube-videos-phase-b.patch`: Phase B (playlist object, card, window, whole-playlist import).
8. `youtube-videos-phase-c.patch`: Phase C (import log, history tab) and this status update.
9. `youtube-videos-phase-d1.patch`: shared import module `youtube-library.js`; agent tools `search_youtube`, `list_youtube`, `add_youtube`.
10. `youtube-videos-phase-e.patch`: MCP tools (`create_youtube_import_link`, `search_youtube_published`, `get_youtube_published`, `list_recent_youtube_published`); `import_drafts` kinds; `youtube_public` table; browser draft builders; shared `youtube-mcp-model.js`.
11. `youtube-videos-phase-f.patch`: placement columns for `youtube_public`; admin API actions `publish-youtube`, `list-youtube-public`, `unpublish-youtube`.
12. `fix-auth-env-guard.patch` (optional, independent): sign-in returns a readable 503 naming missing variables instead of crashing `vercel dev`. Not applied by the owner yet; see §9.1.

### 1.2 Done

- Shared rules in `public/src/shared/youtube-rules.js`, copied to `scripts/lib/youtube-rules.js`. A test keeps the copies identical.
- Server proxy in `supabase/functions/youtube/handler.js`. `scripts/build-edge-functions.mjs` (target `youtube`) bundles it into `index.ts`. Deployed to Supabase with `--no-verify-jwt`. Secret `YOUTUBE_DATA_API_KEY` is set. Actions: `search`, `video`, `playlist`.
- `vercel.json` rewrites `/api/youtube` to the Supabase function. No Vercel serverless function was added; `api/` is unchanged.
- Import modal `youtube-video-modal.js` (+ `.css`): search, URL paste, preview, playlist selection. Also the in-app player `openYoutubeVideoPlayer`.
- Personal entries use `meta.type: "youtube_video"` in `user_quizzes` (`local-youtube-video.js`). Card in `item-card.js`. Dispatch in `user-content-view.js`. Create-menu entries in the desktop context menu and the mobile dropdown.
- Tests: 16 new, all passing. The full suite has 5 failures that also fail on the untouched baseline (docs sync, OG PNG render, LaTeX grading, two rich-input suites).

### 1.3 Verified

- The deployed function answers a bad action with JSON 400 `bad_request` (after fix-3).
- A Node simulation of the Supabase runtime (read-only `process.env`) boots, and returns JSON for bad requests and upstream failures.
- In the browser, the modal opens, and the fix-1 tab-switch and error behavior works.

### 1.4 Not verified yet

- Real search, preview, and playlist results with the live key. Not exercised since fix-3.
- Anything in the browser beyond opening the modal.

### 1.6 Status after Phases A–C

- Phase A (UI), Phase B (playlists), and Phase C (import log) are implemented and covered by 37 automated tests across the YouTube suites.
- Decided (D1): import log. Each entry records when a video or playlist was added to «محتواي». Entries are per device, capped at 500, and the same log holds "published" events once admin publishing exists. No watch history.
- Decided (D2): per-video selection stays. Whole playlists are added as one card.
- Phase C display: a «السجل» tab in the import modal, with open (if the item still exists), remove one entry, and clear all.
- Built on the server and in the browser (not yet deployed or run end to end): MCP tools `create_youtube_import_link` (video or playlist, for all users, saves to «محتواي» through a 72-hour `/my-content?draft=` link), `search_youtube_published`, `get_youtube_published`, and `list_recent_youtube_published`. Migration `20261120120000_youtube_public_and_import_kinds.sql` adds the two draft kinds and the `youtube_public` table.
- Placement decided (lesson-style). Admin API actions are built in Phase F. The upload wizard and the admin screen are not built yet (Phase I).

### 1.5 Operational notes

- After handler changes, redeploy: `node scripts/build-edge-functions.mjs youtube`, then `supabase functions deploy youtube --no-verify-jwt`.
- Other edge functions still carry the old env shim until they are rebuilt and redeployed. They run fine today, so this can wait for the next release.
- `npm run dev:vercel` reads `vercel.json` at startup. Restart it after rewrite changes.
- Vercel does not need `YOUTUBE_DATA_API_KEY`. Only the Supabase function uses it.

### 1.7 Status after Phases D–F (2026-11-20)

Built (code exists in the patches above; not deployed and not run end to end):

- Phase D1: shared import logic in `youtube-library.js`; in-app AI agent tools `search_youtube`, `list_youtube`, `add_youtube`.
- Phase E: MCP tools for all users (`create_youtube_import_link`, which returns a 72-hour `/my-content?draft=` link) and for published items (`search_youtube_published`, `get_youtube_published`, `list_recent_youtube_published`); `youtube_public` table; browser import of video and playlist drafts.
- Phase F: admin API actions with lesson-style placement (course and optional folder), re-validated on the server.
- Tests: 53 YouTube and sync tests pass in Node. The AI-agent suites need `npm install` (`jsonwebtoken` is missing here), so they were not run.

Not verified: the MCP TypeScript (no Deno here), the two migrations (not applied), the `mcp` and admin deployments, the admin API against a real database, and the browser behaviour of Phases D1–F.

Remaining (see §6 Phases G–J and §9):

- Sign-in fails under `npm run dev:vercel` (§9.1). Root cause not confirmed. This blocks local testing of admin upload.
- Window and card fixes found in review (§9.2).
- Admin upload wizard: YouTube item type, publish from `/my-content`, admin screen (Phase I).
- Deployment and end-to-end testing (Phase J).

## 2. Issues from first user testing

### 2.1 Search

- Characters such as `|` return the generic "طلب غير صالح." with no reason. The cause is `QUERY_RE`, which allows only a small character set.
- Required: accept any text except control characters, empty input, and input over 100 characters. When input is rejected, say which rule failed.

### 2.2 Video cards in `/my-content`

- Cards are too large. Target: a compact card with a small thumbnail, a one-line title, and channel and duration as small meta text.
- Remove the description from the card.
- Keep the title to one line, with an ellipsis.
- Remove the "شاهد الفيديو" button.
- Clicking anywhere on the card opens the player window.

### 2.3 Player window

- It must be a resizable window, not a page, styled like the AI-agent window with mac-style traffic-light controls. Reference: `public/src/components/ai-agent/ai-agent-window.js` and `ai-agent-window.css`.
- Contents: the video, the channel (linked), the full description (scrollable), and a link to YouTube.
- The video gets most of the space.
- It stays a window for now. A standalone page is out of scope.

### 2.4 Import preview modal

- Show the publisher channel and the full description.
- Give the video more room than it has now.

### 2.5 `/my-content` context menu for video items

- Remove "تغيير العنوان" and "الوصف والمصدر". Title and description come from YouTube and are read-only.
- Remove "تعديل الامتحان". It is unrelated to videos.
- Remove the whole "تعديل" group.
- Keep select, move, and trash/delete. Videos stay movable.
- No info modal. Video info lives in the player window.

### 2.6 Playlists

- A whole playlist is added as one card, not one card per video.
- Opening the card opens the playlist window. The video list sits at the side, and the user moves through it.

### 2.7 History

- Record history for YouTube videos and playlists. What "history" means is not yet confirmed (see §4, D1).

## 3. Superseded product decisions

- Superseded: "Do not add playlist folders or a playlist content type." A playlist becomes a personal content object (`meta.type: "youtube_playlist"`). It is still not a folder.
- Superseded for the main flow: "Users save a selected playlist's videos individually." Whether per-video selection stays is open (see §4, D2).
- Unchanged: search results are previews until imported.
- Unchanged: public admin route `/video/:slug-or-id` belongs to the admin phase (§6, Phase D). Personal videos stay in the in-app window.

## 4. Blocking decisions (answer before implementing the affected part)

- **D1, history.** Which history do you want?
  - (a) An import log: what was added to محتواي and when.
  - (b) A watch history: videos and playlists the user opened, and when.
  - (c) Both.
  - This choice decides where history is stored (per device or account), where it is shown, and what gets recorded.
- **D2, playlist import.** Which import flow?
  - (a) Only the whole-playlist card.
  - (b) The whole-playlist card, plus the existing per-video selection.

## 5. Updated product decisions

- Video and playlist items are references. Title, channel, description, duration, and thumbnails come from YouTube and are read-only. Refreshing them from YouTube is a later item.
- Video card: compact. Click opens the player window.
- Player window: one shared component for videos and playlists. Mac-style controls. Resizable.
- Playlist object: a snapshot of the ordered video list at import time (IDs, titles, durations, thumbnails). Refreshing it is a later item.
- Playlist limit: 200 items per object. A larger playlist imports its first 200 items, and the object is labeled partial, showing the total count.
- Search accepts any text except control characters, up to 100 characters.
- No public `/video/:slug` page. Published videos and playlists open only in the player window (single video or playlist window). Decided 2026-11-20.
- MCP adds personal items for every user through import links, the same way quiz, lesson, and notebook links work. Published items are read through the `youtube_public` table only.
- Admin publishing writes `youtube_public`. The admin screen and the placement rule are still open.

## 6. Phased plan for the next conversation

### Phase A: fix Phase 1 UX (no new data types)

- **A1, search validation (§2.1).** Files: `supabase/functions/youtube/handler.js`, `youtube-rules.js` (`QUERY_RE`), the client error text. Test with `|`, emoji, Arabic, and control characters.
- **A2, compact video card (§2.2).** Files: `item-card.js` (the `video` kind branch), `youtube-video-modal.css`.
- **A3, player window (§2.3).** Reuse the window chrome from `ai-agent-window.js` and `.css`. Extract a shared window module if that is clean; otherwise copy it and note the source. Files: `youtube-video-modal.js` (player) and the new shared module.
- **A4, import preview (§2.4).** Same modal. Add the channel link and the full description, and enlarge the video.
- **A5, context menu cleanup (§2.5).** Files: `user-content-card.js` (`showUserYoutubeVideoActionsOverlay`). Touch `user-content-folders.js` and `user-content-view.js` only if the global menu needs video-specific filtering for "تعديل الامتحان".
- **A6, tests.** Update `tests/youtube-api.test.js` for the new query rules. Modals have no automated tests today, so use a manual test checklist.

### Phase B: playlist object

- **B1, data.** `meta.type: "youtube_playlist"`, with `playlist: {id, title, channelTitle, itemCount, partial, importedAt, items: [...]}` and `stats.itemCount`. Add a pure builder `local-youtube-playlist.js` with tests.
- **B2, import.** A playlist URL, pasted or from search, shows a preview card (title, channel, count). Adding it creates one object. Load `action=playlist` pages until the 200-item cap or the last page. Duplicate check: same playlist ID at the same level. Applies D2.
- **B3, card.** A single card in the same compact style as videos, with the item count.
- **B4, playlist window.** The shared window from A3. The player is on one side and the list on the other. Clicking a list item switches the video. Previous and next buttons. The current index is shown.
- **B5, limits.** 200 items. The partial label. Use the existing `setInStorage` failure path for storage limits.

### Phase C: history (after D1)

- **C1, storage** per the D1 choice.
- **C2, display** location per D1.
- **C3, recording points.** Import, and opening a video or playlist window (watch history only).
- **C4, clear or remove** history entries.

### Phase D: carry-over from the original plan

- **Admin publishing (original §5).** Still video-only, with the `youtube_videos` table, `api/admin.js` actions, and the public route. Admin playlists are out of scope unless requested.
- **MCP and AI-agent tools (original §6, §7).** Must be extended for `youtube_playlist` (search, import, list) once Phase B is done.
- **Docs (original §8).** `PROJECT_STRUCTURE.md` and user guides.

### Phase G: window and card fixes (from §9.2)

- **G1, compact card width.** Cards fill their grid track. Fix only after confirming the cause in the DOM (§9.2 a).
- **G2, playlist thumbnail.** Give the playlist card's thumbnail a larger share of the card (default: 45% of the card width, 16:9 kept). The video card's size is unchanged unless G1 requires it.
- **G3, window controls.** Use the AI-agent window's order (minimize, maximize, close) and its SVG glyphs. The AI window is the reference, per the owner.
- **G4, minimized width.** In the minimized state, the east and west edges can be dragged to change the width. Height stays at the title bar's height.
- **G5, playlist split.** A draggable divider between the video area and the list. Minimum widths: 320px for the video area, 180px for the list. The chosen split is remembered per device (localStorage). On phones the divider is hidden and the layout stacks, as now.
- **G6, info for the current item.** Playlist window: show the current item's title, published date, and full description. These are loaded on demand with the existing `video` action (`fetchVideoDetails`) and cached in memory. Playlist snapshots do not store descriptions or publish dates, so storage does not grow.
- **G7, remove clutter.** Remove the channel name, the duration, and the "فتح على يوتيوب" link from the video window and the playlist window (the YouTube iframe shows them). The playlist list header keeps the title and the item count.

Files: `item-card.js` (compact branch), `youtube-video-modal.css`, `youtube-player-window.js` (frame and info block), `youtube-playlist-window.js` (split, current-item pane, list header).

Tests: pure tests for divider clamping and the current-item details mapping; manual checklist for the rest.

### Phase H: sign-in and local development (§9.1)

- **H1, confirm the cause.** Run the checks in §9.1 in order and record which one fixes it.
- **H2, make the fix permanent.** Depends on H1: a dev launcher that loads `.env.local` before starting `vercel dev`, or a documented `vercel env pull` step.
- **H3, one service-key name.** Use `SUPABASE_SERVICE_KEY` everywhere, or read both names in one helper.
- **H4, guard every client.** Every `createClient` in `api/` fails with a readable 503 that names the missing variables, instead of crashing the dev server.
- **H5, keep the example.** Make `.env.example` trackable (the `.env*` ignore rule hides it).

### Phase I: admin upload wizard for YouTube items

- **I1, wizard type.** Add a YouTube item type (video or playlist) to the upload batch: counts, labels, and the review list in `adminUpload.js`.
- **I2, placement.** The wizard path (college → year → term → subject, plus an optional subfolder) maps to `course_id` (the subject) and `folder_id` (the subfolder). The server rule is the same one lessons use.
- **I3, publish from `/my-content`.** A "رفع إلى المنصة" action on YouTube items, like `createLessonUploadButton`, opens the same wizard.
- **I4, metadata in the browser.** The admin's browser fetches metadata through `/api/youtube` (up to 200 playlist items). The server never needs the YouTube key.
- **I5, admin screen.** List published YouTube items and unpublish them (`list-youtube-public`, `unpublish-youtube`).
- **I6, publish history.** Record a "published" event in the import log (the event type is already reserved).

Open for confirmation: deleting a course or folder currently deletes the published items placed in it (`ON DELETE CASCADE`, as lessons are assumed to behave). Confirm or change before Phase I.

### Phase J: deployment and verification

1. Apply the patches in the §1.1 order. Run `npm install`, then `npm run test:ai-agent`.
2. Apply migrations `20261120120000_youtube_public_and_import_kinds.sql` and `20261120130000_youtube_public_placement.sql` (`supabase db push`).
3. Deploy the `mcp` function (`supabase functions deploy mcp`). Check the TypeScript first with `deno check` (not run yet).
4. Deploy the Vercel app so `api/admin.js` ships.
5. MCP end to end: create a video import link, open it signed out, and confirm the item appears in `/my-content`. Then search published items.
6. Admin end to end: publish a video and a playlist, check them in the admin list, unpublish one.

## 7. Completion criteria (updated)

- Search accepts normal text. Rejected input explains why.
- Video cards are compact. A click opens the resizable player window with mac-style controls.
- The import preview shows the channel and the full description.
- The video context menu has only select, move, and trash.
- A playlist imports as one card. Opening it lists its videos at the side and lets the user move through them.
- History is recorded as decided in D1.
- The Phase 1 criteria from the original plan still hold for the personal flow.

- Sign-in works under `npm run dev:vercel` on the owner's machine (§9.1).
- The compact video card fills its shelf cell; the playlist thumbnail takes the agreed share (G1, G2).
- Both windows use the AI-window control order and icons; the minimized window can be resized in width (G3, G4).
- The playlist window has a draggable split and shows the current item's title, published date, and description (G5, G6).
- Neither window shows the channel name, the duration, or the YouTube link (G7).
- An admin can publish a video or playlist through the upload wizard into a subject and folder, and unpublish it (Phase I).

## 8. Entry points

- `public/src/features/home/user-content-view.js`: card dispatch, mobile create dropdown.
- `public/src/features/home/user-content-folders.js`: `#userContentContextMenu` and the create submenu.
- `public/src/features/home/item-card.js`: `createItemCard`, `KINDS`, the video card.
- `public/src/features/home/user-content-card.js`: video actions and overlay.
- `public/src/features/home/youtube-video-modal.js` and `.css`: import modal and player.
- `public/src/components/ai-agent/ai-agent-window.js` and `.css`: window reference.
- `supabase/functions/youtube/handler.js`: proxy. `scripts/build-edge-functions.mjs`: bundling. `vercel.json`: rewrite. `supabase/config.toml`: JWT setting.

## 9. Review of 2026-11-20 (owner testing, after Phases A–F)

### 9.1 Sign-in fails under `npm run dev:vercel`

- **Symptom.** Signing in throws `supabaseUrl is required` in `api/auth.js` (the `createClient` call reads `process.env.SUPABASE_URL`). The dev server exits, followed by a `taskkill` error that is a side effect.
- **Facts.** The owner's `.env.local` defines the names in the uploaded `_env.example`, including `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. The names match what `api/` reads. The repo has no dotenv loader. `dev:vercel` is plain `vercel dev --listen 8080`. The Supabase secrets list covers Supabase edge functions only; Vercel dev does not read it.
- **Root cause: not confirmed.** Hypotheses, most likely first:
  1. `vercel dev` (CLI 65.14.0) does not pass the root `.env.local` to function processes. `vercel env pull` writes its own file for dev.
  2. The file is saved in an encoding or format the loader can't parse, for example UTF-16 or a byte-order mark, or values with spaces or quotes around them. Windows editors do this.
  3. Something else resets the variable before the function runs. Not tested.
- **Checks for the owner, in order.** (a) Save `.env.local` as UTF-8 without a byte-order mark, then restart `dev:vercel`. (b) Link the project and run `vercel env pull`, then check whether `SUPABASE_URL` appears in the generated file. (c) Apply `fix-auth-env-guard.patch`: the crash becomes a 503 naming the variable that is empty at runtime.
- **Side note.** `VERCEL_OIDC_TOKEN` in the example is short-lived. A stale token can break the dev server. `vercel env pull` refreshes it.
- **Status.** Open. Resolve in Phase H. It blocks local testing of the admin upload.

### 9.2 Card and window issues

Evidence: the uploaded screenshot (`1795172846221_image.png`) shows a compact video card about 147px wide, next to cards about 390px wide in the same shelf, and a playlist card whose thumbnail is about 140px wide.

a) **Compact video card too narrow.** The shelf is `repeat(auto-fill, minmax(min(100%, 260px), 1fr))`, so every track should be the same width. The narrow card suggests the card sizes to its content (shrink-to-fit) rather than filling its track. Not confirmed. Check the computed `width` and `justify-self` of `.item-card[data-card-kind="video"]` inside `.user-content-container`. Fix in G1.

b) **Playlist thumbnail too small.** The compact rule sets the thumbnail to 112px for both video and playlist cards. Fix in G2.

c) **Window controls wrong.** The YouTube windows use close, minimize, maximize, with text glyphs (`×`, `–`, `+`) shown on hover. The AI window (`ai-agent-window.js`) uses minimize, maximize, close, with SVG glyphs on hover. Fix in G3.

d) **Minimized width fixed.** `.ytw.is-min` hides the resizers, so the width stays at its last size. The AI window hides its resizers when minimized too, but the owner wants the YouTube windows to resize in width when minimized. Fix in G4.

e) **Playlist split fixed.** The video area is `flex: 1 1 0` and the list is `flex: 0 0 300px`. There is no way to change the split. Fix in G5.

f) **No info for the current item.** The current-item block shows the title, channel, duration, and a link. It has no description and no publish date, and the playlist snapshot stores neither. Fix in G6 (on-demand loading, no storage growth).

g) **Clutter.** The channel name, duration, and YouTube link appear in both windows. Fix in G7. Kept: the title and the description. Still open: the published date (see the questions below).

Open questions for the owner, to confirm before Phase G:
- Keep the published date in the video window, and show it in the playlist window's info panel? (Default: yes in both.)
- The playlist thumbnail share: 45% of the card width? (Default: yes.)
- Remember the playlist split per device? (Default: yes.)

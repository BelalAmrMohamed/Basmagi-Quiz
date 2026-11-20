# YouTube Videos — implementation plan

> Handoff: this document is the source of truth for the next conversation. Start from `basmagi.zip` and apply the patch stack in §1.1 in order. Do not restart from the ZIP alone.

## 1. Status

### 1.1 Patch stack (apply in order with `git apply --ignore-whitespace`)

1. `youtube-videos-phase-1.patch`: shared rules, server proxy, import modal and in-app player, personal `youtube_video` entries, `/my-content` integration, tests.
2. `youtube-videos-phase-1-fix-1.patch`: modal fixes (stale requests after a tab switch, pasted links in search, real HTTP status in errors).
3. `youtube-videos-phase-1-fix-2.patch`: `supabase/config.toml` gets `verify_jwt = false` for `youtube`.
4. `youtube-videos-phase-1-fix-3.patch`: `env-shim.ts` guards `process.env` writes; the handler falls back to `Deno.env` for the key.
5. `youtube-videos-plan-update.patch`: this document.

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

### 1.5 Operational notes

- After handler changes, redeploy: `node scripts/build-edge-functions.mjs youtube`, then `supabase functions deploy youtube --no-verify-jwt`.
- Other edge functions still carry the old env shim until they are rebuilt and redeployed. They run fine today, so this can wait for the next release.
- `npm run dev:vercel` reads `vercel.json` at startup. Restart it after rewrite changes.
- Vercel does not need `YOUTUBE_DATA_API_KEY`. Only the Supabase function uses it.

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

## 7. Completion criteria (updated)

- Search accepts normal text. Rejected input explains why.
- Video cards are compact. A click opens the resizable player window with mac-style controls.
- The import preview shows the channel and the full description.
- The video context menu has only select, move, and trash.
- A playlist imports as one card. Opening it lists its videos at the side and lets the user move through them.
- History is recorded as decided in D1.
- The Phase 1 criteria from the original plan still hold for the personal flow.

## 8. Entry points

- `public/src/features/home/user-content-view.js`: card dispatch, mobile create dropdown.
- `public/src/features/home/user-content-folders.js`: `#userContentContextMenu` and the create submenu.
- `public/src/features/home/item-card.js`: `createItemCard`, `KINDS`, the video card.
- `public/src/features/home/user-content-card.js`: video actions and overlay.
- `public/src/features/home/youtube-video-modal.js` and `.css`: import modal and player.
- `public/src/components/ai-agent/ai-agent-window.js` and `.css`: window reference.
- `supabase/functions/youtube/handler.js`: proxy. `scripts/build-edge-functions.mjs`: bundling. `vercel.json`: rewrite. `supabase/config.toml`: JWT setting.

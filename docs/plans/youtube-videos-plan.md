# YouTube Videos — implementation plan

## Goal

Add YouTube videos as a first-class content type alongside quizzes, lessons, and notebooks.

- Any user can search for public YouTube videos or paste a YouTube URL, preview the result, and save it to `/my-content`.
- Any user can import a playlist by reviewing its videos and selecting which ones to save. Each saved video is an ordinary video item; a YouTube playlist does not become a separate Basmagi content type.
- Admins can add an existing YouTube video to Basmagi and place it in a course or folder alongside quizzes, lessons, and notebooks. “Upload” here means publishing a YouTube reference into Basmagi, not uploading a media file to a YouTube channel.
- Videos have a Basmagi detail route and play through YouTube’s embed player. The platform stores references and metadata; it does not download or rehost the video.
- MCP and the built-in AI agent can find, inspect, import, and manage video items.

## Product decisions

- Support search, URL import, playlist selection/import, preview, and personal-library management in the first release.
- Users save a selected playlist’s videos individually, preserving the source playlist URL/ID as provenance where applicable. Do not add playlist folders or a playlist content type.
- Public catalog videos are YouTube references published by admins, placed as leaf items under a course/folder. Preserve the standard admin scope, ownership, trash, restore, and search-engine behavior used by other platform content.
- Use `YOUTUBE_DATA_API_KEY` only in server-side code. Public read/search calls use the key; no YouTube channel OAuth upload flow is part of this feature.
- Use a dedicated video-import modal, with its own markup, styles, search results, preview state, and interactions. Do not reuse or restyle the quiz/lesson/notebook create-modal shell.

## Verified project entry points

- `/my-content` is rendered from `public/src/features/home/user-content-view.js`.
- The global context menu is created dynamically as `#userContentContextMenu` in `public/src/features/home/user-content-folders.js`. Its global “إنشاء” submenu is where the desktop entry belongs. The mobile “إنشاء” dropdown is separately constructed in `public/src/features/home/user-content-view.js`; keep the feature reachable there too.
- Personal items share the `user_quizzes` local-storage collection and carry a discriminator in `meta.type`. Existing copy/save examples are in `public/src/features/home/copy-to-my-content.js`.
- Personal cards are selected by `meta.type` in `user-content-view.js`; item behavior and platform copy actions also live in `public/src/features/home/item-card.js` and `public/src/features/home/copy-to-my-content.js`.
- Admin content is stored in Supabase tables and administered through `api/admin.js`; current sibling implementations are lessons and notebooks. Their public route, validation, and tree conventions are visible in `api/_urls.js`, `api/_validateLesson.js`, `api/_validateNotebook.js`, `api/render-course.js`, and migrations under `supabase/migrations/`.
- MCP tools and handlers are in `supabase/functions/mcp/index.ts` and supporting pure helpers in `supabase/functions/mcp/lib.ts`. Existing import-link drafts save into `/my-content` through `public/src/features/home/mcp-draft-import.js`.
- Built-in AI tool schemas and dispatch are in `api/ai-agent/_tools.js`, `api/ai-agent/chat.js`, and the home-page handlers/context in `public/src/features/home/user-content-view.js` plus the AI-agent component files.

## Implementation sequence

### 1. Define the canonical video record and shared rules

Use a single `youtube_video` content discriminator throughout the browser, API, MCP payloads, and database. Define and document a canonical video reference with:

- YouTube video ID and canonical watch URL (validated and derived from the ID; never accept arbitrary iframe/embed HTML).
- Title, description, thumbnail URL, channel ID/name, publish date, duration, and source/import provenance when available.
- A Basmagi item ID for platform records, plus course/folder placement and creator metadata for admin-published records.

Normalize video IDs from standard watch URLs, `youtu.be`, Shorts URLs, and supported playlist URLs. Reject malformed IDs and non-YouTube hosts. Treat API search results as previews until the user/admin explicitly imports or publishes them. Store a stable subset of YouTube metadata and tolerate absent fields such as descriptions or thumbnails.

Add shared validation for server writes and MCP imports: YouTube ID/URL, title length, description length, metadata field types, supported thumbnail hosts, placement, and allowed payload fields. Keep the browser’s URL parsing behavior aligned with server validation.

### 2. Add server-side YouTube Data API access

Create a server-only YouTube API module/route (for example, `api/youtube.js`) with narrowly scoped actions for:

1. Search public videos by query, returning a small paginated result set and only the fields needed by the modal.
2. Fetch video details by ID, including duration and channel metadata needed to normalize an imported reference.
3. Fetch playlist metadata and its paginated video entries for the playlist selection flow.

Requirements:

- Read `YOUTUBE_DATA_API_KEY` from the server environment. Never put it in `public/`, browser configuration, client requests, logs, or MCP tool results.
- Validate/allowlist actions and inputs, cap page sizes, validate pagination tokens, and apply the project’s normal rate-limit/error-response patterns.
- Map Google API errors, unavailable/private/deleted videos, empty results, quota exhaustion, and transient failures to stable user-facing errors. Do not silently save partial playlist results as a complete playlist.
- Avoid refetching detail for every search result when the search response already contains enough preview metadata; fetch details for selected videos or where duration is required.
- Configure the same secret for every server runtime that calls Google. The local `.env.local` value is already provisioned; add `YOUTUBE_DATA_API_KEY` to Vercel’s server environment and to Supabase Edge Function secrets if the MCP function calls Google directly. Keep environments in sync without printing the value.

Use YouTube’s official Data API methods: `search.list` for search, `videos.list` for details, and `playlistItems.list` plus `playlists.list` for playlist import. Design for quota limits: cache/batch detail lookups where appropriate, paginate only on user action, and avoid issuing a search request for every keystroke.

### 3. Build the personal-library import modal

Add a standalone modal module and stylesheet under `public/src/features/home/` (for example, `youtube-video-modal.js` and `youtube-video-modal.css`). Give it a distinct visual design from the existing create modals while matching the app’s Arabic RTL, responsive, keyboard, focus, and reduced-motion conventions.

Modal flow:

1. Present two entry modes: search YouTube and paste a video/playlist URL.
2. Debounce search input, provide explicit loading/empty/error states, and page results only when requested.
3. Render results with thumbnail, title, channel, duration when known, and an explicit preview/import action. Do not autoplay search results.
4. Preview a selected video in a privacy-enhanced YouTube embed and show the metadata that will be saved.
5. For a playlist URL, load playlist metadata and paginated items, show selection controls and select-all/clear actions, and let the user import the selected videos. Clearly communicate partial/unavailable entries and prevent duplicate saves.
6. Save each chosen video as an ordinary personal `youtube_video` entry in `user_quizzes`, preserving current folder placement when opened from a folder. Detect same-level duplicate videos by YouTube ID, not just title.
7. Show a success/error result, refresh the `/my-content` view/card count, and make imported videos immediately available without sign-in, consistent with personal-content behavior.

Add a dedicated “YouTube videos” command to the `#userContentContextMenu` global create menu. Add the same entry to the separately implemented mobile create dropdown. Do not add this command to item-scoped context menus.

### 4. Integrate personal video items into `/my-content`

- Add a personal video card with thumbnail, title, channel, and duration; clicking opens the Basmagi video detail/player view.
- Add `createUserYoutubeVideoCard` (or equivalent) and `meta.type === "youtube_video"` dispatch without changing quiz, lesson, or notebook card behavior.
- Integrate with selection/bulk actions, drag/drop folder placement, rename, description/source metadata editing where sensible, trash/delete/restore, and duplicate checks. Ensure bulk delete and “delete all” understand the new type.
- Include video items in the home AI context summary and folder-tree prompt as compact records; do not attach full YouTube metadata unnecessarily.
- Update card counts, empty-state copy, search filtering, and type labels/icons wherever the existing collection is described as quizzes only.
- Keep the video card’s context menu specialized only if an action is video-specific; reuse general rename/move/trash behavior.

### 5. Add public catalog storage and admin publishing

Add a Supabase migration for an admin-published `youtube_videos` table and a safe `youtube_video_public` view. Follow lessons/notebooks for the course/folder leaf relationship, creator attribution, timestamps, indexes, public read policy, grants, and course consistency.

The table should include a stable UUID, unique YouTube video ID, metadata fields, optional slug, course/folder placement, creator ID, and timestamps. Public reads should expose only playback and catalog metadata. Never store the API key or OAuth credentials in rows.

Add to `api/admin.js` and related validation/routing:

- `list-youtube-videos`, `get-youtube-video`, `create-youtube-video`, `update-youtube-video`, and `delete-youtube-video` actions.
- Admin authorization using the existing `fetchItemForAuth`/`isAuthorizedForItem` and education-scope model.
- Create/update validation and placement; when adding an ID, retrieve canonical metadata server-side or verify client-submitted metadata against server-fetched details.
- A create flow in the existing admin course/folder upload/authoring UI to search or paste a YouTube URL, preview the resolved video, choose course/folder placement, and publish it.
- Rename, move, uploader/profile lists, admin upload counters/statistics, and trash snapshot/restore support for `youtube_video` items.
- Public detail route and course/folder catalog rendering for video records. Use a stable `/video/:slug-or-id` route, register it in client navigation and server-side rendering/SEO route handling, and show the video as a leaf alongside other content.
- Include the type in search/catalog counts, admin dashboards, profile upload summaries, course/folder counts, and any feeds/sitemaps that currently enumerate quizzes, lessons, and notebooks.

Playback must use YouTube’s supported iframe embed (prefer `youtube-nocookie.com`), include a descriptive title and accessible fallback/link, and respect responsive sizing. Do not proxy, download, or rehost video bytes. Show the YouTube channel/source attribution and link to the canonical YouTube page.

### 6. Extend MCP tools

Update `supabase/functions/mcp/index.ts` tool schemas, dispatch, prompts, and descriptions, and update `supabase/functions/mcp/lib.ts` helpers/authoring guidance. At minimum add:

- `search_youtube_videos`: query public YouTube videos and optionally resolve a playlist; return concise metadata, stable IDs, URLs, and pagination information.
- `get_youtube_video`: resolve a YouTube URL/ID and return validated public metadata and Basmagi catalog status where applicable.
- `create_youtube_video_import_link`: validate one or more video references and create a short-lived import draft that opens in `/my-content` and adds the items to the caller’s personal library.
- Catalog discovery support: include videos in `search_catalog`, course/folder inventory/tree views, recently published content, platform stats, and appropriate get/list format options.
- An authoring-guide topic covering video search/import, playlist selection behavior, URL formats, metadata limits, duplicates, and the distinction between personal import and admin publication.

For MCP-created playlist imports, resolve the playlist and produce a draft containing the selected/returned video references with a clear item limit and pagination strategy. Do not create unbounded drafts from large playlists. Keep draft TTL, validation, and import-success cleanup consistent with current draft behavior. If the current draft kind constraints require a migration, include that migration and update all kind parsing/dispatch sites together.

Set the Edge Function secret when direct YouTube API calls are made from MCP. MCP search must respect the same input/result caps and quota strategy as the web modal.

### 7. Extend built-in AI-agent tools

Update schemas in `api/ai-agent/_tools.js`, tool selection/dispatch and authorization in `api/ai-agent/chat.js`, and home-page tool handlers/context in `public/src/features/home/user-content-view.js` and the relevant AI-agent components.

Provide tools for:

- Searching YouTube videos and resolving a URL/ID to metadata.
- Importing a video (or a bounded selection from a playlist) into the user’s library.
- Listing/searching the user’s saved video items and opening a video by its library entry/title.
- Removing/moving/renaming a personal video only when the user clearly requests that operation; preserve existing delete-confirmation semantics.

Use the same server proxy and validation rules as the modal; the agent must never call Google with a client-visible API key. Route tool calls through the current narrow allowlists and ensure provider schemas stay in parity. AI-agent tools operate on the user’s personal library only; admin publishing remains behind authenticated admin routes and is not exposed to regular users through agent tools.

### 8. Documentation and release wiring

- Update `public/index.html` only for the page shell/metadata or entrypoint wiring actually needed; the context menu itself is generated in JavaScript and is not authored in the HTML file.
- Update user guidance for creating/importing content and admin upload instructions, including playlist limits, privacy-enhanced playback, and the distinction between importing a reference and uploading media to YouTube.
- Update `PROJECT_STRUCTURE.md` and the relevant API/MCP tool inventories if the implementation adds new public routes or modules.
- Add migration application instructions and environment setup for local development, Vercel, and Supabase Edge Functions as applicable. Do not commit `.env.local` or reveal the value in output.

## Completion criteria

- A signed-out user can search, paste a supported YouTube URL, preview a video, import a selected playlist subset, and find/manage saved items in `/my-content`.
- Personal videos can be placed in folders, opened through the Basmagi video view, copied into the library without duplication, and deleted/restored through the same affordances as sibling types.
- An authorized admin can add an existing YouTube video into a permitted course/folder, edit/move/delete it, and it appears in public course/folder navigation and admin/profile counts.
- Invalid, unavailable, private, duplicate, and quota-limited video/playlist cases have understandable outcomes and do not create malformed records.
- MCP can search and resolve YouTube videos, create a personal import link, and find/read platform-published video items.
- The AI agent can search/import and manage the user’s personal video items through validated tools, without exposing the API key or admin-only writes.
- Search, course/folder trees, public routing, trash/restore, profile/admin summaries, and counts consistently include the new type.
- The UI embeds only the YouTube player, links to YouTube, and keeps the API key server-side.

## Official API references

- [YouTube Data API authentication](https://developers.google.com/youtube/data/guides/authentication) — API keys for public data; OAuth for account-scoped operations.
- [Search: list](https://developers.google.com/youtube/v3/docs/search/list) — public video search.
- [Videos: list](https://developers.google.com/youtube/v3/docs/videos/list) — metadata and details by video ID.
- [Playlist items: list](https://developers.google.com/youtube/v3/docs/playlistItems/list) — playlist contents and pagination.
- [YouTube API quota calculator](https://developers.google.com/youtube/data/determine_quota_cost) — per-method quota and pagination costs.

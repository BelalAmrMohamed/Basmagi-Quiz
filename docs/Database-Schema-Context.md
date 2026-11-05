# What is this file?
This file is for context only. It's copied from the Supabase dashboard directly after running the latest migration: `supabase\migrations\20261027143000_lesson_comment_staff_actor_key.sql`.

# Database 

## Table `quizzes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `path` | `text` |  |
| `category` | `text` |  |
| `subject` | `text` |  |
| `subfolder` | `text` |  Nullable |
| `title` | `text` |  |
| `filename` | `text` |  |
| `data` | `jsonb` |  |
| `created_at` | `timestamptz` |  Nullable |
| `synced_at` | `timestamptz` |  Nullable |
| `education_type` | `text` |  Nullable |
| `password` | `text` |  Nullable |
| `college` | `text` |  Nullable |
| `year` | `text` |  Nullable |
| `term` | `text` |  Nullable |
| `uploaded_by` | `uuid` |  Nullable |
| `course_id` | `uuid` |  Nullable |
| `folder_id` | `uuid` |  Nullable |
| `attempt_count` | `int8` |  Default 0 — total submissions; incremented only via RPC `increment_quiz_attempt(p_quiz_id uuid)` (migration `20261028120000_quiz_attempt_count_drop_quiz_access.sql`) |

## Table `admin_users`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `email` | `text` |  Unique |
| `added_by` | `text` |  |
| `created_at` | `timestamptz` |  |
| `handle` | `text` |  Nullable Unique |
| `display_name` | `text` |  Nullable |
| `total_points` | `int4` |  Nullable |
| `passed_quizzes` | `int4` |  Nullable |
| `total_badges` | `int4` |  Nullable |
| `current_level` | `int4` |  Nullable |
| `avatar_url` | `text` |  Nullable |
| `uploaded_quizzes` | `int4` |  Nullable |
| `uploaded_lessons` | `int4` |  Default 0 — live lessons created by this admin; maintained by trigger `lessons_sync_uploaded_lessons_trigger` (migration `20261028180000_admin_uploaded_lessons.sql`), never written by the API |
| `activity_heatmap` | `jsonb` |  Nullable |
| `thumbnail_url` | `text` |  Nullable |
| `allowed_scopes` | `_text` |  Nullable |
| `bio` | `text` |  Nullable |

## Table `reports`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `quiz_id` | `uuid` |  Nullable |
| `question_index` | `int4` |  Nullable |
| `reason` | `text` |  |
| `status` | `text` |  Nullable |
| `resolved_by_admin_id` | `uuid` |  Nullable |
| `resolved_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

## Table `user_profiles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `device_id` | `uuid` |  Unique |
| `passed_quizzes_count` | `int4` |  |
| `current_level` | `int4` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `ai_agent_usage_count` | `int4` |  |
| `ai_agent_usage_date` | `date` |  |

## Table `courses`

Top-level quiz groupings (formerly the implicit "subject" path segment). No parent column by design — courses cannot be nested, matching the rule that courses only exist at the root.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `education_type` | `text` |  |
| `college` | `text` |  Nullable |
| `year` | `int4` |  Nullable |
| `term` | `int4` |  Nullable |
| `icon` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `college_id` | `uuid` |  Nullable |

## Table `folders`

Nested folders under a course. parent_folder_id NULL = direct child of the course; non-NULL = nested under another folder, to arbitrary depth. A folder always belongs to exactly one course via course_id, even when deeply nested, so "everything under this course" never requires walking the folder tree.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `course_id` | `uuid` |  |
| `parent_folder_id` | `uuid` |  Nullable |
| `name` | `text` |  |
| `icon` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `colleges`

Admin-managed education metadata. University rows represent colleges; the terms array allows programs with or without a summer term.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `education_type` | `text` |  |
| `name` | `text` |  |
| `normalized_name` | `text` |  |
| `year_count` | `int2` |  |
| `terms` | `_int2` |  |
| `is_active` | `bool` |  |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `trash_items`

Soft-deleted quizzes/folders/courses for the shared (Supabase-backed) area. One row per item; cascaded deletes (course/folder) share a batch_id so they can be restored or purged together. Original rows are fully removed from quizzes/folders/courses at delete time — this table is the sole record until restore (re-insert from snapshot) or purge (permanent, including media cleanup).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `item_type` | `text` |  |
| `original_id` | `uuid` |  |
| `snapshot` | `jsonb` |  |
| `parent_folder_id` | `uuid` |  Nullable |
| `course_id` | `uuid` |  Nullable |
| `education_type` | `text` |  Nullable |
| `batch_id` | `uuid` |  |
| `deleted_by` | `uuid` |  Nullable |
| `deleted_at` | `timestamptz` |  |
| `expires_at` | `timestamptz` |  |

## Table `admin_settings`

Singleton row (id is always true) of admin-editable global settings. Currently just trash_retention_days. Read/written exclusively through api/admin.js action=trash-settings, developer-only for writes.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `bool` | Primary |
| `trash_retention_days` | `int4` |  |
| `updated_by` | `uuid` |  Nullable |
| `updated_at` | `timestamptz` |  |

## Table `lessons`

A lesson is a sibling leaf next to a quiz under the same course/folder tree — never a new hierarchy level. Never scored: no result page, no interaction with passed_quizzes_count/current_level/points.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `course_id` | `uuid` |  Nullable |
| `folder_id` | `uuid` |  Nullable |
| `title` | `text` |  |
| `slug` | `text` |  Nullable |
| `content` | `jsonb` |  |
| `reader_prefs_default` | `jsonb` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `description` | `text` |  Nullable |
| `password_hash` | `text` |  Nullable |
| `source` | `text` |  Nullable |

## Table `lesson_comments`

Public lesson discussion. New comments appear immediately; deleted comments remain as soft-delete tombstones.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `lesson_id` | `uuid` |  |
| `body` | `text` |  |
| `created_at` | `timestamptz` |  |
| `user_profile_id` | `uuid` |  Nullable |
| `parent_id` | `uuid` |  Nullable |
| `edited_at` | `timestamptz` |  Nullable |
| `deleted_at` | `timestamptz` |  Nullable |
| `admin_user_id` | `uuid` |  Nullable |
| `author_role` | `text` |  |
| `author_name` | `text` |  Nullable |
| `author_handle` | `text` |  Nullable |
| `author_profile_url` | `text` |  Nullable |
| `author_avatar_url` | `text` |  Nullable |
| `author_thumbnail_url` | `text` |  Nullable |
| `author_bio` | `text` |  Nullable |
| `author_actor_key` | `text` |  Nullable |

## Table `lesson_comment_reactions`

One "helpful" reaction per (comment, profile). Toggled by re-submitting (insert if absent, delete if present) — see api/college-quiz.js.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `comment_id` | `uuid` |  |
| `user_profile_id` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `admin_user_id` | `uuid` |  Nullable |
| `admin_actor_key` | `text` |  Nullable |
| `reaction` | `text` |  |

## Table `lesson_comment_reports`

Reports against a lesson comment, reviewed by admins. Independent of the comment's own moderation status.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `comment_id` | `uuid` |  |
| `user_profile_id` | `uuid` |  Nullable |
| `reason` | `text` |  |
| `status` | `text` |  |
| `created_at` | `timestamptz` |  |
| `resolved_at` | `timestamptz` |  Nullable |

## Table `telegram_chat_history`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `chat_id` | `text` |  |
| `role` | `text` |  |
| `content` | `text` |  |
| `created_at` | `timestamptz` |  |

## Table `telegram_bot_updates`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `update_id` | `int8` | Primary |
| `created_at` | `timestamptz` |  |


## Table `storage_limits` / `storage_objects` (storage guard)

Migration `20261104180000_storage_guard.sql`. RLS on, no policies; written only by `storage_reserve()` / `storage_release()` (service_role, called from `api/_storageGuard.js`).

- `storage_limits` (single row `id = 1`): `cap_bytes` (default 800 MB of the 1 GB Supabase free file storage), `max_file_bytes` (2 MB for images; audio 10 MB and video 50 MB are fixed in the function), `warn_pct` (80).
- `storage_objects` `(bucket, path) PK`: `size`, `kind`, `owner`, `created_at`. Running usage = `sum(size)`. Every media upload (quiz-media and notebook-assets) is reserved here BEFORE bytes are sent; at the cap only media is refused, never quiz/lesson/notebook JSON.
- Bucket `notebook-assets` (public read, images only, 2 MB). No insert policy: only signed upload URLs issued by the admin API can write. Objects are content-addressed (`<sha256>.<ext>`), shared between notebooks.
- `storage_usage()`, `storage_orphans()` (objects >1 h old that no quiz, lesson, notebook or trash snapshot mentions).
- Notebook `content.assets`: optional `[{ path, mime, size, sha256, url }]` manifest, validated by `content-rules.js` (`checkNotebookAssets`). Workspace files themselves live only in the browser (IndexedDB `BasmagiWorkspaceDB`) until an admin publishes.

## Draft workspace files (MCP) - bucket `draft-assets`

Migration `20261105110000_draft_assets.sql`. Private bucket (service role + signed URLs only). Objects are `<draftCode>/<filename>`, tracked in `storage_objects` (bucket `draft-assets`) so they count against the global cap; `storage_limits.draft_cap_bytes` (150 MB) is their sub-cap, 10 MB per file and 20 MB per draft are enforced in `storage_reserve(..., kind = 'draft')`.

- Created by the MCP tools `add_workspace_asset`, `add_workspace_asset_from_url`, `request_asset_upload` (curl PUT to `/functions/v1/mcp/upload?t=<HMAC token>`, 15 min, one file).
- `GET /api/mcp/draft/<code>` returns `assets: [{path, mime, size, url}]` (signed URLs, ~1 h). `DELETE /api/mcp/draft/<code>` removes the draft and its files (called by the editor after the notebook is saved/published). Opening the link never deletes anything.
- Cleanup: expired drafts' files are purged on every draft creation, and daily by the Vercel cron `/api/admin?cron=purge-drafts` (`Authorization: Bearer $CRON_SECRET`) through `draft_assets_to_purge()`. `storage_orphans()` ignores this bucket.
- `notebooks.slug` can never be `new` or `edit` (`notebooks_slug_not_reserved`, migration `20261105100000`).

## Table `analytics_daily`

Page views per Cairo calendar day for the whole platform. Written only by analytics_track_view() (service_role), read only through analytics_live_stats(). Powers the live counter and 30-day sparkline on about.html. RLS enabled with no policies.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `day` | `date` | Primary |
| `views` | `int8` |  |

## Table `analytics_presence`

Anonymous, daily-rotating visitor hashes with their last activity time, used only for the "online now" count (visitors active in the last 5 minutes). Rows older than 1 hour are purged opportunistically by analytics_track_view(). No raw IPs, no cookies. RLS enabled with no policies.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `visitor` | `text` | Primary |
| `last_seen` | `timestamptz` |  |

## RLS Policies

### `admin_users`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Deny all for public on admin_users` | ALL | public | PERMISSIVE | `false` | — |
| `Public can read admin profile fields` | SELECT | anon, authenticated | PERMISSIVE | `true` | — |

### `lesson_comments`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `public_read_lesson_comments` | SELECT | public | PERMISSIVE | `(deleted_at IS NULL)` | — |

### `trash_items`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Deny all for public on trash_items` | ALL | public | PERMISSIVE | `false` | — |

### `admin_settings`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Deny all for public on admin_settings` | ALL | public | PERMISSIVE | `false` | — |

### `quizzes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `public_read` | SELECT | public | PERMISSIVE | `true` | — |

### `lessons`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `public_read_metadata` | SELECT | public | PERMISSIVE | `true` | — |

### `courses`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Public can read courses` | SELECT | anon, authenticated | PERMISSIVE | `true` | — |

### `folders`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Public can read folders` | SELECT | anon, authenticated | PERMISSIVE | `true` | — |

### `colleges`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Public can read active colleges` | SELECT | anon, authenticated | PERMISSIVE | `(is_active = true)` | — |

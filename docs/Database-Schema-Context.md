# What is this file?

This file is for context only. It's copied from the Supabase dashboard directly after running this migration: `20261123120000_admin_requests.sql`.

If there are migrations that exist after that one, it means this document is outdated so it shouldn't be used for Database Context.

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
| `attempt_count` | `int8` |  |

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
| `activity_heatmap` | `jsonb` |  Nullable |
| `thumbnail_url` | `text` |  Nullable |
| `allowed_scopes` | `_text` |  Nullable |
| `bio` | `text` |  Nullable |
| `uploaded_lessons` | `int4` |  |
| `social_links` | `jsonb` |  Nullable |
| `uploaded_notebooks` | `int4` |  |

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
| `view_count` | `int8` |  |
| `education_type` | `text` |  Nullable |
| `college` | `text` |  Nullable |
| `year` | `int4` |  Nullable |
| `term` | `int4` |  Nullable |

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

## Table `import_drafts`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `code` | `text` | Primary |
| `kind` | `text` |  |
| `payload` | `jsonb` |  |
| `created_at` | `timestamptz` |  |
| `expires_at` | `timestamptz` |  |

## Table `notebooks`

An executable MATLAB-style notebook: a sibling leaf next to quizzes and lessons in the course/folder tree. Never scored; learner work is local to the browser.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `course_id` | `uuid` |  Nullable |
| `folder_id` | `uuid` |  Nullable |
| `title` | `text` |  |
| `description` | `text` |  Nullable |
| `source` | `text` |  Nullable |
| `slug` | `text` |  Nullable |
| `runtime` | `text` |  |
| `content` | `jsonb` |  |
| `migration_key` | `text` |  Nullable |
| `sort_order` | `int4` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `education_type` | `text` |  Nullable |
| `college` | `text` |  Nullable |
| `year` | `int4` |  Nullable |
| `term` | `int4` |  Nullable |
| `view_count` | `int8` |  |

## Table `analytics_daily`

Page views per Cairo calendar day for the whole platform. Written only by analytics_track_view() (service_role), read only through analytics_live_stats(). Powers the live counter and 30-day sparkline on about.html.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `day` | `date` | Primary |
| `views` | `int8` |  |
| `visitors` | `int8` |  |

## Table `analytics_presence`

Anonymous, daily-rotating visitor hashes with their last activity time, used only for the "online now" count (visitors active in the last 5 minutes). Rows older than 1 hour are purged opportunistically by analytics_track_view(). No raw IPs, no cookies.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `visitor` | `text` | Primary |
| `last_seen` | `timestamptz` |  |

## Table `storage_limits`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int4` | Primary |
| `cap_bytes` | `int8` |  |
| `max_file_bytes` | `int8` |  |
| `warn_pct` | `int4` |  |
| `draft_cap_bytes` | `int8` |  |

## Table `storage_objects`

Ledger of every media object uploaded through the storage guard (running total = sum(size)). Written only by storage_reserve()/storage_release() (service_role).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `bucket` | `text` | Primary |
| `path` | `text` | Primary |
| `size` | `int8` |  |
| `kind` | `text` |  |
| `owner` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `cpp_run_quota`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `ip_hash` | `text` | Primary |
| `window_start` | `timestamptz` | Primary |
| `n` | `int4` |  |

## Table `ai_agent_platform_usage`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `provider` | `text` | Primary |
| `window_start` | `date` | Primary |
| `request_count` | `int4` |  |

## Table `analytics_daily_visitors`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `day` | `date` | Primary |
| `visitor` | `text` | Primary |
| `created_at` | `timestamptz` |  |

## Table `quiz_password_attempts`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `quiz_id` | `uuid` |  |
| `client` | `text` |  |
| `created_at` | `timestamptz` |  |

## Table `ai_agent_turns`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `profile_id` | `uuid` | Primary |
| `turn_id` | `uuid` | Primary |
| `steps` | `int4` |  |
| `started_at` | `timestamptz` |  |

## Table `youtube_public`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `kind` | `text` |  |
| `youtube_id` | `text` |  Nullable |
| `playlist_id` | `text` |  Nullable |
| `title` | `text` |  |
| `channel_title` | `text` |  |
| `channel_id` | `text` |  Nullable |
| `description` | `text` |  |
| `thumbnail_url` | `text` |  |
| `published_at` | `timestamptz` |  Nullable |
| `duration_seconds` | `int4` |  Nullable |
| `item_count` | `int4` |  |
| `total_count` | `int4` |  |
| `partial` | `bool` |  |
| `items` | `jsonb` |  |
| `is_published` | `bool` |  |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `course_id` | `uuid` |  Nullable |
| `folder_id` | `uuid` |  Nullable |
| `channel_thumbnail_url` | `text` |  Nullable |

## Table `admin_requests`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `email` | `text` |  |
| `full_name` | `text` |  |
| `college` | `text` |  Nullable |
| `reason` | `text` |  |
| `notes` | `text` |  Nullable |
| `status` | `text` |  |
| `reviewed_by` | `text` |  Nullable |
| `reviewed_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |

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

### `notebooks`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `public_read` | SELECT | public | PERMISSIVE | `true` | — |

### `colleges`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Public can read active colleges` | SELECT | anon, authenticated | PERMISSIVE | `(is_active = true)` | — |

### `youtube_public`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `youtube_public_read` | SELECT | public | PERMISSIVE | `is_published` | — |


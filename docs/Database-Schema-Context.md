# What is this file?
This file is for context only. It's copied from supabase directly after running the latest migration `supabase\migrations\20260904010000_public_relational_reads.sql`.

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

## Table `quiz_access`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `quiz_path` | `text` |  Unique |
| `is_private` | `bool` |  Nullable |
| `allowed_emails` | `_text` |  Nullable |
| `password_hash` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

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

## RLS Policies

### `admin_users`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Deny all for public on admin_users` | ALL | public | PERMISSIVE | `false` | — |
| `Public can read admin profile fields` | SELECT | anon, authenticated | PERMISSIVE | `true` | — |

### `quizzes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `public_read` | SELECT | public | PERMISSIVE | `true` | — |

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


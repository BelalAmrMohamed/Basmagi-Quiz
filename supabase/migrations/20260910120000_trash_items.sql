-- =============================================================================
-- trash_items — soft-delete / recycle-bin for the shared quizzes/folders/
-- courses area (Supabase-backed). Does NOT cover the localStorage-only
-- "/#my-quizzes" ("امتحاناتك") area — that gets its own client-side trash
-- bucket (`user_quizzes_trash` in localStorage), since there is no server
-- table backing that section at all.
--
-- Why a snapshot table instead of a `deleted_at` column on quizzes/folders/
-- courses:
--   - No changes needed to any existing read path. `quizzes`, `folders`,
--     and `courses` keep their current "a row here is a live row" meaning,
--     so every existing public SELECT (root-view.js, category-view.js,
--     reports.js, the manifest, etc.) keeps working with zero changes and
--     no risk of a forgotten `deleted_at IS NULL` filter leaking a trashed
--     item back into a public listing.
--   - Restoring a quiz whose folder (or a folder whose course) was *also*
--     deleted in the same batch is just re-inserting rows from `snapshot`
--     in parent-then-child order — no need to reconstruct "what was this
--     item's tree state at deletion time" from partially-deleted rows.
--   - Deleting a quiz/folder/course actually removes the row (same as
--     today), so all existing FKs (`quizzes.course_id`, `folders.
--     parent_folder_id`, etc.) behave exactly as before; nothing needs a
--     nullable "soft-deleted but still FK-referenced" state.
--
-- Cascade batching: deleting a course or folder trashes it AND everything
-- nested under it (subfolders, quizzes) as separate rows that all share one
-- `batch_id`, so the whole batch can be restored (or purged) together, or a
-- single item within it restored independently later.
--
-- Media files are NOT touched at soft-delete time — a trashed quiz is fully
-- restorable, including its media, until the trash item is purged (emptied
-- from trash or past its retention window). Storage cleanup only happens at
-- purge time (handled in application code, not this migration).
-- =============================================================================

CREATE TABLE public.trash_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_type text NOT NULL,
  original_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  parent_folder_id uuid NULL,
  course_id uuid NULL,
  education_type text NULL,
  batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  deleted_by uuid NULL,
  deleted_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT trash_items_pkey PRIMARY KEY (id),
  CONSTRAINT trash_items_item_type_check CHECK (item_type IN ('quiz', 'folder', 'course')),
  CONSTRAINT trash_items_deleted_by_fkey FOREIGN KEY (deleted_by)
    REFERENCES public.admin_users (id) ON DELETE SET NULL
  -- Deliberately NO foreign keys on original_id / parent_folder_id / course_id
  -- to quizzes/folders/courses: those rows are gone by the time this table
  -- is populated (soft delete = trash row written, then real row deleted),
  -- and a purged parent must not block deleting its own trash_items row.
  -- `snapshot` is the durable record; these columns are only used to decide
  -- where a restore should land (falling back to root if the original
  -- parent no longer exists, including because it too was purged).
);

CREATE INDEX trash_items_batch_id_idx ON public.trash_items (batch_id);
CREATE INDEX trash_items_expires_at_idx ON public.trash_items (expires_at);
CREATE INDEX trash_items_education_type_idx ON public.trash_items (education_type);
CREATE INDEX trash_items_item_type_idx ON public.trash_items (item_type);

COMMENT ON TABLE public.trash_items IS
  'Soft-deleted quizzes/folders/courses for the shared (Supabase-backed) '
  'area. One row per item; cascaded deletes (course/folder) share a '
  'batch_id so they can be restored or purged together. Original rows are '
  'fully removed from quizzes/folders/courses at delete time — this table '
  'is the sole record until restore (re-insert from snapshot) or purge '
  '(permanent, including media cleanup).';
COMMENT ON COLUMN public.trash_items.item_type IS
  'Which table the snapshot came from: quiz, folder, or course.';
COMMENT ON COLUMN public.trash_items.original_id IS
  'The id the row had in quizzes/folders/courses before deletion. Reused '
  'as the id on restore when nothing else has taken it since.';
COMMENT ON COLUMN public.trash_items.snapshot IS
  'Full copy of the original row (all columns) as JSON, sufficient to '
  're-insert unchanged on restore without depending on any other row '
  '(deleted or otherwise) still existing.';
COMMENT ON COLUMN public.trash_items.parent_folder_id IS
  'The folder the item lived directly under at deletion time (NULL if it '
  'was directly under a course, or if this row is a course). Used only to '
  'pick a restore target — falls back to root/course-level if that folder '
  'no longer exists.';
COMMENT ON COLUMN public.trash_items.course_id IS
  'The course the item belonged to at deletion time (NULL only for a '
  'trashed course row itself). Used the same way as parent_folder_id: to '
  'pick a restore target, falling back to "restore as top-level" if the '
  'course itself was purged.';
COMMENT ON COLUMN public.trash_items.education_type IS
  'Denormalized copy of the item''s education_type at deletion time, so '
  'trash listing/restore/purge can be scope-checked against an admin''s '
  'allowed_scopes the same way live-item deletion already is, without a '
  'join back to a row that may no longer exist.';
COMMENT ON COLUMN public.trash_items.batch_id IS
  'Groups a course/folder deletion together with everything cascade-'
  'trashed underneath it (subfolders, quizzes) into one restorable/'
  'purgeable unit. A lone quiz delete gets a batch_id of its own (a batch '
  'of one).';
COMMENT ON COLUMN public.trash_items.expires_at IS
  'When this item becomes eligible for automatic purge, computed at '
  'delete time from the current admin_settings.trash_retention_days. '
  'Enforced by a lazy sweep on access (see admin_settings comment) rather '
  'than a database-level scheduled job, since this project has no cron '
  'runner today.';

-- Trash is never publicly readable — mirrors admin_users' "Deny all for
-- public" policy. All access goes through api/admin.js using the
-- service-role client, gated by requireAdmin() same as every other admin
-- action.
ALTER TABLE public.trash_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all for public on trash_items" ON public.trash_items;
CREATE POLICY "Deny all for public on trash_items"
  ON public.trash_items FOR ALL
  TO public
  USING (false);

-- =============================================================================
-- admin_settings — small singleton table for admin-configurable knobs.
-- Currently holds only trash_retention_days; deliberately a key/value-ish
-- single row rather than a one-column-per-setting table, so future settings
-- don't each need their own migration.
-- =============================================================================

CREATE TABLE public.admin_settings (
  id boolean NOT NULL DEFAULT true,
  trash_retention_days integer NOT NULL DEFAULT 30,
  updated_by uuid NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT admin_settings_pkey PRIMARY KEY (id),
  CONSTRAINT admin_settings_singleton_check CHECK (id = true),
  CONSTRAINT admin_settings_retention_days_check CHECK (trash_retention_days BETWEEN 1 AND 365),
  CONSTRAINT admin_settings_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES public.admin_users (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.admin_settings IS
  'Singleton row (id is always true) of admin-editable global settings. '
  'Currently just trash_retention_days. Read/written exclusively through '
  'api/admin.js action=trash-settings, owner-only for writes.';
COMMENT ON COLUMN public.admin_settings.trash_retention_days IS
  'Days a trash_items row survives before it is eligible for automatic '
  'purge. Applies to the shared (Supabase) trash only — the localStorage '
  '"/#my-quizzes" trash keeps its own, client-side retention setting.';

INSERT INTO public.admin_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all for public on admin_settings" ON public.admin_settings;
CREATE POLICY "Deny all for public on admin_settings"
  ON public.admin_settings FOR ALL
  TO public
  USING (false);

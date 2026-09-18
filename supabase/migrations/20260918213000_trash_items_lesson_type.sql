-- =============================================================================
-- trash_items: allow 'lesson' as a valid item_type.
--
-- Phase 1 added the `lessons` table but nothing wrote lesson rows into
-- trash_items yet (there was no authoring UI to delete a lesson from, and
-- api/_trash.js's collectCascadeItems didn't walk lessons during a
-- folder/course delete either — see that file's updated header comment).
-- Phase 3 adds both: a direct delete-lesson admin action, and lesson
-- collection during folder/course cascade deletes. Both need to insert
-- item_type = 'lesson' rows here, which the original CHECK constraint
-- (supabase/migrations/20260910120000_trash_items.sql) didn't allow.
--
-- Mirrors that migration's shape exactly: same table, same column, just a
-- widened CHECK — additive, nothing existing is dropped or renamed.
-- =============================================================================

ALTER TABLE public.trash_items
  DROP CONSTRAINT trash_items_item_type_check;

ALTER TABLE public.trash_items
  ADD CONSTRAINT trash_items_item_type_check
  CHECK (item_type IN ('quiz', 'folder', 'course', 'lesson'));

COMMENT ON COLUMN public.trash_items.item_type IS
  'One of: quiz, folder, course, lesson. Determines how `snapshot` is shaped and how restore/purge handle the row (see api/admin.js''s handleTrashRestore and api/_trash.js).';

-- =============================================================================
-- Notebook support for the two tables with item-type constraints:
--   * trash_items.item_type  — allow 'notebook' so delete/restore snapshots work
--     (the snapshot is the full notebooks row, so runtime + content are retained).
--   * import_drafts.kind     — allow 'notebook' for MCP create_notebook_import_link.
-- Additive only: mirrors 20260918213000_trash_items_lesson_type.sql.
-- =============================================================================

ALTER TABLE public.trash_items
  DROP CONSTRAINT trash_items_item_type_check;
ALTER TABLE public.trash_items
  ADD CONSTRAINT trash_items_item_type_check
  CHECK (item_type IN ('quiz', 'folder', 'course', 'lesson', 'notebook'));
COMMENT ON COLUMN public.trash_items.item_type IS
  'One of: quiz, folder, course, lesson, notebook. Determines how `snapshot` is shaped and how restore/purge handle the row (see api/admin.js''s handleTrashRestore and api/_trash.js).';

ALTER TABLE public.import_drafts
  DROP CONSTRAINT IF EXISTS import_drafts_kind_check;
ALTER TABLE public.import_drafts
  ADD CONSTRAINT import_drafts_kind_check
  CHECK (kind IN ('quiz', 'lesson', 'notebook'));

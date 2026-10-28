-- =============================================================================
-- admin_users.uploaded_lessons — lessons uploaded per admin/dev, kept in sync
-- by a trigger on public.lessons.
--
-- Why a trigger (and not an RPC called from the API like uploaded_quizzes):
--   lessons are created from several paths (admin create-lesson, the MCP /
--   import-link flow, upload-quiz folder imports) and removed/restored through
--   the trash flow. A trigger is the one place that sees ALL of them, so the
--   counter can't drift when a new code path is added later.
--
-- Semantics: uploaded_lessons = number of LIVE lessons whose created_by is this
-- admin. Moving a lesson to the trash (row deleted) decrements it; restoring
-- (row re-inserted from the snapshot) increments it again.
--
-- Lessons whose created_by is NULL (creator deleted, or created before the
-- column was populated) cannot be attributed to anyone and are not counted.
--
-- No RLS/grant change needed: admin_users already has a public SELECT policy
-- that is not column-restricted (see 20260909120000_admin_users_bio.sql).
-- =============================================================================

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS uploaded_lessons integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.admin_users.uploaded_lessons IS
  'Number of live lessons created by this admin/dev (lessons.created_by). Maintained by trigger lessons_sync_uploaded_lessons_trigger; never written by the API.';

-- ── Trigger function ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lessons_sync_uploaded_lessons()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NOT NULL THEN
      UPDATE public.admin_users
         SET uploaded_lessons = uploaded_lessons + 1
       WHERE id = NEW.created_by;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.created_by IS NOT NULL THEN
      UPDATE public.admin_users
         SET uploaded_lessons = GREATEST(uploaded_lessons - 1, 0)
       WHERE id = OLD.created_by;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Only fires for changes to created_by (see trigger definition). Covers a
    -- lesson being re-attributed AND the FK's ON DELETE SET NULL when an admin
    -- row is removed (the old owner row no longer exists, so that UPDATE is a
    -- harmless no-op).
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      IF OLD.created_by IS NOT NULL THEN
        UPDATE public.admin_users
           SET uploaded_lessons = GREATEST(uploaded_lessons - 1, 0)
         WHERE id = OLD.created_by;
      END IF;
      IF NEW.created_by IS NOT NULL THEN
        UPDATE public.admin_users
           SET uploaded_lessons = uploaded_lessons + 1
         WHERE id = NEW.created_by;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS lessons_sync_uploaded_lessons_trigger ON public.lessons;
CREATE TRIGGER lessons_sync_uploaded_lessons_trigger
  AFTER INSERT OR DELETE OR UPDATE OF created_by ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.lessons_sync_uploaded_lessons();

-- ── Backfill existing lessons ────────────────────────────────────────────────
UPDATE public.admin_users a
   SET uploaded_lessons = c.n
  FROM (
    SELECT created_by, count(*)::integer AS n
      FROM public.lessons
     WHERE created_by IS NOT NULL
     GROUP BY created_by
  ) c
 WHERE a.id = c.created_by;

-- ── Indexes for the profile "uploads" list / activity heatmap ────────────────
-- Both are "rows by this uploader, newest first".
CREATE INDEX IF NOT EXISTS quizzes_uploaded_by_created_at_idx
  ON public.quizzes (uploaded_by, created_at DESC);
CREATE INDEX IF NOT EXISTS lessons_created_by_created_at_idx
  ON public.lessons (created_by, created_at DESC);

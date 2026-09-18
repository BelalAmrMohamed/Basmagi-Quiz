-- =============================================================================
-- lessons — new content type, sibling leaf to `quizzes` under the same
-- Course → Folder tree (see docs/plans/lessons-feature-plan.md Phase 1).
--
-- Modeled directly on how `quizzes` is placed (see
-- 20260901195646_courses_and_folders.sql): course_id is denormalized
-- alongside folder_id so "everything in this course" never requires
-- walking the folder tree, exactly like quizzes.course_id.
--
-- No password concept for lessons — there is no password-protected lesson
-- requirement in scope, so unlike `quizzes` there's no `password` column
-- and RLS is unconditional public SELECT (mirrors quizzes' `public_read`
-- policy: SELECT, role public, USING (true) — see
-- docs/Database-Schema-Context.md's RLS Policies section).
--
-- `content` is a single jsonb blob (sections/blocks) rather than normalized
-- rows — Phase 1 only needs one plain markdown body to render; Phase 2
-- defines the real sections/blocks shape inside this same column, so no
-- migration is needed to grow it.
-- =============================================================================

CREATE TABLE public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES public.courses (id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.folders (id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text,                    -- for readable URLs; nullable, fall back to id
  content jsonb NOT NULL,       -- sections/blocks, see Phase 2 for shape
  reader_prefs_default jsonb,   -- optional author-set default font/theme, Phase 2
  created_by uuid REFERENCES public.admin_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX lessons_course_id_idx ON public.lessons (course_id);
CREATE INDEX lessons_folder_id_idx ON public.lessons (folder_id);

-- Same cross-column consistency requirement as quizzes/folders: if a lesson
-- has a folder_id, that folder's course_id must equal the lesson's own
-- course_id (see quizzes_enforce_course_consistency in
-- 20260901195646_courses_and_folders.sql, mirrored here identically).
CREATE OR REPLACE FUNCTION public.lessons_enforce_course_consistency()
RETURNS trigger AS $$
DECLARE
  parent_course uuid;
BEGIN
  IF NEW.folder_id IS NOT NULL THEN
    SELECT course_id INTO parent_course FROM public.folders WHERE id = NEW.folder_id;
    IF parent_course IS NULL THEN
      RAISE EXCEPTION 'folder_id % does not exist', NEW.folder_id;
    END IF;
    IF NEW.course_id IS NULL THEN
      NEW.course_id := parent_course;
    ELSIF NEW.course_id <> parent_course THEN
      RAISE EXCEPTION 'lesson.course_id (%) must match its folder''s course_id (%)',
        NEW.course_id, parent_course;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lessons_course_consistency_trigger
  BEFORE INSERT OR UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.lessons_enforce_course_consistency();

-- No updated_at trigger: courses/folders don't use one either (see
-- 20260901195646_courses_and_folders.sql) — updated_at is set explicitly by
-- writers on update, same convention, not a moddatetime-style auto-trigger.

COMMENT ON TABLE public.lessons IS
  'A lesson is a sibling leaf next to a quiz under the same course/folder '
  'tree — never a new hierarchy level. Never scored: no result page, no '
  'interaction with passed_quizzes_count/current_level/points.';
COMMENT ON COLUMN public.lessons.course_id IS
  'Denormalized alongside folder_id, mirroring quizzes.course_id, for cheap '
  '"everything in this course" queries without walking the folder tree.';
COMMENT ON COLUMN public.lessons.folder_id IS
  'NULL means the lesson sits directly under its course with no subfolder '
  '— same convention as quizzes.folder_id.';
COMMENT ON COLUMN public.lessons.slug IS
  'Optional readable URL slug. Nullable — /lesson/:id falls back to the '
  'raw id when absent.';
COMMENT ON COLUMN public.lessons.content IS
  'jsonb sections/blocks. Phase 1 only renders a single plain markdown '
  'body from this; Phase 2 defines the full sections/blocks shape here.';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read" ON public.lessons;
CREATE POLICY "public_read"
  ON public.lessons FOR SELECT
  TO public
  USING (true);

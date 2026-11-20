-- =============================================================================
-- Placement for published YouTube items, the same rule lessons follow: a course,
-- and an optional folder inside it. Deleting a course or folder removes the
-- published items placed there (ON DELETE CASCADE), like lessons.
-- The constraint is NOT VALID so it can be added without re-checking old rows;
-- every new row goes through the admin API, which always sets course_id.
-- =============================================================================

ALTER TABLE public.youtube_public
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.folders(id) ON DELETE CASCADE;

ALTER TABLE public.youtube_public DROP CONSTRAINT IF EXISTS youtube_public_course_required;
ALTER TABLE public.youtube_public ADD CONSTRAINT youtube_public_course_required
  CHECK (course_id IS NOT NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS youtube_public_course_idx ON public.youtube_public (course_id);
CREATE INDEX IF NOT EXISTS youtube_public_folder_idx ON public.youtube_public (folder_id);

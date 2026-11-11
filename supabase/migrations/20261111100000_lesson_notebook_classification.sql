-- Lessons and notebooks carry the same classification as quizzes
-- (education_type / college / year / term). The values are always copied from
-- the item's course by triggers, so they cannot drift and no write path
-- (admin upload, MCP import, move) needs to set them.

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS education_type text,
  ADD COLUMN IF NOT EXISTS college text,
  ADD COLUMN IF NOT EXISTS year integer,
  ADD COLUMN IF NOT EXISTS term integer;

ALTER TABLE public.notebooks
  ADD COLUMN IF NOT EXISTS education_type text,
  ADD COLUMN IF NOT EXISTS college text,
  ADD COLUMN IF NOT EXISTS year integer,
  ADD COLUMN IF NOT EXISTS term integer;

CREATE OR REPLACE FUNCTION public.copy_course_classification()
RETURNS trigger AS $$
BEGIN
  IF NEW.course_id IS NULL THEN
    NEW.education_type := NULL;
    NEW.college := NULL;
    NEW.year := NULL;
    NEW.term := NULL;
  ELSE
    SELECT c.education_type, c.college, c.year, c.term
      INTO NEW.education_type, NEW.college, NEW.year, NEW.term
      FROM public.courses c
     WHERE c.id = NEW.course_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lessons_copy_course_classification ON public.lessons;
CREATE TRIGGER lessons_copy_course_classification
  BEFORE INSERT OR UPDATE OF course_id ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.copy_course_classification();

DROP TRIGGER IF EXISTS notebooks_copy_course_classification ON public.notebooks;
CREATE TRIGGER notebooks_copy_course_classification
  BEFORE INSERT OR UPDATE OF course_id ON public.notebooks
  FOR EACH ROW EXECUTE FUNCTION public.copy_course_classification();

-- When a course's classification changes, cascade to its lessons/notebooks.
CREATE OR REPLACE FUNCTION public.cascade_course_classification()
RETURNS trigger AS $$
BEGIN
  UPDATE public.lessons
     SET education_type = NEW.education_type, college = NEW.college, year = NEW.year, term = NEW.term
   WHERE course_id = NEW.id;
  UPDATE public.notebooks
     SET education_type = NEW.education_type, college = NEW.college, year = NEW.year, term = NEW.term
   WHERE course_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS courses_cascade_classification ON public.courses;
CREATE TRIGGER courses_cascade_classification
  AFTER UPDATE OF education_type, college, year, term ON public.courses
  FOR EACH ROW
  WHEN (OLD.education_type IS DISTINCT FROM NEW.education_type
     OR OLD.college IS DISTINCT FROM NEW.college
     OR OLD.year IS DISTINCT FROM NEW.year
     OR OLD.term IS DISTINCT FROM NEW.term)
  EXECUTE FUNCTION public.cascade_course_classification();

-- Backfill existing rows.
UPDATE public.lessons l
   SET education_type = c.education_type, college = c.college, year = c.year, term = c.term
  FROM public.courses c WHERE l.course_id = c.id;
UPDATE public.notebooks n
   SET education_type = c.education_type, college = c.college, year = c.year, term = c.term
  FROM public.courses c WHERE n.course_id = c.id;

-- Expose the new columns through the public views (appended as the LAST
-- columns so CREATE OR REPLACE VIEW keeps the existing order and grants).
CREATE OR REPLACE VIEW public.lesson_public
WITH (security_invoker = false) AS
SELECT
  id,
  slug,
  title,
  description,
  source,
  course_id,
  folder_id,
  created_by,
  created_at,
  updated_at,
  reader_prefs_default,
  CASE
    WHEN password_hash IS NULL OR password_hash = '' THEN content
    ELSE NULL
  END AS content,
  COALESCE((
    SELECT jsonb_agg(COALESCE(section->>'id', '') ORDER BY ordinality)
    FROM jsonb_array_elements(COALESCE(content->'sections', '[]'::jsonb)) WITH ORDINALITY AS sections(section, ordinality)
    WHERE COALESCE(section->>'id', '') <> ''
  ), '[]'::jsonb) AS section_ids,
  COALESCE(jsonb_array_length(COALESCE(content->'sections', '[]'::jsonb)), 0) AS section_count,
  (password_hash IS NOT NULL AND password_hash <> '') AS password_protected,
  COALESCE((
    SELECT count(*)::int
    FROM jsonb_array_elements(COALESCE(content->'sections', '[]'::jsonb)) AS s(section),
         jsonb_array_elements(COALESCE(s.section->'blocks', '[]'::jsonb)) AS b(block)
    WHERE b.block->>'type' = 'question'
  ), 0) AS question_count,
  education_type,
  college,
  year,
  term
FROM public.lessons;

GRANT SELECT ON public.lesson_public TO anon, authenticated;

CREATE OR REPLACE VIEW public.notebook_public
WITH (security_invoker = false) AS
SELECT
  id,
  slug,
  title,
  description,
  source,
  runtime,
  course_id,
  folder_id,
  sort_order,
  created_by,
  created_at,
  updated_at,
  content,
  COALESCE(jsonb_array_length(content->'cells'), 0) AS cell_count,
  education_type,
  college,
  year,
  term
FROM public.notebooks;

GRANT SELECT ON public.notebook_public TO anon, authenticated;

-- Public clients need read-only access to relational quiz placement metadata.
-- Quiz rows are already publicly readable; without these policies the client
-- manifest sees quizzes but cannot resolve their courses or folders.

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colleges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read courses" ON public.courses;
CREATE POLICY "Public can read courses"
  ON public.courses FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Public can read folders" ON public.folders;
CREATE POLICY "Public can read folders"
  ON public.folders FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Public can read active colleges" ON public.colleges;
CREATE POLICY "Public can read active colleges"
  ON public.colleges FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- The colleges migration ran before the local quiz migration created courses.
-- Reconcile the canonical college table with all University courses now.
INSERT INTO public.colleges (education_type, name, normalized_name, year_count, terms)
SELECT
  'University',
  source.college,
  lower(regexp_replace(trim(source.college), '\s+', ' ', 'g')),
  greatest(coalesce(source.max_year, 4), 1)::smallint,
  coalesce(source.terms, ARRAY[1, 2]::smallint[])
FROM (
  SELECT
    college,
    max(year) AS max_year,
    array_agg(DISTINCT term ORDER BY term) FILTER (WHERE term IS NOT NULL)::smallint[] AS terms
  FROM public.courses
  WHERE education_type = 'University'
    AND college IS NOT NULL
    AND trim(college) <> ''
  GROUP BY college
) AS source
ON CONFLICT (education_type, normalized_name) DO UPDATE
SET
  name = EXCLUDED.name,
  year_count = EXCLUDED.year_count,
  terms = EXCLUDED.terms,
  updated_at = timezone('utc'::text, now());

UPDATE public.courses AS course
SET college_id = college.id
FROM public.colleges AS college
WHERE course.education_type = 'University'
  AND course.college IS NOT NULL
  AND college.education_type = 'University'
  AND college.normalized_name = lower(regexp_replace(trim(course.college), '\s+', ' ', 'g'))
  AND (course.college_id IS NULL OR course.college_id <> college.id);

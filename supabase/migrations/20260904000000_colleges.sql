-- First-class education metadata for admin-managed colleges.
-- Legacy quizzes.courses.college strings remain in place during migration.

CREATE TABLE public.colleges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  education_type text NOT NULL DEFAULT 'University',
  name text NOT NULL,
  normalized_name text NOT NULL,
  year_count smallint NOT NULL DEFAULT 4,
  terms smallint[] NOT NULL DEFAULT ARRAY[1, 2]::smallint[],
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT colleges_pkey PRIMARY KEY (id),
  CONSTRAINT colleges_education_type_check CHECK (education_type IN ('University', 'Primary', 'Middle', 'High')),
  CONSTRAINT colleges_name_check CHECK (length(trim(name)) > 0),
  CONSTRAINT colleges_year_count_check CHECK (year_count BETWEEN 1 AND 12),
  CONSTRAINT colleges_terms_check CHECK (
    cardinality(terms) BETWEEN 1 AND 4
    AND terms <@ ARRAY[1, 2, 3, 4]::smallint[]
  ),
  CONSTRAINT colleges_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.admin_users (id) ON DELETE SET NULL,
  CONSTRAINT colleges_unique_name UNIQUE (education_type, normalized_name)
);

CREATE INDEX colleges_active_idx
  ON public.colleges (education_type, is_active, name);

-- Normalize the legacy values without changing their displayed spelling.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.courses
    WHERE education_type = 'University' AND college IS NOT NULL AND trim(college) <> ''
    GROUP BY lower(regexp_replace(trim(college), '\s+', ' ', 'g'))
    HAVING count(DISTINCT college) > 1
  ) THEN
    RAISE EXCEPTION 'Legacy university college names collide after normalization; reconcile them before applying this migration';
  END IF;
END;
$$;

INSERT INTO public.colleges (education_type, name, normalized_name, year_count, terms)
SELECT
  'University',
  legacy.college,
  lower(regexp_replace(trim(legacy.college), '\s+', ' ', 'g')),
  greatest(coalesce(legacy.max_year, 4), 1)::smallint,
  coalesce(legacy.terms, ARRAY[1, 2]::smallint[])
FROM (
  SELECT
    college,
    max(year) AS max_year,
    array_agg(DISTINCT term ORDER BY term) FILTER (WHERE term IS NOT NULL)::smallint[] AS terms
  FROM public.courses
  WHERE education_type = 'University' AND college IS NOT NULL AND trim(college) <> ''
  GROUP BY college
) AS legacy
ON CONFLICT (education_type, normalized_name) DO NOTHING;

ALTER TABLE public.courses ADD COLUMN college_id uuid NULL;

UPDATE public.courses AS course
SET college_id = college.id
FROM public.colleges AS college
WHERE course.education_type = 'University'
  AND course.college IS NOT NULL
  AND college.education_type = 'University'
  AND college.normalized_name = lower(regexp_replace(trim(course.college), '\s+', ' ', 'g'));

ALTER TABLE public.courses
  ADD CONSTRAINT courses_college_id_fkey FOREIGN KEY (college_id)
  REFERENCES public.colleges (id) ON DELETE RESTRICT;

CREATE INDEX courses_college_id_idx ON public.courses (college_id);

-- Keep the old uniqueness constraint until all readers have moved to college_id.
-- This new constraint prevents two canonical colleges from sharing a slot.
ALTER TABLE public.courses
  ADD CONSTRAINT courses_canonical_unique_slot
  UNIQUE (education_type, college_id, year, term, name);

COMMENT ON TABLE public.colleges IS
  'Admin-managed education metadata. University rows represent colleges; the '
  'terms array allows programs with or without a summer term.';

COMMENT ON COLUMN public.courses.college_id IS
  'Canonical college reference. The legacy college text remains for compatibility.';
-- Expose the number of embedded questions of each lesson through lesson_public
-- (next to section_count) so the platform's lesson cards can show
-- "الأسئلة المدمجة" like the workspace cards do. Appended as the LAST column so
-- CREATE OR REPLACE VIEW can keep the existing column order and grants.
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
  ), 0) AS question_count
FROM public.lessons;

GRANT SELECT ON public.lesson_public TO anon, authenticated;

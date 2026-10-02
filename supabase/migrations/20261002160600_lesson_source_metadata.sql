-- ============================================================================
-- Canonical lesson source metadata
-- ============================================================================
-- `source` is optional author-provided provenance/reference text. Keep it in
-- the canonical lessons row and expose it through the already-safe
-- lesson_public metadata/content view. No password material is exposed.

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.lessons.source IS
  'Optional author-provided lesson source/reference (maximum 500 characters).';

DROP VIEW IF EXISTS public.lesson_public;
CREATE VIEW public.lesson_public
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
  (password_hash IS NOT NULL AND password_hash <> '') AS password_protected
FROM public.lessons;

GRANT SELECT ON public.lesson_public TO anon, authenticated;

-- Browser roles may read source metadata only through this safe column grant.
-- Direct table SELECT remains restricted; the view still withholds protected
-- lesson content and password_hash.
REVOKE SELECT ON public.lessons FROM anon, authenticated;
GRANT SELECT (
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
  reader_prefs_default
) ON public.lessons TO anon, authenticated;

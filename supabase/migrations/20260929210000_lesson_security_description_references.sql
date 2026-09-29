-- =============================================================================
-- Lesson metadata + password protection + safe public access
-- =============================================================================

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS password_hash text;

COMMENT ON COLUMN public.lessons.description IS
  'Optional author-provided lesson description shown in catalog, reader and info views.';
COMMENT ON COLUMN public.lessons.password_hash IS
  'Server-side SHA-256 digest of the client-derived password digest. The plaintext password is never sent to or stored by the server, and this hash is never exposed through public content payloads.';

-- Public readers can select content only for unprotected lessons. Protected
-- lesson content is NULL here and is available only after the server-side
-- password verification endpoint succeeds. The password hash is never exposed.
DROP VIEW IF EXISTS public.lesson_public;
CREATE VIEW public.lesson_public
WITH (security_invoker = false) AS
SELECT
  id,
  slug,
  title,
  description,
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
    SELECT jsonb_agg(COALESCE(section->>'id', '' ) ORDER BY ordinality)
    FROM jsonb_array_elements(COALESCE(content->'sections', '[]'::jsonb)) WITH ORDINALITY AS sections(section, ordinality)
    WHERE COALESCE(section->>'id', '') <> ''
  ), '[]'::jsonb) AS section_ids,
  COALESCE(jsonb_array_length(COALESCE(content->'sections', '[]'::jsonb)), 0) AS section_count,
  (password_hash IS NOT NULL AND password_hash <> '') AS password_protected
FROM public.lessons;

GRANT SELECT ON public.lesson_public TO anon, authenticated;

-- Existing public-read policy remains useful for the server-side service-role
-- client and the metadata view. Remove direct table SELECT for browser roles so
-- protected content cannot be obtained by bypassing the API.
DROP POLICY IF EXISTS "public_read" ON public.lessons;
CREATE POLICY "public_read_metadata"
  ON public.lessons FOR SELECT
  TO public
  USING (true);

REVOKE SELECT ON public.lessons FROM anon, authenticated;
GRANT SELECT (
  id,
  slug,
  title,
  description,
  course_id,
  folder_id,
  created_by,
  created_at,
  updated_at,
  reader_prefs_default
) ON public.lessons TO anon, authenticated;

-- Service role is unaffected by the column-level/browser-role grant above.

-- =============================================================================
-- Quiz passwords are no longer readable by browsers
-- =============================================================================
-- Before: `quizzes` had a public SELECT policy on every column, and the home
-- page selected `password` for every quiz, so the (unsalted SHA-256, or legacy
-- plaintext) value of every quiz password was downloaded by every visitor.
--
-- After:
--   * anon/authenticated can no longer SELECT quizzes.password at all.
--   * public.quiz_public (same pattern as lesson_public) exposes the other
--     columns plus a `password_protected` boolean for catalogs/guards.
--   * public.verify_quiz_password() checks a typed password on the server and
--     returns the stored value ONLY when the password is correct (the exporter
--     embeds it in downloaded quiz files so they stay protected offline).
-- The service role (api/*, edge functions) is unaffected.
--
-- NOTE: browser roles only get the columns listed below. A column added to
-- `quizzes` later is private by default; add it to the GRANT (and the view).
-- Apply this migration BEFORE deploying the matching front-end/API change.
-- =============================================================================

-- 1. Legacy rows that kept the password only inside data.meta: move it to the
--    column (the source of truth), then strip it from the public JSON body.
UPDATE public.quizzes
SET password = data #>> '{meta,password}'
WHERE (password IS NULL OR password = '')
  AND NULLIF(btrim(data #>> '{meta,password}'), '') IS NOT NULL;

UPDATE public.quizzes
SET data = data #- '{meta,password}'
WHERE data #> '{meta,password}' IS NOT NULL;

-- 2. Browser roles lose access to the password column.
REVOKE SELECT ON public.quizzes FROM anon, authenticated;
GRANT SELECT (
  id, path, category, subject, subfolder, title, filename, data,
  created_at, synced_at, education_type, college, year, term,
  uploaded_by, course_id, folder_id, attempt_count
) ON public.quizzes TO anon, authenticated;

-- 3. Safe public view with the protection flag.
DROP VIEW IF EXISTS public.quiz_public;
CREATE VIEW public.quiz_public
WITH (security_invoker = false) AS
SELECT
  id, path, category, subject, subfolder, title, filename, data,
  created_at, synced_at, education_type, college, year, term,
  uploaded_by, course_id, folder_id, attempt_count,
  (password IS NOT NULL AND password <> '') AS password_protected
FROM public.quizzes;

GRANT SELECT ON public.quiz_public TO anon, authenticated;

-- 4. Server-side password check. Returns the stored value on success, NULL on
--    a wrong password or an unprotected quiz. Mirrors the old client rule:
--    a 64-hex stored value is SHA-256(password); anything else is legacy
--    plaintext.
CREATE OR REPLACE FUNCTION public.verify_quiz_password(p_quiz_id uuid, p_password text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored text;
  typed  text := btrim(COALESCE(p_password, ''));
BEGIN
  SELECT btrim(password) INTO stored FROM public.quizzes WHERE id = p_quiz_id;
  IF stored IS NULL OR stored = '' OR typed = '' THEN
    RETURN NULL;
  END IF;
  IF stored ~* '^[a-f0-9]{64}$' THEN
    IF encode(sha256(convert_to(typed, 'UTF8')), 'hex') = lower(stored) THEN
      RETURN stored;
    END IF;
  ELSIF typed = stored THEN
    RETURN stored;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_quiz_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_quiz_password(uuid, text) TO anon, authenticated;

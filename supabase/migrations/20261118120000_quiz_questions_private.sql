-- =============================================================================
-- Protected quizzes: questions are hidden until the server verifies the
-- password, and password guessing is rate-limited
-- =============================================================================
-- Follow-up to 20261114120000_quiz_password_private.sql, which hid the password
-- column but left `quizzes.data` (the questions) publicly readable, so the lock
-- on a protected quiz was only a screen. Same model as lessons
-- (20260929210000_lesson_security_description_references.sql):
--
--   * Browsers can no longer SELECT quizzes.data at all. They read quiz_public,
--     where a password-protected quiz's `data` is only { meta, stats } (title,
--     description, question count/types...) with NO questions.
--   * public.unlock_quiz(quiz_id, password) returns { stored, data } (data =
--     the full payload, questions included) only for a correct password.
--     verify_quiz_password() keeps its old contract for already-deployed
--     clients (stored value on success, NULL otherwise).
--   * Both functions share one rate limiter (below), enforced in the database
--     because they are callable straight from PostgREST, bypassing our API.
--
-- The service role (api/*, edge functions) is unaffected. Anything in api/*
-- that reads quizzes with the ANON key must read quiz_public instead.
-- Apply this migration TOGETHER WITH the matching front-end/API deploy: the
-- old client still selects `quizzes.data` and would stop loading quizzes.
--
-- RATE LIMITS (tune the constants in _quiz_pw_check):
--   * 8 wrong guesses per client (IP) per quiz per 10 minutes
--   * 150 wrong guesses per quiz, from anyone, per 10 minutes
-- The per-quiz ceiling stops distributed guessing (many IPs / spoofed
-- headers) at roughly 900 guesses/hour per quiz. It is deliberately high so
-- one abusive visitor cannot realistically lock students out of an exam.
-- =============================================================================

-- 1. Attempt log (private: no browser role can touch it) ----------------------
CREATE TABLE IF NOT EXISTS public.quiz_password_attempts (
  id         bigserial PRIMARY KEY,
  quiz_id    uuid        NOT NULL,
  client     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_password_attempts_quiz_idx
  ON public.quiz_password_attempts (quiz_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quiz_password_attempts_client_idx
  ON public.quiz_password_attempts (quiz_id, client, created_at DESC);

ALTER TABLE public.quiz_password_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quiz_password_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.quiz_password_attempts_id_seq FROM PUBLIC, anon, authenticated;

-- 2. Browsers lose direct access to the questions -----------------------------
REVOKE SELECT ON public.quizzes FROM anon, authenticated;
GRANT SELECT (
  id, path, category, subject, subfolder, title, filename,
  created_at, synced_at, education_type, college, year, term,
  uploaded_by, course_id, folder_id, attempt_count
) ON public.quizzes TO anon, authenticated;

-- 3. quiz_public: protected quizzes expose only meta + stats ------------------
DROP VIEW IF EXISTS public.quiz_public;
CREATE VIEW public.quiz_public
WITH (security_invoker = false) AS
SELECT
  id, path, category, subject, subfolder, title, filename,
  CASE
    WHEN password IS NULL OR password = '' THEN data
    ELSE jsonb_build_object(
      'meta',  COALESCE(data -> 'meta',  '{}'::jsonb) - 'password',
      'stats', COALESCE(data -> 'stats', '{}'::jsonb)
    )
  END AS data,
  created_at, synced_at, education_type, college, year, term,
  uploaded_by, course_id, folder_id, attempt_count,
  (password IS NOT NULL AND password <> '') AS password_protected
FROM public.quizzes;

GRANT SELECT ON public.quiz_public TO anon, authenticated;

-- 4. Rate limiter + password check (internal; not callable by browsers) -------
-- Best-effort client key. PostgREST exposes the request headers; prefer the
-- ones a trusted proxy sets, and for X-Forwarded-For take the LAST hop (the
-- first hops are client-controlled and trivially spoofed). Spoofing can
-- still dodge the per-client limit, which is why the per-quiz ceiling exists.
CREATE OR REPLACE FUNCTION public._quiz_pw_client()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  headers jsonb;
  raw     text;
BEGIN
  BEGIN
    headers := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    headers := '{}'::jsonb;
  END;
  raw := COALESCE(
    NULLIF(btrim(headers ->> 'cf-connecting-ip'), ''),
    NULLIF(btrim(headers ->> 'x-real-ip'), ''),
    NULLIF(btrim(regexp_replace(COALESCE(headers ->> 'x-forwarded-for', ''), '^.*,', '')), ''),
    'unknown'
  );
  RETURN encode(sha256(convert_to(raw, 'UTF8')), 'hex');
END;
$$;

-- Returns:
--   {status:'none'}                         quiz missing or not protected
--   {status:'limited', retry_after:<secs>}  too many wrong guesses
--   {status:'wrong'}                        wrong password (attempt recorded)
--   {status:'ok', stored:<text>, data:<jsonb>}
CREATE OR REPLACE FUNCTION public._quiz_pw_check(p_quiz_id uuid, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_window         constant interval := interval '10 minutes';
  c_client_limit   constant int := 8;
  c_quiz_limit     constant int := 150;

  stored   text;
  payload  jsonb;
  typed    text := btrim(COALESCE(p_password, ''));
  who      text := public._quiz_pw_client();
  n_client int;
  n_quiz   int;
  oldest   timestamptz;
  matched  boolean := false;
BEGIN
  SELECT btrim(password), data INTO stored, payload
  FROM public.quizzes WHERE id = p_quiz_id;

  IF stored IS NULL OR stored = '' THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  -- Housekeeping: keep the log small without needing a cron job.
  IF random() < 0.02 THEN
    DELETE FROM public.quiz_password_attempts WHERE created_at < now() - interval '1 day';
  END IF;

  -- Throttle BEFORE comparing, so a locked-out client learns nothing.
  SELECT count(*), min(created_at) INTO n_client, oldest
  FROM public.quiz_password_attempts
  WHERE quiz_id = p_quiz_id AND client = who AND created_at > now() - c_window;
  IF n_client >= c_client_limit THEN
    RETURN jsonb_build_object(
      'status', 'limited',
      'retry_after', GREATEST(1, ceil(extract(epoch FROM (oldest + c_window - now())))::int)
    );
  END IF;

  SELECT count(*), min(created_at) INTO n_quiz, oldest
  FROM public.quiz_password_attempts
  WHERE quiz_id = p_quiz_id AND created_at > now() - c_window;
  IF n_quiz >= c_quiz_limit THEN
    RETURN jsonb_build_object(
      'status', 'limited',
      'retry_after', GREATEST(1, ceil(extract(epoch FROM (oldest + c_window - now())))::int)
    );
  END IF;

  -- Mirrors the old client rule: a 64-hex stored value is SHA-256(password);
  -- anything else is a legacy plaintext password.
  IF typed <> '' THEN
    IF stored ~* '^[a-f0-9]{64}$' THEN
      matched := encode(sha256(convert_to(typed, 'UTF8')), 'hex') = lower(stored);
    ELSE
      matched := typed = stored;
    END IF;
  END IF;

  IF NOT matched THEN
    INSERT INTO public.quiz_password_attempts (quiz_id, client) VALUES (p_quiz_id, who);
    RETURN jsonb_build_object('status', 'wrong');
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'stored', stored,
    'data', jsonb_set(COALESCE(payload, '{}'::jsonb), '{meta}', COALESCE(payload -> 'meta', '{}'::jsonb) - 'password')
  );
END;
$$;

REVOKE ALL ON FUNCTION public._quiz_pw_check(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quiz_pw_client() FROM PUBLIC, anon, authenticated;

-- 5. Public entry points ------------------------------------------------------
-- Same contract as before (stored value on success, NULL otherwise) so
-- already-loaded pages keep working; now rate-limited. A limited call raises
-- 'quiz_password_rate_limited' with the wait in seconds as DETAIL.
CREATE OR REPLACE FUNCTION public.verify_quiz_password(p_quiz_id uuid, p_password text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb := public._quiz_pw_check(p_quiz_id, p_password);
BEGIN
  IF r ->> 'status' = 'limited' THEN
    RAISE EXCEPTION 'quiz_password_rate_limited' USING DETAIL = (r ->> 'retry_after');
  END IF;
  IF r ->> 'status' = 'ok' THEN
    RETURN r ->> 'stored';
  END IF;
  RETURN NULL;
END;
$$;

-- New: verify AND return the questions. { stored, data } on success, NULL on a
-- wrong password / unprotected quiz.
CREATE OR REPLACE FUNCTION public.unlock_quiz(p_quiz_id uuid, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb := public._quiz_pw_check(p_quiz_id, p_password);
BEGIN
  IF r ->> 'status' = 'limited' THEN
    RAISE EXCEPTION 'quiz_password_rate_limited' USING DETAIL = (r ->> 'retry_after');
  END IF;
  IF r ->> 'status' = 'ok' THEN
    RETURN jsonb_build_object('stored', r ->> 'stored', 'data', r -> 'data');
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_quiz_password(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlock_quiz(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_quiz_password(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_quiz(uuid, text) TO anon, authenticated;

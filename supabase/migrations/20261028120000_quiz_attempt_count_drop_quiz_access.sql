-- Quiz attempt counter + removal of the unused quiz_access table.
--
-- 1. quizzes.attempt_count: total number of times a quiz was submitted.
--    Normal students never sign in, so this is a plain running total (no
--    per-user de-duplication). It is incremented ONLY through
--    increment_quiz_attempt(), so anonymous clients never need UPDATE
--    rights on the quizzes table.
--
-- 2. quiz_access: private quizzes are secured by quizzes.password only; no
--    quiz ever used the allowed-emails / is_private / password_hash columns
--    and nothing in the codebase reads or writes this table.

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS attempt_count bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_quiz_attempt(p_quiz_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.quizzes
  SET attempt_count = attempt_count + 1
  WHERE id = p_quiz_id;
$$;

REVOKE ALL ON FUNCTION public.increment_quiz_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_quiz_attempt(uuid) TO anon, authenticated;

DROP TABLE IF EXISTS public.quiz_access;

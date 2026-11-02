-- Lesson view counter (mirrors quizzes.attempt_count / increment_quiz_attempt).
-- Plain running total, no per-user de-duplication beyond a client-side
-- once-per-session guard. Only touched through the two functions below so
-- anonymous clients never need UPDATE rights on public.lessons.

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS view_count bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_lesson_view(p_lesson_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.lessons SET view_count = view_count + 1 WHERE id = p_lesson_id;
$$;

CREATE OR REPLACE FUNCTION public.get_lesson_view_count(p_lesson_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT view_count FROM public.lessons WHERE id = p_lesson_id;
$$;

REVOKE ALL ON FUNCTION public.increment_lesson_view(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_lesson_view_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_lesson_view(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_lesson_view_count(uuid) TO anon, authenticated;

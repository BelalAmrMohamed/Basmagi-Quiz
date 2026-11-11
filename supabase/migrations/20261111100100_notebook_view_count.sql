-- Notebook view counter (mirrors lessons.view_count). Only touched through the
-- two functions below so anonymous clients never need UPDATE rights.

ALTER TABLE public.notebooks
  ADD COLUMN IF NOT EXISTS view_count bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_notebook_view(p_notebook_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.notebooks SET view_count = view_count + 1 WHERE id = p_notebook_id;
$$;

CREATE OR REPLACE FUNCTION public.get_notebook_view_count(p_notebook_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT view_count FROM public.notebooks WHERE id = p_notebook_id;
$$;

REVOKE ALL ON FUNCTION public.increment_notebook_view(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_notebook_view_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_notebook_view(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_notebook_view_count(uuid) TO anon, authenticated;

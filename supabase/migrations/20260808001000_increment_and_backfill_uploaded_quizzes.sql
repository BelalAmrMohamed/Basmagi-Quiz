-- Create RPC to atomically increment uploaded_quizzes and backfill existing counts

BEGIN;

-- 1) Create function to atomically increment uploaded_quizzes for an admin
CREATE OR REPLACE FUNCTION public.increment_uploaded_quizzes(p_admin_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.admin_users
  SET uploaded_quizzes = COALESCE(uploaded_quizzes, 0) + 1
  WHERE id = p_admin_id;
END;
$$;

-- 2) Backfill uploaded_quizzes from existing quizzes table
-- Note: quizzes.uploaded_by should reference admin_users.id
UPDATE public.admin_users au
SET uploaded_quizzes = COALESCE(q.count, 0)
FROM (
  SELECT uploaded_by, COUNT(id) AS count
  FROM public.quizzes
  WHERE uploaded_by IS NOT NULL
  GROUP BY uploaded_by
) q
WHERE au.id = q.uploaded_by;

COMMIT;

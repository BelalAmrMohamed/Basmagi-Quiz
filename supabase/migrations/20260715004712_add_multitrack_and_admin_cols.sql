-- Admin identity extensions
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS handle text UNIQUE;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS display_name text;

-- Quizzes multi-track and owner extensions
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS college text;
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS year text;
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS term text;
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES public.admin_users(id);

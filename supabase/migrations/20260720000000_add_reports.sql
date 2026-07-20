-- Create reports table to track quiz reports
CREATE TABLE IF NOT EXISTS public.reports (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    quiz_id uuid REFERENCES public.quizzes(id) ON DELETE CASCADE,
    question_index integer,
    reason text NOT NULL,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
    resolved_by_admin_id uuid REFERENCES public.admin_users(id),
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT reports_pkey PRIMARY KEY (id)
);

-- Add stats columns to admin_users for public profile sharing
ALTER TABLE public.admin_users
ADD COLUMN IF NOT EXISTS total_points integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_quizzes integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_badges integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_level integer DEFAULT 1;

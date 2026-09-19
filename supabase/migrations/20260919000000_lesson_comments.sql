CREATE TABLE public.lesson_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  resolved_at timestamptz
);
CREATE INDEX lesson_comments_lesson_created_idx ON public.lesson_comments (lesson_id, created_at DESC);
CREATE INDEX lesson_comments_status_idx ON public.lesson_comments (status, created_at DESC);
ALTER TABLE public.lesson_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_resolved_lesson_comments" ON public.lesson_comments FOR SELECT TO public USING (status = 'resolved');
COMMENT ON TABLE public.lesson_comments IS 'Anonymous Student questions/comments on lessons; status mirrors reports.';

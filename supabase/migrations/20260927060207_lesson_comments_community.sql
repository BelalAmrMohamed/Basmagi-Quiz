-- =============================================================================
-- Lesson comments -> "مجتمع الدرس" (lesson community discussion), Phase 4.
-- =============================================================================

ALTER TABLE public.lesson_comments
  ADD COLUMN user_profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN parent_id uuid REFERENCES public.lesson_comments(id) ON DELETE CASCADE,
  ADD COLUMN edited_at timestamptz,
  ADD COLUMN deleted_at timestamptz;

COMMENT ON COLUMN public.lesson_comments.user_profile_id IS
  'Server-verified author (from the user-profile JWT''s profileId claim). NULL for pre-Phase-4 rows or a profile that was later deleted.';
COMMENT ON COLUMN public.lesson_comments.parent_id IS
  'Nullable self-reference for one level of replies. A reply''s parent_id must belong to the same lesson_id as the reply itself (enforced in api/college-quiz.js, not here, since a cross-lesson check needs the parent row''s lesson_id at insert time).';
COMMENT ON COLUMN public.lesson_comments.edited_at IS
  'Set when the author edits their own comment body. NULL if never edited.';
COMMENT ON COLUMN public.lesson_comments.deleted_at IS
  'Soft delete: set by the author (own comment) or an admin (moderation), never a hard DELETE, so replies to a removed comment aren''t orphaned. A soft-deleted comment''s body is not returned to the client — see api/college-quiz.js.';

CREATE INDEX lesson_comments_parent_idx ON public.lesson_comments (parent_id);
CREATE INDEX lesson_comments_profile_idx ON public.lesson_comments (user_profile_id);

CREATE TABLE public.lesson_comment_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.lesson_comments(id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (comment_id, user_profile_id)
);
CREATE INDEX lesson_comment_reactions_comment_idx ON public.lesson_comment_reactions (comment_id);
ALTER TABLE public.lesson_comment_reactions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.lesson_comment_reactions IS
  'One "helpful" reaction per (comment, profile). Toggled by re-submitting (insert if absent, delete if present) — see api/college-quiz.js.';

CREATE TABLE public.lesson_comment_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.lesson_comments(id) ON DELETE CASCADE,
  user_profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  resolved_at timestamptz
);
CREATE INDEX lesson_comment_reports_status_idx ON public.lesson_comment_reports (status, created_at DESC);
CREATE INDEX lesson_comment_reports_comment_idx ON public.lesson_comment_reports (comment_id);
ALTER TABLE public.lesson_comment_reports ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.lesson_comment_reports IS
  'Reports against a lesson comment, reviewed by admins. Independent of the comment''s own moderation status.';

DROP POLICY "public_read_resolved_lesson_comments" ON public.lesson_comments;
CREATE POLICY "public_read_resolved_lesson_comments" ON public.lesson_comments
  FOR SELECT TO public
  USING (status = 'resolved' AND deleted_at IS NULL);
;

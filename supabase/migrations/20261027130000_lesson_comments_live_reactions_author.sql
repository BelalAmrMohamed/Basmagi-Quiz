-- Publish lesson-community comments immediately and store verified staff
-- author snapshots so their identity remains stable in the public thread.
DROP POLICY IF EXISTS "public_read_resolved_lesson_comments" ON public.lesson_comments;
DROP POLICY IF EXISTS "public_read_lesson_comments" ON public.lesson_comments;

-- Preserve moderator removals from the former queue while publishing any
-- comments that were waiting for approval.
UPDATE public.lesson_comments
SET deleted_at = COALESCE(deleted_at, timezone('utc', now()))
WHERE status = 'dismissed';

ALTER TABLE public.lesson_comments
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS resolved_at,
  ADD COLUMN admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  ADD COLUMN author_role text NOT NULL DEFAULT 'student'
    CHECK (author_role IN ('student', 'admin', 'developer')),
  ADD COLUMN author_name text,
  ADD COLUMN author_handle text,
  ADD COLUMN author_profile_url text,
  ADD COLUMN author_avatar_url text,
  ADD COLUMN author_thumbnail_url text,
  ADD COLUMN author_bio text,
  ADD CONSTRAINT lesson_comments_single_author_identity
    CHECK (user_profile_id IS NULL OR admin_user_id IS NULL);

UPDATE public.lesson_comments
SET author_role = 'student'
WHERE author_role IS NULL;

CREATE INDEX IF NOT EXISTS lesson_comments_admin_idx
  ON public.lesson_comments (admin_user_id);

CREATE POLICY "public_read_lesson_comments" ON public.lesson_comments
  FOR SELECT TO public
  USING (deleted_at IS NULL);

-- A single identity may hold one reaction per comment and switch between
-- like/dislike; the API toggles the matching partial unique key.
ALTER TABLE public.lesson_comment_reactions
  ALTER COLUMN user_profile_id DROP NOT NULL,
  ADD COLUMN admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE CASCADE,
  ADD COLUMN admin_actor_key text,
  ADD COLUMN reaction text NOT NULL DEFAULT 'like'
    CHECK (reaction IN ('like', 'dislike')),
  DROP CONSTRAINT IF EXISTS lesson_comment_reactions_comment_id_user_profile_id_key,
  ADD CONSTRAINT lesson_comment_reactions_single_actor
    CHECK (num_nonnulls(user_profile_id, admin_user_id, admin_actor_key) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS lesson_comment_reactions_profile_unique
  ON public.lesson_comment_reactions (comment_id, user_profile_id)
  WHERE user_profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lesson_comment_reactions_admin_unique
  ON public.lesson_comment_reactions (comment_id, admin_user_id)
  WHERE admin_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lesson_comment_reactions_admin_actor_unique
  ON public.lesson_comment_reactions (comment_id, admin_actor_key)
  WHERE admin_actor_key IS NOT NULL;

COMMENT ON COLUMN public.lesson_comments.author_role IS
  'Verified author category snapshot. Admin and developer profile data is copied at post time for display in the public lesson discussion.';
COMMENT ON COLUMN public.lesson_comments.admin_user_id IS
  'Authenticated staff author when a matching admin_users row exists; NULL for students and owner identities without a database row.';
COMMENT ON COLUMN public.lesson_comment_reactions.reaction IS
  'The actor''s current reaction to the comment: like or dislike.';
COMMENT ON TABLE public.lesson_comments IS
  'Public lesson discussion. New comments appear immediately; deleted comments remain as soft-delete tombstones.';

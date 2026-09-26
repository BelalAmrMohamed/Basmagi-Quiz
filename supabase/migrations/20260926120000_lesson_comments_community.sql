-- =============================================================================
-- Lesson comments -> "مجتمع الدرس" (lesson community discussion), Phase 4.
--
-- Extends the existing anonymous, moderated lesson_comments table (see
-- 20260919000000_lesson_comments.sql) with what a real discussion thread
-- needs: replies, reactions, author ownership for edit/delete, and reports.
-- Does NOT change the existing moderation model — status stays
-- pending/resolved/dismissed, and only 'resolved' rows are publicly
-- readable. Nothing here weakens that gate.
--
-- Author identity: there is no student login on this platform. The only
-- server-verified identity a commenter has is the anonymous per-device
-- profile already minted by /api/user-profile/identify (see
-- api/user-profile.js) — a JWT with role:"user" and a profileId claim that
-- is ALWAYS the database row id, never anything the client sent. That is
-- what "ownership" means here: a comment's user_profile_id is set
-- server-side from that verified JWT at insert time, and every
-- edit/delete/react/report check compares against it — never against a
-- client-supplied id. Displayed publicly as "Student" (or "Student #n" for
-- a thread), matching the current UI, since user_profiles has no display
-- name (only admin_users/authors do — see 20260909120000_admin_users_bio.sql).
-- =============================================================================

-- ── Author identity + replies + soft delete on the existing table ──────────

ALTER TABLE public.lesson_comments
  ADD COLUMN user_profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN parent_id uuid REFERENCES public.lesson_comments(id) ON DELETE CASCADE,
  ADD COLUMN edited_at timestamptz,
  ADD COLUMN deleted_at timestamptz;

-- Existing pre-Phase-4 rows have no author — leave user_profile_id NULL
-- rather than backfilling a fake owner; they simply can't be edited/deleted
-- by anyone (server-side ownership checks below require a match, and NULL
-- never matches a real profileId).

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

-- Reasonable nesting limit (plan step 4.1): one level of replies. Enforced
-- in the API (reject a submission whose parent_id already has a parent_id)
-- rather than in SQL, since a CHECK constraint can't see other rows.

-- ── Reactions ────────────────────────────────────────────────────────────────
-- One reaction type ("helpful") per plan step 4.2 ("like/helpful, one per
-- user per comment, no duplicates") — a single unique constraint gives us
-- that for free without a reaction_type column we don't yet need.

CREATE TABLE public.lesson_comment_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.lesson_comments(id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (comment_id, user_profile_id)
);
CREATE INDEX lesson_comment_reactions_comment_idx ON public.lesson_comment_reactions (comment_id);
ALTER TABLE public.lesson_comment_reactions ENABLE ROW LEVEL SECURITY;
-- No public SELECT policy: reaction counts are read via the comments list
-- endpoint (service role, aggregated server-side in api/college-quiz.js),
-- same pattern as lesson_comments itself. Nothing needs to query this
-- table directly from the browser.
COMMENT ON TABLE public.lesson_comment_reactions IS
  'One "helpful" reaction per (comment, profile). Toggled by re-submitting (insert if absent, delete if present) — see api/college-quiz.js.';

-- ── Reports ──────────────────────────────────────────────────────────────────
-- Deliberately a separate table from the existing `reports` table (which is
-- quiz/question-shaped: quiz_id + question_index) rather than forcing this
-- into that schema — a comment report has a different subject entirely.

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
-- No public SELECT/INSERT policy: reports are write-only from the client's
-- perspective (service role inserts on submit, admin-only reads via the
-- existing requireAdmin() JWT check), same pattern as `reports`.
COMMENT ON TABLE public.lesson_comment_reports IS
  'Reports against a lesson comment, reviewed by admins. Independent of the comment''s own moderation status.';

-- ── Public read policy update ────────────────────────────────────────────────
-- Replace the old policy so a soft-deleted comment (deleted_at IS NOT NULL)
-- stops being publicly readable even if its status was already 'resolved'
-- at the time it was deleted.

DROP POLICY "public_read_resolved_lesson_comments" ON public.lesson_comments;
CREATE POLICY "public_read_resolved_lesson_comments" ON public.lesson_comments
  FOR SELECT TO public
  USING (status = 'resolved' AND deleted_at IS NULL);

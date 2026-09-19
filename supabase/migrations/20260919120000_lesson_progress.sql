-- =============================================================================
-- lesson_progress — cross-device sync for lesson reading progress
-- (docs/plans/lessons-feature-plan.md, Phase 4a "cross-device sync" branch).
--
-- Deliberately separate from everything under the quiz points/level system:
-- no FK, trigger, or code path here ever touches user_profiles.
-- passed_quizzes_count / current_level. A lesson is never scored — see the
-- plan's ground rules and the comment on public.lessons itself.
--
-- Identity: the same `user_profiles.id` (device-identity JWT, minted by
-- api/user-profile.js?action=identify) used for quiz progress sync is
-- reused here as profile_id, so a reader has exactly ONE cross-device
-- identity for the whole app rather than a second one invented for
-- lessons. The JWT's `role: "user"` / `profileId` claims are verified
-- independently by the Edge Function (supabase/functions/lesson-progress)
-- using the same JWT_SECRET — no new auth scheme.
--
-- One row per (profile, lesson): a lesson is complete or it isn't, so
-- there's nothing to store per-section here — the per-section detail
-- (`visitedSections`, per-question answers) stays local-only in
-- localStorage exactly as today; only the *completed* signal leaves the
-- device, and only once a reader has visited every section (see the
-- Edge Function's completion check, mirroring
-- public/src/features/home/lesson-progress.js::isLessonComplete).
-- =============================================================================

CREATE TABLE public.lesson_progress (
  profile_id uuid NOT NULL REFERENCES public.user_profiles (id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.lessons (id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (profile_id, lesson_id)
);

CREATE INDEX lesson_progress_profile_id_idx ON public.lesson_progress (profile_id);
CREATE INDEX lesson_progress_lesson_id_idx ON public.lesson_progress (lesson_id);

COMMENT ON TABLE public.lesson_progress IS
  'Cross-device completion sync for lessons. One row per (profile, lesson) '
  'once every section has been visited on any device. Never wired into '
  'passed_quizzes_count/current_level/points — lessons are not scored.';
COMMENT ON COLUMN public.lesson_progress.profile_id IS
  'Same user_profiles.id used for quiz progress sync (device-identity JWT) '
  '— one cross-device identity for the whole app, not a lesson-specific one.';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- No public policies: this table is only ever read/written by the
-- lesson-progress Edge Function using the service role key, exactly like
-- user_profiles itself (see 20260828051811_user_profiles_server_side_identity.sql).
-- The Edge Function independently verifies the caller's JWT before touching
-- this table, so RLS staying closed-by-default here is intentional, not an
-- oversight.
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

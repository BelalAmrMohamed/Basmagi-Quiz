-- =============================================================================
-- user_profiles — server-side identity + level for regular (non-admin) users.
--
-- Added to support the AI Helper's "Level 10+ unlocks platform API keys"
-- rule (see api/ai-agent/chat.js). Regular users have no login in this app
-- — they're anonymous, tracked client-side via localStorage
-- (public/src/shared/userProfile.js). `device_id` is a random UUID minted
-- once on first visit and persisted client-side (see
-- public/src/shared/userLevel.js), sent to /api/user-profile/identify to
-- get/create this row and mint a short-lived JWT.
--
-- `current_level` here is SERVER-COMPUTED from `passed_quizzes_count`
-- (see api/user-profile/_levelMath.js) — never trust a client-sent level
-- number, since a bare device_id is trivially forgeable/replayable. This
-- keeps the door open for spoofing passed_quizzes_count too (there's no
-- hardware attestation here), but at least removes the single-line
-- "just claim level 10" vulnerability of trusting the field outright.
-- A future iteration could tie this to a real account (email OTP / OAuth)
-- for a stronger guarantee; this table's shape doesn't need to change for
-- that, only how device_id/ownership is established.
-- =============================================================================
CREATE TABLE public.user_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL UNIQUE,
  passed_quizzes_count integer NOT NULL DEFAULT 0,
  current_level integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id)
);
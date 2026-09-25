-- =============================================================================
-- AI Agent platform-key access: replace the old "Level 10+ or admin" hard
-- gate (see git history of api/ai-agent/chat.js) with "everyone, subject to
-- a daily usage cap that resets at UTC midnight". Admins remain uncapped.
--
-- Tracked on user_profiles because every caller — including anonymous,
-- never-logged-in students — already gets a row there via
-- /api/user-profile/identify (see public/src/shared/userLevel.js), so this
-- needs no new identity concept. Two columns rather than a separate table:
-- one profile has at most one "today" counter, so there's nothing to
-- normalize, and this keeps the read/increment a single-row UPDATE.
--
-- `ai_agent_usage_date` is a plain date (UTC), not a timestamp — comparing
-- it to CURRENT_DATE is how the counter "resets daily" without a cron job:
-- api/ai-agent/chat.js's increment_ai_agent_usage() RPC just zeroes the
-- count first whenever the stored date isn't today.
-- =============================================================================
ALTER TABLE public.user_profiles
  ADD COLUMN ai_agent_usage_count integer NOT NULL DEFAULT 0,
  ADD COLUMN ai_agent_usage_date date NOT NULL DEFAULT (timezone('utc'::text, now()))::date;

-- Atomically checks-and-increments a profile's daily counter, rolling it
-- over to 0 first if the stored date isn't today (UTC). Done as a single
-- RPC (rather than chat.js's usual read-then-write pattern, see
-- sync-progress in api/user-profile.js) specifically because this one is a
-- concurrency-sensitive quota check: two overlapping requests from the same
-- profile both reading count=4/limit=5 and both proceeding would let a
-- user exceed the cap. A single UPDATE ... RETURNING is atomic per-row in
-- Postgres, which a JS-level read-then-write can't guarantee under
-- concurrent requests.
CREATE OR REPLACE FUNCTION public.increment_ai_agent_usage(
  p_profile_id uuid,
  p_daily_limit integer
)
RETURNS TABLE(allowed boolean, usage_count integer) AS $$
DECLARE
  v_today date := (timezone('utc'::text, now()))::date;
  v_count integer;
BEGIN
  UPDATE public.user_profiles
  SET
    ai_agent_usage_count = CASE
      WHEN ai_agent_usage_date = v_today THEN ai_agent_usage_count + 1
      ELSE 1
    END,
    ai_agent_usage_date = v_today
  WHERE id = p_profile_id
  RETURNING ai_agent_usage_count INTO v_count;

  IF v_count IS NULL THEN
    -- No such profile — treat as "not allowed" rather than raising, so a
    -- forged/stale profileId in an otherwise-valid JWT fails closed.
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  RETURN QUERY SELECT (v_count <= p_daily_limit), v_count;
END;
$$ LANGUAGE plpgsql;

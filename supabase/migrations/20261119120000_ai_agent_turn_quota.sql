-- =============================================================================
-- AI Agent: the daily quota now counts once per USER MESSAGE ("turn"), not once
-- per model round-trip. The client sends one turnId (uuid) per user message;
-- the first request of a turn charges the daily counter, later requests of the
-- same turn are free while the turn is still live (under p_max_steps steps and
-- under p_turn_ttl old). A client that reuses one turnId forever therefore
-- gains nothing beyond one turn's worth of steps.
--
-- Additive: the old increment_ai_agent_usage() stays in place (the API falls
-- back to it when a request has no valid turnId, e.g. an old cached front-end).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.ai_agent_turns (
  profile_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  turn_id    uuid NOT NULL,
  steps      integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, turn_id)
);
CREATE INDEX IF NOT EXISTS ai_agent_turns_started_at_idx ON public.ai_agent_turns (started_at);
ALTER TABLE public.ai_agent_turns ENABLE ROW LEVEL SECURITY;  -- no policies: service role only

CREATE OR REPLACE FUNCTION public.increment_ai_agent_usage_turn(
  p_profile_id uuid,
  p_turn_id uuid,
  p_daily_limit integer,
  p_max_steps integer DEFAULT 60,
  p_turn_ttl interval DEFAULT interval '15 minutes'
)
RETURNS TABLE(allowed boolean, usage_count integer, charged boolean) AS $$
DECLARE
  v_today date := (timezone('utc'::text, now()))::date;
  v_count integer;
  v_steps integer;
BEGIN
  -- Opportunistic cleanup so the table never grows without a cron job.
  IF random() < 0.02 THEN
    DELETE FROM public.ai_agent_turns WHERE started_at < now() - interval '2 days';
  END IF;

  -- 1) Continuation of a live turn: a free step.
  UPDATE public.ai_agent_turns t
     SET steps = t.steps + 1
   WHERE t.profile_id = p_profile_id AND t.turn_id = p_turn_id
     AND t.steps < p_max_steps AND t.started_at > now() - p_turn_ttl
  RETURNING t.steps INTO v_steps;

  IF v_steps IS NOT NULL THEN
    SELECT CASE WHEN up.ai_agent_usage_date = v_today THEN up.ai_agent_usage_count ELSE 0 END
      INTO v_count FROM public.user_profiles up WHERE up.id = p_profile_id;
    RETURN QUERY SELECT true, COALESCE(v_count, 0), false;
    RETURN;
  END IF;

  -- 2) New (or expired / over-long) turn: charge one unit atomically, only if
  --    under the limit. Denied attempts do NOT keep incrementing the counter.
  UPDATE public.user_profiles up
     SET ai_agent_usage_count = CASE WHEN up.ai_agent_usage_date = v_today THEN up.ai_agent_usage_count + 1 ELSE 1 END,
         ai_agent_usage_date  = v_today
   WHERE up.id = p_profile_id
     AND (up.ai_agent_usage_date <> v_today OR up.ai_agent_usage_count < p_daily_limit)
  RETURNING up.ai_agent_usage_count INTO v_count;

  IF v_count IS NULL THEN
    SELECT CASE WHEN up.ai_agent_usage_date = v_today THEN up.ai_agent_usage_count ELSE 0 END
      INTO v_count FROM public.user_profiles up WHERE up.id = p_profile_id;
    RETURN QUERY SELECT false, COALESCE(v_count, 0), false;   -- at the limit, or no such profile
    RETURN;
  END IF;

  INSERT INTO public.ai_agent_turns (profile_id, turn_id, steps, started_at)
  VALUES (p_profile_id, p_turn_id, 1, now())
  ON CONFLICT (profile_id, turn_id) DO UPDATE SET steps = 1, started_at = now();

  RETURN QUERY SELECT true, v_count, true;
END;
$$ LANGUAGE plpgsql;

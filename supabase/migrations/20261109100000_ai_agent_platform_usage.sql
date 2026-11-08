-- =============================================================================
-- AI Agent: platform-wide usage metering for the shared free-tier API keys.
--
-- Google's free-tier (AI Studio) keys cannot report their own remaining quota:
-- neither the Gemini API responses nor any API-key endpoint exposes it (quota
-- is only visible in AI Studio / Cloud Console, which needs a human login). So
-- the platform meters its own platform-key requests, per provider, per weekly
-- window (Monday 00:00 UTC), and /api/ai-agent/usage turns that into the
-- "X% left / resets in …" display in the chat input's model menu.
--
-- Counts requests only (never content). Own-key requests are NOT counted — they
-- don't touch the shared pool.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.ai_agent_platform_usage (
  provider      text    NOT NULL,
  window_start  date    NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, window_start)
);

-- Server-only table: the API uses the service key, which bypasses RLS. With RLS
-- on and no policies, anon/authenticated clients cannot read or write it.
ALTER TABLE public.ai_agent_platform_usage ENABLE ROW LEVEL SECURITY;

-- Atomic upsert-increment (one statement, so concurrent requests never lose a count).
CREATE OR REPLACE FUNCTION public.bump_ai_agent_platform_usage(
  p_provider text,
  p_window_start date
)
RETURNS integer AS $$
  INSERT INTO public.ai_agent_platform_usage AS u (provider, window_start, request_count)
  VALUES (p_provider, p_window_start, 1)
  ON CONFLICT (provider, window_start)
  DO UPDATE SET request_count = u.request_count + 1
  RETURNING u.request_count;
$$ LANGUAGE sql;

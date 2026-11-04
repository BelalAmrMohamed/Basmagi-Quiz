-- Site-wide analytics for the public "المنصة بالأرقام" section on about.html.
--
-- Privacy-first and aggregate-only:
--   * analytics_daily     one row per Cairo calendar day with the page-view count.
--   * analytics_presence  one row per *anonymous* visitor hash, only used to answer
--                         "how many people are online right now". The hash is an HMAC of
--                         (UTC day | IP | user-agent) computed in api/_analytics.js, so the
--                         raw IP is never stored and the hash rotates every day.
--
-- Both tables are RLS-locked with no policies: browsers can never read or write them with
-- the anon key. Writes go through the two SECURITY DEFINER functions below, which are
-- executable by service_role only (the API server), so nobody can inflate the counters
-- straight from the public anon key. Reads go through analytics_live_stats(), which only
-- returns aggregates and is safe to expose to anon.

CREATE TABLE IF NOT EXISTS public.analytics_daily (
  day   date   PRIMARY KEY,
  views bigint NOT NULL DEFAULT 0 CHECK (views >= 0)
);

CREATE TABLE IF NOT EXISTS public.analytics_presence (
  visitor   text        PRIMARY KEY,
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_presence_last_seen_idx
  ON public.analytics_presence (last_seen);

ALTER TABLE public.analytics_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_daily, public.analytics_presence FROM anon, authenticated;

COMMENT ON TABLE public.analytics_daily IS
  'Page views per Cairo calendar day for the whole platform. Written only by analytics_track_view() '
  '(service_role), read only through analytics_live_stats(). Powers the live counter and 30-day '
  'sparkline on about.html.';
COMMENT ON TABLE public.analytics_presence IS
  'Anonymous, daily-rotating visitor hashes with their last activity time, used only for the '
  '"online now" count (visitors active in the last 5 minutes). Rows older than 1 hour are purged '
  'opportunistically by analytics_track_view(). No raw IPs, no cookies.';

-- Records one page view (and marks the visitor as online).
CREATE OR REPLACE FUNCTION public.analytics_track_view(p_visitor text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  INSERT INTO public.analytics_daily (day, views)
  VALUES (v_today, 1)
  ON CONFLICT (day) DO UPDATE SET views = public.analytics_daily.views + 1;

  IF p_visitor IS NOT NULL AND length(p_visitor) BETWEEN 8 AND 64 THEN
    INSERT INTO public.analytics_presence (visitor, last_seen)
    VALUES (p_visitor, now())
    ON CONFLICT (visitor) DO UPDATE SET last_seen = now();
  END IF;

  -- Cheap housekeeping: ~2% of calls drop stale presence rows.
  IF random() < 0.02 THEN
    DELETE FROM public.analytics_presence WHERE last_seen < now() - interval '1 hour';
  END IF;
END;
$$;

-- Keeps a visitor "online" while a tab stays open (no extra page view).
CREATE OR REPLACE FUNCTION public.analytics_heartbeat(p_visitor text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_visitor IS NOT NULL AND length(p_visitor) BETWEEN 8 AND 64 THEN
    INSERT INTO public.analytics_presence (visitor, last_seen)
    VALUES (p_visitor, now())
    ON CONFLICT (visitor) DO UPDATE SET last_seen = now();
  END IF;
END;
$$;

-- Aggregates for about.html: all-time total, today (Cairo), online now, last 30 days (zero-filled).
CREATE OR REPLACE FUNCTION public.analytics_live_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  RETURN jsonb_build_object(
    'totalViews', COALESCE((SELECT sum(views)::bigint FROM public.analytics_daily), 0),
    'viewsToday', COALESCE((SELECT views FROM public.analytics_daily WHERE day = v_today), 0),
    'onlineNow',  (SELECT count(*)::int FROM public.analytics_presence
                    WHERE last_seen > now() - interval '5 minutes'),
    'daily', (
      SELECT jsonb_agg(
               jsonb_build_object('day', d.day, 'views', COALESCE(a.views, 0))
               ORDER BY d.day)
      FROM (SELECT (v_today - (29 - g.n))::date AS day FROM generate_series(0, 29) AS g(n)) d
      LEFT JOIN public.analytics_daily a ON a.day = d.day
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_track_view(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_heartbeat(text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_live_stats()     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_track_view(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_heartbeat(text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_live_stats()     TO anon, authenticated, service_role;

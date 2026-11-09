-- Adds unique visitor tracking to site-wide analytics.
--
-- Privacy-first and aggregate-only:
--   * analytics_daily: now tracks both daily views and daily unique visitors.
--   * analytics_daily_visitors: stores daily-rotating visitor hashes for the current Cairo day
--     to accurately deduplicate daily unique visitors. Older entries (>35 days) are purged
--     automatically during housekeeping.

ALTER TABLE public.analytics_daily
  ADD COLUMN IF NOT EXISTS visitors bigint NOT NULL DEFAULT 0 CHECK (visitors >= 0);

CREATE TABLE IF NOT EXISTS public.analytics_daily_visitors (
  day     date NOT NULL,
  visitor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, visitor)
);

CREATE INDEX IF NOT EXISTS analytics_daily_visitors_day_idx
  ON public.analytics_daily_visitors (day);

ALTER TABLE public.analytics_daily_visitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_daily_visitors FROM anon, authenticated;

-- Updates analytics_track_view to record both views and unique visitors.
CREATE OR REPLACE FUNCTION public.analytics_track_view(p_visitor text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  -- Record the page view
  INSERT INTO public.analytics_daily (day, views, visitors)
  VALUES (v_today, 1, 0)
  ON CONFLICT (day) DO UPDATE SET views = public.analytics_daily.views + 1;

  IF p_visitor IS NOT NULL AND length(p_visitor) BETWEEN 8 AND 64 THEN
    -- Check and record unique visitor for today
    INSERT INTO public.analytics_daily_visitors (day, visitor)
    VALUES (v_today, p_visitor)
    ON CONFLICT (day, visitor) DO NOTHING;

    IF FOUND THEN
      UPDATE public.analytics_daily
      SET visitors = visitors + 1
      WHERE day = v_today;
    END IF;

    -- Update live presence
    INSERT INTO public.analytics_presence (visitor, last_seen)
    VALUES (p_visitor, now())
    ON CONFLICT (visitor) DO UPDATE SET last_seen = now();
  END IF;

  -- Opportunistic housekeeping (~2% of calls): drop stale presence and visitors older than 35 days
  IF random() < 0.02 THEN
    DELETE FROM public.analytics_presence WHERE last_seen < now() - interval '1 hour';
    DELETE FROM public.analytics_daily_visitors WHERE day < v_today - 35;
  END IF;
END;
$$;

-- Aggregates for about.html: unique visitors, views, online now, and 30-day sparkline.
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
    'totalVisitors', COALESCE((SELECT sum(visitors)::bigint FROM public.analytics_daily), 0),
    'visitorsToday', COALESCE((SELECT visitors FROM public.analytics_daily WHERE day = v_today), 0),
    'totalViews',    COALESCE((SELECT sum(views)::bigint FROM public.analytics_daily), 0),
    'viewsToday',    COALESCE((SELECT views FROM public.analytics_daily WHERE day = v_today), 0),
    'onlineNow',     (SELECT count(*)::int FROM public.analytics_presence
                      WHERE last_seen > now() - interval '5 minutes'),
    'daily', (
      SELECT jsonb_agg(
               jsonb_build_object(
                 'day', d.day,
                 'visitors', COALESCE(a.visitors, 0),
                 'views', COALESCE(a.views, 0)
               )
               ORDER BY d.day)
      FROM (SELECT (v_today - (29 - g.n))::date AS day FROM generate_series(0, 29) AS g(n)) d
      LEFT JOIN public.analytics_daily a ON a.day = d.day
    )
  );
END;
$$;

-- Seed known unique visitor counts for the past 7 days from Vercel Analytics (Nov 2 - Nov 8, 2026)
-- so the 30-day sparkline immediately shows accurate historical visitor numbers.
INSERT INTO public.analytics_daily (day, views, visitors)
VALUES
  ('2026-11-02', 0, 115),
  ('2026-11-03', 0, 80),
  ('2026-11-04', 0, 28),
  ('2026-11-05', 0, 52),
  ('2026-11-06', 0, 38),
  ('2026-11-07', 0, 42),
  ('2026-11-08', 0, 103)
ON CONFLICT (day) DO UPDATE
SET visitors = GREATEST(public.analytics_daily.visitors, EXCLUDED.visitors);


-- Beacon heartbeat moved from 2 min to 4 min (fewer function calls); widen the
-- "online now" window from 5 to 7 minutes so one missed beat doesn't drop visitors.
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
                      WHERE last_seen > now() - interval '7 minutes'),
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

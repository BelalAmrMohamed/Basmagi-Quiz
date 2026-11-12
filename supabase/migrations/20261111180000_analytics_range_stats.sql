-- Flexible date range for the "الزوار الفريدون" chart on about.html.
--
-- analytics_live_stats() keeps its fixed 30-day window (still used by older clients).
-- analytics_range_stats(p_from, p_to) returns the same aggregate-only shape for any
-- window of up to 731 days, zero-filled per Cairo calendar day, plus the window totals.
-- Safe for anon: it only returns aggregates, never visitor hashes.

CREATE OR REPLACE FUNCTION public.analytics_range_stats(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_to    date := LEAST(COALESCE(p_to, v_today), v_today);
  v_from  date := COALESCE(p_from, v_to - 29);
BEGIN
  IF v_from > v_to THEN
    v_from := v_to;
  END IF;
  IF v_to - v_from > 730 THEN
    v_from := v_to - 730;
  END IF;

  RETURN jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'rangeVisitors', COALESCE((SELECT sum(visitors)::bigint FROM public.analytics_daily
                               WHERE day BETWEEN v_from AND v_to), 0),
    'rangeViews',    COALESCE((SELECT sum(views)::bigint FROM public.analytics_daily
                               WHERE day BETWEEN v_from AND v_to), 0),
    'firstDay',      (SELECT min(day) FROM public.analytics_daily WHERE visitors > 0),
    'daily', (
      SELECT jsonb_agg(
               jsonb_build_object(
                 'day', d.day,
                 'visitors', COALESCE(a.visitors, 0),
                 'views', COALESCE(a.views, 0)
               )
               ORDER BY d.day)
      FROM (SELECT g::date AS day FROM generate_series(v_from, v_to, interval '1 day') AS g) d
      LEFT JOIN public.analytics_daily a ON a.day = d.day
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_range_stats(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_range_stats(date, date) TO anon, authenticated, service_role;

-- Seeds the live counter with history from Vercel Analytics (page views Oct 28 - Nov 4, 2026).
-- Dated outside the 30-day sparkline window so the chart is not distorted.
INSERT INTO public.analytics_daily (day, views)
VALUES ('2026-09-01', 2059)
ON CONFLICT (day) DO UPDATE SET views = public.analytics_daily.views + EXCLUDED.views;

-- Storage guard for uploaded media (all pages) + the notebook-assets bucket.
--
-- Only the API server (service_role) can reserve space or write rows here. Every upload is
-- reserved BEFORE bytes are sent, so a full quota refuses media only; quiz / lesson / notebook
-- JSON rows are never touched by this guard and keep saving at the cap.
-- Supabase free plan: 1 GB file storage, 5 GB egress, 500 MB database (separate meters).

CREATE TABLE IF NOT EXISTS public.storage_limits (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cap_bytes      bigint NOT NULL DEFAULT 838860800,   -- 800 MB (~20% under the 1 GB quota)
  max_file_bytes bigint NOT NULL DEFAULT 2097152,     -- 2 MB per file
  warn_pct       int    NOT NULL DEFAULT 80 CHECK (warn_pct BETWEEN 1 AND 100)
);
INSERT INTO public.storage_limits (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.storage_objects (
  bucket     text   NOT NULL,
  path       text   NOT NULL,
  size       bigint NOT NULL CHECK (size > 0),
  kind       text   NOT NULL DEFAULT 'image',
  owner      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, path)
);

ALTER TABLE public.storage_limits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_limits, public.storage_objects FROM anon, authenticated;

COMMENT ON TABLE public.storage_objects IS
  'Ledger of every media object uploaded through the storage guard (running total = sum(size)). '
  'Written only by storage_reserve()/storage_release() (service_role).';

-- Public-read bucket; NO insert policy, so only signed upload URLs issued by the admin API can write.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('notebook-assets', 'notebook-assets', true, 2097152, ARRAY['image/png','image/jpeg','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/gif'];

CREATE OR REPLACE FUNCTION public.storage_reserve(p_bucket text, p_path text, p_size bigint, p_kind text, p_owner text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lim public.storage_limits%ROWTYPE;
  used bigint;
  v_max bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(7770001);
  SELECT * INTO lim FROM public.storage_limits WHERE id = 1;
  IF EXISTS (SELECT 1 FROM public.storage_objects WHERE bucket = p_bucket AND path = p_path) THEN
    RETURN jsonb_build_object('ok', true, 'exists', true);
  END IF;
  IF p_size IS NULL OR p_size < 1 THEN RETURN jsonb_build_object('ok', false, 'reason', 'empty_file'); END IF;
  -- images (and anything else) use the configurable limit; audio/video keep the platform's existing caps.
  v_max := CASE p_kind WHEN 'audio' THEN 10485760 WHEN 'video' THEN 52428800 ELSE lim.max_file_bytes END;
  IF p_size > v_max THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'file_too_large', 'max_file_bytes', v_max);
  END IF;
  SELECT COALESCE(sum(size), 0) INTO used FROM public.storage_objects;
  IF used + p_size > lim.cap_bytes THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap_reached', 'used', used, 'cap', lim.cap_bytes);
  END IF;
  INSERT INTO public.storage_objects (bucket, path, size, kind, owner) VALUES (p_bucket, p_path, p_size, COALESCE(p_kind, 'image'), p_owner);
  RETURN jsonb_build_object('ok', true, 'exists', false, 'used', used + p_size, 'cap', lim.cap_bytes);
END; $$;

CREATE OR REPLACE FUNCTION public.storage_release(p_bucket text, p_paths text[])
RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM public.storage_objects WHERE bucket = p_bucket AND path = ANY(p_paths) RETURNING 1)
  SELECT count(*)::int FROM d;
$$;

CREATE OR REPLACE FUNCTION public.storage_usage()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'used', COALESCE((SELECT sum(size) FROM public.storage_objects), 0),
    'objects', (SELECT count(*) FROM public.storage_objects),
    'cap', l.cap_bytes, 'maxFile', l.max_file_bytes, 'warnPct', l.warn_pct)
  FROM public.storage_limits l WHERE l.id = 1;
$$;

-- Tracked objects (older than 1 h) that no quiz, lesson, notebook or trash snapshot mentions.
CREATE OR REPLACE FUNCTION public.storage_orphans()
RETURNS TABLE (bucket text, path text, size bigint, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.bucket, o.path, o.size, o.created_at FROM public.storage_objects o
  WHERE o.created_at < now() - interval '1 hour'
    AND NOT EXISTS (SELECT 1 FROM public.quizzes   x WHERE x::text LIKE '%' || o.path || '%')
    AND NOT EXISTS (SELECT 1 FROM public.lessons   x WHERE x::text LIKE '%' || o.path || '%')
    AND NOT EXISTS (SELECT 1 FROM public.notebooks x WHERE x::text LIKE '%' || o.path || '%')
    AND NOT EXISTS (SELECT 1 FROM public.trash_items x WHERE x::text LIKE '%' || o.path || '%')
  ORDER BY o.created_at;
$$;

REVOKE ALL ON FUNCTION public.storage_reserve(text, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storage_release(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storage_usage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storage_orphans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_reserve(text, text, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.storage_release(text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.storage_usage() TO service_role;
GRANT EXECUTE ON FUNCTION public.storage_orphans() TO service_role;

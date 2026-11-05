-- Temporary workspace files attached to MCP notebook drafts (private bucket, expire with the 72 h draft).
-- They are tracked in the same ledger as every other upload (storage_objects) so they count against the media cap,
-- with a sub-cap for drafts so a burst of drafts can never fill the whole quota.

ALTER TABLE public.storage_limits ADD COLUMN IF NOT EXISTS draft_cap_bytes bigint NOT NULL DEFAULT 157286400; -- 150 MB

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('draft-assets', 'draft-assets', false, 10485760, ARRAY['image/png','image/jpeg','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/gif'];

CREATE OR REPLACE FUNCTION public.storage_reserve(p_bucket text, p_path text, p_size bigint, p_kind text, p_owner text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lim public.storage_limits%ROWTYPE;
  used bigint;
  v_max bigint;
  draft_used bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(7770001);
  SELECT * INTO lim FROM public.storage_limits WHERE id = 1;
  IF EXISTS (SELECT 1 FROM public.storage_objects WHERE bucket = p_bucket AND path = p_path) THEN
    RETURN jsonb_build_object('ok', true, 'exists', true);
  END IF;
  IF p_size IS NULL OR p_size < 1 THEN RETURN jsonb_build_object('ok', false, 'reason', 'empty_file'); END IF;
  -- images (and anything else) use the configurable limit; audio/video/draft files keep their own caps.
  v_max := CASE p_kind WHEN 'audio' THEN 10485760 WHEN 'video' THEN 52428800 WHEN 'draft' THEN 10485760 ELSE lim.max_file_bytes END;
  IF p_size > v_max THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'file_too_large', 'max_file_bytes', v_max);
  END IF;
  IF p_kind = 'draft' THEN
    SELECT COALESCE(sum(size), 0) INTO draft_used FROM public.storage_objects
      WHERE bucket = p_bucket AND path LIKE split_part(p_path, '/', 1) || '/%';
    IF draft_used + p_size > 20971520 THEN  -- 20 MB per draft
      RETURN jsonb_build_object('ok', false, 'reason', 'draft_too_large', 'used', draft_used);
    END IF;
    SELECT COALESCE(sum(size), 0) INTO draft_used FROM public.storage_objects WHERE bucket = p_bucket;
    IF draft_used + p_size > lim.draft_cap_bytes THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'draft_cap_reached', 'used', draft_used, 'cap', lim.draft_cap_bytes);
    END IF;
  END IF;
  SELECT COALESCE(sum(size), 0) INTO used FROM public.storage_objects;
  IF used + p_size > lim.cap_bytes THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap_reached', 'used', used, 'cap', lim.cap_bytes);
  END IF;
  INSERT INTO public.storage_objects (bucket, path, size, kind, owner) VALUES (p_bucket, p_path, p_size, COALESCE(p_kind, 'image'), p_owner);
  RETURN jsonb_build_object('ok', true, 'exists', false, 'used', used + p_size, 'cap', lim.cap_bytes);
END; $$;

-- Live draft files must never be offered for admin cleanup: exclude the draft bucket.
CREATE OR REPLACE FUNCTION public.storage_orphans()
RETURNS TABLE (bucket text, path text, size bigint, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.bucket, o.path, o.size, o.created_at FROM public.storage_objects o
  WHERE o.bucket <> 'draft-assets'
    AND o.created_at < now() - interval '1 hour'
    AND NOT EXISTS (SELECT 1 FROM public.quizzes   x WHERE x::text LIKE '%' || o.path || '%')
    AND NOT EXISTS (SELECT 1 FROM public.lessons   x WHERE x::text LIKE '%' || o.path || '%')
    AND NOT EXISTS (SELECT 1 FROM public.notebooks x WHERE x::text LIKE '%' || o.path || '%')
    AND NOT EXISTS (SELECT 1 FROM public.trash_items x WHERE x::text LIKE '%' || o.path || '%')
  ORDER BY o.created_at;
$$;

-- Draft files whose draft expired or was removed (the caller deletes the objects, then calls storage_release).
CREATE OR REPLACE FUNCTION public.draft_assets_to_purge()
RETURNS TABLE (path text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.path FROM public.storage_objects o
  WHERE o.bucket = 'draft-assets'
    AND NOT EXISTS (SELECT 1 FROM public.import_drafts d WHERE d.code = split_part(o.path, '/', 1) AND d.expires_at > now());
$$;

REVOKE ALL ON FUNCTION public.draft_assets_to_purge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.draft_assets_to_purge() TO service_role;
GRANT EXECUTE ON FUNCTION public.storage_orphans() TO service_role;
GRANT EXECUTE ON FUNCTION public.storage_reserve(text, text, bigint, text, text) TO service_role;

-- =============================================================================
-- Notification preferences: each admin can mute noisy notification types.
-- `admin_users.notification_muted` holds the muted `type` values. A muted type is
-- simply never stored for that admin (push + broadcast both honour it), so the
-- milestone triggers in 20261127120000 respect it without any change.
-- `welcome` and `storage_warning` can never be muted (the API also refuses them).
-- Un-muting only affects notifications created from then on.
-- =============================================================================

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS notification_muted text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.push_admin_notification(
  p_recipient  uuid,
  p_type       text,
  p_title      text,
  p_body       text  DEFAULT NULL,
  p_href       text  DEFAULT NULL,
  p_meta       jsonb DEFAULT '{}'::jsonb,
  p_group_key  text  DEFAULT NULL,
  p_dedupe_key text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_muted text[];
BEGIN
  SELECT notification_muted INTO v_muted FROM public.admin_users WHERE id = p_recipient;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Muted by the admin (welcome / storage_warning are never mutable).
  IF p_type NOT IN ('welcome', 'storage_warning') AND p_type = ANY (COALESCE(v_muted, '{}'::text[])) THEN
    RETURN NULL;
  END IF;

  IF p_dedupe_key IS NOT NULL THEN
    INSERT INTO public.admin_notifications (recipient_admin_id, type, title, body, href, meta, dedupe_key)
    VALUES (p_recipient, p_type, p_title, p_body, p_href, COALESCE(p_meta, '{}'::jsonb), p_dedupe_key)
    ON CONFLICT (recipient_admin_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;

  ELSIF p_group_key IS NOT NULL THEN
    INSERT INTO public.admin_notifications (recipient_admin_id, type, title, body, href, meta, group_key)
    VALUES (p_recipient, p_type, p_title, p_body, p_href, COALESCE(p_meta, '{}'::jsonb), p_group_key)
    ON CONFLICT (recipient_admin_id, group_key) WHERE group_key IS NOT NULL AND read_at IS NULL
    DO UPDATE SET
      count      = public.admin_notifications.count + 1,
      title      = EXCLUDED.title,
      body       = EXCLUDED.body,
      href       = COALESCE(EXCLUDED.href, public.admin_notifications.href),
      meta       = public.admin_notifications.meta || EXCLUDED.meta,
      updated_at = now()
    RETURNING id INTO v_id;

  ELSE
    INSERT INTO public.admin_notifications (recipient_admin_id, type, title, body, href, meta)
    VALUES (p_recipient, p_type, p_title, p_body, p_href, COALESCE(p_meta, '{}'::jsonb))
    RETURNING id INTO v_id;
  END IF;

  DELETE FROM public.admin_notifications
   WHERE recipient_admin_id = p_recipient
     AND read_at IS NOT NULL
     AND type <> 'welcome'
     AND updated_at < now() - interval '90 days';

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.broadcast_admin_notification(
  p_type       text,
  p_title      text,
  p_body       text  DEFAULT NULL,
  p_href       text  DEFAULT NULL,
  p_meta       jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text  DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  WITH ins AS (
    INSERT INTO public.admin_notifications (recipient_admin_id, type, title, body, href, meta, dedupe_key)
    SELECT a.id, p_type, p_title, p_body, p_href, COALESCE(p_meta, '{}'::jsonb), p_dedupe_key
      FROM public.admin_users a
     WHERE p_type IN ('welcome', 'storage_warning')
        OR NOT (p_type = ANY (COALESCE(a.notification_muted, '{}'::text[])))
    ON CONFLICT (recipient_admin_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_n FROM ins;
  RETURN v_n;
END;
$$;

-- CREATE OR REPLACE keeps the grants from the previous migration; restated for safety.
REVOKE ALL ON FUNCTION public.push_admin_notification(uuid, text, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_admin_notification(text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_admin_notification(uuid, text, text, text, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_admin_notification(text, text, text, text, jsonb, text) TO service_role;

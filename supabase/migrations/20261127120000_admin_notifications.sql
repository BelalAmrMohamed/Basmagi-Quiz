-- =============================================================================
-- Admin notification center.
-- One row per notification per admin. Only the API server (service_role) reads
-- or writes the table; no public RLS policies (same pattern as admin_requests).
-- `type` + `count` + `meta` drive the wording on the client; title/body are the
-- plain-text fallback (and the whole message for announcements).
--   group_key  -> while the existing row is UNREAD, a new event with the same key
--                 bumps `count` and moves the row to the top (bulk uploads, reports).
--   dedupe_key -> the event is stored at most once, ever (welcome, milestones, daily warning).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_admin_id uuid NOT NULL REFERENCES public.admin_users (id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type ~ '^[a-z][a-z_]{1,39}$'),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body               text CHECK (body IS NULL OR char_length(body) <= 1000),
  -- Internal paths only ("/reports"); never "//host" or a full URL.
  href               text CHECK (href IS NULL OR (char_length(href) <= 500 AND href ~ '^/([^/\\]|$)')),
  meta               jsonb NOT NULL DEFAULT '{}'::jsonb,
  count              integer NOT NULL DEFAULT 1 CHECK (count >= 1),
  group_key          text CHECK (group_key IS NULL OR char_length(group_key) <= 200),
  dedupe_key         text CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 200),
  read_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_notifications_inbox_idx
  ON public.admin_notifications (recipient_admin_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS admin_notifications_unread_idx
  ON public.admin_notifications (recipient_admin_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admin_notifications_dedupe_uidx
  ON public.admin_notifications (recipient_admin_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admin_notifications_open_group_uidx
  ON public.admin_notifications (recipient_admin_id, group_key)
  WHERE group_key IS NOT NULL AND read_at IS NULL;

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_notifications FROM anon, authenticated;

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
BEGIN
  IF p_recipient IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = p_recipient) THEN
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

  -- Housekeeping: read items older than 90 days go away (unread and the welcome message stay).
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
    ON CONFLICT (recipient_admin_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_n FROM ins;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.push_admin_notification(uuid, text, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_admin_notification(text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_admin_notification(uuid, text, text, text, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_admin_notification(text, text, text, text, jsonb, text) TO service_role;

-- View / attempt milestones: same signatures, SECURITY DEFINER and anon grants as the
-- originals (CREATE OR REPLACE keeps the grants); only the milestone check is added.
CREATE OR REPLACE FUNCTION public.admin_notification_milestone(p_count bigint)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_count = ANY (ARRAY[50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]::bigint[]);
$$;

CREATE OR REPLACE FUNCTION public.increment_quiz_attempt(p_quiz_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint; v_owner uuid; v_title text; v_meta_id text;
BEGIN
  UPDATE public.quizzes SET attempt_count = attempt_count + 1 WHERE id = p_quiz_id
  RETURNING attempt_count, uploaded_by, title, data #>> '{meta,id}'
       INTO v_count, v_owner, v_title, v_meta_id;

  IF v_owner IS NOT NULL AND public.admin_notification_milestone(v_count) THEN
    PERFORM public.push_admin_notification(
      v_owner, 'milestone', v_title, v_count || ' محاولة',
      CASE WHEN v_meta_id IS NULL THEN NULL ELSE '/quiz/' || v_meta_id END,
      jsonb_build_object('kind', 'quiz', 'metric', 'attempts', 'value', v_count, 'itemTitle', v_title),
      NULL, 'milestone:quiz:' || p_quiz_id || ':' || v_count);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_lesson_view(p_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint; v_owner uuid; v_title text;
BEGIN
  UPDATE public.lessons SET view_count = view_count + 1 WHERE id = p_lesson_id
  RETURNING view_count, created_by, title INTO v_count, v_owner, v_title;

  IF v_owner IS NOT NULL AND public.admin_notification_milestone(v_count) THEN
    PERFORM public.push_admin_notification(
      v_owner, 'milestone', v_title, v_count || ' مشاهدة', '/lesson/' || p_lesson_id,
      jsonb_build_object('kind', 'lesson', 'metric', 'views', 'value', v_count, 'itemTitle', v_title),
      NULL, 'milestone:lesson:' || p_lesson_id || ':' || v_count);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_notebook_view(p_notebook_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint; v_owner uuid; v_title text;
BEGIN
  UPDATE public.notebooks SET view_count = view_count + 1 WHERE id = p_notebook_id
  RETURNING view_count, created_by, title INTO v_count, v_owner, v_title;

  IF v_owner IS NOT NULL AND public.admin_notification_milestone(v_count) THEN
    PERFORM public.push_admin_notification(
      v_owner, 'milestone', v_title, v_count || ' مشاهدة', '/notebook/' || p_notebook_id,
      jsonb_build_object('kind', 'notebook', 'metric', 'views', 'value', v_count, 'itemTitle', v_title),
      NULL, 'milestone:notebook:' || p_notebook_id || ':' || v_count);
  END IF;
END;
$$;

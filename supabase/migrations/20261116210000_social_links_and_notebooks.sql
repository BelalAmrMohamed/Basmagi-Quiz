-- =============================================================================
-- 1. admin_users.social_links — Connected social links (LinkedIn, GitHub,
--    Telegram, WhatsApp) for admins.
--
-- 2. admin_users.uploaded_notebooks — Live notebooks created by this admin/dev,
--    maintained by a trigger on public.notebooks (mirrors uploaded_lessons).
-- =============================================================================

-- ── 1. Social links ──────────────────────────────────────────────────────────
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.admin_users.social_links IS
  'Social profile links (linkedin, github, telegram, whatsapp) for admins. Shown at the top of their profile.';

-- ── 2. Uploaded notebooks ────────────────────────────────────────────────────
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS uploaded_notebooks integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.admin_users.uploaded_notebooks IS
  'Number of live notebooks created by this admin/dev (notebooks.created_by). Maintained by trigger notebooks_sync_uploaded_notebooks_trigger; never written by the API.';

CREATE OR REPLACE FUNCTION public.notebooks_sync_uploaded_notebooks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NOT NULL THEN
      UPDATE public.admin_users
         SET uploaded_notebooks = uploaded_notebooks + 1
       WHERE id = NEW.created_by;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.created_by IS NOT NULL THEN
      UPDATE public.admin_users
         SET uploaded_notebooks = GREATEST(uploaded_notebooks - 1, 0)
       WHERE id = OLD.created_by;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      IF OLD.created_by IS NOT NULL THEN
        UPDATE public.admin_users
           SET uploaded_notebooks = GREATEST(uploaded_notebooks - 1, 0)
         WHERE id = OLD.created_by;
      END IF;
      IF NEW.created_by IS NOT NULL THEN
        UPDATE public.admin_users
           SET uploaded_notebooks = uploaded_notebooks + 1
         WHERE id = NEW.created_by;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notebooks_sync_uploaded_notebooks_trigger ON public.notebooks;
CREATE TRIGGER notebooks_sync_uploaded_notebooks_trigger
  AFTER INSERT OR DELETE OR UPDATE OF created_by ON public.notebooks
  FOR EACH ROW EXECUTE FUNCTION public.notebooks_sync_uploaded_notebooks();

-- ── Backfill existing notebooks ──────────────────────────────────────────────
UPDATE public.admin_users a
   SET uploaded_notebooks = c.n
  FROM (
    SELECT created_by, count(*)::integer AS n
      FROM public.notebooks
     WHERE created_by IS NOT NULL
     GROUP BY created_by
  ) c
 WHERE a.id = c.created_by;

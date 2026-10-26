-- Persist a private, verified staff identity key so owner/developer accounts
-- without an admin_users row can edit only the comments they authored.
ALTER TABLE public.lesson_comments
  ADD COLUMN IF NOT EXISTS author_actor_key text;

COMMENT ON COLUMN public.lesson_comments.author_actor_key IS
  'Private lower-cased staff token email used only for server-side comment ownership checks; never returned by the public API.';

-- =============================================================================
-- Digest ("quiet") mode: a quiet type is still stored and shown in the list, but it
-- never counts toward the bell badge. Muted wins if a type is in both arrays.
-- New admins start quiet for low-urgency types; existing admins keep what they had
-- (the column is added with an empty default, and only THEN is the default changed).
-- =============================================================================

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS notification_quiet text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.admin_users
  ALTER COLUMN notification_quiet SET DEFAULT ARRAY['upload', 'level_up', 'badge']::text[];

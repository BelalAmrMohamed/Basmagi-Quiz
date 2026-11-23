-- =============================================================================
-- Admin membership requests — allows students to request being added as admins.
-- Reviewed by the platform owner on the developer control panel (control.html).
-- The admin API (api/admin.js) handles submission (public) and review (owner-only).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.admin_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  full_name   text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 100),
  college     text CHECK (college IS NULL OR char_length(college) <= 200),
  reason      text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  notes       text CHECK (notes IS NULL OR char_length(notes) <= 500),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_requests_status_idx
  ON public.admin_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_requests_email_idx
  ON public.admin_requests (email);

ALTER TABLE public.admin_requests ENABLE ROW LEVEL SECURITY;

-- No public RLS policies: all access goes through the service-role client
-- in api/admin.js. This matches the admin_users management pattern.

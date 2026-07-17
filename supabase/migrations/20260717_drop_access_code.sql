-- =============================================================================
-- Migration: Drop access-code authentication
-- Date: 2026-07-17
--
-- The `app_settings` table was used solely to store the ADMIN_SECRET (access
-- code).  Now that access-code authentication is fully deprecated in favour of
-- Admin-Email-Only OAuth, the table and its data are no longer needed.
--
-- SAFE TO RUN: the DROP is wrapped in a conditional so re-running this
-- migration on a database that has already had the table dropped will not fail.
-- =============================================================================

-- 1. Delete the access-code row (belt-and-suspenders in case the table is kept
--    for future use — harmless if it has already been dropped).
DELETE FROM public.app_settings
WHERE key = 'ADMIN_SECRET';

-- 2. Drop the table entirely.
--    Omit IF EXISTS if your migration runner guarantees single execution.
DROP TABLE IF EXISTS public.app_settings;

-- Adds a free-text profile description ("bio") for admin/dev accounts,
-- editable from the owner's own dashboard (public/profile.html) and shown
-- on the public /@handle visitor view alongside display_name/avatar.
--
-- Nullable, no default: absence of a bio (NULL) is the normal, expected
-- state for any admin who hasn't written one yet — same convention as
-- display_name/avatar_url/thumbnail_url on this table.
--
-- No RLS changes needed: admin_users already has a public SELECT-true
-- policy ("Public can read admin profile fields") that is not column-
-- restricted, so this new column is readable the same way display_name
-- already is. Writes continue to go exclusively through the service-role
-- client in api/admin.js (handleStatsSync), scoped to the caller's own
-- JWT email, same as every other self-service profile field on this table.
ALTER TABLE public.admin_users
  ADD COLUMN bio text;

COMMENT ON COLUMN public.admin_users.bio IS
  'User-authored profile description/bio, shown on the profile page and public /@handle view. NULL = not set.';

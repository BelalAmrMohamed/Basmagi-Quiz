-- The read policy on youtube_public (20261120120000) only applies if the roles
-- may SELECT the table. Projects that revoke default privileges on public
-- tables (like notebook_public / lesson_public here) need an explicit grant,
-- otherwise the course page quietly lists no published YouTube items.
GRANT SELECT ON public.youtube_public TO anon, authenticated;

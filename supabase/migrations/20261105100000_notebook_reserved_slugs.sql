-- /notebook/new and /notebook/edit/<id> are page routes, so they can never be notebook slugs.
-- NOT VALID: applies to new/changed rows without scanning (or failing on) existing data.
ALTER TABLE public.notebooks
  ADD CONSTRAINT notebooks_slug_not_reserved
  CHECK (slug IS NULL OR lower(slug) NOT IN ('new', 'edit')) NOT VALID;

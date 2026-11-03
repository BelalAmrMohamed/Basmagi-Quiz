-- =============================================================================
-- notebooks — executable MATLAB-style notebooks, a sibling leaf to `quizzes`
-- and `lessons` under the same Course → Folder tree
-- (see docs/plans/matlab-notebook-integration.md, Phase 1).
--
-- Modeled on 20260915000000_lessons.sql: course_id is denormalized next to
-- folder_id and kept consistent by a trigger, and updated_at is written
-- explicitly by the API (no auto-update trigger, same convention).
--
-- Design decisions:
--   * `runtime` is ONE authoritative column and is deliberately NOT given a
--     default: unknown runtimes must be rejected, never silently coerced to
--     MATLAB. Launch scope is 'matlab' only; a future runtime is added by
--     widening the CHECK in a later migration.
--   * `content` is the versioned document { schemaVersion, cells: [...] }.
--     Learner outputs / workspace state are never stored here.
--   * `migration_key` is a stable idempotency key for the seed/import of the
--     ten compiler lessons (scripts/seed-notebooks.mjs). NULL for notebooks
--     authored in the platform. It is internal and not exposed publicly.
--   * Notebooks are never scored: no attempts, no result page, no points.
-- =============================================================================

CREATE TABLE public.notebooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES public.courses (id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.folders (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  source text,
  slug text,
  runtime text NOT NULL CHECK (runtime IN ('matlab')),
  content jsonb NOT NULL CHECK (
    jsonb_typeof(content) = 'object'
    AND (content->>'schemaVersion') = '1'
    AND jsonb_typeof(content->'cells') = 'array'
  ),
  migration_key text,
  sort_order integer,
  created_by uuid REFERENCES public.admin_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX notebooks_course_id_idx ON public.notebooks (course_id);
CREATE INDEX notebooks_folder_id_idx ON public.notebooks (folder_id);
CREATE INDEX notebooks_created_by_created_at_idx ON public.notebooks (created_by, created_at DESC);
CREATE UNIQUE INDEX notebooks_slug_unique_idx
  ON public.notebooks (slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX notebooks_migration_key_unique_idx
  ON public.notebooks (migration_key) WHERE migration_key IS NOT NULL;

-- If a notebook has a folder_id, that folder's course_id must equal the
-- notebook's course_id (mirrors lessons_enforce_course_consistency).
CREATE OR REPLACE FUNCTION public.notebooks_enforce_course_consistency()
RETURNS trigger AS $$
DECLARE
  parent_course uuid;
BEGIN
  IF NEW.folder_id IS NOT NULL THEN
    SELECT course_id INTO parent_course FROM public.folders WHERE id = NEW.folder_id;
    IF parent_course IS NULL THEN
      RAISE EXCEPTION 'folder_id % does not exist', NEW.folder_id;
    END IF;
    IF NEW.course_id IS NULL THEN
      NEW.course_id := parent_course;
    ELSIF NEW.course_id <> parent_course THEN
      RAISE EXCEPTION 'notebook.course_id (%) must match its folder''s course_id (%)',
        NEW.course_id, parent_course;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notebooks_course_consistency_trigger
  BEFORE INSERT OR UPDATE ON public.notebooks
  FOR EACH ROW EXECUTE FUNCTION public.notebooks_enforce_course_consistency();

COMMENT ON TABLE public.notebooks IS
  'An executable MATLAB-style notebook: a sibling leaf next to quizzes and lessons in the course/folder tree. Never scored; learner work is local to the browser.';
COMMENT ON COLUMN public.notebooks.runtime IS
  'Authoritative runtime id. Only ''matlab'' (the browser-based educational MATLAB-style subset) is supported; there is intentionally no default.';
COMMENT ON COLUMN public.notebooks.content IS
  'Versioned JSON document: { "schemaVersion": 1, "cells": [ { "id", "type": "markdown"|"code", "source" } ] }. Authored source only; never learner outputs.';
COMMENT ON COLUMN public.notebooks.migration_key IS
  'Stable idempotency key for seeded/migrated notebooks (e.g. matlab-compiler:section-1). Internal; not exposed through notebook_public.';
COMMENT ON COLUMN public.notebooks.sort_order IS
  'Optional explicit ordering among siblings (used to preserve the order of the ten migrated compiler lessons).';

-- ─── RLS / read boundary ─────────────────────────────────────────────────────
ALTER TABLE public.notebooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read" ON public.notebooks;
CREATE POLICY "public_read"
  ON public.notebooks FOR SELECT
  TO public
  USING (true);

-- Public reads go through this view, which exposes only published-safe
-- columns (no migration_key). Direct table SELECT is limited to the same
-- safe columns via a column grant.
DROP VIEW IF EXISTS public.notebook_public;
CREATE VIEW public.notebook_public
WITH (security_invoker = false) AS
SELECT
  id,
  slug,
  title,
  description,
  source,
  runtime,
  course_id,
  folder_id,
  sort_order,
  created_by,
  created_at,
  updated_at,
  content,
  COALESCE(jsonb_array_length(content->'cells'), 0) AS cell_count
FROM public.notebooks;

GRANT SELECT ON public.notebook_public TO anon, authenticated;

REVOKE ALL ON public.notebooks FROM anon, authenticated;
GRANT SELECT (
  id, slug, title, description, source, runtime, course_id, folder_id,
  sort_order, created_by, created_at, updated_at, content
) ON public.notebooks TO anon, authenticated;

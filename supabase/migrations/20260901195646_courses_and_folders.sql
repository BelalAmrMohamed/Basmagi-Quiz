-- =============================================================================
-- courses & folders — first-class, relational replacement for the implicit
-- "subject" path segment + single joined "subfolder" string that
-- api/upload-quiz.js used to be the only source of truth for nesting.
--
-- Why this exists:
--   The old model stored nesting as a path string (University/College/Year/
--   Term/Subject[/Subfolder]) parsed back into a tree at *read* time by
--   scripts/lib/quizPath.js's parseDbPath() — courses and folders were never
--   rows, just implied segments. That meant: no folder/course id to attach
--   metadata (icon, created_by, created_at) to, no way to represent more than
--   one subfolder level without string-joining it away, and "is this course
--   at the top level" was unenforceable (it was just "however deep the path
--   happens to be").
--
-- What changes:
--   - `courses` is the new top-level unit (replaces "subject" as a real
--     row). A course can ONLY exist at the top level: it has no parent_id of
--     any kind by construction (there is no column for one), which is a
--     stronger guarantee than a nullable-but-optional parent would be.
--   - `folders` nest under a course (required `course_id`) and optionally
--     under another folder (`parent_folder_id`, NULL = direct child of the
--     course) — arbitrarily deep, unlike the old flattened `subfolder`
--     string.
--   - `quizzes` gains nullable `course_id` / `folder_id` FKs. A quiz row
--     with `folder_id` set implies it is (transitively) under that
--     folder's course too; `course_id` is still stored directly for cheap
--     "everything in this course" queries without walking the folder tree.
--
-- Backward compatibility:
--   The legacy `path` / `category` / `subject` / `subfolder` columns on
--   `quizzes` are NOT removed or repurposed here. They continue to be
--   populated on every write (see api/upload-quiz.js) as denormalized
--   mirrors of the relational data, so:
--     - Existing rows (uploaded before this migration) keep working exactly
--       as before — they simply have NULL course_id/folder_id and are read
--       via the legacy path-parsing fallback that already existed.
--     - Any reader not yet migrated to the relational shape (reports.js,
--       admin.js's category count, etc.) keeps functioning unchanged.
--   This is intentionally an additive migration — nothing existing is
--   dropped or renamed, so it can ship without a coordinated read-path
--   cutover.
-- =============================================================================

-- ─── courses ────────────────────────────────────────────────────────────────
-- One row per (education_type, college, year, term, name) slot — the same
-- "slot" the old subject/category columns identified, just as a real object
-- now. No parent_id column at all: a course is top-level by construction,
-- not by a nullable field that could accidentally be set.
CREATE TABLE public.courses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  education_type text NOT NULL,
  college text NULL,        -- University track only
  year integer NULL,        -- University/Primary/Middle/High tracks only
  term integer NULL,        -- University/Primary/Middle/High tracks only
  icon text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT courses_pkey PRIMARY KEY (id),
  CONSTRAINT courses_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.admin_users (id) ON DELETE SET NULL,
  CONSTRAINT courses_education_type_check CHECK (
    education_type IN ('University', 'Primary', 'Middle', 'High', 'Featured')
  ),
  -- Same uniqueness the old path model enforced implicitly (a given
  -- subject name was one folder per track/year/term slot). NULLs in
  -- college/year/term (e.g. Featured track) are treated as distinct-safe
  -- by Postgres's standard NULL-not-equal-NULL semantics, matching the old
  -- behavior where Featured courses had no college/year/term segments at all.
  CONSTRAINT courses_unique_slot UNIQUE (education_type, college, year, term, name)
);

CREATE INDEX courses_education_type_idx ON public.courses (education_type);

COMMENT ON TABLE public.courses IS
  'Top-level quiz groupings (formerly the implicit "subject" path segment). '
  'No parent column by design — courses cannot be nested, matching the rule '
  'that courses only exist at the root.';

-- ─── folders ────────────────────────────────────────────────────────────────
-- Nested under a course, optionally under another folder. Unlimited depth
-- via the self-referencing parent_folder_id.
CREATE TABLE public.folders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  parent_folder_id uuid NULL,
  name text NOT NULL,
  icon text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT folders_pkey PRIMARY KEY (id),
  CONSTRAINT folders_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES public.courses (id) ON DELETE CASCADE,
  CONSTRAINT folders_parent_folder_id_fkey FOREIGN KEY (parent_folder_id)
    REFERENCES public.folders (id) ON DELETE CASCADE,
  CONSTRAINT folders_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.admin_users (id) ON DELETE SET NULL,
  -- Sibling folders under the same parent (course-level or folder-level)
  -- must have distinct names — mirrors the duplicate-name-suffix guard the
  -- client already applies for the local userQuizzes folder tree.
  CONSTRAINT folders_unique_name_per_parent UNIQUE (course_id, parent_folder_id, name)
);

CREATE INDEX folders_course_id_idx ON public.folders (course_id);
CREATE INDEX folders_parent_folder_id_idx ON public.folders (parent_folder_id);

COMMENT ON TABLE public.folders IS
  'Nested folders under a course. parent_folder_id NULL = direct child of '
  'the course; non-NULL = nested under another folder, to arbitrary depth. '
  'A folder always belongs to exactly one course via course_id, even when '
  'deeply nested, so "everything under this course" never requires walking '
  'the folder tree.';

-- A folder's course_id must actually match its parent folder's course_id
-- (a folder cannot silently "jump" to a different course than its parent
-- via a mismatched course_id) — enforced with a trigger since Postgres
-- foreign keys can't cross-reference a second column on the same row's
-- self-referencing parent.
CREATE OR REPLACE FUNCTION public.folders_enforce_course_consistency()
RETURNS trigger AS $$
DECLARE
  parent_course uuid;
BEGIN
  IF NEW.parent_folder_id IS NOT NULL THEN
    SELECT course_id INTO parent_course FROM public.folders WHERE id = NEW.parent_folder_id;
    IF parent_course IS NULL THEN
      RAISE EXCEPTION 'parent_folder_id % does not exist', NEW.parent_folder_id;
    END IF;
    IF parent_course <> NEW.course_id THEN
      RAISE EXCEPTION 'folder.course_id (%) must match its parent folder''s course_id (%)',
        NEW.course_id, parent_course;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER folders_course_consistency_trigger
  BEFORE INSERT OR UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.folders_enforce_course_consistency();

-- ─── quizzes: relational placement columns ─────────────────────────────────
-- Nullable and additive — existing rows are unaffected (they simply have
-- NULL here and keep resolving their location from the legacy `path`
-- column, as before this migration).
ALTER TABLE public.quizzes
  ADD COLUMN course_id uuid NULL REFERENCES public.courses (id) ON DELETE SET NULL,
  ADD COLUMN folder_id uuid NULL REFERENCES public.folders (id) ON DELETE SET NULL;

CREATE INDEX quizzes_course_id_idx ON public.quizzes (course_id);
CREATE INDEX quizzes_folder_id_idx ON public.quizzes (folder_id);

-- Same cross-column consistency requirement as folders: if a quiz has a
-- folder_id, that folder's course_id must equal the quiz's own course_id.
-- A quiz with folder_id set but course_id NULL, or a mismatched pair, would
-- be ambiguous about which course it belongs to.
CREATE OR REPLACE FUNCTION public.quizzes_enforce_course_consistency()
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
      RAISE EXCEPTION 'quiz.course_id (%) must match its folder''s course_id (%)',
        NEW.course_id, parent_course;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quizzes_course_consistency_trigger
  BEFORE INSERT OR UPDATE ON public.quizzes
  FOR EACH ROW EXECUTE FUNCTION public.quizzes_enforce_course_consistency();

COMMENT ON COLUMN public.quizzes.course_id IS
  'Relational replacement for the old subject/category path segment. NULL '
  'on rows uploaded before this migration (or not yet backfilled) — those '
  'keep resolving their course from the legacy `path` column.';
COMMENT ON COLUMN public.quizzes.folder_id IS
  'Relational replacement for the old flattened `subfolder` string. NULL '
  'means the quiz sits directly under its course with no subfolder.';

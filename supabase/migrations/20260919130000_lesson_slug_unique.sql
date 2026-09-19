-- Backstop for validateLessonSlug() in api/admin.js: two lessons can't share a slug.
-- Partial (WHERE slug IS NOT NULL) because slug is optional and most rows leave it NULL.
-- If this fails to apply, existing duplicate slugs must be resolved first:
--   SELECT slug, count(*) FROM public.lessons WHERE slug IS NOT NULL GROUP BY slug HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS lessons_slug_unique_idx
  ON public.lessons (slug) WHERE slug IS NOT NULL;

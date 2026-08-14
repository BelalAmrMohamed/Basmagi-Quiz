-- =============================================================================
-- supabase/migrations/20260814_create_quiz_media_bucket.sql
--
-- Creates the `quiz-media` Storage bucket used to host question images and
-- audio files uploaded by admins through the Create-Quiz page.
--
-- Design decisions (free-tier friendly):
--   • Public bucket  — files are served directly via the Supabase CDN URL
--                      (no signed URLs → no extra round-trips / bandwidth).
--   • 10 MB max      — per-object cap covers large audio; images are expected
--                      to be < 3 MB in practice.
--   • MIME whitelist — enforced in the API layer (upload-media.js), but the
--                      bucket restricts MIME at the storage level too.
--   • Uploads go through /api/upload-media (service key), so the anon role
--                      has NO write access — only authenticated read via the
--                      public CDN URL.
--
-- Run this against your Supabase project once:
--   supabase db push  OR  paste into the SQL editor in the Supabase dashboard.
-- =============================================================================

-- ── 1. Create the bucket ─────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quiz-media',
  'quiz-media',
  true,                                    -- public: files are CDN-accessible
  10485760,                                -- 10 MB per file
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'audio/mpeg',           -- .mp3
    'audio/ogg',            -- .ogg
    'audio/wav',            -- .wav
    'audio/webm',           -- .webm audio
    'audio/aac'             -- .aac
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. RLS Policies ──────────────────────────────────────────────────────────
-- Uploads are performed server-side via the Supabase service key, which bypasses
-- RLS. Therefore we only need a public SELECT policy so the CDN URLs work.

-- Allow anyone to read (download) objects — required for <img> and <audio> tags.
CREATE POLICY "quiz-media: public read"
ON storage.objects
FOR SELECT
USING (bucket_id = 'quiz-media');

-- ── 3. Folder structure reference (not enforced by SQL) ───────────────────────
-- quiz-media/
--   images/          ← question images
--     <timestamp>-<random>.<ext>
--   audio/           ← question audio files
--     <timestamp>-<random>.<ext>
--
-- Timestamps + random suffix guarantee collision-free filenames without UUIDs.
-- =============================================================================

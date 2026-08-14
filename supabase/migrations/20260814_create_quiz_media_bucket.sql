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
--   • MIME whitelist — enforced at bucket level (Supabase rejects anything
--                      not in the list before it even touches storage).
--   • Direct browser upload — files go browser → Supabase Storage directly.
--                      No Vercel serverless function is needed, saving one
--                      slot on the Hobby plan (12-function limit).
--
-- Security model:
--   • SELECT (read)  — public. Required so <img> / <audio> CDN URLs work.
--   • INSERT (write) — authenticated Supabase users only.
--                      Admins log in via Supabase auth (email / OTP / SSO),
--                      so auth.uid() is non-null for them and null for guests.
--   • UPDATE/DELETE  — not granted (uploaded files are permanent; deletion
--                      can be done manually via the Supabase dashboard).
--
-- Run this against your Supabase project once:
--   Paste into Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Create the bucket ─────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quiz-media',
  'quiz-media',
  true,                                    -- public: CDN URLs work without auth
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
    'audio/aac',            -- .aac
    'audio/x-m4a',          -- .m4a (some browsers report this)
    'audio/mp4'             -- .m4a (alternative MIME)
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. RLS Policies ──────────────────────────────────────────────────────────

-- Allow anyone (including anonymous) to read — needed for <img>/<audio> tags.
CREATE POLICY "quiz-media: public read"
ON storage.objects
FOR SELECT
USING (bucket_id = 'quiz-media');

-- Allow authenticated Supabase users to upload.
-- Admins are always authenticated (they sign in via Supabase auth before
-- getting their admin JWT), so auth.uid() IS NOT NULL for all admins.
-- Regular (non-Supabase) visitors are unauthenticated, so this blocks them.
CREATE POLICY "quiz-media: authenticated upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'quiz-media');

-- ── 3. Folder structure reference (not enforced by SQL) ───────────────────────
-- quiz-media/
--   images/          ← question images
--     <uid>/<timestamp>-<random>.<ext>
--   audios/          ← question audio files
--     <uid>/<timestamp>-<random>.<ext>
--
-- Using the Supabase user's UID as a subfolder lets us add per-user
-- policies in the future (e.g. users can only delete their own uploads).
-- =============================================================================

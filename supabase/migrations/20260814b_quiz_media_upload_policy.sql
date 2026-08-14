-- =============================================================================
-- supabase/migrations/20260814b_quiz_media_upload_policy.sql
--
-- Addendum to 20260814_create_quiz_media_bucket.sql
--
-- Adds the INSERT (upload) RLS policy to the quiz-media bucket so that
-- authenticated Supabase users (admins) can upload directly from the browser.
--
-- Run this ONLY if you already ran the first migration and need to add the
-- upload policy separately.
-- =============================================================================

CREATE POLICY "quiz-media: authenticated upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'quiz-media');

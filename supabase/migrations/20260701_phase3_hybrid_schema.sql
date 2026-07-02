-- Phase 3.1 — Hybrid Storage & Schema Mapping
-- Run in Supabase SQL Editor (already applied by project owner).

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS education_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quizzes_education_type_check'
  ) THEN
    ALTER TABLE public.quizzes
      ADD CONSTRAINT quizzes_education_type_check
      CHECK (education_type IN ('Primary','Middle','High','University','Featured'));
  END IF;
END $$;

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS password text;

UPDATE public.quizzes
SET education_type = 'University'
WHERE education_type IS NULL;

UPDATE public.quizzes
SET password = data->'meta'->>'password'
WHERE password IS NULL
  AND data->'meta'->>'password' IS NOT NULL;

UPDATE public.quizzes
SET data = jsonb_set(data, '{meta}', (data->'meta') - 'password')
WHERE password IS NOT NULL
  AND data->'meta' ? 'password';

CREATE INDEX IF NOT EXISTS idx_quizzes_education_type
  ON public.quizzes (education_type);

-- Note: synced quizzes cannot recover plain passwords from the hash column alone.

-- Supabase-DB-context.sql | Last updated on version `v6.1` (auth refactor)
-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
--
-- NOTE: `app_settings` table was DROPPED in v6.1.0 migration.
--       Access-code authentication has been fully deprecated.

CREATE TABLE public.quizzes (
  college text,
  year text,
  term text,
  uploaded_by uuid,
  path text NOT NULL,
  category text NOT NULL,
  subject text NOT NULL,
  subfolder text,
  title text NOT NULL,
  filename text NOT NULL,
  data jsonb NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  synced_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  education_type text CHECK (education_type = ANY (ARRAY['Primary'::text, 'Middle'::text, 'High'::text, 'University'::text, 'Featured'::text])),
  password text,
  CONSTRAINT quizzes_pkey PRIMARY KEY (id),
  CONSTRAINT quizzes_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.admin_users(id)
);

CREATE TABLE public.quiz_access (
  quiz_path text NOT NULL UNIQUE,
  password_hash text,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  is_private boolean DEFAULT false,
  allowed_emails ARRAY DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT quiz_access_pkey PRIMARY KEY (id)
);

CREATE TABLE public.admin_users (
  handle text UNIQUE,
  display_name text,
  email text NOT NULL UNIQUE,
  added_by text NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT admin_users_pkey PRIMARY KEY (id)
);

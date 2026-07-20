-- Supabase-DB-context.sql | Last updated on version `v6.1.26`
-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

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
  total_points integer DEFAULT 0,
  email text NOT NULL UNIQUE,
  added_by text NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  total_quizzes integer DEFAULT 0,
  total_badges integer DEFAULT 0,
  current_level integer DEFAULT 1,
  CONSTRAINT admin_users_pkey PRIMARY KEY (id)
);

CREATE TABLE public.reports (
  quiz_id uuid,
  question_index integer,
  reason text NOT NULL,
  resolved_by_admin_id uuid,
  resolved_at timestamp with time zone,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'resolved'::text, 'dismissed'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quizzes(id),
  CONSTRAINT reports_resolved_by_admin_id_fkey FOREIGN KEY (resolved_by_admin_id) REFERENCES public.admin_users(id)
);
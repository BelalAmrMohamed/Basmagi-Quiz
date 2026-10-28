-- Short-lived drafts created by the MCP connector (create_quiz_import_link /
-- create_lesson_import_link). Replaces the huge #data=base64,... links with
-- /create-quiz?draft=<code>. No sign-in: the random code is the capability.
-- Only the `mcp` edge function (service role) reads/writes this table.
create table if not exists public.import_drafts (
  code        text primary key check (code ~ '^[2-9a-hj-km-np-z]{10}$'),
  kind        text not null check (kind in ('quiz', 'lesson')),
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '72 hours')
);

create index if not exists import_drafts_expires_at_idx on public.import_drafts (expires_at);

-- RLS on with no policies = anon/authenticated can never touch it directly.
alter table public.import_drafts enable row level security;
revoke all on public.import_drafts from anon, authenticated;

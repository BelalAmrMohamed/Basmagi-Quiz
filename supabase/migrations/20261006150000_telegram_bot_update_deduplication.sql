-- Telegram retries webhook updates when processing takes too long. Persist
-- update IDs before processing so retries cannot produce duplicate replies.
CREATE TABLE IF NOT EXISTS public.telegram_bot_updates (
    update_id bigint primary key,
    created_at timestamptz not null default now()
);

ALTER TABLE public.telegram_bot_updates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.telegram_bot_updates TO service_role;

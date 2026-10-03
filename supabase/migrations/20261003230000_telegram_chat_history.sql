-- =============================================================================
-- Phase 1: Multi-turn conversation history for the Telegram bot.
--
-- Each row stores one message (user or model) keyed by the Telegram chat_id.
-- The bot fetches the last N rows per chat to assemble a multi-turn context
-- window for Gemini, and prunes old entries beyond 30 per chat.
--
-- Access is restricted to the backend service_role key only — no public/anon
-- reads or writes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_chat_history (
    id bigint generated always as identity primary key,
    chat_id text not null,
    role text not null check (role in ('user', 'model')),
    content text not null,
    created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_chat_history_lookup
    ON public.telegram_chat_history(chat_id, created_at desc);

-- Restrict access to backend service role only
ALTER TABLE public.telegram_chat_history ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.telegram_chat_history TO service_role;

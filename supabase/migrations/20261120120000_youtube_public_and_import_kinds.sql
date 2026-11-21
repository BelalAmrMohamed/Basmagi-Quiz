-- =============================================================================
-- 1. import_drafts: allow the two YouTube kinds for MCP import links.
-- 2. youtube_public: published YouTube videos and playlists (references only;
--    titles, channels, and thumbnails come from YouTube at publish time).
--    Read-only for everyone except through the admin API (service role).
-- =============================================================================

ALTER TABLE public.import_drafts DROP CONSTRAINT IF EXISTS import_drafts_kind_check;
ALTER TABLE public.import_drafts ADD CONSTRAINT import_drafts_kind_check
  CHECK (kind IN ('quiz', 'lesson', 'notebook', 'youtube_video', 'youtube_playlist'));

CREATE TABLE IF NOT EXISTS public.youtube_public (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('video', 'playlist')),
  youtube_id       text,
  playlist_id      text,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  channel_title    text NOT NULL DEFAULT '' CHECK (char_length(channel_title) <= 200),
  channel_id       text,
  description      text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  thumbnail_url    text NOT NULL DEFAULT '',
  published_at     timestamptz,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  item_count       integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  total_count      integer NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  partial          boolean NOT NULL DEFAULT false,
  items            jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_published     boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'video' AND youtube_id IS NOT NULL AND playlist_id IS NULL) OR
    (kind = 'playlist' AND playlist_id IS NOT NULL AND youtube_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS youtube_public_video_uidx
  ON public.youtube_public (youtube_id) WHERE kind = 'video';
CREATE UNIQUE INDEX IF NOT EXISTS youtube_public_playlist_uidx
  ON public.youtube_public (playlist_id) WHERE kind = 'playlist';
CREATE INDEX IF NOT EXISTS youtube_public_created_idx
  ON public.youtube_public (created_at DESC) WHERE is_published;

ALTER TABLE public.youtube_public ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS youtube_public_read ON public.youtube_public;
CREATE POLICY youtube_public_read ON public.youtube_public
  FOR SELECT USING (is_published);

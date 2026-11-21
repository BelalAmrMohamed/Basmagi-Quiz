-- Channel avatar for published YouTube cards (channels.list snippet.thumbnails).
-- Nullable: rows published before this migration keep the placeholder glyph until re-published.
ALTER TABLE public.youtube_public
  ADD COLUMN IF NOT EXISTS channel_thumbnail_url text;

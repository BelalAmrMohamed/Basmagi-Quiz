import test from "node:test";
import assert from "node:assert/strict";
import { publishedCountLabel, toVideoEntry, toPlaylistEntry } from "../public/src/features/home/public-youtube-model.js";

test("playlist label: full and partial", () => {
  assert.equal(publishedCountLabel({ itemCount: 12, totalCount: 12 }), "12 فيديو");
  assert.equal(publishedCountLabel({ itemCount: 200, totalCount: 350, partial: true }), "أول 200 من أصل 350 فيديو");
});

test("catalog rows are shaped like saved entries for the windows", () => {
  const v = toVideoEntry({ title: "t", youtubeId: "dQw4w9WgXcQ", description: "d", publishedAt: "2024-01-01", durationSeconds: 5 });
  assert.equal(v.meta.youtubeId, "dQw4w9WgXcQ");
  assert.equal(v.video.durationSeconds, 5);
  const p = toPlaylistEntry({ title: "p", playlistId: "PLx", itemCount: 2 }, [{ videoId: "a" }]);
  assert.equal(p.playlist.items.length, 1);
  assert.equal(p.meta.type, "youtube_playlist");
});

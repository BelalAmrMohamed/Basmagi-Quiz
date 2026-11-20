import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalYoutubePlaylistEntry,
  describePlaylistCount,
  findSameLevelPlaylistDuplicate,
  PLAYLIST_ITEMS_MAX,
} from "../public/src/features/home/local-youtube-playlist.js";

const PL = "PLabcdefghijklmnop";
const NOW = new Date("2026-11-20T10:00:00Z");
const vid = (n) => `vid${String(n).padStart(8, "0")}`;
const item = (n, extra = {}) => ({
  videoId: vid(n),
  title: `فيديو ${n}`,
  thumbnailUrl: "https://i.ytimg.com/vi/x/hq.jpg",
  durationSeconds: 60 * n,
  ...extra,
});
const build = (overrides = {}) => buildLocalYoutubePlaylistEntry({
  playlist: { id: PL, title: "قائمة", channelTitle: "قناة", itemCount: 3 },
  items: [item(1), item(2), item(3)],
  now: NOW,
  id: "user_youtube_playlist_test",
  ...overrides,
});

test("one playlist becomes one object with an ordered snapshot", () => {
  const e = build();
  assert.equal(e.id, "user_youtube_playlist_test");
  assert.equal(e.meta.type, "youtube_playlist");
  assert.equal(e.meta.playlistId, PL);
  assert.equal(e.meta.source, `https://www.youtube.com/playlist?list=${PL}`);
  assert.equal(e.meta.thumbnailUrl, "https://i.ytimg.com/vi/x/hq.jpg");
  assert.deepEqual(e.playlist.items.map((i) => i.videoId), [vid(1), vid(2), vid(3)]);
  assert.equal(e.playlist.partial, false);
  assert.equal(e.stats.itemCount, 3);
});

test("unavailable and malformed entries are dropped; order is kept", () => {
  const e = build({
    items: [item(1), { videoId: null, title: "", unavailable: true }, item(2, { videoId: "bad id" }), item(3)],
    playlist: { id: PL, title: "قائمة", itemCount: 4 },
  });
  assert.deepEqual(e.playlist.items.map((i) => i.videoId), [vid(1), vid(3)]);
  assert.equal(e.playlist.unavailableCount, 2);
});

test("more than the cap keeps the first 200 and is marked partial with the total", () => {
  const items = Array.from({ length: PLAYLIST_ITEMS_MAX + 30 }, (_, i) => item(i + 1));
  const e = build({ items, playlist: { id: PL, title: "قائمة", itemCount: items.length } });
  assert.equal(e.playlist.items.length, PLAYLIST_ITEMS_MAX);
  assert.equal(e.playlist.partial, true);
  assert.equal(e.playlist.itemCount, PLAYLIST_ITEMS_MAX + 30);
  assert.equal(describePlaylistCount(e), `أول ${PLAYLIST_ITEMS_MAX} من أصل ${PLAYLIST_ITEMS_MAX + 30} فيديو`);
});

test("exactly the cap is not partial", () => {
  const items = Array.from({ length: PLAYLIST_ITEMS_MAX }, (_, i) => item(i + 1));
  const e = build({ items, playlist: { id: PL, title: "قائمة", itemCount: PLAYLIST_ITEMS_MAX } });
  assert.equal(e.playlist.partial, false);
  assert.equal(describePlaylistCount(e), `${PLAYLIST_ITEMS_MAX} فيديو`);
});

test("durations must be whole non-negative seconds; bad ones become null", () => {
  const e = build({ items: [item(1, { durationSeconds: -5 }), item(2, { durationSeconds: 1.5 }), item(3)] });
  assert.deepEqual(e.playlist.items.map((i) => i.durationSeconds), [null, null, 180]);
});

test("rejects a bad playlist ID, a missing title, and a playlist with no available videos", () => {
  assert.throws(() => build({ playlist: { id: "x", title: "قائمة", itemCount: 1 } }), /معرّف/);
  assert.throws(() => build({ playlist: { id: PL, title: "  ", itemCount: 1 } }), /عنوان/);
  assert.throws(() => build({ items: [{ unavailable: true }] }), /لا توجد فيديوهات متاحة/);
});

test("duplicates are detected per playlist ID and folder level", () => {
  const e = build();
  assert.equal(findSameLevelPlaylistDuplicate([e], PL, null), e);
  assert.equal(findSameLevelPlaylistDuplicate([e], PL, "folder-1"), null);
  assert.equal(findSameLevelPlaylistDuplicate([e], "PLzyxwvutsrqpon", null), null);
  const videoRow = { meta: { type: "youtube_video", playlistId: PL, parentId: null } };
  assert.equal(findSameLevelPlaylistDuplicate([videoRow], PL, null), null);
});

test("count label for a complete playlist", () => {
  assert.equal(describePlaylistCount(build()), "3 فيديو");
});

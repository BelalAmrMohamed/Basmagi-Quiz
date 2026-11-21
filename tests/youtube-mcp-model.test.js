import test from "node:test";
import { publishedPlaylistFields, publishedVideoFields } from "../public/src/shared/youtube-mcp-model.js";
import assert from "node:assert/strict";
import {
  formatPublishedDetail,
  formatPublishedList,
  pickThumbnail,
  playlistImportPayload,
  videoImportPayload,
} from "../public/src/shared/youtube-mcp-model.js";

const VID = "dQw4w9WgXcQ";
const PL = "PLabcdefghijklmnop";
const THUMB = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg";

test("thumbnails are taken only from YouTube's image hosts", () => {
  assert.equal(pickThumbnail({ high: { url: THUMB } }), THUMB);
  assert.equal(pickThumbnail({ high: { url: "https://evil.example/x.jpg" }, default: { url: THUMB } }), THUMB);
  assert.equal(pickThumbnail({}), "");
});

test("a video item becomes an import payload with normalized metadata", () => {
  const p = videoImportPayload({
    id: VID,
    snippet: { title: "شرح الشبكات", description: "وصف", channelTitle: "قناة", channelId: "UC" + "a".repeat(22), publishedAt: "2024-01-02T03:04:05Z", thumbnails: { high: { url: THUMB } } },
    contentDetails: { duration: "PT1H2M3S" },
    status: { embeddable: true },
  });
  assert.equal(p.youtubeId, VID);
  assert.equal(p.meta.title, "شرح الشبكات");
  assert.equal(p.meta.durationSeconds, 3723);
  assert.equal(p.meta.thumbnailUrl, THUMB);
});

test("a non-embeddable or untitled video is refused with a reason", () => {
  assert.throws(() => videoImportPayload({ id: VID, snippet: { title: "x" }, status: { embeddable: false } }), /مغلق للتضمين/);
  assert.throws(() => videoImportPayload({ id: VID, snippet: { title: "" }, status: { embeddable: true } }), /عنوان الفيديو/);
  assert.throws(() => videoImportPayload({ id: "bad" }), /معرّف الفيديو/);
});

test("a playlist payload keeps order, flags unavailable entries, and maps durations", () => {
  const durations = new Map([["vid00000001", 60]]);
  const p = playlistImportPayload({
    playlist: { id: PL, snippet: { title: "قائمة", channelTitle: "قناة" }, contentDetails: { itemCount: 3 } },
    items: [
      { videoId: "vid00000001", title: "one", thumbnailUrl: THUMB, unavailable: false },
      { videoId: "", title: "", unavailable: true },
      { videoId: "vid00000002", title: "two", unavailable: false },
    ],
    durations,
  });
  assert.equal(p.playlist.itemCount, 3);
  assert.deepEqual(p.items.map((i) => [i.title, i.durationSeconds, i.unavailable]), [["one", 60, false], ["", null, true], ["two", null, false]]);
  assert.equal(p.items[1].videoId, null);
});

test("a playlist payload is capped at 200 entries", () => {
  const items = Array.from({ length: 230 }, (_, i) => ({ videoId: `vid${String(i).padStart(8, "0")}`, title: `t${i}`, unavailable: false }));
  const p = playlistImportPayload({ playlist: { id: PL, snippet: { title: "قائمة" }, contentDetails: { itemCount: 230 } }, items, durations: new Map() });
  assert.equal(p.items.length, 200);
  assert.equal(p.playlist.itemCount, 230);
});

test("list answers show one line per item with its link, and an empty message", () => {
  const rows = [
    { kind: "video", youtube_id: VID, playlist_id: null, title: "فيديو", channel_title: "قناة" },
    { kind: "playlist", youtube_id: null, playlist_id: PL, title: "قائمة", item_count: 200, total_count: 350, partial: true },
  ];
  const text = formatPublishedList(rows, "نتائج");
  assert.match(text, /فيديو \(فيديو · قناة\) — https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ/);
  assert.match(text, /أول 200 من أصل 350 فيديو/);
  assert.equal(formatPublishedList([], "نتائج"), "نتائج: لا توجد نتائج منشورة.");
});

test("a playlist detail lists its videos in order", () => {
  const text = formatPublishedDetail({
    kind: "playlist", playlist_id: PL, title: "قائمة", channel_title: "قناة", item_count: 2, total_count: 2, partial: false,
    items: [{ title: "أ", durationSeconds: 65 }, { title: "ب", durationSeconds: null }],
  });
  assert.match(text, /1\. أ \(1:05\)/);
  assert.match(text, /2\. ب/);
  assert.match(text, /https:\/\/www\.youtube\.com\/playlist\?list=PLabcdefghijklmnop/);
});


test("an admin's video body becomes published-row fields, and bad input is refused", () => {
  const f = publishedVideoFields({
    youtubeId: VID,
    meta: { title: "شرح", description: "وصف", channelTitle: "قناة", thumbnailUrl: THUMB, durationSeconds: 90, publishedAt: "2024-01-02T03:04:05Z" },
  });
  assert.equal(f.kind, "video");
  assert.equal(f.youtube_id, VID);
  assert.equal(f.duration_seconds, 90);
  assert.throws(() => publishedVideoFields({ youtubeId: "bad", meta: { title: "x" } }), /معرّف فيديو/);
  assert.throws(() => publishedVideoFields({ youtubeId: VID, meta: { title: "" } }), /عنوان الفيديو/);
});

test("an admin's playlist body keeps only available items and marks partial when YouTube has more", () => {
  const f = publishedPlaylistFields({
    playlistId: PL,
    playlist: { id: PL, title: "قائمة", channelTitle: "قناة", itemCount: 300 },
    items: [
      { videoId: "vid00000001", title: "a", durationSeconds: 30, thumbnailUrl: THUMB },
      { videoId: "bad", title: "x" },
      { videoId: "vid00000002", title: "b", durationSeconds: -4 },
    ],
  });
  assert.equal(f.kind, "playlist");
  assert.equal(f.item_count, 2);
  assert.equal(f.total_count, 300);
  assert.equal(f.partial, true);
  assert.equal(f.items[1].durationSeconds, null);
  assert.equal(f.thumbnail_url, THUMB);
});

test("a playlist body with a mismatched ID, no title, or no available videos is refused", () => {
  assert.throws(() => publishedPlaylistFields({ playlistId: PL, playlist: { id: "PLzyxwvutsrqpon", title: "x" }, items: [] }), /معرّف قائمة/);
  assert.throws(() => publishedPlaylistFields({ playlistId: PL, playlist: { id: PL, title: " " }, items: [] }), /عنوان قائمة/);
  assert.throws(() => publishedPlaylistFields({ playlistId: PL, playlist: { id: PL, title: "x" }, items: [{ videoId: "bad" }] }), /لا توجد فيديوهات/);
  const big = Array.from({ length: 201 }, (_, i) => ({ videoId: `vid${String(i).padStart(8, "0")}`, title: "t" }));
  assert.throws(() => publishedPlaylistFields({ playlistId: PL, playlist: { id: PL, title: "x" }, items: big }), /يجب ألا يتجاوز/);
});

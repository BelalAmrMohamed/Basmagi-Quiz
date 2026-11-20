import test from "node:test";
import assert from "node:assert/strict";
import {
  appendHistory,
  buildHistoryEvent,
  HISTORY_MAX,
  parseHistory,
  removeHistory,
  sortHistoryNewestFirst,
} from "../public/src/features/home/local-youtube-history.js";

const VID = "dQw4w9WgXcQ";
const PL = "PLabcdefghijklmnop";
const at = (iso) => new Date(iso);

test("builds a video event and a playlist event with validated IDs", () => {
  const v = buildHistoryEvent({ kind: "video", youtubeId: VID, title: "فيديو", itemId: "user_youtube_1", at: at("2026-11-20T10:00:00Z"), id: "e1" });
  assert.deepEqual(v, {
    id: "e1", event: "added", kind: "video", youtubeId: VID, playlistId: null,
    title: "فيديو", itemId: "user_youtube_1", parentId: null, at: "2026-11-20T10:00:00.000Z",
  });
  const p = buildHistoryEvent({ kind: "playlist", playlistId: PL, title: "قائمة", id: "e2" });
  assert.equal(p.kind, "playlist");
  assert.equal(p.playlistId, PL);
  assert.equal(p.youtubeId, null);
});

test("rejects unknown events and kinds, and bad IDs", () => {
  assert.throws(() => buildHistoryEvent({ event: "watched", kind: "video", youtubeId: VID }), /نوع الحدث/);
  assert.throws(() => buildHistoryEvent({ kind: "channel", youtubeId: VID }), /نوع العنصر/);
  assert.throws(() => buildHistoryEvent({ kind: "video", youtubeId: "bad" }), /معرّف فيديو/);
  assert.throws(() => buildHistoryEvent({ kind: "playlist", playlistId: "x" }), /معرّف قائمة/);
});

test("an empty title falls back and a long title is capped", () => {
  assert.equal(buildHistoryEvent({ kind: "video", youtubeId: VID, title: "  " }).title, "بدون عنوان");
  assert.equal(buildHistoryEvent({ kind: "video", youtubeId: VID, title: "x".repeat(500) }).title.length, 200);
});

test("the published event type is accepted for later admin publishing", () => {
  assert.equal(buildHistoryEvent({ event: "published", kind: "video", youtubeId: VID }).event, "published");
});

test("parsing drops malformed rows and tolerates bad JSON", () => {
  const good = buildHistoryEvent({ kind: "video", youtubeId: VID, id: "ok" });
  const raw = JSON.stringify([good, { id: "no-kind" }, { ...good, id: "bad-date", at: "nope" }, null, { ...good, id: "bad-id", youtubeId: "x" }]);
  assert.deepEqual(parseHistory(raw).map((e) => e.id), ["ok"]);
  assert.deepEqual(parseHistory("{not json"), []);
  assert.deepEqual(parseHistory(JSON.stringify({ a: 1 })), []);
  assert.deepEqual(parseHistory(null), []);
});

test("appending keeps only the newest entries", () => {
  const make = (i) => buildHistoryEvent({ kind: "video", youtubeId: VID, id: `e${i}` });
  const log = Array.from({ length: HISTORY_MAX }, (_, i) => make(i));
  const next = appendHistory(log, [make("new")]);
  assert.equal(next.length, HISTORY_MAX);
  assert.equal(next[0].id, "e1");
  assert.equal(next.at(-1).id, "enew");
});

test("remove by id and newest-first sorting do not mutate the input", () => {
  const a = buildHistoryEvent({ kind: "video", youtubeId: VID, id: "a", at: at("2026-11-01T00:00:00Z") });
  const b = buildHistoryEvent({ kind: "playlist", playlistId: PL, id: "b", at: at("2026-11-20T00:00:00Z") });
  const log = [a, b];
  assert.deepEqual(sortHistoryNewestFirst(log).map((e) => e.id), ["b", "a"]);
  assert.deepEqual(log.map((e) => e.id), ["a", "b"]);
  assert.deepEqual(removeHistory(log, "a").map((e) => e.id), ["b"]);
  assert.equal(log.length, 2);
});

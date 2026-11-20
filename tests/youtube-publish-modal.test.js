import test from "node:test";
import assert from "node:assert/strict";

// The modal imports browser modules; stub the globals they touch at import time.
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage ??= globalThis.localStorage;
globalThis.window ??= globalThis;
globalThis.document ??= { addEventListener() {}, createElement: () => ({}), body: {} };

const { buildPublishBody, filterSubjects } = await import("../public/src/features/home/youtube-publish-modal.js");

test("video entry → publish body with duration from stats", () => {
  const body = buildPublishBody({ meta: { type: "youtube_video", youtubeId: "dQw4w9WgXcQ", title: "t" }, stats: { durationSeconds: 90 } }, "c1", ["A", "B"]);
  assert.equal(body.action, "publish-youtube");
  assert.equal(body.kind, "video");
  assert.equal(body.youtubeId, "dQw4w9WgXcQ");
  assert.equal(body.meta.durationSeconds, 90);
  assert.deepEqual(body.folderPath, ["A", "B"]);
  assert.equal(body.courseId, "c1");
});

test("playlist entry → publish body with snapshot items", () => {
  const entry = { meta: { type: "youtube_playlist", playlistId: "PLabc", title: "p" }, playlist: { id: "PLabc", title: "p", channelTitle: "ch", itemCount: 5, partial: true, items: [{ videoId: "dQw4w9WgXcQ" }] } };
  const body = buildPublishBody(entry, "c1", []);
  assert.equal(body.kind, "playlist");
  assert.equal(body.playlistId, "PLabc");
  assert.equal(body.playlist.itemCount, 5);
  assert.equal(body.partial, true);
  assert.equal(body.items.length, 1);
});

test("filterSubjects narrows by path and skips rows without id", () => {
  const subjects = [
    { id: "1", name: "a", education_type: "University", faculty: "F1", year: 1, term: 1 },
    { id: "2", name: "b", education_type: "University", faculty: "F2", year: 1, term: 2 },
    { name: "x", education_type: "University", faculty: "F1", year: 1, term: 1 },
    { id: "3", name: "c", education_type: "High", year: null, term: null },
  ];
  assert.deepEqual(filterSubjects(subjects, { type: "University", college: "F1" }).map((s) => s.id), ["1"]);
  assert.deepEqual(filterSubjects(subjects, { type: "University", college: "", term: "2" }).map((s) => s.id), ["2"]);
  assert.deepEqual(filterSubjects(subjects, { type: "High" }).map((s) => s.id), ["3"]);
});

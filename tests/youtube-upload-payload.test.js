import test from "node:test";
import assert from "node:assert/strict";
import { publishedVideoFields, publishedPlaylistFields } from "../public/src/shared/youtube-mcp-model.js";

const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window ??= globalThis;
globalThis.document ??= { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };

const { youtubeToPayload, buildFolderUploadPayload } = await import("../public/src/features/home/user-content-folders.js");

const video = {
  id: "v1",
  meta: { type: "youtube_video", title: "درس", youtubeId: "dQw4w9WgXcQ", channelTitle: "ch", description: "d", parentId: "f1" },
  video: { videoId: "dQw4w9WgXcQ", durationSeconds: 90 },
  stats: { durationSeconds: 90 },
};
const playlist = {
  id: "p1",
  meta: { type: "youtube_playlist", title: "قائمة", playlistId: "PLabcdefghijklmnop", parentId: "f1" },
  playlist: { id: "PLabcdefghijklmnop", title: "قائمة", channelTitle: "ch", itemCount: 1, items: [{ videoId: "dQw4w9WgXcQ", title: "a", durationSeconds: 5, thumbnailUrl: "" }] },
};
const folder = { id: "f1", meta: { type: "folder", title: "مجلد", parentId: null } };

test("youtubeToPayload feeds the server field builders", () => {
  assert.equal(publishedVideoFields(youtubeToPayload(video)).duration_seconds, 90);
  assert.equal(publishedPlaylistFields(youtubeToPayload(playlist)).item_count, 1);
});

test("a folder with YouTube children uploads them as youtube items, never quizzes", () => {
  const { items } = buildFolderUploadPayload([folder, video, playlist], [folder], [], "مادة");
  const types = items.map((i) => i.type);
  assert.deepEqual(types, ["folder", "youtube_video", "youtube_playlist"]);
  assert.deepEqual(items[1].folderSegments, ["مادة", "مجلد"]);
});

test("standalone YouTube items go to the chosen destination", () => {
  const { items } = buildFolderUploadPayload([video], [], [], "مادة", ["أ"], [], [], [video]);
  assert.equal(items[0].type, "youtube_video");
  assert.deepEqual(items[0].folderSegments, ["مادة", "أ"]);
});

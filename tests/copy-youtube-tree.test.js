import test from "node:test";
import assert from "node:assert/strict";
import { getFolderContentsCount, formatFolderAndQuizCount } from "../public/src/features/home/folder-counts.js";
import {
  planYoutubeCopy,
  playlistRowIds,
  describeCopyCounts,
} from "../public/src/features/home/copy-youtube-tree.js";

// course-count.js pulls in storage helpers that touch localStorage at import time.
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document ??= { getElementById: () => null, querySelector: () => null, addEventListener() {} };
const { getUserContentBreakdown, formatUserContentBreakdown } = await import("../public/src/features/home/course-count.js");

const VID = "dQw4w9WgXcQ";
const VID2 = "9bZkp7q19f0";
const PL = "PLabcdefghijklmnopqrstuvwxyz012345";

const video = (over = {}) => ({ id: "row-v", kind: "video", youtubeId: VID, title: "Video", ...over });
const playlist = (over = {}) => ({ id: "row-p", kind: "playlist", playlistId: PL, title: "List", totalCount: 1, ...over });
const plItems = new Map([["row-p", [{ videoId: VID2, title: "One", durationSeconds: 60 }]]]);

test("a folder holding a video and a playlist copies both under the new parent", () => {
  const plan = planYoutubeCopy({ items: [video(), playlist()], parentId: "new-folder", existing: [], playlistItemsById: plItems });
  assert.equal(plan.videos, 1);
  assert.equal(plan.playlists, 1);
  assert.deepEqual(plan.entries.map((e) => e.meta.type), ["youtube_video", "youtube_playlist"]);
  assert.ok(plan.entries.every((e) => e.meta.parentId === "new-folder"));
});

test("same YouTube id at the same level is skipped, not failed", () => {
  const plan = planYoutubeCopy({ items: [video(), video({ id: "row-v2", title: "Other title" })], parentId: "f", existing: [] });
  assert.equal(plan.videos, 1);
  assert.equal(plan.skipped, 1);
  assert.equal(plan.failed, 0);
});

test("a playlist without loaded items fails but videos still copy", () => {
  const plan = planYoutubeCopy({ items: [playlist(), video()], parentId: "f", existing: [] });
  assert.equal(plan.failed, 1);
  assert.equal(plan.videos, 1);
});

test("playlistRowIds is unique and ignores videos", () => {
  assert.deepEqual(playlistRowIds([video(), playlist(), playlist()]), ["row-p"]);
});

test("describeCopyCounts omits zero counts", () => {
  assert.equal(describeCopyCounts({ quizzes: 2, videos: 0, playlists: 1 }), "2 اختبار · 1 قائمة تشغيل");
});

test("«محتواي» counters keep YouTube rows out of the exam count", () => {
  const rows = [
    { id: "q1", meta: {} },
    { id: "v1", meta: { type: "youtube_video" } },
    { id: "p1", meta: { type: "youtube_playlist" } },
  ];
  const b = getUserContentBreakdown(rows);
  assert.equal(b.quizCount, 1);
  assert.equal(b.videoCount, 1);
  assert.equal(b.playlistCount, 1);
  assert.equal(b.total, 3);
  assert.equal(formatUserContentBreakdown(b), "امتحان واحد · فيديو واحد · قائمة تشغيل");
});

test("folder counts keep YouTube rows out of the exam count", () => {
  const rows = [
    { id: "f", meta: { type: "folder" } },
    { id: "q", meta: { parentId: "f" } },
    { id: "v", meta: { parentId: "f", type: "youtube_video" } },
    { id: "p", meta: { parentId: "f", type: "youtube_playlist" } },
  ];
  const c = getFolderContentsCount(rows, "f");
  assert.deepEqual([c.quizCount, c.videoCount, c.playlistCount], [1, 1, 1]);
  assert.equal(formatFolderAndQuizCount(0, 1, 0, 0, 1, 1), "امتحان واحد · فيديو واحد · قائمة تشغيل");
});

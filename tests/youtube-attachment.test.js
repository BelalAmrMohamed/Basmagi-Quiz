import test from "node:test";
import assert from "node:assert/strict";
import {
  buildYoutubeAttachment,
  formatDuration,
  isYoutubeAttachment,
} from "../public/src/components/ai-agent/core/youtube-attachment.js";
import {
  ATTACHMENT_KIND_LABEL_AR,
  ATTACHMENT_YOUTUBE_ICON_SVG,
  iconForAttachment,
} from "../public/src/components/ai-agent/core/chat-attachments.js";

const VID = "dQw4w9WgXcQ";
const PL = "PLabcdefghijklmnopqrstuvwxyz012345";

test("published video attaches as kind youtube, not lesson", () => {
  const att = buildYoutubeAttachment({
    itemType: "youtube_video", id: "row-1", youtubeId: VID, title: "Intro", channelTitle: "Chan",
    description: "desc", publishedAt: "2024-05-01T10:00:00Z", durationSeconds: 3725,
  });
  assert.equal(att.kind, "youtube");
  assert.equal(att.itemType, "youtube_video");
  assert.equal(att.source, "platform");
  assert.equal(att.payload.url, `https://www.youtube.com/watch?v=${VID}`);
  assert.equal(att.payload.duration, "1:02:05");
  assert.match(att.summary, /القناة: Chan/);
  assert.match(att.summary, /2024-05-01/);
});

test("local playlist row carries its video titles", () => {
  const att = buildYoutubeAttachment({
    id: "user_youtube_playlist_1",
    meta: { type: "youtube_playlist", title: "List", playlistId: PL, channelTitle: "Chan" },
    playlist: { itemCount: 2, items: [{ title: "One" }, { title: "Two" }] },
  }, "local");
  assert.equal(att.itemType, "youtube_playlist");
  assert.equal(att.source, "local");
  assert.equal(att.payload.videoCount, 2);
  assert.deepEqual(att.payload.videoTitles, ["One", "Two"]);
});

test("icon and labels: YouTube glyph, «فيديو» / «قائمة تشغيل»", () => {
  const att = buildYoutubeAttachment({ itemType: "youtube_playlist", id: "p", playlistId: PL, title: "x" });
  assert.equal(iconForAttachment(att), ATTACHMENT_YOUTUBE_ICON_SVG);
  assert.equal(ATTACHMENT_KIND_LABEL_AR[att.itemType], "قائمة تشغيل");
  assert.equal(ATTACHMENT_KIND_LABEL_AR.youtube_video, "فيديو");
});

test("chats saved with the old kind lesson + youtube itemType still get the YouTube icon", () => {
  const old = { kind: "lesson", itemType: "youtube_video", title: "x" };
  assert.ok(isYoutubeAttachment(old));
  assert.equal(iconForAttachment(old), ATTACHMENT_YOUTUBE_ICON_SVG);
});

test("formatDuration", () => {
  assert.equal(formatDuration(125), "2:05");
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(-1), null);
});

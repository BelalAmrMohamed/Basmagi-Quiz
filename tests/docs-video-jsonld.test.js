// VideoObject JSON-LD (Google "key moments") and the YouTube-description chapter list of the MCP guide.
// Both are built from the page's own `.doc-video-chip[data-time]` chips (scripts/build-docs.mjs), so they cannot drift.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildVideoObject,
  formatTimestamp,
  isoDuration,
  parsePage,
  parseVideoChapters,
  withChapterEnds,
  youtubeChapterBlock,
} from "../scripts/build-docs.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const source = parsePage(fs.readFileSync(path.join(ROOT, "docs-src/pages/how-to-connect-mcp.html"), "utf8"), "how-to-connect-mcp.html");
const html = fs.readFileSync(path.join(ROOT, "public/how-to-connect-mcp.html"), "utf8");
const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const video = JSON.parse(blocks[1]);

test("the MCP page ships HowTo first, then a VideoObject, and every block is valid JSON", () => {
  assert.equal(blocks.length, 2);
  assert.equal(JSON.parse(blocks[0])["@type"], "HowTo");
  assert.equal(video["@type"], "VideoObject");
  for (const key of ["name", "description", "thumbnailUrl", "uploadDate", "duration", "contentUrl", "embedUrl"]) assert.ok(video[key], `VideoObject.${key} is missing`);
  assert.equal(video.uploadDate, "2026-11-23");
  assert.equal(video.duration, "PT4M35S");
});

test("one Clip per chapter chip, ordered, with consistent offsets", () => {
  const chips = [...html.matchAll(/<button type="button" class="doc-video-chip[^"]*" data-time="(\d+)">\s*<span class="doc-video-chip__time">([^<]+)<\/span>\s*<span>([^<]+)<\/span>/g)];
  const clips = video.hasPart;
  assert.ok(chips.length >= 3);
  assert.equal(clips.length, chips.length, "one Clip per .doc-video-chip");
  assert.equal(clips[0].startOffset, 0);
  clips.forEach((clip, i) => {
    assert.equal(clip["@type"], "Clip");
    assert.equal(clip.name, chips[i][3].trim());
    assert.equal(clip.startOffset, Number(chips[i][1]));
    assert.equal(formatTimestamp(clip.startOffset), chips[i][2], "the visible label matches data-time");
    assert.equal(clip.url, `https://youtu.be/ysckQBfLFFw?t=${clip.startOffset}`);
    assert.ok(clip.endOffset - clip.startOffset >= 10, `${clip.name}: shorter than 10s`);
    if (i > 0) assert.ok(clip.startOffset > clips[i - 1].startOffset, "chapters are ordered");
    if (i < clips.length - 1) assert.equal(clip.endOffset, clips[i + 1].startOffset, "endOffset is the next chapter's start");
  });
  assert.equal(clips.at(-1).endOffset, 275, "the last chapter ends at the video duration (04:35)");
});

test("the embedded video id is the one the JSON-LD describes", () => {
  assert.ok(html.includes(`/embed/${source.meta.video.id}?`));
  assert.equal(video.embedUrl, `https://www.youtube.com/embed/${source.meta.video.id}`);
});

test("YouTube description block: 00:00 Title, first at 00:00, >= 3 chapters, each >= 10s, matches the JSON-LD", () => {
  const lines = youtubeChapterBlock(source.meta, source.body).split("\n");
  assert.equal(lines.length, video.hasPart.length);
  assert.match(lines[0], /^00:00 \S/);
  assert.ok(lines.length >= 3);
  lines.forEach((line, i) => {
    assert.match(line, /^\d\d:\d\d \S/);
    assert.equal(line, `${formatTimestamp(video.hasPart[i].startOffset)} ${video.hasPart[i].name}`);
  });
});

test("buildVideoObject output equals what the page ships", () => {
  assert.deepEqual(buildVideoObject(source.meta, source.body), video);
  assert.equal(buildVideoObject({ ...source.meta, video: undefined }, source.body), null);
});

test("chapter rules: at least 3, first at 00:00, ascending, each at least 10s, inside the duration", () => {
  const ch = (...starts) => starts.map((start, i) => ({ name: `c${i}`, start }));
  assert.deepEqual(withChapterEnds(ch(0, 20, 40), 60).map((c) => c.end), [20, 40, 60]);
  assert.throws(() => withChapterEnds(ch(0, 20), 60), /at least 3/);
  assert.throws(() => withChapterEnds(ch(5, 20, 40), 60), /00:00/);
  assert.throws(() => withChapterEnds(ch(0, 20, 25), 60), /at least 10s/);
  assert.throws(() => withChapterEnds(ch(0, 20, 55), 60), /at least 10s/);
  assert.throws(() => withChapterEnds(ch(0, 40, 20), 60), /ascend/);
  assert.throws(() => withChapterEnds(ch(0, 20, 70), 60), /ascend|inside/);
  assert.throws(() => withChapterEnds(ch(0, 20, 40), 0), /durationSeconds/);
});

test("a chip whose label disagrees with data-time fails the build", () => {
  const chip = (label, t) => `<button type="button" class="doc-video-chip" data-time="${t}"><span class="doc-video-chip__time">${label}</span><span>x</span></button>`;
  assert.throws(() => parseVideoChapters(chip("00:30", 28)), /00:28/);
  assert.deepEqual(parseVideoChapters(chip("00:28", 28)), [{ name: "x", start: 28 }]);
});

test("timestamp and ISO duration formats", () => {
  assert.equal(formatTimestamp(0), "00:00");
  assert.equal(formatTimestamp(275), "04:35");
  assert.equal(formatTimestamp(3725), "1:02:05");
  assert.equal(isoDuration(275), "PT4M35S");
  assert.equal(isoDuration(3600), "PT1H");
  assert.equal(isoDuration(45), "PT45S");
});

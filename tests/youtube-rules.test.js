import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseYoutubeInput,
  parseIsoDuration,
  formatDurationSeconds,
  normalizeVideoMeta,
  normalizeVideoRef,
  isAllowedThumbnailUrl,
  embedUrl,
} from "../public/src/shared/youtube-rules.js";

const ID = "dQw4w9WgXcQ";

test("parses bare IDs and common URL shapes", () => {
  assert.deepEqual(parseYoutubeInput(ID), { kind: "video", videoId: ID });
  assert.deepEqual(parseYoutubeInput(`https://www.youtube.com/watch?v=${ID}`), { kind: "video", videoId: ID });
  assert.deepEqual(parseYoutubeInput(`https://youtu.be/${ID}?t=42`), { kind: "video", videoId: ID });
  assert.deepEqual(parseYoutubeInput(`https://www.youtube.com/shorts/${ID}`), { kind: "video", videoId: ID });
  assert.deepEqual(parseYoutubeInput(`https://www.youtube.com/embed/${ID}`), { kind: "video", videoId: ID });
  assert.deepEqual(parseYoutubeInput(`youtube.com/watch?v=${ID}`), { kind: "video", videoId: ID });
});

test("keeps the playlist ID as provenance on a watch URL", () => {
  const r = parseYoutubeInput(`https://www.youtube.com/watch?v=${ID}&list=PLabcdefghijklmnop`);
  assert.deepEqual(r, { kind: "video", videoId: ID, playlistId: "PLabcdefghijklmnop" });
});

test("parses playlist URLs", () => {
  assert.deepEqual(
    parseYoutubeInput("https://www.youtube.com/playlist?list=PLabcdefghijklmnop"),
    { kind: "playlist", playlistId: "PLabcdefghijklmnop" },
  );
});

test("rejects non-YouTube hosts, malformed IDs, and unsupported paths", () => {
  assert.equal(parseYoutubeInput("https://evil.example/watch?v=" + ID).reason, "host");
  assert.equal(parseYoutubeInput("https://www.youtube.com/watch?v=short").reason, "video-id");
  assert.equal(parseYoutubeInput("https://www.youtube.com/channel/UCabc").reason, "unsupported-path");
  assert.equal(parseYoutubeInput("javascript:alert(1)").kind, "invalid");
  assert.equal(parseYoutubeInput("").reason, "empty");
});

test("ISO 8601 durations convert to seconds; malformed values are null", () => {
  assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
  assert.equal(parseIsoDuration("PT45S"), 45);
  assert.equal(parseIsoDuration("P0D"), 0);
  assert.equal(parseIsoDuration("PT"), null);
  assert.equal(parseIsoDuration("nonsense"), null);
});

test("formats durations as m:ss or h:mm:ss", () => {
  assert.equal(formatDurationSeconds(3723), "1:02:03");
  assert.equal(formatDurationSeconds(65), "1:05");
  assert.equal(formatDurationSeconds(null), "");
});

test("thumbnails are accepted only from https ytimg hosts", () => {
  assert.equal(isAllowedThumbnailUrl("https://i.ytimg.com/vi/x/hqdefault.jpg"), true);
  assert.equal(isAllowedThumbnailUrl("http://i.ytimg.com/vi/x/hqdefault.jpg"), false);
  assert.equal(isAllowedThumbnailUrl("https://tracker.example/a.jpg"), false);
});

test("metadata is validated; absent optional fields are tolerated", () => {
  const meta = normalizeVideoMeta({ title: "درس" });
  assert.equal(meta.description, "");
  assert.equal(meta.thumbnailUrl, "");
  assert.equal(meta.durationSeconds, null);
  assert.throws(() => normalizeVideoMeta({ title: "   " }), /مطلوب/);
  assert.throws(() => normalizeVideoMeta({ title: "ok", durationSeconds: -1 }), /مدة/);
  assert.throws(() => normalizeVideoMeta({ title: "x".repeat(201) }), /طويل/);
});

test("video references are canonical and never accept embed HTML", () => {
  const ref = normalizeVideoRef(ID, { title: "t" });
  assert.equal(ref.url, `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(embedUrl(ID), `https://www.youtube-nocookie.com/embed/${ID}`);
  assert.throws(() => normalizeVideoRef('<iframe src="x">', { title: "t" }), /غير صالح/);
});

test("browser and server copies of the shared rules stay identical", () => {
  assert.equal(
    readFileSync("scripts/lib/youtube-rules.js", "utf8"),
    readFileSync("public/src/shared/youtube-rules.js", "utf8"),
    "run `npm run sync:mcp`",
  );
});

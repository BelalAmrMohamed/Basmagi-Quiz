import test from "node:test";
import assert from "node:assert/strict";
import { buildYoutubeEmbedCode, describeYoutubeItem, youtubeLinkFor } from "../public/src/features/home/youtube-embed.js";
import { isAllowedThumbnailUrl, normalizeVideoMeta } from "../public/src/shared/youtube-rules.js";
import { publishedVideoFields } from "../public/src/shared/youtube-mcp-model.js";
import { readListHidden } from "../public/src/features/home/youtube-window-utils.js";

const VID = "dQw4w9WgXcQ";
const PL = "PLabcdefghijklmnopqrstuvwxyz012345";

test("video embed uses the nocookie player and escapes the title", () => {
  const code = buildYoutubeEmbedCode({ playlist: false, id: VID, title: 'A "quoted" <b>' });
  assert.match(code, new RegExp(`src="https://www.youtube-nocookie.com/embed/${VID}"`));
  assert.match(code, /title="A &quot;quoted&quot; &lt;b&gt;"/);
  assert.match(code, /loading="lazy"/);
  assert.match(code, /referrerpolicy=/);
  assert.match(code, /allowfullscreen/);
});

test("playlist embed uses videoseries; invalid ids give nothing", () => {
  assert.match(buildYoutubeEmbedCode({ playlist: true, id: PL, title: "x" }), /embed\/videoseries\?list=PL/);
  assert.equal(buildYoutubeEmbedCode({ playlist: false, id: "bad", title: "x" }), "");
  assert.equal(youtubeLinkFor({ playlist: false, id: "bad" }), "");
});

test("describeYoutubeItem handles local rows and manifest items", () => {
  assert.deepEqual(describeYoutubeItem({ meta: { type: "youtube_playlist", playlistId: PL, title: " T " } }), { playlist: true, id: PL, title: "T" });
  assert.deepEqual(describeYoutubeItem({ kind: "video", youtubeId: VID, title: "V" }), { playlist: false, id: VID, title: "V" });
  assert.equal(youtubeLinkFor({ playlist: true, id: PL }), `https://www.youtube.com/playlist?list=${PL}`);
});

test("list-hidden preference: saved choice wins, narrow screens default to hidden", () => {
  const mk = (v) => ({ getItem: () => v });
  assert.equal(readListHidden(mk(null), true), true);
  assert.equal(readListHidden(mk(null), false), false);
  assert.equal(readListHidden(mk("0"), true), false);
  assert.equal(readListHidden(mk("1"), false), true);
});

test("channel avatars: allowlisted hosts only, kept through normalize + publish fields", () => {
  const ok = "https://yt3.ggpht.com/abc=s88-c-k";
  assert.ok(isAllowedThumbnailUrl(ok));
  assert.ok(isAllowedThumbnailUrl("https://yt3.googleusercontent.com/x"));
  assert.ok(!isAllowedThumbnailUrl("https://evil.example/yt3.ggpht.com"));
  assert.ok(!isAllowedThumbnailUrl("http://yt3.ggpht.com/x"));
  assert.equal(normalizeVideoMeta({ title: "t", channelThumbnailUrl: ok }).channelThumbnailUrl, ok);
  assert.equal(normalizeVideoMeta({ title: "t", channelThumbnailUrl: "https://evil.example/a" }).channelThumbnailUrl, "");
  const f = publishedVideoFields({ youtubeId: VID, meta: { title: "t", channelThumbnailUrl: ok } });
  assert.equal(f.channel_thumbnail_url, ok);
});

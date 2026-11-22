import test from "node:test";
import assert from "node:assert/strict";
import { extractCaptionTracks, extractPlayerCaptionTracks, parseXmlTranscript, parseVtt, parseCaptionBody, pickTrack, parseJson3, mergeSegments, fetchTranscript } from "../supabase/functions/youtube/transcript.js";
import { buildSummarizeResult, splitTranscriptParts, formatTimestamp } from "../public/src/shared/youtube-transcript.js";
import { findSavedYoutubeItem } from "../public/src/features/home/youtube-saved-lookup.js";
import { expandPlatformAttachment } from "../public/src/components/ai-agent/core/chat-attachments.js";

const tracks = [
  { baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=en", languageCode: "en", kind: "asr" },
  { baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=en2", languageCode: "en" },
  { baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=ar", languageCode: "ar", kind: "asr" },
];
const page = `<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":${JSON.stringify(tracks)},"audioTracks":[]}}};</script>`;

test("extractCaptionTracks reads the tracks out of a watch page, even with ] inside strings", () => {
  assert.equal(extractCaptionTracks(page).length, 3);
  const tricky = '"captionTracks":[{"baseUrl":"https://www.youtube.com/t?a=]","languageCode":"en"}],"x":1';
  assert.equal(extractCaptionTracks(tricky)[0].languageCode, "en");
  assert.deepEqual(extractCaptionTracks("<html>no captions</html>"), []);
});

test("pickTrack: requested language first, human beats auto, then Arabic, then English", () => {
  assert.equal(pickTrack(tracks, ["en"]).baseUrl.endsWith("lang=en2"), true);
  assert.equal(pickTrack(tracks).languageCode, "ar");
  assert.equal(pickTrack([tracks[0]]).languageCode, "en");
  assert.equal(pickTrack([]), null);
});

test("parseJson3 + mergeSegments produce ~20s timestamped lines", () => {
  const segs = parseJson3({ events: [
    { tStartMs: 0, segs: [{ utf8: "hello" }, { utf8: " world" }] },
    { tStartMs: 5000, segs: [{ utf8: "\n" }] },
    { tStartMs: 8000, segs: [{ utf8: "again" }] },
    { tStartMs: 30000, segs: [{ utf8: "later" }] },
    { tStartMs: 31000 },
  ] });
  assert.deepEqual(segs.map((s) => s.s), [0, 8, 30]);
  assert.deepEqual(mergeSegments(segs), [{ s: 0, t: "hello world again" }, { s: 30, t: "later" }]);
});

const okFetch = (map) => async (url) => {
  const hit = Object.entries(map).find(([k]) => String(url).includes(k));
  if (!hit) return { ok: false, status: 404, text: async () => "" };
  return { ok: true, status: 200, text: async () => hit[1] };
};

test("fetchTranscript: success, no captions, blocked and foreign-host protection", async () => {
  const good = await fetchTranscript("abcdefghijk", {
    fetchImpl: okFetch({ "watch?v=": page, "lang=ar": JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: "مرحبا" }] }] }) }),
  });
  assert.equal(good.available, true);
  assert.equal(good.language, "ar");
  assert.equal(good.kind, "auto");
  assert.deepEqual(good.lines, [{ s: 0, t: "مرحبا" }]);

  assert.deepEqual(await fetchTranscript("abcdefghijk", { fetchImpl: okFetch({ "watch?v=": "<html></html>" }) }), { available: false, reason: "no_captions" });
  assert.equal((await fetchTranscript("abcdefghijk", { fetchImpl: okFetch({ "watch?v=": "consent.youtube.com" }) })).reason, "blocked");
  assert.equal((await fetchTranscript("abcdefghijk", { fetchImpl: okFetch({ "watch?v=": page, "lang=ar": "" }) })).reason, "blocked");
  const evil = `"captionTracks":[{"baseUrl":"https://evil.example/x","languageCode":"ar"}]`;
  assert.equal((await fetchTranscript("abcdefghijk", { fetchImpl: okFetch({ "watch?v=": evil }) })).reason, "upstream");
  assert.equal((await fetchTranscript("abcdefghijk", { fetchImpl: async () => { throw new Error("net"); } })).reason, "upstream");
});

test("parsers: classic XML (double-encoded), srv3, VTT and body sniffing", () => {
  const xml = '<?xml version="1.0"?><transcript><text start="1.2" dur="2">it&amp;#39;s &amp;quot;ok&amp;quot;</text><text start="9" dur="1">two</text></transcript>';
  assert.deepEqual(parseXmlTranscript(xml), [{ s: 1, t: "it's \"ok\"" }, { s: 9, t: "two" }]);
  const srv3 = '<timedtext><body><p t="1500" d="1000"><s>hello</s><s> world</s></p><p t="4000" d="500">مرحبا</p></body></timedtext>';
  assert.deepEqual(parseXmlTranscript(srv3), [{ s: 1, t: "hello world" }, { s: 4, t: "مرحبا" }]);
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nline one\n\n00:00:03.000 --> 00:00:05.000\nline one\nline two\n\n01:00:00.000 --> 01:00:02.000\n<c>late</c>";
  assert.deepEqual(parseVtt(vtt), [{ s: 1, t: "line one" }, { s: 3, t: "line two" }, { s: 3600, t: "late" }]);
  assert.equal(parseCaptionBody("").length, 0);
  assert.equal(parseCaptionBody("not captions").length, 0);
  assert.equal(parseCaptionBody(JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: "a" }] }] })).length, 1);
  assert.equal(extractPlayerCaptionTracks({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "x" }, {}] } } }).length, 1);
  assert.deepEqual(extractPlayerCaptionTracks({}), []);
});

test("fetchTranscript: the web track is empty (pot) but the InnerTube ANDROID client succeeds", async () => {
  const calls = [];
  const androidTrack = { baseUrl: "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=ar&c=ANDROID", languageCode: "ar" };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    const ok = (text) => ({ ok: true, status: 200, text: async () => text });
    if (String(url).includes("youtubei/v1/player")) {
      const client = JSON.parse(init.body).context.client.clientName;
      return client === "ANDROID" ? ok(JSON.stringify({ playabilityStatus: { status: "OK" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [androidTrack] } } })) : ok("{}");
    }
    if (String(url).includes("c=ANDROID")) return ok(String(url).includes("fmt=json3") ? "" : '<transcript><text start="0" dur="1">مرحبا</text></transcript>'); // json3 empty, XML works
    if (String(url).includes("watch?v=")) return ok(page + ' "INNERTUBE_API_KEY":"AIzaFAKE-key_1"');
    return ok(""); // the web track: empty body
  };
  const res = await fetchTranscript("abcdefghijk", { fetchImpl, debug: true });
  assert.equal(res.available, true);
  assert.deepEqual(res.lines, [{ s: 0, t: "مرحبا" }]);
  assert.equal(res.debug.via, "player:ANDROID");
  const player = calls.find((c) => c.url.includes("youtubei/v1/player"));
  assert.equal(player.method, "POST");
  assert.ok(player.url.includes("key=AIzaFAKE-key_1"));
  const steps = res.debug.steps;
  assert.equal(steps[0].step, "watch");
  assert.equal(steps[0].captionTracks, 3);
  assert.ok(steps.some((s) => s.step === "captions" && s.fmt === "json3" && s.bytes === 0));
  // diagnostics carry names/counts only, never URLs or signatures
  assert.doesNotMatch(JSON.stringify(steps), /https?:|AIzaFAKE|signature=/);
  // without debug the result keeps its plain shape
  assert.equal("debug" in (await fetchTranscript("abcdefghijk", { fetchImpl })), false);
});

test("fetchTranscript: every source empty or bot-checked -> blocked, with the failing step in debug", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("youtubei/v1/player")) return { ok: true, status: 200, text: async () => JSON.stringify({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" } }) };
    return { ok: true, status: 200, text: async () => "<html></html>" };
  };
  const res = await fetchTranscript("abcdefghijk", { fetchImpl, debug: true });
  assert.deepEqual([res.available, res.reason], [false, "blocked"]);
  assert.deepEqual(res.debug.steps.filter((s) => s.step === "player").map((s) => s.playability), ["LOGIN_REQUIRED", "LOGIN_REQUIRED"]);
});

test("splitTranscriptParts never cuts a line and stamps times", () => {
  const lines = Array.from({ length: 10 }, (_, i) => ({ s: i * 20, t: "x".repeat(50) }));
  const parts = splitTranscriptParts(lines, 200);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 200 && p.split("\n").every((l) => /^\[\d+:\d\d\] x+$/.test(l))));
  assert.equal(formatTimestamp(3725), "1:02:05");
});

const details = { title: "Simplex", channelTitle: "Ch", durationSeconds: 125, publishedAt: "2024-01-02T00:00:00Z", description: "chapters: 0:00 intro" };

test("buildSummarizeResult: transcript parts tell the model to read the rest", () => {
  const lines = Array.from({ length: 6 }, (_, i) => ({ s: i * 20, t: "y".repeat(60) }));
  const first = buildSummarizeResult(details, { available: true, language: "ar", kind: "manual", lines }, { part: 1, maxChars: 200 });
  assert.match(first, /الجزء 1 من 3/);
  assert.match(first, /part=2/);
  const last = buildSummarizeResult(details, { available: true, language: "ar", kind: "manual", lines }, { part: 99, maxChars: 200 });
  assert.match(last, /الجزء 3 من 3/);
  assert.doesNotMatch(last, /part=4/);
});

test("buildSummarizeResult: without a transcript it says description-only and forbids guessing", () => {
  const out = buildSummarizeResult(details, { available: false, reason: "no_captions" });
  assert.match(out, /المصدر: الوصف فقط/);
  assert.match(out, /لا تخمّن/);
  assert.match(out, /chapters/);
  assert.match(buildSummarizeResult(details, { available: false, reason: "service" }), /غير متاحة/);
});

test("findSavedYoutubeItem matches by title, video id, URL and playlist id", () => {
  const rows = [
    { id: "1", meta: { type: "youtube_video", title: "Simplex Method", youtubeId: "dQw4w9WgXcQ" } },
    { id: "2", meta: { type: "youtube_playlist", title: "OR Course", playlistId: "PLabcdefghijklmnop" } },
    { id: "3", meta: { type: "quiz", title: "Simplex Method" } },
  ];
  assert.equal(findSavedYoutubeItem(rows, "  simplex   method ").id, "1");
  assert.equal(findSavedYoutubeItem(rows, "https://youtu.be/dQw4w9WgXcQ").id, "1");
  assert.equal(findSavedYoutubeItem(rows, "OR Course").id, "2");
  assert.equal(findSavedYoutubeItem(rows, "nothing"), null);
});

test("a video attachment tells the model how to read the real content", () => {
  const text = expandPlatformAttachment({ kind: "youtube", itemType: "youtube_video", title: "V", payload: { youtubeId: "dQw4w9WgXcQ" } });
  assert.match(text, /summarize_youtube/);
  assert.match(text, /dQw4w9WgXcQ/);
  assert.doesNotMatch(expandPlatformAttachment({ kind: "youtube", itemType: "youtube_playlist", title: "P", payload: {} }), /summarize_youtube/);
});

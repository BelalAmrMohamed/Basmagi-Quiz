// =============================================================================
// tests/og-render.test.js
// Smoke/snapshot tests for the OG image generators (api/og.js + api/_og/*).
// Supabase and static assets are mocked, so it runs offline:
//     node --test tests/og-render.test.js
// Set OG_SNAPSHOT_DIR=some/dir (or run `npm run og:snapshot`) to also save every
// rendered PNG for eyeballing after a design change.
// =============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const ORIGIN = "https://basmagi.vercel.app";
const SB = "https://mock.supabase.co";
process.env.SUPABASE_URL = SB;
process.env.SUPABASE_ANON_KEY = "mock-key";

const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const FIXTURES = {
  course: { id: "c1", name: "Computer Ethics", education_type: "University", college: "Computer Science", year: 3, term: 1 },
  lesson: {
    id: "l1", slug: "intro", title: "Introduction to Ethics", description: "What ethics is and why it matters.",
    course_id: "c1", folder_id: null, password_protected: false,
    content: { sections: [{ title: "Basics", blocks: [{ type: "markdown", body: "Ethics studies right and wrong." }] }] },
  },
  notebook: {
    id: "n1", slug: "img-1", title: "Image Processing Basics", description: "Read, filter and display images.",
    runtime: "matlab", course_id: "c1", folder_id: null,
    content: { cells: [{ type: "markdown", source: "# Hi" }, { type: "code", source: "% load\nimg = imread('cameraman.tif');\nimshow(img)" }] },
  },
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = String(input);
  if (u.startsWith(ORIGIN + "/")) {
    const file = path.join(PUBLIC, decodeURIComponent(new URL(u).pathname));
    return fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response(null, { status: 404 });
  }
  if (u.startsWith(SB + "/rest/v1/")) {
    const table = new URL(u).pathname.split("/").pop();
    if (init.method === "HEAD") {
      const n = { folders: 1, quizzes: 1, lesson_public: 4, notebooks: 0 }[table] ?? 0;
      return new Response(null, { headers: { "content-range": `0-0/${n}` } });
    }
    switch (table) {
      case "courses": return json([FIXTURES.course]);
      case "folders": return json([{ id: "f1", name: "Sub" }]);
      case "quizzes": return json([{ title: "Midterm", subject: "Computer Ethics", data: { meta: { title: "Midterm", author: "Belal" }, stats: { questionCount: 20, questionTypes: ["MCQ"] } } }]);
      case "lesson_public": return json([FIXTURES.lesson]);
      case "notebook_public": return json([FIXTURES.notebook]);
      case "admin_users": return json([{ display_name: "Belal", handle: "belal", bio: "Dev", current_level: 3, uploaded_quizzes: 5, uploaded_lessons: 2, total_points: 100, total_badges: 4 }]);
      default: return json([]);
    }
  }
  return realFetch(input, init);
};

const handler = (await import("../api/og.js")).default;
const { renderPng } = await import("../api/_og/common.js");
const { ogVersion, stampFromDate, OG_LAYOUT_VERSION } = await import("../api/_og/version.js");

const SNAP = process.env.OG_SNAPSHOT_DIR;
if (SNAP) fs.mkdirSync(SNAP, { recursive: true });

async function render(name, query) {
  const res = await handler(new Request(`${ORIGIN}/api/og?${query}`));
  if (res.status !== 200) return res;
  const buf = Buffer.from(await res.arrayBuffer());
  if (SNAP) fs.writeFileSync(path.join(SNAP, `${name}.png`), buf);
  return { status: 200, headers: res.headers, buf };
}

const CASES = [
  ["quiz", "quizId=ABCD1234"],
  ["brand-default", ""],
  ["course", "course=c1"],
  ["folder", "course=c1&folder=Sub"],
  ["lesson", "lesson=intro"],
  ["notebook", "notebook=img-1"],
];

for (const [name, query] of CASES) {
  test(`og: ${name} renders a 1200x630 PNG`, async () => {
    const r = await render(name, query);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.equal(r.buf.subarray(1, 4).toString(), "PNG");
    assert.equal(r.buf.readUInt32BE(16), 1200);
    assert.equal(r.buf.readUInt32BE(20), 630);
    assert.match(r.headers.get("cache-control"), /immutable/);
    assert.ok(r.buf.length > 5_000, "suspiciously small image");
  });
}

test("og: profile renders (or redirects) without crashing", async () => {
  const r = await render("profile", "profile=belal");
  assert.ok(r.status === 200 || r.status === 302, `status ${r.status}`);
});

test("og: a render crash falls back to a static thumbnail instead of a 500", async () => {
  // No fonts → Satori throws while rendering; renderPng must catch it.
  const res = await renderPng({ type: "div", props: { children: "x" } }, null, { fallback: "/assets/images/thumbnails/thumbnail.png" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `${ORIGIN}/assets/images/thumbnails/thumbnail.png`);
  assert.match(res.headers.get("cache-control"), /s-maxage=60/);
});

test("og: self-hosted font file exists and is a TTF", () => {
  const f = fs.readFileSync(path.join(PUBLIC, "assets/fonts/Tajawal-Bold.ttf"));
  assert.ok([0x00010000, 0x74727565].includes(f.readUInt32BE(0)), "not a TrueType font");
});

test("version: ogVersion combines layout version and content stamp", () => {
  assert.equal(ogVersion("course", [1, 1, 4, 0]), `${OG_LAYOUT_VERSION.course}-1-1-4-0`);
  assert.equal(ogVersion("lesson"), String(OG_LAYOUT_VERSION.lesson));
  assert.equal(ogVersion("notebook", stampFromDate("2026-11-02T10:00:00Z")), `${OG_LAYOUT_VERSION.notebook}-1793613600000`);
  assert.equal(stampFromDate(null), null);
});

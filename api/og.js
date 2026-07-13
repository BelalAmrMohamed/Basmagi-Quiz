// =============================================================================
// api/og.js
//
// Vercel Edge Function — generates dynamic 1200×630 OG thumbnail images for
// quiz link previews. Powered by @vercel/og (Satori + WebAssembly PNG encoder).
//
// Usage:  /api/og?quizId=ABCD1234
// Cache:  Immutable 1-year CDN cache. Bust via ?v=N param from render-quiz.js.
//
// No JSX transpiler — uses plain ReactElement-style objects that Satori accepts.
// No raw pg driver — fetches quiz metadata via Supabase REST API over HTTP.
//
// Background: static template PNG at
//   public/assets/images/thumbnails/quiz-thumbnail-customizable.png
// Confirmed 1200×630 RGBA. Measured element bounds (via pixel scan, not
// eyeballing) on that exact file:
//   URL pill:  x 545–813,  y 148–189
//   Button:    x 534–737,  y 383–457
//   Bulb card: x 0–408,    y 25–490
// Everything below y≈490 (across the full 0–1200 width) and above y≈148 is
// empty background — used below for the course pill, description, and
// author line.
// =============================================================================

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

// ── Supabase REST config (Edge-safe, no supabase-js needed) ──────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ── Brand constants ──────────────────────────────────────────────────────────
const BRAND_BLUE = "#0088cc";

// IMPORTANT: VERCEL_URL is the ephemeral, deployment-specific *.vercel.app
// domain (different for every deploy), not the stable production domain.
// Depending on project settings, unauthenticated requests to that domain can
// be redirected/gated, causing internal fetch() calls below (manifest,
// background image) to silently receive an HTML page instead of the real
// asset — this is what broke the manifest fetch. Always prefer the known
// production origin; set SITE_ORIGIN as an env var if this ever needs to
// point elsewhere (e.g. a genuine staging domain).
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://basmagi-quiz.vercel.app";

const BACKGROUND_IMAGE_URL = `${SITE_ORIGIN}/assets/images/thumbnails/quiz-thumbnail-customizable.png`;

// ── Local quiz manifest (relative-path quizzes) ──────────────────────────────
// Relative-path quizzes are never written to Supabase — their metadata lives
// only in this static file. Edge runtime has no `fs`, so fetch it over HTTP
// the same way the background image and font are fetched. Served from
// public/data/quiz-manifest.json (see render-quiz.js for the disk-side path).
const MANIFEST_URL = `${SITE_ORIGIN}/data/quiz-manifest.json`;

// ── Layout geometry ────────────────────────────────────────────────────────
// All measured against the real 1200×630 background PNG (see header comment).
// Right-hand content column sits between the bulb card (ends x≈408) and the
// canvas edge, avoiding the pill (y148–189) and button (y383–457).
const TEXT_COLUMN = {
  left: 500,
  right: 1140,
  top: 198,
  bottom: 360,
};
const TEXT_COLUMN_WIDTH = TEXT_COLUMN.right - TEXT_COLUMN.left; // 640

// Small relocated domain label — top-right corner, out of the way of the
// pill's old spot (which now hosts the question-count/type badge instead).
const DOMAIN_LABEL = { right: 40, top: 24 };

// Black "ابدأ الامتحان" button — pixel-measured bounds from the header
// comment (x 534–737, y 383–457). Used as the alignment anchor for the
// badge and course pill above it, so both line up on the button's own
// left edge rather than an independent column edge.
const BUTTON_ROW = { left: 534, right: 737, top: 383, bottom: 457 };

// Course-name pill — directly above the button, own row so it never
// competes with the title/description/badge stack above it. Left edge
// nudged a few px right of BUTTON_ROW.left — pixel-perfect flush-left
// looked slightly too far left visually against the button's own edge
// (per user testing), small manual offset corrects it.
const COURSE_ROW = { left: BUTTON_ROW.left + 6, right: 1140, top: 340, bottom: 372 };

// Author line — full-width footer strip below the bulb card (which ends at
// y≈490), horizontally centered on the button's own center (x≈635), not the
// canvas center, so it visually reads as "attached" to the card/button.
// Pushed down near the bottom edge (canvas height 630px) with a modest
// margin left for breathing room under the larger font size below.
const AUTHOR_ROW = { centerX: 635, top: 588 };

// Max characters before we truncate the title with an ellipsis (after shrinking
// the font still isn't enough to guarantee it fits the column width).
//
// These are NOT guesses — derived from actual glyph-advance-width metrics
// read out of the Tajawal Bold font files (measured via fonttools against
// the 640px TEXT_COLUMN_WIDTH, with a ~8% safety margin for word-boundary
// slack). Arabic glyphs in Tajawal run considerably wider per character
// than assumed in an earlier version of this file, which let titles as
// short as ~39 chars silently overflow past the column's right edge even
// at the smallest font-size tier — there was no tier small enough to
// rescue anything longer, since the tier floor was 34px (fits ~25 chars)
// while TITLE_MAX_CHARS allowed up to 60. English/Latin glyphs in Tajawal
// are narrower, so the Latin limit stays more generous.
const TITLE_MAX_CHARS_ARABIC = 34;
const TITLE_MAX_CHARS_LATIN = 55;
const DESCRIPTION_MAX_CHARS = 90;

// ── Question type translation (Arabic) ────────────────────────────────────────
// The quiz-scanning script (see inferQuestionType) always emits these exact,
// case-sensitive English labels. We translate them for display only.
const QUESTION_TYPE_AR = {
  "MCQ": "إختياري",
  "Essay": "مقالي",
  "True/False": "صح/خطأ",
};

/**
 * Translates a questionTypes string (already joined with " · ") into Arabic
 * when isArabic is true, by exact-matching each known English label.
 * Order and separators are preserved; unrecognized labels pass through as-is.
 */
function translateQuestionTypes(questionTypesStr, isArabic) {
  if (!questionTypesStr || !isArabic) return questionTypesStr;
  return questionTypesStr
    .split(" · ")
    .map((part) => QUESTION_TYPE_AR[part] || part)
    .join(" · ");
}

// ── Font cache (survives across warm invocations) ────────────────────────────
let _fontDataPromise = null;

// Family names used on the `fontFamily` CSS property throughout the layout.
// Satori resolves same-named font entries by "first one wins" for every
// glyph — it does NOT do per-character coverage fallback between entries
// sharing one name (see https://github.com/vercel/satori/issues/370). The
// correct mechanism is a CSS-style comma-separated fontFamily fallback list
// across *distinct* family names, which Satori does support and does
// correctly resolve per-glyph. Every mixed-script string in this file (e.g.
// the details badge, which combines Arabic words with digits and a "·"
// separator that only exist in the Latin subset) therefore needs the
// Latin family listed first, so Latin-only characters embedded in Arabic
// text still render instead of showing as tofu boxes.
const FONT_FAMILY_LATIN = "Tajawal-Latin";
const FONT_FAMILY_ARABIC = "Tajawal-Arabic";
const FONT_FAMILY_STACK = `${FONT_FAMILY_LATIN}, ${FONT_FAMILY_ARABIC}`;

/**
 * Fetches the Tajawal Bold TTF font(s) from Google Fonts — both the Arabic
 * and Latin unicode-range subsets, since Google serves Tajawal split into
 * multiple @font-face blocks (one per script) and a single subset only
 * covers its own glyphs. Both are returned, tagged with distinct family
 * names (see FONT_FAMILY_* above) so a single comma-separated fontFamily
 * fallback list can resolve either script — or both mixed in one string,
 * e.g. Arabic words alongside digits/punctuation — correctly per-glyph.
 *
 * Result is cached at module level so warm Edge invocations skip the fetch.
 *
 * IMPORTANT: @vercel/og's ImageResponse (Satori's font parser) does NOT
 * support WOFF2 — passing woff2 bytes throws "Unsupported OpenType
 * signature wOF2" inside ImageResponse, which is uncaught here and results
 * in a broken/empty function response (the blank-thumbnail bug). Only
 * TTF/OTF/WOFF(v1) are supported. Google Fonts picks the format to serve
 * based on User-Agent — modern browser UAs get woff2, but a legacy UA that
 * doesn't advertise woff2 support gets TTF instead. We spoof an old UA here
 * specifically to force the TTF variant.
 *
 * @returns {Promise<{name:string, data:ArrayBuffer}[]>} one entry per
 *   @font-face subset found for weight 700, tagged with its family name.
 */
function loadFont() {
  if (_fontDataPromise) return _fontDataPromise;
  _fontDataPromise = (async () => {
    // Request CSS with a legacy user-agent so Google Fonts falls back to
    // serving TTF (woff2 is unsupported by Satori's font parser).
    const cssRes = await fetch(
      "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap",
      {
        headers: {
          // Old Android browser UA — predates woff2 support, so Google
          // Fonts' UA sniffing serves .ttf in the @font-face src instead.
          "User-Agent":
            "Mozilla/5.0 (Linux; U; Android 2.3.3; en-us; Nexus S Build/GRI40) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1",
        },
      },
    );
    const css = await cssRes.text();

    // The CSS contains one @font-face block per (weight, script) pair, each
    // with a `unicode-range` comment/descriptor we can sniff to tell Arabic
    // and Latin blocks apart. Fall back to Latin for any subset we can't
    // positively identify as Arabic (safer default — Latin covers digits/
    // punctuation needed by almost every string, including Arabic ones).
    const bold700Blocks = css
      .split("@font-face")
      .filter((block) => block.includes("font-weight: 700"));

    const entries = [];
    for (const block of bold700Blocks) {
      const fontUrl = block.match(/src:\s*url\(([^)]+\.ttf[^)]*)\)/)?.[1];
      if (!fontUrl) continue;
      const rangeMatch = block.match(/unicode-range:\s*([^;]+);/);
      const isArabicSubset = rangeMatch
        ? /U\+06[0-9A-Fa-f]{2}|U\+075|U\+08[0-9A-Fa-f]{2}|U\+FB[5-9A-Fa-f]|U\+FE7|U\+FEF/i.test(
            rangeMatch[1],
          )
        : false;
      entries.push({ url: fontUrl, isArabicSubset });
    }

    if (entries.length === 0) {
      throw new Error("[og] Could not extract any Tajawal ttf URLs from CSS");
    }

    const buffers = await Promise.all(
      entries.map((e) => fetch(e.url).then((res) => res.arrayBuffer())),
    );

    return entries.map((e, i) => ({
      name: e.isArabicSubset ? FONT_FAMILY_ARABIC : FONT_FAMILY_LATIN,
      data: buffers[i],
    }));
  })();
  return _fontDataPromise;
}

// =============================================================================
// Handler
// =============================================================================
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const quizId = searchParams.get("quizId");

  // ── 1. Fetch external assets in parallel ─────────────────────────────────
  const [fontData, quizData, bgImageArrayBuffer, manifestData] = await Promise.all([
    // If the font fetch/parse ever fails again (network hiccup, Google
    // Fonts markup change, etc.), fall back to null rather than letting
    // the whole handler throw — ImageResponse still renders fine without
    // a custom font entry, just with the system default instead of Tajawal.
    loadFont().catch((err) => {
      console.error("[og] font load error:", err);
      return null;
    }),
    quizId ? fetchQuizMeta(quizId) : null,
    fetch(BACKGROUND_IMAGE_URL).then((res) => {
      if (!res.ok) throw new Error(`Failed to load background image: ${res.status}`);
      return res.arrayBuffer();
    }).catch(err => {
      console.error("[og] bg image fetch error:", err);
      return null;
    }),
    quizId ? fetchManifest() : null,
  ]);

  // Supabase only holds DB-uploaded quizzes. A miss there is expected and
  // normal for relative-path quizzes — fall back to the local manifest
  // before giving up and using generic defaults.
  const meta = quizData || (manifestData ? findQuizInManifest(manifestData, quizId) : null);

  // ── 2. Build display strings ──────────────────────────────────────────────
  const rawTitle = meta ? (meta.title || quizId || "إمتحان") : "منصة إمتحانات بصمجي";
  const isArabic = detectArabic(rawTitle);
  const title = truncateTitle(rawTitle, isArabic ? TITLE_MAX_CHARS_ARABIC : TITLE_MAX_CHARS_LATIN);
  const details = meta ? buildDetails(meta, isArabic) : "";
  const description = meta ? truncateDescription(meta.description) : null;
  const courseName = meta ? meta.course : null;
  const authorName = meta ? meta.author : null;
  const authorIsArabic = authorName ? detectArabic(authorName) : isArabic;
  const authorLabel = authorIsArabic ? "بواسطة" : "By";

  // Shrink font as the title gets longer, so it always fits on one line
  // within TEXT_COLUMN_WIDTH (640px). These tiers are calibrated from
  // actual glyph-advance-width metrics measured against the Tajawal Bold
  // font files (fonttools, ~8% safety margin) — not guessed. An earlier
  // version used untested breakpoints that let Arabic titles as short as
  // ~39 characters silently overflow the column at every available tier,
  // since Arabic glyphs in Tajawal render noticeably wider per character
  // than Latin ones, and no tier was small enough to compensate for that.
  // TITLE_MAX_CHARS_ARABIC/LATIN below are set to what the smallest tier
  // here can actually hold, so truncation and shrinking always agree.
  const titleFontSize = isArabic
    ? title.length > 25
      ? "28px"
      : title.length > 22
        ? "32px"
        : title.length > 19
          ? "38px"
          : title.length > 17
            ? "44px"
            : title.length > 14
              ? "50px"
              : "56px"
    : title.length > 39
      ? "32px"
      : title.length > 33
        ? "38px"
        : title.length > 27
          ? "46px"
          : "54px";

  // Build Base64 background image
  const bgImageBase64 = bgImageArrayBuffer
    ? `url(data:image/png;base64,${Buffer.from(bgImageArrayBuffer).toString("base64")})`
    : `none`;

  // ── 3. Build image element (plain objects — no JSX) ───────────────────────
  const element = {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        fontFamily: FONT_FAMILY_STACK,
        backgroundImage: bgImageBase64,
        backgroundSize: "1200px 630px",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#0f172a", // Fallback color
      },
      children: [
        // ── Relocated domain label — small, top-right corner ─────────────
        // Demoted from its old prime spot (now the question-count/type
        // badge below) but kept, since forwarded screenshots in chats lose
        // all OG metadata except these pixels — this is the only branding
        // that survives that path.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              position: "absolute",
              right: `${DOMAIN_LABEL.right}px`,
              top: `${DOMAIN_LABEL.top}px`,
              fontSize: "16px",
              color: "#9ca3af",
              fontWeight: "400",
              direction: "ltr",
            },
            children: "basmagi-quiz.vercel.app",
          },
        },

        // ── Question count / type badge — now in the old pill's row ──────
        details
          ? {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  position: "absolute",
                  // Left edge pinned to the button's own left edge (x≈534,
                  // see BUTTON_ROW below) rather than centered across the
                  // full text column, so the badge's left side lines up
                  // vertically with the button's left side underneath it.
                  left: `${BUTTON_ROW.left}px`,
                  top: "148px",
                  width: `${TEXT_COLUMN.right - BUTTON_ROW.left}px`,
                  height: "41px", // matches old pill height (148–189)
                  alignItems: "center",
                  justifyContent: "flex-start",
                  // ltr here: this wrapper has a single child (no sibling
                  // order for flexbox to mirror), and the text inside has
                  // already been pre-mirrored by renderBidiText — leaving
                  // this as rtl double-handles direction and produces the
                  // oversized inter-word gaps Satori's Arabic shaper adds
                  // under an rtl context.
                  direction: "ltr",
                },
                children: [
                  {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        alignItems: "center",
                        background: "rgba(0,136,204,0.12)",
                        border: `1px solid rgba(0,136,204,0.3)`,
                        borderRadius: "10px",
                        padding: "8px 22px",
                        fontSize: "20px",
                        color: BRAND_BLUE,
                        fontWeight: "700",
                        // ltr: text already pre-mirrored by renderBidiText.
                        direction: "ltr",
                      },
                      children: renderBidiText(details, isArabic),
                    },
                  },
                ],
              },
            }
          : null,

        // ── Title + description column ────────────────────────────────────
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              position: "absolute",
              left: `${TEXT_COLUMN.left}px`,
              top: `${TEXT_COLUMN.top}px`,
              width: `${TEXT_COLUMN_WIDTH}px`,
              height: `${TEXT_COLUMN.bottom - TEXT_COLUMN.top}px`,
              textAlign: "center",
              // ltr: this column only stacks title/description vertically
              // (flexDirection: column), so there's no horizontal sibling
              // order for `direction` to mirror — and both leaf texts
              // below are pre-mirrored by renderBidiText, so rtl here
              // would double-handle direction and widen inter-word gaps.
              direction: "ltr",
              gap: "10px",
            },
            children: [
              // ── Title (single line, guaranteed by shrink + truncate) ───
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: titleFontSize,
                    fontWeight: "700",
                    color: "#111827",
                    lineHeight: "1.25",
                    textAlign: "center",
                    direction: "ltr",
                    width: "100%",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    justifyContent: "center",
                  },
                  children: renderBidiText(title, isArabic),
                },
              },

              // ── Description (smaller, single line, muted) ──────────────
              description
                ? {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        fontSize: "20px",
                        fontWeight: "400",
                        color: "#4b5563",
                        lineHeight: "1.3",
                        textAlign: "center",
                        direction: "ltr",
                        width: "100%",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        justifyContent: "center",
                      },
                      children: renderBidiText(description, isArabic),
                    },
                  }
                : null,
            ].filter(Boolean),
          },
        },

        // ── Course name pill — its own row, just above the button ────────
        courseName
          ? {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  position: "absolute",
                  left: `${COURSE_ROW.left}px`,
                  top: `${COURSE_ROW.top}px`,
                  width: `${COURSE_ROW.right - COURSE_ROW.left}px`,
                  height: `${COURSE_ROW.bottom - COURSE_ROW.top}px`,
                  alignItems: "center",
                  // flex-start (not center): the pill's own left edge must
                  // line up with the button's left edge directly below it,
                  // matching the stats badge's alignment above.
                  justifyContent: "flex-start",
                  // ltr: single child, text pre-mirrored by renderBidiText.
                  direction: "ltr",
                },
                children: [
                  {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        alignItems: "center",
                        background: "rgba(17,24,39,0.06)",
                        borderRadius: "8px",
                        padding: "5px 18px",
                        fontSize: "17px",
                        color: "#374151",
                        fontWeight: "700",
                        whiteSpace: "nowrap",
                        direction: "ltr",
                      },
                      children: renderBidiText(courseName, detectArabic(courseName)),
                    },
                  },
                ],
              },
            }
          : null,

        // ── Author line — bottom footer strip, centered on the button ────
        // Rendered as ONE pre-mirrored text leaf (label + name combined),
        // not two separate flex children under a `direction: rtl`
        // container. Two mirroring mechanisms were fighting each other:
        // renderBidiText() already reverses word order within the name
        // string itself, and container-level `direction: rtl` *also*
        // reversed the label/name divs' left-right screen position — the
        // combination produced "name-words-reversed, then label" instead
        // of the intended "label, then name in natural word order" (label
        // is a single word, so its own internal order was never the
        // issue — only its position relative to the name was). Combining
        // into one string and mirroring once, as a whole, avoids this.
        authorName
          ? {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  position: "absolute",
                  left: `${AUTHOR_ROW.centerX - 300}px`,
                  top: `${AUTHOR_ROW.top}px`,
                  width: "600px",
                  alignItems: "center",
                  justifyContent: "center",
                  direction: "ltr",
                  fontSize: "22px",
                },
                children: [
                  {
                    type: "div",
                    props: {
                      style: { display: "flex", color: "#9ca3af", fontWeight: "400" },
                      children: renderBidiText(`${authorLabel} `, false),
                    },
                  },
                  {
                    type: "div",
                    props: {
                      style: { display: "flex", color: "#374151", fontWeight: "700" },
                      children: " ",
                    },
                  },
                ],
              },
            }
          : null,
      ].filter(Boolean),
    },
  };

  // ── 4. Return ImageResponse ───────────────────────────────────────────────
  // Only cache aggressively when the render is fully correct (background
  // image loaded, font loaded, AND — if a quizId was given — metadata was
  // found). A transient failure (e.g. manifest/Supabase hiccup, bg image or
  // font fetch error) would otherwise be locked into the CDN for a year via
  // the immutable cache below, silently breaking that quiz's thumbnail until
  // OG_IMAGE_VERSION is bumped project-wide.
  const renderIsComplete =
    bgImageArrayBuffer !== null && fontData !== null && (!quizId || meta !== null);

  return new ImageResponse(element, {
    width: 1200,
    height: 630,
    // Only pass font entries when they actually loaded — ImageResponse
    // falls back to a default system font if the array is empty, which is
    // preferable to crashing the whole render over a font hiccup.
    // fontData is an array of {name, data} — one per script subset, each
    // tagged with its own distinct family name (see loadFont()). The
    // FONT_FAMILY_STACK set on the root container's fontFamily resolves
    // each glyph against whichever of these two entries actually covers it.
    fonts: fontData
      ? fontData.map((entry) => ({
          name: entry.name,
          data: entry.data,
          weight: 700,
          style: "normal",
        }))
      : [],
    headers: {
      "Cache-Control": renderIsComplete
        ? "public, immutable, no-transform, max-age=31536000, s-maxage=31536000"
        : "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}

// =============================================================================
// Data fetching (Edge-safe — raw fetch against Supabase REST API)
// =============================================================================

/**
 * Fetches quiz metadata via the Supabase PostgREST HTTP API.
 * Uses only `fetch` — fully Edge-compatible, zero TCP connections.
 *
 * @param {string} quizId
 * @returns {Promise<{title:string, description:string|null, questionCount:number|null, questionTypes:string|null, author:string|null, course:string|null}|null>}
 */
async function fetchQuizMeta(quizId) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[og] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }

  try {
    // PostgREST filter: data->meta->>id = quizId
    const url = new URL(`${SUPABASE_URL}/rest/v1/quizzes`);
    url.searchParams.set(
      "select",
      "data,title,path,filename,category,subject,subfolder,education_type",
    );
    url.searchParams.set("data->meta->>id", `eq.${quizId}`);
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) {
      console.error(`[og] Supabase returned ${res.status}`);
      return null;
    }

    const rows = await res.json();
    if (!rows || rows.length === 0) return null;

    const row = rows[0];
    const quizMeta = row.data?.meta || {};
    const quizStats = row.data?.stats || {};

    // Prefer the clean course name from `subject` (matches quiz-manifest.js's
    // own use of the same column). Fall back to parsing `path` the same way
    // quiz-manifest.js does via parseDbPath, in case `subject` is ever blank
    // for a legacy row — mirrors the fallback already used there.
    let course = row.subject || null;
    if (!course && row.path) {
      let parsed = parseDbPath(row.path, row.filename);
      if (!parsed && row.education_type === "University") {
        parsed = parseDbPath(`University/${row.path}`, row.filename);
      }
      course = parsed?.course || null;
    }

    return {
      title: quizMeta.title || row.title || quizId,
      description: quizMeta.description || null,
      questionCount:
        quizStats.questionCount != null ? quizStats.questionCount : null,
      // Kept as the raw, untranslated English string (e.g. "MCQ · Essay").
      // Translation happens later in buildDetails, once we know the title's
      // language, since that's what currently drives RTL/label selection.
      questionTypes: formatQuestionTypes(quizStats.questionTypes),
      author: quizMeta.author || null,
      course,
    };
  } catch (err) {
    console.error("[og] fetchQuizMeta error:", err);
    return null;
  }
}

// ── Manifest cache (survives across warm invocations) ────────────────────────
let _manifestPromise = null;

/**
 * Fetches quiz-manifest.json — the source of truth for relative-path quizzes,
 * which are never written to Supabase. Cached at module level like loadFont(),
 * since the manifest only changes on deploy.
 *
 * @returns {Promise<{subjects: Array}|null>}
 */
function fetchManifest() {
  if (_manifestPromise) return _manifestPromise;
  _manifestPromise = fetch(MANIFEST_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
      return res.json();
    })
    .catch((err) => {
      console.error("[og] fetchManifest error:", err);
      _manifestPromise = null; // allow retry on next request rather than caching a failure
      return null;
    });
  return _manifestPromise;
}

/**
 * Finds a quiz entry by ID across all subjects in the manifest and shapes it
 * to match fetchQuizMeta's return shape.
 *
 * @param {{subjects: Array}} manifest
 * @param {string} quizId
 * @returns {{title:string, description:string|null, questionCount:number|null, questionTypes:string|null, author:string|null, course:string|null}|null}
 */
function findQuizInManifest(manifest, quizId) {
  for (const subject of manifest.subjects ?? []) {
    for (const quiz of subject.quizzes ?? []) {
      if (quiz.id === quizId) {
        return {
          title: quiz.title || quizId,
          description: quiz.description || null,
          questionCount: quiz.questionCount != null ? quiz.questionCount : null,
          questionTypes: formatQuestionTypes(quiz.questionTypes),
          author: quiz.author || null,
          // subject.name is the clean course name (e.g. "Website Demo"),
          // distinct from any subfolders nested beneath it — see
          // buildSubjectManifestEntry() in scripts/lib/quizPath.js.
          course: subject.name || null,
        };
      }
    }
  }
  return null;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Formats the detail line, e.g. "12 سؤال (مقالي · إختياري · صح/خطأ)"
 * (Arabic) or "20 Questions (MCQ · Essay)" (English).
 *
 * questionTypes always arrives from the scanning script as exact, case-sensitive
 * English labels ("MCQ", "Essay", "True/False"), joined with " · ". When the
 * quiz title is Arabic, each recognized label is translated for display;
 * unrecognized labels are left untouched rather than dropped.
 *
 * Always built in natural reading order — count first, then the type list
 * parenthesized — regardless of script. Arabic mirroring (so it *paints*
 * count-first-on-the-right) is handled separately by renderBidiText() at
 * render time, which treats a "(...)" group as one atomic token so it
 * moves as a block without scrambling the types inside it. Do not
 * reintroduce a manual source-order swap here — renderBidiText already
 * owns that concern, and doing it in both places double-reverses.
 */
function buildDetails(meta, isArabic) {
  if (!meta) return "";
  const label = isArabic ? "سؤال" : "Questions";
  const translatedTypes = translateQuestionTypes(meta.questionTypes, isArabic);
  const countPart = meta.questionCount != null ? `${meta.questionCount} ${label}` : "";

  if (!countPart) return translatedTypes || "";
  if (!translatedTypes) return countPart;

  return `${countPart} (${translatedTypes})`;
}

/**
 * Truncates an overly long title so it can never overflow the fixed-width
 * text column or collide with the bulb graphic / button, even after the
 * font-size shrink rule in the handler. maxChars must match whichever of
 * TITLE_MAX_CHARS_ARABIC/LATIN corresponds to the title's detected script,
 * since the two scripts have very different safe character budgets.
 */
function truncateTitle(title, maxChars) {
  if (!title || title.length <= maxChars) return title;
  return title.slice(0, maxChars - 1).trimEnd() + "…";
}

/**
 * Truncates the description line, which sits below the title at a smaller
 * size and must also never wrap (single line only).
 */
function truncateDescription(description) {
  if (!description || description.length <= DESCRIPTION_MAX_CHARS) return description;
  return description.slice(0, DESCRIPTION_MAX_CHARS - 1).trimEnd() + "…";
}

function detectArabic(text) {
  const firstLetter = text.match(/\p{L}/u);
  return (
    firstLetter &&
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(firstLetter[0])
  );
}

/**
 * Satori does NOT run the Unicode Bidirectional Algorithm — it lays out a
 * text node's characters/words in raw source (storage) order. Critically,
 * this means `direction: "rtl"` on the div wrapping a pre-reversed string
 * is not a no-op "just in case" setting — Satori's text shaper applies
 * extra inter-word spacing/justification for Arabic runs under an RTL
 * writing-direction context (visible as the oversized gaps between words
 * once this function has already reordered them). Once a string has been
 * run through this function, the container/leaf holding it must be set to
 * `direction: "ltr"` — the words are now in final left-to-right paint
 * order and should be shaped as a plain LTR string, not re-processed.
 *
 * `direction: rtl` should only still be used on containers whose *children
 * are separate sibling elements* (e.g. an author label div + author name
 * div) where flexbox's own row-reversal is the thing doing the mirroring —
 * never on a container/leaf whose text content this function has touched.
 *
 * Algorithm: split on whitespace, reverse token order, rejoin. Within any
 * single Arabic word the glyphs are already stored in correct visual
 * order — only word order needs mirroring. Numbers/Latin/punctuation
 * tokens (e.g. "12", "·") move with the reversal as atomic units and are
 * never internally re-reversed, so "12" never becomes "21".
 *
 * Parenthesized groups are treated as a single atomic unit: "(a · b · c)"
 * keeps its internal word order and only moves as a block, so opening/
 * closing parens stay correctly paired with their contents after the
 * surrounding sentence is mirrored. This matters for strings built via
 * buildDetails(), e.g. "12 سؤال (مقالي · إختياري · صح/خطأ)".
 */
function renderBidiText(text, isArabic) {
  if (!text || !isArabic) return text;
  // Merge anything inside parentheses back into one token after the
  // initial split, so the group moves as a unit instead of having its
  // inner words individually reversed relative to each other.
  const rawTokens = text.split(" ");
  const tokens = [];
  let buffer = null;
  for (const tok of rawTokens) {
    if (buffer !== null) {
      buffer.push(tok);
      if (tok.endsWith(")")) {
        tokens.push(buffer.join(" "));
        buffer = null;
      }
      continue;
    }
    if (tok.startsWith("(") && !tok.endsWith(")")) {
      buffer = [tok];
      continue;
    }
    tokens.push(tok);
  }
  if (buffer !== null) tokens.push(...buffer); // unterminated "(" — bail safely
  return tokens.reverse().join(" ");
}

function formatQuestionTypes(qt) {
  if (!qt) return null;
  if (Array.isArray(qt)) return qt.length ? qt.join(" · ") : null;
  return String(qt) || null;
}

export function parseDbPath(dbPath, filename = "") {
  const segments = normalizeSlashes(dbPath).split("/").filter(Boolean);
  if (!segments.length) return null;

  const rootFolder = segments[0];
  const config = ROOT_MAP[rootFolder];
  if (!config) return null;

  const rest = segments.slice(1);
  const { education_type, segments: labels } = config;

  const fields = {};
  for (let i = 0; i < labels.length; i++) {
    fields[labels[i]] = rest[i];
  }

  const course = fields.course;
  if (!course) return null;

  const subfolders = rest.slice(labels.length);

  return { 
    education_type,
    rootFolder,
    college: fields.college,
    year: fields.year,
    term: fields.term,
    course,
    subfolders,
    filename: filename || undefined,
    dbPath: filename ? `${dbPath}/${filename}` : dbPath,
  };
}

export function normalizeSlashes(p) {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

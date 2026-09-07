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

// ── Course info fields (mirrors public/src/features/home/course-info-fields.js) ─
// This is a small server-side adapter, not a verbatim reuse: the client's
// buildCourseInfoRows() reads a tree-shaped `course` object (property
// `.faculty`) built client-side from the category tree, while this Edge
// function reads the raw Supabase `courses` row shape (`education_type`,
// `college`, `year`, `term`) fetched in fetchCourseMeta() above. The
// label set, ordering, and "hide empty" rules are kept identical to the
// client version so the OG image visually matches the in-app "معلومات
// المادة" modal.
const EDU_TYPE_AR = {
  University: "جامعي",
  High: "ثانوي",
  Middle: "إعدادي",
  Primary: "إبتدائي",
  Featured: "مادة مميزة",
};

/**
 * Builds course-info rows from the raw Supabase course fields, matching
 * buildCourseInfoRows()'s label set/ordering/omission rules, EXCEPT: for
 * "Featured" (مادة مميزة) courses, the نوع التعليم row is omitted entirely
 * rather than shown as "نوع التعليم: مادة مميزة" — "Featured" isn't a real
 * education-level distinction, so labeling it as one on a shareable image
 * reads as a mistake rather than useful info. (The in-app modal still
 * shows it, highlighted, since it's operating in a denser table context —
 * this is a thumbnail-specific simplification per user request, not a
 * client-side change.)
 *
 * @param {{educationType:string|null, college:string|null, year:string|null, term:string|null}} course
 * @returns {{label:string, val:string}[]}
 */
function buildCourseInfoRowsFromRow(course) {
  const rows = [];
  if (course.educationType !== "Featured") {
    rows.push({
      label: "نوع التعليم",
      val: EDU_TYPE_AR[course.educationType] || course.educationType || "-",
    });
  }
  if (course.college && course.college !== "All") {
    rows.push({ label: "الكلية", val: course.college });
  }
  if (course.year) {
    rows.push({ label: "العام", val: course.year });
  }
  if (course.term) {
    rows.push({ label: "الترم", val: course.term });
  }
  return rows;
}

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
// Also handles /api/og?course=<id> (course OG thumbnails) — merged in here
// rather than as a separate api/og-course.js function so the two Edge OG
// generators (quiz + course) share one Vercel function slot, since Hobby's
// 12-function cap counts them separately otherwise. Course requests are
// dispatched to renderCourseImage() below, which reuses this file's font
// loading and bidi helpers but has its own (much simpler) layout — the
// pixel-measured quiz-thumbnail background here is quiz-specific artwork
// (bulb card, button, pill) that doesn't make sense for a course page.
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get("course");
  if (courseId) {
    // ?folder=Algebra/Second (raw folder names, "/"-joined — see
    // render-course.js's OG image URL builder) requests the nested-folder
    // variant of the course image: same layout, but the title/stats reflect
    // the deepest folder in the chain instead of the course itself, with
    // the full "Course / Sub / Sub2" breadcrumb shown as the title.
    const folderPath = searchParams.get("folder");
    return renderCourseImage(courseId, folderPath ? folderPath.split("/").filter(Boolean) : null);
  }

  const quizId = searchParams.get("quizId");

  // ── 1. Fetch external assets in parallel ─────────────────────────────────
  const [fontData, quizData, bgImageArrayBuffer] = await Promise.all([
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
  ]);

  const meta = quizData;

  // ── 2. Build display strings ──────────────────────────────────────────────
  const rawTitle = meta ? (meta.title || quizId || "امتحان") : "منصة امتحانات بصمجي";
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
    url.searchParams.set("select", "data,title,subject");
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
      course: row.subject || null,
    };
  } catch (err) {
    console.error("[og] fetchQuizMeta error:", err);
    return null;
  }
}

/**
 * Finds a quiz entry by ID across all subjects in the manifest and shapes it
 * to match fetchQuizMeta's return shape.
 *
 * @param {{subjects: Array}} manifest
 * @param {string} quizId
 * @returns {{title:string, description:string|null, questionCount:number|null, questionTypes:string|null, author:string|null, course:string|null}|null}
 */
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

// =============================================================================
// Course / folder OG image (used by /api/og?course=<id>[&folder=...]) — see
// handler() dispatch above. Deliberately mirrors the quiz thumbnail's own
// composition (white background, rotated card holding a big icon on the
// left, content column on the right) instead of the old flat brand-gradient
// layout, so course/folder previews read as the same product as quiz
// previews rather than a completely different visual language. No
// background PNG is fetched here — the icon "card" is drawn from plain
// Satori shapes + a large emoji glyph, so a course/folder image needs no
// extra network round-trip beyond the font + Supabase metadata fetch.
// Reuses this file's font loading + Arabic bidi helpers.
// =============================================================================

const COURSE_TITLE_MAX_CHARS_ARABIC = 22;
const COURSE_TITLE_MAX_CHARS_LATIN = 36;

// Icon card geometry — deliberately matching the quiz thumbnail's own bulb
// card bounds (x 0–408, y 25–490 on the 1200×630 canvas — see the header
// comment at the top of this file) so course/folder images share the same
// visual rhythm as quiz images despite having no shared background asset.
const ICON_CARD = { left: 24, top: 25, width: 380, height: 465, rotationDeg: -6 };

// Right-hand content column — starts just past the icon card, runs the
// full remaining height of the canvas (not just a short top band) so the
// larger text sizes below have room to breathe and the link line can sit
// pinned to the bottom instead of immediately under the info rows.
const COURSE_CONTENT = { left: 470, right: 1152, top: 56, bottom: 630 - 40 };

async function renderCourseImage(courseId, folderPath) {
  const [fontData, meta] = await Promise.all([
    loadFont().catch((err) => {
      console.error("[og] course font load error:", err);
      return null;
    }),
    fetchCourseMeta(courseId, folderPath),
  ]);

  const isFolder = !!(meta && meta.isFolder);

  // Title is the item's OWN name — the folder's own name for a folder
  // image, or the course's own name for a course image — never the full
  // concatenated breadcrumb. The parent course (for a folder) is shown
  // as its own labeled line in the info block below, per spec: folder
  // name + parent COURSE's info, not a smashed-together path string.
  const rawTitle = meta ? meta.name : "منصة امتحانات بصمجي";
  const isArabic = detectArabic(rawTitle);
  const title = truncateTitle(
    rawTitle,
    isArabic ? COURSE_TITLE_MAX_CHARS_ARABIC : COURSE_TITLE_MAX_CHARS_LATIN,
  );

  // Sized up from the first pass — the old tiers (56/48/40) left a lot of
  // the card's height unused. These top out at 72px (course/folder titles
  // are short, 1-3 words, so the common case hits the largest tier).
  const titleFontSize = isArabic
    ? title.length > 18
      ? "48px"
      : title.length > 13
        ? "58px"
        : "72px"
    : title.length > 26
      ? "44px"
      : title.length > 20
        ? "56px"
        : "68px";

  // Course-info rows — always the top-level COURSE's own fields (see
  // fetchCourseMeta's comment: a folder has no education_type/college/
  // year/term of its own), matching buildCourseInfoRows()'s label set,
  // order, and "hide empty" rules (except the Featured special-case, see
  // buildCourseInfoRowsFromRow's own doc comment).
  const infoRows = meta ? buildCourseInfoRowsFromRow(meta) : [];

  // For a folder image, the course name gets its own small line above the
  // info rows so it's unambiguous which course "نوع التعليم"/"الكلية"/etc.
  // belong to (they're the course's, not the folder's).
  const parentCourseLine =
    isFolder && meta && meta.courseName ? meta.courseName : null;

  const countsLabel = meta
    ? isArabic
      ? `${meta.folderCount} مجلد · ${meta.quizCount} امتحان`
      : `${meta.folderCount} Folders · ${meta.quizCount} Quizzes`
    : null;

  // Human-readable link line, mirroring the actual /course/:slug[/...] URL
  // shape render-course.js builds (course name -> slug via toSlug(), then
  // raw folder names joined by "/"). This is a readable approximation for
  // display purposes only — the real canonical URL (with proper
  // encodeURIComponent + toSlug on each segment) is what's actually set as
  // og:url by render-course.js; this line just needs to look right, not be
  // clickable. Rendered at the bottom of the card (see layout below), not
  // immediately under the info rows, so it always reads as a footer.
  const slugify = (s) => (s || "").trim().replace(/-/g, "--").replace(/\s+/g, "-");
  const courseSlug = meta ? slugify(meta.courseName || meta.name) : "";
  const linkPath =
    folderPath && folderPath.length > 0
      ? `basmagi-quiz.vercel.app/course/${courseSlug}/${folderPath.map(slugify).join("/")}`
      : `basmagi-quiz.vercel.app/course/${courseSlug}`;

  const contentWidth = COURSE_CONTENT.right - COURSE_CONTENT.left;

  /**
   * Builds one course-info row as TWO separate flex children (label,
   * value) instead of one pre-joined "label: value" string run through
   * renderBidiText(). renderBidiText() mirrors word order by splitting on
   * spaces — fine for a sentence, but "نوع التعليم: جامعي" has its OWN
   * internal word order (نوع التعليم is a two-word label) that must stay
   * intact; running it through the same word-reversal that page-level
   * sentences use tears the label apart and misplaces the colon (see bug
   * report — rows rendered as "جامعي التعليم: نوع"). A label/value pair is
   * structurally a two-item list, not a sentence, so it's mirrored the
   * same safe way flexbox row-order is mirrored elsewhere in this file
   * (e.g. the old stats row): as two sibling elements under
   * `flexDirection: row-reverse` for Arabic, each showing its own text
   * verbatim with no word-order manipulation at all.
   */
  function buildInfoRowChildren(row) {
    return {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: isArabic ? "row-reverse" : "row",
          alignItems: "baseline",
          gap: "8px",
          direction: "ltr",
        },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", color: "#6b7280", fontWeight: "400" },
              children: `${row.label}:`,
            },
          },
          {
            type: "div",
            props: {
              style: { display: "flex", color: "#111827", fontWeight: "700" },
              children: String(row.val),
            },
          },
        ],
      },
    };
  }

  const element = {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        fontFamily: FONT_FAMILY_STACK,
        backgroundColor: "#ffffff",
        backgroundImage:
          "radial-gradient(circle at 0% 0%, rgba(124,58,237,0.10) 0%, rgba(124,58,237,0) 45%)",
      },
      children: [
        // ── Domain label — top-right corner, matches quiz thumbnail ──────
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              position: "absolute",
              right: "40px",
              top: "24px",
              fontSize: "16px",
              color: "#9ca3af",
              fontWeight: "400",
              direction: "ltr",
            },
            children: "basmagi-quiz.vercel.app",
          },
        },

        // ── Icon card — mirrors the quiz thumbnail's rotated bulb card,
        // holding a large emoji instead of the bulb PNG. 🎓 distinguishes
        // a course, 📁 a folder — this is the "big, distinguishing icon"
        // requested, sized to match the bulb's own visual weight rather
        // than a small badge. ────────────────────────────────────────────
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              position: "absolute",
              left: `${ICON_CARD.left}px`,
              top: `${ICON_CARD.top}px`,
              width: `${ICON_CARD.width}px`,
              height: `${ICON_CARD.height}px`,
              borderRadius: "36px",
              backgroundColor: "#ffffff",
              boxShadow: "0 30px 60px rgba(15,23,42,0.12)",
              border: "1px solid rgba(15,23,42,0.06)",
              transform: `rotate(${ICON_CARD.rotationDeg}deg)`,
              alignItems: "center",
              justifyContent: "center",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: "220px",
                    lineHeight: "1",
                    transform: `rotate(${-ICON_CARD.rotationDeg}deg)`,
                  },
                  children: isFolder ? "📁" : "🎓",
                },
              },
            ],
          },
        },

        // ── Content column ────────────────────────────────────────────────
        // justifyContent: space-between + absolute top/bottom pinning
        // spreads the header block and the link footer across the full
        // available height, instead of everything bunching up near the
        // top and leaving a large empty band below it (the "unused white
        // space" issue).
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              position: "absolute",
              left: `${COURSE_CONTENT.left}px`,
              top: `${COURSE_CONTENT.top}px`,
              bottom: `${630 - COURSE_CONTENT.bottom}px`,
              width: `${contentWidth}px`,
              direction: "ltr",
              alignItems: isArabic ? "flex-end" : "flex-start",
              textAlign: isArabic ? "right" : "left",
            },
            children: [
              // ── Header block (kind label, parent line, title, info
              // rows, counts pill) — grouped together so the space-between
              // above only inserts one gap: between this block and the
              // link footer. ──────────────────────────────────────────────
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    alignItems: isArabic ? "flex-end" : "flex-start",
                    width: "100%",
                  },
                  children: [
                    // Kind label — COURSE / FOLDER
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          fontSize: "24px",
                          color: BRAND_BLUE,
                          fontWeight: "700",
                          letterSpacing: "1px",
                          direction: "ltr",
                        },
                        children: isFolder
                          ? isArabic ? "مجلد" : "FOLDER"
                          : isArabic ? "مقرر دراسي" : "COURSE",
                      },
                    },

                    // Parent-course line — folder images only.
                    parentCourseLine
                      ? {
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            flexDirection: isArabic ? "row-reverse" : "row",
                            marginTop: "12px",
                            fontSize: "26px",
                            color: "#6b7280",
                            fontWeight: "400",
                            gap: "8px",
                            direction: "ltr",
                          },
                          children: [
                            {
                              type: "div",
                              props: { style: { display: "flex" }, children: isArabic ? "في" : "in" },
                            },
                            {
                              type: "div",
                              props: {
                                style: { display: "flex", fontWeight: "700", color: "#374151" },
                                children: parentCourseLine,
                              },
                            },
                          ],
                        },
                      }
                      : null,

                    // Title — the item's own name.
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          marginTop: "18px",
                          fontSize: titleFontSize,
                          fontWeight: "700",
                          color: "#111827",
                          lineHeight: "1.2",
                          direction: "ltr",
                          width: "100%",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                        },
                        children: renderBidiText(title, isArabic),
                      },
                    },

                    // Course-info rows — نوع التعليم / الكلية / العام /
                    // الترم, same label set + ordering as the in-app
                    // "معلومات المادة" modal (minus نوع التعليم for
                    // Featured courses — see buildCourseInfoRowsFromRow).
                    // Each row is two separate flex children, not a
                    // word-reversed joined string — see
                    // buildInfoRowChildren's doc comment for why.
                    infoRows.length > 0
                      ? {
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            flexDirection: "column",
                            alignItems: isArabic ? "flex-end" : "flex-start",
                            marginTop: "28px",
                            gap: "12px",
                            fontSize: "26px",
                          },
                          children: infoRows.map(buildInfoRowChildren),
                        },
                      }
                      : null,

                    // Counts pill — reuses the quiz thumbnail badge
                    // styling for visual consistency between quiz and
                    // course/folder previews. Bumped up in size to match
                    // the larger text used everywhere else in this
                    // layout.
                    countsLabel
                      ? {
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            marginTop: "32px",
                            alignItems: "center",
                            background: "rgba(0,136,204,0.12)",
                            border: "1px solid rgba(0,136,204,0.3)",
                            borderRadius: "12px",
                            padding: "12px 26px",
                            fontSize: "26px",
                            color: BRAND_BLUE,
                            fontWeight: "700",
                            direction: "ltr",
                          },
                          children: renderBidiText(countsLabel, isArabic),
                        },
                      }
                      : null,
                  ].filter(Boolean),
                },
              },

              // ── Link footer — pinned to the bottom of the card by the
              // space-between on the parent column, per request (was
              // previously right under the info rows, floating in the
              // middle of a lot of empty space below it). ────────────────
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: "20px",
                    color: "#9ca3af",
                    fontWeight: "400",
                    direction: "ltr",
                  },
                  children: linkPath,
                },
              },
            ],
          },
        },
      ],
    },
  };

  const renderIsComplete = fontData !== null && meta !== null;

  return new ImageResponse(element, {
    width: 1200,
    height: 630,
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

/**
 * Fetches course metadata + folder/quiz counts via the Supabase PostgREST
 * HTTP API (Edge-safe, fetch-only). Uses relational count queries (Prefer:
 * count=exact HEAD requests) against `folders`/`quizzes` by course_id,
 * matching the approach public/src/shared/quizManifest.js uses client-side —
 * not a manifest re-walk.
 *
 * @param {string} courseId
 * @param {string[]|null} folderPath Raw folder names to walk under the
 *   course (e.g. ["Algebra", "Second"]), or null/[] for the course itself.
 * @returns {Promise<{name:string, breadcrumb:string, folderCount:number, quizCount:number, questionCount:number|null, lastUpdated:string|null}|null>}
 */
async function fetchCourseMeta(courseId, folderPath) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[og] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };

  try {
    const courseUrl = new URL(`${SUPABASE_URL}/rest/v1/courses`);
    courseUrl.searchParams.set("select", "id,name,education_type,college,year,term");
    courseUrl.searchParams.set("id", `eq.${courseId}`);
    courseUrl.searchParams.set("limit", "1");

    const courseRes = await fetch(courseUrl.toString(), { headers });
    if (!courseRes.ok) {
      console.error(`[og] course lookup returned ${courseRes.status}`);
      return null;
    }
    const courseRows = await courseRes.json();
    if (!courseRows || courseRows.length === 0) return null;
    const course = courseRows[0];

    // ── Walk the folder path (if any), matching each segment by raw name ──
    // (render-course.js already resolved the slug → real name server-side
    // before building this /api/og?folder= URL, so here it's an exact-name
    // match at each level — no toSlug needed on this side.)
    let targetFolderId = null;
    let targetName = course.name;
    const breadcrumbParts = [course.name];

    if (Array.isArray(folderPath) && folderPath.length > 0) {
      let parentFolderId = null;
      for (const segment of folderPath) {
        const folderUrl = new URL(`${SUPABASE_URL}/rest/v1/folders`);
        folderUrl.searchParams.set("select", "id,name");
        folderUrl.searchParams.set("course_id", `eq.${courseId}`);
        folderUrl.searchParams.set(
          "parent_folder_id",
          parentFolderId ? `eq.${parentFolderId}` : "is.null",
        );
        folderUrl.searchParams.set("name", `eq.${segment}`);
        folderUrl.searchParams.set("limit", "1");

        const folderRes = await fetch(folderUrl.toString(), { headers });
        if (!folderRes.ok) break;
        const folderRows = await folderRes.json();
        if (!folderRows || folderRows.length === 0) break; // unresolved — fall back to course-level below

        parentFolderId = folderRows[0].id;
        breadcrumbParts.push(folderRows[0].name);
      }
      // Only treat the walk as successful if every segment resolved.
      if (breadcrumbParts.length === folderPath.length + 1) {
        targetFolderId = parentFolderId;
        targetName = breadcrumbParts[breadcrumbParts.length - 1];
      } else {
        breadcrumbParts.length = 1; // reset to course-only breadcrumb
      }
    }

    const countFor = async (table, idColumn) => {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
      url.searchParams.set("select", "id");
      url.searchParams.set(idColumn, `eq.${targetFolderId || courseId}`);
      const res = await fetch(url.toString(), {
        method: "HEAD",
        headers: { ...headers, Prefer: "count=exact" },
      });
      if (!res.ok) return 0;
      const range = res.headers.get("content-range"); // "0-24/123"
      const total = range ? Number(range.split("/")[1]) : 0;
      return Number.isFinite(total) ? total : 0;
    };

    // Direct children only: scoped to the resolved folder via
    // parent_folder_id/folder_id when a folder resolved, otherwise scoped
    // to the whole course via course_id — matching render-course.js's
    // same course-vs-folder count distinction.
    const [folderCount, quizCount] = targetFolderId
      ? await Promise.all([
        countFor("folders", "parent_folder_id"),
        countFor("quizzes", "folder_id"),
      ])
      : await Promise.all([
        countFor("folders", "course_id"),
        countFor("quizzes", "course_id"),
      ]);

    // Best-effort extra stats (question count total, last-updated date) —
    // not fatal if this sub-fetch fails.
    let questionCount = null;
    let lastUpdated = null;
    try {
      const quizzesUrl = new URL(`${SUPABASE_URL}/rest/v1/quizzes`);
      quizzesUrl.searchParams.set("select", "data,created_at");
      // Scoped to the resolved folder's direct quizzes when a folder path
      // resolved, otherwise the whole course — same distinction as the
      // folderCount/quizCount queries above.
      quizzesUrl.searchParams.set(
        targetFolderId ? "folder_id" : "course_id",
        `eq.${targetFolderId || courseId}`,
      );
      quizzesUrl.searchParams.set("order", "created_at.desc");
      quizzesUrl.searchParams.set("limit", "500");
      const quizzesRes = await fetch(quizzesUrl.toString(), { headers });
      if (quizzesRes.ok) {
        const rows = await quizzesRes.json();
        if (Array.isArray(rows) && rows.length > 0) {
          questionCount = rows.reduce((sum, row) => {
            const qc = row?.data?.stats?.questionCount;
            return sum + (typeof qc === "number" ? qc : 0);
          }, 0);
          const newest = rows[0]?.created_at;
          if (newest) lastUpdated = new Date(newest).toLocaleDateString("en-CA");
        }
      }
    } catch (err) {
      console.error("[og] course extra stats fetch error:", err);
    }

    return {
      // The item this image is actually about — the deepest resolved
      // folder's own name when a folder path was given, otherwise the
      // course's own name. Used as the big title.
      name: targetName || "Course",
      isFolder: targetFolderId !== null,
      // Full "Course / Sub / Sub2" chain — kept for callers that still
      // want the old breadcrumb string (e.g. logs), not used as the
      // title directly anymore (see renderCourseImage).
      breadcrumb: breadcrumbParts.join(" / "),
      // The top-level course's own name — always the *course's*, never
      // the immediate parent folder's, so a folder several levels deep
      // still shows which course it belongs to.
      courseName: course.name,
      // Course-info fields — mirrors buildCourseInfoRows() in
      // course-info-fields.js exactly (نوع التعليم/الكلية/العام/الترم),
      // but read from the raw Supabase row shape (education_type/college/
      // year/term) rather than the client's tree-shaped course object
      // (which calls the same field `faculty`, not `college`). These are
      // always the COURSE's own fields, never the folder's — a folder has
      // no education_type/college/year/term of its own.
      educationType: course.education_type || null,
      college: course.college || null,
      year: course.year != null ? String(course.year) : null,
      term: course.term != null ? String(course.term) : null,
      folderCount,
      quizCount,
      questionCount,
      lastUpdated,
    };
  } catch (err) {
    console.error("[og] fetchCourseMeta error:", err);
    return null;
  }
}
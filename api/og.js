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
                // ltr here: this wrapper has a single child (the badge
                // div below), so there's no sibling order at this level
                // for flexbox to mirror. The badge's own Arabic mirroring
                // happens one level down, via flexDirection: row-reverse
                // on its sibling token children — leaving this outer
                // wrapper as rtl would double-handle direction and
                // produce the oversized inter-word gaps Satori's Arabic
                // shaper adds under an rtl context.
                direction: "ltr",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: isArabic ? "row-reverse" : "row",
                      alignItems: "center",
                      gap: "6px",
                      background: "rgba(0,136,204,0.12)",
                      border: `1px solid rgba(0,136,204,0.3)`,
                      borderRadius: "10px",
                      padding: "8px 22px",
                      fontSize: "20px",
                      color: BRAND_BLUE,
                      fontWeight: "700",
                      // ltr: mirroring for Arabic now happens via
                      // flexDirection: row-reverse above (sibling tokens
                      // from renderBidiChildren), not via a pre-mirrored
                      // text node — see renderBidiChildren's doc comment
                      // for why a single joined string can't safely mix
                      // Arabic words with the digits/"·" this badge
                      // contains (e.g. "12 سؤال").
                      direction: "ltr",
                    },
                    children: renderBidiChildren(details, isArabic),
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
                    flexDirection: isArabic ? "row-reverse" : "row",
                    flexWrap: "nowrap",
                    gap: "0.25em",
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
                  // Sibling tokens instead of one pre-mirrored string — a
                  // title is free user text that can contain digits or
                  // "·"/parenthesis punctuation next to Arabic words,
                  // which hits the space-collapse bug documented on
                  // renderBidiText() (confirmed: a title like "مراجعة
                  // الفصل 3 النهائية" paints with several words glued
                  // together with no visible gap). See renderBidiChildren.
                  children: renderBidiChildren(title, isArabic),
                },
              },

              // ── Description (smaller, single line, muted) ──────────────
              description
                ? {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: isArabic ? "row-reverse" : "row",
                      flexWrap: "nowrap",
                      gap: "0.25em",
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
                    children: renderBidiChildren(description, isArabic),
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
 *
 * KNOWN LIMITATION — do not use this for strings mixing Arabic words with
 * digits/Latin/"·" (rejoined with a plain " "): Satori's shaper silently
 * collapses the space at any boundary where an Arabic-script character is
 * the very next glyph in storage order (confirmed by direct Satori
 * rendering, not just code reading — e.g. "12 سؤال" round-trips through
 * this function fine as a STRING, but paints as "12سؤال" with zero visible
 * gap, and reversing the boundary doesn't reliably fix it either — nor
 * does substituting NBSP, which "fixes" the gap but then corrupts the
 * digit's own internal shaping ("12" paints as "21"). There is no
 * single-text-node fix. For any string that mixes Arabic words with
 * digits, Latin, or "·"/parenthesis punctuation, use renderBidiChildren()
 * instead, which sidesteps the bug entirely by never emitting a shared
 * text node across that boundary. Reserve this function for strings that
 * are pure Arabic-script words throughout (e.g. a title, a two-word
 * label) — those have no such boundary and are unaffected.
 */
function renderBidiText(text, isArabic) {
  if (!text || !isArabic) return text;
  return tokenizeBidiText(text).reverse().join(" ");
}

/**
 * Splits text into bidi-reorderable tokens: whitespace-separated, with any
 * "(...)" group merged back into one atomic token so its internal order
 * survives the later reversal intact. Shared by renderBidiText() (string
 * output) and renderBidiChildren() (sibling-node output).
 */
function tokenizeBidiText(text) {
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
  return tokens;
}

/**
 * Bidi-safe alternative to renderBidiText() for any string that mixes
 * Arabic words with digits, Latin, or "·"/parenthesis punctuation — see
 * the KNOWN LIMITATION note on renderBidiText() for why a single joined
 * text node can't be made to work here (confirmed by direct Satori
 * rendering: no separator character both preserves the gap AND leaves
 * digit shaping uncorrupted at every boundary direction).
 *
 * Returns an ARRAY of sibling `div` nodes — one per token, already in
 * final (reversed, for Arabic) paint order — instead of one string. The
 * caller must render these as flex children of a container with a `gap`
 * (not a plain text node), so spacing between tokens comes from flexbox
 * layout rather than a text-run space Satori can collapse. This is the
 * same sibling-elements-plus-gap pattern already used elsewhere in this
 * file (e.g. buildInfoRowChildren, the parent-course line) for exactly
 * this reason.
 *
 * For non-Arabic text, still returns an array (of one token per
 * whitespace-separated word, in original order) so callers can use one
 * rendering path regardless of script — flex order for LTR content is
 * just its natural left-to-right order, so no reversal is needed.
 *
 * Callers apply `flexDirection: isArabic ? "row-reverse" : "row"` — NOT a
 * pre-reversed array with plain "row" — so alignment/gap math and any
 * future RTL-aware flex features (e.g. wrapping) behave the same as this
 * file's other sibling-based rows.
 */
function renderBidiChildren(text, isArabic) {
  if (!text) return [];
  const tokens = isArabic ? tokenizeBidiText(text) : text.split(" ");
  return tokens.map((tok) => ({
    type: "div",
    props: { style: { display: "flex" }, children: tok },
  }));
}

function formatQuestionTypes(qt) {
  if (!qt) return null;
  if (Array.isArray(qt)) return qt.length ? qt.join(" · ") : null;
  return String(qt) || null;
}

/**
 * Slug/URL-path counterpart to renderBidiText(). A slugified Arabic segment
 * (e.g. "إمتحانات-سابقة-لنفس-الدكتور") is hyphen-joined, not space-joined —
 * renderBidiText()'s word split on " " is a no-op on a string like this, so
 * without this helper the segment reaches Satori completely untouched and
 * comes out in raw storage order (first word painted rightmost-of-nowhere
 * instead of rightmost-visually — the same class of bug renderBidiText
 * fixes for sentences, just with "-" as the token separator instead of " ").
 *
 * Only reorders a segment that is itself Arabic (detectArabic on the whole
 * segment) — Latin segments (e.g. a course slug like
 * "Data-Structures-and-Algorithms") must never be touched, since flipping a
 * segment's own word order would break EN slugs.
 *
 * Only the ORDER of hyphen-separated tokens is reversed — never the
 * characters within a token — matching renderBidiText's word vs.
 * glyph distinction. A leading/trailing empty token (from slugify()'s own
 * "-" -> "--" doubling, or an edge hyphen) is preserved in place rather
 * than moved, so doubled hyphens don't collapse or migrate.
 */
function renderBidiSlugSegment(segment) {
  if (!segment || !detectArabic(segment)) return segment;
  return segment.split("-").reverse().join("-");
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
  // NOTE: `isArabic` here is used ONLY to decide word-order reversal for a
  // given text run (per renderBidiText's own doc comment) and text-length
  // budgets/font sizing — it must NEVER be used to pick which side of the
  // canvas things are laid out on, or the layout would move around
  // depending on whatever the current title happens to be (this is
  // exactly the bug that shipped previously — course-info sometimes on
  // the left, sometimes the right). This page's overall reading direction
  // is fixed to RTL — see the static layout below — independent of title
  // language.
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

  // Token array, not a joined string — "70 مجلد" mixes a digit with an
  // Arabic word, which hits the space-collapse bug documented on
  // renderBidiText() ("70سؤال" with zero visible gap). Rendered as sibling
  // flex children with a `gap` at the call site instead (see
  // renderBidiChildren's doc comment).
  const countsTokens = meta
    ? isArabic
      ? [String(meta.folderCount), "مجلد", "·", String(meta.quizCount), "امتحان"]
      : [String(meta.folderCount), "Folders", "·", String(meta.quizCount), "Quizzes"]
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
  // Each slug segment is bidi-fixed independently via renderBidiSlugSegment
  // (see its doc comment) — the course slug can itself be Arabic (an
  // Arabic-named course with no folder path), and each folder-path segment
  // is checked/fixed on its own rather than after joining, so a mixed
  // Arabic/Latin path (e.g. an English course containing an Arabic folder)
  // only reorders the segment(s) that actually need it.
  const courseSlug = meta
    ? renderBidiSlugSegment(slugify(meta.courseName || meta.name))
    : "";
  const fullLinkPath =
    folderPath && folderPath.length > 0
      ? `basmagi-quiz.vercel.app/course/${courseSlug}/${folderPath
        .map((seg) => renderBidiSlugSegment(slugify(seg)))
        .join("/")}`
      : `basmagi-quiz.vercel.app/course/${courseSlug}`;

  // Footer link — MUST stay on one line. Long paths used to wrap onto a
  // second line (ugly). Fix: hard single-line + truncate from the FRONT
  // ("…" + tail) once it's too long to fit, so the most identifying part
  // — the actual course/folder slug at the end of the path — stays
  // visible instead of the always-identical "basmagi-quiz.vercel.app/
  // course/" prefix. Budget is generous (the footer now spans the full
  // centered canvas width, ~1120px, not just the narrow right-hand
  // content column) — this is a plain character-count clamp, not a
  // font-metrics measurement, so it errs conservative rather than risking
  // overflow past the canvas edges.
  const LINK_MAX_CHARS = 100;
  const linkPath =
    fullLinkPath.length > LINK_MAX_CHARS
      ? "…" + fullLinkPath.slice(fullLinkPath.length - (LINK_MAX_CHARS - 1))
      : fullLinkPath;

  const contentWidth = COURSE_CONTENT.right - COURSE_CONTENT.left;

  // ── Course-info TABLE ────────────────────────────────────────────────
  // Per spec: this is a table, not a pair of independently-mirrorable
  // flex rows. Keys always sit on the right and read RTL; values always
  // sit on the left and read LTR — even when the value itself is Arabic
  // text (e.g. "Computer Science" vs. "نظم معلومات") — because a
  // consistent two-column grid reads better than a layout that
  // reorders itself per-row based on each value's own script. The whole
  // table is a fixed-position, fixed-width block (see COURSE_INFO_TABLE
  // geometry below) so its position on the canvas never moves, no matter
  // what the title or values are — this directly fixes the "info block
  // moves left/right depending on the quiz title" bug.
  function buildInfoTable(rows) {
    return {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          border: "1px solid rgba(15,23,42,0.10)",
          borderRadius: "16px",
          overflow: "hidden",
          direction: "ltr",
        },
        children: rows.map((row, i) => ({
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "row",
              width: "100%",
              borderTop: i === 0 ? "none" : "1px solid rgba(15,23,42,0.08)",
              background: i % 2 === 1 ? "rgba(15,23,42,0.02)" : "transparent",
            },
            children: [
              // Key column — always the RIGHT side, always RTL-aligned
              // text, regardless of the value's script.
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    order: 2,
                    flex: "0 0 46%",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    padding: "14px 22px",
                    color: "#6b7280",
                    fontWeight: "400",
                    fontSize: "24px",
                    direction: "ltr", // container stays ltr — text is untouched (see below)
                  },
                  // Multi-word Arabic labels ARE reversed by renderBidiText
                  // only for containers whose flex order is itself
                  // mirrored (row-reverse) — see that helper's own doc
                  // comment. This column is a plain LTR "row" (not
                  // reversed), so the label text must be passed through
                  // UNTOUCHED: Satori paints word-tokens in storage order
                  // regardless of `direction`, and "نوع التعليم" is
                  // already stored in correct reading order — reversing it
                  // here is what produced the flipped "التعليم نوع" bug.
                  children: row.label,
                },
              },
              // Value column — always the LEFT side, always LTR-aligned,
              // even for an Arabic value — this is the "even if they are
              // Arabic, tables look better this way" rule from the brief.
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    order: 1,
                    flex: "1 1 54%",
                    justifyContent: "flex-start",
                    alignItems: "center",
                    padding: "14px 22px",
                    color: "#111827",
                    fontWeight: "700",
                    fontSize: "24px",
                    borderRight: "1px solid rgba(15,23,42,0.08)",
                    direction: "ltr",
                  },
                  children: String(row.val),
                },
              },
            ],
          },
        })),
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
              // FIXED regardless of title/value language — this column's
              // side never moves based on what text happens to be in it
              // (see the isArabic doc comment above renderCourseImage's
              // title logic for why). The product itself is Arabic-first,
              // so the column is always right-aligned/RTL-reading.
              alignItems: "flex-end",
              textAlign: "right",
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
                    alignItems: "flex-end",
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
                          ? "مجلد"
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
                            flexDirection: "row-reverse",
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
                              props: { style: { display: "flex" }, children: "في" },
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
                          // Untouched, non-reversed Arabic text needs
                          // `direction: rtl` on its own text container so
                          // Satori paints its word order correctly (this
                          // is the "sibling elements doing their own
                          // mirroring" case being the exception — see
                          // renderBidiText's doc comment — but a single
                          // leaf with genuinely RTL content is the OTHER
                          // legitimate case: `ltr` here was what produced
                          // the reversed-with-huge-gaps rendering, since
                          // Satori's shaper needs to know this run is RTL
                          // to lay out and join the glyphs correctly).
                          direction: isArabic ? "rtl" : "ltr",
                          width: "100%",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          justifyContent: "flex-end",
                          textAlign: "right",
                        },
                        // Single text node, not word-reversed — see the
                        // direction comment just above.
                        children: title,
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
                            width: "100%",
                            marginTop: "28px",
                          },
                          children: [buildInfoTable(infoRows)],
                        },
                      }
                      : null,

                    // Counts pill — reuses the quiz thumbnail badge
                    // styling for visual consistency between quiz and
                    // course/folder previews. Bumped up in size to match
                    // the larger text used everywhere else in this
                    // layout. Rendered as sibling tokens (renderBidiChildren)
                    // + flexDirection: row-reverse rather than one
                    // pre-mirrored string — "70 مجلد" mixes a digit with
                    // an Arabic word, which hits the space-collapse bug
                    // documented on renderBidiText() (paints as "70مجلد"
                    // with no visible gap). See renderBidiChildren's doc
                    // comment.
                    countsTokens
                      ? {
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            flexDirection: "row-reverse",
                            marginTop: "32px",
                            alignItems: "center",
                            gap: "8px",
                            background: "rgba(0,136,204,0.12)",
                            border: "1px solid rgba(0,136,204,0.3)",
                            borderRadius: "12px",
                            padding: "12px 26px",
                            fontSize: "26px",
                            color: BRAND_BLUE,
                            fontWeight: "700",
                            direction: "ltr",
                          },
                          children: countsTokens.map((tok) => ({
                            type: "div",
                            props: { style: { display: "flex" }, children: tok },
                          })),
                        },
                      }
                      : null,
                  ].filter(Boolean),
                },
              },
            ],
          },
        },

        // ── Link footer — full canvas width, horizontally centered
        // (per request: previously confined to the narrow right-hand
        // content column, which both clipped long paths and left all the
        // space under the icon card on the left unused). Absolutely
        // positioned independently of the content column so centering is
        // against the whole 1200px canvas, not just its own column. Still
        // single-line (`whiteSpace: nowrap` + `overflow: hidden`) — but
        // the char budget above is generous enough, and centered text
        // rarely needs the aggressive front-truncation a right-anchored
        // line does, so nothing meaningful gets clipped in practice. ─────
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              position: "absolute",
              left: "40px",
              right: "40px",
              bottom: "40px",
              justifyContent: "center",
              fontSize: "20px",
              color: "#9ca3af",
              fontWeight: "400",
              whiteSpace: "nowrap",
              overflow: "hidden",
              direction: "ltr",
            },
            children: linkPath,
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
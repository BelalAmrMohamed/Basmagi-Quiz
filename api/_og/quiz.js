// =============================================================================
// api/_og/quiz.js
// Quiz thumbnail  —  /api/og?quizId=<id>
// =============================================================================
import { BRAND_BLUE, FONT_FAMILY_STACK, SITE_ORIGIN, SUPABASE_ANON_KEY, SUPABASE_URL, detectArabic, loadFont, renderBidiChildren, renderBidiText, renderPng, truncateTitle } from "./common.js";

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

// At 20px Tajawal in the 640px TEXT_COLUMN, Latin glyphs average ~11px wide
// → ≈58 chars max before overflow; Arabic glyphs are wider so we use 55 for
// a shared safe limit that covers both scripts without a separate detection pass.
const DESCRIPTION_MAX_CHARS = 48;

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

// ── Background image cache (survives across warm invocations) ───────────────
// Same rationale as _fontDataPromise above: BACKGROUND_IMAGE_URL is a
// single static asset (see the header comment — "static template PNG") that
// never varies per-request, yet the fetch + base64-encode of it was
// previously repeated on every single invocation of both renderers (quiz
// AND course/folder), warm or cold. A 1200×630 RGBA PNG easily runs several
// hundred KB, so that repeated fetch/encode/Satori-reparse was plausibly
// the largest single contributor to the >1s response times — far more than
// PNG vs JPEG output encoding would ever cost for an image this size (and
// @vercel/og's ImageResponse has no format option to control that anyway;
// see loadBackgroundImage()'s own doc comment). Caching this the same way
// the font is already cached should meaningfully cut warm-invocation
// latency at near-zero risk, since the asset is static by definition.
let _bgImagePromise = null;

/**
 * Fetches the static quiz-thumbnail background PNG and returns its already
 * base64-encoded `url(data:image/png;base64,...)` CSS string, ready to drop
 * straight into a `backgroundImage` style.
 *
 * Result is cached at module level (see _bgImagePromise above) so warm Edge
 * invocations skip both the network fetch AND the base64 encode — the same
 * caching this file already applies to the font, applied here for the same
 * reason: this is one unchanging static asset (BACKGROUND_IMAGE_URL never
 * varies per-request), so re-fetching and re-encoding it on every single
 * invocation was pure waste and a likely major contributor to slow
 * response times.
 *
 * NOTE on image format: @vercel/og's ImageResponse constructor has no
 * `format`/`quality` option — it only ever outputs PNG, regardless of what
 * format the *input* background asset is in (confirmed against Vercel's own
 * docs; there's an open, unresolved upstream GitHub discussion requesting
 * exactly this feature). So switching this background source to .jpg would
 * change what @vercel/og has to decode going IN, but would NOT change the
 * PNG format of the image this function ultimately returns to the client —
 * it cannot, since that step isn't configurable from here. This caching fix
 * targets the actual repeated-fetch/re-encode cost instead, which is a real,
 * controllable source of the slowness.
 *
 * @returns {Promise<string|null>} the CSS `url(data:...)` string, or null if
 *   the fetch failed (caller falls back to a solid background color).
 */
function loadBackgroundImage() {
  if (_bgImagePromise) return _bgImagePromise;
  _bgImagePromise = fetch(BACKGROUND_IMAGE_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load background image: ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buf) => `url(data:image/png;base64,${Buffer.from(buf).toString("base64")})`)
    .catch((err) => {
      console.error("[og] bg image fetch error:", err);
      // Don't cache a failure — let the next invocation retry, same as a
      // transient font-fetch hiccup would (see loadFont()'s own null-return
      // fallback for the parallel case).
      _bgImagePromise = null;
      return null;
    });
  return _bgImagePromise;
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
export async function renderQuizImage(quizId) {
  
  // ── 1. Fetch external assets in parallel ─────────────────────────────────
  const [fontData, quizData, bgImageBase64] = await Promise.all([
    // If the font fetch/parse ever fails again (network hiccup, Google
    // Fonts markup change, etc.), fall back to null rather than letting
    // the whole handler throw — ImageResponse still renders fine without
    // a custom font entry, just with the system default instead of Tajawal.
    loadFont().catch((err) => {
      console.error("[og] font load error:", err);
      return null;
    }),
    quizId ? fetchQuizMeta(quizId) : null,
    // Cached at module level via loadBackgroundImage() — see its own doc
    // comment for why (this is a static asset, never varies per-request).
    loadBackgroundImage(),
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

  // Background image CSS string — already fully built (fetched, encoded,
  // and cached) by loadBackgroundImage() above; falls back to "none" (solid
  // fallback color below) if that fetch failed.
  const bgImageCss = bgImageBase64 || "none";

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
        backgroundImage: bgImageCss,
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
            children: "basmagi.vercel.app",
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
                    children: renderBidiChildren(description, isArabic, { noShrink: true }),
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
    bgImageBase64 !== null && fontData !== null && (!quizId || meta !== null);

  return renderPng(element, fontData, { complete: renderIsComplete, fallback: "/assets/images/thumbnails/quiz-thumbnail.png" });
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
 * Truncates the description line, which sits below the title at a smaller
 * size and must also never wrap (single line only).
 */
function truncateDescription(description) {
  if (!description) return description;
  const clean = description.replace(/\s+/g, " ").trim();
  if (clean.length <= DESCRIPTION_MAX_CHARS) return clean;
  // Cut on a word boundary and end with a plain "..." (the single "…" glyph
  // painted as a stray "." in the thumbnail font, so it read as a full stop).
  const cut = clean.slice(0, DESCRIPTION_MAX_CHARS - 3);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace >= DESCRIPTION_MAX_CHARS * 0.5 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,.;:،؛\-]+$/, "") + "...";
}

function formatQuestionTypes(qt) {
  if (!qt) return null;
  if (Array.isArray(qt)) return qt.length ? qt.join(" · ") : null;
  return String(qt) || null;
}


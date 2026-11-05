// =============================================================================
// api/_og/course.js
// Course / folder thumbnail  —  /api/og?course=<id>[&folder=A/B]
// =============================================================================
import { BRAND_BLUE, FONT_FAMILY_STACK, ICONS, ICON_CARD, SUPABASE_ANON_KEY, SUPABASE_URL, arabicCount, detectArabic, loadFont, renderBidiSlugSegment, renderBidiText, renderPng, svgIcon, textRun, truncateTitle, txt } from "./common.js";

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
 * "Featured" (مادة مميزة) courses, the التعليم row is omitted entirely
 * rather than shown as "التعليم: مادة مميزة" — "Featured" isn't a real
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
      label: "التعليم",
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

const COURSE_TITLE_MAX_CHARS_ARABIC = 22;

const COURSE_TITLE_MAX_CHARS_LATIN = 36;

// Right-hand content column — starts just past the icon card, runs the
// full remaining height of the canvas (not just a short top band) so the
// larger text sizes below have room to breathe and the link line can sit
// pinned to the bottom instead of immediately under the info rows.
const COURSE_CONTENT = { left: 470, right: 1152, top: 56, bottom: 630 - 40 };

// Info-table column widths — FIXED pixels, not percentages. The table
// itself always renders at the full content-column width (see
// `contentWidth` below, used as the table's `width: "100%"`), so its
// total pixel width is already a known constant; deriving the two column
// widths from that constant up front (once) means every row gets the
// exact same column boundary. This replaces an earlier version that used
// percentage flex-basis ("1 1 54%" / "0 0 46%") directly on each row's
// columns — percentages recompute per row, and Satori's layout doesn't
// always resolve that computation to an identical pixel figure for rows
// with very different content lengths ("2" vs "Computer Science"),
// which is what produced the misaligned-column bug (values/keys not
// sitting on a shared x-position row to row). Split kept at the same
// 54/46 ratio as before for visual continuity.
const INFO_TABLE_WIDTH = COURSE_CONTENT.right - COURSE_CONTENT.left; // 682

const INFO_TABLE_VALUE_COL_WIDTH = Math.round(INFO_TABLE_WIDTH * 0.54);

const INFO_TABLE_KEY_COL_WIDTH = INFO_TABLE_WIDTH - INFO_TABLE_VALUE_COL_WIDTH;

export async function renderCourseImage(courseId, folderPath) {
  const [fontData, meta] = await Promise.all([
    loadFont().catch((err) => {
      console.error("[og] course font load error:", err);
      return null;
    }),
    fetchCourseMeta(courseId, folderPath),
  ]);

  const isFolder = !!(meta && meta.isFolder);

  // Whether the (course-level) educationType is "Featured" — drives the
  // "مادة مميزة" badge next to the kind label below. Always the COURSE's
  // own field (see fetchCourseMeta's comment: a folder has no
  // education_type of its own), same source buildCourseInfoRowsFromRow()
  // already reads to decide whether to omit the التعليم row.
  const isFeatured = !!(meta && meta.educationType === "Featured");

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
  // info rows so it's unambiguous which course "التعليم"/"الكلية"/etc.
  // belong to (they're the course's, not the folder's).
  const parentCourseLine =
    isFolder && meta && meta.courseName ? meta.courseName : null;

  // Counts go in the TABLE (the most important info), course-info
  // (education / college / year / term + Featured badge) goes UNDER it as
  // chips. Labels are always Arabic, same as the old info table.
  const countsRows = meta
    ? [
        { label: "المجلدات", val: String(meta.folderCount ?? 0), dim: !meta.folderCount },
        { label: "الامتحانات", val: String(meta.quizCount ?? 0), dim: !meta.quizCount },
        { label: "الدروس", val: String(meta.arabicCount ?? 0), dim: !meta.arabicCount },
        { label: "الدفاتر", val: String(meta.notebookCount ?? 0), dim: !meta.notebookCount },
      ]
    : [];
  const infoChips = [
    ...(!isFolder && isFeatured ? [{ featured: true }] : []),
    ...infoRows,
  ];


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

  // Chips under the table — one pill per course-info field, or the amber
  // "مادة مميزة" badge for Featured courses. RTL: label on the right.
  function buildInfoChips(chips) {
    const pill = (children, extra = {}) => ({
      type: "div",
      props: {
        style: {
          display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "8px",
          borderRadius: "10px", padding: "6px 13px", direction: "ltr",
          background: "rgba(0,136,204,0.10)", border: "1px solid rgba(0,136,204,0.25)",
          ...extra,
        },
        children,
      },
    });
    return {
      type: "div",
      props: {
        style: {
          display: "flex", flexDirection: "row-reverse", flexWrap: "wrap",
          justifyContent: "flex-start", gap: "8px", width: "100%", marginTop: "22px",
        },
        children: chips.map((c) =>
          c.featured
            ? pill(
                [textRun(EDU_TYPE_AR.Featured, true, { fontSize: "20px", fontWeight: "700", color: "#b45309" })],
                { background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)" },
              )
            : pill([
                textRun(c.label, true, { fontSize: "19px", color: "#6b7280", fontWeight: "400" }),
                textRun(String(c.val), !!detectArabic(String(c.val)), { fontSize: "19px", color: BRAND_BLUE, fontWeight: "700" }),
              ]),
        ),
      },
    };
  }

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
              // Value column — always the LEFT side, always LTR-aligned,
              // even for an Arabic value — this is the "even if they are
              // Arabic, tables look better this way" rule from the brief.
              //
              // NOTE: Satori lays out flex children strictly by their
              // ARRAY order — it does NOT honor the CSS `order` property
              // for positioning (confirmed by direct rendering: a `div`
              // listed first in `children` always paints leftmost in an
              // LTR row, regardless of its own `order` value). The
              // previous version of this table relied on `order: 1` /
              // `order: 2` to place the value on the left and the key on
              // the right while still listing the key div FIRST in the
              // array — since Satori ignores `order`, that always painted
              // the key on the left and the value on the right, exactly
              // backwards from spec. The fix is to put the columns in
              // the array in their actual final left-to-right paint
              // order — value first (left), key second (right) — with no
              // `order` property at all.
              //
              // NOTE on column widths: these were originally percentage
              // flex-basis ("1 1 54%" / "0 0 46%"). Percentages resolve
              // against each row's own computed width, and because Satori
              // (unlike a browser) doesn't always re-settle every row to
              // an IDENTICAL final pixel width in a flex column, two rows
              // with very different content lengths ("2" vs "Computer
              // Science") could each compute a very slightly different
              // 54%-of-row pixel value — which shows up as the value
              // column's left edge (and therefore the text start
              // position) drifting a few px row to row, i.e. the
              // "right column isn't aligned" bug. Fixed PIXEL widths
              // (derived from the table's own known, constant rendered
              // width — see INFO_TABLE_WIDTH below) give every row the
              // exact same column boundary regardless of content, since
              // there's no per-row percentage math left to disagree.
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flex: `0 0 ${INFO_TABLE_VALUE_COL_WIDTH}px`,
                    width: `${INFO_TABLE_VALUE_COL_WIDTH}px`,
                    justifyContent: "flex-start",
                    alignItems: "center",
                    padding: "12px 22px",
                    color: row.dim ? "#9ca3af" : "#111827",
                    fontWeight: "700",
                    fontSize: "24px",
                    borderRight: "1px solid rgba(15,23,42,0.08)",
                    direction: "ltr",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                  },
                  children: txt(row.val),
                },
              },
              // Key column — always the RIGHT side, always RTL-reading
              // text, regardless of the value's script. Rendered as a
              // single pre-mirrored string in a plain LTR div — the SAME
              // pattern already confirmed working elsewhere in this file
              // for a leaf holding Arabic prose (the quiz-thumbnail
              // course pill: `children: renderBidiText(courseName, ...)`
              // inside a plain `direction: ltr` div). Two earlier
              // attempts both failed against real screenshots: (1) the
              // raw untouched string with `direction: rtl` on the
              // container — Satori doesn't run the bidi algorithm, so
              // this never reorders words, it only adds inter-word
              // spacing; (2) sibling divs with `flexDirection:
              // row-reverse` — that flips the WRONG thing (row-reverse
              // mirrors which array item paints rightmost, but the
              // tokens were still in original storage order, so it just
              // moved the ordering problem instead of fixing it).
              // Pre-reversing the token order with renderBidiText() and
              // then painting the joined result as one plain-LTR string
              // sidesteps both failure modes: by the time Satori sees
              // it, the text is already in final left-to-right paint
              // order, so there's no per-run RTL spacing applied and no
              // word order left to get backwards.
              // NOTE on `whiteSpace`/`textAlign` here: fixed-pixel column
              // widths (above) fixed the column BOUNDARY drifting row to
              // row, but the visible right edges of "التعليم"/"العام"/
              // "الترم" were still landing at different x-positions within
              // an otherwise identically-sized, `justifyContent: flex-end`
              // box. `justifyContent` positions the text's flex-item
              // *box*, but without an explicit `textAlign` Satori doesn't
              // reliably right-align the glyph run's own contents inside
              // that box for every string (confirmed by direct
              // rendering — short single-word Arabic labels of different
              // lengths each drifted independently). The title element
              // above already pairs `justifyContent: flex-end` with
              // `textAlign: "right"` (+ `whiteSpace: nowrap` so the box
              // never wraps and quietly narrows) for exactly this reason;
              // this column needed the same pairing.
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flex: `0 0 ${INFO_TABLE_KEY_COL_WIDTH}px`,
                    width: `${INFO_TABLE_KEY_COL_WIDTH}px`,
                    justifyContent: "flex-end",
                    alignItems: "center",
                    padding: "12px 22px",
                    color: "#6b7280",
                    fontWeight: "400",
                    fontSize: "24px",
                    direction: "ltr",
                    whiteSpace: "nowrap",
                    textAlign: "right",
                  },
                  children: renderBidiText(row.label, detectArabic(row.label)),
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
                  children: svgIcon(isFolder ? ICONS.folder : ICONS.cap, 190, BRAND_BLUE, 1.4),
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
                    // Kind label row — COURSE / FOLDER, plus the
                    // "مادة مميزة" (Featured) badge when applicable.
                    // Rendered as a row (not a single text node) so the
                    // badge can sit beside the label without going
                    // through renderBidiText/renderBidiChildren — flex
                    // row-reverse handles the RTL ordering here since
                    // these are two independent sibling elements, not
                    // tokens of one string.
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          flexDirection: isArabic ? "row-reverse" : "row",
                          alignItems: "center",
                          gap: "10px",
                          direction: "ltr",
                        },
                        children: [
                          // Kind label — COURSE / FOLDER
                          //
                          // letterSpacing is intentionally omitted for
                          // the Arabic labels ("مجلد" / "مقرر دراسي") —
                          // Satori applies letter-spacing between EVERY
                          // glyph, including within a single Arabic
                          // word, which reads as words/letters being
                          // oddly far apart (confirmed by direct
                          // rendering). It's kept only for the English
                          // "COURSE" label, where 1px tracking on Latin
                          // caps is an intentional, legible style choice.
                          {
                            type: "div",
                            props: {
                              style: {
                                display: "flex",
                                fontSize: "24px",
                                color: BRAND_BLUE,
                                fontWeight: "700",
                                ...(isFolder || isArabic ? {} : { letterSpacing: "1px" }),
                                direction: "ltr",
                              },
                              children: txt(isFolder
                                ? "مجلد"
                                : isArabic ? "مقرر دراسي" : "COURSE"),
                            },
                          },
                        ],
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
                              props: { style: { display: "flex" }, children: txt("في") },
                            },
                            {
                              type: "div",
                              props: {
                                style: { display: "flex", fontWeight: "700", color: "#374151" },
                                // Pre-mirrored with renderBidiText — this leaf
                                // was previously the one place in the file
                                // rendering a raw, un-mirrored Arabic string
                                // (every other Arabic text leaf, e.g. the
                                // title at renderBidiText(title, isArabic)
                                // and the quiz thumbnail's courseName pill,
                                // already goes through this). Satori doesn't
                                // run the Unicode bidi algorithm, so a
                                // multi-word Arabic course name painted here
                                // unmirrored (e.g. "اللغة العربية") came out
                                // in raw storage order — reversed relative to
                                // correct visual order ("العربية اللغة").
                                // The parent div's own `direction: "ltr"`
                                // (see the row wrapper above) is exactly the
                                // "container holding pre-mirrored text must
                                // be ltr" case from renderBidiText's doc
                                // comment, so no other change is needed here.
                                children: renderBidiText(
                                  parentCourseLine,
                                  detectArabic(parentCourseLine),
                                ),
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
                          // Satori does not run the Unicode Bidi Algorithm
                          // (see renderBidiText's doc comment) — it always
                          // paints a text node's words in raw storage
                          // order, and `direction: "rtl"` on that node
                          // does NOT reorder words for it; it only adds
                          // extra inter-word spacing to an Arabic run.
                          // That combination — untouched word order +
                          // `direction: rtl` — is exactly what produced
                          // this element's own bug (multi-word titles
                          // like "الذكاء الإصطناعي" painting reversed
                          // AND with oversized gaps). The fix is the same
                          // one used elsewhere in this file for a single
                          // leaf holding Arabic prose (e.g. the courseName
                          // line): pre-reverse word order with
                          // renderBidiText(), then paint as a plain LTR
                          // string so Satori doesn't re-space it.
                          direction: "ltr",
                          width: "100%",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          justifyContent: "flex-end",
                          textAlign: "right",
                        },
                        children: renderBidiText(title, isArabic),
                      },
                    },

                    // Counts TABLE — folders / quizzes / lessons / notebooks.
                    countsRows.length > 0
                      ? {
                        type: "div",
                        props: {
                          style: { display: "flex", flexDirection: "column", width: "100%", marginTop: "24px" },
                          children: [buildInfoTable(countsRows)],
                        },
                      }
                      : null,

                    // Course-info chips + Featured badge, UNDER the table.
                    infoChips.length > 0 ? buildInfoChips(infoChips) : null,
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
            children: txt(linkPath),
          },
        },
      ],
    },
  };

  const renderIsComplete = fontData !== null && meta !== null;

  return renderPng(element, fontData, { complete: renderIsComplete, fallback: "/assets/images/thumbnails/thumbnail.png" });
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
    //
    // Run alongside the extra-stats fetch below (Promise.all), not before
    // it — the extra-stats query only depends on targetFolderId/courseId
    // (already resolved above), not on these counts, so there was no real
    // reason for it to wait on this step finishing first. That was an
    // unforced sequential round-trip; folding it into the same parallel
    // batch removes one full network hop from every course/folder request.
    const countsPromise = targetFolderId
      ? Promise.all([
        countFor("folders", "parent_folder_id"),
        countFor("quizzes", "folder_id"),
        countFor("lesson_public", "folder_id"),
        countFor("notebooks", "folder_id"),
      ])
      : Promise.all([
        countFor("folders", "course_id"),
        countFor("quizzes", "course_id"),
        countFor("lesson_public", "course_id"),
        countFor("notebooks", "course_id"),
      ]);

    // Best-effort extra stats (question count total, last-updated date) —
    // not fatal if this sub-fetch fails. Kicked off in parallel with the
    // counts above (see countsPromise's comment) rather than awaited after.
    const extraStatsPromise = (async () => {
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
      return { questionCount, lastUpdated };
    })();

    const [[folderCount, quizCount, arabicCount, notebookCount], { questionCount, lastUpdated }] =
      await Promise.all([countsPromise, extraStatsPromise]);

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
      // course-info-fields.js exactly (التعليم/الكلية/العام/الترم),
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
      arabicCount,
      notebookCount,
      questionCount,
      lastUpdated,
    };
  } catch (err) {
    console.error("[og] fetchCourseMeta error:", err);
    return null;
  }
}

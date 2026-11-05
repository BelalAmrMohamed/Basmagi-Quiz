// =============================================================================
// api/_og/lesson.js
// Lesson thumbnail  —  /api/og?lesson=<id|slug>
// =============================================================================
import { BRAND_BLUE, FONT_FAMILY_STACK, ICONS, ICON_CARD, TEAL, UUID_RE, arabicCount, clampText, detectArabic, loadFont, renderPng, sbGetOne, svgIcon, textRun } from "./common.js";
import { accentStripe, backSheet, chipsRow, crumbRow, descBlock, footerLink, footerPath, layoutDescription, layoutTitle, rightColumn, titleBlock } from "./blocks.js";

// =============================================================================
// Lesson OG image — /api/og?lesson=<id|slug>&v=<n>
// =============================================================================
// Third generator merged into this file (quiz + course + lesson) so the
// project stays inside Vercel Hobby's 12-function cap — no new api/*.js file.
//
// Design: a "reading page" — a tilted paper card on the left previews the
// lesson's real table of contents (first visible section titles, numbered),
// backed by a second sheet for depth. The right column (fixed RTL, same as
// the course image) shows the kind label, the course › folder breadcrumb,
// a up-to-two-line title, a two-line description/excerpt, and a row of stat
// chips (reading time / sections / questions or media). Everything is drawn
// with Satori shapes + inline SVG icons — no emoji, so there are no extra
// Twemoji network round-trips.
//
// Privacy: a password-protected lesson's `content` is NULL in lesson_public,
// so the card falls back to skeleton lines + a lock badge and never leaks
// section titles, excerpts or counts.
//
// Bidi: see textRun — pure-Arabic runs use renderBidiText(), mixed
// Arabic+digit/Latin runs use sibling tokens (renderBidiChildren pattern).
// Consecutive Latin tokens are merged into one run so "Machine Learning"
// inside an Arabic title keeps its order.
// =============================================================================

export const LESSON_ACCENT = TEAL; // teal — lesson identity colour next to BRAND_BLUE

const LESSON_COLUMN = { left: 470, right: 1130 };

const LESSON_COLUMN_WIDTH = LESSON_COLUMN.right - LESSON_COLUMN.left; // 660

const LESSON_THEME = {
  crumbIcon: "#9ca3af", crumbMuted: "#6b7280", crumbLast: "#374151", crumbSlash: "#cbd5e1",
  title: "#111827", desc: "#4b5563", accent: TEAL,
  chipBg: "#ffffff", chipText: "#1f2937", chipBorderAlpha: "33", chipShadow: "0 6px 18px rgba(15,23,42,0.06)",
};
const LESSON_WORDS_PER_MINUTE = 180; // conservative — Arabic reads slower than English

/** Plain-text excerpt from the first visible markdown block (OG-safe). */
function lessonExcerpt(sections) {
  for (const s of sections) {
    const b = (s.blocks || []).find((x) => x && x.type === "markdown" && typeof x.body === "string" && x.body.trim());
    if (!b) continue;
    const plain = b.body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\$\$[\s\S]*?\$\$/g, " ")
      .replace(/\$[^$\n]*\$/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/^[#>\-*+\s\d.]+/gm, " ")
      .replace(/[*_`~|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain) return plain;
  }
  return "";
}

/** Derives display stats from the (already visible-only) sections. */
function lessonStats(sections) {
  let words = 0, questions = 0, media = 0, quizzes = 0;
  for (const s of sections) {
    for (const b of s.blocks || []) {
      if (!b) continue;
      if (b.type === "markdown" && typeof b.body === "string") {
        const plain = b.body.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~|\[\]()$\\-]/g, " ");
        words += plain.split(/\s+/).filter(Boolean).length;
      } else if (b.type === "question") questions++;
      else if (b.type === "media") media++;
      else if (b.type === "quizRef") quizzes++;
    }
  }
  const questionTotal = questions + quizzes;
  return {
    minutes: Math.max(1, Math.ceil(words / LESSON_WORDS_PER_MINUTE)),
    sectionCount: sections.length,
    questions: questionTotal,
    media,
  };
}

async function fetchLessonOgMeta(idOrSlug) {

  try {
    const isUuid = UUID_RE.test(idOrSlug);
    const lesson = await sbGetOne("lesson_public", {
      select: "id,slug,title,description,source,course_id,folder_id,content,password_protected,updated_at",
      [isUuid ? "id" : "slug"]: `eq.${idOrSlug}`,
      limit: "1",
    });
    if (!lesson) return null;

    const [course, folder] = await Promise.all([
      lesson.course_id ? sbGetOne("courses", { select: "name", id: `eq.${lesson.course_id}`, limit: "1" }) : null,
      lesson.folder_id ? sbGetOne("folders", { select: "name", id: `eq.${lesson.folder_id}`, limit: "1" }) : null,
    ]);

    const protectedLesson = Boolean(lesson.password_protected);
    let sections = [];
    if (!protectedLesson) {
      const c = lesson.content;
      if (typeof c === "string") sections = [{ title: "", blocks: [{ type: "markdown", body: c }] }];
      else if (c && Array.isArray(c.sections)) sections = c.sections.filter((s) => s && !s.defaultHidden);
      else if (c && typeof c.body === "string") sections = [{ title: "", blocks: [{ type: "markdown", body: c.body }] }];
    }

    return {
      id: lesson.id,
      slug: lesson.slug || null,
      title: lesson.title || "",
      description: (lesson.description || "").trim(),
      protectedLesson,
      courseName: course?.name || null,
      folderName: folder?.name || null,
      sectionTitles: sections.map((s) => String(s.title || "").trim()).filter(Boolean),
      stats: protectedLesson ? null : lessonStats(sections),
      excerpt: protectedLesson ? "" : lessonExcerpt(sections),
    };
  } catch (err) {
    console.error("[og] fetchLessonOgMeta error:", err);
    return null;
  }
}

export async function renderLessonImage(lessonId) {
  const [fontData, meta] = await Promise.all([
    loadFont().catch((err) => { console.error("[og] lesson font load error:", err); return null; }),
    fetchLessonOgMeta(lessonId),
  ]);

  const rawTitle = meta?.title || "درس على منصة بصمجي";
  const title = layoutTitle(rawTitle, LESSON_COLUMN_WIDTH);
  // Description: stored description, else first-paragraph excerpt.
  const desc = layoutDescription(meta ? (meta.description || meta.excerpt) : "", LESSON_COLUMN_WIDTH, title.lines.length);

  // ── Stat chips (max 3) ───────────────────────────────────────────────
  const chips = [];
  if (meta?.stats) {
    const st = meta.stats;
    chips.push({
      icon: "clock", color: BRAND_BLUE,
      tokens: arabicCount(st.minutes, { one: ["دقيقة", "واحدة"], two: "دقيقتان", few: "دقائق", many: "دقيقة" }),
    });
    if (st.sectionCount > 0) {
      chips.push({
        icon: "layers", color: LESSON_ACCENT,
        tokens: arabicCount(st.sectionCount, { one: ["قسم", "واحد"], two: "قسمان", few: "أقسام", many: "قسم" }),
      });
    }
    if (st.questions > 0) {
      chips.push({
        icon: "help", color: "#7c3aed",
        tokens: arabicCount(st.questions, { one: ["سؤال", "واحد"], two: "سؤالان", few: "أسئلة", many: "سؤال" }),
      });
    } else if (st.media > 0) {
      chips.push({
        icon: "image", color: "#d97706",
        tokens: arabicCount(st.media, { one: ["وسيط", "واحد"], two: "وسيطان", few: "وسائط", many: "وسيط" }),
      });
    }
  }

  const linkPath = footerPath("lesson", meta ? (meta.slug || meta.id) : "");

  // ── Left "reading page" card ─────────────────────────────────────────
  const tocTitles = meta?.sectionTitles || [];
  const MAX_TOC = 5;
  const shownToc = tocTitles.slice(0, MAX_TOC);
  const extraToc = Math.max(0, tocTitles.length - shownToc.length);

  const skeletonBar = (w, o = 1) => ({
    type: "div",
    props: {
      style: {
        display: "flex", height: "12px", width: w, borderRadius: "6px",
        background: `rgba(15,23,42,${0.09 * o})`,
      },
    },
  });

  const tocRow = (title, i) => {
    const ar = !!detectArabic(title);
    return {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", gap: "12px" },
        children: [
          // Title (left) — number badge (right), RTL reading order.
          {
            type: "div",
            props: {
              style: { display: "flex", flex: "1", justifyContent: "flex-end", overflow: "hidden" },
              children: textRun(clampText(title, ar ? 21 : 24), ar, {
                fontSize: "21px", fontWeight: "700", color: "#1f2937",
              }),
            },
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "34px", height: "34px", borderRadius: "17px", flexShrink: 0,
                background: i === 0 ? LESSON_ACCENT : "rgba(13,148,136,0.12)",
                color: i === 0 ? "#ffffff" : LESSON_ACCENT,
                fontSize: "18px", fontWeight: "700", direction: "ltr",
              },
              children: String(i + 1),
            },
          },
        ],
      },
    };
  };

  const cardBody =
    shownToc.length > 0
      ? [
        ...shownToc.map(tocRow),
        extraToc > 0
          ? {
            type: "div",
            props: {
              style: { display: "flex", justifyContent: "flex-end", width: "100%", marginTop: "4px" },
              children: textRun(`+ ${extraToc} ${extraToc <= 10 ? "أقسام" : "قسم"} أخرى`, true, {
                fontSize: "19px", color: "#9ca3af", fontWeight: "700",
              }),
            },
          }
          : null,
        ...(shownToc.length < 4
          ? [
            { type: "div", props: { style: { display: "flex", height: "8px" } } },
            skeletonBar("96%", 0.8), skeletonBar("80%"), skeletonBar("90%", 0.8), skeletonBar("58%"),
          ]
          : []),
      ].filter(Boolean)
      : // No titled sections (or protected) — skeleton "text lines" page.
      [
        ...(meta?.protectedLesson
          ? [{
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "10px 0 6px" },
              children: [{
                type: "div",
                props: {
                  style: {
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: "92px", height: "92px", borderRadius: "46px",
                    background: "rgba(217,119,6,0.12)", border: "2px solid rgba(217,119,6,0.35)",
                  },
                  children: svgIcon(ICONS.lock, 46, "#b45309", 2),
                },
              }],
            },
          }]
          : []),
        skeletonBar("100%"), skeletonBar("86%", 0.8), skeletonBar("94%"), skeletonBar("62%", 0.8),
        { type: "div", props: { style: { display: "flex", height: "10px" } } },
        skeletonBar("98%"), skeletonBar("78%", 0.8), skeletonBar("90%"),
      ];

  const pageCard = {
    type: "div",
    props: {
      style: {
        display: "flex", flexDirection: "column", position: "absolute",
        left: `${ICON_CARD.left + 6}px`, top: `${ICON_CARD.top + 6}px`,
        width: `${ICON_CARD.width}px`, height: `${ICON_CARD.height}px`,
        borderRadius: "30px", backgroundColor: "#ffffff", overflow: "hidden",
        boxShadow: "0 30px 60px rgba(15,23,42,0.14)",
        border: "1px solid rgba(15,23,42,0.06)",
        transform: `rotate(${ICON_CARD.rotationDeg}deg)`,
      },
      children: [
        // Header strip — brand gradient with the book icon + label.
        {
          type: "div",
          props: {
            style: {
              display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "12px",
              padding: "20px 24px", height: "78px",
              backgroundImage: `linear-gradient(135deg, ${BRAND_BLUE} 0%, ${LESSON_ACCENT} 100%)`,
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", justifyContent: "center", width: "46px", height: "46px", borderRadius: "23px", flexShrink: 0, background: "rgba(255,255,255,0.22)" },
                  children: {
                    type: "div",
                    props: {
                      style: { display: "flex", flexDirection: "row", width: "22px", height: "28px", borderRadius: "4px", background: "#ffffff", overflow: "hidden" },
                      children: [{ type: "div", props: { style: { display: "flex", width: "5px", height: "28px", background: "rgba(13,148,136,0.45)" } } }],
                    },
                  },
                },
              },
              textRun(shownToc.length > 0 ? "محتوى الدرس" : "صفحة الدرس", true, {
                fontSize: "28px", fontWeight: "700", color: "#ffffff",
              }),
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", gap: "17px", padding: "26px 26px 0", width: "100%" },
            children: cardBody,
          },
        },
      ],
    },
  };

  const sheet = backSheet(ICON_CARD, "rgba(0,136,204,0.10)", "rgba(0,136,204,0.18)");

  // ── Right column ─────────────────────────────────────────────────────
  const kindRow = {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "12px" },
      children: [
        textRun("درس", true, { fontSize: "26px", color: BRAND_BLUE, fontWeight: "700" }),
        meta?.protectedLesson
          ? {
            type: "div",
            props: {
              style: {
                display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "8px",
                background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)",
                borderRadius: "8px", padding: "4px 12px",
              },
              children: [
                svgIcon(ICONS.lock, 16, "#b45309", 2.4),
                textRun("محمي بكلمة مرور", true, { fontSize: "16px", color: "#b45309", fontWeight: "700" }),
              ],
            },
          }
          : null,
      ].filter(Boolean),
    },
  };

  const T = LESSON_THEME;
  const crumb = crumbRow([meta?.courseName, meta?.folderName], T);
  const titleEl = titleBlock(title, T, !!crumb);
  const descEl = descBlock(desc, T);
  const chipsEl = chipsRow(chips, T);

  const element = {
    type: "div",
    props: {
      style: {
        display: "flex", width: "100%", height: "100%", position: "relative",
        fontFamily: FONT_FAMILY_STACK, backgroundColor: "#f8fafc",
        backgroundImage:
          "radial-gradient(circle at 0% 0%, rgba(0,136,204,0.13) 0%, rgba(0,136,204,0) 46%), radial-gradient(circle at 100% 100%, rgba(13,148,136,0.12) 0%, rgba(13,148,136,0) 42%)",
      },
      children: [
        accentStripe(BRAND_BLUE, LESSON_ACCENT),
        sheet,
        pageCard,
        rightColumn([kindRow, crumb, titleEl, descEl, chipsEl], LESSON_COLUMN),
        footerLink(linkPath, "#9ca3af"),
      ],
    },
  };

  const renderIsComplete = fontData !== null && meta !== null;

  return renderPng(element, fontData, { complete: renderIsComplete, fallback: "/assets/images/thumbnails/lesson-thumbnail.jpg" });
}

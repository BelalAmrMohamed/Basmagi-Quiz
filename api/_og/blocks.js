// =============================================================================
// api/_og/blocks.js
// Layout building blocks shared by the "card" thumbnails (lesson, notebook):
// breadcrumb, title, description, chips, back sheet, stripe, footer link and
// the right-hand column wrapper. Each takes a small THEME object so the light
// lesson card and the dark notebook card share one implementation.
//
// theme = {
//   crumbIcon, crumbMuted, crumbLast, crumbSlash,   // breadcrumb colours
//   title, desc,                                     // text colours
//   accent,                                          // description bar colour
//   chipBg, chipText, chipBorderAlpha, chipShadow,   // chip look
//   footer,                                          // footer link colour
// }
// =============================================================================

import { hasArabic } from "../_arabicShape.js";
import { ICONS, clampText, detectArabic, renderBidiSlugSegment, shapedRun, svgIcon, textRun, txt, wrapText } from "./common.js";

/** Title wrapped to ≤2 lines with a font tier by length. */
export function layoutTitle(rawTitle, columnWidth) {
  const isArabic = !!detectArabic(rawTitle);
  const fontSize = rawTitle.length <= 14 ? 68 : rawTitle.length <= 34 ? 56 : 46;
  const cpl = Math.floor(columnWidth / (fontSize * (isArabic ? 0.62 : 0.6)));
  return { isArabic, fontSize, lines: wrapText(rawTitle, cpl, 2) };
}

/** Description wrapped to 2–3 lines (fewer when the title already wraps). */
export function layoutDescription(raw, columnWidth, titleLineCount) {
  const fontSize = 26;
  const isArabic = !!detectArabic(raw || "ا");
  const lines = raw
    ? wrapText(raw, Math.floor(columnWidth / (fontSize * (isArabic ? 0.72 : 0.58))), titleLineCount > 1 ? 2 : 3)
    : [];
  return { isArabic, fontSize, lines };
}

/** "basmagi.vercel.app/<kind>/<slug>" footer text, front-truncated to one line. */
export function footerPath(kind, slugOrId) {
  const full = `basmagi.vercel.app/${kind}/${slugOrId ? renderBidiSlugSegment(slugOrId) : ""}`;
  return full.length > 90 ? "…" + full.slice(full.length - 89) : full;
}

export function crumbRow(parts, t) {
  const crumbParts = parts.filter(Boolean).map((p) => clampText(p, 20));
  if (!crumbParts.length) return null;
  return {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "10px", marginTop: "14px" },
      children: [
        { type: "div", props: { style: { display: "flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", flexShrink: 0 }, children: svgIcon(ICONS.folder, 24, t.crumbIcon, 2) } },
        ...crumbParts.flatMap((p, i) => [
          i > 0 ? { type: "div", props: { style: { display: "flex", fontSize: "24px", color: t.crumbSlash }, children: "/" } } : null,
          textRun(p, !!detectArabic(p), { fontSize: "24px", color: i === crumbParts.length - 1 ? t.crumbLast : t.crumbMuted, fontWeight: "700" }),
        ]).filter(Boolean),
      ],
    },
  };
}

export function titleBlock(title, t, hasCrumb) {
  return {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: hasCrumb ? "18px" : "22px", width: "100%" },
      children: title.lines.map((line) =>
        textRun(line, title.isArabic, { fontSize: `${title.fontSize}px`, fontWeight: "700", color: t.title, lineHeight: "1.25", width: "100%" }),
      ),
    },
  };
}

export function descBlock(desc, t) {
  if (!desc.lines.length) return null;
  return {
    type: "div",
    props: {
      style: {
        display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: "20px", width: "100%",
        paddingRight: "18px", borderRight: `4px solid ${t.accent}`, gap: "2px",
      },
      children: desc.lines.map((line) =>
        textRun(line, desc.isArabic, { fontSize: `${desc.fontSize}px`, color: t.desc, fontWeight: "400", lineHeight: "1.4", width: "100%" }),
      ),
    },
  };
}

/** chips: [{ icon: key of ICONS, color, tokens: string[] }] */
export function chipsRow(chips, t) {
  if (!chips.length) return null;
  return {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "14px", marginTop: "30px" },
      children: chips.map((c) => ({
        type: "div",
        props: {
          style: {
            display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "10px",
            backgroundColor: t.chipBg, border: `1.5px solid ${c.color}${t.chipBorderAlpha}`, borderRadius: "14px",
            padding: "11px 20px", ...(t.chipShadow ? { boxShadow: t.chipShadow } : {}),
          },
          children: [
            svgIcon(ICONS[c.icon], 28, c.color, 2.2),
            {
              type: "div",
              props: {
                style: { display: "flex", flexDirection: "row-reverse", gap: "8px", fontSize: "26px", fontWeight: "700", color: t.chipText, direction: "ltr", whiteSpace: "nowrap" },
                children: hasArabic(c.tokens.join(" "))
                  ? [shapedRun(c.tokens.join(" "))]
                  : c.tokens.map((tok) => ({ type: "div", props: { style: { display: "flex" }, children: tok } })),
              },
            },
          ],
        },
      })),
    },
  };
}

/** Sheet peeking out behind the tilted card. */
export function backSheet(card, bg, border) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex", position: "absolute",
        left: `${card.left - 8}px`, top: `${card.top + 4}px`, width: `${card.width}px`, height: `${card.height}px`,
        borderRadius: "30px", backgroundColor: bg, border: `1px solid ${border}`,
        transform: `rotate(${card.rotationDeg + 7}deg)`,
      },
    },
  };
}

/** 14px right-edge identity stripe. */
export function accentStripe(from, to) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex", position: "absolute", right: "0px", top: "0px", width: "14px", height: "630px",
        backgroundImage: `linear-gradient(180deg, ${from} 0%, ${to} 100%)`,
      },
    },
  };
}

/** Right-hand text column (fixed RTL side, vertically centred). */
export function rightColumn(children, column) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", position: "absolute",
        left: `${column.left}px`, top: "0px", height: "570px", width: `${column.right - column.left}px`,
        direction: "ltr", textAlign: "right",
      },
      children: children.filter(Boolean),
    },
  };
}

export function footerLink(linkPath, color) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex", position: "absolute", left: "40px", right: "54px", bottom: "36px",
        justifyContent: "center", fontSize: "20px", color, fontWeight: "400",
        whiteSpace: "nowrap", overflow: "hidden", direction: "ltr",
      },
      children: txt(linkPath),
    },
  };
}

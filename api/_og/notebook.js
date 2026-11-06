// =============================================================================
// api/_og/notebook.js
// Notebook thumbnail  —  /api/og?notebook=<id|slug>
// =============================================================================
import { BRAND_BLUE, FONT_FAMILY_STACK, ICON_CARD, UUID_RE, arabicCount, loadFont, renderPng, sbGetOne, textRun } from "./common.js";
import { accentStripe, backSheet, chipsRow, crumbRow, descBlock, footerLink, footerPath, layoutDescription, layoutTitle, rightColumn, titleBlock } from "./blocks.js";

// =============================================================================
// Notebook OG image  —  /api/og?notebook=<id|slug>&v=<n>
// =============================================================================
// Fifth generator in this file (quiz + course/folder + lesson + profile +
// notebook) so the project stays inside Vercel Hobby's 12-function cap.
//
// Deliberately NOT like the light course/lesson/quiz cards: a DARK "code
// editor" look. A tilted editor window on the left shows the notebook's REAL
// first code cell (syntax-coloured, Arabic-free lines only) plus a decorative
// plot panel; the right column shows kind + runtime badge, course › folder
// breadcrumb, title, description and chips (cells / code cells / runs in
// browser). Privacy: only published `notebook_public` data is read.
// =============================================================================

const NB_ACCENT = "#8b5cf6"; // violet — notebook identity colour

const NB_BG = "#0b1220";

const NB_COLUMN = { left: 470, right: 1130 };

const NB_COLUMN_WIDTH = NB_COLUMN.right - NB_COLUMN.left;

const NB_THEME = {
  crumbIcon: "#64748b", crumbMuted: "#94a3b8", crumbLast: "#cbd5e1", crumbSlash: "#475569",
  title: "#ffffff", desc: "#cbd5e1", accent: NB_ACCENT,
  chipBg: "rgba(255,255,255,0.06)", chipText: "#f1f5f9", chipBorderAlpha: "55", chipShadow: null,
};
const NB_RUNTIME_LABEL = { matlab: "MATLAB", cpp: "C++" };

const NB_FILE_LABEL = { matlab: "script.m", cpp: "main.cpp" };

const NB_KEYWORDS = new Set([
  "for", "end", "if", "else", "elseif", "while", "function", "return", "break",
  "continue", "switch", "case", "otherwise", "try", "catch",
]);


/** Splits one code line into coloured tokens (MATLAB-flavoured, good enough for a thumbnail). */
function nbTokenizeCode(line) {
  const out = [];
  const re = /(%.*$)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_]\w*)|(\s+)|(.)/gi;
  let m;
  while ((m = re.exec(line)) !== null) {
    const [tok, comment, str, num, word, space] = m;
    let color = "#e2e8f0";
    if (comment) color = "#64748b";
    else if (str) color = "#fbbf24";
    else if (num) color = "#60a5fa";
    else if (word && NB_KEYWORDS.has(word)) color = "#c084fc";
    else if (word && line.slice(m.index + tok.length).startsWith("(")) color = "#34d399";
    out.push({ text: tok, color, space: !!space });
  }
  return out;
}

async function fetchNotebookOgMeta(idOrSlug) {
  try {
    const isUuid = UUID_RE.test(idOrSlug);
    const nb = await sbGetOne("notebook_public", {
      select: "id,slug,title,description,runtime,course_id,folder_id,content,updated_at",
      [isUuid ? "id" : "slug"]: `eq.${idOrSlug}`,
      limit: "1",
    });
    if (!nb) return null;
    const [course, folder] = await Promise.all([
      nb.course_id ? sbGetOne("courses", { select: "name", id: `eq.${nb.course_id}`, limit: "1" }) : null,
      nb.folder_id ? sbGetOne("folders", { select: "name", id: `eq.${nb.folder_id}`, limit: "1" }) : null,
    ]);
    const cells = Array.isArray(nb.content?.cells) ? nb.content.cells : [];
    const codeCells = cells.filter((c) => c && c.type === "code");
    // First code cell with at least one Arabic-free, non-empty line → preview.
    let preview = [];
    for (const c of codeCells) {
      const lines = String(c.source || "")
        .split(/\r?\n/)
        .map((l) => l.replace(/\t/g, "  ").trimEnd())
        .filter((l) => l.trim() && !/[\u0600-\u06FF\u0750-\u077F]/.test(l));
      if (lines.length) { preview = lines.slice(0, 6); break; }
    }
    return {
      id: nb.id,
      slug: nb.slug || null,
      title: nb.title || "",
      description: (nb.description || "").trim(),
      runtime: nb.runtime || "",
      courseName: course?.name || null,
      folderName: folder?.name || null,
      cellCount: cells.length,
      codeCount: codeCells.length,
      preview,
    };
  } catch (err) {
    console.error("[og] fetchNotebookOgMeta error:", err);
    return null;
  }
}

export async function renderNotebookImage(notebookId) {
  const [fontData, meta] = await Promise.all([
    loadFont().catch((err) => { console.error("[og] notebook font load error:", err); return null; }),
    fetchNotebookOgMeta(notebookId),
  ]);

  const rawTitle = meta?.title || "دفتر تفاعلي على منصة بصمجي";
  const title = layoutTitle(rawTitle, NB_COLUMN_WIDTH);
  const desc = layoutDescription(meta?.description || "", NB_COLUMN_WIDTH, title.lines.length);

  const runtimeKey = (meta?.runtime || "matlab").toLowerCase();
  const runtimeLabel = NB_RUNTIME_LABEL[runtimeKey] || runtimeKey.toUpperCase();
  const fileLabel = NB_FILE_LABEL[runtimeKey] || "main";

  // ── Chips ────────────────────────────────────────────────────────────
  const chips = [];
  if (meta && meta.cellCount > 0) {
    chips.push({
      icon: "layers", color: "#a78bfa",
      tokens: arabicCount(meta.cellCount, { one: ["خلية", "واحدة"], two: "خليتان", few: "خلايا", many: "خلية" }),
    });
    if (meta.codeCount > 0) {
      chips.push({ icon: "code", color: "#34d399", tokens: [String(meta.codeCount), "كود"] });
    }
  }
  chips.push({ icon: "play", color: "#38bdf8", tokens: ["يعمل", "في", "المتصفح"] });

  const linkPath = footerPath("notebook", meta ? (meta.slug || meta.id) : "");

  // ── Left: tilted editor window ───────────────────────────────────────
  const CODE_MAX = 25;
  const codeLines = (meta?.preview || []).map((l) => (l.length > CODE_MAX ? l.slice(0, CODE_MAX - 1) + "…" : l));
  const skeleton = (w, o = 1) => ({
    type: "div",
    props: { style: { display: "flex", height: "12px", width: w, borderRadius: "6px", background: `rgba(148,163,184,${0.22 * o})` } },
  });
  const codeBody = codeLines.length
    ? codeLines.map((line) => ({
        type: "div",
        props: {
          style: { display: "flex", flexDirection: "row", whiteSpace: "pre", direction: "ltr", overflow: "hidden", width: "100%", fontSize: "19px", height: "28px", alignItems: "center" },
          children: nbTokenizeCode(line).map((t) => ({
            type: "div",
            props: { style: { display: "flex", color: t.color, whiteSpace: "pre" }, children: t.text.replace(/ /g, "\u00a0") },
          })),
        },
      }))
    : [skeleton("88%"), skeleton("64%", 0.8), skeleton("78%"), skeleton("52%", 0.8)];

  // Decorative sine "plot" — purely visual, never claims to be real output.
  const plotPts = Array.from({ length: 40 }, (_, i) => {
    const x = 8 + (i * 296) / 39;
    const y = 46 - Math.sin((i / 39) * Math.PI * 3) * 28;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  const dot = (c) => ({ type: "div", props: { style: { display: "flex", width: "14px", height: "14px", borderRadius: "7px", background: c } } });
  const windowCard = {
    type: "div",
    props: {
      style: {
        display: "flex", flexDirection: "column", position: "absolute",
        left: `${ICON_CARD.left + 6}px`, top: `${ICON_CARD.top + 6}px`,
        width: `${ICON_CARD.width}px`, height: `${ICON_CARD.height}px`,
        borderRadius: "26px", backgroundColor: "#111a2e", overflow: "hidden",
        boxShadow: "0 30px 70px rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.10)",
        transform: `rotate(${ICON_CARD.rotationDeg}deg)`,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              height: "54px", padding: "0 20px", background: "rgba(255,255,255,0.05)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            },
            children: [
              { type: "div", props: { style: { display: "flex", flexDirection: "row", gap: "8px" }, children: [dot("#ef4444"), dot("#f59e0b"), dot("#22c55e")] } },
              { type: "div", props: { style: { display: "flex", fontSize: "18px", color: "#94a3b8", fontWeight: "700", direction: "ltr" }, children: fileLabel } },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", padding: "20px 22px 0", gap: "14px", width: "100%" },
            children: [
              { type: "div", props: { style: { display: "flex", fontSize: "17px", color: NB_ACCENT, fontWeight: "700", direction: "ltr" }, children: "In [1]:" } },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex", flexDirection: "column", width: "100%", gap: "0px",
                    padding: "14px 16px", borderRadius: "12px", background: "#0b1324",
                    border: "1px solid rgba(139,92,246,0.35)", minHeight: "120px",
                    justifyContent: codeLines.length ? "flex-start" : "center",
                  },
                  children: codeBody,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex", width: "100%", height: "92px", borderRadius: "12px",
                    background: "rgba(56,189,248,0.07)", border: "1px solid rgba(56,189,248,0.22)",
                  },
                  children: {
                    type: "svg",
                    props: {
                      width: 312, height: 92, viewBox: "0 0 312 92", fill: "none",
                      children: [
                        { type: "path", props: { d: "M8 46H304", stroke: "rgba(148,163,184,0.25)", strokeWidth: 1 } },
                        { type: "path", props: { d: plotPts, stroke: "#38bdf8", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" } },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };

  const sheet = backSheet(ICON_CARD, "rgba(139,92,246,0.16)", "rgba(139,92,246,0.35)");

  // ── Right column ─────────────────────────────────────────────────────
  const kindRow = {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: "12px" },
      children: [
        textRun("دفتر تفاعلي", true, { fontSize: "26px", color: "#a78bfa", fontWeight: "700" }),
        {
          type: "div",
          props: {
            style: {
              display: "flex", flexDirection: "row", alignItems: "center", gap: "8px", direction: "ltr",
              background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.5)",
              borderRadius: "8px", padding: "4px 12px", fontSize: "18px", fontWeight: "700", color: "#ddd6fe",
            },
            children: [
              { type: "div", props: { style: { display: "flex", width: "9px", height: "9px", borderRadius: "5px", background: "#22c55e" } } },
              { type: "div", props: { style: { display: "flex" }, children: runtimeLabel } },
            ],
          },
        },
      ],
    },
  };

  const T = NB_THEME;
  const crumb = crumbRow([meta?.courseName, meta?.folderName], T);
  const titleEl = titleBlock(title, T, !!crumb);
  const descEl = descBlock(desc, T);
  const chipsEl = chipsRow(chips, T);

  const element = {
    type: "div",
    props: {
      style: {
        display: "flex", width: "100%", height: "100%", position: "relative",
        fontFamily: FONT_FAMILY_STACK, backgroundColor: NB_BG,
        backgroundImage:
          "radial-gradient(circle at 0% 0%, rgba(139,92,246,0.30) 0%, rgba(139,92,246,0) 50%), radial-gradient(circle at 100% 100%, rgba(0,136,204,0.22) 0%, rgba(0,136,204,0) 45%)",
      },
      children: [
        accentStripe(NB_ACCENT, BRAND_BLUE),
        { type: "div", props: { style: { display: "flex", position: "absolute", right: "40px", top: "24px", fontSize: "16px", color: "#64748b", direction: "ltr" }, children: "basmagi-quiz.vercel.app" } },
        sheet,
        windowCard,
        rightColumn([kindRow, crumb, titleEl, descEl, chipsEl], NB_COLUMN),
        footerLink(linkPath, "#64748b"),
      ],
    },
  };

  const renderIsComplete = fontData !== null && meta !== null;
  return renderPng(element, fontData, { complete: renderIsComplete, fallback: "/assets/images/thumbnails/lesson-thumbnail.jpg" });
}

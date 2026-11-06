// ============================================================================
// public/src/features/home/notebook-card-view.js
// ONE notebook card layout for both the platform (notebook-card.js) and
// «محتواي» (user-quiz-card.js), so they can never drift apart again: same
// title, description, cell count, runtime label and type chip.
// Callers only differ in the buttons/menus they attach.
// ============================================================================
import { createTypeChip, tagCardType } from "./card-type.js";
import { MORE_DOTS_ICON_SVG, DOWNLOAD_ICON_SVG } from "./icons.js";
import { RUNTIME_CONFIG } from "../../shared/runtime-config.js";

export const RUNTIME_LABELS = { matlab: "MATLAB (تعليمي)", cpp: "C++" };

export function runtimeLabel(runtime) {
  return RUNTIME_CONFIG[runtime]?.label === "C++" ? "C++" : RUNTIME_LABELS[runtime] || RUNTIME_CONFIG[runtime]?.label || runtime || "";
}

/**
 * Builds the shared notebook card body.
 * @param {{title?:string, description?:string, cellCount?:number, runtime?:string, iconClass?:string, cardClass?:string}} data
 * @returns {{card:HTMLElement, icon:HTMLElement, text:HTMLElement}}
 */
export function createNotebookCardShell(data) {
  const title = data.title || "دفتر بدون عنوان";
  const card = document.createElement("div");
  card.className = data.cardClass || "card exam-card lesson-card notebook-card";
  card.setAttribute("role", "article");
  card.setAttribute("aria-label", `دفتر تفاعلي: ${title}`);
  tagCardType(card, "notebook");

  const icon = document.createElement("span");
  icon.className = data.iconClass || "phone-only-emoji";
  icon.textContent = "💻";
  icon.setAttribute("aria-hidden", "true");

  const text = document.createElement("div");
  text.className = "card-text";
  const runtime = runtimeLabel(data.runtime);
  text.appendChild(createTypeChip("notebook", runtime));

  const heading = document.createElement("h3");
  heading.textContent = title;
  heading.setAttribute("data-tooltip-badge", "💻 دفتر تفاعلي");
  heading.setAttribute("data-tooltip-text", title);
  text.appendChild(heading);

  const description = String(data.description || "").trim();
  if (description) {
    const desc = document.createElement("p");
    desc.className = "lesson-card-description";
    desc.textContent = description;
    desc.setAttribute("data-tooltip-badge", "📄 وصف الدفتر");
    desc.setAttribute("data-tooltip-text", description);
    text.appendChild(desc);
  }

  const meta = document.createElement("div");
  meta.className = "exam-card-meta user-quiz-card-meta";
  const cells = document.createElement("p");
  cells.className = "exam-question-count";
  cells.textContent = `الخلايا: ${Number(data.cellCount) || 0}`;
  meta.appendChild(cells);
  if (runtime) {
    const rt = document.createElement("p");
    rt.className = "exam-types-subtext";
    rt.textContent = runtime;
    meta.appendChild(rt);
  }
  text.appendChild(meta);
  return { card, icon, text };
}

/** The ⋮ / open / download button row, identical for platform and local cards. */
export function createNotebookActionRow({ title, onMore, onOpen, onDownload }) {
  const name = title || "دفتر بدون عنوان";
  const actions = document.createElement("div");
  actions.className = "exam-card-actions-wrap";

  const more = document.createElement("button");
  more.type = "button";
  more.className = "exam-more-btn";
  more.innerHTML = MORE_DOTS_ICON_SVG;
  more.title = "خيارات الدفتر";
  more.setAttribute("aria-label", `خيارات إضافية لـ ${name}`);
  more.addEventListener("click", (event) => { event.stopPropagation(); onMore(more); });

  const start = document.createElement("button");
  start.type = "button";
  start.className = "start-btn";
  start.style.flex = "1";
  start.style.minWidth = "0";
  start.textContent = "افتح الدفتر";
  start.setAttribute("aria-label", `افتح الدفتر ${name}`);
  start.addEventListener("click", (event) => { event.stopPropagation(); onOpen(); });

  const download = document.createElement("button");
  download.type = "button";
  download.className = "start-btn desktop-download-btn";
  download.style.flex = "1";
  download.style.minWidth = "0";
  download.innerHTML = `${DOWNLOAD_ICON_SVG}<span>تحميل</span>`;
  download.setAttribute("aria-label", `تحميل دفتر ${name}`);
  download.addEventListener("click", (event) => { event.stopPropagation(); onDownload(download); });

  actions.append(more, start, download);
  return actions;
}

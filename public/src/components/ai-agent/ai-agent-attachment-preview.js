// =============================================================================
// public/src/components/ai-agent/ai-agent-attachment-preview.js
// Preview of one chat attachment, shown INSIDE the agent window as a layer over the
// chat area (openWindowLayer, ai-agent-window.js) — never over the whole page.
//   - image files: the picture, contain-fitted, with a caption bar (name, type, size, pixels)
//   - platform items (quiz, lesson, notebook, YouTube video/playlist, course, folder): a card
//     with the kind icon + label from core/chat-attachments.js and the real details
//   - any other file: an icon card (name, type, size)
// Where it makes sense there is an "open" action: quiz / lesson / notebook open their page,
// YouTube opens its floating window (or YouTube itself when the item is not in «محتواي»).
// All text goes in through textContent; only static icon strings use innerHTML.
// =============================================================================

import { openWindowLayer } from "./ai-agent-window.js";
import { ATTACHMENT_KIND_LABEL_AR, iconForAttachment, labelForAttachment } from "./core/chat-attachments.js";
import { isYoutubeAttachment, formatDuration } from "./core/youtube-attachment.js";

const svg = (body, size = 18, sw = 2) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON_CLOSE = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 18, 2.25);
const ICON_OPEN = svg('<path d="M7 17 17 7"/><path d="M8 7h9v9"/>', 16, 2.25);
const ICON_IMAGE = svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>', 20);

const OPEN_LABEL = {
  quiz: "افتح الامتحان", lesson: "افتح الدرس", notebook: "افتح الدفتر",
  youtube_video: "شغّل الفيديو", youtube_playlist: "افتح قائمة التشغيل",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function isImageAttachment(att) {
  return att?.kind === "file" && String(att.mimeType || "").startsWith("image/") && !!att.base64;
}

function kindKey(att) {
  if (isYoutubeAttachment(att)) return att.itemType === "youtube_playlist" ? "youtube_playlist" : "youtube_video";
  if (att.kind === "file") return isImageAttachment(att) ? "image" : "file";
  if (att.itemType === "notebook") return "notebook";
  return att.kind || "file";
}

function kindLabel(att, key) {
  if (key === "image") return "صورة";
  return ATTACHMENT_KIND_LABEL_AR[att.itemType] || ATTACHMENT_KIND_LABEL_AR[att.kind] || "مرفق";
}

/** Exact size of a base64 payload (not the length of the string). */
function base64Bytes(b64) {
  if (typeof b64 !== "string" || !b64) return null;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "image/png" -> "PNG", "application/pdf" -> "PDF", falls back to the file extension. */
export function friendlyType(att) {
  const mime = String(att.mimeType || "");
  const sub = mime.split("/")[1]?.split(/[;+]/)[0];
  if (sub && !/^(octet-stream|plain|x-)/i.test(sub)) return sub.toUpperCase();
  const ext = /\.([a-z0-9]{1,6})$/i.exec(String(att.name || ""))?.[1];
  return (ext || mime.split("/")[0] || "ملف").toUpperCase();
}

function formatDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  try { return d.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" }); } catch { return ""; }
}

/** "label: value — label: value" (how the attach launcher writes summaries) -> [[label, value], …]; null otherwise. */
export function parseFacts(summary, { allowSingle = true } = {}) {
  const parts = String(summary || "").split(/\s+—\s+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length || (!allowSingle && parts.length < 2)) return null;
  const facts = [];
  for (const part of parts) {
    const m = /^([^:：\n]{1,28})[:：]\s*([\s\S]+)$/.exec(part);
    if (!m) return null;
    facts.push([m[1].trim(), m[2].trim()]);
  }
  return facts;
}

function safeExternalUrl(url) {
  try {
    const u = new URL(String(url || ""));
    const host = u.hostname.toLowerCase();
    const ok = u.protocol === "https:" && (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be");
    return ok ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Where "open" goes for quiz / lesson / notebook (local items live behind ?type=user). */
export function pageHrefFor(att) {
  if (!att?.id) return "";
  const id = encodeURIComponent(att.id);
  const suffix = att.source === "platform" ? "" : "?type=user";
  if (att.itemType === "notebook") return `/notebook/${id}${suffix}`;
  if (att.kind === "quiz") return `/quiz/${id}${suffix}`;
  if (att.kind === "lesson") return `/lesson/${id}${suffix}`;
  return "";
}

/** Opens a YouTube attachment in its floating window; true when it did. */
async function openYoutubeWindow(att) {
  try {
    const { findLibraryItem } = await import("../../features/home/youtube-library.js");
    const entry = att.id ? findLibraryItem(att.id) : null;
    if (!entry) return false;
    if (att.itemType === "youtube_playlist") {
      const { openYoutubePlaylistWindow } = await import("../../features/home/youtube-playlist-window.js");
      openYoutubePlaylistWindow(entry);
    } else {
      const { openYoutubeVideoPlayer } = await import("../../features/home/youtube-player-window.js");
      openYoutubeVideoPlayer(entry);
    }
    return true;
  } catch (err) {
    console.error("[ai-agent] failed to open YouTube attachment", err);
    return false;
  }
}

function factsList(rows) {
  const dl = el("dl", "ai-att-facts");
  for (const [label, value] of rows) {
    if (!value) continue;
    const row = el("div", "ai-att-fact");
    const dt = el("dt", null, label);
    const dd = el("dd", null, String(value));
    dd.dir = "auto";
    row.append(dt, dd);
    dl.appendChild(row);
  }
  return dl.childElementCount ? dl : null;
}

function textBlock(title, text) {
  const section = el("section", "ai-att-text");
  section.appendChild(el("h3", "ai-att-text-title", title));
  const p = el("p", "ai-att-text-body", text);
  p.dir = "auto";
  section.appendChild(p);
  return section;
}

function platformDetails(att, key) {
  const nodes = [];
  const origin = att.source === "platform" ? "المنصة" : att.source === "local" ? "محتواي" : "";
  if (isYoutubeAttachment(att)) {
    const p = att.payload || {};
    const rows = [["القناة", p.channel]];
    if (key === "youtube_playlist") rows.push(["عدد الفيديوهات", p.videoCount ? String(p.videoCount) : ""]);
    else rows.push(["المدة", p.duration || formatDuration(p.durationSeconds) || ""]);
    rows.push(["تاريخ النشر", formatDate(p.publishedAt)], ["المصدر", origin]);
    const list = factsList(rows);
    if (list) nodes.push(list);
    if (key === "youtube_playlist" && Array.isArray(p.videoTitles) && p.videoTitles.length) {
      const shown = p.videoTitles.slice(0, 8);
      const section = el("section", "ai-att-text");
      section.appendChild(el("h3", "ai-att-text-title", "فيديوهات القائمة"));
      const ol = el("ol", "ai-att-videos");
      shown.forEach((t) => { const li = el("li", null, String(t)); li.dir = "auto"; ol.appendChild(li); });
      section.appendChild(ol);
      const rest = (p.videoCount || p.videoTitles.length) - shown.length;
      if (rest > 0) section.appendChild(el("p", "ai-att-more", `و${rest.toLocaleString("ar-EG")} فيديو آخر`));
      nodes.push(section);
    }
    if (p.description) nodes.push(textBlock("الوصف", p.description));
    return nodes;
  }
  const facts = parseFacts(att.summary, { allowSingle: att.kind !== "lesson" });
  if (facts) {
    const list = factsList([...facts, ["المصدر", origin]]);
    if (list) nodes.push(list);
  } else {
    if (att.summary) nodes.push(textBlock(att.kind === "lesson" ? "الوصف" : "تفاصيل", att.summary));
    const list = factsList([["المصدر", origin]]);
    if (list) nodes.push(list);
  }
  return nodes;
}

/**
 * @param {HTMLElement} anchor  any element inside the agent window (the chat panel, the clicked tile)
 * @param {object} att  a pendingAttachments / in-history attachments[] entry
 *   ({kind, title|name, summary?, payload?, mimeType?, base64?, source?, id?, itemType?})
 * @param {{ returnFocus?: HTMLElement }} [opts]
 */
export function openAttachmentPreview(anchor, att, opts = {}) {
  if (!att) return null;
  const key = kindKey(att);
  const label = labelForAttachment(att) || "بدون عنوان";
  let layer = null;
  const close = () => layer?.close();

  const root = el("div", "ai-att");
  root.dataset.kind = key;
  root.dir = "rtl";

  // ── Top bar: kind + close ──
  const bar = el("div", "ai-att-bar");
  const chip = el("span", "ai-att-chip");
  const chipIcon = el("span", "ai-att-chip-icon");
  chipIcon.innerHTML = key === "image" ? ICON_IMAGE : iconForAttachment(att.kind ? att : { kind: "file" });
  chip.append(chipIcon, el("span", null, kindLabel(att, key)));
  const closeBtn = el("button", "ai-att-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "إغلاق المعاينة");
  closeBtn.title = "إغلاق";
  closeBtn.innerHTML = ICON_CLOSE;
  closeBtn.addEventListener("click", close);
  bar.append(chip, closeBtn);
  root.appendChild(bar);

  const stage = el("div", "ai-att-stage");
  root.appendChild(stage);
  // Clicking the empty area around the content dismisses it (like a lightbox).
  stage.addEventListener("click", (e) => { if (e.target === stage) close(); });

  // ── Image ──
  if (key === "image") {
    const figure = el("figure", "ai-att-figure");
    const img = document.createElement("img");
    img.className = "ai-att-image";
    img.alt = label;
    img.decoding = "async";
    img.src = `data:${att.mimeType};base64,${att.base64}`;
    figure.appendChild(img);
    stage.appendChild(figure);

    const caption = el("div", "ai-att-caption");
    const name = el("span", "ai-att-caption-name", label);
    name.dir = "auto";
    name.title = label;
    const meta = el("span", "ai-att-caption-meta");
    const metaParts = [friendlyType(att), formatBytes(base64Bytes(att.base64))].filter(Boolean);
    const render = (dims) => { meta.textContent = [...metaParts, dims].filter(Boolean).join("  ·  "); };
    render("");
    img.addEventListener("load", () => render(`${img.naturalWidth}×${img.naturalHeight}`), { once: true });
    caption.append(name, meta);
    root.appendChild(caption);
  } else {
    // ── Platform item / plain file: one card ──
    const card = el("article", "ai-att-card");
    const tile = el("div", "ai-att-tile");
    tile.innerHTML = iconForAttachment(att.kind ? att : { kind: "file" });
    const heading = el("h2", "ai-att-title", label);
    heading.dir = "auto";
    card.append(tile, heading);

    if (att.kind === "file") {
      const list = factsList([["النوع", friendlyType(att)], ["الحجم", formatBytes(base64Bytes(att.base64))]]);
      if (list) card.appendChild(list);
      if (!list) card.appendChild(el("p", "ai-att-more", "لا توجد معاينة لهذا الملف."));
    } else {
      platformDetails(att, key).forEach((n) => card.appendChild(n));
    }
    stage.appendChild(card);
  }

  // ── Actions ──
  const status = el("p", "ai-att-status");
  status.setAttribute("role", "status");
  const actions = el("div", "ai-att-actions");
  const openLabel = OPEN_LABEL[key];
  if (openLabel) {
    const href = isYoutubeAttachment(att) ? "" : pageHrefFor(att);
    if (href || isYoutubeAttachment(att)) {
      const primary = el("button", "ai-att-btn ai-att-btn--primary");
      primary.type = "button";
      primary.append(el("span", null, openLabel));
      primary.insertAdjacentHTML("beforeend", ICON_OPEN);
      primary.addEventListener("click", async () => {
        if (href) { window.location.href = href; return; }
        primary.disabled = true;
        const opened = await openYoutubeWindow(att);
        if (opened) { close(); return; }
        const external = safeExternalUrl(att.payload?.url);
        if (external) { window.open(external, "_blank", "noopener,noreferrer"); close(); return; }
        status.textContent = "لم يعد هذا العنصر في «محتواي».";
        primary.disabled = false;
      });
      actions.appendChild(primary);
    }
  }
  const dismiss = el("button", "ai-att-btn", "إغلاق");
  dismiss.type = "button";
  dismiss.addEventListener("click", close);
  actions.appendChild(dismiss);
  const foot = el("div", "ai-att-foot");
  foot.append(status, actions);
  if (key !== "image") root.appendChild(foot); // images: the caption bar is the footer

  layer = openWindowLayer(anchor, {
    content: root,
    label: `معاينة المرفق: ${label}`,
    variant: "pop",
    className: "aiw-layer--attachment",
    initialFocus: closeBtn, // never the "open" button: a stray Enter must not navigate away
    returnFocus: opts.returnFocus,
  });
  return layer;
}

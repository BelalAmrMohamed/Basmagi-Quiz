// =============================================================================
// public/src/components/ai-agent/ai-agent-history-tooltip.js
// Rich hover/focus tooltip for conversation-history items (the history list and
// the sidebar both render them through ai-agent-history.js). Replaces the native
// `title` attribute with a themed card: pinned/open chips, the full title, a
// short preview of the last reply, message count and when it was last active.
//
// One shared element for the whole page (appended to <body>, pointer-events:
// none). Mouse only: touch devices keep the plain list row, since a hover card
// would just get in the way of a tap. Styles: `.ai-agent-hist-tip` in
// ai-agent.css (same visual language as `.ai-agent__token-tooltip`).
// =============================================================================

const SHOW_DELAY_MS = 380;
const EDGE = 10;
const GAP = 10;

const PIN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const OPEN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="5"/></svg>';
const CHAT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const CLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

let tipEl = null;
let timer = 0;
let anchor = null;

function ensureTip() {
  if (tipEl && tipEl.isConnected) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "ai-agent-hist-tip";
  tipEl.setAttribute("role", "tooltip");
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  return tipEl;
}

function stripMarkdown(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastReplyPreview(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant" || m.type === "tool-result" || typeof m.content !== "string") continue;
    const text = stripMarkdown(m.content);
    if (text) return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
  }
  return "";
}

function messageCountLabel(n) {
  const num = new Intl.NumberFormat("ar-EG").format(n);
  if (n === 1) return "رسالة واحدة";
  if (n === 2) return "رسالتان";
  if (n >= 3 && n <= 10) return `${num} رسائل`;
  return `${num} رسالة`;
}

function chip(className, svg, text) {
  const el = document.createElement("span");
  el.className = `ai-agent-hist-tip__chip ${className}`;
  el.innerHTML = svg;
  el.appendChild(document.createTextNode(text));
  return el;
}

function meta(svg, text) {
  const el = document.createElement("span");
  el.className = "ai-agent-hist-tip__meta-item";
  el.innerHTML = svg;
  const label = document.createElement("span");
  label.textContent = text;
  el.appendChild(label);
  return el;
}

function build(info) {
  const tip = ensureTip();
  const parts = [];

  if (info.pinned || info.active) {
    const chips = document.createElement("div");
    chips.className = "ai-agent-hist-tip__chips";
    if (info.pinned) chips.appendChild(chip("ai-agent-hist-tip__chip--pinned", PIN_SVG, "مثبّتة"));
    if (info.active) chips.appendChild(chip("ai-agent-hist-tip__chip--active", OPEN_SVG, "مفتوحة الآن"));
    parts.push(chips);
  }

  const title = document.createElement("strong");
  title.className = "ai-agent-hist-tip__title";
  title.dir = "auto";
  title.textContent = info.title || "محادثة بدون عنوان";
  parts.push(title);

  const preview = lastReplyPreview(info.messages);
  if (preview) {
    const box = document.createElement("div");
    box.className = "ai-agent-hist-tip__preview";
    const label = document.createElement("span");
    label.className = "ai-agent-hist-tip__preview-label";
    label.textContent = "آخر رد";
    const text = document.createElement("p");
    text.dir = "auto";
    text.textContent = preview;
    box.append(label, text);
    parts.push(box);
  }

  const row = document.createElement("div");
  row.className = "ai-agent-hist-tip__meta";
  const count = Array.isArray(info.messages)
    ? info.messages.filter((m) => (m?.role === "user" || m?.role === "assistant") && m.type !== "tool-result" && m.content).length
    : 0;
  if (count) row.appendChild(meta(CHAT_SVG, messageCountLabel(count)));
  if (info.timestamp) {
    let absolute = "";
    try {
      absolute = new Date(info.timestamp).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
    } catch {
      absolute = "";
    }
    row.appendChild(meta(CLOCK_SVG, absolute ? `${info.relative || ""} · ${absolute}`.replace(/^ · /, "") : info.relative || ""));
  }
  if (row.childNodes.length) parts.push(row);

  tip.replaceChildren(...parts);
}

function place(rect) {
  const tip = ensureTip();
  const box = tip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left;
  let top;
  if (rect.left - GAP - box.width >= EDGE) {
    // Beside the row, toward the content side (the sidebar sits at the inline-start edge of an RTL UI).
    left = rect.left - GAP - box.width;
    top = rect.top + rect.height / 2 - box.height / 2;
  } else if (rect.right + GAP + box.width <= vw - EDGE) {
    left = rect.right + GAP;
    top = rect.top + rect.height / 2 - box.height / 2;
  } else {
    left = Math.max(EDGE, Math.min(rect.left + rect.width / 2 - box.width / 2, vw - box.width - EDGE));
    top = rect.bottom + GAP + box.height <= vh - EDGE ? rect.bottom + GAP : rect.top - GAP - box.height;
  }
  top = Math.max(EDGE, Math.min(top, vh - box.height - EDGE));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function onViewportChange() {
  hideHistoryTooltip();
}

export function hideHistoryTooltip() {
  clearTimeout(timer);
  timer = 0;
  anchor = null;
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);
  if (tipEl && !tipEl.hidden) {
    tipEl.hidden = true;
    tipEl.replaceChildren();
  }
}

function reveal(item, getInfo) {
  timer = 0;
  if (!item.isConnected) return;
  anchor = item;
  build(getInfo());
  const tip = ensureTip();
  tip.hidden = false;
  place(item.getBoundingClientRect());
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
}

/**
 * @param {HTMLElement} item - the history row
 * @param {() => { title: string, messages?: Array<object>, pinned?: boolean, active?: boolean, timestamp?: number, relative?: string }} getInfo
 *   called lazily on show, so renamed/updated data is always current
 */
export function attachHistoryTooltip(item, getInfo) {
  item.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(timer);
    // Moving between rows swaps the card immediately instead of re-waiting.
    const wait = tipEl && !tipEl.hidden ? 0 : SHOW_DELAY_MS;
    timer = setTimeout(() => reveal(item, getInfo), wait);
  });
  item.addEventListener("pointerleave", () => {
    if (anchor === item || timer) hideHistoryTooltip();
  });
  item.addEventListener("pointerdown", hideHistoryTooltip);
  item.addEventListener("focus", () => {
    if (item.matches(":focus-visible")) reveal(item, getInfo);
  });
  item.addEventListener("blur", () => {
    if (anchor === item || timer) hideHistoryTooltip();
  });
  item.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideHistoryTooltip();
  });
}

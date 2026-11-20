// =============================================================================
// public/src/features/home/youtube-player-window.js
// Resizable player window for saved «فيديو يوتيوب» items (playlists reuse it
// in Phase B). Chrome follows the AI-agent window: mac-style controls (close,
// minimize to the title bar, maximize), drag by the title bar, 8-way resize,
// double-click title to maximize. It is a copy, not an import: the agent window
// keeps its own storage keys and hides the AI buttons while open, which this
// window must not do. Aero Snap is not part of this copy.
// Plays through YouTube's privacy-enhanced embed; text is set with textContent.
// =============================================================================

import { canonicalWatchUrl, embedUrl, formatDurationSeconds, isValidVideoId } from "../../shared/youtube-rules.js";

const MIN_W = 360;
const MIN_H = 320;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const RESIZE_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

let activeWindow = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function formatPublished(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
}

/** Channel name as a link to the channel page when the ID is valid, plain text otherwise. */
export function channelLinkEl(channelId, name) {
  const label = String(name || "").trim();
  if (!label) return null;
  if (!CHANNEL_ID_RE.test(channelId || "")) return el("span", "yt-channel", label);
  const a = el("a", "yt-link yt-channel", label);
  a.href = `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

/**
 * Opens the floating player window with `content` in its body. Only one window
 * is open at a time: opening another replaces it.
 * @returns {{el: HTMLElement, close: () => void}}
 */
export function openYoutubeWindow({ title, content, onClose } = {}) {
  activeWindow?.close();
  const returnFocus = document.activeElement;

  const win = el("div", "ytw");
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", title || "نافذة الفيديو");
  win.tabIndex = -1;
  win.innerHTML = `
    <div class="ytw-titlebar">
      <div class="ytw-controls" dir="ltr">
        <button type="button" class="ytw-btn ytw-btn--close" aria-label="إغلاق" title="إغلاق"></button>
        <button type="button" class="ytw-btn ytw-btn--min" aria-label="تصغير" title="تصغير"></button>
        <button type="button" class="ytw-btn ytw-btn--max" aria-label="تكبير" title="تكبير"></button>
      </div>
      <div class="ytw-title"></div>
    </div>
    <div class="ytw-body"></div>
    ${RESIZE_DIRS.map((d) => `<div class="ytw-resizer" data-dir="${d}"></div>`).join("")}
  `;
  win.querySelector(".ytw-title").textContent = title || "";
  if (content) win.querySelector(".ytw-body").append(content);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(MIN_W, Math.min(980, vw - 32));
  const h = Math.max(MIN_H, Math.min(680, vh - 64));
  Object.assign(win.style, {
    width: `${w}px`,
    height: `${h}px`,
    left: `${Math.max(8, (vw - w) / 2)}px`,
    top: `${Math.max(8, (vh - h) / 2)}px`,
  });

  const state = { maximized: false, minimized: false };

  const setMinimized = (on) => {
    state.minimized = on;
    win.classList.toggle("is-min", on);
  };
  const setMaximized = (on) => {
    if (on) setMinimized(false);
    state.maximized = on;
    win.classList.toggle("is-max", on);
    win.querySelector(".ytw-btn--max").setAttribute("aria-label", on ? "استعادة" : "تكبير");
    win.querySelector(".ytw-btn--max").title = on ? "استعادة" : "تكبير";
  };
  const toggleMax = () => setMaximized(!state.maximized);

  let closed = false;
  const onKey = (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    if (state.maximized) setMaximized(false);
    else close();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    win.remove();
    if (activeWindow === api) activeWindow = null;
    onClose?.();
    if (returnFocus && typeof returnFocus.focus === "function" && document.contains(returnFocus)) {
      returnFocus.focus();
    }
  };

  win.querySelector(".ytw-btn--close").addEventListener("click", close);
  win.querySelector(".ytw-btn--min").addEventListener("click", () => {
    if (state.maximized) setMaximized(false);
    setMinimized(!state.minimized);
  });
  win.querySelector(".ytw-btn--max").addEventListener("click", toggleMax);

  // Drag by the title bar (not from the mac controls), double-click to maximize.
  const titlebar = win.querySelector(".ytw-titlebar");
  titlebar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || state.maximized || e.target.closest(".ytw-controls")) return;
    const rect = win.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev) => {
      win.style.left = `${clamp(rect.left + ev.clientX - startX, 0, window.innerWidth - 80)}px`;
      win.style.top = `${clamp(rect.top + ev.clientY - startY, 0, window.innerHeight - 40)}px`;
    };
    const onUp = () => {
      titlebar.removeEventListener("pointermove", onMove);
      titlebar.removeEventListener("pointerup", onUp);
      titlebar.removeEventListener("pointercancel", onUp);
    };
    titlebar.setPointerCapture?.(e.pointerId);
    titlebar.addEventListener("pointermove", onMove);
    titlebar.addEventListener("pointerup", onUp);
    titlebar.addEventListener("pointercancel", onUp);
  });
  titlebar.addEventListener("dblclick", (e) => {
    if (!e.target.closest(".ytw-controls")) toggleMax();
  });

  win.querySelectorAll(".ytw-resizer").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || state.maximized || state.minimized) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = handle.dataset.dir;
      const r = win.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, w: r.width, h: r.height };
      const onMove = (ev) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        let l = start.l, t = start.t, nw = start.w, nh = start.h;
        if (dir.includes("e")) nw = Math.max(MIN_W, start.w + dx);
        if (dir.includes("s")) nh = Math.max(MIN_H, start.h + dy);
        if (dir.includes("w")) { nw = Math.max(MIN_W, start.w - dx); l = start.l + (start.w - nw); }
        if (dir.includes("n")) { nh = Math.max(MIN_H, start.h - dy); t = start.t + (start.h - nh); }
        Object.assign(win.style, { left: `${l}px`, top: `${t}px`, width: `${nw}px`, height: `${nh}px` });
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
      };
      handle.setPointerCapture?.(e.pointerId);
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  });

  document.addEventListener("keydown", onKey, true);
  document.body.append(win);
  win.focus({ preventScroll: true });

  const api = { el: win, close };
  activeWindow = api;
  return api;
}

function buildInfo({ channelId, channelTitle, durationSeconds, publishedAt, description, videoId }) {
  const wrap = el("div", "ytw-info");
  const top = el("div", "ytw-info-top");
  const channel = channelLinkEl(channelId, channelTitle);
  if (channel) top.append(channel);
  const facts = [formatDurationSeconds(durationSeconds), formatPublished(publishedAt)].filter(Boolean).join(" · ");
  if (facts) top.append(el("span", "ytw-facts", facts));
  if (isValidVideoId(videoId)) {
    const link = el("a", "yt-link", "فتح على يوتيوب");
    link.href = canonicalWatchUrl(videoId);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    top.append(link);
  }
  wrap.append(top);
  wrap.append(el("div", "ytw-desc", String(description || "").trim() || "لا يوجد وصف لهذا الفيديو."));
  return wrap;
}

function buildVideoPane(item, videoId) {
  const pane = el("div", "ytw-pane");
  if (isValidVideoId(videoId)) {
    const frame = el("div", "yt-embed ytw-video");
    const iframe = document.createElement("iframe");
    iframe.src = embedUrl(videoId);
    iframe.title = item?.meta?.title || "فيديو";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    frame.append(iframe);
    pane.append(frame);
  } else {
    pane.append(el("p", "yt-empty", "تعذّر تحديد الفيديو. قد يكون هذا العنصر تالفاً."));
  }
  pane.append(buildInfo({
    channelId: item?.meta?.channelId,
    channelTitle: item?.meta?.channelTitle,
    durationSeconds: item?.stats?.durationSeconds ?? item?.video?.durationSeconds,
    publishedAt: item?.meta?.publishedAt,
    description: item?.meta?.description,
    videoId,
  }));
  return pane;
}

/**
 * Opens a saved personal video (meta.type "youtube_video") in the player window.
 * Plays through YouTube's privacy-enhanced embed and links to the canonical page.
 */
export function openYoutubeVideoPlayer(item) {
  const videoId = item?.meta?.youtubeId || item?.video?.videoId;
  const title = item?.meta?.title || "فيديو";
  openYoutubeWindow({ title, content: buildVideoPane(item, videoId) });
}

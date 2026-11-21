// =============================================================================
// public/src/features/home/youtube-player-window.js
// Resizable player window for saved «فيديو يوتيوب» items (playlists reuse it
// in Phase B). Chrome follows the AI-agent window: mac-style controls (close,
// minimize to the title bar, maximize), drag by the title bar, 8-way resize,
// double-click title to maximize, Aero-style snapping with a live preview.
// Written separately from the agent window on purpose (no shared code): the
// two will keep diverging, and the agent window hides the AI buttons while open.
// Plays through YouTube's privacy-enhanced embed; text is set with textContent.
// =============================================================================

import { embedUrl, isValidVideoId } from "../../shared/youtube-rules.js";
import { attachSplit } from "./youtube-split.js";
import { YOUTUBE_ICON_SVG } from "./icons.js";
import {
  animateTo, clampToViewport, cornerFromPoint, lockPageScroll, motionDelay,
  readCorner, writeCorner,
  registerMinimized, unregisterMinimized, setMinimizedCorner, setMinimizedDragging,
} from "../../shared/floating-window.js";

const MIN_CORNER_KEY = "bq-youtube-window-minimized-corner";
let pillSeq = 0; // unique registry id per window

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

// Aero-style snapping, written for this window only (not shared with the AI
// agent window: the two are going to diverge).
const AERO_EDGE = 12;     // px from a side/top edge that arms a snap zone
const AERO_CORNER = 96;   // px from a top/bottom corner that makes it a quarter
const SNAP_PREVIEW_MS = 220;
const ICON_MIN = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7"/></svg>';
const ICON_MAX = '<svg class="ic-max" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 9.5v-7h7v7z"/></svg><svg class="ic-restore" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 4V2.5h5.5V8H8M2.5 4H8v5.5H2.5z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';

/** Which snap zone the pointer arms: halves, quarters, or "max" at the top edge. */
export function aeroZone(x, y, iw, ih) {
  const left = x <= AERO_EDGE;
  const right = x >= iw - AERO_EDGE;
  if (left || right) {
    const side = left ? "left" : "right";
    if (y <= AERO_CORNER) return `top-${side}`;
    if (y >= ih - AERO_CORNER) return `bottom-${side}`;
    return side;
  }
  return y <= AERO_EDGE ? "max" : null;
}

/** Target rectangle of a snap zone. */
export function aeroRect(zone, iw, ih) {
  if (zone === "max") return { l: 0, t: 0, w: iw, h: ih };
  const hw = Math.floor(iw / 2);
  const hh = Math.floor(ih / 2);
  const l = zone.endsWith("right") ? iw - hw : 0;
  if (zone === "left" || zone === "right") return { l, t: 0, w: hw, h: ih };
  return { l, t: zone.startsWith("top") ? 0 : ih - hh, w: hw, h: hh };
}

/**
 * Opens the floating player window with `content` in its body. Only one window
 * is open at a time: opening another replaces it.
 * Behaviour: drag by the title bar; snap to halves/quarters (maximize at the
 * top edge) with a live preview; dragging a snapped or maximized window away
 * restores its previous size; a second maximize click restores size+position.
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
      <span class="ytw-logo" aria-hidden="true">${YOUTUBE_ICON_SVG}</span>
      <div class="ytw-title"></div>
      <div class="ytw-controls">
        <button type="button" class="ytw-btn ytw-btn--min" aria-label="تصغير" title="تصغير">${ICON_MIN}</button>
        <button type="button" class="ytw-btn ytw-btn--max" aria-label="تكبير" title="تكبير">${ICON_MAX}</button>
        <button type="button" class="ytw-btn ytw-btn--close" aria-label="إغلاق" title="إغلاق">${ICON_CLOSE}</button>
      </div>
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

  // savedRect: geometry to return to from maximize. snapRestore: size to
  // return to when a snapped window is dragged away.
  const state = { maximized: false, minimized: false, savedRect: null, minRestore: null, snapRestore: null, zone: null, preview: null, unlock: null };
  const rectOf = () => ({ left: win.offsetLeft, top: win.offsetTop, width: win.offsetWidth, height: win.offsetHeight });
  const maxBtn = win.querySelector(".ytw-btn--max");

  const minBtn = win.querySelector(".ytw-btn--min");

  // Page scroll is locked while maximized (reference-counted: two windows are safe).
  const syncScrollLock = () => {
    if (state.maximized && !state.unlock) state.unlock = lockPageScroll();
    else if (!state.maximized && state.unlock) { state.unlock(); state.unlock = null; }
  };

  // The pill's slot comes from the shared registry (stacked clear of every other minimized
  // window, re-laid out whenever any of them moves, restores or closes).
  const pillId = `youtube-${++pillSeq}`;
  const setMinimized = (on) => {
    if (on === state.minimized) return;
    if (on) {
      state.minRestore = rectOf();
      state.minimized = true;
      win.classList.add("is-min");
      const corner = readCorner(MIN_CORNER_KEY, "bottom-right");
      win.dataset.corner = corner;
      registerMinimized(pillId, win, corner);
    } else {
      state.minimized = false;
      win.classList.remove("is-min");
      unregisterMinimized(pillId);
      delete win.dataset.corner;
      const r = state.minRestore;
      state.minRestore = null;
      if (r) {
        const c = clampToViewport(r.left, r.top, r.width, r.height, window.innerWidth, window.innerHeight);
        animateTo(win, { left: c.left, top: c.top, width: r.width, height: r.height });
      }
    }
    const label = on ? "استعادة" : "تصغير";
    minBtn.setAttribute("aria-label", label);
    minBtn.title = label;
  };
  const setMaximized = (on, from) => {
    if (on === state.maximized) return;
    if (on) {
      setMinimized(false);
      state.savedRect = from || rectOf();
    }
    state.maximized = on;
    win.classList.toggle("is-max", on);
    syncScrollLock();
    if (!on && state.savedRect) {
      const r = state.savedRect;
      Object.assign(win.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      state.savedRect = null;
    }
    const label = on ? "استعادة" : "تكبير";
    maxBtn.setAttribute("aria-label", label);
    maxBtn.title = label;
  };
  const toggleMax = () => setMaximized(!state.maximized);

  function updatePreview(zone) {
    let pv = state.preview;
    if (!zone) {
      if (!pv) return;
      pv.classList.remove("is-visible");
      state.preview = null;
      setTimeout(() => pv.remove(), motionDelay(SNAP_PREVIEW_MS));
      return;
    }
    const r = aeroRect(zone, window.innerWidth, window.innerHeight);
    if (!pv) {
      pv = el("div", "ytw-snap-preview");
      const wr = win.getBoundingClientRect();
      Object.assign(pv.style, { left: `${wr.left}px`, top: `${wr.top}px`, width: `${wr.width}px`, height: `${wr.height}px` });
      document.body.append(pv);
      state.preview = pv;
      pv.getBoundingClientRect(); // commit the start rect so the transition runs
    }
    pv.classList.add("is-visible");
    Object.assign(pv.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  let closed = false;
  const onKey = (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    if (state.maximized) setMaximized(false);
    else close();
  };
  const onViewport = () => {
    if (state.minimized) return; // the registry re-lays out pills on resize / keyboard
    if (state.maximized) return;
    const r = rectOf();
    win.style.left = `${clamp(r.left, -r.width + 100, window.innerWidth - 100)}px`;
    win.style.top = `${clamp(r.top, 0, window.innerHeight - 40)}px`;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    unregisterMinimized(pillId);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onViewport);
    window.visualViewport?.removeEventListener("resize", onViewport);
    updatePreview(null);
    state.unlock?.();
    state.unlock = null;
    win.remove();
    if (activeWindow === api) activeWindow = null;
    onClose?.();
    if (returnFocus && typeof returnFocus.focus === "function" && document.contains(returnFocus)) {
      returnFocus.focus();
    }
  };

  win.querySelector(".ytw-btn--close").addEventListener("click", close);
  minBtn.addEventListener("click", () => {
    if (state.maximized) setMaximized(false);
    state.snapRestore = null;
    setMinimized(!state.minimized);
  });
  maxBtn.addEventListener("click", () => {
    state.snapRestore = null;
    if (state.minimized) setMinimized(false);
    else toggleMax();
  });

  // Drag by the title bar (not from the controls); double-click to maximize.
  const titlebar = win.querySelector(".ytw-titlebar");
  titlebar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".ytw-controls")) return;
    if (state.minimized) {
      // Minimized pill: drag to another corner (it glides there); a plain click restores.
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      const r0 = win.getBoundingClientRect();
      let dragged = false;
      titlebar.setPointerCapture?.(e.pointerId);
      const onPillMove = (ev) => {
        if (!dragged && Math.hypot(ev.clientX - sx, ev.clientY - sy) <= 4) return;
        if (!dragged) { dragged = true; win.classList.add("is-dragging"); setMinimizedDragging(pillId, true); }
        const c = clampToViewport(r0.left + ev.clientX - sx, r0.top + ev.clientY - sy, r0.width, r0.height, window.innerWidth, window.innerHeight);
        win.style.left = `${c.left}px`;
        win.style.top = `${c.top}px`;
      };
      const onPillUp = (ev) => {
        titlebar.removeEventListener("pointermove", onPillMove);
        titlebar.removeEventListener("pointerup", onPillUp);
        titlebar.removeEventListener("pointercancel", onPillUp);
        win.classList.remove("is-dragging");
        if (!dragged) { if (ev.type === "pointerup") setMinimized(false); return; }
        const corner = cornerFromPoint(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight);
        writeCorner(MIN_CORNER_KEY, corner);
        win.dataset.corner = corner;
        setMinimizedCorner(pillId, corner); // glides via the stylesheet transition
      };
      titlebar.addEventListener("pointermove", onPillMove);
      titlebar.addEventListener("pointerup", onPillUp);
      titlebar.addEventListener("pointercancel", onPillUp);
      return;
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = rectOf(); // geometry before this drag: what "restore" returns to
    const grabRatio = clamp((e.clientX - win.getBoundingClientRect().left) / (win.offsetWidth || 1), 0.1, 0.9);
    let startLeft = win.offsetLeft;
    let startTop = win.offsetTop;
    let moved = false;
    titlebar.setPointerCapture?.(e.pointerId);

    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 4) return;
      if (!moved) {
        moved = true;
        if (state.maximized) {
          // Drag away from maximized: back to the old size, pointer keeps its place on the bar.
          const r = state.savedRect || origin;
          setMaximized(false);
          startLeft = Math.round(startX - r.width * grabRatio);
          startTop = 0;
        } else if (state.snapRestore) {
          const r = state.snapRestore;
          state.snapRestore = null;
          Object.assign(win.style, { width: `${r.w}px`, height: `${r.h}px` });
          startLeft = Math.round(startX - r.w * grabRatio);
        }
      }
      win.style.left = `${clamp(startLeft + ev.clientX - startX, -win.offsetWidth + 100, window.innerWidth - 100)}px`;
      win.style.top = `${clamp(startTop + ev.clientY - startY, 0, window.innerHeight - 40)}px`;
      const zone = aeroZone(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight);
      if (zone !== state.zone) { state.zone = zone; updatePreview(zone); }
    };
    const onUp = (ev) => {
      const zone = state.zone;
      state.zone = null;
      updatePreview(null);
      titlebar.removeEventListener("pointermove", onMove);
      titlebar.removeEventListener("pointerup", onUp);
      titlebar.removeEventListener("pointercancel", onUp);
      if (!zone || ev.type !== "pointerup") return;
      if (zone === "max") {
        setMaximized(true, origin);
      } else {
        if (!state.snapRestore) state.snapRestore = { w: origin.width, h: origin.height };
        const r = aeroRect(zone, window.innerWidth, window.innerHeight);
        animateTo(win, { left: r.l, top: r.t, width: r.w, height: r.h }); // glide, not teleport
      }
    };
    titlebar.addEventListener("pointermove", onMove);
    titlebar.addEventListener("pointerup", onUp);
    titlebar.addEventListener("pointercancel", onUp);
  });
  titlebar.addEventListener("dblclick", (e) => {
    if (e.target.closest(".ytw-controls") || state.minimized) return;
    state.snapRestore = null;
    toggleMax();
  });

  win.querySelectorAll(".ytw-resizer").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      const dir = handle.dataset.dir;
      if (e.button !== 0 || state.maximized) return;
      if (state.minimized && dir !== "e" && dir !== "w") return;
      e.preventDefault();
      e.stopPropagation();
      state.snapRestore = null;
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
  window.addEventListener("resize", onViewport);
  window.visualViewport?.addEventListener("resize", onViewport); // on-screen keyboard / rotation
  document.body.append(win);
  win.focus({ preventScroll: true });

  const api = { el: win, close };
  activeWindow = api;
  return api;
}

export const DESCRIPTION_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 11h16M4 16h10"/></svg>';
export const BACK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
export const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/** A toolbar button: icon + label. */
export function iconButton(className, iconSvg, label) {
  const b = el("button", className);
  b.type = "button";
  b.innerHTML = iconSvg;
  b.append(el("span", "", label));
  return b;
}

/**
 * The description side panel: header (icon, "الوصف", action button) + body.
 * `action` is {label, icon, onClick}: "العودة للقائمة" in the playlist window,
 * "إغلاق" in the video window. Returns the panel and a setter for its body.
 */
export function buildDescriptionPanel(action) {
  const panel = el("div", "ytw-desc-panel");
  const head = el("div", "ytw-side-head");
  const heading = iconButton("ytw-side-title", DESCRIPTION_ICON, "الوصف");
  heading.disabled = true;
  const act = iconButton("ytw-btn-ghost", action.icon, action.label);
  act.addEventListener("click", action.onClick);
  head.append(heading, act);
  const body = el("div", "ytw-desc-body");
  panel.append(head, body);
  return { panel, body, actionBtn: act };
}

/** Published date + description. The title is in the window bar; the channel,
 *  duration and the YouTube link are shown by the embedded player itself. */
export function buildInfo({ publishedAt, description }) {
  const wrap = el("div", "ytw-info");
  const date = formatPublished(publishedAt);
  if (date) wrap.append(el("div", "ytw-facts", `تاريخ النشر: ${date}`));
  wrap.append(el("div", "ytw-desc", String(description || "").trim() || "لا يوجد وصف لهذا الفيديو."));
  return wrap;
}

function buildVideoPane(item, videoId) {
  const pane = el("div", "ytw-playlist");
  const main = el("div", "ytw-split-main");
  if (isValidVideoId(videoId)) {
    const frame = el("div", "yt-embed ytw-video");
    const iframe = document.createElement("iframe");
    iframe.src = embedUrl(videoId);
    iframe.title = item?.meta?.title || "فيديو";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    frame.append(iframe);
    main.append(frame);
  } else {
    main.append(el("p", "yt-empty", "تعذّر تحديد الفيديو. قد يكون هذا العنصر تالفاً."));
  }

  const side = el("aside", "ytw-split-list");
  side.setAttribute("aria-label", "الوصف");
  const split = attachSplit(pane, main, side);
  const descBtn = iconButton("ytw-tool-btn", DESCRIPTION_ICON, "الوصف");
  descBtn.setAttribute("aria-expanded", "false");
  const toolbar = el("div", "ytw-toolbar");
  toolbar.append(descBtn);
  main.append(toolbar);

  const { panel, body } = buildDescriptionPanel({
    label: "إغلاق",
    icon: CLOSE_ICON,
    onClick: () => setOpen(false),
  });
  body.append(buildInfo({ publishedAt: item?.meta?.publishedAt, description: item?.meta?.description }));
  side.append(panel);

  function setOpen(on) {
    if (on) split.show(); else split.hide();
    descBtn.setAttribute("aria-expanded", String(on));
    descBtn.classList.toggle("is-active", on);
    if (!on) descBtn.focus({ preventScroll: true });
  }
  descBtn.addEventListener("click", () => setOpen(!split.isShown()));
  pane.append(main);
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

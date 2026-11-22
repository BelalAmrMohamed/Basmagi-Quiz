// =============================================================================
// public/src/features/home/youtube-playlist-window.js
// Playlist window for a saved «قائمة تشغيل» object: the player on one side and
// the ordered list on the other. It reuses the window frame from
// youtube-player-window.js. Plays through YouTube's privacy-enhanced embed.
// The list is the stored snapshot; nothing is fetched from YouTube here.
// =============================================================================

import {
  embedUrl,
  formatDurationSeconds,
  isAllowedThumbnailUrl,
  isValidVideoId,
} from "../../shared/youtube-rules.js";
import { openYoutubeWindow, buildInfo, buildDescriptionPanel, iconButton, DESCRIPTION_ICON, BACK_ICON } from "./youtube-player-window.js";
import { attachSplit } from "./youtube-split.js";
import { fetchVideoDetails } from "./youtube-library.js";
import { mapDetailsForInfo, readListHidden, writeListHidden } from "./youtube-window-utils.js";
import { describePlaylistCount } from "./local-youtube-playlist.js";

const LIST_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';
const IFRAME_ALLOW = "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** Opens a saved playlist object (meta.type "youtube_playlist") in the playlist window. */
export function openYoutubePlaylistWindow(entry) {
  const title = entry?.meta?.title || entry?.playlist?.title || "قائمة تشغيل";
  const items = (Array.isArray(entry?.playlist?.items) ? entry.playlist.items : [])
    .filter((it) => isValidVideoId(it?.videoId));
  let content;
  if (items.length) {
    content = buildPlaylistPane(entry, items);
  } else {
    content = el("div", "ytw-pane");
    content.append(el("p", "yt-empty", "لا توجد فيديوهات في هذه القائمة."));
  }
  openYoutubeWindow({ title, content, key: `playlist:${entry?.id || title}` });
}

function buildPlaylistPane(entry, items) {
  const listTitle = entry?.meta?.title || entry?.playlist?.title || "";

  const pane = el("div", "ytw-playlist");
  const main = el("div", "ytw-split-main");
  const side = el("aside", "ytw-split-list");
  side.setAttribute("aria-label", "محتويات القائمة");

  const frame = el("div", "yt-embed ytw-video");
  const iframe = document.createElement("iframe");
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allow = IFRAME_ALLOW;
  iframe.allowFullscreen = true;
  frame.append(iframe);

  const prev = el("button", "ytw-nav-btn", "السابق");
  const next = el("button", "ytw-nav-btn", "التالي");
  prev.type = "button";
  next.type = "button";
  const counter = el("span", "ytw-counter");
  const descBtn = iconButton("ytw-tool-btn", DESCRIPTION_ICON, "الوصف");
  descBtn.setAttribute("aria-expanded", "false");
  const listBtn = iconButton("ytw-tool-btn ytw-list-toggle", LIST_ICON, "إخفاء القائمة");
  listBtn.setAttribute("aria-keyshortcuts", "L");
  listBtn.setAttribute("aria-expanded", "true");
  const nav = el("div", "ytw-nav");
  nav.append(prev, counter, next, listBtn, descBtn);

  const current = el("div", "ytw-current");
  const currentTitle = el("h3", "ytw-current-title");
  currentTitle.dir = "auto";
  current.append(currentTitle);

  // Published date + description load on demand and are cached in memory only
  // (the stored snapshot stays small). `shown` guards against stale replies.
  const detailsCache = new Map();
  let shown = 0;
  let descOpen = false;
  const descBodyHolder = { body: null };
  async function renderInfo(it) {
    if (!descOpen || !descBodyHolder.body) return;
    const target = descBodyHolder.body;
    const token = ++shown;
    const paint = (node) => {
      if (token === shown) target.replaceChildren(node);
    };
    if (detailsCache.has(it.videoId)) return paint(buildInfo(detailsCache.get(it.videoId)));
    paint(el("div", "ytw-facts", "جارٍ تحميل الوصف…"));
    try {
      const d = (await fetchVideoDetails([it.videoId])).get(it.videoId);
      const info = mapDetailsForInfo(d);
      detailsCache.set(it.videoId, info);
      paint(buildInfo(info));
    } catch {
      paint(el("div", "ytw-facts", "تعذّر تحميل الوصف."));
    }
  }

  const listHead = el("div", "ytw-list-head");
  listHead.append(
    el("p", "ytw-list-title", listTitle),
    el("p", "ytw-facts", describePlaylistCount(entry)),
  );

  const list = el("ol", "ytw-list");
  const rows = items.map((it, i) => {
    const li = el("li");
    const btn = el("button", "ytw-row");
    btn.type = "button";
    btn.setAttribute("aria-label", `${i + 1}. ${it.title}`);
    btn.append(el("span", "ytw-row-num", String(i + 1)));
    if (isAllowedThumbnailUrl(it.thumbnailUrl)) {
      const img = el("img", "ytw-row-thumb");
      img.src = it.thumbnailUrl;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      btn.append(img);
    }
    const info = el("span", "ytw-row-info");
    info.append(el("span", "ytw-row-title", it.title));
    const duration = formatDurationSeconds(it.durationSeconds);
    if (duration) info.append(el("span", "ytw-row-meta", duration));
    btn.append(info);
    btn.addEventListener("click", () => show(i, true));
    li.append(btn);
    list.append(li);
    return btn;
  });

  let index = 0;
  function show(i, userAction = false) {
    index = Math.min(Math.max(i, 0), items.length - 1);
    const it = items[index];
    iframe.src = embedUrl(it.videoId) + (userAction ? "?autoplay=1" : "");
    iframe.title = it.title;
    currentTitle.textContent = it.title;

    renderInfo(it);

    counter.textContent = `${index + 1} / ${items.length}`;
    prev.disabled = index === 0;
    next.disabled = index === items.length - 1;
    rows.forEach((b, n) => {
      if (n === index) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    if (userAction) rows[index].scrollIntoView({ block: "nearest" });
  }

  prev.addEventListener("click", () => show(index - 1, true));
  next.addEventListener("click", () => show(index + 1, true));

  const listView = el("div", "ytw-list-view");
  listView.append(listHead, list);
  const { panel: descPanel, body: descBody } = buildDescriptionPanel({
    label: "العودة للقائمة",
    icon: BACK_ICON,
    onClick: () => setDescription(false),
  });
  descBodyHolder.body = descBody;

  function setDescription(on) {
    descOpen = on;
    side.replaceChildren(on ? descPanel : listView);
    if (on) split.show();            // the description needs the side pane, even while the list is hidden
    else if (listHidden) split.hide();
    descBtn.setAttribute("aria-expanded", String(on));
    descBtn.classList.toggle("is-active", on);
    if (on) renderInfo(items[index]);
    else rows[index]?.scrollIntoView({ block: "nearest" });
  }
  descBtn.addEventListener("click", () => setDescription(!descOpen));

  main.append(frame, nav, current);
  side.append(listView);
  pane.append(main);

  // Hide / show the list without touching the iframe (playback keeps running): only the side pane
  // and divider leave the layout; the video column simply takes the full width.
  let listHidden = readListHidden(undefined, window.innerWidth <= 640);
  function setListHidden(hide, persist = true) {
    listHidden = hide;
    if (hide && !descOpen) split.hide();
    else if (!hide) split.show();
    const label = "القائمة";
    listBtn.setAttribute("aria-expanded", String(!hide));
    listBtn.classList.toggle("is-active", hide);
    listBtn.querySelector("span").textContent = label;
    listBtn.title = label;
    if (persist) writeListHidden(hide);
    if (!hide) rows[index]?.scrollIntoView({ block: "nearest" });
  }
  listBtn.addEventListener("click", () => setListHidden(!listHidden));
  pane.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "l" || e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea")) return;
    e.preventDefault();
    setListHidden(!listHidden);
  });
  const split = attachSplit(pane, main, side);
  setListHidden(listHidden, false);
  show(0);
  return pane;
}

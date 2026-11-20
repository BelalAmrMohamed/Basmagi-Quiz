// =============================================================================
// public/src/features/home/youtube-video-modal.js
// «فيديو يوتيوب» import modal for محتواي (its own markup and styles, not the
// create-quiz/lesson/notebook shell) plus the in-app player for saved videos.
//
// Flow: search YouTube OR paste a video/playlist URL → preview (privacy-enhanced
// embed + metadata) → save to محتواي. Playlists load page by page; the user
// selects which videos to save. Nothing is downloaded or rehosted.
// Server calls go only through /api/youtube (the API key stays on the server).
// =============================================================================

import {
  YOUTUBE_LIMITS,
  parseYoutubeInput,
  embedUrl,
  canonicalWatchUrl,
  formatDurationSeconds,
  isAllowedThumbnailUrl,
  isValidVideoId,
  validateSearchQuery,
} from "../../shared/youtube-rules.js";
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { _confirm, showNotification } from "../../components/notifications/notifications.js";
import { currentFolderId } from "./user-content-folders.js";
import { renderUserContentView } from "./user-content-view.js";
import { buildLocalYoutubeVideoEntry, findSameLevelVideoDuplicate } from "./local-youtube-video.js";
import { channelLinkEl, formatPublished, openYoutubeVideoPlayer } from "./youtube-player-window.js";
import { findSameLevelPlaylistDuplicate } from "./local-youtube-playlist.js";
import { removeHistory, sortHistoryNewestFirst, YOUTUBE_HISTORY_KEY } from "./local-youtube-history.js";
import { findLibraryItem, metaFromDetails, readHistory, readUserItems, saveVideoRefs, saveWholePlaylist, ytApi } from "./youtube-library.js";
import { openYoutubePlaylistWindow } from "./youtube-playlist-window.js";

const SEARCH_DEBOUNCE_MS = 450;
const MIN_QUERY_LENGTH = 2;

// ── helpers ─────────────────────────────────────────────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** True for pasted links (not for plain search words, and not for bare 11-char IDs). */
function looksLikeYoutubeLink(text) {
  return /youtu|:\/\//i.test(String(text || ""));
}

function thumb(url, className) {
  const wrap = el("div", className);
  if (isAllowedThumbnailUrl(url)) {
    const img = el("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    wrap.append(img);
  } else {
    wrap.append(el("span", "yt-thumb-fallback", "▶"));
  }
  return wrap;
}

const HISTORY_EVENT_LABELS = { added: "أُضيف إلى «محتواي»", published: "نُشر" };

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}

// ── modal ───────────────────────────────────────────────────────────────────

let activeOverlay = null;

export function openYoutubeVideoModal() {
  if (activeOverlay) return;
  const returnFocus = document.activeElement;

  const overlay = el("div", "yt-modal-overlay");
  const dialog = el("div", "yt-modal");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "yt-modal-title");
  overlay.append(dialog);

  const header = el("header", "yt-modal__header");
  const title = el("h2", "yt-modal__title", "إضافة فيديو يوتيوب");
  title.id = "yt-modal-title";
  const closeBtn = el("button", "yt-modal__close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "إغلاق");
  header.append(title, closeBtn);

  const tabs = el("div", "yt-modal__tabs");
  tabs.setAttribute("role", "tablist");
  const tabSearch = el("button", "yt-tab is-active", "بحث في يوتيوب");
  const tabUrl = el("button", "yt-tab", "لصق رابط");
  const tabHistory = el("button", "yt-tab", "السجل");
  for (const t of [tabSearch, tabUrl, tabHistory]) {
    t.type = "button";
    t.setAttribute("role", "tab");
  }
  tabs.append(tabSearch, tabUrl, tabHistory);

  const status = el("div", "yt-modal__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const body = el("div", "yt-modal__body");
  dialog.append(header, tabs, status, body);
  document.body.append(overlay);
  activeOverlay = overlay;

  let mode = "search";
  let searchSeq = 0;
  let viewSeq = 0; // guards preview/playlist loads against tab switches
  let searchTimer = null;
  let search = { query: "", items: [], nextPageToken: null, loading: false };
  let playlist = null; // { info, items: [{videoId,title,thumbnailUrl,unavailable,checked}], nextPageToken, loading }
  let preview = null;  // { videoId, details } when previewing one video

  const setStatus = (msg, kind = "info") => {
    status.textContent = msg || "";
    status.dataset.kind = kind;
  };

  const close = () => {
    clearTimeout(searchTimer);
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    activeOverlay = null;
    if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus();
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  };
  document.addEventListener("keydown", onKey, true);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });

  const setTab = (next) => {
    clearTimeout(searchTimer);
    searchSeq++;   // drop any search still in flight from the previous tab
    viewSeq++;     // drop any preview/playlist load still in flight
    mode = next;
    preview = null;
    playlist = null;
    tabSearch.classList.toggle("is-active", next === "search");
    tabUrl.classList.toggle("is-active", next === "url");
    tabHistory.classList.toggle("is-active", next === "history");
    tabSearch.setAttribute("aria-selected", String(next === "search"));
    tabUrl.setAttribute("aria-selected", String(next === "url"));
    tabHistory.setAttribute("aria-selected", String(next === "history"));
    setStatus("");
    render();
  };
  tabSearch.addEventListener("click", () => setTab("search"));
  tabUrl.addEventListener("click", () => setTab("url"));
  tabHistory.addEventListener("click", () => setTab("history"));

  // ── views ────────────────────────────────────────────────────────────────

  function render() {
    dialog.classList.toggle("yt-modal--wide", Boolean(preview));
    body.replaceChildren();
    if (preview) return renderPreview();
    if (playlist) return renderPlaylist();
    if (mode === "history") return renderHistory();
    if (mode === "search") return renderSearch();
    return renderUrl();
  }

  function renderSearch() {
    const row = el("div", "yt-search-row");
    const input = el("input", "yt-input");
    input.type = "search";
    input.placeholder = "ابحث عن فيديو…";
    input.maxLength = YOUTUBE_LIMITS.searchQueryMax;
    input.setAttribute("aria-label", "عبارة البحث في يوتيوب");
    input.value = search.query;
    const go = el("button", "yt-btn yt-btn--primary", "بحث");
    go.type = "button";
    row.append(input, go);
    body.append(row);

    const results = el("div", "yt-results");
    results.setAttribute("aria-live", "polite");
    body.append(results);

    const runSearch = async (query, pageToken) => {
      if (!looksLikeYoutubeLink(query)) {
        const check = validateSearchQuery(query);
        if (!check.ok) {
          searchSeq++;
          setStatus(check.message, "error");
          return;
        }
      }
      if (looksLikeYoutubeLink(query)) {
        const parsed = parseYoutubeInput(query);
        if (parsed.kind === "video") return openPreview(parsed.videoId);
        if (parsed.kind === "playlist") return openPlaylist(parsed.playlistId);
        setStatus("الرابط غير مدعوم. تأكد أنه رابط يوتيوب صحيح.", "error");
        return;
      }
      const seq = ++searchSeq;
      search.loading = true;
      if (!pageToken) search.items = [];
      renderResults(results, search, pageToken ? "more" : "first");
      try {
        const data = await ytApi({ action: "search", q: query, ...(pageToken ? { pageToken } : {}) });
        if (seq !== searchSeq || mode !== "search") return;
        search = {
          query,
          items: pageToken ? [...search.items, ...data.items] : data.items,
          nextPageToken: data.nextPageToken,
          loading: false,
        };
        renderResults(results, search, "done");
      } catch (err) {
        if (seq !== searchSeq || mode !== "search") return;
        search.loading = false;
        renderResults(results, search, "done");
        setStatus(err.message, "error");
      }
    };

    const queue = () => {
      clearTimeout(searchTimer);
      const query = input.value.trim();
      search.query = input.value;
      if (looksLikeYoutubeLink(query)) {
        // Wait for Enter/click on a link instead of searching for it.
        searchSeq++;
        renderResults(results, { items: [], nextPageToken: null, loading: false }, "idle");
        return;
      }
      if (query.length < MIN_QUERY_LENGTH) {
        searchSeq++;
        search = { query: input.value, items: [], nextPageToken: null, loading: false };
        renderResults(results, search, "idle");
        return;
      }
      searchTimer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
    };
    input.addEventListener("input", queue);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchTimer); runSearch(input.value.trim()); }
    });
    go.addEventListener("click", () => { clearTimeout(searchTimer); runSearch(input.value.trim()); });

    renderResults(results, search, "idle");
    setTimeout(() => input.focus(), 0);
  }

  function renderResults(container, state, phase) {
    container.replaceChildren();
    if (phase === "idle" && !state.items.length) {
      container.append(el("p", "yt-empty", "اكتب عبارة للبحث في يوتيوب (حرفان على الأقل)."));
      return;
    }
    if (phase === "first" && state.loading) {
      container.append(el("p", "yt-empty", "جاري البحث…"));
      return;
    }
    if (state.items.length === 0 && phase === "done") {
      container.append(el("p", "yt-empty", "لا توجد نتائج لهذا البحث. جرّب عبارة أخرى."));
      return;
    }
    const list = el("ul", "yt-list");
    for (const v of state.items) {
      const li = el("li", "yt-row");
      const info = el("div", "yt-row__info");
      info.append(el("span", "yt-row__title", v.title));
      info.append(el("span", "yt-row__meta", v.channelTitle));
      const preview = el("button", "yt-btn yt-btn--ghost", "معاينة");
      preview.type = "button";
      preview.setAttribute("aria-label", `معاينة ${v.title}`);
      preview.addEventListener("click", () => openPreview(v.videoId));
      li.append(thumb(v.thumbnailUrl, "yt-row__thumb"), info, preview);
      list.append(li);
    }
    container.append(list);
    if (state.nextPageToken) {
      const more = el("button", "yt-btn yt-btn--ghost yt-more", state.loading ? "جاري التحميل…" : "تحميل المزيد");
      more.type = "button";
      more.disabled = state.loading;
      more.addEventListener("click", () => {
        const q = state.query.trim();
        // Re-run for the next page without losing the current query.
        runNextSearchPage(q, state.nextPageToken, container);
      });
      container.append(more);
    }
  }

  async function runNextSearchPage(q, pageToken, container) {
    const seq = ++searchSeq;
    search.loading = true;
    renderResults(container, search, "more");
    try {
      const data = await ytApi({ action: "search", q, pageToken });
      if (seq !== searchSeq || mode !== "search") return;
      search = { query: q, items: [...search.items, ...data.items], nextPageToken: data.nextPageToken, loading: false };
      renderResults(container, search, "done");
    } catch (err) {
      if (seq !== searchSeq || mode !== "search") return;
      search.loading = false;
      renderResults(container, search, "done");
      setStatus(err.message, "error");
    }
  }

  function renderHistory() {
    const log = sortHistoryNewestFirst(readHistory());
    const head = el("div", "yt-playlist-head");
    head.append(el("h3", "yt-preview-title", "سجل الاستيراد"));
    head.append(el("p", "yt-preview-facts", "الفيديوهات والقوائم التي أضفتها إلى «محتواي»، ومتى أضفتها."));
    body.append(head);

    if (log.length === 0) {
      body.append(el("p", "yt-empty", "لا توجد أحداث بعد. ستظهر هنا الفيديوهات والقوائم التي تضيفها."));
      return;
    }

    const bar = el("div", "yt-actions yt-actions--start");
    const clear = el("button", "yt-btn yt-btn--ghost", "مسح السجل كله");
    clear.type = "button";
    clear.addEventListener("click", async () => {
      const ok = await _confirm("مسح سجل الاستيراد؟ لن تُحذف أي عناصر من «محتواي».");
      if (!ok) return;
      setInStorage(YOUTUBE_HISTORY_KEY, "[]");
      render();
    });
    bar.append(clear);
    body.append(bar);

    const list = el("ul", "yt-list");
    for (const ev of log) {
      const li = el("li", "yt-row");
      const libItem = findLibraryItem(ev.itemId);
      const info = el("div", "yt-row__info");
      info.append(el("span", "yt-row__title", ev.title));
      const meta = [
        HISTORY_EVENT_LABELS[ev.event],
        ev.kind === "playlist" ? "قائمة تشغيل" : "فيديو",
        formatWhen(ev.at),
        libItem ? "" : "حُذف من «محتواي»",
      ].filter(Boolean).join(" · ");
      info.append(el("span", "yt-row__meta", meta));

      const actions = el("div", "yt-actions");
      if (libItem) {
        const open = el("button", "yt-btn yt-btn--ghost", "فتح");
        open.type = "button";
        open.addEventListener("click", () => {
          close();
          if (libItem.meta?.type === "youtube_playlist") openYoutubePlaylistWindow(libItem);
          else openYoutubeVideoPlayer(libItem);
        });
        actions.append(open);
      }
      const remove = el("button", "yt-btn yt-btn--ghost", "إزالة من السجل");
      remove.type = "button";
      remove.addEventListener("click", () => {
        setInStorage(YOUTUBE_HISTORY_KEY, JSON.stringify(removeHistory(readHistory(), ev.id)));
        render();
      });
      actions.append(remove);

      li.append(info, actions);
      list.append(li);
    }
    body.append(list);
  }

  function renderUrl() {
    const row = el("div", "yt-search-row");
    const input = el("input", "yt-input");
    input.type = "url";
    input.inputMode = "url";
    input.placeholder = "الصق رابط فيديو أو قائمة تشغيل من يوتيوب";
    input.setAttribute("aria-label", "رابط يوتيوب");
    const go = el("button", "yt-btn yt-btn--primary", "تحميل");
    go.type = "button";
    row.append(input, go);
    const hint = el("p", "yt-hint", "يقبل: youtube.com/watch?v=…، youtu.be/…، Shorts، وروابط قوائم التشغيل.");
    body.append(row, hint);

    const submit = () => {
      const parsed = parseYoutubeInput(input.value);
      if (parsed.kind === "video") return openPreview(parsed.videoId);
      if (parsed.kind === "playlist") return openPlaylist(parsed.playlistId);
      setStatus("الرابط غير مدعوم. تأكد أنه رابط يوتيوب صحيح.", "error");
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    setTimeout(() => input.focus(), 0);
  }

  async function openPreview(videoId) {
    const my = ++viewSeq;
    setStatus("جاري تحميل تفاصيل الفيديو…");
    try {
      const data = await ytApi({ action: "video", ids: videoId });
      if (my !== viewSeq) return;
      const details = data.items?.[0];
      if (!details) {
        setStatus("هذا الفيديو غير متاح (محذوف أو خاص أو غير موجود).", "error");
        return;
      }
      preview = { videoId, details };
      setStatus("");
      render();
    } catch (err) {
      if (my === viewSeq) setStatus(err.message, "error");
    }
  }

  function renderPreview() {
    const { videoId, details } = preview;
    const blocked = details.embeddable === false
      ? "لا يمكن تشغيل هذا الفيديو داخل الموقع (مغلق للتضمين)."
      : "";

    const back = el("button", "yt-btn yt-btn--ghost", "← رجوع");
    back.type = "button";
    back.addEventListener("click", () => { preview = null; setStatus(""); render(); });
    body.append(back);

    const frame = el("div", "yt-embed");
    const iframe = document.createElement("iframe");
    iframe.src = embedUrl(videoId);
    iframe.title = details.title || "معاينة فيديو يوتيوب";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    frame.append(iframe);
    body.append(frame);

    const info = el("div", "yt-preview-info");
    info.append(el("h3", "yt-preview-title", details.title));
    const channel = channelLinkEl(details.channelId, details.channelTitle);
    if (channel) info.append(channel);
    const facts = [formatDurationSeconds(details.durationSeconds), formatPublished(details.publishedAt)]
      .filter(Boolean)
      .join(" · ");
    if (facts) info.append(el("p", "yt-preview-facts", facts));
    if (details.description) info.append(el("p", "yt-preview-desc yt-preview-desc--full", details.description));
    const link = el("a", "yt-link", "فتح على يوتيوب");
    link.href = canonicalWatchUrl(videoId);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    info.append(link);
    body.append(info);

    if (blocked) setStatus(blocked, "error");

    const actions = el("div", "yt-actions");
    const save = el("button", "yt-btn yt-btn--primary", "حفظ إلى محتواي");
    save.type = "button";
    save.disabled = Boolean(blocked);
    save.addEventListener("click", () => {
      try {
        const result = saveVideoRefs([{ videoId, meta: metaFromDetails(details), title: details.title }], currentFolderId || null);
        finish(result);
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
    actions.append(save);
    body.append(actions);
  }

  async function openPlaylist(playlistId) {
    const my = ++viewSeq;
    setStatus("جاري تحميل قائمة التشغيل…");
    playlist = { info: null, items: [], nextPageToken: null, loading: true, playlistId };
    try {
      const data = await ytApi({ action: "playlist", id: playlistId });
      if (my !== viewSeq) return;
      playlist = {
        playlistId,
        info: data.playlist,
        items: data.items.map(toPlaylistRow),
        nextPageToken: data.nextPageToken,
        loading: false,
      };
      setStatus("");
      render();
    } catch (err) {
      if (my !== viewSeq) return;
      playlist = null;
      setStatus(err.message, "error");
    }
  }

  function toPlaylistRow(it) {
    return {
      videoId: it.videoId,
      title: it.title || "فيديو غير متاح",
      thumbnailUrl: it.thumbnailUrl,
      unavailable: Boolean(it.unavailable),
      checked: false,
    };
  }

  function renderPlaylist() {
    const back = el("button", "yt-btn yt-btn--ghost", "← رجوع");
    back.type = "button";
    back.addEventListener("click", () => { playlist = null; setStatus(""); render(); });
    body.append(back);

    const head = el("div", "yt-playlist-head");
    head.append(el("h3", "yt-preview-title", playlist.info?.title || "قائمة تشغيل"));
    if (playlist.info?.channelTitle) head.append(el("p", "yt-preview-facts", playlist.info.channelTitle));
    const loaded = playlist.items.length;
    const total = playlist.info?.itemCount || loaded;
    head.append(el("p", "yt-preview-facts",
      `تم تحميل ${loaded} من أصل ${total} فيديو${playlist.nextPageToken ? " — لم يكتمل التحميل بعد" : ""}`));
    body.append(head);

    const whole = el("div", "yt-actions yt-actions--start");
    const wholeBtn = el("button", "yt-btn yt-btn--primary", "إضافة القائمة كبطاقة واحدة");
    wholeBtn.type = "button";
    wholeBtn.id = "yt-save-whole-playlist";
    wholeBtn.disabled = playlist.loading || playlist.items.length === 0;
    wholeBtn.addEventListener("click", importWholePlaylist);
    whole.append(wholeBtn);
    body.append(whole);

    const bulk = el("div", "yt-actions yt-actions--start");
    const all = el("button", "yt-btn yt-btn--ghost", "تحديد الكل");
    const none = el("button", "yt-btn yt-btn--ghost", "إلغاء التحديد");
    all.type = none.type = "button";
    all.addEventListener("click", () => {
      const existing = readUserItems();
      playlist.items.forEach((r) => { if (!r.unavailable && !isDuplicateHere(r, existing)) r.checked = true; });
      render();
    });
    none.addEventListener("click", () => { playlist.items.forEach((r) => (r.checked = false)); render(); });
    bulk.append(all, none);
    body.append(bulk);

    const list = el("ul", "yt-list yt-list--checks");
    const existing = readUserItems();
    playlist.items.forEach((row, idx) => {
      const li = el("li", "yt-row");
      const dup = isDuplicateHere(row, existing);
      const disabled = row.unavailable || dup;
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = row.checked && !disabled;
      cb.disabled = disabled;
      cb.id = `yt-pl-${idx}`;
      const label = el("label", "yt-row__info");
      label.htmlFor = cb.id;
      label.append(el("span", "yt-row__title", row.title));
      if (row.unavailable) label.append(el("span", "yt-row__meta", "غير متاح (محذوف أو خاص)"));
      else if (dup) label.append(el("span", "yt-row__meta", "موجود بالفعل في هذا المستوى"));
      cb.addEventListener("change", () => { row.checked = cb.checked; updateSaveCount(); });
      li.append(cb, thumb(row.thumbnailUrl, "yt-row__thumb"), label);
      list.append(li);
    });
    body.append(list);

    if (playlist.nextPageToken) {
      const more = el("button", "yt-btn yt-btn--ghost yt-more", playlist.loading ? "جاري التحميل…" : "تحميل المزيد من القائمة");
      more.type = "button";
      more.addEventListener("click", loadMorePlaylist);
      body.append(more);
    }

    const actions = el("div", "yt-actions");
    const save = el("button", "yt-btn yt-btn--primary", "حفظ المحدد");
    save.type = "button";
    save.id = "yt-save-playlist";
    save.addEventListener("click", importSelectedPlaylistItems);
    actions.append(save);
    body.append(actions);
    updateSaveCount();
  }

  // Reads the library once per call; rows pass it through to avoid re-parsing per row.
  function isDuplicateHere(row, existing = readUserItems()) {
    return Boolean(row.videoId && findSameLevelVideoDuplicate(existing, row.videoId, currentFolderId || null));
  }

  function updateSaveCount() {
    const save = body.querySelector("#yt-save-playlist");
    if (!save) return;
    const existing = readUserItems();
    const n = playlist.items.filter((r) => r.checked && !r.unavailable && !isDuplicateHere(r, existing)).length;
    save.textContent = n ? `حفظ المحدد (${n})` : "حفظ المحدد";
    save.disabled = n === 0;
  }

  async function loadMorePlaylist() {
    if (!playlist?.nextPageToken || playlist.loading) return;
    playlist.loading = true;
    render();
    try {
      const data = await ytApi({ action: "playlist", id: playlist.playlistId, pageToken: playlist.nextPageToken });
      playlist.items = [...playlist.items, ...data.items.map(toPlaylistRow)];
      playlist.nextPageToken = data.nextPageToken;
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      playlist.loading = false;
      render();
    }
  }

  // Whole-playlist import (plan B2). The modal's page loop fills `playlist.items`,
  // then the shared helper fetches durations and stores ONE playlist object.
  async function importWholePlaylist() {
    if (!playlist || playlist.loading) return;
    const parentId = currentFolderId || null;
    if (findSameLevelPlaylistDuplicate(readUserItems(), playlist.playlistId, parentId)) {
      setStatus("قائمة التشغيل موجودة بالفعل في هذا المستوى.", "error");
      return;
    }
    const btn = body.querySelector("#yt-save-whole-playlist");
    if (btn) { btn.disabled = true; btn.textContent = "جاري الحفظ…"; }
    playlist.loading = true;
    try {
      const total = playlist.info?.itemCount || 0;
      while (playlist.nextPageToken && playlist.items.length < YOUTUBE_LIMITS.playlistItemsMax) {
        setStatus(`جاري تحميل القائمة (${playlist.items.length} من أصل ${total})…`);
        const data = await ytApi({ action: "playlist", id: playlist.playlistId, pageToken: playlist.nextPageToken });
        playlist.items = [...playlist.items, ...data.items.map(toPlaylistRow)];
        playlist.nextPageToken = data.nextPageToken;
      }
      setStatus("جاري جلب مدة الفيديوهات…");
      await saveWholePlaylist({ playlistId: playlist.playlistId, info: playlist.info, rows: playlist.items, parentId });
      finish({ saved: 1, skipped: [], playlist: true });
    } catch (err) {
      setStatus(err.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "إضافة القائمة كبطاقة واحدة"; }
    } finally {
      if (playlist) playlist.loading = false;
    }
  }

  async function importSelectedPlaylistItems() {
    const existing = readUserItems();
    const chosen = playlist.items.filter((r) => r.checked && !r.unavailable && !isDuplicateHere(r, existing));
    if (chosen.length === 0) return;
    if (chosen.length > YOUTUBE_LIMITS.playlistItemsMax) {
      setStatus(`الحد الأقصى ${YOUTUBE_LIMITS.playlistItemsMax} فيديو في المرة الواحدة. قلّل التحديد.`, "error");
      return;
    }

    const save = body.querySelector("#yt-save-playlist");
    if (save) { save.disabled = true; save.textContent = "جاري الحفظ…"; }
    setStatus("جاري جلب تفاصيل الفيديوهات المحددة…");

    try {
      // Details (duration, description, embeddable) are fetched only for chosen items.
      const detailsById = new Map();
      const ids = chosen.map((r) => r.videoId);
      for (let i = 0; i < ids.length; i += YOUTUBE_LIMITS.detailBatchMax) {
        const data = await ytApi({ action: "video", ids: ids.slice(i, i + YOUTUBE_LIMITS.detailBatchMax).join(",") });
        for (const d of data.items || []) detailsById.set(d.videoId, d);
      }

      const refs = chosen.map((r) => {
        const d = detailsById.get(r.videoId);
        if (!d) return { videoId: r.videoId, title: r.title, blockedReason: "غير متاح الآن" };
        if (d.embeddable === false) return { videoId: r.videoId, title: d.title, blockedReason: "مغلق للتضمين" };
        return { videoId: r.videoId, title: d.title, meta: metaFromDetails(d), playlistId: playlist.playlistId };
      });

      const result = saveVideoRefs(refs, currentFolderId || null);
      finish(result);
    } catch (err) {
      setStatus(err.message, "error");
      updateSaveCount();
    }
  }

  function finish({ saved, skipped, playlist: wholePlaylist = false }) {
    close();
    renderUserContentView();
    const lines = [];
    if (saved && wholePlaylist) lines.push("تمت إضافة قائمة التشغيل كبطاقة واحدة إلى «محتواي».");
    else if (saved) lines.push(`تم حفظ ${saved} ${saved === 1 ? "فيديو" : "فيديوهات"} في «محتواي».`);
    if (skipped.length) lines.push(`تم تخطي ${skipped.length}: ${skipped.slice(0, 2).join("، ")}${skipped.length > 2 ? "…" : ""}`);
    showNotification(saved ? "تم الحفظ" : "لم يُحفظ شيء", lines.join("\n") || "لا توجد عناصر جديدة للحفظ.", saved ? "success" : "warning");
  }

  // Prepares initial state and shows the search tab.
  render();
}

export { openYoutubeVideoPlayer };

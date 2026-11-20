// =============================================================================
// public/src/features/home/youtube-publish-modal.js
// Admin only: publish saved YouTube items («فيديو» / «قائمة تشغيل») from
// «محتواي» to a subject (and optional subfolder) of the platform, and manage
// what is already published. Placement follows the lesson wizard: the
// subject's id plus an optional folder path; the server re-validates both.
// Metadata comes from the saved item (already fetched through /api/youtube),
// so the admin's browser is the only place the YouTube data is handled.
// =============================================================================

import { apiUrl } from "../../shared/api-base.js";
import { getToken, isAdminAuthenticated, signOut } from "../../shared/adminAuth.js";
import { getManifest } from "../../shared/quizManifest.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { buildHistoryEvent } from "./local-youtube-history.js";
import { recordHistory } from "./youtube-library.js";
import { UPLOAD_ICON_SVG } from "./icons.js";

const YEAR = { 1: "السنة الأولى", 2: "السنة الثانية", 3: "السنة الثالثة", 4: "السنة الرابعة", 5: "السنة الخامسة", 6: "السنة السادسة" };
const TERM = { 1: "الترم الأول", 2: "الترم الثاني", 3: "الترم الثالث" };

let overlay = null;

// Last publish destination, remembered per browser like the main upload form.
const LAST_KEY = "bq-youtube-publish-last";
const SELECT_KEYS = ["type", "college", "year", "term", "subject", "folder"];
function readLast() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
function writeLast(values) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(values));
  } catch {
    /* storage blocked: the choice just isn't remembered */
  }
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function option(value, label) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}

async function adminCall(payload) {
  const token = getToken();
  if (!token) {
    signOut();
    throw new Error("انتهت الجلسة. يرجى تسجيل الدخول مجددًا.");
  }
  const res = await fetch(apiUrl("/api/admin"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(body.error || `فشل الطلب (${res.status})`);
  return body;
}

/** The request body for one saved item (pure; also used by the tests). */
export function buildPublishBody(entry, courseId, folderPath) {
  const base = { action: "publish-youtube", courseId, folderPath };
  if (entry?.meta?.type === "youtube_playlist") {
    const p = entry.playlist || {};
    return {
      ...base,
      kind: "playlist",
      playlistId: p.id || entry.meta.playlistId,
      playlist: { id: p.id || entry.meta.playlistId, title: p.title || entry.meta.title, channelTitle: p.channelTitle || entry.meta.channelTitle, itemCount: p.itemCount },
      items: Array.isArray(p.items) ? p.items : [],
      partial: Boolean(p.partial),
    };
  }
  return {
    ...base,
    kind: "video",
    youtubeId: entry?.meta?.youtubeId || entry?.video?.videoId,
    meta: { ...entry?.meta, durationSeconds: entry?.stats?.durationSeconds ?? entry?.video?.durationSeconds ?? null },
  };
}

/** Subjects the admin can publish into, filtered by the chosen path. */
export function filterSubjects(subjects, { type, college, year, term }) {
  return (subjects || []).filter((s) =>
    s?.id && s.education_type === type &&
    (type !== "University" || !college || s.faculty === college) &&
    (!year || String(s.year) === year) && (!term || String(s.term) === term));
}

function uniq(list) { return [...new Set(list.filter((v) => v !== null && v !== undefined && v !== ""))]; }

function close() {
  overlay?.remove();
  overlay = null;
  document.body.style.overflow = "";
}

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  path: svg('<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>'),
  college: svg('<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c3 2 9 2 12 0v-4.5"/>'),
  year: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  term: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  subject: svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  review: svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>'),
  next: svg('<path d="M15 6l-6 6 6 6"/>'),
  back: svg('<path d="M9 6l6 6-6 6"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>'),
  video: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>'),
};

function icon(name, cls = "ytp-ic") {
  const s = el("span", cls);
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = I[name];
  return s;
}

function field(iconName, label, select, hint) {
  const wrap = el("label", "ytp-field");
  const head = el("span", "ytp-label");
  head.append(icon(iconName), document.createTextNode(label));
  wrap.append(head, select);
  if (hint) wrap.append(el("span", "ytp-hint", hint));
  return wrap;
}

function button(kind, iconName, label) {
  const b = el("button", `ytp-btn ytp-btn--${kind}`);
  b.type = "button";
  b.append(icon(iconName), el("span", "", label));
  return b;
}

const STEPS = [
  { id: "path", icon: "path", title: "المسار" },
  { id: "subject", icon: "subject", title: "المادة" },
  { id: "folder", icon: "folder", title: "المجلد" },
  { id: "review", icon: "review", title: "مراجعة ونشر" },
];

export function buildPublishTab(entries, subjects, onDone) {
  const pane = el("div", "ytp-pane");
  const sel = {
    type: el("select", "ytp-input"), college: el("select", "ytp-input"),
    year: el("select", "ytp-input"), term: el("select", "ytp-input"),
    subject: el("select", "ytp-input"), folder: el("select", "ytp-input"),
  };
  let step = 0;
  let busy = false;

  const stepper = el("ol", "ytp-stepper");
  const stepEls = STEPS.map((st, i) => {
    const li = el("li", "ytp-step");
    const dot = el("span", "ytp-step-dot");
    dot.append(icon(st.icon));
    li.append(dot, el("span", "ytp-step-title", st.title));
    stepper.append(li);
    return li;
  });
  const panel = el("div", "ytp-panel");
  const message = el("div", "ytp-msg");
  message.setAttribute("role", "alert");
  message.hidden = true;
  const back = button("ghost", "back", "السابق");
  const next = button("primary", "next", "التالي");
  const publish = button("primary", "upload", "نشر على المنصة");
  const actions = el("div", "ytp-actions");
  actions.append(back, next, publish);
  pane.append(stepper, panel, message, actions);

  const fill = (select, placeholder, values, label = (v) => v) => {
    const prev = select.value;
    select.replaceChildren(option("", placeholder), ...values.map((v) => option(v, label(v))));
    if (values.includes(prev)) select.value = prev;
  };
  const state = () => ({ type: sel.type.value, college: sel.college.value, year: sel.year.value, term: sel.term.value });

  const collegeField = field("college", "الكلية", sel.college);
  function refresh(from) {
    const st = state();
    if (from === "type") {
      fill(sel.college, "— اختر الكلية —", uniq(subjects.filter((s) => s.education_type === st.type).map((s) => s.faculty)).sort());
      collegeField.hidden = st.type !== "University";
    }
    const pool = filterSubjects(subjects, { type: st.type, college: st.college });
    if (from === "type" || from === "college") fill(sel.year, "— كل السنوات —", uniq(pool.map((s) => String(s.year))).sort(), (v) => YEAR[v] || `سنة ${v}`);
    if (!["term", "subject", "folder"].includes(from)) {
      fill(sel.term, "— كل الأترام —", uniq(filterSubjects(subjects, { ...st, term: "" }).map((s) => String(s.term))).sort(), (v) => TERM[v] || `ترم ${v}`);
    }
    if (!["subject", "folder"].includes(from)) {
      const list = filterSubjects(subjects, state()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
      const prev = sel.subject.value;
      sel.subject.replaceChildren(option("", "— اختر المادة —"), ...list.map((x) => option(x.id, x.name)));
      if (list.some((x) => x.id === prev)) sel.subject.value = prev;
    }
    const subj = subjects.find((x) => x.id === sel.subject.value);
    const paths = (subj?.folderPaths || []).filter((p) => Array.isArray(p) && p.length).map((p) => p.join("/")).sort();
    fill(sel.folder, "— المستوى الرئيسي للمادة —", paths, (v) => v.split("/").join(" ← "));
  }
  sel.type.append(option("", "— اختر المسار —"), ...uniq(subjects.map((x) => x.education_type)).sort().map((t) => option(t, t === "University" ? "جامعي" : t)));
  refresh("type");
  const remember = () => {
    if (sel.subject.value) writeLast(Object.fromEntries(SELECT_KEYS.map((k) => [k, sel[k].value])));
  };
  for (const k of SELECT_KEYS) {
    sel[k].addEventListener("change", () => { refresh(k); setMessage(""); remember(); });
  }
  // Restore the last destination, one level at a time (each level only offers
  // what exists now, so a renamed or deleted subject is skipped, not forced).
  let restored = false;
  const last = readLast();
  if (last) {
    for (const k of SELECT_KEYS) {
      if (last[k] && [...sel[k].options].some((o) => o.value === last[k])) {
        sel[k].value = last[k];
        refresh(k);
      }
    }
    restored = Boolean(sel.subject.value);
    if (!restored) for (const k of SELECT_KEYS) sel[k].value = "";
    if (!restored) refresh("type");
  }

  const selectedText = (select) => (select.value ? select.selectedOptions[0].textContent : "");
  const heading = (iconName, text, sub) => {
    const h = el("div", "ytp-head");
    h.append(icon(iconName, "ytp-head-ic"));
    const t = el("div", "ytp-head-text");
    t.append(el("h3", "", text), el("p", "ytp-hint", sub));
    h.append(t);
    return h;
  };

  /** Returns an error string when the step is not complete. */
  function validate(i) {
    if (i === 0) {
      if (!sel.type.value) return "اختر المسار أولًا.";
      if (sel.type.value === "University" && !sel.college.value) return "اختر الكلية.";
    }
    if (i === 1 && !sel.subject.value) return "اختر المادة.";
    return "";
  }
  function setMessage(text, kind = "error") {
    message.textContent = "";
    message.dataset.kind = kind;
    message.hidden = !text;
    if (text) message.append(icon(kind === "error" ? "alert" : "check"), el("span", "", text));
  }

  function review() {
    const box = el("div", "ytp-review");
    const rows = [
      ["path", "المسار", [selectedText(sel.type), selectedText(sel.college)].filter(Boolean).join(" · ")],
      ["subject", "المادة", selectedText(sel.subject)],
      ["folder", "المجلد", sel.folder.value ? sel.folder.value.split("/").join(" ← ") : "المستوى الرئيسي للمادة"],
    ];
    for (const [ic, k, v] of rows) {
      const r = el("div", "ytp-review-row");
      r.append(icon(ic), el("span", "ytp-review-k", k), el("strong", "", v));
      box.append(r);
    }
    const list = el("ul", "ytp-review-items");
    for (const e of entries) {
      const li = el("li");
      li.append(icon("video"), el("span", "", e?.meta?.title || "بدون عنوان"), el("em", "", e?.meta?.type === "youtube_playlist" ? "قائمة تشغيل" : "فيديو"));
      list.append(li);
    }
    box.append(list);
    return box;
  }

  function render() {
    stepEls.forEach((li, i) => {
      li.classList.toggle("is-current", i === step);
      li.classList.toggle("is-done", i < step);
      if (i === step) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
    panel.replaceChildren();
    if (step === 0) {
      panel.append(heading("path", "اختر المسار", "اختر مسار التعليم والكلية."), field("path", "المسار", sel.type), collegeField);
    } else if (step === 1) {
      panel.append(heading("subject", "اختر المادة", "السنة والترم اختياريان لتضييق القائمة."), field("year", "السنة", sel.year), field("term", "الترم", sel.term), field("subject", "المادة", sel.subject));
    } else if (step === 2) {
      panel.append(heading("folder", "اختر المجلد", "اتركه كما هو ليُنشر في المستوى الرئيسي للمادة."), field("folder", "مجلد داخل المادة (اختياري)", sel.folder));
    } else {
      panel.append(heading("review", "مراجعة ونشر", entries.length === 1 ? "سيُنشر عنصر واحد." : `سيُنشر ${entries.length} عنصر.`), review());
    }
    back.hidden = step === 0;
    next.hidden = step === STEPS.length - 1;
    publish.hidden = step !== STEPS.length - 1;
    back.disabled = next.disabled = publish.disabled = busy;
    panel.querySelector("select, button")?.focus?.({ preventScroll: true });
  }

  back.addEventListener("click", () => { setMessage(""); step = Math.max(0, step - 1); render(); });
  next.addEventListener("click", () => {
    const err = validate(step);
    if (err) { setMessage(err); return; }
    setMessage("");
    step = Math.min(STEPS.length - 1, step + 1);
    render();
  });
  pane.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "SELECT" && !next.hidden) { e.preventDefault(); next.click(); }
  });

  function done(ok) {
    const box = el("div", "ytp-done");
    box.append(icon("check", "ytp-done-ic"), el("h3", "", ok === 1 ? "تم النشر على المنصة" : `تم نشر ${ok} عنصر`), el("p", "ytp-hint", "ستجدها الآن داخل المادة التي اخترتها."));
    const close = button("primary", "check", "تم");
    close.addEventListener("click", () => onDone?.());
    pane.replaceChildren(box, close);
    close.focus();
  }

  publish.addEventListener("click", async () => {
    for (let i = 0; i < 2; i++) { const err = validate(i); if (err) { step = i; render(); setMessage(err); return; } }
    const folderPath = sel.folder.value ? sel.folder.value.split("/") : [];
    remember();
    busy = true;
    publish.classList.add("is-loading");
    render();
    let ok = 0;
    const failed = [];
    for (const entry of entries) {
      setMessage(`جارٍ النشر… (${ok + failed.length + 1}/${entries.length})`, "info");
      try {
        await adminCall(buildPublishBody(entry, sel.subject.value, folderPath));
        ok++;
        try {
          const isPl = entry.meta.type === "youtube_playlist";
          recordHistory([buildHistoryEvent({
            event: "published",
            kind: isPl ? "playlist" : "video",
            youtubeId: isPl ? null : entry.meta.youtubeId,
            playlistId: isPl ? entry.meta.playlistId : null,
            title: entry.meta.title,
            itemId: entry.id || entry.meta.id,
            parentId: entry.meta.parentId || null,
          })]);
        } catch (err) { console.error("[youtube] publish log not saved", err); }
      } catch (err) {
        failed.push(`${entry?.meta?.title || "عنصر"}: ${err.message}`);
      }
    }
    busy = false;
    publish.classList.remove("is-loading");
    if (!failed.length) { showNotification(ok === 1 ? "تم النشر على المنصة" : `تم نشر ${ok} عنصر`, "", "success"); done(ok); return; }
    render();
    setMessage(`نُشر ${ok} وفشل ${failed.length}: ${failed.join(" | ")}`);
  });

  if (restored) {
    step = STEPS.length - 1; // everything is filled in: go straight to the review
    render();
    setMessage("تم استرجاع آخر مسار استخدمته. يمكنك الرجوع لتغييره.", "info");
  } else {
    render();
  }
  return pane;
}

function buildManageTab(subjects) {
  const pane = el("div", "ytp-pane");
  const list = el("ul", "ytp-list");
  const status = el("p", "ytp-hint", "جارٍ التحميل…");
  pane.append(status, list);
  const courseName = new Map(subjects.map((s) => [s.id, s.name]));

  async function load() {
    try {
      const { items } = await adminCall({ action: "list-youtube-public" });
      list.replaceChildren();
      status.textContent = items.length ? `${items.length} عنصر منشور` : "لا يوجد محتوى منشور بعد.";
      for (const it of items) {
        const li = el("li", "ytp-item");
        const info = el("div", "ytp-item-info");
        info.append(
          el("strong", "", it.title),
          el("span", "ytp-hint", `${it.kind === "playlist" ? `قائمة تشغيل (${it.item_count})` : "فيديو"} · ${courseName.get(it.course_id) || "مادة"}`),
        );
        const rm = button("ghost", "alert", "إلغاء النشر");
        rm.addEventListener("click", async () => {
          if (!window.confirm(`إلغاء نشر "${it.title}"؟`)) return;
          rm.disabled = true;
          try {
            await adminCall({ action: "unpublish-youtube", id: it.id });
            li.remove();
            showNotification("تم إلغاء النشر", "", "success");
          } catch (err) {
            rm.disabled = false;
            showNotification(err.message, "", "error");
          }
        });
        li.append(info, rm);
        list.append(li);
      }
    } catch (err) {
      status.textContent = err.message;
    }
  }
  load();
  return pane;
}

/**
 * @param {object[]} entries saved «محتواي» items (youtube_video / youtube_playlist)
 * @param {{tab?: "publish"|"manage"}} [opts]
 */
export async function openYoutubePublishModal(entries = [], opts = {}) {
  if (overlay) return;
  if (!isAdminAuthenticated()) {
    showNotification("يجب تسجيل الدخول كمشرف أولاً", "", "error");
    return;
  }
  const items = entries.filter((e) => e?.meta?.type === "youtube_video" || e?.meta?.type === "youtube_playlist");
  const canPublish = items.length > 0;

  overlay = el("div", "yt-modal-overlay");
  const dialog = el("div", "yt-modal");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "نشر على المنصة");
  overlay.append(dialog);
  const header = el("header", "yt-modal__header");
  const closeBtn = el("button", "yt-modal__close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "إغلاق");
  closeBtn.addEventListener("click", close);
  header.append((() => { const h = el("h2", "yt-modal__title"); h.append(icon("upload"), document.createTextNode("نشر يوتيوب على المنصة")); return h; })(), closeBtn);
  const tabs = el("div", "yt-modal__tabs");
  const tabPublish = button("tab", "upload", "نشر");
  const tabManage = button("tab", "review", "المنشور");
  tabs.append(...(canPublish ? [tabPublish, tabManage] : [tabManage]));
  const body = el("div", "ytp-body");
  dialog.append(header, tabs, body);
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  document.body.append(overlay);
  document.body.style.overflow = "hidden";

  body.append(el("p", "yt-hint", "جارٍ تحميل بيانات المنصة…"));
  let subjects = [];
  try {
    ({ subjects } = await getManifest());
  } catch (err) {
    console.error("[youtube-publish] manifest", err);
    body.replaceChildren(el("p", "yt-hint", "تعذّر تحميل بيانات المنصة. تحقق من اتصالك ثم أعد المحاولة."));
    return;
  }
  if (!overlay) return; // closed while loading

  const show = (which) => {
    tabPublish.classList.toggle("is-active", which === "publish");
    tabManage.classList.toggle("is-active", which === "manage");
    body.replaceChildren(which === "publish" ? buildPublishTab(items, subjects, close) : buildManageTab(subjects));
  };
  tabPublish.addEventListener("click", () => show("publish"));
  tabManage.addEventListener("click", () => show("manage"));
  show(canPublish && opts.tab !== "manage" ? "publish" : "manage");
}

/** «رفع إلى المنصة» action for a saved YouTube item (twin of createLessonUploadButton). */
export function createYoutubeUploadButton(entry) {
  const btn = el("button", "exam-action-btn");
  btn.type = "button";
  btn.setAttribute("aria-label", `نشر "${entry?.meta?.title || "فيديو"}" على المنصة`);
  btn.innerHTML = `${UPLOAD_ICON_SVG}<span>رفع إلى المنصة</span>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openYoutubePublishModal([entry]);
  });
  return btn;
}

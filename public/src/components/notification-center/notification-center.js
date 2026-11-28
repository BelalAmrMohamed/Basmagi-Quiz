// =============================================================================
// public/src/components/notification-center/notification-center.js
// Admin notification center (bell entry in the sidebar + panel), like YouTube's.
//
// - Entry: #notificationCenterItem in the sidebar (scripts/partials/sidebar.html), hidden
//   until a signed-in admin is found. side-menu.js calls initNotificationCenter().
// - Data: POST /api/admin { action: "notifications-*" } (api/_notifications.js). The server
//   creates notifications (sign-in, uploads, reports, ...); this file lists/reads/deletes them.
// - Wording is built here from `type` + `count` + `meta`, so grouped rows ("3 new reports on X")
//   and wording changes need no migration.
// - Database text (report reasons are typed by anonymous students) is written with
//   textContent only, never innerHTML.
// Not to be confused with ../notifications/notifications.js (transient toasts).
// =============================================================================

import { getToken, getAdminRoleInfo } from "../../shared/adminAuth.js";
import { showNotification } from "../notifications/notifications.js";

const POLL_MS = 60_000;
const PAGE = 20;
const TOAST_KEY = "bq-nc-toasted"; // welcome toast: once per browser while it is unread
const REFRESH_EVENT = "bq:notifications-refresh";

// ── Wording ──────────────────────────────────────────────────────────────────

const KIND_NOUN = { quiz: "امتحان", lesson: "درس", notebook: "دفتر", youtube: "عنصر يوتيوب" };
const METRIC_NOUN = { attempts: "محاولة", views: "مشاهدة" };
const fmt = (n) => Number(n).toLocaleString("en");
const q = (s) => `«${s}»`;

export function describe(n) {
  const m = n.meta || {};
  const count = n.count || 1;
  const base = { tone: "primary", title: n.title, body: n.body || "", href: n.href || null };

  switch (n.type) {
    case "welcome":
      return { ...base, tone: "admin", newTab: true };

    case "upload": {
      const noun = KIND_NOUN[m.kind] || "عنصر";
      return {
        ...base,
        tone: "success",
        title: count > 1 ? `تم رفع ${fmt(count)} ${noun} بنجاح` : `تم رفع ${noun} بنجاح`,
        body: count > 1 ? (m.itemTitle ? `آخرها: ${m.itemTitle}` : "") : (m.itemTitle || n.title),
        href: count > 1 ? "/profile" : n.href,
      };
    }

    case "report_new": {
      const quiz = m.quizTitle || n.title;
      const qn = Number.isInteger(m.questionIndex) ? m.questionIndex + 1 : null;
      return {
        ...base,
        tone: "warning",
        title: count > 1 ? `${fmt(count)} بلاغات جديدة على ${q(quiz)}` : `بلاغ جديد على ${q(quiz)}`,
        body: count > 1 ? (m.reason ? `آخرها: ${m.reason}` : "") : `${qn ? `السؤال ${qn}: ` : ""}${m.reason || n.body || ""}`,
        href: "/reports",
      };
    }

    case "report_closed": {
      const quiz = m.quizTitle || n.title;
      const what = m.status === "resolved" ? "حل" : "تجاهل";
      return {
        ...base,
        tone: "success",
        title: count > 1 ? `تم ${what} ${fmt(count)} بلاغات على ${q(quiz)}` : `تم ${what} بلاغ على ${q(quiz)}`,
        body: "قام مشرف آخر بمراجعة البلاغ.",
        href: "/reports",
      };
    }

    case "milestone": {
      const noun = KIND_NOUN[m.kind] || "عنصر";
      return {
        ...base,
        title: `${q(m.itemTitle || n.title)} وصل إلى ${fmt(m.value)} ${METRIC_NOUN[m.metric] || ""}`.trim(),
        body: `إنجاز جديد لـ${noun} الذي نشرته 🎉`,
      };
    }

    case "level_up":
      return { ...base, title: `ارتقيت إلى المستوى ${m.level ?? n.title}`, body: "استمر في التقدّم!" };

    case "badge": {
      const gained = m.gained > 1 ? `${fmt(m.gained)} شارات جديدة` : "شارة جديدة";
      return { ...base, title: `حصلت على ${gained}`, body: m.total ? `إجمالي شاراتك: ${fmt(m.total)}` : "" };
    }

    case "storage_warning":
      return { ...base, tone: "danger" };

    case "announcement":
      return { ...base, tone: "admin" };

    case "admin_request":
      return {
        ...base,
        tone: "admin",
        title: count > 1 ? `${fmt(count)} طلبات انضمام جديدة كمشرف` : "طلب انضمام جديد كمشرف",
        body: count > 1 ? (m.name ? `آخرها: ${m.name}` : "") : n.body || m.name || "",
        href: "/control",
      };

    default:
      return base;
  }
}

// Shown in the "important" tab and pinned to the top while unread. Keep in sync with
// IMPORTANT_TYPES in api/_notifications.js.
const IMPORTANT = new Set(["welcome", "announcement", "report_new", "storage_warning", "admin_request"]);
const rank = (n) => (!n.read_at && IMPORTANT.has(n.type) ? 0 : 1);

// ── Preferences (mute types) ─────────────────────────────────────────────────
// Keep in sync with MUTABLE_TYPES in api/_notifications.js. `welcome` and `storage_warning`
// are never mutable (the server refuses them too).

export const MUTABLE_TYPES = [
  { type: "announcement", label: "إعلانات المطوّرين", hint: "رسائل عامة من فريق المنصة." },
  { type: "report_new", label: "بلاغات على امتحاناتي", hint: "عندما يبلّغ طالب عن سؤال في امتحانك." },
  { type: "report_closed", label: "إغلاق البلاغات", hint: "عندما يحلّ مشرف آخر بلاغًا أو يتجاهله." },
  { type: "milestone", label: "الإنجازات", hint: "عدد مشاهدات كبير على محتواك" },
  { type: "level_up", label: "الارتقاء بالمستوى", hint: "عند وصولك إلى مستوى جديد." },
  { type: "badge", label: "الشارات الجديدة", hint: "عند حصولك على شارة." },
  { type: "upload", label: "تأكيد رفع المحتوى", hint: "رسالة «تم الرفع بنجاح» بعد كل عملية رفع." },
];

// ── Icons (24×24 stroke paths) ───────────────────────────────────────────────

const ICONS = {
  welcome: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M21 5h-4"/>',
  upload: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  report_new: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  report_closed: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  milestone: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  level_up: '<path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z"/>',
  badge: '<circle cx="12" cy="8" r="6"/><path d="M15.5 12.9 17 22l-5-3-5 3 1.5-9.1"/>',
  storage_warning: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  admin_request: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  announcement: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  _default: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
};

function svg(paths, size = 20) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  e.setAttribute("viewBox", "0 0 24 24");
  e.setAttribute("width", size);
  e.setAttribute("height", size);
  e.setAttribute("fill", "none");
  e.setAttribute("stroke", "currentColor");
  e.setAttribute("stroke-width", "2");
  e.setAttribute("stroke-linecap", "round");
  e.setAttribute("stroke-linejoin", "round");
  e.setAttribute("aria-hidden", "true");
  e.innerHTML = paths; // static strings from ICONS above, never user data
  return e;
}

// ── Time ─────────────────────────────────────────────────────────────────────

const rtf = (() => {
  try { return new Intl.RelativeTimeFormat("ar", { numeric: "auto" }); } catch { return null; }
})();

function timeAgo(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.round((t - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (!rtf) return new Date(t).toLocaleDateString("ar");
  if (abs < 45) return "الآن";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(t).toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" });
}

// ── API ──────────────────────────────────────────────────────────────────────

async function call(body) {
  const token = getToken();
  if (!token) throw new Error("no-session");
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── State ────────────────────────────────────────────────────────────────────

let started = false;
let retried = false;
let trigger = null, badge = null, panel = null, backdrop = null;
let listEl = null, footEl = null, markAllBtn = null, headCount = null;
let items = [];
let view = "list"; // "list" | "prefs"
let muted = new Set();
let quiet = new Set(); // digest types: listed, but never counted in the badge
let tab = "all"; // "all" | "important"
let tabsEl = null;
let prefsState = "idle"; // idle | loading | ready | error
let prefsSave = Promise.resolve();
let gearBtn = null, titleText = null;
const oldest = () => items.reduce((m, n) => (!m || n.updated_at < m ? n.updated_at : m), null);
let unread = 0;
let hasMore = false;
let loading = false;
let isOpen = false;
let pollTimer = null;
let failures = 0;

const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderBadge() {
  if (badge) {
    badge.hidden = unread <= 0;
    badge.textContent = unread > 99 ? "99+" : String(unread);
  }
  if (trigger) trigger.setAttribute("aria-label", unread > 0 ? `الإشعارات، ${unread} غير مقروء` : "الإشعارات");
  if (headCount) {
    headCount.hidden = unread <= 0 || view === "prefs";
    headCount.textContent = unread > 99 ? "99+" : String(unread);
  }
  if (markAllBtn) markAllBtn.disabled = unread <= 0;
}

// ── Panel DOM ────────────────────────────────────────────────────────────────

function loadStylesheet() {
  if (document.getElementById("notification-center-css")) return;
  const link = document.createElement("link");
  link.id = "notification-center-css";
  link.rel = "stylesheet";
  link.href = new URL("./notification-center.css", import.meta.url).href;
  document.head.appendChild(link);
}

function buildPanel() {
  loadStylesheet();

  backdrop = el("div", "nc-backdrop");
  backdrop.hidden = true;
  backdrop.addEventListener("click", () => close());

  panel = el("section", "nc-panel");
  panel.id = "notificationCenterPanel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "الإشعارات");
  panel.hidden = true;

  const head = el("header", "nc-head");
  const title = el("h2", "nc-title");
  titleText = el("span", "", "الإشعارات");
  title.appendChild(titleText);
  headCount = el("span", "nc-head-count");
  headCount.hidden = true;
  title.appendChild(headCount);
  markAllBtn = el("button", "nc-markall", "تحديد الكل كمقروء");
  markAllBtn.type = "button";
  markAllBtn.addEventListener("click", markAllRead);
  gearBtn = el("button", "nc-gear");
  gearBtn.type = "button";
  gearBtn.setAttribute("aria-label", "إعدادات الإشعارات");
  gearBtn.appendChild(svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', 18));
  gearBtn.addEventListener("click", () => setView(view === "prefs" ? "list" : "prefs"));
  const closeBtn = el("button", "nc-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "إغلاق");
  closeBtn.addEventListener("click", () => close({ returnFocus: true }));
  head.append(title, markAllBtn, gearBtn, closeBtn);

  tabsEl = el("div", "nc-tabs");
  tabsEl.setAttribute("role", "group");
  tabsEl.setAttribute("aria-label", "تصفية الإشعارات");
  for (const [key, label] of [["all", "الكل"], ["important", "المهم"]]) {
    const b = el("button", "nc-tab", label);
    b.type = "button";
    b.dataset.tab = key;
    b.setAttribute("aria-pressed", String(key === tab));
    b.addEventListener("click", () => setTab(key));
    tabsEl.appendChild(b);
  }

  listEl = el("ul", "nc-list");
  listEl.setAttribute("aria-live", "polite");
  footEl = el("div", "nc-foot");

  panel.tabIndex = -1;
  panel.append(head, tabsEl, listEl, footEl);
  document.body.append(backdrop, panel);
}

function renderList() {
  if (!listEl) return;
  listEl.textContent = "";
  footEl.textContent = "";

  if (view === "prefs") { renderPrefs(); return; }

  if (loading && !items.length) {
    for (let i = 0; i < 3; i++) listEl.appendChild(el("li", "nc-skeleton"));
    return;
  }

  if (!items.length) {
    const empty = el("li", "nc-empty");
    const icon = el("span", "nc-empty-icon");
    icon.appendChild(svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 28));
    empty.append(
      icon,
      el("strong", "", tab === "important" ? "لا توجد إشعارات مهمة" : "لا توجد إشعارات بعد"),
      el("span", "", tab === "important" ? "هنا تظهر الإعلانات والبلاغات الجديدة وتحذيرات التخزين." : "ستظهر هنا عمليات الرفع، والبلاغات على امتحاناتك، وإنجازاتك."),
    );
    listEl.appendChild(empty);
    return;
  }

  // Unread important items first; `items` itself stays newest-first (it drives paging).
  for (const n of [...items].sort((a, b) => rank(a) - rank(b))) listEl.appendChild(renderItem(n));

  if (hasMore) {
    const more = el("button", "nc-more", "عرض المزيد");
    more.type = "button";
    more.addEventListener("click", loadMore);
    footEl.appendChild(more);
  }
}

function setTab(next) {
  if (tab === next) return;
  tab = next;
  for (const b of tabsEl.children) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  items = [];
  hasMore = false;
  loading = false;
  renderList();
  loadFirstPage();
}

function setView(next) {
  view = next;
  const prefs = view === "prefs";
  if (titleText) titleText.textContent = prefs ? "إعدادات الإشعارات" : "الإشعارات";
  if (markAllBtn) markAllBtn.hidden = prefs;
  if (tabsEl) tabsEl.hidden = prefs;
  if (headCount) headCount.hidden = prefs || unread <= 0;
  if (gearBtn) {
    gearBtn.classList.toggle("nc-gear-on", prefs);
    gearBtn.setAttribute("aria-label", prefs ? "العودة إلى الإشعارات" : "إعدادات الإشعارات");
    gearBtn.setAttribute("aria-pressed", String(prefs));
  }
  if (prefs) {
    loadPrefs();
  } else {
    loadFirstPage({ silent: items.length > 0 }); // muted types are filtered server-side: refresh
  }
  renderList();
  position();
}

async function loadPrefs() {
  prefsState = "loading";
  try {
    const data = await call({ action: "notifications-prefs-get" });
    muted = new Set(data.muted || []);
    quiet = new Set(data.quiet || []);
    prefsState = "ready";
  } catch {
    prefsState = "error";
  }
  if (isOpen && view === "prefs") renderList();
}

const MODES = [
  ["on", "تنبيه", "يصلك الإشعار ويُحسب في العدّاد"],
  ["quiet", "صامت", "يظهر في القائمة بدون عدّاد"],
  ["off", "إيقاف", "لن يُنشأ إشعار"],
];
const modeOf = (type) => (muted.has(type) ? "off" : quiet.has(type) ? "quiet" : "on");

function renderPrefs() {
  if (prefsState === "loading" || prefsState === "idle") {
    for (let i = 0; i < 4; i++) listEl.appendChild(el("li", "nc-skeleton"));
    return;
  }
  if (prefsState === "error") {
    const li = el("li", "nc-empty");
    li.append(el("strong", "", "تعذّر تحميل الإعدادات"), el("span", "", "تحقق من اتصالك بالإنترنت."));
    const retry = el("button", "nc-more", "إعادة المحاولة");
    retry.type = "button";
    retry.addEventListener("click", loadPrefs);
    li.appendChild(retry);
    listEl.appendChild(li);
    return;
  }

  listEl.appendChild(el("li", "nc-pref-intro", "«صامت» يُبقي الإشعار في القائمة بدون عدّاد، و«إيقاف» يمنع وصوله تمامًا. يمكنك التغيير في أي وقت."));
  for (const t of MUTABLE_TYPES) {
    const li = el("li", "nc-pref");
    const text = el("span", "nc-pref-text");
    text.append(el("strong", "nc-pref-label", t.label), el("span", "nc-pref-hint", t.hint));
    const seg = el("span", "nc-seg");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", t.label);
    for (const [mode, label, title] of MODES) {
      const b = el("button", "nc-seg-btn", label);
      b.type = "button";
      b.title = title;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(modeOf(t.type) === mode));
      b.addEventListener("click", () => setMode(t.type, mode, seg));
      seg.appendChild(b);
    }
    li.append(text, seg);
    listEl.appendChild(li);
  }
  listEl.appendChild(el("li", "nc-pref-note", "رسالة الترحيب وتحذيرات مساحة التخزين تصلك دائمًا."));
}

function paintSeg(seg, type) {
  const cur = modeOf(type);
  [...seg.children].forEach((b, i) => b.setAttribute("aria-checked", String(MODES[i][0] === cur)));
}

function setMode(type, mode, seg) {
  const prev = modeOf(type);
  if (prev === mode) return;
  const apply = (m) => {
    muted.delete(type);
    quiet.delete(type);
    if (m === "off") muted.add(type);
    if (m === "quiet") quiet.add(type);
  };
  apply(mode);
  paintSeg(seg, type); // optimistic
  // Saves are chained so the last tap always wins on the server.
  prefsSave = prefsSave.then(async () => {
    try {
      const data = await call({ action: "notifications-prefs-set", muted: [...muted], quiet: [...quiet] });
      if (typeof data.unread === "number") { unread = data.unread; renderBadge(); }
    } catch {
      apply(prev);
      paintSeg(seg, type);
      showNotification("تعذّر حفظ الإعدادات", "حاول مرة أخرى.", "error");
    }
  });
}

function renderItem(n) {
  const d = describe(n);
  const li = el("li", `nc-item${n.read_at ? "" : " nc-unread"}${quiet.has(n.type) ? " nc-quiet" : ""}`);

  const main = el("button", "nc-item-main");
  main.type = "button";

  const icon = el("span", `nc-icon nc-tone-${d.tone}`);
  icon.appendChild(svg(ICONS[n.type] || ICONS._default));

  const text = el("span", "nc-text");
  const t = el("strong", "nc-item-title", d.title);
  t.dir = "auto";
  text.appendChild(t);
  if (d.body) {
    const b = el("span", "nc-item-body", d.body);
    b.dir = "auto";
    text.appendChild(b);
  }
  const time = el("time", "nc-time", timeAgo(n.updated_at));
  time.dateTime = n.updated_at;
  text.appendChild(time);
  if (!n.read_at) text.appendChild(el("span", "nc-sr", "غير مقروء"));

  const dot = el("span", "nc-dot");
  dot.setAttribute("aria-hidden", "true");

  main.append(icon, text, dot);
  main.addEventListener("click", () => openItem(n, d));

  const del = el("button", "nc-del", "×");
  del.type = "button";
  del.setAttribute("aria-label", "حذف الإشعار");
  del.addEventListener("click", (e) => { e.stopPropagation(); removeItem(n); });

  li.append(main, del);
  return li;
}

// ── Actions ──────────────────────────────────────────────────────────────────

function markLocalRead(id) {
  const n = items.find((x) => x.id === id);
  if (n && !n.read_at) {
    n.read_at = new Date().toISOString();
    if (!quiet.has(n.type)) unread = Math.max(0, unread - 1);
    renderBadge();
  }
}

function openItem(n, d) {
  if (!n.read_at) {
    markLocalRead(n.id);
    call({ action: "notifications-read", ids: [n.id] }).catch(() => { });
  }
  if (!d.href) { renderList(); return; }
  close();
  if (d.newTab) { window.open(d.href, "_blank", "noopener,noreferrer"); return; }
  if (new URL(d.href, location.href).pathname === location.pathname) return;
  location.assign(d.href);
}

async function markAllRead() {
  const before = items.map((n) => n.read_at);
  const prev = unread;
  const now = new Date().toISOString();
  items.forEach((n) => { if (!n.read_at) n.read_at = now; });
  unread = 0;
  renderBadge();
  renderList();
  try {
    await call({ action: "notifications-read-all" });
  } catch {
    items.forEach((n, i) => { n.read_at = before[i]; });
    unread = prev;
    renderBadge();
    renderList();
    showNotification("تعذّر تحديد الإشعارات كمقروءة", "حاول مرة أخرى.", "error");
  }
}

async function removeItem(n) {
  const idx = items.indexOf(n);
  if (idx < 0) return;
  items.splice(idx, 1);
  const counted = !n.read_at && !quiet.has(n.type);
  if (counted) unread = Math.max(0, unread - 1);
  renderBadge();
  renderList();
  try {
    await call({ action: "notifications-delete", ids: [n.id] });
  } catch {
    items.splice(idx, 0, n);
    if (counted) unread += 1;
    renderBadge();
    renderList();
    showNotification("تعذّر حذف الإشعار", "حاول مرة أخرى.", "error");
  }
}

// ── Loading ──────────────────────────────────────────────────────────────────

async function loadFirstPage({ silent = false } = {}) {
  if (loading) return;
  loading = true;
  if (!silent && isOpen) renderList();
  try {
    const data = await call({ action: "notifications-list", limit: PAGE, filter: tab === "important" ? "important" : undefined });
    items = data.items || [];
    quiet = new Set(data.quiet || []);
    unread = data.unread || 0;
    hasMore = !!data.hasMore;
    failures = 0;
    maybeToastWelcome();
  } catch {
    failures++;
    if (isOpen && !items.length) { loading = false; renderError(); return; }
  }
  loading = false;
  renderBadge();
  if (isOpen) renderList();
}

async function loadMore() {
  const before = oldest();
  if (!before || loading) return;
  loading = true;
  const btn = footEl.querySelector(".nc-more");
  if (btn) { btn.disabled = true; btn.textContent = "جارٍ التحميل…"; }
  try {
    const data = await call({ action: "notifications-list", limit: PAGE, before, filter: tab === "important" ? "important" : undefined });
    const seen = new Set(items.map((n) => n.id));
    items = items.concat((data.items || []).filter((n) => !seen.has(n.id)));
    hasMore = !!data.hasMore;
    unread = data.unread ?? unread;
  } catch {
    showNotification("تعذّر تحميل المزيد", "تحقق من اتصالك وحاول مرة أخرى.", "error");
  }
  loading = false;
  renderBadge();
  renderList();
}

function renderError() {
  listEl.textContent = "";
  footEl.textContent = "";
  const li = el("li", "nc-empty");
  li.append(el("strong", "", "تعذّر تحميل الإشعارات"), el("span", "", "تحقق من اتصالك بالإنترنت."));
  const retry = el("button", "nc-more", "إعادة المحاولة");
  retry.type = "button";
  retry.addEventListener("click", () => loadFirstPage());
  li.appendChild(retry);
  listEl.appendChild(li);
}

/** The first sign-in message also pops up once as a toast so a new admin cannot miss it. */
function maybeToastWelcome() {
  const w = items.find((n) => n.type === "welcome" && !n.read_at);
  if (!w) return;
  try {
    const seen = JSON.parse(localStorage.getItem(TOAST_KEY) || "[]");
    if (seen.includes(w.id)) return;
    localStorage.setItem(TOAST_KEY, JSON.stringify([...seen, w.id].slice(-20)));
  } catch {
    return; // storage unavailable: it is still in the center
  }
  showNotification(w.title, w.body || "", "success", 12, {
    action: { label: "افتح دليل رفع المحتوى", href: w.href || "/how-to-upload-content" },
  });
}

// ── Polling ──────────────────────────────────────────────────────────────────

async function pollCount() {
  if (document.visibilityState !== "visible" || !getToken()) return;
  try {
    const { unread: n } = await call({ action: "notifications-count" });
    failures = 0;
    if (typeof n === "number" && n !== unread) {
      unread = n;
      renderBadge();
      loadFirstPage({ silent: true });
    }
  } catch {
    failures++;
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const wait = Math.min(POLL_MS * 2 ** Math.min(failures, 3), 5 * 60_000);
  pollTimer = setTimeout(async () => { await pollCount(); schedulePoll(); }, wait);
}

// ── Open / close ─────────────────────────────────────────────────────────────

function position() {
  if (!panel || !trigger) return;
  if (isMobile()) { panel.style.cssText = ""; return; }
  const r = trigger.getBoundingClientRect();
  const MIN_H = 280; // never squeeze the panel below this, even next to a low bell
  // The sidebar is on the right edge (RTL): the panel opens to the left of the bell.
  const top = Math.min(Math.max(8, r.top - 8), Math.max(8, window.innerHeight - MIN_H - 8));
  panel.style.right = `${Math.max(8, window.innerWidth - r.left + 10)}px`;
  panel.style.top = `${top}px`;
  panel.style.maxHeight = `${Math.min(600, window.innerHeight - top - 8)}px`; // content scrolls inside
  panel.style.left = "auto";
  panel.style.bottom = "auto";
}

function onKeydown(e) {
  if (e.key === "Escape") { e.preventDefault(); close({ returnFocus: true }); return; }
  if (e.key === "Tab" && isMobile()) {
    const f = [...panel.querySelectorAll("button:not([disabled])")];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
}

function onDocClick(e) {
  if (!panel.contains(e.target) && !trigger.contains(e.target)) close();
}

function open() {
  if (!panel) buildPanel();
  isOpen = true;
  if (view !== "list") setView("list");
  panel.hidden = false;
  backdrop.hidden = !isMobile();
  trigger.setAttribute("aria-expanded", "true");
  renderBadge();
  renderList();
  position();
  requestAnimationFrame(() => panel.classList.add("nc-open"));
  document.addEventListener("click", onDocClick, true);
  document.addEventListener("keydown", onKeydown, true);
  window.addEventListener("resize", position);
  loadFirstPage({ silent: items.length > 0 });
  // The close button is hidden on desktop (click outside / Esc closes): focus the panel instead.
  const closeBtn = panel.querySelector(".nc-close");
  (closeBtn && closeBtn.offsetParent ? closeBtn : panel).focus({ preventScroll: true });
}

function close({ returnFocus = false } = {}) {
  if (!isOpen) return;
  isOpen = false;
  panel.classList.remove("nc-open");
  panel.hidden = true;
  backdrop.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", onDocClick, true);
  document.removeEventListener("keydown", onKeydown, true);
  window.removeEventListener("resize", position);
  if (returnFocus) trigger.focus();
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initNotificationCenter() {
  if (started) return;
  trigger = document.getElementById("notificationCenterItem");
  badge = document.getElementById("notificationCenterBadge");
  if (!trigger) {
    // Docs pages inject the sidebar from a script that may run after this module: look again later.
    if (document.readyState !== "complete" && !retried) {
      retried = true;
      window.addEventListener("load", initNotificationCenter, { once: true });
    }
    return;
  }

  // `id` is admin_users.id: students (and an owner with no admin row) have no inbox.
  const info = getAdminRoleInfo();
  if (!info || !info.id) return;
  started = true;

  trigger.hidden = false;
  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    if (isOpen) close(); else open();
  });

  // adminUpload.js nudges this right after a successful upload instead of waiting for the poll.
  window.addEventListener(REFRESH_EVENT, () => loadFirstPage({ silent: true }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pollCount(); });
  window.addEventListener("online", pollCount);

  loadFirstPage({ silent: true });
  schedulePoll();
}

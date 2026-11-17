// public/src/features/documents/about-stats.js
// Two independent live-loaded pieces for about.html:
//
// 1. Platform stats (quizzes/lessons/notebooks/courses/education tracks/creators) shown in the
//    "المنصة بالأرقام" section — GET /api/admin?platformStats=true, a
//    public anon-key-only read (see api/admin.js's isPlatformStats branch)
//    mirroring the counts control.html used to show, minus anything
//    owner-specific (no ownerEmail, no per-admin list).
//
// 2. The developer's own platform-profile mini-card (avatar, display name,
//    level, quiz count) in the "روابط مميزة" row — GET
//    /api/admin?handle=belalamrofficial, the exact same public endpoint
//    profile.html's own /@handle visitor view uses (see
//    setupVisitorView()/fetchAndRenderAdminStats() in profile.js).
//
// 3. Live views + a range-selectable visitors chart (week / month / 3 months /
//    year / all / custom) — GET /api/admin?liveStats=true[&days=N | &from=&to=].
//
// 4. Rich popovers on the "active learning tracks" and "content creators"
//    cards (data comes from the same platformStats response).
//
// 5. The open-source card: copy-to-clone button + live GitHub stars/forks.
//
// Each piece starts in a loading/skeleton state and only drops it once a
// real value is in; on failure both are left in a plain, non-shimmering
// fallback state rather than looking permanently broken.

import { resolveMediaUrl } from "../../shared/media-url.js";

const STATS_ENDPOINT = "/api/admin?platformStats=true";
const PROFILE_HANDLE = "belalamrofficial";
const PROFILE_ENDPOINT = `/api/admin?handle=${encodeURIComponent(PROFILE_HANDLE)}`;

const STAT_FIELDS = [
    { valueId: "statValueQuizzes", cardId: "statCardQuizzes", key: "totalQuizzes" },
    { valueId: "statValueLessons", cardId: "statCardLessons", key: "totalLessons" },
    { valueId: "statValueNotebooks", cardId: "statCardNotebooks", key: "totalNotebooks" },
    { valueId: "statValueCourses", cardId: "statCardCourses", key: "totalCourses" },
    { valueId: "statValueEducationTracks", cardId: "statCardEducationTracks", key: "totalEducationTracks" },
    { valueId: "statValueCreators", cardId: "statCardCreators", key: "totalCreators" },
];

function formatCount(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    try {
        return n.toLocaleString("en-US");
    } catch (_) {
        return String(n);
    }
}

let platformData = null;

async function loadPlatformStats() {
    const container = document.getElementById("platformStats");
    if (!container) return; // this script only ever runs on about.html

    try {
        const res = await fetch(STATS_ENDPOINT);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const stats = await res.json();
        platformData = stats;
        refreshPopover();

        STAT_FIELDS.forEach(({ valueId, cardId, key }) => {
            const valueEl = document.getElementById(valueId);
            const cardEl = document.getElementById(cardId);
            if (valueEl) valueEl.textContent = formatCount(stats[key]);
            if (cardEl) cardEl.classList.remove("platform-stat-loading");
        });
    } catch (err) {
        console.error("[about-stats] Failed to load platform stats:", err);
        // Drop the shimmer even on failure so the cards settle on a plain "—"
        // instead of shimmering forever.
        STAT_FIELDS.forEach(({ cardId }) => {
            document.getElementById(cardId)?.classList.remove("platform-stat-loading");
        });
    }
}

// ── Platform profile mini-card ──────────────────────────────────────────────
async function loadPlatformProfile() {
    const card = document.getElementById("platformProfileCard");
    if (!card) return; // this script only ever runs on about.html

    const nameEl = document.getElementById("platformProfileName");
    const handleEl = document.getElementById("platformProfileHandle");
    const levelEl = document.getElementById("platformProfileLevel");
    const statsEl = document.getElementById("platformProfileStats");
    const avatarEl = document.getElementById("platformProfileAvatar");
    const avatarDefaultEl = document.getElementById("platformProfileAvatarDefault");

    try {
        const res = await fetch(PROFILE_ENDPOINT);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (nameEl) nameEl.textContent = data.displayName || "بلال عمرو محمد";
        if (handleEl && data.handle) {
            handleEl.textContent = `basmagi-quiz.vercel.app/@${data.handle}`;
        }

        if (levelEl && data.currentLevel) {
            levelEl.textContent = `المستوى ${data.currentLevel}`;
            levelEl.hidden = false;
        }

        if (statsEl && typeof data.totalQuizzes !== "undefined") {
            const quizCount = data.totalQuizzes || 0;
            statsEl.textContent = `${formatCount(quizCount)} امتحان مُنجز`;
        }

        const resolvedAvatar = resolveMediaUrl(data.avatarUrl || data.thumbnailUrl || "");
        if (resolvedAvatar && avatarEl) {
            avatarEl.src = resolvedAvatar;
            avatarEl.alt = data.displayName || "الملف الشخصي على المنصة";
            avatarEl.style.display = "block";
            if (avatarDefaultEl) avatarDefaultEl.style.display = "none";
        }
    } catch (err) {
        console.error("[about-stats] Failed to load platform profile:", err);
        // Leave the card on its static fallback text/link (already in the
        // markup) — it's still a perfectly usable link to the profile page,
        // just without the live-loaded name/avatar/stats.
    }
}

// ── Live platform views ─────────────────────────────────────────────────────
// Total views, "online now", views today and a range-selectable sparkline, all
// from one aggregate-only endpoint (the edge caches it for ~10 s, so polling is
// cheap). The chart window is chosen with the chips above it.
const LIVE_ENDPOINT = "/api/admin?liveStats=true";
const LIVE_POLL_MS = 15000;
const SPARK_PAD = { top: 10, bottom: 6, side: 5 };
const SVG_NS = "http://www.w3.org/2000/svg";
const RANGE_STORE_KEY = "about_stats_range";
const MAX_DAYS = 731;

const prefersReducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
const rafHandles = new WeakMap();

function setShown(el, value) {
    el.dataset.shown = String(value);
    el.textContent = formatCount(value);
}

// Counts up/down to `to` (ease-out); jumps straight there for reduced motion.
function animateNumber(el, to) {
    if (!el) return;
    const from = Number(el.dataset.shown || 0);
    if (rafHandles.has(el)) cancelAnimationFrame(rafHandles.get(el));
    if (prefersReducedMotion || from === to) {
        setShown(el, to);
        return;
    }
    const start = performance.now();
    const duration = 900;
    const step = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setShown(el, Math.round(from + (to - from) * eased));
        if (p < 1) rafHandles.set(el, requestAnimationFrame(step));
        else rafHandles.delete(el);
    };
    rafHandles.set(el, requestAnimationFrame(step));
}

function svgEl(name, attrs = {}) {
    const el = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
}

// Catmull-Rom → cubic Bézier; control points are clamped so the curve never
// dips below the baseline or above the top edge.
function smoothPath(points, minY, maxY) {
    if (points.length < 2) return "";
    const clampY = (y) => Math.min(maxY, Math.max(minY, y));
    let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = clampY(p1.y + (p2.y - p0.y) / 6);
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = clampY(p2.y - (p3.y - p1.y) / 6);
        d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
}

const dayFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long" });
const dayShortFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "short" });
const dayYearFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" });
const dayFullFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" });

function fmtWith(fmt, day) {
    try {
        return fmt.format(new Date(`${day}T12:00:00`));
    } catch (_) {
        return day;
    }
}

const getVal = (d) => (typeof d.visitors === "number" ? d.visitors : d.views || 0);

// ── Range state ─────────────────────────────────────────────────────────────
const rangeState = { mode: "30", from: "", to: "", requestId: 0 };

function loadStoredRange() {
    try {
        const raw = JSON.parse(localStorage.getItem(RANGE_STORE_KEY) || "null");
        if (!raw) return;
        if (["7", "30", "90", "365", "all"].includes(raw.mode)) rangeState.mode = raw.mode;
        else if (raw.mode === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(raw.from) && /^\d{4}-\d{2}-\d{2}$/.test(raw.to)) {
            Object.assign(rangeState, { mode: "custom", from: raw.from, to: raw.to });
        }
    } catch (_) { /* storage unavailable — fall back to 30 days */ }
}

function storeRange() {
    try {
        localStorage.setItem(RANGE_STORE_KEY, JSON.stringify({ mode: rangeState.mode, from: rangeState.from, to: rangeState.to }));
    } catch (_) { /* ignore */ }
}

function rangeQuery() {
    const { mode, from, to } = rangeState;
    if (mode === "custom" && from && to) return `&from=${from}&to=${to}`;
    if (mode === "all") return `&days=${MAX_DAYS}`;
    if (mode === "30") return "";
    return `&days=${encodeURIComponent(mode)}`;
}

function rangeCaption(n, daily) {
    switch (rangeState.mode) {
        case "7": return "الزوار الفريدون في آخر 7 أيام";
        case "30": return "الزوار الفريدون في آخر 30 يومًا";
        case "90": return "الزوار الفريدون في آخر 3 أشهر";
        case "365": return "الزوار الفريدون في آخر سنة";
        case "all": return "الزوار الفريدون منذ بدء التسجيل";
        default:
            return daily.length
                ? `الزوار الفريدون من ${fmtWith(dayFullFmt, daily[0].day)} إلى ${fmtWith(dayFullFmt, daily[daily.length - 1].day)}`
                : "الزوار الفريدون في الفترة المحددة";
    }
}

function updateRangeUi() {
    document.querySelectorAll("#rangePicker .range-chip").forEach((btn) => {
        const active = btn.dataset.range === rangeState.mode;
        btn.classList.toggle("is-active", active);
        if (btn.dataset.range === "custom") btn.setAttribute("aria-expanded", String(!document.getElementById("rangeCustom")?.hidden));
        else btn.setAttribute("aria-pressed", String(active));
    });
}

function setChartBusy(busy) {
    document.getElementById("liveCardTrend")?.classList.toggle("is-busy", busy);
}

const sparkState = { daily: [], drawn: false, resizeBound: false, active: -1 };

function renderSummary(daily) {
    const total = daily.reduce((sum, d) => sum + getVal(d), 0);
    const n = daily.length || 1;
    let peak = daily[0];
    daily.forEach((d) => { if (getVal(d) > getVal(peak || d)) peak = d; });
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set("trendTotal", formatCount(total));
    set("trendAvg", formatCount(Math.round(total / n)));
    set("trendPeak", peak && getVal(peak) > 0 ? `${formatCount(getVal(peak))} · ${fmtWith(dayShortFmt, peak.day)}` : "—");
}

function renderAxis(daily) {
    const start = document.getElementById("axisStart");
    const end = document.getElementById("axisEnd");
    if (!start || !end || !daily.length) return;
    const crossYears = daily[0].day.slice(0, 4) !== daily[daily.length - 1].day.slice(0, 4);
    const fmt = crossYears || daily.length > 200 ? dayYearFmt : dayShortFmt;
    // RTL: first child sits on the right = oldest day.
    start.textContent = fmtWith(fmt, daily[0].day);
    end.textContent = fmtWith(fmt, daily[daily.length - 1].day);
}

function renderSparkline(daily) {
    const wrap = document.getElementById("liveSparkWrap");
    const svg = document.getElementById("liveSpark");
    const tip = document.getElementById("liveSparkTip");
    if (!wrap || !svg || !daily.length) return;
    sparkState.daily = daily;

    const w = Math.max(160, Math.round(wrap.clientWidth || 300));
    const h = Math.max(60, Math.round(wrap.clientHeight || 72));
    const rtl = getComputedStyle(wrap).direction === "rtl";
    const innerW = w - SPARK_PAD.side * 2;
    const innerH = h - SPARK_PAD.top - SPARK_PAD.bottom;
    const max = Math.max(1, ...daily.map(getVal));
    const n = daily.length;

    // Arabic (RTL) pages read the timeline right → left: oldest day on the right.
    const points = daily.map((d, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const x = SPARK_PAD.side + (rtl ? 1 - t : t) * innerW;
        const y = SPARK_PAD.top + innerH - (getVal(d) / max) * innerH;
        return { x, y };
    });
    const ordered = rtl ? [...points].reverse() : points; // path must run left → right
    const top = SPARK_PAD.top;
    const bottom = SPARK_PAD.top + innerH;
    const line = smoothPath(ordered, top, bottom);
    const area = `${line} L${ordered[ordered.length - 1].x.toFixed(1)},${bottom} L${ordered[0].x.toFixed(1)},${bottom} Z`;
    const totalVisitors = daily.reduce((sum, d) => sum + getVal(d), 0);

    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute(
        "aria-label",
        `رسم بياني لزوار ${formatCount(n)} يومًا، بمجموع ${formatCount(totalVisitors)} زيارة فريدة. استخدم الأسهم للتنقل بين الأيام.`,
    );

    const defs = svgEl("defs");
    const grad = svgEl("linearGradient", { id: "liveSparkFill", x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(
        svgEl("stop", { offset: "0%", "stop-color": "currentColor", "stop-opacity": 0.28 }),
        svgEl("stop", { offset: "100%", "stop-color": "currentColor", "stop-opacity": 0 }),
    );
    defs.append(grad);

    // Faint baseline + mid grid line help reading values on the taller mobile chart.
    const baseline = svgEl("line", { x1: 0, x2: w, y1: bottom, y2: bottom, stroke: "currentColor", "stroke-opacity": 0.15 });
    const mid = svgEl("line", { x1: 0, x2: w, y1: top + innerH / 2, y2: top + innerH / 2, stroke: "currentColor", "stroke-opacity": 0.08, "stroke-dasharray": "2 4" });

    const firstDraw = !sparkState.drawn && !prefersReducedMotion;
    const areaEl = svgEl("path", { d: area, fill: "url(#liveSparkFill)", class: firstDraw ? "live-spark-area--fade" : "" });
    const lineEl = svgEl("path", {
        d: line,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        pathLength: 1,
        class: firstDraw ? "live-spark-line--draw" : "",
    });
    const latest = points[n - 1];
    const dot = svgEl("circle", { cx: latest.x, cy: latest.y, r: 3.5, fill: "currentColor" });
    const guide = svgEl("line", { x1: 0, x2: 0, y1: top - 4, y2: bottom, stroke: "currentColor", "stroke-opacity": 0.35, "stroke-dasharray": "3 3", visibility: "hidden" });
    const hoverDot = svgEl("circle", { r: 4.5, fill: "var(--about-card)", stroke: "currentColor", "stroke-width": 2, visibility: "hidden" });
    svg.append(defs, mid, baseline, areaEl, lineEl, dot, guide, hoverDot);
    sparkState.drawn = true;

    const hide = () => {
        sparkState.active = -1;
        guide.setAttribute("visibility", "hidden");
        hoverDot.setAttribute("visibility", "hidden");
        if (tip) tip.hidden = true;
    };
    const showIndex = (i) => {
        const idx = Math.min(n - 1, Math.max(0, i));
        sparkState.active = idx;
        const p = points[idx];
        guide.setAttribute("x1", p.x);
        guide.setAttribute("x2", p.x);
        hoverDot.setAttribute("cx", p.x);
        hoverDot.setAttribute("cy", p.y);
        guide.setAttribute("visibility", "visible");
        hoverDot.setAttribute("visibility", "visible");
        if (!tip) return;
        const d = daily[idx];
        const vCount = typeof d.visitors === "number" ? d.visitors : 0;
        const viewsCount = typeof d.views === "number" ? d.views : 0;
        tip.replaceChildren();
        const date = document.createElement("b");
        date.textContent = fmtWith(dayFullFmt, d.day);
        const nums = document.createElement("span");
        nums.textContent = `${formatCount(vCount)} زائر مختلف · ${formatCount(viewsCount)} مشاهدة`;
        tip.append(date, nums);
        tip.hidden = false;
        // Clamp in pixels so the tooltip never spills outside the card on a phone.
        const tw = tip.offsetWidth;
        const px = (p.x / w) * wrap.clientWidth;
        const half = tw / 2;
        tip.style.left = `${Math.min(Math.max(px, half + 2), Math.max(half + 2, wrap.clientWidth - half - 2))}px`;
    };
    const indexFromX = (clientX) => {
        const rect = svg.getBoundingClientRect();
        if (!rect.width) return 0;
        const x = ((clientX - rect.left) / rect.width) * w;
        let best = 0;
        for (let i = 1; i < points.length; i++) {
            if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i;
        }
        return best;
    };

    wrap.onpointermove = (e) => showIndex(indexFromX(e.clientX));
    wrap.onpointerdown = (e) => showIndex(indexFromX(e.clientX));
    // Touch keeps the tooltip after the finger lifts (tap elsewhere to dismiss),
    // otherwise it would vanish before it could be read.
    wrap.onpointerleave = (e) => { if (e.pointerType !== "touch") hide(); };
    wrap.onpointercancel = (e) => { if (e.pointerType !== "touch") hide(); };
    wrap.onfocus = () => { if (sparkState.active < 0) showIndex(n - 1); };
    wrap.onblur = hide;
    wrap.onkeydown = (e) => {
        const cur = sparkState.active < 0 ? n - 1 : sparkState.active;
        // Visual right = older day on an RTL page.
        const right = rtl ? -1 : 1;
        let next = null;
        if (e.key === "ArrowRight") next = cur + right;
        else if (e.key === "ArrowLeft") next = cur - right;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = n - 1;
        else if (e.key === "Escape") { hide(); return; }
        if (next === null) return;
        e.preventDefault();
        showIndex(next);
    };
    if (sparkState.active >= 0) showIndex(sparkState.active);

    if (!sparkState.resizeBound && typeof ResizeObserver === "function") {
        sparkState.resizeBound = true;
        let lastWidth = wrap.clientWidth;
        let lastHeight = wrap.clientHeight;
        new ResizeObserver(() => {
            if (Math.abs(wrap.clientWidth - lastWidth) < 4 && Math.abs(wrap.clientHeight - lastHeight) < 4) return;
            lastWidth = wrap.clientWidth;
            lastHeight = wrap.clientHeight;
            renderSparkline(sparkState.daily);
        }).observe(wrap);
    }
}

function applyChart(stats) {
    let daily = Array.isArray(stats.daily) ? stats.daily : [];
    if (rangeState.mode === "all") {
        // Trim the empty history before tracking started.
        const first = stats.range?.firstDay;
        if (first) daily = daily.filter((d) => d.day >= first);
        else {
            const i = daily.findIndex((d) => getVal(d) > 0);
            if (i > 0) daily = daily.slice(i);
        }
    }
    if (!daily.length) return;
    const caption = document.getElementById("liveTrendCaption");
    if (caption) caption.textContent = rangeCaption(daily.length, daily);
    sparkState.active = -1;
    renderSummary(daily);
    renderAxis(daily);
    renderSparkline(daily);

    // Keep the custom date inputs inside the range that actually has data.
    const from = document.getElementById("rangeFrom");
    const to = document.getElementById("rangeTo");
    const today = daily[daily.length - 1].day;
    const firstDay = stats.range?.firstDay || daily.find((d) => getVal(d) > 0)?.day || daily[0].day;
    if (to) { to.max = today; to.min = firstDay; }
    if (from) { from.max = today; from.min = firstDay; }
}

function applyLiveStats(stats) {
    const online = document.getElementById("liveOnlineCount");
    // The visitor reading this page is online by definition (the beacon's own
    // hit can land after this response), so never show 0.
    if (online) animateNumber(online, Math.max(1, stats.onlineNow || 0));
    animateNumber(document.getElementById("liveTotalVisitors"), stats.totalVisitors ?? stats.totalViews ?? 0);
    animateNumber(document.getElementById("liveTotalViews"), stats.totalViews || 0);
    animateNumber(document.getElementById("liveTodayVisitors"), stats.visitorsToday ?? stats.viewsToday ?? 0);
    animateNumber(document.getElementById("liveTodayViews"), stats.viewsToday || 0);
    document.getElementById("liveCardTotal")?.classList.remove("platform-stat-loading");
    document.getElementById("liveCardToday")?.classList.remove("platform-stat-loading");
    applyChart(stats);
}

let liveLoaded = false;
async function fetchLiveStats() {
    const requestId = ++rangeState.requestId;
    try {
        const res = await fetch(LIVE_ENDPOINT + rangeQuery(), { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (requestId !== rangeState.requestId) return; // a newer range was picked meanwhile
        applyLiveStats(data);
        liveLoaded = true;
    } catch (err) {
        console.error("[about-stats] Failed to load live stats:", err);
        if (requestId !== rangeState.requestId) return;
        if (!liveLoaded) {
            // Settle on a plain "—" instead of shimmering forever.
            document.getElementById("liveCardTotal")?.classList.remove("platform-stat-loading");
            document.getElementById("liveCardToday")?.classList.remove("platform-stat-loading");
        } else {
            const hint = document.getElementById("trendHint");
            if (hint) hint.textContent = "تعذّر تحديث الرسم الآن. حاول مرة أخرى بعد قليل.";
        }
    } finally {
        if (requestId === rangeState.requestId) setChartBusy(false);
    }
}

function selectRange(mode, { from = "", to = "" } = {}) {
    rangeState.mode = mode;
    rangeState.from = from;
    rangeState.to = to;
    storeRange();
    updateRangeUi();
    setChartBusy(true);
    fetchLiveStats();
}

function localToday() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function initRangePicker() {
    const picker = document.getElementById("rangePicker");
    const form = document.getElementById("rangeCustom");
    if (!picker) return;
    loadStoredRange();

    const fromInput = document.getElementById("rangeFrom");
    const toInput = document.getElementById("rangeTo");
    const errorEl = document.getElementById("rangeError");
    const showError = (msg) => {
        if (!errorEl) return;
        errorEl.textContent = msg;
        errorEl.hidden = !msg;
    };
    const today = localToday();
    if (toInput) toInput.value = rangeState.to || today;
    if (fromInput) fromInput.value = rangeState.from || "";

    if (rangeState.mode === "custom" && form) form.hidden = false;
    updateRangeUi();

    picker.addEventListener("click", (e) => {
        const btn = e.target.closest(".range-chip");
        if (!btn) return;
        const mode = btn.dataset.range;
        if (mode === "custom") {
            if (!form) return;
            form.hidden = !form.hidden;
            btn.setAttribute("aria-expanded", String(!form.hidden));
            if (!form.hidden) (fromInput?.value ? toInput : fromInput)?.focus();
            return;
        }
        if (form) form.hidden = true;
        showError("");
        if (mode !== rangeState.mode) selectRange(mode);
    });

    form?.addEventListener("submit", (e) => {
        e.preventDefault();
        const from = fromInput?.value || "";
        const to = toInput?.value || "";
        if (!from || !to) return showError("اختر تاريخ البداية والنهاية.");
        if (from > to) return showError("تاريخ البداية يجب أن يسبق تاريخ النهاية.");
        if (to > today) return showError("لا يمكن اختيار تاريخ في المستقبل.");
        const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
        if (span > MAX_DAYS) return showError("أقصى مدة يمكن عرضها هي سنتان تقريبًا.");
        showError("");
        selectRange("custom", { from, to });
    });

    // Dismiss a touch tooltip when tapping anywhere outside the chart.
    document.addEventListener("pointerdown", (e) => {
        const wrap = document.getElementById("liveSparkWrap");
        if (wrap && !wrap.contains(e.target) && sparkState.active >= 0) {
            sparkState.active = -1;
            document.getElementById("liveSparkTip")?.setAttribute("hidden", "");
            renderSparkline(sparkState.daily);
        }
    });
}

function startLiveStats() {
    if (!document.getElementById("liveStats")) return; // this script only ever runs on about.html
    initRangePicker();
    fetchLiveStats();
    setInterval(() => {
        if (!document.hidden && sparkState.active < 0) fetchLiveStats();
    }, LIVE_POLL_MS);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) fetchLiveStats();
    });
}

// ── Rich popovers (active learning tracks · content creators) ───────────────
const TRACK_LABELS = {
    University: "المرحلة الجامعية",
    High: "المرحلة الثانوية",
    Middle: "المرحلة الإعدادية",
    Primary: "المرحلة الابتدائية",
};

const popState = { kind: null, anchor: null, pinned: false, closeTimer: 0, openTimer: 0 };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function buildTracksBody(data) {
    const frag = document.createDocumentFragment();
    frag.append(el("p", "stat-pop-note", "المسار النشط هو مرحلة دراسية يوجد فيها مقرر واحد على الأقل."));
    const tracks = Array.isArray(data?.educationTracks) ? data.educationTracks : [];
    if (!tracks.length) {
        frag.append(el("p", "stat-pop-empty", "لا توجد تفاصيل متاحة حاليًا."));
        return frag;
    }
    const list = el("ul", "stat-pop-list");
    tracks.forEach((t) => {
        const li = el("li", "stat-pop-row");
        const name = el("span", "stat-pop-name");
        name.append(el("b", "", TRACK_LABELS[t.type] || t.type));
        if (!TRACK_LABELS[t.type]) name.lastChild.dir = "auto";
        li.append(name, el("span", "stat-pop-count", `${formatCount(t.courses)} مقرر`));
        list.append(li);
    });
    frag.append(list);
    return frag;
}

function buildCreatorsBody(data) {
    const frag = document.createDocumentFragment();
    frag.append(el("p", "stat-pop-note", "مرتّبون حسب عدد الامتحانات والدروس التي نشروها."));
    const creators = Array.isArray(data?.topCreators) ? data.topCreators : [];
    if (!creators.length) {
        frag.append(el("p", "stat-pop-empty", "لا توجد تفاصيل متاحة حاليًا."));
        return frag;
    }
    const list = el("ul", "stat-pop-list");
    creators.forEach((c, i) => {
        const li = el("li", "stat-pop-row stat-pop-row--person");
        const link = c.handle ? el("a", "stat-pop-link") : el("span", "stat-pop-link");
        if (c.handle) {
            link.href = `/@${encodeURIComponent(c.handle)}`;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
        }
        const rank = el("span", "stat-pop-rank", String(i + 1));
        const avatar = el("span", "stat-pop-avatar");
        const src = resolveMediaUrl(c.avatarUrl || "");
        if (src) {
            const img = document.createElement("img");
            img.src = src;
            img.alt = "";
            img.loading = "lazy";
            img.width = 36;
            img.height = 36;
            img.addEventListener("error", () => { img.remove(); avatar.textContent = (c.displayName || "?").trim().charAt(0); });
            avatar.append(img);
        } else {
            avatar.textContent = (c.displayName || c.handle || "?").trim().charAt(0);
        }
        const text = el("span", "stat-pop-text");
        const nameLine = el("span", "stat-pop-nameline");
        nameLine.append(el("b", "", c.displayName || c.handle || "صانع محتوى"));
        nameLine.append(el("em", c.isOwner ? "stat-pop-badge stat-pop-badge--dev" : "stat-pop-badge", c.isOwner ? "مطوّر المنصة" : "مشرف"));
        text.append(nameLine, el("span", "stat-pop-sub", `${formatCount(c.quizzes)} امتحان · ${formatCount(c.lessons)} درس`));
        link.append(rank, avatar, text);
        li.append(link);
        list.append(li);
    });
    frag.append(list);
    return frag;
}

const POP_CONFIG = {
    tracks: { title: "المسارات التعليمية النشطة", build: buildTracksBody },
    creators: { title: "أبرز صنّاع المحتوى", build: buildCreatorsBody },
};

const isSheetMode = () => window.matchMedia("(max-width: 640px), (hover: none)").matches;

function renderPopoverContent() {
    const pop = document.getElementById("statPopover");
    if (!pop || !popState.kind) return;
    const cfg = POP_CONFIG[popState.kind];
    pop.replaceChildren();
    const head = el("div", "stat-pop-head");
    head.append(el("strong", "stat-pop-title", cfg.title));
    const close = el("button", "stat-pop-close", "إغلاق");
    close.type = "button";
    close.setAttribute("aria-label", "إغلاق التفاصيل");
    close.addEventListener("click", () => closePopover(true));
    head.append(close);
    pop.append(head);
    const body = el("div", "stat-pop-body");
    if (platformData) body.append(cfg.build(platformData));
    else body.append(el("p", "stat-pop-empty", "جارٍ التحميل…"));
    pop.append(body);
    pop.setAttribute("aria-label", cfg.title);
}

function positionPopover() {
    const pop = document.getElementById("statPopover");
    const anchor = popState.anchor;
    if (!pop || !anchor || pop.hidden) return;
    pop.classList.toggle("is-sheet", isSheetMode());
    if (isSheetMode()) {
        pop.classList.remove("is-above");
        pop.style.top = pop.style.left = "";
        return;
    }
    const section = pop.offsetParent || pop.parentElement;
    const sRect = section.getBoundingClientRect();
    const aRect = anchor.getBoundingClientRect();
    const width = Math.min(340, sRect.width - 16);
    pop.style.width = `${width}px`;
    let left = aRect.left + aRect.width / 2 - sRect.left - width / 2;
    left = Math.min(Math.max(left, 8), sRect.width - width - 8);
    pop.style.left = `${left}px`;
    // Open below the card; flip above when the viewport has no room underneath.
    const height = pop.offsetHeight;
    const roomBelow = window.innerHeight - aRect.bottom;
    const above = roomBelow < height + 20 && aRect.top > height + 20;
    pop.classList.toggle("is-above", above);
    pop.style.top = above
        ? `${aRect.top - sRect.top - height - 10}px`
        : `${aRect.bottom - sRect.top + 10}px`;
    // Arrow follows the card centre.
    const arrow = aRect.left + aRect.width / 2 - sRect.left - left;
    pop.style.setProperty("--arrow-x", `${Math.min(Math.max(arrow, 18), width - 18)}px`);
}

function openPopover(anchor, pinned) {
    const pop = document.getElementById("statPopover");
    const backdrop = document.getElementById("statPopoverBackdrop");
    if (!pop) return;
    clearTimeout(popState.closeTimer);
    const kind = anchor.dataset.pop;
    if (popState.anchor && popState.anchor !== anchor) popState.anchor.setAttribute("aria-expanded", "false");
    popState.kind = kind;
    popState.anchor = anchor;
    popState.pinned = pinned;
    anchor.setAttribute("aria-expanded", "true");
    renderPopoverContent();
    pop.hidden = false;
    if (backdrop) backdrop.hidden = !isSheetMode();
    positionPopover();
    requestAnimationFrame(() => pop.classList.add("is-open"));
}

function closePopover(returnFocus = false) {
    const pop = document.getElementById("statPopover");
    const backdrop = document.getElementById("statPopoverBackdrop");
    if (!pop || pop.hidden) return;
    clearTimeout(popState.closeTimer);
    clearTimeout(popState.openTimer);
    const anchor = popState.anchor;
    pop.classList.remove("is-open");
    pop.hidden = true;
    if (backdrop) backdrop.hidden = true;
    if (anchor) {
        anchor.setAttribute("aria-expanded", "false");
        if (returnFocus) anchor.focus();
    }
    popState.kind = null;
    popState.anchor = null;
    popState.pinned = false;
}

function refreshPopover() {
    if (popState.kind) renderPopoverContent();
}

function initPopovers() {
    const pop = document.getElementById("statPopover");
    const cards = document.querySelectorAll("[data-pop]");
    if (!pop || !cards.length) return;

    const scheduleClose = () => {
        if (popState.pinned) return;
        clearTimeout(popState.closeTimer);
        popState.closeTimer = setTimeout(() => closePopover(false), 220);
    };

    cards.forEach((card) => {
        card.addEventListener("pointerenter", (e) => {
            if (e.pointerType !== "mouse" || isSheetMode()) return;
            clearTimeout(popState.closeTimer);
            clearTimeout(popState.openTimer);
            popState.openTimer = setTimeout(() => {
                if (popState.anchor !== card) openPopover(card, false);
            }, 90);
        });
        card.addEventListener("pointerleave", (e) => {
            if (e.pointerType !== "mouse") return;
            clearTimeout(popState.openTimer);
            scheduleClose();
        });
        card.addEventListener("click", () => {
            if (popState.anchor === card && !pop.hidden) {
                if (popState.pinned || isSheetMode()) closePopover(false);
                else popState.pinned = true; // hover-opened → pin on click
            } else {
                openPopover(card, true);
            }
        });
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                card.click();
            }
        });
    });

    pop.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse") clearTimeout(popState.closeTimer);
    });
    pop.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") scheduleClose();
    });
    document.getElementById("statPopoverBackdrop")?.addEventListener("click", () => closePopover(false));
    document.addEventListener("pointerdown", (e) => {
        if (pop.hidden) return;
        if (pop.contains(e.target) || popState.anchor?.contains(e.target)) return;
        closePopover(false);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !pop.hidden) closePopover(true);
    });
    window.addEventListener("resize", positionPopover);
}

// ── Open-source card ────────────────────────────────────────────────────────
const REPO_API = "https://api.github.com/repos/BelalAmrMohamed/Basmagi-Quiz";

async function loadRepoStats() {
    const stars = document.getElementById("ossStars");
    const forks = document.getElementById("ossForks");
    if (!stars || !forks) return;
    const apply = (d) => {
        if (typeof d?.stargazers_count === "number") {
            stars.textContent = `★ ${formatCount(d.stargazers_count)} نجمة`;
            stars.hidden = false;
        }
        if (typeof d?.forks_count === "number") {
            forks.textContent = `${formatCount(d.forks_count)} Fork`;
            forks.hidden = false;
        }
    };
    try {
        const cached = JSON.parse(sessionStorage.getItem("about_repo_stats") || "null");
        if (cached && Date.now() - cached.t < 10 * 60 * 1000) return apply(cached.d);
    } catch (_) { /* ignore */ }
    try {
        const res = await fetch(REPO_API, { headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        apply(d);
        try { sessionStorage.setItem("about_repo_stats", JSON.stringify({ t: Date.now(), d: { stargazers_count: d.stargazers_count, forks_count: d.forks_count } })); } catch (_) { /* ignore */ }
    } catch (_) {
        // Rate-limited or offline: the badges simply stay hidden.
    }
}

function initCloneCopy() {
    const btn = document.getElementById("ossCopyBtn");
    const cmd = document.getElementById("ossCloneCmd");
    const status = document.getElementById("ossCopyStatus");
    if (!btn || !cmd) return;
    btn.addEventListener("click", async () => {
        const text = cmd.textContent.trim();
        let ok = false;
        try {
            await navigator.clipboard.writeText(text);
            ok = true;
        } catch (_) {
            try {
                const range = document.createRange();
                range.selectNodeContents(cmd);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                ok = document.execCommand("copy");
            } catch (__) { ok = false; }
        }
        btn.textContent = ok ? "تم النسخ" : "انسخ يدويًا";
        if (status) status.textContent = ok ? "تم نسخ الأمر إلى الحافظة." : "تعذّر النسخ تلقائيًا، حدّد الأمر وانسخه يدويًا.";
        clearTimeout(btn._t);
        btn._t = setTimeout(() => {
            btn.textContent = "نسخ";
            if (status) status.textContent = "";
        }, 2200);
    });
}

function init() {
    loadPlatformStats();
    loadPlatformProfile();
    initPopovers();
    startLiveStats();
    initCloneCopy();
    loadRepoStats();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
    init();
}

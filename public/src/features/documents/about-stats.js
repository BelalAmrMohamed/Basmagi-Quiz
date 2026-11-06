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

async function loadPlatformStats() {
    const container = document.getElementById("platformStats");
    if (!container) return; // this script only ever runs on about.html

    try {
        const res = await fetch(STATS_ENDPOINT);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const stats = await res.json();

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
// Total views, "online now", views today and a 30-day sparkline, all from one
// aggregate-only endpoint (the edge caches it for ~10 s, so polling is cheap).
const LIVE_ENDPOINT = "/api/admin?liveStats=true";
const LIVE_POLL_MS = 15000;
const SPARK_H = 72;
const SPARK_PAD = { top: 10, bottom: 6, side: 5 };
const SVG_NS = "http://www.w3.org/2000/svg";

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

const sparkState = { daily: [], drawn: false, resizeBound: false };

function formatDay(day) {
    try {
        return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long" }).format(
            new Date(`${day}T12:00:00`),
        );
    } catch (_) {
        return day;
    }
}

function renderSparkline(daily) {
    const wrap = document.getElementById("liveSparkWrap");
    const svg = document.getElementById("liveSpark");
    const tip = document.getElementById("liveSparkTip");
    if (!wrap || !svg || !daily.length) return;
    sparkState.daily = daily;

    const w = Math.max(160, Math.round(wrap.clientWidth || 300));
    const h = SPARK_H;
    const rtl = getComputedStyle(wrap).direction === "rtl";
    const innerW = w - SPARK_PAD.side * 2;
    const innerH = h - SPARK_PAD.top - SPARK_PAD.bottom;
    const max = Math.max(1, ...daily.map((d) => d.views));
    const n = daily.length;

    // Arabic (RTL) pages read the timeline right → left: oldest day on the right.
    const points = daily.map((d, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const x = SPARK_PAD.side + (rtl ? 1 - t : t) * innerW;
        const y = SPARK_PAD.top + innerH - (d.views / max) * innerH;
        return { x, y };
    });
    const ordered = rtl ? [...points].reverse() : points; // path must run left → right
    const top = SPARK_PAD.top;
    const bottom = SPARK_PAD.top + innerH;
    const line = smoothPath(ordered, top, bottom);
    const area = `${line} L${ordered[ordered.length - 1].x.toFixed(1)},${bottom} L${ordered[0].x.toFixed(1)},${bottom} Z`;
    const total = daily.reduce((sum, d) => sum + d.views, 0);

    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("aria-label", `رسم بياني لمشاهدات آخر ${formatCount(n)} يومًا، بإجمالي ${formatCount(total)} مشاهدة`);

    const defs = svgEl("defs");
    const grad = svgEl("linearGradient", { id: "liveSparkFill", x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(
        svgEl("stop", { offset: "0%", "stop-color": "currentColor", "stop-opacity": 0.28 }),
        svgEl("stop", { offset: "100%", "stop-color": "currentColor", "stop-opacity": 0 }),
    );
    defs.append(grad);

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
    svg.append(defs, areaEl, lineEl, dot, guide, hoverDot);
    sparkState.drawn = true;

    const hide = () => {
        guide.setAttribute("visibility", "hidden");
        hoverDot.setAttribute("visibility", "hidden");
        if (tip) tip.hidden = true;
    };
    const show = (clientX) => {
        const rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        const x = ((clientX - rect.left) / rect.width) * w;
        let best = 0;
        for (let i = 1; i < points.length; i++) {
            if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i;
        }
        const p = points[best];
        guide.setAttribute("x1", p.x);
        guide.setAttribute("x2", p.x);
        hoverDot.setAttribute("cx", p.x);
        hoverDot.setAttribute("cy", p.y);
        guide.setAttribute("visibility", "visible");
        hoverDot.setAttribute("visibility", "visible");
        if (tip) {
            tip.textContent = `${formatDay(daily[best].day)} | ${formatCount(daily[best].views)} مشاهدة`;
            tip.style.left = `${Math.min(Math.max((p.x / w) * 100, 14), 86)}%`;
            tip.hidden = false;
        }
    };
    wrap.onpointermove = (e) => show(e.clientX);
    wrap.onpointerdown = (e) => show(e.clientX);
    wrap.onpointerleave = hide;
    wrap.onpointercancel = hide;

    if (!sparkState.resizeBound && typeof ResizeObserver === "function") {
        sparkState.resizeBound = true;
        let lastWidth = wrap.clientWidth;
        new ResizeObserver(() => {
            if (Math.abs(wrap.clientWidth - lastWidth) < 4) return;
            lastWidth = wrap.clientWidth;
            renderSparkline(sparkState.daily);
        }).observe(wrap);
    }
}

function applyLiveStats(stats) {
    const online = document.getElementById("liveOnlineCount");
    // The visitor reading this page is online by definition (the beacon's own
    // hit can land after this response), so never show 0.
    if (online) animateNumber(online, Math.max(1, stats.onlineNow || 0));
    animateNumber(document.getElementById("liveTotalViews"), stats.totalViews || 0);
    animateNumber(document.getElementById("liveTodayViews"), stats.viewsToday || 0);
    document.getElementById("liveCardTotal")?.classList.remove("platform-stat-loading");
    document.getElementById("liveCardToday")?.classList.remove("platform-stat-loading");
    if (Array.isArray(stats.daily)) renderSparkline(stats.daily);
}

let liveLoaded = false;
async function fetchLiveStats() {
    try {
        const res = await fetch(LIVE_ENDPOINT, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        applyLiveStats(await res.json());
        liveLoaded = true;
    } catch (err) {
        console.error("[about-stats] Failed to load live stats:", err);
        if (!liveLoaded) {
            // Settle on a plain "—" instead of shimmering forever.
            document.getElementById("liveCardTotal")?.classList.remove("platform-stat-loading");
            document.getElementById("liveCardToday")?.classList.remove("platform-stat-loading");
        }
    }
}

function startLiveStats() {
    if (!document.getElementById("liveStats")) return; // this script only ever runs on about.html
    fetchLiveStats();
    setInterval(() => {
        if (!document.hidden) fetchLiveStats();
    }, LIVE_POLL_MS);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) fetchLiveStats();
    });
}

function init() {
    loadPlatformStats();
    loadPlatformProfile();
    startLiveStats();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
    init();
}

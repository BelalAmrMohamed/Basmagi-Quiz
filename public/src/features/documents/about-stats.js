// public/src/features/documents/about-stats.js
// Two independent live-loaded pieces for about.html:
//
// 1. Platform stats (quizzes/categories/colleges/creators) shown in the
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
    { valueId: "statValueCategories", cardId: "statCardCategories", key: "totalCategories" },
    { valueId: "statValueColleges", cardId: "statCardColleges", key: "totalColleges" },
    { valueId: "statValueCreators", cardId: "statCardCreators", key: "totalCreators" },
];

function formatCount(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    try {
        return n.toLocaleString("ar-EG");
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

function init() {
    loadPlatformStats();
    loadPlatformProfile();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
    init();
}
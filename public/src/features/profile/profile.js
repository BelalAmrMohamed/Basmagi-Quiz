// public/src/features/profile/profile.js - Enhanced with All Features

import { gameEngine, BADGES } from "../../shared/gameEngine.js";
import { avatarEngine } from "../../shared/avatarEngine.js";
import { getManifest } from "../../shared/quizManifest.js";
import { InfiniteList } from "./infiniteScroll.js";
import { initAvatarPicker } from "../../shared/avatarPicker.js";
import {
  renderActivityHeatmap,
  renderCategoryMastery,
  renderNextBadges,
  renderFlaggedQuestions,
  renderUploadedContent,
  activityLabelFor,
  dateKey,
} from "./profileWidgets.js";

import {
  showNotification,
  _confirm,
  _prompt,
} from "../../components/notifications/notifications.js";
import { getAdminRoleInfo, getToken } from "../../shared/adminAuth.js";
import { userProfile, MAX_BIO_LENGTH } from "../../shared/userProfile.js";
import { renderLevelGauge } from "../../shared/levelGauge.js";
import {
  generateBotAvatarDataUrl,
  loreForBot,
  adminAvatarUrl,
  attachHoverCard,
} from "./leaderboardIdentity.js";

let examList = [];
let examById = new Map();
let badgeById = new Map(BADGES.map((b) => [b.id, b]));
let historyList = null;
let bookmarksList = null;
let fetchedAdminHandle = null;

// Bumped on every refreshUI() call; async renderers that resolve after a
// newer refresh has started check this to avoid clobbering fresher DOM
// state with a stale response (fixes the race between overlapping
// renderLeaderboard/fetchAndRenderAdminStats calls).
let refreshToken = 0;

function setExamList(list) {
  examList = list || [];
  examById = new Map(examList.map((e) => [e.id, e]));
}

export function refreshUI(options = {}) {
  const { skipNetworkFetches = false } = options;
  const myToken = ++refreshToken;
  const user = gameEngine.getUserData();

  // Read once and thread through, instead of every render function
  // independently calling localStorage.getItem("username").
  const hasCustomName = !!localStorage.getItem("username");
  const currentName = localStorage.getItem("username") || "مستخدم";

  renderStats(user);
  renderAvatar(user, currentName);
  renderThumbnail(user);
  renderHistory(user);
  renderBookmarks(user);
  renderBadges(user);
  if (!skipNetworkFetches) {
    renderLeaderboard(user, currentName, myToken);
    // Top Admins gallery ("أفضل المشرفين") — a public showcase of every top
    // admin, not something specific to the viewer. It belongs here, alongside
    // the leaderboard, rather than inside the roleInfo-gated block further
    // down: that block only runs for signed-in admin/dev accounts on their
    // own dashboard, so a regular (or signed-out) user hitting /profile never
    // reached this call and the section stayed permanently hidden for them.
    // renderAdminGallery has no auth dependency — it hits the public
    // /api/admin-stats?leaderboard=true endpoint and hides its own section
    // if the response is empty or the fetch fails — so it's safe to run
    // unconditionally for every viewer here.
    renderAdminGallery(myToken);
  }
  renderActivityHeatmap(user);
  renderCategoryMastery(user, examList);
  renderNextBadges(user);
  renderFlaggedQuestions(user, examList);

  // Uploaded Quizzes History + role-flavored activity heading are both
  // admin/dev-only and both depend on getAdminRoleInfo() resolving below —
  // see the "Handle Admin/Developer Badges" block further down, which is
  // where both actually run for the owner's own dashboard.

  // Update username display
  const nameDisplay = document.getElementById("userNameDisplay");
  if (nameDisplay) {
    nameDisplay.textContent = currentName;
    // Update page title
    document.title = currentName;
  }

  // Update header greeting with the user's name, falling back to the
  // generic title when no username has been set yet
  const headerTitle = document.getElementById("userNameHeader");
  if (headerTitle) {
    const greeting = hasCustomName ? currentName : "لوحة تحكم المستخدم";
    headerTitle.textContent = greeting;
    headerTitle.setAttribute("data-text", greeting);

    headerTitle.classList.add("editable-username");
    headerTitle.title = "انقر لتغيير اسمك";
    headerTitle.onclick = async () => {
      const newName = await _prompt("أدخل اسمك الجديد:", currentName);
      if (newName !== null) {
        const trimmed = newName.trim();
        if (trimmed) {
          localStorage.setItem("username", trimmed);
        } else {
          localStorage.removeItem("username");
        }
        refreshUI({ skipNetworkFetches: true });
        // Let side-menu/avatar Engine know
        window.dispatchEvent(new Event("storage"));
      }
    };
  }

  // Display Admin Handle
  const roleInfo = getAdminRoleInfo();
  // editedAdminHandle wins over the JWT's own `handle` claim once the
  // owner edits their handle this session (see editAdminHandle()) — the
  // JWT itself isn't reissued on edit (would need a re-login round trip),
  // so without this override the page would keep showing the pre-edit
  // handle from the token until the 4h JWT naturally expires.
  const currentHandle =
    window.editedAdminHandle || roleInfo?.handle || window.fetchedAdminHandle;
  const adminHandleWrap = document.getElementById("adminHandleDisplayWrap");
  if (adminHandleWrap && currentHandle) {
    document.getElementById("adminHandleDisplay").textContent =
      "@" + currentHandle;
    adminHandleWrap.style.display = "inline-flex";

    const copyBtn = document.getElementById("inlineCopyLinkBtn");
    if (copyBtn) {
      copyBtn.onclick = () => {
        const url = window.location.origin + "/@" + currentHandle;
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(url).then(() => {
            copyBtn.classList.add("is-copied");
            showNotification("تم نسخ رابط الحساب بنجاح");
            setTimeout(() => {
              copyBtn.classList.remove("is-copied");
            }, 2000);
          });
        } else {
          _prompt("انسخ الرابط التالي:", url);
        }
      };
    }

    // Editing is admin/dev-only (own dashboard, never on visitor view —
    // setupVisitorView() below wires this same wrapper differently and
    // never calls this block). roleInfo is only truthy on the owner's own
    // dashboard, so gate the affordance on it rather than on currentHandle
    // alone.
    const editBtn = document.getElementById("editHandleBtn");
    if (editBtn && roleInfo) {
      editBtn.style.display = "inline-flex";
      editBtn.onclick = () => editAdminHandle(currentHandle);
    }
  }

  // Profile description ("bio"). Admin/dev accounts get the server-backed
  // editor (persisted on admin_users.bio, visible on /@handle visitor
  // view); regular users have no server account at all here, so they get
  // a purely localStorage-backed bio via userProfile (see
  // setupBioEditor()'s isAdmin branch below) — visible only on their own
  // dashboard, never shareable, since there's no public profile URL for
  // an anonymous device-tracked user to view it on.
  setupBioEditor(!!roleInfo);

  // Handle Admin/Developer Badges for Owner View
  if (roleInfo) {
    applyRoleBadges(roleInfo.role, roleInfo.isOwner);
    setActivityLabel(roleInfo);
    // Uploaded Quizzes History — admin/dev only, own dashboard. Runs
    // regardless of skipNetworkFetches: unlike the leaderboard/admin-stats
    // sync below, a local-only refresh (e.g. after deleting a history
    // entry) shouldn't touch this network call, but it also never ran yet
    // on the very first load in that branch — so gate it the same way
    // fetchAndRenderAdminStats is gated, on skipNetworkFetches.
    if (!skipNetworkFetches) {
      renderUploadedContent();
    }
    if (!skipNetworkFetches) {
      // isVisitorContext=false: this is the owner's own dashboard, so the
      // response is a sync confirmation only — it never overwrites the
      // localStorage-driven totalPoints/totalQuizzes/totalBadges/currentLevel.
      fetchAndRenderAdminStats(undefined, myToken, false).then((result) => {
        if (result) {
          setupSocialLinks(true, result.socialLinks || {});
        }
      });
    } else {
      // Even on a local-only refresh (skipNetworkFetches), show the social
      // links strip in owner mode (icons will be populated once a full refresh
      // runs; for now just show the connect button).
      setupSocialLinks(true, currentSocialLinks);
    }
  } else {
    setActivityLabel(null);
  }
}

// Sets the activity-card heading text based on role: "نشاط المشرف" for
// admins, "نشاط المطور" for developers/devs, plain "نشاطك" for everyone else
// (regular users, or before role info has resolved).
function setActivityLabel(roleInfo) {
  // Text lives in a dedicated inner span (not the h3 itself) so this can
  // update the label without wiping out the heading's .section-icon SVG.
  const titleEl = document.getElementById("activityHeatmapTitleText");
  if (titleEl) titleEl.textContent = activityLabelFor(roleInfo);
}

function applyRoleBadges(role, isOwner) {
  const roleBadge = document.getElementById("roleBadge");
  if (!roleBadge) return;

  roleBadge.style.display = "inline-flex";
  roleBadge.setAttribute("role", "button");
  roleBadge.setAttribute("tabindex", "0");
  roleBadge.onclick = () => openRoleInfoModal(isOwner);
  roleBadge.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openRoleInfoModal(isOwner);
    }
  };

  if (isOwner) {
    roleBadge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
    roleBadge.className = "role-badge developer-badge";
    roleBadge.title = "مطور";
    roleBadge.setAttribute("aria-label", "مطور — اضغط لمعرفة المزيد");
  } else if (role === "admin") {
    roleBadge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    roleBadge.className = "role-badge admin-badge";
    roleBadge.title = "مشرف";
    roleBadge.setAttribute("aria-label", "مشرف — اضغط لمعرفة المزيد");
  }
}

// Top Admins gallery ("أفضل المشرفين") — horizontal, scrollable strip of
// every top admin (not just the current viewer). Public: shown at the
// bottom of .profile-main on a visited /@handle profile, and on /profile
// for every viewer regardless of role — signed-out, regular signed-in, or
// admin/dev alike — since it's a showcase of the platform's admins, not a
// personal dashboard widget. (Previously the /profile call site sat inside
// the roleInfo-gated block in refreshUI(), so it only ever rendered for a
// signed-in admin/dev viewing their own dashboard; every other visitor
// saw #adminGallerySection stay in its default `display:none`. Moved to
// run alongside the leaderboard instead.) Data source is the same endpoint
// the old admin leaderboard card used (/api/admin-stats?leaderboard=true —
// see admin.js's isLeaderboard branch) — handle, avatar, role, isOwner, and
// uploaded-quiz count per admin — just rendered as gallery cards instead of
// leaderboard rows. Needs no auth: it's a public GET and the function hides
// its own section if the response is empty or the fetch fails.
let adminGalleryArrowsWired = false;
async function renderAdminGallery(myToken = refreshToken) {
  const section = document.getElementById("adminGallerySection");
  const galleryEl = document.getElementById("adminGallery");
  if (!section || !galleryEl) return;

  let admins = [];
  try {
    const res = await fetch("/api/admin-stats?leaderboard=true");
    // A newer refreshUI() call started while this fetch was in flight —
    // discard this response so it can't overwrite fresher DOM state.
    if (myToken !== refreshToken) return;
    if (res.ok) admins = await res.json();
  } catch (e) {
    // no-op: section stays hidden below, same as the old leaderboard's
    // silent-fail-to-empty-state behavior.
  }

  if (!Array.isArray(admins) || admins.length === 0) {
    section.style.display = "none";
    galleryEl.innerHTML = "";
    return;
  }

  galleryEl.innerHTML = admins
    .map((entry) => {
      const displayName = entry.displayName || entry.handle;
      const avatar = adminAvatarUrl(entry);
      const quizzes = (entry.totalQuizzes || 0).toLocaleString();
      const lessons = (entry.totalLessons || 0).toLocaleString();
      const handle = (entry.handle || "").replace(/^@/, "");
      const profileHref = handle ? `/@${encodeURIComponent(handle)}` : null;

      let badgeHtml = "";
      if (entry.isOwner) {
        badgeHtml = `<span class="admin-gallery-badge role-badge developer-badge" title="مطور" aria-label="مطور"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>`;
      } else if (entry.role === "admin") {
        badgeHtml = `<span class="admin-gallery-badge role-badge admin-badge" title="مشرف" aria-label="مشرف"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>`;
      }

      const hasBadge = !!(entry.isOwner || entry.role === "admin");
      const avatarClass = hasBadge ? "admin-gallery-avatar has-badge" : "admin-gallery-avatar";

      const cardInner = `
        <span class="admin-gallery-avatar-wrap">
          <img class="${avatarClass}" src="${avatar}" alt="الصورة الشخصية لـ ${displayName}" loading="lazy" width="96" height="96">
          ${badgeHtml}
        </span>
        <span class="admin-gallery-handle" dir="ltr">@${handle}</span>
        <span class="admin-gallery-meta">${quizzes} امتحان • ${lessons} درس</span>
      `;

      return profileHref
        ? `<a class="admin-gallery-item" role="listitem" href="${profileHref}" aria-label="عرض الملف الشخصي لـ ${displayName}">${cardInner}</a>`
        : `<div class="admin-gallery-item" role="listitem">${cardInner}</div>`;
    })
    .join("");

  section.style.display = "";

  if (!adminGalleryArrowsWired) {
    adminGalleryArrowsWired = true;
    const prevBtn = document.getElementById("adminGalleryPrev");
    const nextBtn = document.getElementById("adminGalleryNext");
    // One card's worth of scroll per click (avatar + gaps); recalculated
    // per click rather than cached, since the gallery's contents (and
    // therefore item width) can change between refreshes.
    const scrollByCard = (dir) => {
      const item = galleryEl.querySelector(".admin-gallery-item");
      const amount = item ? item.getBoundingClientRect().width + 16 : 200;
      galleryEl.scrollBy({ left: dir * amount, behavior: "smooth" });
    };
    // RTL-aware: "prev"/"next" here mean visually left/right arrow
    // buttons, not fixed scroll directions, so the actual scrollBy sign
    // is derived from the page's own direction rather than hardcoded.
    const isRtl = document.documentElement.dir === "rtl";
    if (prevBtn) {
      prevBtn.onclick = () => scrollByCard(isRtl ? 1 : -1);
    }
    if (nextBtn) {
      nextBtn.onclick = () => scrollByCard(isRtl ? -1 : 1);
    }
    // Bug 4: the arrows are only useful when the strip actually overflows
    // its container — with few admins (or a wide viewport) everything
    // fits and the arrows would just sit there doing nothing. Re-checked
    // on resize since the overflow state depends on viewport width, not
    // just item count.
    window.addEventListener("resize", updateAdminGalleryArrowVisibility);
  }

  updateAdminGalleryArrowVisibility();
}

// Shows/hides .admin-gallery-arrow buttons based on whether #adminGallery
// currently overflows horizontally. Safe to call any time after the
// gallery has been rendered (including from the resize listener below,
// where the gallery may since have been emptied/hidden).
//
// Uses removeProperty() rather than setting display:"" so the existing
// @media (max-width: 480px) { display: none } rule in profile.css can
// still win on small screens — an inline style="" left behind by a wider
// viewport would otherwise out-specificity that media query once set.
function updateAdminGalleryArrowVisibility() {
  const galleryEl = document.getElementById("adminGallery");
  const prevBtn = document.getElementById("adminGalleryPrev");
  const nextBtn = document.getElementById("adminGalleryNext");
  if (!galleryEl || !prevBtn || !nextBtn) return;

  const isOverflowing = galleryEl.scrollWidth > galleryEl.clientWidth;
  [prevBtn, nextBtn].forEach((btn) => {
    if (isOverflowing) {
      btn.style.removeProperty("display");
    } else {
      btn.style.display = "none";
    }
  });
}

// Role info modal — replaces the old generic showNotification() toast on
// #roleBadge click with a small dismissible overlay (same .contact-overlay
// shell as #userInfoOverlay / #contactDevOverlay) that explains, in plain
// Arabic, what "مطور" (developer/owner) vs "مشرف" (admin) actually means.
// Works identically on the owner's own dashboard and on public /@handle
// profiles, since it only needs the isOwner flag already resolved by
// applyRoleBadges()'s caller in both contexts.
function openRoleInfoModal(isOwner) {
  const overlay = document.getElementById("roleInfoOverlay");
  if (!overlay) return;

  const titleEl = document.getElementById("roleInfoTitle");
  const descEl = document.getElementById("roleInfoDesc");
  const iconEl = document.getElementById("roleInfoIcon");

  if (isOwner) {
    iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
    iconEl.className = "role-info-icon developer-badge";
    titleEl.textContent = "مطور";
    descEl.textContent =
      "هذا الحساب هو حساب أحد مطوري المنصة، ولديه صلاحية كاملة على النظام، بما في ذلك إدارة المستخدمين والامتحانات والإعدادات.";
  } else {
    iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    iconEl.className = "role-info-icon admin-badge";
    titleEl.textContent = "مشرف";
    descEl.textContent =
      "هذا الحساب مشرف على المنصة، ولديه صلاحيات إدارية مثل مراجعة البلاغات ورفع الامتحانات، دون الوصول لكامل إعدادات النظام.";
  }

  overlay.style.display = "flex";
}

function closeRoleInfoModal() {
  const overlay = document.getElementById("roleInfoOverlay");
  if (overlay) overlay.style.display = "none";
}
window.closeRoleInfoModal = closeRoleInfoModal;

// isVisitorContext controls whether totalPoints/totalQuizzes/totalBadges/
// currentLevel get written to the DOM from this response.
//   - Own dashboard: NO. Those four are localStorage-only, always — the
//     local copy (gameEngine) is the source of truth for what the owner
//     sees. The DB row is synced FROM local (see syncProgressToServer),
//     never the other way, so this response should never write over them.
//   - Visitor view: YES. An anonymous visitor can't read someone else's
//     localStorage, so this DB-mirrored response is the only source of
//     that data available at all.
async function fetchAndRenderAdminStats(
  handle = null,
  myToken = refreshToken,
  isVisitorContext = false,
) {
  document.getElementById("adminStatsGrid").style.display = "grid";
  try {
    const token = getToken();
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let url = "/api/admin-stats";
    if (handle) url += `?handle=${encodeURIComponent(handle)}`;

    const res = await fetch(url, { headers });
    const data = await res.json();

    // A newer refreshUI() call started while this fetch was in flight —
    // discard this response so it can't overwrite fresher DOM state.
    if (myToken !== refreshToken) return;

    if (res.ok) {
      if (data.handle) fetchedAdminHandle = data.handle;
      // Own-dashboard bio (isVisitorContext=false): setupBioEditor() runs
      // synchronously earlier in refreshUI(), before this fetch resolves,
      // so it can't know the bio yet on first paint. Stash it for next
      // time (same pattern fetchedAdminHandle uses above) AND patch the
      // already-rendered display directly here, so the owner doesn't see
      // the "أضف وصفاً..." empty state flash before a real bio loads.
      if (!isVisitorContext) {
        window.fetchedAdminBio = data.bio || "";
        if (myToken === refreshToken) renderBioDisplay(window.fetchedAdminBio);
      }

      document.getElementById("adminUploadedQuizzes").textContent =
        data.uploadedQuizzes || 0;
      const lessonsEl = document.getElementById("adminUploadedLessons");
      if (lessonsEl) lessonsEl.textContent = data.uploadedLessons || 0;
      const notebooksEl = document.getElementById("adminUploadedNotebooks");
      if (notebooksEl) notebooksEl.textContent = data.uploadedNotebooks || 0;
      document.getElementById("adminReportsCount").textContent =
        data.reportsCount || 0;
      document.getElementById("adminResolvedReportsCount").textContent =
        data.resolvedReports || 0;

      if (isVisitorContext) {
        // Public stats grid — only meaningful here, see comment above.
        if (
          document.getElementById("totalPoints") &&
          typeof data.totalPoints !== "undefined"
        ) {
          document.getElementById("totalPoints").textContent = data.totalPoints;
        }
        if (
          document.getElementById("totalQuizzes") &&
          typeof data.totalQuizzes !== "undefined"
        ) {
          document.getElementById("totalQuizzes").textContent =
            data.totalQuizzes;
        }
        if (
          document.getElementById("totalBadges") &&
          typeof data.totalBadges !== "undefined"
        ) {
          document.getElementById("totalBadges").textContent = data.totalBadges;
        }
        if (
          document.getElementById("currentLevel") &&
          typeof data.currentLevel !== "undefined"
        ) {
          document.getElementById("currentLevel").textContent =
            data.currentLevel;
        }
      }

      // Return a richer object so callers (visitor view) can act on
      // avatar/thumbnail/totals directly after the fetch resolves.
      return {
        role: data.role,
        isOwner: !!data.isOwner,
        avatarUrl: data.avatarUrl || null,
        thumbnailUrl: data.thumbnailUrl || null,
        displayName: data.displayName || null,
        bio: data.bio || null,
        uploadedQuizzes: data.uploadedQuizzes || 0,
        uploadedNotebooks: data.uploadedNotebooks || 0,
        socialLinks: data.socialLinks || {},
        totalPoints:
          typeof data.totalPoints !== "undefined" ? data.totalPoints : 0,
        totalQuizzes:
          typeof data.totalQuizzes !== "undefined" ? data.totalQuizzes : 0,
        totalBadges:
          typeof data.totalBadges !== "undefined" ? data.totalBadges : 0,
        currentLevel:
          typeof data.currentLevel !== "undefined" ? data.currentLevel : 1,
        activityHeatmap: data.activityHeatmap || {},
      };
    }
  } catch (e) { }
  return null;
}

// Pushes local progress (points/quizzes/badges/level) up to admin_users so
// the DB row — which visitor view and the leaderboard read from — reflects
// real activity instead of sitting at its seeded/zero values forever.
// Fire-and-forget: local is always the source of truth for the owner's own
// UI, so a failed sync here is not user-visible and not worth surfacing.
// Guarded to admin/dev accounts only (getAdminRoleInfo() / getToken()) —
// regular/anonymous users have no admin_users row to sync to.
let progressSyncInFlight = false;
async function syncProgressToServer() {
  if (progressSyncInFlight) return;

  const roleInfo = getAdminRoleInfo();
  if (!roleInfo) return;
  const token = getToken();
  if (!token) return;

  const user = gameEngine.getUserData();
  // Use the same computed-from-history total that renderStats() uses for
  // the owner's own #totalPoints display (user.totalPoints itself is not
  // reliably kept in sync — see renderStats' computedTotalPoints comment).
  // Syncing the raw field here previously reintroduced the wrong-score bug
  // on visitor view even after #totalPoints itself was fixed locally.
  const computedTotalPoints = (user.history || []).reduce(
    (s, h) => s + (h.pointsEarned || 0),
    0,
  );
  const levelInfo = gameEngine.calculateLevel(computedTotalPoints);

  // Build the same date->count map renderActivityHeatmap derives from
  // user.history, so the DB mirror (and therefore visitor view) has real
  // activity data instead of staying at its seeded/empty default forever.
  const activityHeatmap = {};
  (user.history || []).forEach((h) => {
    const d = new Date(h.date);
    if (isNaN(d)) return;
    const key = dateKey(d);
    activityHeatmap[key] = (activityHeatmap[key] || 0) + 1;
  });

  progressSyncInFlight = true;
  try {
    await fetch("/api/admin-stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        totalPoints: computedTotalPoints,
        totalQuizzes: user.history ? user.history.length : 0,
        totalBadges: user.badges ? user.badges.length : 0,
        currentLevel: levelInfo.level || 1,
        displayName: localStorage.getItem("username") || undefined,
        avatarUrl: localStorage.getItem("quiz_user_avatar") || undefined,
        thumbnailUrl: localStorage.getItem("quiz_user_thumbnail") || undefined,
        activityHeatmap,
      }),
      // keepalive lets this survive a tab-hide/navigate-away without being
      // cancelled mid-flight, since one of the two call sites is exactly that.
      keepalive: true,
    });
  } catch (err) {
    console.error("Failed to sync progress to server", err);
  } finally {
    progressSyncInFlight = false;
  }
}

// Prompts the owner for a new handle, validates it client-side (mirrors
// api/_handle.js's rules so obviously-invalid input never round-trips to
// the server), then submits it. On success, overrides what's shown for
// the rest of this session (see currentHandle's comment above) — the JWT
// itself still carries the old handle until the next login.
async function editAdminHandle(currentHandle) {
  const input = await _prompt("أدخل معرّفك الجديد (بدون @):", currentHandle || "");
  if (input === null) return; // cancelled

  const trimmed = input.trim().replace(/^@+/, "");
  if (!trimmed || trimmed === currentHandle) return;

  const cleanHandle = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 30);

  if (cleanHandle.length < 3) {
    showNotification("المعرّف قصير جداً (الحد الأدنى 3 أحرف)", "", "error");
    return;
  }

  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch("/api/admin-stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ handle: cleanHandle }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showNotification(data.error || "تعذّر حفظ المعرّف", "", "error");
      return;
    }

    window.editedAdminHandle = data.handle || cleanHandle;
    showNotification("تم تحديث المعرّف بنجاح", "", "success");
    refreshUI({ skipNetworkFetches: true });
  } catch (err) {
    console.error("Failed to update handle", err);
    showNotification("تعذّر الاتصال بالخادم", "", "error");
  }
}

// Renders the current bio (or empty state) into the read-only display and
// wires the edit button to a save/cancel textarea, mirroring the
// editable-username inline pattern above but as a dedicated small form
// since a single-line _prompt() isn't a great fit for multi-line bio text.
//
// Two persistence paths, chosen by `isAdmin`:
//   - Admin/dev accounts: server-backed (admin_users.bio via
//     /api/admin-stats), also shown on the public /@handle visitor view.
//   - Regular users: no server account exists for them at all (see
//     api/user-profile.js — device_id there only tracks quiz progress,
//     never identity fields), so this is purely a localStorage round trip
//     through userProfile.getBio()/setBio(), own-dashboard only.
function setupBioEditor(isAdmin) {
  const wrapEl = document.getElementById("profileBioWrap");
  const editBtn = document.getElementById("editBioBtn");
  const formEl = document.getElementById("profileBioForm");
  const textareaEl = document.getElementById("profileBioTextarea");
  const saveBtn = document.getElementById("saveBioBtn");
  const cancelBtn = document.getElementById("cancelBioBtn");
  const counterEl = document.getElementById("profileBioCounter");
  if (!wrapEl || !editBtn || !formEl || !textareaEl) return;

  // Read fresh at call time rather than captured once in a closure —
  // setupBioEditor() runs synchronously in refreshUI(), before the async
  // admin-stats fetch resolves, so a captured `const currentBio` here
  // would freeze at "" for admins and never reflect a bio saved on a
  // previous load. window.fetchedAdminBio is updated in place as soon as
  // that fetch resolves (see fetchAndRenderAdminStats), so calling this
  // again later — e.g. when the edit button is actually clicked — always
  // returns the latest known value.
  function getCurrentBio() {
    return isAdmin ? window.fetchedAdminBio || "" : userProfile.getBio();
  }

  renderBioDisplay(getCurrentBio());
  // Own dashboard (admin or regular user) always shows the bio row, with
  // its empty-state prompt when unset — unlike visitor view (admin/dev
  // only; regular users have no shareable profile URL), which only
  // reveals it once a real bio value comes back from the server. See
  // setupVisitorView().
  wrapEl.style.display = "flex";

  editBtn.onclick = () => {
    textareaEl.value = getCurrentBio();
    updateCounter();
    wrapEl.style.display = "none";
    formEl.style.display = "flex";
    textareaEl.focus();
  };

  cancelBtn.onclick = () => {
    formEl.style.display = "none";
    wrapEl.style.display = "flex";
  };

  function updateCounter() {
    if (!counterEl) return;
    counterEl.textContent = `${textareaEl.value.length}/${MAX_BIO_LENGTH}`;
  }
  textareaEl.oninput = updateCounter;

  saveBtn.onclick = async () => {
    const newBio = textareaEl.value.trim();
    if (newBio.length > MAX_BIO_LENGTH) {
      showNotification(
        `الوصف طويل جداً (الحد الأقصى ${MAX_BIO_LENGTH} حرف)`,
        "",
        "error",
      );
      return;
    }

    if (!isAdmin) {
      // Local-only save — no network round trip, no auth required.
      userProfile.setBio(newBio);
      renderBioDisplay(newBio);
      formEl.style.display = "none";
      wrapEl.style.display = "flex";
      showNotification("تم تحديث الوصف بنجاح", "", "success");
      return;
    }

    const token = getToken();
    if (!token) return;

    saveBtn.disabled = true;
    try {
      const res = await fetch("/api/admin-stats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bio: newBio || null }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showNotification(data.error || "تعذّر حفظ الوصف", "", "error");
        return;
      }

      window.fetchedAdminBio = newBio;
      renderBioDisplay(newBio);
      formEl.style.display = "none";
      wrapEl.style.display = "flex";
      showNotification("تم تحديث الوصف بنجاح", "", "success");
    } catch (err) {
      console.error("Failed to update bio", err);
      showNotification("تعذّر الاتصال بالخادم", "", "error");
    } finally {
      saveBtn.disabled = false;
    }
  };
}

function renderBioDisplay(bio) {
  const displayEl = document.getElementById("profileBioDisplay");
  if (!displayEl) return;
  if (bio) {
    displayEl.textContent = bio;
    displayEl.classList.remove("profile-bio-empty");
  } else {
    displayEl.textContent = "أضف وصفاً عن نفسك...";
    displayEl.classList.add("profile-bio-empty");
  }
}

// ============================================================
// SOCIAL LINKS — render brand icons, owner connect modal
// ============================================================

const SOCIAL_ICONS = {
  linkedin: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/></svg>`,
  github: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.73.5.98 5.24.98 11.52c0 5.02 3.26 9.28 7.78 10.78.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.11-3.17.69-3.84-1.34-3.84-1.34-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.67 1.24 3.32.95.1-.74.4-1.24.72-1.53-2.53-.29-5.19-1.27-5.19-5.63 0-1.24.44-2.26 1.17-3.06-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.17a10.9 10.9 0 0 1 5.72 0c2.18-1.48 3.14-1.17 3.14-1.17.62 1.57.23 2.73.11 3.02.73.8 1.17 1.82 1.17 3.06 0 4.37-2.67 5.34-5.21 5.62.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.66.79.55A11.03 11.03 0 0 0 23.02 11.5C23.02 5.24 18.27.5 12 .5z"/></svg>`,
  telegram: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.820 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.782-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`,
  whatsapp: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`,
};

const SOCIAL_LABELS = {
  linkedin: "LinkedIn",
  github: "GitHub",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

// Normalize a raw user input into a full URL for a given platform.
// Returns empty string if the input is blank.
function normalizeSocialUrl(platform, raw) {
  const val = (raw || "").trim();
  if (!val) return "";
  if (platform === "linkedin") {
    // Accept: full URL or username
    const m = val.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
    if (m) return `https://linkedin.com/in/${m[1]}`;
    // Plain username
    return `https://linkedin.com/in/${val.replace(/^\/+/, "")}`;
  }
  if (platform === "github") {
    const m = val.match(/github\.com\/([^/?#\s]+)/i);
    if (m) return `https://github.com/${m[1]}`;
    return `https://github.com/${val.replace(/^\/+/, "")}`;
  }
  if (platform === "telegram") {
    const m = val.match(/t\.me\/([^/?#\s]+)/i);
    if (m) return `https://t.me/${m[1]}`;
    // Strip @ prefix
    return `https://t.me/${val.replace(/^@+/, "")}`;
  }
  if (platform === "whatsapp") {
    const m = val.match(/wa\.me\/([0-9]+)/i);
    if (m) return `https://wa.me/${m[1]}`;
    // Strip non-digits for plain phone
    const digits = val.replace(/\D/g, "");
    if (digits) return `https://wa.me/${digits}`;
    return "";
  }
  return val;
}

// Extract display text from a full URL (for pre-filling the input fields).
function socialUrlToInput(platform, url) {
  if (!url) return "";
  if (platform === "linkedin") {
    const m = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
    return m ? m[1] : url;
  }
  if (platform === "github") {
    const m = url.match(/github\.com\/([^/?#\s]+)/i);
    return m ? m[1] : url;
  }
  if (platform === "telegram") {
    const m = url.match(/t\.me\/([^/?#\s]+)/i);
    return m ? `@${m[1]}` : url;
  }
  if (platform === "whatsapp") {
    const m = url.match(/wa\.me\/([0-9]+)/i);
    return m ? m[1] : url;
  }
  return url;
}

// Render social link icon anchors into #profileSocialLinks.
function renderSocialLinkIcons(links) {
  const container = document.getElementById("profileSocialLinks");
  if (!container) return;
  container.innerHTML = "";
  const platforms = ["linkedin", "github", "telegram", "whatsapp"];
  platforms.forEach((p) => {
    const url = links[p];
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = `social-link-icon is-${p}`;
    a.setAttribute("aria-label", SOCIAL_LABELS[p]);
    a.setAttribute("title", SOCIAL_LABELS[p]);
    a.setAttribute("role", "listitem");
    a.innerHTML = SOCIAL_ICONS[p];
    container.appendChild(a);
  });
}

// Show/hide the social wrap + connect button based on context.
// isAdmin = true  → owner dashboard (can connect)
// isAdmin = false → visitor (read-only)
let currentSocialLinks = {};
function setupSocialLinks(isAdmin, links) {
  currentSocialLinks = links || {};
  const wrap = document.getElementById("profileSocialWrap");
  const connectBtn = document.getElementById("connectSocialBtn");
  if (!wrap) return;

  renderSocialLinkIcons(currentSocialLinks);

  const hasLinks = Object.values(currentSocialLinks).some(Boolean);
  // Show the wrap if owner (always, so they can add links) or if visitor with links
  if (isAdmin || hasLinks) {
    wrap.style.display = "flex";
  } else {
    wrap.style.display = "none";
  }
  if (connectBtn) {
    connectBtn.style.display = isAdmin ? "" : "none";
    // Update button text to reflect whether links are already set
    const btnText = document.getElementById("connectSocialBtnText");
    if (btnText) {
      btnText.textContent = hasLinks ? "تعديل وسائل التواصل" : "ربط وسائل التواصل";
    }
    connectBtn.onclick = openSocialLinksModal;
  }
}

function openSocialLinksModal() {
  const overlay = document.getElementById("socialLinksOverlay");
  if (!overlay) return;
  // Pre-fill inputs with current values (decoded to display format)
  ["linkedin", "github", "telegram", "whatsapp"].forEach((p) => {
    const input = document.getElementById(`socialInput${p.charAt(0).toUpperCase() + p.slice(1)}`);
    if (input) input.value = socialUrlToInput(p, currentSocialLinks[p] || "");
  });
  const statusEl = document.getElementById("socialSaveStatus");
  if (statusEl) statusEl.textContent = "";
  overlay.style.display = "";
  // Focus first input
  const first = document.getElementById("socialInputLinkedin");
  if (first) setTimeout(() => first.focus(), 50);
}

function closeSocialLinksModal() {
  const overlay = document.getElementById("socialLinksOverlay");
  if (overlay) overlay.style.display = "none";
}

async function saveSocialLinks() {
  const saveBtn = document.getElementById("saveSocialLinksBtn");
  const statusEl = document.getElementById("socialSaveStatus");
  if (saveBtn) saveBtn.disabled = true;
  if (statusEl) statusEl.textContent = "جارٍ الحفظ...";

  const platforms = ["linkedin", "github", "telegram", "whatsapp"];
  const newLinks = {};
  platforms.forEach((p) => {
    const input = document.getElementById(`socialInput${p.charAt(0).toUpperCase() + p.slice(1)}`);
    newLinks[p] = normalizeSocialUrl(p, input ? input.value : "");
  });

  try {
    const token = getToken();
    const res = await fetch("/api/admin-stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ socialLinks: newLinks }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentSocialLinks = newLinks;
    renderSocialLinkIcons(currentSocialLinks);
    const hasLinks = Object.values(currentSocialLinks).some(Boolean);
    const wrap = document.getElementById("profileSocialWrap");
    if (wrap) wrap.style.display = "flex";
    const btnText = document.getElementById("connectSocialBtnText");
    if (btnText) btnText.textContent = hasLinks ? "تعديل وسائل التواصل" : "ربط وسائل التواصل";
    if (statusEl) statusEl.textContent = "✓ تم الحفظ";
    setTimeout(closeSocialLinksModal, 800);
  } catch (e) {
    console.error("Failed to save social links", e);
    if (statusEl) statusEl.textContent = "حدث خطأ، حاول مرة أخرى";
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function wireSocialLinksModal() {
  const closeBtn = document.getElementById("closeSocialLinksBtn");
  const cancelBtn = document.getElementById("cancelSocialLinksBtn");
  const saveBtn = document.getElementById("saveSocialLinksBtn");
  const overlay = document.getElementById("socialLinksOverlay");
  if (closeBtn) closeBtn.onclick = closeSocialLinksModal;
  if (cancelBtn) cancelBtn.onclick = closeSocialLinksModal;
  if (saveBtn) saveBtn.onclick = saveSocialLinks;
  // Close on backdrop click
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeSocialLinksModal();
    });
  }
  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay && overlay.style.display !== "none") {
      closeSocialLinksModal();
    }
  });
}

async function setupVisitorView(handle) {
  // Setup UI for visitor view
  document.querySelectorAll(".content-section").forEach((el) => {
    // renderUploadedContent() below manages this section's own display
    // (shows it once uploads resolve, hides it on fetch failure) — if
    // the blanket hide here ran after that resolves, it would clobber it.
    if (el.id === "uploadedQuizzesSection") return;
    el.style.display = "none";
  });
  const masteryCard = document.querySelector(".category-mastery-card");
  if (masteryCard) masteryCard.style.display = "none";

  // .profile-rail on a visited /@handle profile carries nothing a visitor
  // can see: badges, next-badges, and stats are all developer-only, and the
  // local leaderboard hides itself for visitors too (renderLeaderboard's
  // isVisitor check). Rather than leave the rail's 340px column visible
  // but empty, hide the whole rail and collapse the grid to one column.
  const profileRail = document.querySelector(".profile-rail");
  if (profileRail) profileRail.style.display = "none";
  const profileLayout = document.querySelector(".profile-layout");
  if (profileLayout) profileLayout.classList.add("no-rail");

  const heatmapCard = document.querySelector(".heatmap-widget-card");
  if (heatmapCard) heatmapCard.style.display = "";

  document.getElementById("avatarEditBtn").style.display = "none";
  document.getElementById("thumbnailEditBtn").style.display = "none";
  document.getElementById("weeklyRecap").style.display = "none";
  // Bio/handle editing is developer-only — visitor view only ever shows the
  // read-only bio text (populated below once fetchAndRenderAdminStats
  // resolves) and never renders the edit affordances at all.
  const editBioBtn = document.getElementById("editBioBtn");
  if (editBioBtn) editBioBtn.style.display = "none";
  const editHandleBtn = document.getElementById("editHandleBtn");
  if (editHandleBtn) editHandleBtn.style.display = "none";

  const displayNameMeta = document.querySelector(
    'meta[name="admin:display-name"]',
  );
  const publicName =
    displayNameMeta && displayNameMeta.content
      ? displayNameMeta.content
      : handle;
  const headerTitle = document.getElementById("userNameHeader");
  if (headerTitle) {
    headerTitle.textContent = publicName;
    headerTitle.setAttribute("data-text", publicName);
    headerTitle.classList.remove("editable-username");
    headerTitle.removeAttribute("title");
    headerTitle.onclick = null;
  }

  // Avatar: render immediately from the server-injected meta tag (no extra
  // round-trip) if present, so visitor view isn't stuck with the blank
  // public/src="" it starts with. fetchAndRenderAdminStats also returns avatarUrl
  // below as a fallback in case the meta tag is ever missing/stale.
  const avatarMeta = document.querySelector('meta[name="admin:avatar"]');
  renderVisitorAvatar(avatarMeta ? avatarMeta.content : null, handle);

  // Thumbnail (profile banner): same render-immediately-from-meta-tag
  // reasoning as the avatar above. render-profile.js always emits this tag
  // (falling back server-side to the default Featured Thumbnail, 2.jpg,
  // when the admin hasn't set one), so there's no "missing meta -> no
  // thumbnail" state to handle here — just a defensive fallback to the
  // same default in case this HTML was served/cached before the tag existed.
  const thumbnailMeta = document.querySelector('meta[name="admin:thumbnail"]');
  const identityThumbnailEl = document.getElementById("identityThumbnail");
  if (identityThumbnailEl) {
    const thumbnailValue =
      thumbnailMeta && thumbnailMeta.content
        ? thumbnailMeta.content
        : "/assets/profile-featured/thumbnails/2.jpg";
    identityThumbnailEl.style.backgroundImage =
      backgroundImageFor(thumbnailValue);
    identityThumbnailEl.classList.add("has-thumbnail");
  }

  // Fetch the visited user's stats, and — since the endpoint is the only
  // source of truth on this page for who the visited user actually is —
  // read role/isOwner from its response instead of assuming "admin" for
  // every visitor (that previously mislabeled regular users as admins).
  // Uploaded content (quizzes + lessons) — public on /@handle for whichever
  // admin/dev this profile belongs to. Started BEFORE the stats await so the
  // two requests run in parallel and the section shows its shimmer rows from
  // the first frame instead of popping in after the stats resolve. Not
  // awaited: it manages its own section visibility/loading state. Runs
  // unconditionally (no skipNetworkFetches gate, unlike the owner-dashboard
  // call in refreshUI()) since visitor view has no local-only refresh path.
  renderUploadedContent(handle);

  const visitedRole = await fetchAndRenderAdminStats(
    handle,
    refreshToken,
    true,
  );

  // Activity heatmap title: same role-flavored label as the owner's own
  // dashboard (setActivityLabel/activityLabelFor), just fed the visited
  // user's role/isOwner instead of the local getAdminRoleInfo() result.
  setActivityLabel(visitedRole);

  // Override the meta-rendered avatar/thumbnail with the freshly-fetched
  // admin row when available. The meta tags are only an optimization for
  // first-paint; they can be stale if the owner recently updated their
  // avatar/thumbnail, so prefer the live API response when it arrives.
  if (visitedRole && visitedRole.avatarUrl) {
    renderVisitorAvatar(visitedRole.avatarUrl, handle);
  }

  if (identityThumbnailEl) {
    if (visitedRole && visitedRole.thumbnailUrl) {
      identityThumbnailEl.style.backgroundImage = backgroundImageFor(
        visitedRole.thumbnailUrl,
      );
      identityThumbnailEl.classList.add("has-thumbnail");
      identityThumbnailEl.classList.remove("is-default-thumbnail");
    } else if (!thumbnailMeta) {
      // No thumbnail set server-side either — show a distinct generated
      // gradient banner (different visual treatment than the circular
      // avatar) so defaults are clearly distinct. thumbnailGradientForName
      // (not gradientForName) — see renderThumbnail()'s comment for why:
      // the visitor-view default avatar (renderVisitorAvatar, below) is
      // also generated from this same handle, and gradientForName would
      // hand back the same palette entry its background gradient uses.
      try {
        const grad = avatarEngine.thumbnailGradientForName(handle || "?");
        identityThumbnailEl.style.backgroundImage = `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`;
        identityThumbnailEl.classList.add("is-default-thumbnail");
        identityThumbnailEl.classList.remove("has-thumbnail");
      } catch (e) {
        // fall back to the shipped featured thumbnail image
        identityThumbnailEl.style.backgroundImage = `url('/assets/profile-featured/thumbnails/2.jpg')`;
        identityThumbnailEl.classList.add("has-thumbnail");
      }
    }
  }

  // Initialize the level gauge for visitor context too, using the
  // server-mirrored totalPoints so the radial gauge appears on public
  // profiles as well.
  if (visitedRole) {
    const pts =
      typeof visitedRole.totalPoints !== "undefined"
        ? visitedRole.totalPoints
        : 0;
    try {
      const levelInfo = gameEngine.calculateLevel(pts);
      renderLevelGauge(levelInfo);
    } catch (e) {
      console.error("Failed to init visitor level gauge", e);
    }
  }

  if (visitedRole && visitedRole.displayName) {
    const headerTitle = document.getElementById("userNameHeader");
    if (headerTitle) {
      headerTitle.textContent = visitedRole.displayName;
      headerTitle.setAttribute("data-text", visitedRole.displayName);
    }
  }

  // Visitor bio — read-only, and the whole wrap stays hidden (its default
  // state, set in profile.html) when the visited admin never wrote one,
  // rather than showing the owner-dashboard "أضف وصفاً عن نفسك..." empty
  // state prompt to someone who can't act on it.
  const bioWrap = document.getElementById("profileBioWrap");
  const bioDisplay = document.getElementById("profileBioDisplay");
  if (bioWrap && bioDisplay && visitedRole && visitedRole.bio) {
    bioDisplay.textContent = visitedRole.bio;
    bioDisplay.classList.remove("profile-bio-empty");
    bioWrap.style.display = "flex";
  }

  if (visitedRole && (visitedRole.role || visitedRole.isOwner)) {
    applyRoleBadges(visitedRole.role, !!visitedRole.isOwner);
  }

  // Social links — visitor view: read from API response (most up to date)
  // and render as read-only icons (no connect button).
  if (visitedRole) {
    setupSocialLinks(false, visitedRole.socialLinks || {});
  }
  // Top Admins gallery — same call as the owner-dashboard path in
  // refreshUI(); visitor view has no local-only refresh gate, so this
  // just runs unconditionally here.
  renderAdminGallery(refreshToken);
  if (!avatarMeta && visitedRole && visitedRole.avatarUrl) {
    renderVisitorAvatar(visitedRole.avatarUrl, handle);
  }
  if (
    !thumbnailMeta &&
    visitedRole &&
    visitedRole.thumbnailUrl &&
    identityThumbnailEl
  ) {
    identityThumbnailEl.style.backgroundImage = backgroundImageFor(
      visitedRole.thumbnailUrl,
    );
    identityThumbnailEl.classList.add("has-thumbnail");
  }

  // If the server returned an activityHeatmap for this visited profile,
  // render the heatmap by converting the date->count map into a
  // user.history-like array the existing renderer understands.
  const historyArr = [];
  if (visitedRole && visitedRole.activityHeatmap) {
    const map = visitedRole.activityHeatmap;
    Object.keys(map).forEach((date) => {
      const count = Number(map[date]) || 0;
      for (let i = 0; i < count; i++) {
        historyArr.push({ date });
      }
    });
  }
  try {
    renderActivityHeatmap({ history: historyArr });
  } catch (e) {
    console.error("Failed to render visitor heatmap", e);
  }

  // Display Admin Handle for Visitor View
  const adminHandleWrap = document.getElementById("adminHandleDisplayWrap");
  if (adminHandleWrap && handle) {
    document.getElementById("adminHandleDisplay").textContent = "@" + handle;
    adminHandleWrap.style.display = "inline-flex";

    const copyBtn = document.getElementById("inlineCopyLinkBtn");
    if (copyBtn) {
      copyBtn.onclick = () => {
        const url = window.location.origin + "/@" + handle;
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(url).then(() => {
            copyBtn.classList.add("is-copied");
            showNotification("تم نسخ الرابط بنجاح");
            setTimeout(() => {
              copyBtn.classList.remove("is-copied");
            }, 2000);
          });
        } else {
          _prompt("انسخ الرابط التالي:", url);
        }
      };
    }
  }
}

function renderVisitorAvatar(avatarUrl, handle) {
  const img = document.getElementById("avatarImage");
  if (!img) return;

  if (avatarUrl) {
    img.src = avatarUrl;
  } else {
    // Same generated-initial fallback avatarEngine.generateDefaultAvatarSVG
    // produces for the owner's own view, kept local here since visitor view
    // has no gameEngine user object to derive a name from — just the handle.
    const svg = avatarEngine.generateDefaultAvatarSVG(handle);
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }
  img.alt = `الصورة الشخصية لـ ${handle}`;
}

// Delete history entry
window.deleteHistory = async function (index) {
  if (!(await _confirm("هل أنت متأكد من حذف هذا الامتحان؟ "))) return;

  const user = gameEngine.getUserData();
  user.history.splice(index, 1);
  gameEngine.saveUserData(user);

  // Update UI immediately without reload. Local stats/badges/streaks are
  // recalculated (deleting an entry can change them), but the leaderboard
  // rank and admin stats come from the server and don't change from a
  // purely local delete, so we skip re-fetching them.
  refreshUI({ skipNetworkFetches: true });
};

// Remove bookmark
window.removeBookmark = async function (key) {
  if (!(await _confirm("إزالة من المفضلة؟"))) return;

  const user = gameEngine.getUserData();
  if (user.bookmarks && user.bookmarks[key]) {
    delete user.bookmarks[key];
    gameEngine.saveUserData(user);
  }

  // Update UI immediately without reload; see note above re: skipping
  // the network-bound leaderboard/admin-stats fetches here.
  refreshUI({ skipNetworkFetches: true });
};

// Single delegated listener for dynamically-rendered list-item buttons
// (delete-history / remove-bookmark). Set up once here rather than via
// inline onclick="..." attributes rebuilt into every row's HTML string —
// avoids re-registering per render and avoids interpolating values
// (like bookmark keys) directly into onclick attribute strings.
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  if (target.dataset.action === "delete-history") {
    window.deleteHistory(Number(target.dataset.index));
  } else if (target.dataset.action === "remove-bookmark") {
    window.removeBookmark(target.dataset.key);
  }
});

// Delegate badge flip toggles for phones and click/touch interaction
document.addEventListener("click", (event) => {
  const badge = event.target.closest(".dash-badge");
  if (badge) {
    const isRevealed = badge.classList.contains("is-revealed");
    document.querySelectorAll(".dash-badge.is-revealed").forEach((b) => {
      if (b !== badge) b.classList.remove("is-revealed");
    });
    badge.classList.toggle("is-revealed", !isRevealed);
    return;
  }
  // Clicked outside badges: reset all flipped badges
  document.querySelectorAll(".dash-badge.is-revealed").forEach((b) => {
    b.classList.remove("is-revealed");
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    const badge = event.target.closest(".dash-badge");
    if (badge) {
      event.preventDefault();
      badge.classList.toggle("is-revealed");
    }
  }
});

// ============================================================
// SKELETON / FIRST-PAINT HANDSHAKE
// ------------------------------------------------------------
// profile.html marks .container with .is-profile-loading in inline critical
// CSS (so it applies before profile.css has downloaded) and paints
// #profileSkeleton. Everything above the fold on this page — points, level,
// badge count, history, heatmap — comes from localStorage via gameEngine and
// needs no network at all, so the skeleton only has to survive until the
// first synchronous render, not until the API calls finish.
// ============================================================
let skeletonDismissed = false;

function hideProfileSkeleton() {
  if (skeletonDismissed) return;
  skeletonDismissed = true;

  const container = document.querySelector(".container");
  if (container) container.classList.remove("is-profile-loading");

  // Clear the aria-live region rather than leaving "loading…" parked in it,
  // which would otherwise be re-announced by some screen readers on any
  // later DOM mutation inside it.
  const status = document.getElementById("profileLoadingStatus");
  if (status) status.textContent = "";

  // Drop the skeleton nodes from the DOM once the cross-fade has finished
  // rather than leaving ~40 shimmer elements running compositor animations
  // behind a display:none for the life of the page.
  const skeleton = document.getElementById("profileSkeleton");
  if (skeleton) {
    setTimeout(() => skeleton.remove(), 260);
  }

  window.__profileSkeletonHidden = true;
}

// Visitor view (/@handle) only: .is-data-loading is set by profile.html's
// bootstrap script and shimmers the stat numbers + heatmap until the API data
// lands (see profile.css). Separate from the skeleton above on purpose — the
// hero is ready immediately, the data is not.
function clearDataLoading() {
  const container = document.querySelector(".container");
  if (container) container.classList.remove("is-data-loading");
}
setTimeout(clearDataLoading, 8000);

// Failsafe. If a render throws before reaching the normal dismissal below,
// the user would otherwise be stuck staring at a shimmer forever — far worse
// than the blank page this replaced. Deliberately generous: it should never
// be what actually fires.
setTimeout(hideProfileSkeleton, 8000);

// ============================================================
// TOUCH / KEYBOARD AFFORDANCE FOR THE EMPTY-STATE ICON DRAW
// ------------------------------------------------------------
// The stroke-draw was hover-only, so on touch devices it never ran. On
// pointer-coarse devices, run it briefly when an empty state scrolls into
// view instead (see .empty-state.is-drawing in profile.css). Skipped
// entirely under prefers-reduced-motion.
// ============================================================
function initEmptyStateIconDraw() {
  if (typeof window.matchMedia !== "function") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!window.matchMedia("(hover: none)").matches) return;
  if (typeof IntersectionObserver !== "function") return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-drawing");
        // One pass, then stop — an infinite alternate loop on a phone is
        // needless battery drain for a decorative flourish.
        setTimeout(() => entry.target.classList.remove("is-drawing"), 2400);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.4 },
  );

  const scan = () => {
    document
      .querySelectorAll(".empty-state:not([data-draw-bound])")
      .forEach((el) => {
        el.setAttribute("data-draw-bound", "1");
        observer.observe(el);
      });
  };

  scan();
  // Empty states are injected asynchronously by the widget renderers, so
  // re-scan as they arrive rather than only at load.
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// MANIFEST HYDRATION (non-blocking)
// ------------------------------------------------------------
// getManifest() hits three Supabase tables behind a 15s timeout. It used to
// be awaited before ANY rendering, which is what made this page sit blank
// for up to ten seconds. Nothing above the fold depends on it: examList is
// only read to resolve exam titles/categories in category-mastery, flagged
// questions, and history rows. So: paint from localStorage first, fetch the
// manifest in parallel, and re-render only the two widgets that consume it
// when (or if) it lands.
// ============================================================
function hydrateManifest({ isVisitorView = false } = {}) {
  return getManifest()
    .then((manifest) => {
      setExamList(manifest.examList || []);
      window.__examListCache = examList;

      // Visitor view (/@handle) hides every developer-only section — history,
      // bookmarks, flagged questions, category mastery — because they're
      // sourced from the VIEWER's own localStorage, not the visited user's.
      // Re-rendering them here would quietly repopulate those hidden
      // sections with the viewer's private data, so cache the list and stop.
      if (isVisitorView) return manifest;

      // Re-render only the manifest-dependent widgets. Everything else is
      // already on screen and correct; re-running the full refreshUI() here
      // would re-trigger the network fetches and reset scroll positions in
      // the infinite lists.
      const user = gameEngine.getUserData();
      renderCategoryMastery(user, examList);
      renderFlaggedQuestions(user, examList);
      renderHistory(user);
      return manifest;
    })
    .catch((err) => {
      // Non-fatal by design. Without titles the affected rows fall back to
      // their IDs, which is a far better outcome than a blank page.
      console.error("Failed to load quiz manifest:", err);
      return null;
    });
}

// Defers non-critical work to the first idle slot so it can't compete with
// the first paint. Falls back to a short timeout on Safari, which still
// doesn't ship requestIdleCallback.
function whenIdle(fn, timeout = 1200) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn, { timeout });
  } else {
    setTimeout(fn, 1);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Wire social links modal buttons (overlay backdrop is handled by the
  // generic .contact-overlay loop below, so only the close/cancel/save
  // buttons are wired here, plus the Escape key).
  wireSocialLinksModal();

  // Add overlay backdrop click handler for all contact overlays
  document.querySelectorAll(".contact-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.style.display = "none";
    });
  });

  // Guard: Only run profile initialisation if we're on the profile page
  if (!document.getElementById("totalPoints")) {
    // Still clear the skeleton — another page reusing this bundle should
    // never inherit a stuck loading state.
    hideProfileSkeleton();
    return;
  }

  const adminHandleMeta = document.querySelector('meta[name="admin:handle"]');
  const isVisitorView = !!adminHandleMeta;

  // Kick the manifest off IMMEDIATELY, before any rendering, but do not
  // await it — this is the single change that takes first paint from
  // "whenever Supabase answers" to "next frame".
  const manifestPromise = hydrateManifest({ isVisitorView });

  if (isVisitorView) {
    const visitedHandle = adminHandleMeta.content;
    const currentToken = ++refreshToken;

    // setupVisitorView() is async (it awaits admin-stats internally) but
    // everything it does BEFORE that await is synchronous DOM work — the
    // rail hiding, avatar/thumbnail from meta tags, the name. Not awaiting
    // it here lets the leaderboard fetch start in the same tick instead of
    // queueing behind the stats call.
    const visitorReady = setupVisitorView(visitedHandle);
    // Stats + heatmap are in (or failed) once setupVisitorView settles — drop
    // the data shimmer either way so it can never get stuck.
    visitorReady.finally(clearDataLoading);

    // Real leaderboard, with the visited profile's row highlighted instead
    // of the viewer's own (the viewer has no meaningful position here, and
    // may not even be an admin) — see renderLeaderboard's visitedHandle param.
    const leaderboardReady = renderLeaderboard(
      {},
      "User",
      currentToken,
      visitedHandle,
    );

    // The identity band is fully populated from the server-injected meta
    // tags by this point, so the skeleton has nothing left to hide.
    hideProfileSkeleton();

    // Kept only so an unhandled rejection in either can't surface as a
    // console error the user can't act on; both already handle their own
    // failures internally.
    Promise.allSettled([visitorReady, leaderboardReady, manifestPromise]);
  } else {
    // refreshUI() is synchronous apart from the network calls it fires and
    // forgets, and reads entirely from localStorage — so this paints the
    // real dashboard on the very next frame.
    refreshUI();
    hideProfileSkeleton();

    // Avatar picker pulls in the cropper/featured-avatar machinery and is
    // only needed once the user actually clicks edit. Deferring it off the
    // critical path keeps it out of the first-paint budget.
    whenIdle(() => initAvatarPicker());

    window.addEventListener("avatarUpdated", () => {
      const currentName = localStorage.getItem("username") || "مستخدم";
      renderAvatar(gameEngine.getUserData(), currentName);
    });

    window.addEventListener("thumbnailUpdated", () => {
      renderThumbnail(gameEngine.getUserData());
    });

    // Push local progress to the DB on load, and again whenever the tab is
    // hidden/backgrounded (covers navigating away, switching tabs, closing
    // the tab on most browsers) — see syncProgressToServer for why this
    // never feeds back into what's rendered on this page.
    //
    // Now idle-deferred: it's a pure write with no effect on anything
    // rendered here, so letting it contend with first paint bought nothing.
    whenIdle(() => syncProgressToServer(), 3000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        syncProgressToServer();
      }
    });
  }

  initEmptyStateIconDraw();
});

function renderAvatar(user, currentName) {
  const img = document.getElementById("avatarImage");
  if (!img) return;

  const stored = avatarEngine.getAvatar();
  const name = currentName || localStorage.getItem("username") || "مستخدم";

  if (stored) {
    img.src = stored;
  } else {
    const svg = avatarEngine.generateDefaultAvatarSVG(name);
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }
  img.alt = `الصورة الشخصية لـ ${name}`;
}

// Wraps a stored avatar/thumbnail value as a CSS background-image, since
// two different shapes of value can end up here: an actual picture (data
// URL or /assets path — needs url(...)) or a raw CSS gradient string from
// the thumbnail preset grid (already valid background-image syntax on its
// own — wrapping it in url(...) would make it an invalid, broken image
// reference). Detected by prefix rather than by mode, since both shapes
// are plain strings by the time they reach here.
function backgroundImageFor(value) {
  return /^linear-gradient\(/.test(value) ? value : `url("${value}")`;
}

// Thumbnail (cover strip) — unlike the avatar, there's no generated
// fallback: no cover set just means .identity-cover stays empty
// (see .has-thumbnail in profile.css, which only applies the scrim/
// background once a picture actually exists).
function renderThumbnail(user) {
  const el = document.getElementById("identityThumbnail");
  if (!el) return;

  const stored = avatarEngine.getThumbnail();
  if (stored) {
    el.style.backgroundImage = backgroundImageFor(stored);
    el.classList.add("has-thumbnail");
  } else {
    // No user-set thumbnail: render a distinct gradient banner instead
    // of leaving the banner blank so avatar vs banner defaults are
    // visually distinct. Uses thumbnailGradientForName (not
    // gradientForName) specifically because gradientForName returns the
    // same palette entry the default avatar's own background is drawn
    // from — reusing it here made the banner and the avatar backdrop the
    // same two colors for every user.
    try {
      const name = localStorage.getItem("username") || "?";
      const grad = avatarEngine.thumbnailGradientForName(name);
      el.style.backgroundImage = `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`;
      el.classList.remove("has-thumbnail");
      el.classList.add("is-default-thumbnail");
    } catch (e) {
      el.style.backgroundImage = "";
      el.classList.remove("has-thumbnail");
      el.classList.remove("is-default-thumbnail");
    }
  }
}

function renderStats(user) {
  // Compute totalPoints from history to keep UI consistent with weekly recap
  const computedTotalPoints = (user.history || []).reduce(
    (s, h) => s + (h.pointsEarned || 0),
    0,
  );
  const levelInfo = gameEngine.calculateLevel(computedTotalPoints);

  // Safely update element helper
  const updateEl = (id, htmlOrText, isHtml = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isHtml) el.innerHTML = htmlOrText;
    else el.textContent = htmlOrText;
  };
  // Core Stats
  updateEl("totalPoints", computedTotalPoints.toLocaleString() || 0);
  updateEl("totalQuizzes", user.history ? user.history.length : 0);
  updateEl("totalBadges", user.badges ? user.badges.length : 0);
  updateEl("currentLevel", levelInfo.level | 0);

  // Level gauge — radial SVG gauge, replaces the old flat bar. Resets
  // visually each level because calculateLevel() already resets
  // pointsInCurrentLevel/progressPercent at each level-up boundary.
  renderLevelGauge(levelInfo);

  // Statistics Sidebar
  const accuracyRateEl = document.getElementById("accuracyRate");
  const perfectScoresEl = document.getElementById("perfectScores");

  if (
    user.history &&
    user.history.length > 0 &&
    accuracyRateEl &&
    perfectScoresEl
  ) {
    const totalCorrect = user.history.reduce(
      (sum, h) => sum + (h.score || 0),
      0,
    );
    const totalQuestions = user.history.reduce(
      (sum, h) => sum + (h.total || 0),
      0,
    );
    const accuracy =
      totalQuestions > 0
        ? Math.round((totalCorrect / totalQuestions) * 100)
        : 0;
    const perfectCount = user.history.filter(
      (h) => h.percentage === 100,
    ).length;

    accuracyRateEl.textContent = `${accuracy}%`;
    perfectScoresEl.textContent = perfectCount;
  }

  if (user.streaks) {
    const currentDaily = user.streaks.currentDaily || 0;
    const longestStreak = user.streaks.longestStreak || 0;
    updateEl(
      "currentStreak",
      ` ${currentDaily === 1 ? "يوم:" : "أيام:"}  ${currentDaily} `,
    );
    updateEl(
      "bestStreak",
      ` ${longestStreak === 1 ? "يوم:" : "أيام:"}  ${longestStreak} `,
    );
  }

  // This-week recap strip
  renderWeeklyRecap(user);
}

function renderWeeklyRecap(user) {
  const el = document.getElementById("weeklyRecap");
  if (!el) return;

  el.setAttribute("aria-live", "polite");

  // Compare against local-midnight boundaries rather than the exact
  // current timestamp: a date-only string like "2026-07-15" parses as
  // UTC midnight, which for timezones behind UTC can fall just outside
  // an exact `now`/`weekAgo` window even though it's still "this week"
  // for the user. Using midnight-anchored boundaries avoids that edge
  // case dropping entries near the week cutoff.
  const now = new Date();
  const todayEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
  const weekAgoStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 7,
    0,
    0,
    0,
    0,
  );

  const recent = (user.history || []).filter((h) => {
    const d = new Date(h.date);
    return !Number.isNaN(d.getTime()) && d >= weekAgoStart && d <= todayEnd;
  });

  if (recent.length === 0) {
    el.textContent = "لم تقم بأي امتحان هذا الأسبوع، ابدأ الآن!";
    return;
  }

  const avgPct = Math.round(
    recent.reduce((sum, h) => sum + (h.percentage || 0), 0) / recent.length,
  );
  const points = recent.reduce((sum, h) => sum + (h.pointsEarned || 0), 0);

  el.textContent = `هذا الأسبوع: ${recent.length} ${recent.length === 1 ? "امتحان" : "امتحانات"} • متوسط ${avgPct}% • +${points.toLocaleString()} نقطة`;
}

function historyItemHtml(attempt, index) {
  const exam = examById.get(attempt.examId);
  const title = exam ? exam.title : "امتحان محذوف";
  const date = new Date(attempt.date).toLocaleDateString();
  const percentage =
    attempt.percentage || Math.round((attempt.score / attempt.total) * 100);

  return `
      <div class="history-item">
        <div class="history-info">
          <h4>${title}</h4>
          <small>${date} • ${attempt.mode || "امتحان"}</small>
        </div>
        <div class="history-actions">
          <div class="history-score ${percentage >= 60 ? "pass" : "fail"
    }">${percentage}%</div>
          ${exam ? `<a href="/quiz/${attempt.examId}" class="nav-btn primary" style="padding:8px 14px;font-size:0.8rem;text-decoration:none;">اذهب إلى الامتحان</a>` : ""}
          <button class="delete-btn" data-action="delete-history" data-index="${index}" aria-label="حذف هذا الامتحان من السجل"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>`;
}

function renderHistory(user) {
  const container = document.getElementById("historyList");
  if (!container) return;

  if (historyList) historyList.destroy();

  historyList = new InfiniteList({
    containerEl: container,
    items: user.history || [],
    renderItem: historyItemHtml,
    emptyHtml: `<div class="empty-state"><div class="empty-state-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path class="icon-line" pathLength="1" d="M3 3v18h18"/><path class="icon-line" pathLength="1" d="M7 15l4-4 3 3 5-6"/></svg></div><h3>لا يوجد سجل امتحانات بعد</h3></div>`,
    mode: "button",
  });
  historyList.mount();
}

function bookmarkItemHtml(key) {
  const [examId, qIdx] = key.split("_");
  const exam = examById.get(examId);
  return `
          <div class="history-item">
            <div class="history-info">
              <h4>${exam ? exam.title : examId}</h4>
              <small>السؤال رقم ${parseInt(qIdx) + 1}</small>
            </div>
            <div class="history-actions">
              <a href="/quiz/${examId}?startAt=${qIdx}" class="nav-btn primary" style="padding:8px 14px;font-size:0.8rem;text-decoration:none;">اذهب إلى السؤال</a>
              <button class="unstar-btn" data-action="remove-bookmark" data-key="${key}" aria-label="إزالة هذا السؤال من المفضلة"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-off-icon lucide-star-off" aria-hidden="true"><path d="m10.344 4.688 1.181-2.393a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.237 3.152"/><path d="m17.945 17.945.43 2.505a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a8 8 0 0 0 .4-.099"/><path d="m2 2 20 20"/></svg></button>
            </div>
          </div>`;
}

function renderBookmarks(user) {
  // Ensure we don't duplicate the section if refreshUI is called
  let bookmarkSection = document.getElementById("bookmarks-section");
  if (!bookmarkSection) {
    bookmarkSection = document.createElement("div");
    bookmarkSection.id = "bookmarks-section";
    bookmarkSection.innerHTML = `
      <h2 style="margin-top:40px;">⭐ الأسئلة المفضلة</h2>
      <div id="bookmarksListContainer" class="history-list"></div>`;
    document.querySelector(".main-content").appendChild(bookmarkSection);
  }

  const container = document.getElementById("bookmarksListContainer");
  if (!container) return;

  const keys = Object.keys(user.bookmarks || {});

  if (bookmarksList) bookmarksList.destroy();

  bookmarksList = new InfiniteList({
    containerEl: container,
    items: keys,
    renderItem: bookmarkItemHtml,
    emptyHtml: `<p>لم تقم بتفضيل أية أسئلة</p>`,
    mode: "button",
  });
  bookmarksList.mount();
}

function renderBadges(user) {
  const container = document.getElementById("badgeContainer");
  if (!container) return;

  container.innerHTML =
    (user.badges || [])
      .map((id) => {
        const b = badgeById.get(id);
        if (!b) return "";
        const descLen = (b.desc || "").length;
        const sizeClass =
          descLen > 28 ? "desc-long" : descLen > 18 ? "desc-medium" : "desc-short";
        return `<div class="dash-badge" tabindex="0" role="button" title="${b.desc}" aria-label="${b.title}: ${b.desc}">
          <div class="badge-icon" aria-hidden="true">${b.icon}</div>
          <div class="badge-title">${b.title}</div>
          <div class="badge-desc-overlay ${sizeClass}" aria-hidden="true">${b.desc}</div>
        </div>`;
      })
      .join("") || "اكسب الشارات بإكمال الامتحانات!";
}

// .profile-rail's local leaderboard hides on a visited /@handle profile
// (the viewer has no meaningful position on someone else's page, and may
// not even be an admin) — see the visitedHandle param, still passed in
// from the visitor-view call site below. The admin leaderboard this
// function used to also populate has been removed entirely in favor of
// the Top Admins gallery (renderAdminGallery) at the bottom of
// .profile-main.
async function renderLeaderboard(
  user,
  currentName,
  myToken = refreshToken,
  visitedHandle = null,
) {
  const localCard = document.getElementById("localLeaderboardCard");
  const localEl = document.getElementById("localLeaderboard");
  if (!localEl) return;

  const displayName =
    currentName || localStorage.getItem("username") || "مستخدم";
  const isVisitor = !!visitedHandle;

  if (localCard) localCard.hidden = isVisitor;

  if (!isVisitor) {
    renderLocalLeaderboard(localEl, user, displayName);
  }
}

function renderLocalLeaderboard(leaderboardEl, user, displayName) {
  const mockUsers = [
    { name: "عم فوزي الحريف", points: 3000 },
    { name: "سيد سِكّة", points: 2000 },
    { name: "زيزو حركات", points: 1500 },
    { name: "علي علكّه", points: 1000 },
    { name: "شيكو الغلبان", points: 500 },
    { name: "زيزي على الهادي", points: 100 },
  ];

  const currentUser = {
    name: `${displayName} (أنت)`,
    points: user.totalPoints || 0,
    isUser: true,
  };

  const all = [...mockUsers, currentUser].sort((a, b) => b.points - a.points);
  const rankedList = all.map((u, i) => ({ ...u, rank: i + 1 }));

  leaderboardEl.innerHTML = rankedList
    .map((entry) => {
      if (entry.isUser) {
        return `
    <div class="lb-row lb-row-avatar highlight" role="listitem" aria-label="الترتيب ${entry.rank}: ${entry.name}، ${entry.points.toLocaleString()} نقطة">
      <span class="lb-rank" aria-hidden="true">${entry.rank}</span>
      <span class="lb-avatar-hover">
        <img class="lb-avatar" src="${document.getElementById("avatarImage")?.src || ""}" alt="" loading="lazy" width="32" height="32">
      </span>
      <span class="lb-name">${entry.name}</span>
      <strong class="lb-metric">${entry.points.toLocaleString()} نقطة</strong>
    </div>`;
      }

      const avatar = generateBotAvatarDataUrl(entry.name);
      return `
    <div class="lb-row lb-row-avatar" role="listitem" aria-label="الترتيب ${entry.rank}: ${entry.name}، ${entry.points.toLocaleString()} نقطة">
      <span class="lb-rank" aria-hidden="true">${entry.rank}</span>
      <span class="lb-avatar-hover">
        <img class="lb-avatar" src="${avatar}" alt="" loading="lazy" width="32" height="32">
      </span>
      <span class="lb-name">${entry.name}</span>
      <strong class="lb-metric">${entry.points.toLocaleString()} نقطة</strong>
    </div>`;
    })
    .join("");

  leaderboardEl.querySelectorAll(".lb-row").forEach((row, i) => {
    const entry = rankedList[i];
    if (entry.isUser) return;
    const avatarHover = row.querySelector(".lb-avatar-hover");
    if (avatarHover) {
      attachHoverCard(
        avatarHover,
        `
        <span class="lb-hover-name">${entry.name}</span>
        <span class="lb-hover-lore">${loreForBot(entry.name)}</span>
      `,
        "lb-hover-card-lore",
      );
    }
  });
}

// Expose for other modules (quiz result flow) to trigger immediate sync
window.syncProgressToServer = syncProgressToServer;
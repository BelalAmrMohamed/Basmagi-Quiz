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
  dateKey,
} from "./profileWidgets.js";

import { confirmationNotification, showNotification, prompt_user } from "../../components/notifications/notifications.js";
import { getAdminRoleInfo, getToken } from "../../shared/adminAuth.js";
import { renderLevelGauge } from "./levelGauge.js";
import {
  generateBotAvatarDataUrl,
  loreForBot,
  adminHoverCardHtml,
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
  renderHistory(user);
  renderBookmarks(user);
  renderBadges(user);
  if (!skipNetworkFetches) {
    renderLeaderboard(user, currentName, myToken);
  }
  renderActivityHeatmap(user);
  renderCategoryMastery(user, examList);
  renderNextBadges(user);
  renderFlaggedQuestions(user, examList);

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
      const newName = await prompt_user("أدخل اسمك الجديد:", currentName);
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

  // Setup User Info Modal
  const showUserInfoBtn = document.getElementById("showUserInfoBtn");
  if (showUserInfoBtn) {
    showUserInfoBtn.onclick = () => {
      document.getElementById("userInfoOverlay").style.display = "flex";
      document.getElementById("infoModalName").textContent = currentName;
      
      const roleInfo = getAdminRoleInfo();
      if (roleInfo && (roleInfo.handle || roleInfo.email || roleInfo.isOwner || roleInfo.role)) {
        document.getElementById("infoModalAdminSection").style.display = "block";
        
        const emailBlock = document.getElementById("infoModalEmail").parentElement;
        if (roleInfo.email) {
          emailBlock.style.display = "flex";
          document.getElementById("infoModalEmail").textContent = roleInfo.email;
        } else {
          emailBlock.style.display = "none";
        }
        
        const handleBlock = document.getElementById("infoModalHandle").parentElement.parentElement;
        const currentHandle = roleInfo.handle || fetchedAdminHandle;
        if (currentHandle) {
          handleBlock.style.display = "flex";
          document.getElementById("infoModalHandle").textContent = "@" + currentHandle;
          
          const copyBtn = document.getElementById("modalCopyLinkBtn");
          if (copyBtn) {
            copyBtn.onclick = () => {
              const url = window.location.origin + "/@" + currentHandle;
              if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(url).then(() => {
                  const orig = copyBtn.innerHTML;
                  copyBtn.innerHTML = "تم النسخ! ✔️";
                  copyBtn.setAttribute("aria-live", "polite");
                  setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
                });
              } else {
                prompt_user("انسخ الرابط التالي:", url);
              }
            };
          }
        } else {
          handleBlock.style.display = "none";
        }
      } else {
        document.getElementById("infoModalAdminSection").style.display = "none";
      }
    };
  }

  // Handle Admin/Developer Badges for Owner View
  const roleInfo = getAdminRoleInfo();
  if (roleInfo) {
    applyRoleBadges(roleInfo.role, roleInfo.isOwner);
    if (!skipNetworkFetches) {
      // isVisitorContext=false: this is the owner's own dashboard, so the
      // response is a sync confirmation only — it never overwrites the
      // localStorage-driven totalPoints/totalQuizzes/totalBadges/currentLevel.
      fetchAndRenderAdminStats(undefined, myToken, false);
    }
  }
}

function applyRoleBadges(role, isOwner) {
  const roleBadge = document.getElementById("roleBadge");
  const avatarBadgeOverlay = document.getElementById("avatarBadgeOverlay");
  
  if (roleBadge) {
    roleBadge.style.display = "inline-flex";
    roleBadge.onclick = () => showNotification(`هذا الحساب يمتلك صلاحيات ${isOwner ? 'مطور' : 'مشرف'}`, "", "info");

    if (isOwner) {
      roleBadge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
      roleBadge.className = "role-badge developer-badge";
      roleBadge.title = "مطور";
      roleBadge.setAttribute("aria-label", "مطور");
    } else if (role === "admin") {
      roleBadge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
      roleBadge.className = "role-badge admin-badge";
      roleBadge.title = "مشرف";
      roleBadge.setAttribute("aria-label", "مشرف");
    }
  }

  if (avatarBadgeOverlay) {
    avatarBadgeOverlay.style.display = "block";
    if (isOwner) {
      avatarBadgeOverlay.src = "../../../assets/images/white-icon.png";
      avatarBadgeOverlay.alt = "شارة المطور";
    } else if (role === "admin") {
      avatarBadgeOverlay.src = "../../../favicon.png";
      avatarBadgeOverlay.alt = "شارة المشرف";
    }
  }
}

// isVisitorContext controls whether totalPoints/totalQuizzes/totalBadges/
// currentLevel get written to the DOM from this response.
//   - Own dashboard: NO. Those four are localStorage-only, always — the
//     local copy (gameEngine) is the source of truth for what the owner
//     sees. The DB row is synced FROM local (see syncProgressToServer),
//     never the other way, so this response should never write over them.
//   - Visitor view: YES. An anonymous visitor can't read someone else's
//     localStorage, so this DB-mirrored response is the only source of
//     that data available at all.
async function fetchAndRenderAdminStats(handle = null, myToken = refreshToken, isVisitorContext = false) {
  document.getElementById("adminStatsGrid").style.display = "grid";
  try {
    const token = localStorage.getItem("__bq_adm");
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
       
       document.getElementById("adminUploadedQuizzes").textContent = data.uploadedQuizzes || 0;
       document.getElementById("adminReportsCount").textContent = data.reportsCount || 0;
       document.getElementById("adminResolvedReportsCount").textContent = data.resolvedReports || 0;

       if (isVisitorContext) {
         // Public stats grid — only meaningful here, see comment above.
         if (document.getElementById("totalPoints") && typeof data.totalPoints !== 'undefined') {
           document.getElementById("totalPoints").textContent = data.totalPoints;
         }
         if (document.getElementById("totalQuizzes") && typeof data.totalQuizzes !== 'undefined') {
           document.getElementById("totalQuizzes").textContent = data.totalQuizzes;
         }
         if (document.getElementById("totalBadges") && typeof data.totalBadges !== 'undefined') {
           document.getElementById("totalBadges").textContent = data.totalBadges;
         }
         if (document.getElementById("currentLevel") && typeof data.currentLevel !== 'undefined') {
           document.getElementById("currentLevel").textContent = data.currentLevel;
         }
       }

       return { 
         role: data.role, 
         isOwner: !!data.isOwner, 
         avatarUrl: data.avatarUrl || null, 
         displayName: data.displayName || null,
         activityHeatmap: data.activityHeatmap || {},
       };
    }
  } catch(e) {}
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
  const computedTotalPoints = (user.history || []).reduce((s, h) => s + (h.pointsEarned || 0), 0);
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
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        totalPoints: computedTotalPoints,
        totalQuizzes: user.history ? user.history.length : 0,
        totalBadges: user.badges ? user.badges.length : 0,
        currentLevel: levelInfo.level || 1,
        displayName: localStorage.getItem('username') || undefined,
        avatarUrl: localStorage.getItem('quiz_user_avatar') || undefined,
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

async function setupVisitorView(handle) {
  // Setup UI for visitor view
  document.querySelectorAll(".content-section").forEach(el => el.style.display = "none");
  const masteryCard = document.querySelector(".category-mastery-card");
  if(masteryCard) masteryCard.style.display = "none";
  
  const badgeContainer = document.getElementById("badgeContainer");
  if(badgeContainer) badgeContainer.parentElement.style.display = "none";
  const nextBadges = document.getElementById("nextBadges");
  if(nextBadges) nextBadges.parentElement.style.display = "none";
  const statsContainer = document.getElementById("statsContainer");
  if(statsContainer) statsContainer.parentElement.style.display = "none";
  
  const heatmapCard = document.querySelector(".heatmap-widget-card");
  if (heatmapCard) heatmapCard.style.display = "";
  
  document.getElementById("avatarEditBtn").style.display = "none";
  document.getElementById("weeklyRecap").style.display = "none";

  const displayNameMeta = document.querySelector('meta[name="admin:display-name"]');
  const publicName = displayNameMeta && displayNameMeta.content ? displayNameMeta.content : handle;
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

  // Fetch the visited user's stats, and — since the endpoint is the only
  // source of truth on this page for who the visited user actually is —
  // read role/isOwner from its response instead of assuming "admin" for
  // every visitor (that previously mislabeled regular users as admins).
  const visitedRole = await fetchAndRenderAdminStats(handle, refreshToken, true);

  if (visitedRole && visitedRole.displayName) {
    const headerTitle = document.getElementById("userNameHeader");
    if (headerTitle) {
      headerTitle.textContent = visitedRole.displayName;
      headerTitle.setAttribute("data-text", visitedRole.displayName);
    }
  }

  if (visitedRole && (visitedRole.role || visitedRole.isOwner)) {
    applyRoleBadges(visitedRole.role, !!visitedRole.isOwner);
  }
  if (!avatarMeta && visitedRole && visitedRole.avatarUrl) {
    renderVisitorAvatar(visitedRole.avatarUrl, handle);
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
  
  // Update User Info Modal for Visitor View
  const showUserInfoBtn = document.getElementById("showUserInfoBtn");
  if (showUserInfoBtn) {
    showUserInfoBtn.onclick = () => {
      document.getElementById("userInfoOverlay").style.display = "flex";
      // Prefer the server-injected meta/displayName (publicName) when available
      document.getElementById("infoModalName").textContent = publicName || ((visitedRole && visitedRole.displayName) ? visitedRole.displayName : handle);
      
      document.getElementById("infoModalAdminSection").style.display = "block";
      const emailBlock = document.getElementById("infoModalEmail").parentElement;
      emailBlock.style.display = "none";
      
      const handleBlock = document.getElementById("infoModalHandle").parentElement.parentElement;
      handleBlock.style.display = "flex";
      document.getElementById("infoModalHandle").textContent = "@" + handle;
      
      const copyBtn = document.getElementById("modalCopyLinkBtn");
      if (copyBtn) {
        copyBtn.onclick = () => {
          const url = window.location.origin + "/@" + handle;
          if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(url).then(() => {
              const orig = copyBtn.innerHTML;
              copyBtn.innerHTML = "تم النسخ! ✔️";
              copyBtn.setAttribute("aria-live", "polite");
              setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
            });
          } else {
            prompt_user("انسخ الرابط التالي:", url);
          }
        };
      }
    };
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
  if (!(await confirmationNotification("هل أنت متأكد من حذف هذا الاختبار؟ ")))
    return;

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
  if (!(await confirmationNotification("إزالة من المفضلة؟"))) return;

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

document.addEventListener("DOMContentLoaded", async () => {
  // Add overlay backdrop click handler for all contact overlays
  document.querySelectorAll(".contact-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.style.display = "none";
    });
  });

  // Guard: Only run profile initialisation if we're on the profile page
  if (!document.getElementById("totalPoints")) return;

  const adminHandleMeta = document.querySelector('meta[name="admin:handle"]');
  const isVisitorView = !!adminHandleMeta;

  try {
    const manifest = await getManifest();
    setExamList(manifest.examList || []);
    window.__examListCache = examList;
  } catch (err) {
    console.error("Failed to load quiz manifest:", err);
  }

  if (isVisitorView) {
    const visitedHandle = adminHandleMeta.content;
    const currentToken = ++refreshToken;
    setupVisitorView(visitedHandle);
    // Real leaderboard, with the visited profile's row highlighted instead
    // of the viewer's own (the viewer has no meaningful position here, and
    // may not even be an admin) — see renderLeaderboard's visitedHandle param.
    renderLeaderboard({}, "User", currentToken, visitedHandle);
  } else {
    initAvatarPicker();
    refreshUI();

    window.addEventListener("avatarUpdated", () => {
      const currentName = localStorage.getItem("username") || "مستخدم";
      renderAvatar(gameEngine.getUserData(), currentName);
    });

    // Push local progress to the DB on load, and again whenever the tab is
    // hidden/backgrounded (covers navigating away, switching tabs, closing
    // the tab on most browsers) — see syncProgressToServer for why this
    // never feeds back into what's rendered on this page.
    syncProgressToServer();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        syncProgressToServer();
      }
    });
  }
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

function renderStats(user) {
  // Compute totalPoints from history to keep UI consistent with weekly recap
  const computedTotalPoints = (user.history || []).reduce((s, h) => s + (h.pointsEarned || 0), 0);
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
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const weekAgoStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);

  const recent = (user.history || []).filter((h) => {
    const d = new Date(h.date);
    return !Number.isNaN(d.getTime()) && d >= weekAgoStart && d <= todayEnd;
  });

  if (recent.length === 0) {
    el.textContent = "لم تقم بأي اختبار هذا الأسبوع، ابدأ الآن!";
    return;
  }

  const avgPct = Math.round(
    recent.reduce((sum, h) => sum + (h.percentage || 0), 0) / recent.length,
  );
  const points = recent.reduce((sum, h) => sum + (h.pointsEarned || 0), 0);

  el.textContent = `هذا الأسبوع: ${recent.length} ${recent.length === 1 ? "اختبار" : "اختبارات"} • متوسط ${avgPct}% • +${points.toLocaleString()} نقطة`;
}

function historyItemHtml(attempt, index) {
  const exam = examById.get(attempt.examId);
  const title = exam ? exam.title : "اختبار محذوف";
  const date = new Date(attempt.date).toLocaleDateString();
  const percentage =
    attempt.percentage || Math.round((attempt.score / attempt.total) * 100);

  return `
      <div class="history-item">
        <div class="history-info">
          <h4>${title}</h4>
          <small>${date} • ${attempt.mode || "اختبار"}</small>
        </div>
        <div class="history-actions">
          <div class="history-score ${
            percentage >= 60 ? "pass" : "fail"
          }">${percentage}%</div>
          ${exam ? `<a href="/q/${attempt.examId}" class="nav-btn primary" style="padding:8px 14px;font-size:0.8rem;text-decoration:none;">اذهب إلى الإمتحان</a>` : ""}
          <button class="delete-btn" data-action="delete-history" data-index="${index}" aria-label="حذف هذا الاختبار من السجل"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
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
    emptyHtml: `<div class="empty-state"><div class="empty-state-icon">📜</div><h3>لا يوجد سجل اختبارات بعد</h3></div>`,
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
              <a href="/q/${examId}?startAt=${qIdx}" class="nav-btn primary" style="padding:8px 14px;font-size:0.8rem;text-decoration:none;">اذهب إلى السؤال</a>
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
        return b
          ? `<div class="dash-badge" title="${b.desc}" aria-label="${b.title}: ${b.desc}"><div class="badge-icon" aria-hidden="true">${b.icon}</div><div>${b.title}</div></div>`
          : "";
      })
      .join("") || "اكسب الشارات بإكمال الاختبارات!";
}

// visitedHandle: when set (visitor /@handle view), only the admin
// leaderboard is shown — the local bots board is owner-profile only.
async function renderLeaderboard(user, currentName, myToken = refreshToken, visitedHandle = null) {
  const localCard = document.getElementById("localLeaderboardCard");
  const adminCard = document.getElementById("adminLeaderboardCard");
  const localEl = document.getElementById("localLeaderboard");
  const adminEl = document.getElementById("adminLeaderboard");
  if (!adminEl) return;

  const roleInfo = getAdminRoleInfo();
  const displayName = currentName || localStorage.getItem("username") || "مستخدم";
  const highlightHandle = visitedHandle || (roleInfo && roleInfo.handle);
  const isVisitor = !!visitedHandle;

  if (localCard) localCard.hidden = isVisitor;
  if (adminCard) adminCard.hidden = false;

  if (!isVisitor && localEl) {
    renderLocalLeaderboard(localEl, user, displayName);
  }

  await renderAdminLeaderboard(adminEl, highlightHandle, displayName, visitedHandle, myToken);
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
      attachHoverCard(avatarHover, `
        <span class="lb-hover-name">${entry.name}</span>
        <span class="lb-hover-lore">${loreForBot(entry.name)}</span>
      `, "lb-hover-card-lore");
    }
  });
}

async function renderAdminLeaderboard(leaderboardEl, highlightHandle, displayName, visitedHandle, myToken) {
  try {
    const res = await fetch("/api/admin-stats?leaderboard=true");

    // A newer refreshUI() call started while this fetch was in flight —
    // discard this response so it can't overwrite fresher DOM state.
    if (myToken !== refreshToken) return;

    if (!res.ok) {
      leaderboardEl.innerHTML = `<div class="empty-state"><p>تعذر تحميل لوحة المسؤولين</p></div>`;
      return;
    }

    const admins = await res.json();

    leaderboardEl.innerHTML = admins
      .map((entry, i) => {
        const isHighlighted = entry.handle === highlightHandle;
        const label = isHighlighted
          ? (visitedHandle ? (entry.displayName || entry.handle) : displayName + " (أنت)")
          : (entry.displayName || entry.handle);
        const avatar = adminAvatarUrl(entry);

        return `
          <div class="lb-row lb-row-avatar ${isHighlighted ? "highlight" : ""}" role="listitem" aria-label="الترتيب ${i + 1}: ${label}، ${entry.totalQuizzes.toLocaleString()} اختبار">
            <span class="lb-rank" aria-hidden="true">${i + 1}</span>
            <span class="lb-avatar-hover">
              <img class="lb-avatar" src="${avatar}" alt="" loading="lazy" width="32" height="32">
            </span>
            <span class="lb-name" title="${entry.displayName || entry.handle}">${label}</span>
            <strong class="lb-metric">${entry.totalQuizzes.toLocaleString()} إختبار</strong>
          </div>
        `;
      })
      .join("");

    leaderboardEl.querySelectorAll(".lb-row").forEach((row, i) => {
      const avatarHover = row.querySelector(".lb-avatar-hover");
      if (avatarHover) {
        attachHoverCard(avatarHover, adminHoverCardHtml(admins[i]), "", { interactive: true });
      }
    });
  } catch (err) {
    leaderboardEl.innerHTML = `<div class="empty-state"><p>تعذر تحميل لوحة المسؤولين</p></div>`;
  }
}

// Expose for other modules (quiz result flow) to trigger immediate sync
window.syncProgressToServer = syncProgressToServer;
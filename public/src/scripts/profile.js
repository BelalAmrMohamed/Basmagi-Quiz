// src/scripts/profile.js - Enhanced with All Features

import { gameEngine, BADGES } from "../shared/gameEngine.js";
import { avatarEngine } from "../shared/avatarEngine.js";
import { getManifest } from "./quizManifest.js";
import { InfiniteList } from "../shared/infiniteScroll.js";
import { initAvatarPicker } from "./avatarPicker.js";
import {
  renderActivityHeatmap,
  renderCategoryMastery,
  renderNextBadges,
  renderFlaggedQuestions,
} from "./profileWidgets.js";

import { confirmationNotification } from "../components/notifications.js";
import { getAdminRoleInfo } from "./adminAuth.js";

let examList = [];
let historyList = null;
let bookmarksList = null;

export function refreshUI() {
  const user = gameEngine.getUserData();
  renderStats(user);
  renderAvatar(user);
  renderHistory(user);
  renderBookmarks(user);
  renderBadges(user);
  renderLeaderboard(user);
  renderActivityHeatmap(user);
  renderCategoryMastery(user, examList);
  renderNextBadges(user);
  renderFlaggedQuestions(user, examList);

  // Update username display
  const nameDisplay = document.getElementById("userNameDisplay");
  const hasCustomName = !!localStorage.getItem("username");
  const currentName = localStorage.getItem("username") || "مستخدم";
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
  }

  // Handle Admin/Developer Badges for Owner View
  const roleInfo = getAdminRoleInfo();
  if (roleInfo) {
    applyRoleBadges(roleInfo.role, roleInfo.isOwner);
    fetchAndRenderAdminStats(); // Fetch stats for owner
    
    // Admin Info Display
    const adminInfoBox = document.getElementById("adminInfoBox");
    if (adminInfoBox && roleInfo.handle) {
      adminInfoBox.style.display = "block";
      const emailDisplay = document.getElementById("adminEmailDisplay");
      const handleDisplay = document.getElementById("adminHandleDisplay");
      if (emailDisplay) emailDisplay.textContent = roleInfo.email || "";
      if (handleDisplay) handleDisplay.textContent = "@" + roleInfo.handle;
      
      const copyBtn = document.getElementById("copyProfileLinkBtn");
      if (copyBtn) {
        copyBtn.onclick = () => {
          const url = window.location.origin + "/@" + roleInfo.handle;
          if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(url).then(() => {
              const orig = copyBtn.textContent;
              copyBtn.textContent = "تم النسخ!";
              setTimeout(() => { copyBtn.textContent = orig; }, 2000);
            });
          } else {
            prompt("انسخ الرابط التالي:", url);
          }
        };
      }
    }
  }
}

function applyRoleBadges(role, isOwner) {
  const roleBadge = document.getElementById("roleBadge");
  const avatarBadgeOverlay = document.getElementById("avatarBadgeOverlay");
  
  if (roleBadge) {
    roleBadge.style.display = "inline-flex";
    if (isOwner) {
      roleBadge.textContent = "مطور";
      roleBadge.className = "role-badge developer-badge";
    } else if (role === "admin") {
      roleBadge.textContent = "مشرف";
      roleBadge.className = "role-badge admin-badge";
    }
  }

  if (avatarBadgeOverlay) {
    avatarBadgeOverlay.style.display = "block";
    if (isOwner) {
      avatarBadgeOverlay.src = "assets/images/white-icon.png";
    } else if (role === "admin") {
      avatarBadgeOverlay.src = "favicon.png";
    }
  }
}

async function fetchAndRenderAdminStats(handle = null) {
  document.getElementById("adminStatsGrid").style.display = "grid";
  try {
    const token = sessionStorage.getItem("__bq_adm");
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    
    let url = "/api/admin-stats";
    if (handle) url += `?handle=${encodeURIComponent(handle)}`;
    
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (res.ok) {
       document.getElementById("adminUploadedQuizzes").textContent = data.uploadedQuizzes || 0;
       document.getElementById("adminReportsCount").textContent = data.reportsCount || 0;
       document.getElementById("adminResolvedReportsCount").textContent = data.resolvedReports || 0;

       // Populate public stats grid
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
  } catch(e) {}
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
  
  document.getElementById("avatarEditBtn").style.display = "none";
  document.getElementById("weeklyRecap").style.display = "none";

  const headerTitle = document.getElementById("userNameHeader");
  if (headerTitle) {
    headerTitle.textContent = handle;
    headerTitle.setAttribute("data-text", handle);
  }

  // Determine if it's admin or owner visually. We'll just assume admin for visitor view unless we fetch role.
  // We'll call the same fetch to populate numbers
  await fetchAndRenderAdminStats(handle);
  
  // We apply the basic admin badge for now (in a real app, API should return if user is owner/admin)
  applyRoleBadges("admin", false);
}

// Delete history entry
window.deleteHistory = async function (index) {
  if (!(await confirmationNotification("هل أنت متأكد من حذف هذا الاختبار؟ ")))
    return;

  const user = gameEngine.getUserData();
  user.history.splice(index, 1);
  gameEngine.saveUserData(user);

  // Update UI immediately without reload
  refreshUI();
};

// Remove bookmark
window.removeBookmark = async function (key) {
  if (!(await confirmationNotification("إزالة من المفضلة؟"))) return;

  const user = gameEngine.getUserData();
  if (user.bookmarks && user.bookmarks[key]) {
    delete user.bookmarks[key];
    gameEngine.saveUserData(user);
  }

  // Update UI immediately without reload
  refreshUI();
};

document.addEventListener("DOMContentLoaded", async () => {
  // Guard: Only run profile initialisation if we're on the profile page
  if (!document.getElementById("totalPoints")) return;

  const adminHandleMeta = document.querySelector('meta[name="admin:handle"]');
  const isVisitorView = !!adminHandleMeta;

  try {
    const manifest = await getManifest();
    examList = manifest.examList || [];
    window.__examListCache = examList;
  } catch (err) {
    console.error("Failed to load quiz manifest:", err);
  }

  if (isVisitorView) {
    setupVisitorView(adminHandleMeta.content);
    // Render only the generic stuff that still works without local user
    renderLeaderboard({});
  } else {
    initAvatarPicker();
    refreshUI();

    window.addEventListener("avatarUpdated", () => {
      renderAvatar(gameEngine.getUserData());
    });
  }
});

function renderAvatar(user) {
  const img = document.getElementById("avatarImage");
  if (!img) return;

  const stored = avatarEngine.getAvatar();
  const name = localStorage.getItem("username") || "مستخدم";

  if (stored) {
    img.src = stored;
  } else {
    const svg = avatarEngine.generateDefaultAvatarSVG(name);
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }
  img.alt = `الصورة الشخصية لـ ${name}`;
}

function renderStats(user) {
  const levelInfo = gameEngine.calculateLevel(user.totalPoints);

  // Safely update element helper
  const updateEl = (id, htmlOrText, isHtml = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isHtml) el.innerHTML = htmlOrText;
    else el.textContent = htmlOrText;
  };
  const updateStyle = (id, prop, val) => {
    const el = document.getElementById(id);
    if (el) el.style[prop] = val;
  };

  // Core Stats
  updateEl("totalPoints", user.totalPoints?.toLocaleString() || 0);
  updateEl("totalQuizzes", user.history ? user.history.length : 0);
  updateEl("totalBadges", user.badges ? user.badges.length : 0);
  updateEl("currentLevel", levelInfo.level | 0);

  // Level Details
  updateEl("levelTitle", levelInfo.title);
  updateEl(
    "levelBadge",
    `<span class="level-number">${levelInfo.level | 0}</span>`,
    true,
  );
  updateStyle(
    "levelProgressBar",
    "width",
    `${levelInfo.progressPercent || 0}%`,
  );
  updateEl("currentXP", `${levelInfo.pointsInCurrentLevel || 0} XP`);
  updateEl(
    "nextLevelXP",
    `${levelInfo.pointsNeededForNext || 0} XP to next level`,
  );

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

  // Both ways result in the same direction
  if (user.streaks) {
    updateEl(
      "currentStreak",
      ` ${user.streaks?.longestStreak === 1 ? "يوم:" : "أيام:"}  ${user.streaks?.currentDaily || 0} `,
    );
    updateEl(
      "bestStreak",
      ` ${user.streaks?.longestStreak === 1 ? "يوم:" : "أيام:"}  ${user.streaks?.longestStreak || 0} `,
    );
  }

  // This-week recap strip
  renderWeeklyRecap(user);
}

function renderWeeklyRecap(user) {
  const el = document.getElementById("weeklyRecap");
  if (!el) return;

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const recent = (user.history || []).filter((h) => {
    const d = new Date(h.date);
    return !isNaN(d) && d >= weekAgo && d <= now;
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
  const exam = examList.find((e) => e.id === attempt.examId);
  const title = exam ? exam.title : "Deleted Quiz";
  const date = new Date(attempt.date).toLocaleDateString();
  const percentage =
    attempt.percentage || Math.round((attempt.score / attempt.total) * 100);

  return `
      <div class="history-item">
        <div class="history-info">
          <h4>${title}</h4>
          <small>${date} • ${attempt.mode || "Exam"}</small>
        </div>
        <div class="history-actions">
          <div class="history-score ${
            percentage >= 60 ? "pass" : "fail"
          }">${percentage}%</div>
          ${exam ? `<a href="/q/${attempt.examId}" class="nav-btn primary" style="padding:8px 14px;font-size:0.8rem;text-decoration:none;">اذهب إلى الإمتحان</a>` : ""}
          <button class="delete-btn" onclick="deleteHistory(${index})"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
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
    emptyHtml: `<div class="empty-state"><div class="empty-state-icon">📜</div><h3>No History Yet</h3></div>`,
  });
  historyList.mount();
}

function bookmarkItemHtml(key) {
  const [examId, qIdx] = key.split("_");
  const exam = examList.find((e) => e.id === examId);
  return `
          <div class="history-item">
            <div class="history-info">
              <h4>${exam ? exam.title : examId}</h4>
              <small>Question #${parseInt(qIdx) + 1}</small>
            </div>
            <div class="history-actions">
              <a href="/q/${examId}?startAt=${qIdx}" class="nav-btn primary" style="padding:8px 14px;font-size:0.8rem;text-decoration:none;">اذهب إلى السؤال</a>
              <button class="unstar-btn" onclick="removeBookmark('${key}')"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-off-icon lucide-star-off"><path d="m10.344 4.688 1.181-2.393a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.237 3.152"/><path d="m17.945 17.945.43 2.505a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a8 8 0 0 0 .4-.099"/><path d="m2 2 20 20"/></svg></button>
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
        const b = BADGES.find((x) => x.id === id);
        return b
          ? `<div class="dash-badge" title="${b.desc}"><div class="badge-icon">${b.icon}</div><div>${b.title}</div></div>`
          : "";
      })
      .join("") || "Earn badges by completing quizzes!";
}

async function renderLeaderboard(user) {
  const leaderboardEl = document.getElementById("leaderboard");
  if (!leaderboardEl) return;

  const roleInfo = getAdminRoleInfo();
  const isAdmin = !!roleInfo;

  if (isAdmin) {
    try {
      const res = await fetch("/api/admin-leaderboard");
      if (res.ok) {
        const admins = await res.json();
        const displayName = localStorage.getItem("username") || "User";
        
        leaderboardEl.innerHTML = admins
          .map(
            (entry, i) => `
          <div class="lb-row ${entry.handle === roleInfo.handle ? "highlight" : ""}">
            <span style="flex:1; display:flex; align-items:center; gap:6px;">
              <span style="font-weight:bold; color:var(--color-primary); width:18px;">${i + 1}.</span> 
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${entry.display_name || entry.handle}">
                ${entry.handle === roleInfo.handle ? displayName + ' (أنت)' : (entry.display_name || entry.handle)}
              </span>
            </span>
            <strong>${entry.total_quizzes.toLocaleString()} إختبار</strong>
          </div>
        `
          )
          .join("");
        return;
      }
    } catch (err) {}
  }

  const mockUsers = [
    { name: "عم فوزي الحريف", points: 3000 },
    { name: "سيد سِكّة", points: 2000 },
    { name: "زيزو حركات", points: 1500 },
    { name: "علي علكّه", points: 1000 },
    { name: "شيكو الغلبان", points: 500 },
    { name: "زيزي على الهادي", points: 100 },
  ];

  const displayName = localStorage.getItem("username") || "User";
  const currentUser = {
    name: `${displayName} (You)`,
    points: user.totalPoints || 0,
    isUser: true,
  };

  const all = [...mockUsers, currentUser].sort((a, b) => b.points - a.points);
  const rankedList = all.map((u, i) => ({ ...u, rank: i + 1 }));

  leaderboardEl.innerHTML = rankedList
    .map(
      (entry) => `
    <div class="lb-row ${entry.isUser ? "highlight" : ""}">
      <span>${entry.rank}. ${entry.name}</span>
      <strong>${entry.points.toLocaleString()} pts</strong>
    </div>
  `,
    )
    .join("");
}
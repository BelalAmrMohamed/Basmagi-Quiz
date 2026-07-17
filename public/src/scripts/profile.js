// src/scripts/profile.js - Enhanced with All Features

// Temporary | For performance debugging
console.log("profile.js loaded successfully")

import { gameEngine, BADGES } from "../shared/gameEngine.js";
import { getManifest } from "./quizManifest.js";

import { confirmationNotification } from "../components/notifications.js";

let examList = [];

export function refreshUI() {
  const user = gameEngine.getUserData();
  renderStats(user);
  renderHistory(user);
  renderBookmarks(user);
  renderBadges(user);
  renderLeaderboard(user);

  // Update username display
  const nameDisplay = document.getElementById("userNameDisplay");
  if (nameDisplay) {
    const currentName = localStorage.getItem("username") || "مستخدم";
    nameDisplay.textContent = currentName;
    // Update page title
    document.title = `لائحة ${currentName}`;
  }
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

  try {
    const manifest = await getManifest();
    examList = manifest.examList || [];
  } catch (err) {
    console.error("Failed to load quiz manifest:", err);
  }
  refreshUI();
});

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
}

function renderHistory(user) {
  const historyList = document.getElementById("historyList");
  if (!historyList) return;

  if (!user.history || user.history.length === 0) {
    historyList.innerHTML = `<div class="empty-state"><h3>No History Yet</h3></div>`;
    return;
  }

  historyList.innerHTML = user.history
    .map((attempt, index) => {
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
    })
    .join("");
}

function renderBookmarks(user) {
  // Ensure we don't duplicate the section if refreshUI is called
  let bookmarkSection = document.getElementById("bookmarks-section");
  if (!bookmarkSection) {
    bookmarkSection = document.createElement("div");
    bookmarkSection.id = "bookmarks-section";
    document.querySelector(".main-content").appendChild(bookmarkSection);
  }

  const keys = Object.keys(user.bookmarks || {});

  bookmarkSection.innerHTML = `
    <h2 style="margin-top:40px;">⭐ الأسئلة المفضلة</h2>
    <div class="history-list">
      ${
        keys.length === 0
          ? "<p>لم تقم بتفضيل أية أسئلة</p>"
          : keys
              .map((key) => {
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
              })
              .join("")
      }
    </div>`;
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

  // Move the badges sidebar-card out of the right column and into the main
  // content area, right after the level-progress-card. Prevents it from
  // being hidden behind the fixed side-menu and makes it visible on mobile.
  const badgeCard = container.closest(".sidebar-card");
  const levelCard = document.querySelector(".level-progress-card");
  if (badgeCard && levelCard && levelCard.parentNode) {
    if (!badgeCard.classList.contains("badges-relocated")) {
      badgeCard.classList.add("badges-relocated");
      levelCard.parentNode.insertBefore(badgeCard, levelCard.nextSibling);
    }
  }
}

function renderLeaderboard(user) {
  const leaderboardEl = document.getElementById("leaderboard");
  if (!leaderboardEl) return;

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

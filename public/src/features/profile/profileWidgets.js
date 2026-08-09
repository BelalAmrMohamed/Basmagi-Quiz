// public/src/features/profile/profileWidgets.js - New Engagement Widgets for the Profile Page
// Activity heatmap, category mastery chart, "next badge" progress teasers,
// and the flagged-questions review panel. Split out from profile.js to keep
// each renderer focused and independently testable.

import { gameEngine, BADGES } from "../../shared/gameEngine.js";

// ==================== Activity Heatmap ====================
// Built entirely from user.history[].date - no new data model needed.

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_LABELS_SAT_FIRST = ["س", "ح", "ن", "ث", "ر", "خ", "ج"]; // Sat..Fri initials
const MONTH_LABELS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export function renderActivityHeatmap(user, weeks = 20) {
  const container = document.getElementById("activityHeatmap");
  if (!container) return;

  const counts = {};
  (user.history || []).forEach((h) => {
    const d = new Date(h.date);
    if (isNaN(d)) return;
    const key = dateKey(d);
    counts[key] = (counts[key] || 0) + 1;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Align the grid to start on a Saturday (start of week in most Arabic
  // locales) so full weeks stack cleanly into columns.
  const totalDays = weeks * 7;
  const start = new Date(today);
  start.setDate(start.getDate() - (totalDays - 1));
  while (start.getDay() !== 6) {
    start.setDate(start.getDate() - 1);
  }

  const days = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const key = dateKey(cursor);
    days.push({ key, count: counts[key] || 0, date: new Date(cursor) });
    cursor.setDate(cursor.getDate() + 1);
  }

  const maxCount = Math.max(1, ...days.map((d) => d.count));

  const levelFor = (count) => {
    if (count === 0) return 0;
    const ratio = count / maxCount;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
  };

  const columns = [];
  for (let i = 0; i < days.length; i += 7) {
    columns.push(days.slice(i, i + 7));
  }

  // Stagger each cell's enter animation slightly by column so the grid
  // draws itself left-to-right instead of popping in all at once.
  const cellsHtml = columns
    .map(
      (col, colIdx) => `
      <div class="heatmap-col">
        ${col
          .map((d, rowIdx) => {
            const level = levelFor(d.count);
            const label = `${d.date.toLocaleDateString("ar-EG")} • ${d.count} ${d.count === 1 ? "اختبار" : "اختبارات"}`;
            const delay = (colIdx * 7 + rowIdx) * 4;
            return `<span class="heatmap-cell" data-level="${level}" title="${label}" aria-label="${label}" style="animation-delay:${delay}ms"></span>`;
          })
          .join("")}
      </div>`,
    )
    .join("");

  // Month axis: one label per column where that column is the first to
  // cross into a new month, so labels don't repeat every week.
  let lastMonth = null;
  const axisHtml = columns
    .map((col) => {
      const firstOfMonth = col.find((d) => d.date.getDate() <= 7);
      const monthIdx = firstOfMonth ? firstOfMonth.date.getMonth() : null;
      const showLabel = monthIdx !== null && monthIdx !== lastMonth;
      if (showLabel) lastMonth = monthIdx;
      return `<span class="heatmap-axis-cell" style="width:var(--heatmap-cell)">${showLabel ? MONTH_LABELS_AR[monthIdx].slice(0, 3) : ""}</span>`;
    })
    .join("");

  const dayLabelsHtml = WEEKDAY_LABELS_SAT_FIRST
    .map((label, i) => `<span>${i % 2 === 0 ? label : ""}</span>`)
    .join("");

  const activeDays = days.filter((d) => d.count > 0).length;

  container.innerHTML = `
    <div class="heatmap-axis">${axisHtml}</div>
    <div class="heatmap-body">
      <div class="heatmap-grid">${cellsHtml}</div>
      <div class="heatmap-daylabels">${dayLabelsHtml}</div>
    </div>
    <div class="heatmap-footer">
      <span><strong>${activeDays}</strong> يوم نشاط خلال آخر ${weeks} أسبوع</span>
      <div class="heatmap-legend">
        <span>أقل</span>
        <span class="heatmap-cell" data-level="0"></span>
        <span class="heatmap-cell" data-level="1"></span>
        <span class="heatmap-cell" data-level="2"></span>
        <span class="heatmap-cell" data-level="3"></span>
        <span class="heatmap-cell" data-level="4"></span>
        <span>أكثر</span>
      </div>
    </div>`;
}

// ==================== Category Mastery ====================
// Reads user.categoryProgress (already populated by gameEngine.processResult
// but never displayed anywhere before this).

export async function renderCategoryMastery(user, examList) {
  const container = document.getElementById("categoryMastery");
  if (!container) return;

  const progress = user.categoryProgress || {};
  const examIds = Object.keys(progress);

  if (examIds.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><p>أكمل اختباراً واحداً على الأقل لعرض نقاط قوتك</p></div>`;
    return;
  }

  const rows = examIds
    .map((id) => {
      const exam = (examList || []).find((e) => e.id === id);
      const title = exam ? exam.title : id;
      const data = progress[id];
      const best = Math.round(data.bestScore || 0);
      return { title, best, attempts: data.attempts || 0 };
    })
    .sort((a, b) => b.best - a.best)
    .slice(0, 8);

  container.innerHTML = rows
    .map((row) => {
      const barColor = row.best >= 80 ? "success" : row.best >= 50 ? "warning" : "error";
      return `
      <div class="mastery-row">
        <div class="mastery-row-header">
          <span class="mastery-title">${row.title}</span>
          <span class="mastery-value">${row.best}%</span>
        </div>
        <div class="mastery-bar-track">
          <div class="mastery-bar-fill mastery-${barColor}" style="width:${row.best}%"></div>
        </div>
        <span class="mastery-attempts">${row.attempts} ${row.attempts === 1 ? "محاولة" : "محاولات"}</span>
      </div>`;
    })
    .join("");
}

// ==================== Next Badge Progress Teasers ====================

function getBadgeProgress(badgeId, user) {
  const points = user.totalPoints || 0;
  const quizzes = user.history ? user.history.length : 0;
  const bookmarks = Object.keys(user.bookmarks || {}).length;
  const streak = user.streaks ? user.streaks.currentDaily || 0 : 0;

  const targets = {
    "point-collector": { current: points, goal: 1000, unit: "نقطة" },
    "point-hoarder": { current: points, goal: 5000, unit: "نقطة" },
    "point-master": { current: points, goal: 10000, unit: "نقطة" },
    beginner: { current: quizzes, goal: 3, unit: "اختبار" },
    "quick-learner": { current: quizzes, goal: 5, unit: "اختبار" },
    dedicated: { current: quizzes, goal: 10, unit: "اختبار" },
    scholar: { current: quizzes, goal: 25, unit: "اختبار" },
    academic: { current: quizzes, goal: 50, unit: "اختبار" },
    professor: { current: quizzes, goal: 100, unit: "اختبار" },
    organizer: { current: bookmarks, goal: 10, unit: "سؤال محفوظ" },
    bookworm: { current: bookmarks, goal: 25, unit: "سؤال محفوظ" },
    completionist: { current: bookmarks, goal: 50, unit: "سؤال محفوظ" },
    "week-warrior": { current: streak, goal: 7, unit: "يوم متتالي" },
    consistent: { current: streak, goal: 14, unit: "يوم متتالي" },
    "month-master": { current: streak, goal: 30, unit: "يوم متتالي" },
  };

  return targets[badgeId] || null;
}

export function renderNextBadges(user) {
  const container = document.getElementById("nextBadges");
  if (!container) return;

  const earned = new Set(user.badges || []);
  const candidates = BADGES.filter((b) => !earned.has(b.id))
    .map((b) => ({ badge: b, progress: getBadgeProgress(b.id, user) }))
    .filter((c) => c.progress !== null)
    .map((c) => ({
      ...c,
      percent: Math.min(100, Math.round((c.progress.current / c.progress.goal) * 100)),
    }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 3);

  if (candidates.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = candidates
    .map(
      ({ badge, progress, percent }) => `
      <div class="next-badge-row">
        <div class="next-badge-icon">${badge.icon}</div>
        <div class="next-badge-info">
          <div class="next-badge-header">
            <span class="next-badge-title">${badge.title}</span>
            <span class="next-badge-fraction">${Math.min(progress.current, progress.goal).toLocaleString()} / ${progress.goal.toLocaleString()}</span>
          </div>
          <div class="next-badge-bar-track">
            <div class="next-badge-bar-fill" style="width:${percent}%"></div>
          </div>
        </div>
      </div>`,
    )
    .join("");
}

// ==================== Flagged Questions Panel ====================
// gameEngine already tracks flags via toggleFlag/isFlagged/getFlaggedCount,
// used during quiz-taking, but there was previously no surface for them on
// the profile page - they became invisible once set.

export function renderFlaggedQuestions(user, examList) {
  const container = document.getElementById("flaggedList");
  if (!container) return;

  const flags = user.flags || {};
  const keys = Object.keys(flags);

  if (keys.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🚩</div><p>لا توجد أسئلة معلّمة للمراجعة</p></div>`;
    return;
  }

  container.innerHTML = keys
    .sort((a, b) => (flags[b].timestamp || 0) - (flags[a].timestamp || 0))
    .map((key) => {
      const lastUnderscore = key.lastIndexOf("_");
      const examId = key.slice(0, lastUnderscore);
      const qIdx = key.slice(lastUnderscore + 1);
      const exam = (examList || []).find((e) => e.id === examId);
      return `
      <div class="history-item">
        <div class="history-info">
          <h4>${exam ? exam.title : examId}</h4>
          <small>السؤال رقم ${parseInt(qIdx, 10) + 1}</small>
        </div>
        <div class="history-actions">
          <a href="/q/${examId}?startAt=${qIdx}" class="nav-btn primary" style="padding:8px 14px;font-size:0.8rem;text-decoration:none;">مراجعة السؤال</a>
          <button class="unstar-btn" onclick="unflagQuestion('${examId}', ${qIdx})" aria-label="إزالة العلامة">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg>
          </button>
        </div>
      </div>`;
    })
    .join("");
}

window.unflagQuestion = function (examId, qIdx) {
  gameEngine.toggleFlag(examId, qIdx);
  const user = gameEngine.getUserData();
  renderFlaggedQuestions(user, window.__examListCache || []);
};
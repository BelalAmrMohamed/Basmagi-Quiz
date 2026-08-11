// public/src/features/profile/profileWidgets.js - New Engagement Widgets for the Profile Page
// Activity heatmap, category mastery chart, "next badge" progress teasers,
// and the flagged-questions review panel. Split out from profile.js to keep
// each renderer focused and independently testable.

import { gameEngine, BADGES } from "../../shared/gameEngine.js";
import { InfiniteList } from "./infiniteScroll.js";

// ==================== Activity Heatmap ====================
// Built entirely from user.history[].date - no new data model needed.

import { attachHoverCard } from "./leaderboardIdentity.js";

// Section label for the activity heatmap card — static "نشاطك" ("your
// activity") on a regular user's own dashboard, but role-flavored for
// admin/dev accounts (including on their own dashboard, not just visitor
// view) since "نشاطك" reads oddly once the surrounding page is clearly
// an admin/dev profile. roleInfo is whatever getAdminRoleInfo() (or the
// visitor-view fetchAndRenderAdminStats() equivalent) returned — null/
// undefined for a regular user.
export function activityLabelFor(roleInfo) {
  if (roleInfo && roleInfo.isOwner) return "📈 نشاط المطور";
  if (roleInfo && roleInfo.role === "admin") return "📈 نشاط المشرف";
  return "📈 نشاطك";
}

// Local calendar YYYY-MM-DD — not UTC via toISOString — so Egypt (UTC+3)
// midnight cells and history timestamps land on the same day key.
export function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const d2 = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${d2}`;
}

function heatmapHoverHtml(date, count) {
  const dateLabel = date.toLocaleDateString("ar-EG");
  const countLabel = `${count} ${count === 1 ? "اختبار" : "اختبارات"}`;
  return `
    <span class="heatmap-hover-date">${dateLabel}</span>
    <span class="heatmap-hover-count">${countLabel}</span>`;
}

const WEEKDAY_LABELS_SAT_FIRST = [
  "سبت",
  "أحد",
  "اثن",
  "ثلا",
  "أرب",
  "خمي",
  "جمع",
];
const WEEKDAY_LABELS_SHORT = ["س", "ح", "ن", "ث", "ر", "خ", "ج"];
const MONTH_LABELS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

export function renderActivityHeatmap(user) {
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
  const year = today.getFullYear();
  const yearStart = new Date(year, 0, 1);
  yearStart.setHours(0, 0, 0, 0);
  const yearEnd = new Date(year, 11, 31);
  yearEnd.setHours(0, 0, 0, 0);

  // Align to Sat–Fri weeks so every column has exactly 7 cells.
  const start = new Date(yearStart);
  while (start.getDay() !== 6) {
    start.setDate(start.getDate() - 1);
  }
  start.setHours(0, 0, 0, 0);
  const endDate = new Date(yearEnd);
  while (endDate.getDay() !== 5) {
    endDate.setDate(endDate.getDate() + 1);
  }
  endDate.setHours(0, 0, 0, 0);

  const days = [];
  const cursor = new Date(start);
  while (cursor <= endDate) {
    const key = dateKey(cursor);
    const inYear = cursor >= yearStart && cursor <= yearEnd;
    if (!inYear) {
      // Week-alignment padding outside Jan 1–Dec 31 — visually disabled.
      days.push({ key, count: 0, date: new Date(cursor), disabled: true });
    } else if (cursor > today) {
      // Remaining days of this year — empty, but still part of the year.
      days.push({ key, count: 0, date: new Date(cursor), future: true });
    } else {
      days.push({ key, count: counts[key] || 0, date: new Date(cursor) });
    }
    cursor.setDate(cursor.getDate() + 1);
    // Re-normalize midnight after each step so DST transitions cannot
    // drop a calendar day and leave a short final column.
    cursor.setHours(0, 0, 0, 0);
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
  // Each column also carries its own month-axis label as its first
  // child, so the label and its cells scroll/space together as one
  // flex item — a separate axis row with independent gap/scroll easily
  // drifts out of alignment with the grid beneath it as columns build up.
  const todayKey = dateKey(today);
  let lastMonth = null;
  const cellsHtml = columns
    .map((col, colIdx) => {
      // One full month name on the first column that contains any day of that month.
      let axisLabel = "";
      for (const d of col) {
        if (d.date.getFullYear() !== year) continue;
        const monthIdx = d.date.getMonth();
        if (monthIdx !== lastMonth) {
          lastMonth = monthIdx;
          axisLabel = MONTH_LABELS_AR[monthIdx];
          break;
        }
      }

      const isCurrentWeek = col.some((d) => d.key === todayKey);

      const cellSpans = col
        .map((d, rowIdx) => {
          const delay = Math.min((colIdx * 7 + rowIdx) * 3, 900);
          if (d.disabled) {
            return `<span class="heatmap-cell heatmap-cell-disabled" aria-hidden="true" style="animation-delay:${delay}ms"></span>`;
          }
          const level = levelFor(d.count);
          const ariaLabel = `${d.date.toLocaleDateString("ar-EG")} • ${d.count} ${d.count === 1 ? "اختبار" : "اختبارات"}`;
          return `<span class="heatmap-cell js-has-hover" data-level="${level}" data-date="${d.key}" data-count="${d.count}" aria-label="${ariaLabel}" style="animation-delay:${delay}ms"></span>`;
        })
        .join("");

      return `
      <div class="heatmap-col${isCurrentWeek ? " is-current-week" : ""}">
        <span class="heatmap-col-label">${axisLabel}</span>
        ${cellSpans}
      </div>`;
    })
    .join("");

  const useShortDayLabels =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 480px)").matches;
  const dayLabels = useShortDayLabels
    ? WEEKDAY_LABELS_SHORT
    : WEEKDAY_LABELS_SAT_FIRST;
  const dayLabelsHtml = dayLabels
    .map((label) => `<span>${label}</span>`)
    .join("");

  const activeDays = days.filter((d) => d.count > 0).length;

  container.innerHTML = `
    <div class="heatmap-body">
      <div class="heatmap-daylabels">
        <span class="heatmap-daylabels-spacer"></span>
        ${dayLabelsHtml}
      </div>
      <div class="heatmap-grid" tabindex="0" role="region" aria-label="نشاطك خلال السنة — اسحب أفقياً للتمرير">${cellsHtml}</div>
    </div>
    <div class="heatmap-footer">
      <span><strong>${activeDays}</strong> يوم نشاط خلال سنة ${year}</span>
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

  container.querySelectorAll(".heatmap-cell.js-has-hover").forEach((cell) => {
    const key = cell.getAttribute("data-date");
    const count = Number(cell.getAttribute("data-count")) || 0;
    if (!key) return;
    // Reconstruct a local Date from the YYYY-MM-DD key for the tooltip label.
    const [y, m, day] = key.split("-").map(Number);
    const date = new Date(y, m - 1, day);
    attachHoverCard(cell, heatmapHoverHtml(date, count), "heatmap-hover-card");
  });

  // When the year overflows the card, bring the current week into view.
  const grid = container.querySelector(".heatmap-grid");
  const body = container.querySelector(".heatmap-body");
  const currentWeek = container.querySelector(".heatmap-col.is-current-week");
  if (grid) {
    requestAnimationFrame(() => {
      const overflowing = grid.scrollWidth > grid.clientWidth + 1;
      grid.classList.toggle("is-overflowing", overflowing);
      if (body) body.classList.toggle("is-overflowing", overflowing);
      if (!overflowing || !currentWeek) return;
      const gridRect = grid.getBoundingClientRect();
      const colRect = currentWeek.getBoundingClientRect();
      const delta =
        colRect.left + colRect.width / 2 - (gridRect.left + gridRect.width / 2);
      grid.scrollLeft += delta;
    });
  }
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
      const barColor =
        row.best >= 80 ? "success" : row.best >= 50 ? "warning" : "error";
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
      percent: Math.min(
        100,
        Math.round((c.progress.current / c.progress.goal) * 100),
      ),
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

// Module-level instance, mirroring historyList/bookmarksList in profile.js —
// re-mounting on every render (rather than re-creating a fresh InfiniteList)
// isn't necessary here since destroy()/mount() below already handle full
// teardown, but keeping one instance around lets a future caller extend
// this the same way profile.js does for the other two lists.
let flaggedListInstance = null;

function flaggedItemHtml(key, examList) {
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
}

export function renderFlaggedQuestions(user, examList) {
  const container = document.getElementById("flaggedList");
  if (!container) return;

  const flags = user.flags || {};
  const keys = Object.keys(flags).sort(
    (a, b) => (flags[b].timestamp || 0) - (flags[a].timestamp || 0),
  );

  if (flaggedListInstance) flaggedListInstance.destroy();

  flaggedListInstance = new InfiniteList({
    containerEl: container,
    items: keys,
    renderItem: (key) => flaggedItemHtml(key, examList),
    emptyHtml: `<div class="empty-state"><div class="empty-state-icon">🚩</div><p>لا توجد أسئلة معلّمة للمراجعة</p></div>`,
    mode: "button",
  });
  flaggedListInstance.mount();
}

window.unflagQuestion = function (examId, qIdx) {
  gameEngine.toggleFlag(examId, qIdx);
  const user = gameEngine.getUserData();
  renderFlaggedQuestions(user, window.__examListCache || []);
};

// ==================== Uploaded Quizzes History ====================
// Admin/dev only — last quizzes uploaded by the profile's owner, shown
// above 📜 التاريخ on both the owner's own dashboard and public /@handle
// profiles. Data comes from GET /api/admin-stats?uploads=true(&handle=X),
// which reuses this route's existing handle/JWT resolution (see
// api/admin-stats.js) rather than a new endpoint.

let uploadedQuizzesListInstance = null;

function uploadedQuizItemHtml(quiz) {
  const date = quiz.createdAt
    ? new Date(quiz.createdAt).toLocaleDateString("ar-EG")
    : "";
  const subtitleParts = [quiz.category, quiz.subject].filter(Boolean);
  return `
      <div class="history-item">
        <div class="history-info">
          <h4>${quiz.title || "اختبار بدون عنوان"}</h4>
          <small>${subtitleParts.join(" • ")}${subtitleParts.length && date ? " • " : ""}${date}</small>
        </div>
        <div class="history-actions">
          ${quiz.path ? `<a href="/q/${quiz.id}" class="nav-btn primary" style="padding:8px 14px;font-size:0.8rem;text-decoration:none;">اذهب إلى الإمتحان</a>` : ""}
        </div>
      </div>`;
}

// handle: null on the owner's own dashboard (resolved server-side via the
// Bearer token instead); the visited admin's handle on a public profile.
export async function renderUploadedQuizzes(handle = null) {
  const section = document.getElementById("uploadedQuizzesSection");
  const container = document.getElementById("uploadedQuizzesList");
  if (!section || !container) return;

  section.style.display = "";

  try {
    const token = localStorage.getItem("__bq_adm");
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let url = "/api/admin-stats?uploads=true";
    if (handle) url += `&handle=${encodeURIComponent(handle)}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      section.style.display = "none";
      return;
    }
    const data = await res.json();
    const uploads = data.uploads || [];

    if (uploadedQuizzesListInstance) uploadedQuizzesListInstance.destroy();
    uploadedQuizzesListInstance = new InfiniteList({
      containerEl: container,
      items: uploads,
      renderItem: uploadedQuizItemHtml,
      emptyHtml: `<div class="empty-state"><div class="empty-state-icon">📤</div><p>لم يتم رفع أي اختبارات بعد</p></div>`,
      mode: "button",
    });
    uploadedQuizzesListInstance.mount();
  } catch (err) {
    console.error("Failed to render uploaded quizzes", err);
    section.style.display = "none";
  }
}

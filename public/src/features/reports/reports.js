// =============================================================================
// public/src/features/reports/reports.js
// Controller for the Independent Hybrid Reports Page.
// Supports both Platform Admins and Regular Anonymous Users.
// =============================================================================

import {
  getToken,
  isAdminAuthenticated,
  getAdminRoleInfo,
} from "../../shared/adminAuth.js";
import { syncAdminSession } from "../../shared/adminBadgeSync.js";
import { renderMarkdown } from "../../shared/markdown.js";

const USER_STORAGE_KEY = "user_reported_questions";

let isAdmin = false;
let adminRole = null;
let currentScope = "my"; // "my" | "all" (Admin only)
let currentStatus = "pending"; // "pending" | "resolved" | "dismissed" | "all"
let searchQuery = "";
let loadedReports = [];
let toastTimer = null;

// ── Toast Notifications ───────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  const el = document.getElementById("reportsToast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast-msg show ${isError ? "error" : "success"}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 3500);
}

// ── HTML Escape Helper ────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return dateStr;
  }
}

// ── Auth Headers ──────────────────────────────────────────────────────────────
function getHeaders() {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

// ── Initialization ────────────────────────────────────────────────────────────
async function initReportsPage() {
  // Reconcile admin session if available
  if (isAdminAuthenticated()) {
    try {
      await syncAdminSession({
        onSignedOut: () => {
          isAdmin = false;
          renderShell();
          loadReports();
        },
      });
    } catch (err) {
      console.error("[reports] Admin session sync failed:", err);
    }
  }

  isAdmin = isAdminAuthenticated();
  try {
    adminRole = getAdminRoleInfo();
  } catch (_) {}

  renderShell();
  loadReports();
}

// ── Render Main Shell ─────────────────────────────────────────────────────────
function renderShell() {
  const app = document.getElementById("reportsApp");
  if (!app) return;

  const roleBadgeHtml = isAdmin
    ? `<span class="hero-role-badge admin">مشرف المنصة</span>`
    : `<span class="hero-role-badge">حساب مستخدم</span>`;

  const heroSubtitle = isAdmin
    ? "مراجعة وإدارة بلاغات الأسئلة المقدمة من الطلاب والمستخدمين على الاختبارات."
    : "سجل الأسئلة التي أبلغت عن وجود ملاحظات بها مع متابعة حالة المراجعة والتصحيح.";

  app.innerHTML = `
    <div class="reports-page-container">
      <!-- HERO BANNER -->
      <div class="reports-hero">
        <div class="hero-main">
          <div class="hero-icon-box">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div>
            <div class="hero-title">
              <span>البلاغات</span>
              ${roleBadgeHtml}
            </div>
            <div class="hero-subtitle">${heroSubtitle}</div>
          </div>
        </div>
      </div>

      <!-- STATS SUMMARY -->
      <div class="reports-stats-grid" id="reportsStatsGrid">
        <div class="report-stat-card">
          <div class="stat-icon-wrap total">📋</div>
          <div class="stat-info">
            <span class="stat-num" id="statTotal">0</span>
            <span class="stat-text">إجمالي البلاغات</span>
          </div>
        </div>
        <div class="report-stat-card">
          <div class="stat-icon-wrap pending">⏳</div>
          <div class="stat-info">
            <span class="stat-num" id="statPending">0</span>
            <span class="stat-text">قيد المراجعة</span>
          </div>
        </div>
        <div class="report-stat-card">
          <div class="stat-icon-wrap resolved">✅</div>
          <div class="stat-info">
            <span class="stat-num" id="statResolved">0</span>
            <span class="stat-text">تم الحل</span>
          </div>
        </div>
        <div class="report-stat-card">
          <div class="stat-icon-wrap dismissed">✕</div>
          <div class="stat-info">
            <span class="stat-num" id="statDismissed">0</span>
            <span class="stat-text">تم التجاهل</span>
          </div>
        </div>
      </div>

      <!-- CONTROLS -->
      <div class="reports-controls">
        <div class="controls-row-top">
          ${
            isAdmin
              ? `
            <div class="scope-tabs" id="scopeTabs">
              <button class="scope-tab-btn ${currentScope === "my" ? "active" : ""}" data-scope="my">
                <span>بلاغات اختباراتي</span>
              </button>
              <button class="scope-tab-btn ${currentScope === "all" ? "active" : ""}" data-scope="all">
                <span>جميع البلاغات</span>
              </button>
            </div>`
              : `<div style="font-weight: 600; font-size: 1rem; color: var(--text-primary);">سجل بلاغاتي السابقة</div>`
          }

          <div class="search-filter-wrap">
            <svg class="search-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input 
              type="text" 
              id="reportSearchInput" 
              class="search-filter-input" 
              placeholder="بحث في البلاغات أو الأسئلة..."
              value="${escapeHtml(searchQuery)}"
            >
          </div>
        </div>

        <div class="status-filters" id="statusFilters">
          <button class="status-pill ${currentStatus === "pending" ? "active" : ""}" data-status="pending">
            <span class="pill-dot pending"></span>
            <span>قيد الانتظار</span>
          </button>
          <button class="status-pill ${currentStatus === "resolved" ? "active" : ""}" data-status="resolved">
            <span class="pill-dot resolved"></span>
            <span>تم الحل</span>
          </button>
          <button class="status-pill ${currentStatus === "dismissed" ? "active" : ""}" data-status="dismissed">
            <span class="pill-dot dismissed"></span>
            <span>تم التجاهل</span>
          </button>
          <button class="status-pill ${currentStatus === "all" ? "active" : ""}" data-status="all">
            <span class="pill-dot all"></span>
            <span>الكل</span>
          </button>
        </div>
      </div>

      <!-- LIST CONTAINER -->
      <div id="reportsListContainer" class="reports-list">
        <div class="reports-empty-state">
          <div class="empty-icon-wrap">⏳</div>
          <div class="empty-title">جاري تحميل البلاغات...</div>
        </div>
      </div>
    </div>

    <!-- TOAST -->
    <div id="reportsToast" class="toast-msg"></div>
  `;

  // Attach event listeners
  if (isAdmin) {
    const scopeBtns = document.querySelectorAll(".scope-tab-btn");
    scopeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        scopeBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentScope = btn.dataset.scope;
        loadReports();
      });
    });
  }

  const statusPills = document.querySelectorAll(".status-pill");
  statusPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      statusPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      currentStatus = pill.dataset.status;
      renderReportsList();
    });
  });

  const searchInput = document.getElementById("reportSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderReportsList();
    });
  }
}

// ── Load Reports ──────────────────────────────────────────────────────────────
async function loadReports() {
  const container = document.getElementById("reportsListContainer");
  if (!container) return;

  container.innerHTML = `
    <div class="reports-empty-state">
      <div class="empty-icon-wrap">⏳</div>
      <div class="empty-title">جاري تحميل البلاغات...</div>
    </div>
  `;

  if (isAdmin) {
    await loadAdminReports();
  } else {
    await loadUserReports();
  }
}

// ── Admin Reports Loading ─────────────────────────────────────────────────────
async function loadAdminReports() {
  try {
    const res = await fetch(`/api/reports?scope=${currentScope}&status=all`, {
      headers: getHeaders(),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "فشل تحميل البلاغات");
    }

    loadedReports = data.reports || [];
    updateStatsSummary(loadedReports);
    renderReportsList();
  } catch (err) {
    console.error("[reports] Error loading admin reports:", err);
    showToast(err.message, true);
    const container = document.getElementById("reportsListContainer");
    if (container) {
      container.innerHTML = `
        <div class="reports-empty-state">
          <div class="empty-icon-wrap" style="color:#ef4444;">⚠️</div>
          <div class="empty-title">حدث خطأ أثناء جلب البلاغات</div>
          <div class="empty-desc">${escapeHtml(err.message)}</div>
          <button class="empty-btn-action" onclick="window.reloadReports()">إعادة المحاولة</button>
        </div>
      `;
    }
  }
}

// ── User Reports Loading ──────────────────────────────────────────────────────
async function loadUserReports() {
  try {
    let localReports = [];
    try {
      localReports = JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || "[]");
    } catch (_) {
      localReports = [];
    }

    if (!Array.isArray(localReports) || localReports.length === 0) {
      loadedReports = [];
      updateStatsSummary([]);
      renderReportsList();
      return;
    }

    // Extract report IDs that have valid UUID format
    const ids = localReports
      .map((r) => r.id)
      .filter((id) => typeof id === "string" && id.includes("-"));

    if (ids.length > 0) {
      try {
        const res = await fetch(`/api/reports?ids=${ids.join(",")}`);
        if (res.ok) {
          const data = await res.json();
          const serverReports = data.reports || [];
          const serverMap = new Map(serverReports.map((r) => [r.id, r]));

          // Merge updated server status into local records
          localReports = localReports.map((localRep) => {
            const serverRep = serverMap.get(localRep.id);
            if (serverRep) {
              return {
                ...localRep,
                status: serverRep.status,
                resolved_at: serverRep.resolved_at,
                quiz_title: serverRep.quizzes?.title || localRep.quiz_title,
              };
            }
            return localRep;
          });

          // Save back updated status to localStorage
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(localReports));
        }
      } catch (syncErr) {
        console.warn("[reports] Failed to sync live status:", syncErr);
      }
    }

    loadedReports = localReports;
    updateStatsSummary(loadedReports);
    renderReportsList();
  } catch (err) {
    console.error("[reports] User reports error:", err);
    loadedReports = [];
    renderReportsList();
  }
}

// ── Update Summary Stats ──────────────────────────────────────────────────────
function updateStatsSummary(reports) {
  const total = reports.length;
  const pending = reports.filter((r) => r.status === "pending").length;
  const resolved = reports.filter((r) => r.status === "resolved").length;
  const dismissed = reports.filter((r) => r.status === "dismissed").length;

  const statTotal = document.getElementById("statTotal");
  const statPending = document.getElementById("statPending");
  const statResolved = document.getElementById("statResolved");
  const statDismissed = document.getElementById("statDismissed");

  if (statTotal) statTotal.textContent = total;
  if (statPending) statPending.textContent = pending;
  if (statResolved) statResolved.textContent = resolved;
  if (statDismissed) statDismissed.textContent = dismissed;
}

// ── Render Reports List ───────────────────────────────────────────────────────
function renderReportsList() {
  const container = document.getElementById("reportsListContainer");
  if (!container) return;

  let filtered = loadedReports;

  // Filter by status pill
  if (currentStatus !== "all") {
    filtered = filtered.filter((r) => r.status === currentStatus);
  }

  // Filter by search query
  if (searchQuery) {
    filtered = filtered.filter((r) => {
      const quizTitle = (r.quizzes?.title || r.quiz_title || "").toLowerCase();
      const reason = (r.reason || "").toLowerCase();
      const qText = getQuestionText(r).toLowerCase();
      return (
        quizTitle.includes(searchQuery) ||
        reason.includes(searchQuery) ||
        qText.includes(searchQuery)
      );
    });
  }

  if (filtered.length === 0) {
    const emptyTitle = searchQuery
      ? "لا توجد نتائج مطابقة للبحث"
      : currentStatus === "pending"
      ? "لا توجد بلاغات قيد الانتظار حالياً 🎉"
      : "لا توجد بلاغات في هذه الفئة";

    const emptyDesc = isAdmin
      ? "سيتم إدراج البلاغات الجديدة هنا فور تقديمها من الطلاب والمستخدمين."
      : "عند مواجهة أي خطأ أو سؤال غير واضح في الاختبارات، يمكنك الإبلاغ عنه من خلال زر الإبلاغ داخل الاختبار وستتمكن من متابعة حله هنا.";

    container.innerHTML = `
      <div class="reports-empty-state">
        <div class="empty-icon-wrap">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
        </div>
        <div class="empty-title">${emptyTitle}</div>
        <div class="empty-desc">${emptyDesc}</div>
        ${
          !isAdmin
            ? `<a href="/" class="empty-btn-action">
                <span>تصفح الامتحانات</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
               </a>`
            : ""
        }
      </div>
    `;
    return;
  }

  let html = "";
  filtered.forEach((rep) => {
    const quizTitle = rep.quizzes?.title || rep.quiz_title || "اختبار";
    const qIndex = rep.question_index ?? 0;
    const rawQuestionText = getQuestionText(rep);
    const dateFormatted = formatDate(rep.created_at);
    const isPending = rep.status === "pending";

    let statusBadgeHtml = "";
    if (rep.status === "resolved") {
      statusBadgeHtml = `
        <div class="status-badge resolved">
          <span>✓ تم الحل والتصحيح</span>
        </div>
      `;
    } else if (rep.status === "dismissed") {
      statusBadgeHtml = `
        <div class="status-badge dismissed">
          <span>✕ تم التجاهل / لا يوجد خطأ</span>
        </div>
      `;
    } else {
      statusBadgeHtml = `
        <div class="status-badge pending">
          <span>⏳ قيد المراجعة</span>
        </div>
      `;
    }

    const resolvedTimeHtml = rep.resolved_at
      ? `<span class="resolved-time-text">تمت المعالجة: ${formatDate(rep.resolved_at)}</span>`
      : "";

    html += `
      <div class="report-card ${rep.status}" id="report-${rep.id}">
        <div class="report-card-header">
          <div class="report-meta-group">
            <span class="report-quiz-title">${escapeHtml(quizTitle)}</span>
            <span class="report-q-badge">سؤال رقم ${qIndex + 1}</span>
          </div>
          <span class="report-date">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            ${dateFormatted}
          </span>
        </div>

        <div class="report-reason-box">
          <span class="report-reason-label">سبب البلاغ:</span>
          <span class="report-reason-text">${escapeHtml(rep.reason || "غير محدد")}</span>
        </div>

        <div class="report-question-box">
          <div class="report-question-label">نص السؤال:</div>
          <div class="report-question-body">${renderMarkdown(rawQuestionText)}</div>
        </div>

        <div class="report-card-footer">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            ${statusBadgeHtml}
            ${resolvedTimeHtml}
          </div>

          ${
            isAdmin && isPending
              ? `
            <div class="report-actions">
              <button class="btn-resolve" onclick="window.resolveReport('${rep.id}', 'resolved')">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                تم الحل
              </button>
              <button class="btn-dismiss" onclick="window.resolveReport('${rep.id}', 'dismissed')">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                تجاهل
              </button>
            </div>`
              : ""
          }
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function getQuestionText(report) {
  if (report.question_text) return report.question_text;
  const questions = report.quizzes?.data?.questions || [];
  const qObj = questions[report.question_index] || {};
  return (
    qObj.q ||
    qObj.question ||
    qObj.text ||
    `سؤال رقم ${(report.question_index ?? 0) + 1}`
  );
}

// ── Admin Actions ─────────────────────────────────────────────────────────────
window.resolveReport = async (reportId, newStatus) => {
  try {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        action: "resolve",
        report_id: reportId,
        status: newStatus,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "فشل تحديث حالة البلاغ");
    }

    showToast(
      newStatus === "resolved" ? "تم حل البلاغ وتحديث حالته بنجاح" : "تم تجاهل البلاغ",
    );

    // Refresh reports list
    loadReports();
  } catch (err) {
    showToast(err.message, true);
  }
};

window.reloadReports = () => {
  loadReports();
};

// ── Bootstrap on DOM Ready ────────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initReportsPage);
} else {
  initReportsPage();
}
// =============================================================================
// public/src/features/control/reports-view.js
// Admin reports review panel
// =============================================================================

import { renderMarkdown } from "../../shared/markdown.js";

let currentStatus = "pending";
let _getHeaders = null;
let _showMessage = null;
let _onUpdate = null;

export async function fetchPendingReportsCount(getHeaders) {
  try {
    const res = await fetch("/api/reports?status=pending&countOnly=true", {
      headers: getHeaders(),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.count || 0;
  } catch (err) {
    console.error("[reports-view] Failed to fetch count:", err);
    return 0;
  }
}

export function initReportsView(container, getHeaders, showMessage, onUpdate) {
  _getHeaders = getHeaders;
  _showMessage = showMessage;
  _onUpdate = onUpdate;
  renderShell(container);
  loadReports();
}

function renderShell(container) {
  container.innerHTML = `
    <div class="panel reports-panel">
      <div class="panel-header reports-header">
        <div class="panel-title">إدارة بلاغات الأسئلة</div>
        <div class="reports-tabs">
          <button class="reports-tab-btn ${currentStatus === "pending" ? "active" : ""}" data-status="pending">
            قيد الانتظار
            <span class="tab-badge" id="pendingTabBadge" style="display: none;">0</span>
          </button>
          <button class="reports-tab-btn ${currentStatus === "resolved" ? "active" : ""}" data-status="resolved">
            تم الحل
          </button>
          <button class="reports-tab-btn ${currentStatus === "dismissed" ? "active" : ""}" data-status="dismissed">
            تم التجاهل
          </button>
        </div>
      </div>
      <div class="panel-body">
        <div id="reportsList" class="reports-list">
          <div class="admin-empty">جاري التحميل...</div>
        </div>
      </div>
    </div>
  `;

  const tabs = container.querySelectorAll(".reports-tab-btn");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentStatus = tab.dataset.status;
      loadReports();
    });
  });
}

async function loadReports() {
  const listEl = document.getElementById("reportsList");
  if (!listEl) return;
  listEl.innerHTML = '<div class="admin-empty">جاري التحميل...</div>';

  try {
    const res = await fetch(`/api/reports?status=${currentStatus}`, {
      headers: _getHeaders(),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "فشل تحميل البلاغات");
    }

    const reports = data.reports || [];
    renderReports(reports);

    if (typeof _onUpdate === "function") {
      _onUpdate();
    }
  } catch (err) {
    if (_showMessage) _showMessage(err.message, true);
    listEl.innerHTML = `<div class="admin-empty error">${err.message}</div>`;
  }
}

function renderReports(reports) {
  const listEl = document.getElementById("reportsList");
  if (!listEl) return;

  if (!reports || reports.length === 0) {
    listEl.innerHTML = '<div class="admin-empty">لا توجد بلاغات في هذه الفئة</div>';
    return;
  }

  let html = "";
  reports.forEach((rep) => {
    const quiz = rep.quizzes || {};
    const quizTitle = quiz.title || "اختبار غير معروف";
    const questions = quiz.data?.questions || [];
    const qObj = questions[rep.question_index] || {};
    const rawQuestionText = qObj.q || qObj.question || qObj.text || "نص السؤال غير متوفر";
    const date = new Date(rep.created_at).toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const isPending = rep.status === "pending";

    html += `
      <div class="report-card ${rep.status}" id="report-${rep.id}">
        <div class="report-card-header">
          <div class="report-quiz-info">
            <span class="report-quiz-title">${escapeHtml(quizTitle)}</span>
            <span class="meta-dot"></span>
            <span class="report-q-idx">سؤال رقم ${rep.question_index + 1}</span>
          </div>
          <span class="report-date">${date}</span>
        </div>

        <div class="report-reason-box">
          <span class="report-reason-label">سبب البلاغ:</span>
          <span class="report-reason-text">${escapeHtml(rep.reason)}</span>
        </div>

        <div class="report-question-preview-box">
          <div class="report-q-label">نص السؤال:</div>
          <div class="report-q-content">${renderMarkdown(rawQuestionText)}</div>
        </div>

        ${
          isPending
            ? `
          <div class="report-actions">
            <button class="btn-resolve" onclick="window.resolveReport(${rep.id}, 'resolved')">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              تم الحل
            </button>
            <button class="btn-dismiss" onclick="window.resolveReport(${rep.id}, 'dismissed')">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              تجاهل
            </button>
          </div>`
            : `
          <div class="report-status-badge ${rep.status}">
            ${rep.status === "resolved" ? "✓ تم الحل" : "✕ تم التجاهل"}
          </div>`
        }
      </div>
    `;
  });

  listEl.innerHTML = html;
}

window.resolveReport = async (reportId, newStatus) => {
  try {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: _getHeaders(),
      body: JSON.stringify({
        action: "resolve",
        report_id: reportId,
        status: newStatus,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "فشل تحديث البلاغ");
    }

    if (_showMessage) {
      _showMessage(
        newStatus === "resolved" ? "تم حل البلاغ بنجاح" : "تم تجاهل البلاغ",
      );
    }

    loadReports();
  } catch (err) {
    if (_showMessage) _showMessage(err.message, true);
  }
};

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

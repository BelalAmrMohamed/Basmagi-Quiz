// ============================================================================
// EXAM CARD — renders a single manifest-exam card (title, badges, download
// popup, and the ⋮ actions menu). The mobile/desktop download popup is a
// closure captured per-card (matches the original's structure — it captures
// per-card `exam`/`config` state, so it isn't a standalone module function).
// ============================================================================

import { escapeHtml } from "./escape-html.js";
import { isRecentlyAdded } from "./date-utils.js";
import { formatArabicQuestionCount } from "./course-count.js";
import { qz } from "./quiz-schema.js";
import { ensureDownloadAllowed } from "./download-password.js";
import {
  executeExport,
  triggerDownload,
  withDownloadLoading,
  buildCopyDownloadButton,
} from "./export-helpers.js";
import { buildQuizText } from "../../export/export-to-text.js";
import { buildJsonQuizExport } from "../../shared/quiz-processor.js";
import { formatQuestionTypesForDownload } from "./quiz-schema.js";
import { extractCategoryFromPath, formatDateForInfo, showQuizInfoModal } from "./quiz-info-modal.js";
import { createExamInfoSubmenu, openExamDropdownMenu } from "./exam-dropdown-menu.js";
import {
  LOCK_ICON_SVG,
  DOWNLOAD_ICON_SVG,
  COPY_ICON_SVG,
  SHARE_ICON_SVG,
  JSON_FILE_ICON_SVG,
  DOWNLOAD_SOURCE_ICON_SVG,
  MORE_DOTS_ICON_SVG,
} from "./icons.js";

// NOTE: showNotification() is a global provided by src/components/notifications.js,
// loaded as a plain (non-module) <script> in index.html — not imported here,
// matching the original single-file index.js's behavior.

function buildExamShareUrl(examId) {
  return window.location.origin + "/q/" + encodeURIComponent(examId);
}

export function createExamCard(exam) {
  const card = document.createElement("div");
  card.className = "card exam-card";
  card.setAttribute("role", "article");
  card.setAttribute("title", `${exam.description || exam.title}`);
  card.setAttribute("aria-label", `إمتحان: ${exam.title || exam.id}`);

  // ── DB source accent border ───────────────────────────────────────────────
  if (exam.dbSource === "db") card.classList.add("exam-card--db");

  // ──────────────────────────────────────────────────────────────────────────

  const h = document.createElement("h3");
  // SECURITY FIX: exam.title now runs through escapeHtml() before reaching
  // innerHTML — normalizes with the same defense-in-depth fix applied to the
  // (higher-risk, user-supplied) equivalent in user-quiz-card.js, even though
  // manifest titles are build-time data rather than direct user input.
  h.innerHTML = `<span class="phone-only-emoji">📖</span> ${escapeHtml(exam.title || exam.id)}`;

  if (isRecentlyAdded(exam.createdAt)) {
    const newBadge = document.createElement("span");
    newBadge.className = "new-badge";
    newBadge.textContent = "جديد";
    newBadge.setAttribute("aria-label", "مضاف حديثاً");
    card.appendChild(newBadge);
  }

  const questionCountLine = document.createElement("p");
  questionCountLine.className = "exam-question-count";
  questionCountLine.textContent = "";

  const btn = document.createElement("button");
  btn.className = "start-btn";
  btn.type = "button";
  btn.style.flex = "1";
  btn.style.minWidth = "0";
  btn.textContent = "إبدأ الإختبار";
  btn.setAttribute("aria-label", `بدء اختبار ${exam.title || exam.id}`);
  btn.onclick = (ev) => {
    ev.stopPropagation();
    startQuiz(exam.id);
  };

  const onDownloadOption = async (format) => {
    let mod;
    const config = {
      id: exam.id,
      title: exam.title || exam.id,
      path: exam.path,
      source: exam.source || null,
      description: exam.description || null,
      createdAt: exam.createdAt || null,
      author: exam.author || null,
      author_email: exam.author_email || null,
      password: exam.password || null,
      // view/mode are never present on manifest entries (see quizManifest.js)
      // — they only get backfilled below once we've loaded the raw quiz file.
      view: null,
      mode: null,
      // BUG FIX: the manifest entry uses `questionTypes`/`questionCount`,
      // not `type`/`count` — those never existed on `exam`, so this was
      // always null regardless of what the quiz file contained.
      questionTypes: exam.questionTypes || null,
      questionCount: exam.questionCount || null,
    };
    // Load exam data (HANDLES .js vs .json issue)
    let questions = [];
    let rawMeta = null;
    let rawStats = null;
    try {
      const path = config.path;
      if (path.endsWith(".json")) {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        questions = data.questions;
        rawMeta = data.meta || null;
        rawStats = data.stats || null;
      } else if (path.endsWith(".js")) {
        // Try fetching as JSON first if it might be a mislabeled path
        // But if it's really a JS file with export, we use import
        // The issue reported is 404 on .js because the file is .json
        // Let's try to check: if 404 on .js, try replacing with .json
        try {
          mod = await import(config.path);
          questions = mod.questions;
          rawMeta = mod.meta || null;
          rawStats = mod.stats || null;
        } catch (jsErr) {
          console.warn(
            "Failed to load as JS, trying JSON substitute...",
            jsErr,
          );
          const jsonPath = config.path.replace(/\.js$/, ".json");
          const res = await fetch(jsonPath);
          if (!res.ok) throw new Error("Failed to load as JSON as well");
          const data = await res.json();
          questions = data.questions;
          rawMeta = data.meta || null;
          rawStats = data.stats || null;
        }
      } else {
        // Fallback
        mod = await import(config.path);
        questions = mod.questions;
        rawMeta = mod.meta || null;
        rawStats = mod.stats || null;
      }
    } catch (e) {
      console.error("Load failed", e);
      alert("Failed to load exam data.");
      return;
    }

    // Defensive patch: the manifest is a lossy summary (it never carries
    // view/mode, and may be stale/incomplete for other fields). Now that
    // we have the raw quiz file in hand anyway, backfill anything missing
    // on config from its meta/stats — same pattern result.js uses.
    if (rawMeta) {
      if (!config.source) config.source = rawMeta.source || null;
      if (!config.description) config.description = rawMeta.description || null;
      if (!config.createdAt) config.createdAt = rawMeta.createdAt || null;
      if (!config.author) config.author = rawMeta.author || null;
      if (!config.author_email)
        config.author_email = rawMeta.author_email || null;
      if (!config.password) config.password = rawMeta.password || null;
      config.view = rawMeta.view || null;
      config.mode = rawMeta.mode || null;
    }
    if (rawStats) {
      if (!config.questionTypes)
        config.questionTypes = formatQuestionTypesForDownload(
          rawStats.questionTypes,
        );
      if (!config.questionCount)
        config.questionCount =
          rawStats.questionCount ?? (questions || []).length;
    }

    await executeExport(format, config, questions);
  };

  const showDownloadPopup = async () => {
    const allowed = await ensureDownloadAllowed(
      exam.id,
      exam.password,
      exam.title || exam.id,
      exam.dbSource,
    );
    if (!allowed) return;

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.style.transform = "translateZ(0)";
    modal.style.willChange = "opacity";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "downloadModalTitle");

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    const modalCard = document.createElement("div");
    modalCard.className = "modal-card";
    modalCard.style.contain = "layout style paint";

    const h2 = document.createElement("h2");
    h2.id = "downloadModalTitle";
    h2.textContent = exam.title || exam.id;

    const p = document.createElement("p");
    p.textContent = "اختر طريقة التنزيل";

    const grid = document.createElement("div");
    grid.className = "mode-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "خيارات التنزيل");

    opts.forEach(([icon, label, format]) => {
      const b = document.createElement("button");
      b.className = "mode-btn";
      b.type = "button";
      b.setAttribute("aria-label", `تنزيل كـ ${label}`);
      b.innerHTML = `<img src="${icon}" alt="context icon" class="icon" aria-hidden="true"><strong>${label}</strong>`;
      b.onclick = (ev) => {
        ev.stopPropagation();
        withDownloadLoading(b, () => onDownloadOption(format)).then(() =>
          modal.remove(),
        );
      };
      grid.appendChild(b);
    });

    const copyBtn = buildCopyDownloadButton(async () => {
      const res = await fetch(exam.path);
      const data = await res.json();
      const questions = data.questions || [];
      const config = {
        id: exam.id,
        title: exam.title || exam.id,
        source: exam.source || null,
        description: exam.description || null,
        createdAt: exam.createdAt || null,
        author: exam.author || null,
        author_email: exam.author_email || null,
        password: exam.password || null,
        view: exam.view || null, // This one doesn't show up
        mode: exam.mode || null, // This one doesn't show up
        questionTypes: exam.type || null, // This one doesn't show up
        questionCount: exam.count || null,
      };
      return buildQuizText(config, questions);
    }, exam.title || exam.id);
    grid.appendChild(copyBtn);

    const jsonBtn = document.createElement("button");
    jsonBtn.className = "mode-btn";
    jsonBtn.type = "button";
    jsonBtn.setAttribute("aria-label", `Download JSON (.json)`);
    jsonBtn.innerHTML = `${JSON_FILE_ICON_SVG}<strong>JSON (.json)</strong>`;
    jsonBtn.onclick = (ev) => {
      ev.stopPropagation();
      withDownloadLoading(jsonBtn, async () => {
        try {
          const res = await fetch(exam.path);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          triggerDownload(blob, `${exam.title || exam.id}.json`);
        } catch (e) {
          console.error("JSON Error:", e);
          alert("فشل تنزيل ملف JSON");
        }
      }).then(() => modal.remove());
    };
    grid.appendChild(jsonBtn);

    // Show source button if source URL is available in the manifest
    if (exam.source && typeof exam.source === "string") {
      const sourceBtn = document.createElement("button");
      sourceBtn.className = "mode-btn";
      sourceBtn.type = "button";
      sourceBtn.setAttribute("aria-label", `Download Source`);
      sourceBtn.innerHTML = `${DOWNLOAD_SOURCE_ICON_SVG}<strong>Download Source</strong>`;
      sourceBtn.onclick = (ev) => {
        ev.stopPropagation();
        window.open(exam.source, "_blank");
        modal.remove();
      };
      grid.appendChild(sourceBtn);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "close-modal";
    closeBtn.type = "button";
    closeBtn.textContent = "إلغاء";
    closeBtn.setAttribute("aria-label", "إغلاق النافذة");
    closeBtn.onclick = () => modal.remove();

    modalCard.appendChild(h2);
    modalCard.appendChild(p);
    modalCard.appendChild(grid);
    modalCard.appendChild(closeBtn);
    modal.appendChild(modalCard);

    requestAnimationFrame(() => {
      document.body.appendChild(modal);
      // Focus first button
      const firstBtn = grid.querySelector("button");
      if (firstBtn) firstBtn.focus();
    });
  };

  const downloadBtn = document.createElement("button");
  downloadBtn.className = exam.password
    ? "start-btn desktop-download-btn is-password-protected"
    : "start-btn desktop-download-btn";
  downloadBtn.type = "button";
  downloadBtn.style.flex = "1";
  downloadBtn.style.minWidth = "0";
  downloadBtn.style.background =
    "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)";
  downloadBtn.style.color = "white";
  downloadBtn.style.boxShadow = "0 4px 14px rgba(220, 38, 38, 0.4)";
  downloadBtn.innerHTML = exam.password
    ? `${LOCK_ICON_SVG}<span>تحميل</span>`
    : "تحميل";
  downloadBtn.setAttribute(
    "aria-label",
    exam.password
      ? `تحميل ${exam.title || exam.id} (محمي بكلمة مرور)`
      : `تحميل ${exam.title || exam.id}`,
  );
  if (exam.password) downloadBtn.title = "هذا الإمتحان محمي بكلمة مرور";
  downloadBtn.onclick = (ev) => {
    ev.stopPropagation();
    showDownloadPopup();
  };

  const moreBtn = document.createElement("button");
  moreBtn.className = "exam-more-btn";
  moreBtn.type = "button";
  moreBtn.innerHTML = MORE_DOTS_ICON_SVG;
  moreBtn.setAttribute("aria-label", `خيارات إضافية لـ ${exam.title || exam.id}`);
  moreBtn.onclick = (ev) => {
    ev.stopPropagation();
    showExamActionsOverlay(exam, showDownloadPopup, moreBtn);
  };

  const btnWrap = document.createElement("div");
  btnWrap.className = "exam-card-actions-wrap";
  btnWrap.appendChild(moreBtn);
  btnWrap.appendChild(btn);
  btnWrap.appendChild(downloadBtn);

  card.style.position = "relative";

  // ── Build text wrapper (display:contents on desktop, flex-col on mobile) ──
  const textWrap = document.createElement("div");
  textWrap.className = "card-text";
  textWrap.appendChild(h);

  // Meta wrapper: holds types + count in a flex row on desktop, column on mobile
  const metaWrap = document.createElement("div");
  metaWrap.className = "exam-card-meta";

  // Render question types as a plain subtext line (e.g. "MCQ · Essay")
  if (Array.isArray(exam.questionTypes) && exam.questionTypes.length > 0) {
    const typesLine = document.createElement("p");
    typesLine.className = "exam-question-count exam-types-subtext";
    typesLine.textContent = exam.questionTypes.join(" · ");
    metaWrap.appendChild(typesLine);
  }

  metaWrap.appendChild(questionCountLine);
  textWrap.appendChild(metaWrap);

  // DOM order: [db-badge] [textWrap] [btnWrap]
  // On desktop: textWrap is display:contents (transparent).
  // On mobile: flex row → textWrap fills space.
  card.appendChild(textWrap);
  card.appendChild(btnWrap);

  // Read question count from manifest (no individual file fetch needed)
  if (typeof exam.questionCount === "number" && exam.questionCount > 0) {
    questionCountLine.textContent = formatArabicQuestionCount(
      exam.questionCount,
    );
  }

  return card;
}

/**
 * Shows the shared "more actions" bottom-sheet overlay for an exam card.
 * Used by both the desktop and mobile 3-dots trigger button.
 *
 * @param {object} exam - manifest exam entry
 * @param {() => void|Promise<void>} showDownloadPopup - opens the
 *   format-picker popup (already password-gated by the caller)
 */
function showExamActionsOverlay(exam, showDownloadPopup, triggerBtn) {
  openExamDropdownMenu(triggerBtn, (menu, closeMenu, reposition) => {
    const downloadOpt = document.createElement("button");
    downloadOpt.type = "button";
    downloadOpt.className = exam.password
      ? "exam-action-btn mobile-only exam-action-btn--primary is-password-protected"
      : "exam-action-btn mobile-only exam-action-btn--primary";
    downloadOpt.innerHTML = exam.password
      ? `${LOCK_ICON_SVG}<span>تحميل</span>`
      : `${DOWNLOAD_ICON_SVG}<span>تحميل</span>`;
    if (exam.password) downloadOpt.title = "هذا الإمتحان محمي بكلمة مرور";
    downloadOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      showDownloadPopup();
    };
    menu.appendChild(downloadOpt);

    const copyOpt = document.createElement("button");
    copyOpt.type = "button";
    copyOpt.className = "exam-action-btn";
    copyOpt.innerHTML = `${COPY_ICON_SVG}<span>نسخ الرابط</span>`;
    copyOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      navigator.clipboard
        .writeText(buildExamShareUrl(exam.id))
        .then(() =>
          showNotification("تم النسخ", "تم نسخ رابط الإمتحان!", "success"),
        );
    };
    menu.appendChild(copyOpt);

    const shareOpt = document.createElement("button");
    shareOpt.type = "button";
    shareOpt.className = "exam-action-btn";
    shareOpt.innerHTML = `${SHARE_ICON_SVG}<span>مشاركة الإمتحان</span>`;
    shareOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      const url = buildExamShareUrl(exam.id);
      if (navigator.share) {
        navigator
          .share({ title: exam.title || exam.id, url })
          .catch(() => {});
      } else {
        navigator.clipboard
          .writeText(url)
          .then(() =>
            showNotification("تم النسخ", "تم نسخ رابط الإمتحان!", "success"),
          );
      }
    };
    menu.appendChild(shareOpt);

    // ── "معلومات الإمتحان" submenu ───────────────────────────────────────
    // Basic preview built synchronously from the manifest entry. Shows only
    // id, description, category, date, and source (المصدر is
    // copy-to-clipboard). "كل المعلومات" opens the full quiz-info-modal-card
    // via showQuizInfoModal, which does the async backfill fetch for
    // anything still missing.
    const basicRows = [
      { label: "ID", val: exam.id, multiline: true, copyable: true },
      {
        label: "المادة",
        val: exam.category || extractCategoryFromPath(exam.path) || null,
        multiline: true,
      },
      { label: "الوصف", val: exam.description || null, multiline: true },
      { label: "التاريخ", val: formatDateForInfo(exam.createdAt) },
      {
        label: "المصدر",
        val: exam.source || null,
        multiline: true,
        copyable: true,
      },
    ].filter((r) => r.val);
    const infoSubmenu = createExamInfoSubmenu(
      basicRows,
      () => showQuizInfoModal(exam),
      closeMenu,
      reposition,
    );
    menu.appendChild(infoSubmenu);
  });
}

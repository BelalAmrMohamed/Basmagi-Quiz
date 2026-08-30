// ============================================================================
// public/src/features/home/exam-card.js
// EXAM CARD — renders a single manifest-exam card (title, badges, download
// popup, and the ⋮ actions menu). The mobile/desktop download popup is a
// closure captured per-card (matches the original's structure — it captures
// per-card `exam`/`config` state, so it isn't a standalone module function).
// ============================================================================

import { startQuiz } from "./quiz-navigation.js";
import { isRecentlyAdded } from "./date-utils.js";
import { formatArabicQuestionCount } from "./course-count.js";
import { qz } from "./quiz-schema.js";
import { ensureDownloadAllowed } from "./download-password.js";
import { showDownloadModal } from "../../components/download-quiz-modal/download-quiz-modal.js";
import { formatQuestionTypesForDownload } from "./quiz-schema.js";
import { loadFullQuizData } from "./quiz-data-loader.js";
import { copyQuizToUserQuizzes } from "./copy-to-my-quizzes.js";
import { canDeleteQuiz, deleteQuizFromDatabase } from "./delete-quiz.js";
import { showQuizInfoModal } from "./quiz-info-modal.js";
import {
  extractCategoryFromPath,
  formatDateForInfo,
} from "../../components/quiz-info-modal/quiz-info-html.js";
import {
  createExamInfoSubmenu,
  openExamDropdownMenu,
} from "./exam-dropdown-menu.js";
import {
  LOCK_ICON_SVG,
  DOWNLOAD_ICON_SVG,
  COPY_ICON_SVG,
  DUPLICATE_ICON_SVG,
  SHARE_ICON_SVG,
  MORE_DOTS_ICON_SVG,
  TRASH_ICON_SVG,
} from "./icons.js";
import {
  showNotification,
  _confirm,
} from "../../components/notifications/notifications.js";

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
  h.textContent = exam.title || exam.id;

  // ── Phone-only leading emoji — sibling of .card-text, not nested inside
  // h3. BUG FIX: the emoji used to live inside <h3>, so on the mobile list
  // row its vertical centering was governed by the title text's line-height
  // instead of the row's own flex alignment — sitting slightly too high
  // compared to category/subfolder cards, which use a dedicated sibling
  // `.icon` element (see createCategoryCard in category-view.js). Using the
  // same sibling-element pattern here (kept as `.phone-only-emoji` so the
  // existing mobile CSS — width/height/flex-centering — still applies
  // unchanged) fixes the misalignment structurally instead of with a CSS
  // hack.
  const iconEl = document.createElement("span");
  iconEl.className = "phone-only-emoji";
  iconEl.textContent = "📖";
  iconEl.setAttribute("aria-hidden", "true");

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
  btn.textContent = "إبدأ";
  btn.setAttribute("aria-label", `بدء اختبار ${exam.title || exam.id}`);
  btn.onclick = (ev) => {
    ev.stopPropagation();
    startQuiz(exam.id);
  };

  const showDownloadPopup = async () => {
    let password = exam.password;
    if (!password) {
      try {
        const loaded = await loadFullQuizData(exam);
        if (loaded?.meta?.password) {
          password = loaded.meta.password;
          exam.password = password;
        }
      } catch (_) {}
    }

    const allowed = await ensureDownloadAllowed(
      exam.id,
      password,
      exam.title || exam.id,
      exam.dbSource,
    );
    if (!allowed) return;

    // Initial config built straight from the manifest summary — enough to
    // render the modal (title, source button) immediately. The full quiz
    // file — needed for questions and to backfill view/mode/description/etc.
    // — is only fetched lazily, once, the first time the user actually picks
    // a format (see resolveExportData below), matching this card's original
    // lazy-load behavior instead of forcing a fetch before the modal opens.
    const initialConfig = {
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
      // — they only get backfilled once the raw quiz file is loaded.
      view: null,
      mode: null,
      questionTypes: exam.questionTypes || null,
      questionCount: exam.questionCount || null,
    };

    // Same shared download quiz modal used on the homepage's "My
    // Quizzes" popup and the create-quiz page (see showDownloadModal() in
    // components/download-quiz-modal/download-quiz-modal.js) — identical
    // markup/styling/behavior across all three download entry points.
    showDownloadModal({
      config: initialConfig,
      questions: [],
      filenameBase: exam.title || exam.id,
      resolveExportData: async ({ config }) => {
        const loaded = await loadFullQuizData(exam);
        const questions = loaded.questions;
        const rawMeta = loaded.meta;
        const rawStats = loaded.stats;
        const resolved = { ...config };
        if (rawMeta) {
          if (!resolved.source) resolved.source = rawMeta.source || null;
          if (!resolved.description)
            resolved.description = rawMeta.description || null;
          if (!resolved.createdAt)
            resolved.createdAt = rawMeta.createdAt || null;
          if (!resolved.author) resolved.author = rawMeta.author || null;
          if (!resolved.author_email)
            resolved.author_email = rawMeta.author_email || null;
          if (!resolved.password) resolved.password = rawMeta.password || null;
          resolved.view = rawMeta.view || null;
          resolved.mode = rawMeta.mode || null;
        }
        if (rawStats) {
          if (!resolved.questionTypes)
            resolved.questionTypes = formatQuestionTypesForDownload(
              rawStats.questionTypes,
            );
          if (!resolved.questionCount)
            resolved.questionCount =
              rawStats.questionCount ?? (questions || []).length;
        }
        return { config: resolved, questions };
      },
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
  moreBtn.setAttribute(
    "aria-label",
    `خيارات إضافية لـ ${exam.title || exam.id}`,
  );
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

  // DOM order: [db-badge] [icon] [textWrap] [btnWrap] — icon as a sibling of
  // textWrap (not nested in h3) matches createCategoryCard's pattern so the
  // mobile list-row's flex alignment centers it the same way.
  // On desktop: .phone-only-emoji is display:none via CSS.
  card.appendChild(iconEl);
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
        navigator.share({ title: exam.title || exam.id, url }).catch(() => {});
      } else {
        navigator.clipboard
          .writeText(url)
          .then(() =>
            showNotification("تم النسخ", "تم نسخ رابط الإمتحان!", "success"),
          );
      }
    };
    menu.appendChild(shareOpt);

    // ── "نسخ لإمتحاناتي" — copies this quiz into the visitor's own
    // localStorage "إمتحاناتك" list. Visible on every quiz (static or DB),
    // for every visitor, logged in or not — no visibility gate here (see
    // Phase 0 spec, Feature B). Uses DUPLICATE_ICON_SVG rather than
    // COPY_ICON_SVG so it doesn't share an icon with "نسخ الرابط" above.
    const copyToMineOpt = document.createElement("button");
    copyToMineOpt.type = "button";
    copyToMineOpt.className = "exam-action-btn";
    copyToMineOpt.innerHTML = `${DUPLICATE_ICON_SVG}<span>نسخ لإمتحاناتي</span>`;
    copyToMineOpt.onclick = async (e) => {
      e.stopPropagation();
      closeMenu();
      copyToMineOpt.disabled = true;
      try {
        await copyQuizToUserQuizzes(exam);
      } finally {
        copyToMineOpt.disabled = false;
      }
    };
    menu.appendChild(copyToMineOpt);

    // ── "حذف" — database quizzes only, and only for the quiz's own
    // creator or a platform owner. canDeleteQuiz() covers both the
    // dbSource==="db" check and the creator/owner check, so this stays
    // hidden for static/relative-path quizzes and for anyone else's DB
    // quizzes.
    if (canDeleteQuiz(exam)) {
      const deleteOpt = document.createElement("button");
      deleteOpt.type = "button";
      deleteOpt.className = "exam-action-btn exam-action-btn--danger";
      deleteOpt.innerHTML = `${TRASH_ICON_SVG}<span>حذف الإمتحان</span>`;
      deleteOpt.onclick = async (e) => {
        e.stopPropagation();
        closeMenu();
        const creatorLabel = exam.author || exam.author_email || "غير معروف";
        const confirmed = await _confirm(
          `هل أنت متأكد من حذف "${exam.title || exam.id}"؟ \nصاحب الإمتحان: (${creatorLabel}). لا يمكن التراجع عن هذا الإجراء.`,
        );
        if (!confirmed) return;
        const ok = await deleteQuizFromDatabase(exam);
        // deleteQuizFromDatabase() already invalidated the manifest cache
        // and shown a notification; removing the card here is a same-view
        // optimistic update so the deleted quiz doesn't linger until the
        // next full re-render. showExamActionsOverlay() is a standalone
        // function (not a closure inside createExamCard), so the card
        // isn't directly in scope — reach it from triggerBtn instead.
        if (ok) triggerBtn.closest(".exam-card")?.remove();
      };
      menu.appendChild(deleteOpt);
    }

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

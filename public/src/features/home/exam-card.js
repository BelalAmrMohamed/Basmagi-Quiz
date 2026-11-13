// ============================================================================
// public/src/features/home/exam-card.js
// EXAM CARD — renders a single manifest-exam card (title, badges, download
// popup, and the ⋮ actions menu). The mobile/desktop download popup is a
// closure captured per-card (matches the original's structure — it captures
// per-card `exam`/`config` state, so it isn't a standalone module function).
// ============================================================================

import { createTypeChip, tagCardType, addCardShape } from "./card-type.js";
import { startQuiz } from "./quiz-navigation.js";
import { isRecentlyAdded } from "./date-utils.js";
import { formatArabicQuestionCount, refreshUserQuizzesCard } from "./course-count.js";
import { qz } from "./quiz-schema.js";
import { ensureDownloadAllowed } from "./download-password.js";
import { showQuizDownloadPopup } from "./download-modal.js";
import {
  showDownloadModal,
  withDownloadLoading,
} from "../../components/download-quiz-modal/download-quiz-modal.js";
import { formatQuestionTypesForDownload } from "./quiz-schema.js";
import { loadFullQuizData } from "./quiz-data-loader.js";
import { copyQuizToUserQuizzes, withCopyButtonLoadingState } from "./copy-to-my-quizzes.js";
import {
  canManageItem,
  openSharedMoveToDialog,
  renameSharedItem,
  editSharedItemMetadata,
  deleteSharedItem,
} from "./admin-item-actions.js";
import { showQuizInfoModal } from "./quiz-info-modal.js";
import { EMBED_ICON_SVG, copyEmbedCode } from "./embed-code.js";
import { fetchQuizDetails, fetchCreatorName } from "./info-details.js";
import { formatDateForInfo } from "../../components/quiz-info-modal/quiz-info-html.js";
import {
  createExamInfoSubmenu,
  createActionGroupSubmenu,
  openItemDropdownMenu,
} from "./item-dropdown-menu.js";
import {
  LOCK_ICON_SVG,
  DOWNLOAD_ICON_SVG,
  COPY_ICON_SVG,
  DUPLICATE_ICON_SVG,
  SHARE_ICON_SVG,
  MORE_DOTS_ICON_SVG,
  TRASH_ICON_SVG,
  RENAME_ICON_SVG,
  MOVE_TO_ICON_SVG,
  EDIT_ICON_SVG
} from "./icons.js";
import {
  showNotification,
} from "../../components/notifications/notifications.js";
import {
  openAIAgentWithAttachment,
  buildPlatformQuizAttachment,
} from "../../components/ai-agent/ai-agent-attach-launcher.js";
import { HOME_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { SPARKLE_ICON_SVG } from "./icons.js";

function buildExamShareUrl(examId) {
  return window.location.origin + "/quiz/" + encodeURIComponent(examId);
}

export function createExamCard(exam) {
  const card = document.createElement("div");
  card.className = "card exam-card";
  card.setAttribute("role", "article");
  card.setAttribute("aria-label", `امتحان: ${exam.title || exam.id}`);

  const h = document.createElement("h3");
  h.textContent = exam.title || exam.id;
  h.setAttribute("data-tooltip-badge", "📝 امتحان");
  h.setAttribute("data-tooltip-text", h.textContent);

  // ── Phone-only leading emoji — sibling of .card-text, not nested inside
  const iconEl = document.createElement("span");
  iconEl.className = "phone-only-emoji";
  iconEl.textContent = "📝";

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
  btn.setAttribute("aria-label", `بدء امتحان ${exam.title || exam.id}`);
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
      } catch (_) { }
    }

    const allowed = await ensureDownloadAllowed(
      exam.id,
      password,
      exam.title || exam.id,
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
      dbId: exam.dbId,
      title: exam.title || exam.id,
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
    : `${DOWNLOAD_ICON_SVG}<span>تحميل</span>`;
  downloadBtn.setAttribute(
    "aria-label",
    exam.password
      ? `تحميل ${exam.title || exam.id} (محمي بكلمة مرور)`
      : `تحميل ${exam.title || exam.id}`,
  );
  if (exam.password) downloadBtn.title = "هذا الامتحان محمي بكلمة مرور";
  downloadBtn.onclick = (ev) => {
    ev.stopPropagation();
    // showDownloadPopup() awaits ensureDownloadAllowed()/loadFullQuizData()
    // before the modal ever appears — without a loading state here, that
    // gap reads as unresponsive lag on click (the delay users reported).
    withDownloadLoading(downloadBtn, showDownloadPopup);
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
  textWrap.appendChild(createTypeChip("quiz"));
  tagCardType(card, "quiz");
  textWrap.appendChild(h);
  const description = String(exam.description || "").trim();
  if (description) {
    const descriptionEl = document.createElement("p");
    descriptionEl.className = "lesson-card-description";
    descriptionEl.textContent = description;
    descriptionEl.setAttribute("data-tooltip-badge", "📄 وصف الامتحان");
    descriptionEl.setAttribute("data-tooltip-text", description);
    textWrap.appendChild(descriptionEl);
  }

  // Meta wrapper: holds types + count in a flex row on desktop, column on mobile
  const metaWrap = document.createElement("div");
  metaWrap.className = "exam-card-meta";

  // Render question types as styled pill chips (consistent with user-quiz-card)
  if (Array.isArray(exam.questionTypes) && exam.questionTypes.length > 0) {
    const typesRow = document.createElement("div");
    typesRow.className = "user-quiz-types-row exam-types-subtext";
    const colorMap = {
      MCQ: "var(--color-primary-light)",
      Essay: "var(--color-success-light)",
      "True/False": "var(--color-warning-light)",
    };
    exam.questionTypes.forEach((t) => {
      const chip = document.createElement("span");
      chip.textContent = t;
      chip.style.cssText = `
        padding: 2px 10px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
        background: ${colorMap[t] || "var(--color-border)"};
        color: var(--color-text-primary);
      `;
      typesRow.appendChild(chip);
    });
    metaWrap.appendChild(typesRow);
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
  addCardShape(card, "quiz");

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
  openItemDropdownMenu(triggerBtn, (menu, closeMenu, reposition) => {
    const downloadOpt = document.createElement("button");
    downloadOpt.type = "button";
    downloadOpt.className = exam.password
      ? "exam-action-btn mobile-only exam-action-btn--primary is-password-protected"
      : "exam-action-btn mobile-only exam-action-btn--primary";
    downloadOpt.innerHTML = exam.password
      ? `${LOCK_ICON_SVG}<span>تحميل</span>`
      : `${DOWNLOAD_ICON_SVG}<span>تحميل</span>`;
    if (exam.password) downloadOpt.title = "هذا الامتحان محمي بكلمة مرور";
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
          showNotification("تم النسخ", "تم نسخ رابط الامتحان!", "success"),
        );
    };
    menu.appendChild(copyOpt);

    const embedOpt = document.createElement("button");
    embedOpt.type = "button";
    embedOpt.className = "exam-action-btn";
    embedOpt.innerHTML = `${EMBED_ICON_SVG}<span>نسخ كود التضمين</span>`;
    embedOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      void copyEmbedCode("quiz", exam.id, exam.title);
    };
    menu.appendChild(embedOpt);

    const shareOpt = document.createElement("button");
    shareOpt.type = "button";
    shareOpt.className = "exam-action-btn";
    shareOpt.innerHTML = `${SHARE_ICON_SVG}<span>مشاركة الرابط</span>`;
    shareOpt.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      const url = buildExamShareUrl(exam.id);
      if (navigator.share) {
        navigator.share({ title: exam.title || exam.id, url }).catch(() => { });
      } else {
        navigator.clipboard
          .writeText(url)
          .then(() =>
            showNotification("تم النسخ", "تم نسخ رابط الامتحان!", "success"),
          );
      }
    };
    menu.appendChild(shareOpt);

    // ── "نسخ إلى محتواي" — copies this quiz into the visitor's own
    // localStorage list. Visible on every quiz (static or DB),
    // for every visitor, logged in or not — no visibility gate here (see
    // Phase 0 spec, Feature B). Uses DUPLICATE_ICON_SVG rather than
    // COPY_ICON_SVG so it doesn't share an icon with "نسخ الرابط" above.
    const copyToMineOpt = document.createElement("button");
    copyToMineOpt.type = "button";
    copyToMineOpt.className = "exam-action-btn";
    copyToMineOpt.innerHTML = `${DUPLICATE_ICON_SVG}<span>نسخ إلى محتواي</span>`;
    copyToMineOpt.onclick = async (e) => {
      e.stopPropagation();
      await withCopyButtonLoadingState(copyToMineOpt, () =>
        copyQuizToUserQuizzes(exam),
      );
      refreshUserQuizzesCard();
      closeMenu();
    };
    menu.appendChild(copyToMineOpt);

    const askAiOpt = document.createElement("button");
    askAiOpt.type = "button";
    askAiOpt.className = "exam-action-btn";
    askAiOpt.innerHTML = `${SPARKLE_ICON_SVG}<span>اسأل الباشـمبصمج</span>`;
    askAiOpt.onclick = async (e) => {
      e.stopPropagation();
      closeMenu();
      askAiOpt.disabled = true;
      try {
        const fullQuiz = await loadFullQuizData(exam);
        openAIAgentWithAttachment(
          buildPlatformQuizAttachment(exam, {
            meta: fullQuiz.meta || { title: exam.title || exam.id },
            stats: fullQuiz.stats || {},
            questions: fullQuiz.questions || [],
          }),
          { defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT },
        );
      } catch (err) {
        showNotification("تعذر الإرفاق", "تعذر تحميل محتوى الامتحان حاليًا.", "error");
      } finally {
        askAiOpt.disabled = false;
      }
    };
    menu.appendChild(askAiOpt);

    // ── Admin manage group — تعديل / نقل / تغيير العنوان / حذف (→ trash) ────
    // Visible for database quizzes whose admin passes the generalized 3-tier
    // canManageItem() gate (owner → creator match → scope match). Grouped
    // below the public actions with a divider, collapsed into a single
    // "إدارة" submenu-trigger row (rather than 4 separate top-level rows)
    // so the outer ⋮ menu doesn't grow tall — see
    // docs/plans/Admin actions and deletion flow for quizzes.md §5.
    if (canManageItem(exam)) {
      const divider = document.createElement("div");
      divider.className = "exam-action-divider";
      menu.appendChild(divider);

      const adminSubmenu = createActionGroupSubmenu(
        [
          {
            // تغيير العنوان — quizzes/folders/courses.
            label: "تغيير العنوان",
            icon: RENAME_ICON_SVG,
            onClick: () => renameSharedItem(exam),
          },
          {
            label: "الوصف والمصدر",
            icon: EDIT_ICON_SVG,
            onClick: () => editSharedItemMetadata(exam),
          },
          {
            // تعديل — quizzes only: deep-link into create-quiz edit mode
            // (the create-quiz page pre-fills from ?id=<dbId>&mode=edit,
            // step 9).
            label: "تعديل الامتحان",
            icon: EDIT_ICON_SVG,
            onClick: () => {
              if (!exam.dbId) return;
              window.location.href = `/create-quiz?id=${encodeURIComponent(exam.dbId)}&mode=edit`;
            },
          },
          {
            // نقل — shared Move-Source dialog over the DB courses+folders
            // tree.
            label: "نقل",
            icon: MOVE_TO_ICON_SVG,
            onClick: () => openSharedMoveToDialog(exam),
          },
          {
            // حذف — soft delete (to the shared trash, fully restorable
            // until purged). deleteSharedItem() owns the confirmation
            // phrasing ("سيُنقل … إلى سلة المهملات") and the view
            // refresh.
            label: "حذف الامتحان",
            icon: TRASH_ICON_SVG,
            danger: true,
            onClick: () => deleteSharedItem(exam),
          },
        ],
        closeMenu,
        reposition,
      );
      menu.appendChild(adminSubmenu);
    }

    // ── "معلومات الامتحان" submenu ───────────────────────────────────────
    // Basic preview built synchronously from the manifest entry. Shows only
    // id, description, category, date, and source (المصدر is
    // copy-to-clipboard). "كل المعلومات" opens the full quiz-info-modal-card
    // via showQuizInfoModal, which does the async backfill fetch for
    // anything still missing.
    // Most useful at a glance: size, popularity, where it lives, when, who.
    // (ID / description / source stay in "كل المعلومات".)
    const basicRows = [
      { label: "الأسئلة", val: typeof exam.questionCount === "number" ? exam.questionCount : null },
      ...(exam.dbId ? [{
        label: "المحاولات", val: "…",
        loadVal: () => fetchQuizDetails(exam.dbId).then((d) => (typeof d?.attempt_count === "number" ? d.attempt_count : null)),
      }] : []),
      { label: "المادة", val: exam.category || null, multiline: true },
      { label: "التاريخ", val: formatDateForInfo(exam.createdAt), ltr: true },
      ...(exam.dbId ? [{
        label: "إعداد", val: "…",
        loadVal: () => fetchQuizDetails(exam.dbId).then((d) => fetchCreatorName(d?.uploaded_by)),
      }] : []),
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

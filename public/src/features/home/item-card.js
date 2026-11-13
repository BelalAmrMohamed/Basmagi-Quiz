// Item cards (quiz / lesson / notebook) for the platform and «محتواي»:
// one factory, `createItemCard`, plus thin per-type builders and ⋮ menus.
import { startQuiz } from "./quiz-navigation.js";
import { isRecentlyAdded } from "./date-utils.js";
import { formatArabicQuestionCount, refreshUserQuizzesCard } from "./course-count.js";
import { qz, formatQuestionTypesForDownload } from "./quiz-schema.js";
import { ensureDownloadAllowed } from "./download-password.js";
import { showDownloadModal, withDownloadLoading } from "../../components/download-quiz-modal/download-quiz-modal.js";
import { loadFullQuizData } from "./quiz-data-loader.js";
import { copyQuizToUserQuizzes, copyLessonToUserQuizzes, copyNotebookToUserQuizzes, withCopyButtonLoadingState } from "./copy-to-my-quizzes.js";
import { canManageItem, openSharedMoveToDialog, renameSharedItem, editSharedItemMetadata, deleteSharedItem } from "./admin-item-actions.js";
import { showQuizInfoModal } from "./quiz-info-modal.js";
import { showUserLessonInfoModal, collectLessonInfo } from "./lesson-info-modal.js";
import { EMBED_ICON_SVG, copyEmbedCode } from "./embed-code.js";
import { fetchQuizDetails, fetchCreatorName, fetchLessonViewCount } from "./info-details.js";
import { formatDateForInfo } from "../../components/quiz-info-modal/quiz-info-html.js";
import { createExamInfoSubmenu, createActionGroupSubmenu, openItemDropdownMenu } from "./item-dropdown-menu.js";
import {
  LOCK_ICON_SVG, DOWNLOAD_ICON_SVG, COPY_ICON_SVG, DUPLICATE_ICON_SVG, SHARE_ICON_SVG, MORE_DOTS_ICON_SVG,
  TRASH_ICON_SVG, RENAME_ICON_SVG, MOVE_TO_ICON_SVG, EDIT_ICON_SVG, SPARKLE_ICON_SVG,
} from "./icons.js";
import { showNotification } from "../../components/notifications/notifications.js";
import {
  openAIAgentWithAttachment, buildPlatformQuizAttachment, buildPlatformLessonAttachment,
} from "../../components/ai-agent/ai-agent-attach-launcher.js";
import { HOME_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { RUNTIME_CONFIG } from "../../shared/runtime-config.js";
import { downloadLesson } from "./lesson-download.js";
import { withDownloadLoading as withExportLoading } from "../../components/download-quiz-modal/export-card.js";
import { appendNotebookMenuEntries, fetchPlatformNotebookRow, showNotebookDownloadModal } from "./notebook-actions.js";
import { getSelectedUserQuizzes } from "./app-state.js";
import { updateBulkActionBar } from "./user-quizzes-view.js";
import {
  createUserQuizActions, createUserLessonActions, createUserNotebookActions,
} from "./user-quiz-card.js";

const KINDS = {
  quiz: { label: "امتحان", emoji: "📝", tip: "📝 امتحان", descTip: "📄 وصف الامتحان" },
  lesson: { label: "درس", emoji: "📘", tip: "📘 درس تفاعلي", descTip: "📄 وصف الدرس" },
  notebook: { label: "دفتر", emoji: "💻", tip: "💻 دفتر تفاعلي", descTip: "📄 وصف الدفتر" },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Builds one item card.
 * @param {object} o
 * @param {"quiz"|"lesson"|"notebook"} o.kind
 * @param {string} o.title @param {string} [o.description] @param {string} [o.chipDetail]
 * @param {boolean} [o.isNew]
 * @param {Array<{text:string, tag?:boolean}>} [o.meta]
 * @param {{label:string, onClick:()=>void}} o.primary
 * @param {{label?:string, locked?:boolean, onClick:(btn:HTMLElement)=>void}} o.download
 * @param {(btn:HTMLElement)=>void} o.onMore
 * @param {string} [o.selectId] set for «محتواي» cards: adds the selection checkbox
 */
export function createItemCard(o) {
  const k = KINDS[o.kind];
  const card = el("div", "item-card");
  card.dataset.cardKind = o.kind;
  card.setAttribute("role", "article");
  card.setAttribute("aria-label", `${k.label}: ${o.title}`);

  card.append(el("span", "shape"));
  card.firstChild.setAttribute("aria-hidden", "true");
  if (o.kind === "notebook") {
    const gut = el("div", "gut");
    gut.dir = "ltr";
    gut.setAttribute("aria-hidden", "true");
    gut.innerHTML = '<span>In [ ]:</span><span class="kdot"></span>';
    card.append(gut);
  }

  if (o.selectId) {
    const checkbox = el("input", "user-quiz-select-checkbox");
    checkbox.type = "checkbox";
    checkbox.dataset.quizId = o.selectId;
    const selected = getSelectedUserQuizzes();
    checkbox.checked = selected.has(o.selectId);
    checkbox.onclick = (e) => {
      e.stopPropagation();
      if (checkbox.checked) selected.add(o.selectId);
      else selected.delete(o.selectId);
      updateBulkActionBar();
    };
    card.append(checkbox);
    card.addEventListener("click", (e) => {
      if (e.target === checkbox) return;
      if (document.querySelector(".user-quizzes-container")?.classList.contains("selection-mode-active")) {
        e.stopPropagation();
        checkbox.click();
      }
    });
  }

  if (o.isNew) {
    const badge = el("span", "new-badge", "جديد");
    badge.setAttribute("aria-label", "مضاف حديثاً");
    card.append(badge);
  }

  const body = el("div", "ic-body");
  body.append(el("span", `item-type-chip`, `${k.emoji} ${k.label}${o.chipDetail ? ` · ${o.chipDetail}` : ""}`));
  body.firstChild.setAttribute("aria-hidden", "true");
  const h = el("h3", null, o.title);
  h.dataset.tooltipBadge = k.tip;
  h.dataset.tooltipText = o.title;
  body.append(h);
  const description = String(o.description || "").trim();
  if (description) {
    const p = el("p", "ic-desc", description);
    p.dataset.tooltipBadge = k.descTip;
    p.dataset.tooltipText = description;
    body.append(p);
  }
  const meta = (o.meta || []).filter((m) => m.text);
  if (meta.length) {
    const row = el("div", "ic-meta");
    meta.forEach((m) => row.append(el("span", m.tag ? "ic-tag" : null, m.text)));
    body.append(row);
  }
  card.append(body);

  const actions = el("div", "ic-actions");
  const more = el("button", "exam-more-btn");
  more.type = "button";
  more.innerHTML = MORE_DOTS_ICON_SVG;
  more.setAttribute("aria-label", `خيارات إضافية لـ ${o.title}`);
  more.onclick = (e) => { e.stopPropagation(); o.onMore(more, e); };

  const primary = el("button", "ic-btn ic-btn--primary", o.primary.label);
  primary.type = "button";
  primary.setAttribute("aria-label", `${o.primary.label} ${o.title}`);
  primary.onclick = (e) => { e.stopPropagation(); o.primary.onClick(); };

  const dl = el("button", "ic-btn ic-btn--ghost" + (o.download.locked ? " is-password-protected" : ""));
  dl.type = "button";
  dl.innerHTML = `${o.download.locked ? LOCK_ICON_SVG : DOWNLOAD_ICON_SVG}<span>تحميل</span>`;
  dl.setAttribute("aria-label", `تحميل ${o.title}${o.download.locked ? " (محمي بكلمة مرور)" : ""}`);
  if (o.download.locked) dl.title = "محمي بكلمة مرور";
  dl.onclick = (e) => { e.stopPropagation(); o.download.onClick(dl); };

  actions.append(dl, primary);
  card.append(more, actions);
  return card;
}

/**
 * Builds a folder card (manila tab). Activation (click / Enter / Space) calls
 * `onOpen`; while «محتواي» is in selection mode a click toggles the checkbox.
 * @param {{title:string, subtext:string, isNew?:boolean, selectId?:string,
 *   onOpen:()=>void, onMore?:(btn:HTMLElement, e:Event)=>void}} o
 */
export function createFolderCard(o) {
  const card = el("div", "item-card");
  card.dataset.cardKind = "folder";
  card.setAttribute("role", "button");
  card.tabIndex = 0;
  card.setAttribute("aria-label", `${o.title}, ${o.subtext}`);
  const shape = el("span", "shape");
  shape.setAttribute("aria-hidden", "true");
  card.append(shape);

  let checkbox = null;
  if (o.selectId) {
    checkbox = el("input", "user-quiz-select-checkbox");
    checkbox.type = "checkbox";
    checkbox.dataset.quizId = o.selectId;
    checkbox.setAttribute("aria-label", "تحديد");
    const selected = getSelectedUserQuizzes();
    checkbox.checked = selected.has(o.selectId);
    checkbox.onclick = (e) => {
      e.stopPropagation();
      if (checkbox.checked) selected.add(o.selectId);
      else selected.delete(o.selectId);
      updateBulkActionBar();
    };
    card.append(checkbox);
  }

  if (o.isNew) {
    const badge = el("span", "new-badge", "جديد");
    badge.setAttribute("aria-label", "مضاف حديثاً");
    card.append(badge);
  }

  const body = el("div", "ic-body");
  const chip = el("span", "item-type-chip", "📁 مجلد");
  chip.setAttribute("aria-hidden", "true");
  const h = el("h3", null, o.title);
  h.dataset.tooltipText = o.title;
  h.dataset.tooltipClampedOnly = "true";
  body.append(chip, h, el("div", "ic-meta", null));
  body.lastChild.append(el("span", null, o.subtext));
  card.append(body);

  if (o.onMore) {
    const more = el("button", "exam-more-btn");
    more.type = "button";
    more.innerHTML = MORE_DOTS_ICON_SVG;
    more.setAttribute("aria-label", `خيارات ${o.title}`);
    more.onclick = (e) => { e.stopPropagation(); o.onMore(more, e); };
    card.append(more);
  }

  card.addEventListener("click", (e) => {
    if (checkbox && document.querySelector(".user-quizzes-container")?.classList.contains("selection-mode-active")) {
      e.stopPropagation();
      checkbox.click();
      return;
    }
    o.onOpen?.();
  });
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
    }
  });
  return card;
}

const TYPE_CHIPS = (types) => (types || []).map((t) => ({ text: t, tag: true }));

function runtimeLabel(runtime) {
  return RUNTIME_CONFIG[runtime]?.label || runtime || "";
}

export function notebookPath(notebook) {
  return `/notebook/${encodeURIComponent(notebook.slug || notebook.id)}`;
}

// ── Platform cards ──────────────────────────────────────────────────────────

export function createExamCard(exam) {
  const title = exam.title || exam.id;
  return createItemCard({
    kind: "quiz",
    title,
    description: exam.description,
    isNew: isRecentlyAdded(exam.createdAt),
    meta: [
      { text: exam.questionCount > 0 ? formatArabicQuestionCount(exam.questionCount) : "" },
      ...TYPE_CHIPS(exam.questionTypes),
    ],
    primary: { label: "ابدأ", onClick: () => startQuiz(exam.id) },
    download: {
      locked: !!exam.password,
      onClick: (btn) => withDownloadLoading(btn, () => showExamDownloadPopup(exam)),
    },
    onMore: (btn) => showExamActionsOverlay(exam, () => showExamDownloadPopup(exam), btn),
  });
}

export function createLessonCard(lesson) {
  const sections = Number(lesson.sectionIds?.length ?? lesson.sectionCount ?? 0);
  const questions = Number(lesson.questionCount ?? lesson.stats?.questionCount ?? 0);
  return createItemCard({
    kind: "lesson",
    title: lesson.title || "درس بدون عنوان",
    description: lesson.description,
    meta: [
      { text: sections === 1 ? "قسم واحد" : `الأقسام: ${sections}` },
      { text: questions > 0 ? `الأسئلة المدمجة: ${questions}` : "" },
      { text: lesson.passwordProtected ? "محمي" : "" },
    ],
    primary: { label: "ابدأ القراءة", onClick: () => { window.location.href = `/lesson/${encodeURIComponent(lesson.slug || lesson.id)}`; } },
    download: { onClick: (btn) => withExportLoading(btn, () => downloadLesson(lesson, btn)) },
    onMore: (btn) => openLessonActionsMenu(lesson, btn),
  });
}

export function createNotebookCard(notebook) {
  const runtime = runtimeLabel(notebook.runtime);
  return createItemCard({
    kind: "notebook",
    title: notebook.title || "دفتر بدون عنوان",
    description: notebook.description,
    chipDetail: runtime,
    meta: [{ text: `الخلايا: ${Number(notebook.cellCount) || 0}` }],
    primary: { label: "افتح الدفتر", onClick: () => { window.location.href = notebookPath(notebook); } },
    download: {
      onClick: (btn) => withExportLoading(btn, async () => {
        try {
          showNotebookDownloadModal(await fetchPlatformNotebookRow(notebook), btn);
        } catch {
          showNotification("تعذّر تحميل الدفتر", "تحقق من اتصالك ثم حاول مرة أخرى.", "error");
        }
      }),
    },
    onMore: (btn) => openNotebookActionsMenu(notebook, btn),
  });
}

// ── «محتواي» cards ──────────────────────────────────────────────────────────

export function createUserQuizCard(quiz) {
  const id = qz(quiz, "id") || quiz.id;
  const title = qz(quiz, "title") || id;
  const typeStr = qz(quiz, "type");
  const a = createUserQuizActions(quiz);
  return createItemCard({
    kind: "quiz",
    selectId: id,
    title,
    description: qz(quiz, "description"),
    meta: [{ text: formatArabicQuestionCount(qz(quiz, "count")) }, ...TYPE_CHIPS(typeStr ? typeStr.split(" · ") : [])],
    primary: { label: "ابدأ", onClick: a.open },
    download: { locked: !!qz(quiz, "password"), onClick: a.download },
    onMore: a.more,
  });
}

export function createUserLessonCard(lesson) {
  const sections = lesson.stats?.sectionCount ?? lesson.lesson?.sections?.length ?? 0;
  const questions = lesson.stats?.questionCount ?? collectLessonInfo(lesson).questionCount;
  const a = createUserLessonActions(lesson);
  return createItemCard({
    kind: "lesson",
    selectId: lesson.id || lesson.meta?.id,
    title: lesson.meta?.title || "درس بدون عنوان",
    description: lesson.meta?.description || lesson.description,
    meta: [
      { text: `${sections} ${sections === 1 ? "قسم" : "أقسام"}` },
      { text: questions > 0 ? `الأسئلة المدمجة: ${questions}` : "" },
    ],
    primary: { label: "ابدأ القراءة", onClick: a.open },
    download: { onClick: a.download },
    onMore: a.more,
  });
}

export function createUserNotebookCard(nb) {
  const runtime = runtimeLabel(nb.notebook?.runtime || "matlab");
  const a = createUserNotebookActions(nb);
  return createItemCard({
    kind: "notebook",
    selectId: nb.id || nb.meta?.id,
    title: nb.meta?.title || "دفتر بدون عنوان",
    description: nb.meta?.description,
    chipDetail: runtime,
    meta: [{ text: `الخلايا: ${nb.stats?.cellCount ?? nb.notebook?.content?.cells?.length ?? 0}` }],
    primary: { label: "افتح الدفتر", onClick: a.open },
    download: { onClick: a.download },
    onMore: a.more,
  });
}

// ── Platform menus ──────────────────────────────────────────────────────────

function buildExamShareUrl(examId) {
  return window.location.origin + "/quiz/" + encodeURIComponent(examId);
}

  const showExamDownloadPopup = async (exam) => {
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

    // Built from the manifest summary; the full quiz file loads lazily on format pick.
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
      view: null,
      mode: null,
      questionTypes: exam.questionTypes || null,
      questionCount: exam.questionCount || null,
    };

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


function lessonUrl(lesson) {
  return `${window.location.origin}/lesson/${encodeURIComponent(lesson.slug || lesson.id)}`;
}

async function askAboutLesson(lesson) {
  let attachment = buildPlatformLessonAttachment(lesson);
  if (!lesson.passwordProtected) {
    try {
      const supabase = await ensureSharedSupabaseClient();
      if (!supabase) throw new Error("تعذّر الاتصال بقاعدة البيانات.");
      let query = supabase.from("lesson_public").select("content");
      query = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(lesson.id || ""))
        ? query.eq("id", lesson.id)
        : query.eq("slug", lesson.slug || lesson.id);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (data?.content) attachment = buildPlatformLessonAttachment({ ...lesson, content: data.content });
    } catch (error) {
      console.warn("[lesson-card] Could not load lesson content for AI attachment:", error);
      showNotification("إرفاق معلومات الدرس", "سيفتح المساعد مع بيانات الدرس المتاحة فقط.", "warning");
    }
  }
  openAIAgentWithAttachment(attachment, { defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT });
}

function addMenuAction(menu, closeMenu, { label, icon, onClick, danger = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `exam-action-btn${danger ? " exam-action-btn--danger" : ""}`;
  button.innerHTML = `${icon}<span>${label}</span>`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMenu();
    onClick();
  });
  menu.appendChild(button);
  return button;
}


function openLessonActionsMenu(lesson, trigger) {
  openItemDropdownMenu(trigger, (menu, closeMenu, reposition) => {
    addMenuAction(menu, closeMenu, {
      label: "نسخ إلى محتواي", icon: DUPLICATE_ICON_SVG,
      onClick: () => { void copyLessonToUserQuizzes(lesson); },
    });
    addMenuAction(menu, closeMenu, {
      label: "نسخ الرابط", icon: COPY_ICON_SVG,
      onClick: () => navigator.clipboard.writeText(lessonUrl(lesson))
        .then(() => showNotification("تم النسخ", "تم نسخ رابط الدرس.", "success")),
    });
    addMenuAction(menu, closeMenu, {
      label: "نسخ كود التضمين", icon: EMBED_ICON_SVG,
      onClick: () => { void copyEmbedCode("lesson", lesson.slug || lesson.id, lesson.title); },
    });
    addMenuAction(menu, closeMenu, {
      label: "مشاركة الرابط", icon: SHARE_ICON_SVG,
      onClick: () => {
        const url = lessonUrl(lesson);
        if (navigator.share) void navigator.share({ title: lesson.title || "درس", url }).catch(() => { });
        else void navigator.clipboard.writeText(url).then(() => showNotification("تم النسخ", "تم نسخ رابط الدرس.", "success"));
      },
    });
    addMenuAction(menu, closeMenu, {
      label: "اسأل الباشــمبصمج", icon: SPARKLE_ICON_SVG,
      onClick: () => { void askAboutLesson(lesson); },
    });

    const info = collectLessonInfo(lesson);
    const basicRows = [
      { label: "الأقسام", val: info.sectionCount || null },
      { label: "المشاهدات", val: "…", loadVal: () => fetchLessonViewCount(lesson.id) },
      { label: "التاريخ", val: formatDateForInfo(info.createdAt), ltr: true },
      ...(lesson.createdBy || lesson.created_by
        ? [{ label: "إعداد", val: "…", loadVal: () => fetchCreatorName(lesson.createdBy || lesson.created_by) }]
        : []),
    ].filter((row) => row.val);
    menu.appendChild(createExamInfoSubmenu(
      basicRows,
      () => showUserLessonInfoModal(lesson),
      closeMenu,
      reposition,
      "معلومات الدرس",
    ));

    if (canManageItem({ ...lesson, itemType: "lesson" })) {
      const adminMenu = createActionGroupSubmenu([
        { label: "تغيير العنوان", icon: RENAME_ICON_SVG, onClick: () => renameSharedItem({ ...lesson, itemType: "lesson" }) },
        {
          label: "الوصف والمصدر", icon: EDIT_ICON_SVG,
          onClick: () => editSharedItemMetadata({ ...lesson, itemType: "lesson" }),
        },
        {
          label: "تعديل الدرس", icon: EDIT_ICON_SVG,
          onClick: () => { window.location.href = `/create-lesson?edit=${encodeURIComponent(lesson.id)}`; },
        },
        { label: "نقل", icon: MOVE_TO_ICON_SVG, onClick: () => openSharedMoveToDialog({ ...lesson, itemType: "lesson" }) },
        { label: "حذف الدرس", icon: TRASH_ICON_SVG, danger: true, onClick: () => deleteSharedItem({ ...lesson, itemType: "lesson" }) },
      ], closeMenu, reposition);
      menu.appendChild(adminMenu);
    }

  });
}


function openNotebookActionsMenu(notebook, trigger) {
  const url = `${window.location.origin}${notebookPath(notebook)}`;
  const item = { ...notebook, itemType: "notebook" };
  openItemDropdownMenu(trigger, (menu, closeMenu, reposition) => {
    // The ⋮ menu is re-ordered centrally, so the order of these calls doesn't matter.
    const copyMine = document.createElement("button");
    copyMine.type = "button";
    copyMine.className = "exam-action-btn";
    copyMine.innerHTML = `${DUPLICATE_ICON_SVG}<span>نسخ إلى محتواي</span>`;
    copyMine.addEventListener("click", async (event) => {
      event.stopPropagation();
      await withCopyButtonLoadingState(copyMine, () => copyNotebookToUserQuizzes(notebook));
      closeMenu();
    });
    menu.appendChild(copyMine);

    addMenuAction(menu, closeMenu, {
      label: "نسخ الرابط", icon: COPY_ICON_SVG,
      onClick: () => navigator.clipboard.writeText(url).then(() => showNotification("تم النسخ", "تم نسخ رابط الدفتر.", "success")),
    });
    addMenuAction(menu, closeMenu, {
      label: "مشاركة الرابط", icon: SHARE_ICON_SVG,
      onClick: () => {
        if (navigator.share) void navigator.share({ title: notebook.title || "دفتر", url }).catch(() => { });
        else void navigator.clipboard.writeText(url).then(() => showNotification("تم النسخ", "تم نسخ رابط الدفتر.", "success"));
      },
    });
    addMenuAction(menu, closeMenu, {
      label: "نسخ كود التضمين", icon: EMBED_ICON_SVG,
      onClick: () => { void copyEmbedCode("notebook", notebook.slug || notebook.id, notebook.title); },
    });
    appendNotebookMenuEntries(menu, closeMenu, reposition, notebook, { platform: true });
    if (canManageItem(item)) {
      menu.appendChild(createActionGroupSubmenu([
        { label: "تغيير العنوان", icon: RENAME_ICON_SVG, onClick: () => renameSharedItem(item) },
        { label: "الوصف والمصدر", icon: EDIT_ICON_SVG, onClick: () => editSharedItemMetadata(item) },
        { label: "تعديل الدفتر", icon: EDIT_ICON_SVG, onClick: () => { window.location.href = `/notebook/edit/${encodeURIComponent(notebook.id)}`; } },
        { label: "نقل", icon: MOVE_TO_ICON_SVG, onClick: () => openSharedMoveToDialog(item) },
        { label: "حذف الدفتر", icon: TRASH_ICON_SVG, danger: true, onClick: () => deleteSharedItem(item) },
      ], closeMenu, reposition));
    }
  });
}


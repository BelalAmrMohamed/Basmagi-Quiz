// Platform lesson card and its shared actions menu.
import { downloadLesson } from "./lesson-download.js";
import { openExamDropdownMenu, createActionGroupSubmenu, createExamInfoSubmenu } from "./exam-dropdown-menu.js";
import { showUserLessonInfoModal, collectLessonInfo } from "./lesson-info-modal.js";
import { formatDateForInfo } from "../../components/quiz-info-modal/quiz-info-html.js";
import { canManageItem, openSharedMoveToDialog, renameSharedItem, editSharedItemMetadata, deleteSharedItem } from "./admin-item-actions.js";
import { openAIAgentWithAttachment, buildPlatformLessonAttachment } from "../../components/ai-agent/ai-agent-attach-launcher.js";
import { HOME_PAGE_SYSTEM_PROMPT } from "../../components/ai-agent/ai-agent-default-prompts.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { copyLessonToUserQuizzes } from "./copy-to-my-quizzes.js";
import {
  DOWNLOAD_ICON_SVG, MORE_DOTS_ICON_SVG, COPY_ICON_SVG, SHARE_ICON_SVG, DUPLICATE_ICON_SVG,
  SPARKLE_ICON_SVG, EDIT_ICON_SVG, MOVE_TO_ICON_SVG,
  RENAME_ICON_SVG, TRASH_ICON_SVG,
} from "./icons.js";

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

export function createLessonCard(lesson) {
  const card = document.createElement("div");
  card.className = "card exam-card lesson-card";
  card.setAttribute("role", "article");
  card.setAttribute("aria-label", `درس: ${lesson.title || lesson.id}`);

  const icon = document.createElement("span");
  icon.className = "phone-only-emoji";
  icon.textContent = "📘";
  icon.setAttribute("aria-hidden", "true");

  const text = document.createElement("div");
  text.className = "card-text";
  const heading = document.createElement("h3");
  heading.textContent = lesson.title || "درس بدون عنوان";
  text.appendChild(heading);
  const description = String(lesson.description || "").trim();
  if (description) {
    const desc = document.createElement("p");
    desc.className = "lesson-card-description";
    desc.textContent = description;
    text.appendChild(desc);
  }
  const sectionCount = Number(lesson.sectionIds?.length ?? lesson.sectionCount ?? 0);
  const meta = document.createElement("p");
  meta.className = "exam-question-count";
  meta.textContent = [sectionCount === 1 ? "قسم واحد" : `${sectionCount} أقسام`, lesson.passwordProtected ? "محمي" : ""]
    .filter(Boolean).join(" · ");
  text.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "exam-card-actions-wrap";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "exam-more-btn";
  more.innerHTML = MORE_DOTS_ICON_SVG;
  more.setAttribute("aria-label", `خيارات إضافية لـ ${lesson.title || "الدرس"}`);
  more.title = "خيارات الدرس";
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    openLessonActionsMenu(lesson, more);
  });

  const start = document.createElement("button");
  start.type = "button";
  start.className = "start-btn";
  start.style.flex = "1";
  start.style.minWidth = "0";
  start.textContent = "ابدأ القراءة";
  start.setAttribute("aria-label", `ابدأ قراءة ${lesson.title || "الدرس"}`);
  start.addEventListener("click", (event) => {
    event.stopPropagation();
    window.location.href = `/lesson/${encodeURIComponent(lesson.slug || lesson.id)}`;
  });

  const download = document.createElement("button");
  download.type = "button";
  download.className = "start-btn desktop-download-btn";
  download.style.flex = "1";
  download.style.minWidth = "0";
  download.style.background = "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)";
  download.style.color = "white";
  download.style.boxShadow = "0 4px 14px rgba(37, 99, 235, 0.35)";
  download.innerHTML = `${DOWNLOAD_ICON_SVG}<span>تحميل</span>`;
  download.setAttribute("aria-label", `تحميل ${lesson.title || "الدرس"}`);
  download.addEventListener("click", (event) => {
    event.stopPropagation();
    void downloadLesson(lesson, download);
  });

  actions.append(more, start, download);
  card.append(icon, text, actions);
  return card;
}

function openLessonActionsMenu(lesson, trigger) {
  openExamDropdownMenu(trigger, (menu, closeMenu, reposition) => {
    addMenuAction(menu, closeMenu, {
      label: "نسخ لامتحاناتي", icon: DUPLICATE_ICON_SVG,
      onClick: () => { void copyLessonToUserQuizzes(lesson); },
    });
    addMenuAction(menu, closeMenu, {
      label: "نسخ الرابط", icon: COPY_ICON_SVG,
      onClick: () => navigator.clipboard.writeText(lessonUrl(lesson))
        .then(() => showNotification("تم النسخ", "تم نسخ رابط الدرس.", "success")),
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
      { label: "ID", val: info.id, multiline: true, copyable: true, ltr: true },
      { label: "الأقسام", val: info.sectionCount || null },
      { label: "التاريخ", val: formatDateForInfo(info.createdAt), ltr: true },
      { label: "المصدر", val: lesson.source || null, multiline: true, copyable: true },
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
        {
          label: "تعديل التفاصيل", icon: EDIT_ICON_SVG,
          onClick: () => editSharedItemMetadata({ ...lesson, itemType: "lesson" }),
        },
        {
          label: "تعديل", icon: EDIT_ICON_SVG,
          onClick: () => { window.location.href = `/create-lesson?edit=${encodeURIComponent(lesson.id)}`; },
        },
        { label: "نقل", icon: MOVE_TO_ICON_SVG, onClick: () => openSharedMoveToDialog({ ...lesson, itemType: "lesson" }) },
        { label: "إعادة تسمية", icon: RENAME_ICON_SVG, onClick: () => renameSharedItem({ ...lesson, itemType: "lesson" }) },
        { label: "حذف الدرس", icon: TRASH_ICON_SVG, danger: true, onClick: () => deleteSharedItem({ ...lesson, itemType: "lesson" }) },
      ], closeMenu, reposition);
      menu.appendChild(adminMenu);
    }

  });
}

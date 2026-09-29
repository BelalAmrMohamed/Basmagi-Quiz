// ============================================================================
// LESSON DOWNLOAD — shared export handler for workspace and public lessons.
// ============================================================================

import { showNotification } from "../../components/notifications/notifications.js";
import { isLessonProtected, requestLessonPassword, verifyLocalLessonPassword, unlockRemoteLesson } from "../lesson/lesson-access.js";

function localRowFromLesson(lesson) {
  if (lesson?.lesson) return lesson;
  try {
    const rows = JSON.parse(localStorage.getItem("user_quizzes") || "[]");
    return Array.isArray(rows) ? rows.find((row) => (row.id || row.meta?.id) === lesson?.id) || lesson : lesson;
  } catch {
    return lesson;
  }
}

export async function downloadLesson(lesson, triggerBtn = null) {
  if (!lesson) return;
  const originalMarkup = triggerBtn?.innerHTML || "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.setAttribute("aria-busy", "true");
  }
  try {
    let payload = {
      id: lesson.id || lesson.dbId || "",
      title: lesson.title || "درس بدون عنوان",
      description: lesson.description || "",
      reader_prefs_default: lesson.reader_prefs_default || lesson.readerPrefsDefault || {},
      content: lesson.content || lesson.lesson || { sections: [] },
    };

    if (isLessonProtected(lesson)) {
      const isLocal = Boolean(lesson.lesson || lesson.meta?.type === "lesson" || /^user_lesson_/i.test(String(lesson.id || "")));
      if (isLocal) {
        const row = localRowFromLesson(lesson);
        const password = await requestLessonPassword({
          title: lesson.title || "هذا الدرس",
          verify: (candidate) => verifyLocalLessonPassword(row, candidate),
          submitLabel: "تنزيل",
        });
        if (!password) return;
      } else {
        let unlocked = null;
        const password = await requestLessonPassword({
          title: lesson.title || "هذا الدرس",
          verify: async (candidate) => {
            unlocked = await unlockRemoteLesson(lesson.id || lesson.slug, candidate);
            return Boolean(unlocked);
          },
          submitLabel: "تنزيل",
        });
        if (!password || !unlocked) return;
        payload = {
          id: unlocked.id || payload.id,
          title: unlocked.title || payload.title,
          description: unlocked.description || payload.description,
          reader_prefs_default: unlocked.reader_prefs_default || payload.reader_prefs_default,
          content: unlocked.content || { sections: [] },
        };
      }
    }

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeFilename(payload.title || "lesson")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showNotification("تم التنزيل", "تم تصدير الدرس كملف JSON.", "success");
  } catch (error) {
    console.error("[lesson-download] export failed:", error);
    showNotification("تعذّر التنزيل", error?.message || "تعذّر تصدير الدرس.", "error");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.removeAttribute("aria-busy");
      triggerBtn.innerHTML = originalMarkup || "تنزيل";
    }
  }
}

function sanitizeFilename(name) {
  return String(name || "lesson")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "lesson";
}

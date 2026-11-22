// PHASE 3 icons for the attachment tiles — a generic file glyph (used for
// any file attachment that isn't an image; images get a real thumbnail
// instead, built in buildAttachmentTile below) and one glyph per
// platform-item kind, reusing the same shapes the rest of the app already
// uses for quizzes/courses/folders (see user-content-card.js/
// user-content-folders.js's 📝/📚/📁-style conventions) so a tile reads
// as "the same kind of thing" wherever it shows up, not a new icon set
// invented just for this popover.
export const ATTACHMENT_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/></svg>';
export const ATTACHMENT_QUIZ_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
export const ATTACHMENT_COURSE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
export const ATTACHMENT_FOLDER_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
export const ATTACHMENT_LESSON_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>';
export const ATTACHMENT_NOTEBOOK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';
export const ATTACHMENT_YOUTUBE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/></svg>';
export const ATTACHMENT_REMOVE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

/**
 * PHASE 2b (adapted, see toWireMessage's own comment on why this runs
 * client-side rather than server-side): turns one platform-item
 * attachment into a labeled block of context text the model can reason
 * about. Relies on `att.summary` — a plain-text blurb the launcher
 * (ai-agent-attach-launcher.js) already built from the quiz/course/
 * folder data it had on hand at attach time (this module deliberately
 * doesn't import quiz-schema/storage helpers itself, to stay a
 * self-contained "takes everything via options/attachments" component
 * per its own header comment) — falls back to just the title if no
 * summary was supplied (e.g. a server-hosted course whose quiz list
 * isn't loaded client-side at attach time).
 * @param {{kind: "quiz"|"lesson"|"course"|"folder", itemType?: string, title: string, summary?: string}} att
 */
export function expandPlatformAttachment(att) {
  const kindLabelAr = att.itemType === "notebook"
    ? "دفتر"
    : att.itemType === "youtube_playlist"
      ? "قائمة تشغيل يوتيوب"
      : att.itemType === "youtube_video"
        ? "فيديو يوتيوب"
        : { quiz: "امتحان", lesson: "درس", course: "مادة", folder: "مجلد" }[att.kind] || att.kind;
  const body = att.payload
    ? JSON.stringify(att.payload)
    : att.summary || "(لا تفاصيل إضافية متاحة عن هذا العنصر)";
  const hint = att.itemType === "youtube_video" && att.payload?.youtubeId
    ? `\n(للإجابة عن محتوى الفيديو الفعلي استدعِ الأداة summarize_youtube مع video="${att.payload.youtubeId}"؛ الوصف أعلاه لا يغني عن نص الفيديو.)`
    : "";
  return `[مرفق ${kindLabelAr}: ${att.title}]\n${body}${hint}`;
}

export function iconForAttachment(att) {
  // Also catches chats saved before the dedicated kind existed (kind "lesson" + itemType youtube_*).
  if (att.kind === "youtube" || String(att.itemType || "").startsWith("youtube_")) return ATTACHMENT_YOUTUBE_ICON_SVG;
  if (att.kind === "quiz") return ATTACHMENT_QUIZ_ICON_SVG;
  if (att.itemType === "notebook") return ATTACHMENT_NOTEBOOK_ICON_SVG;
  if (att.kind === "lesson") return ATTACHMENT_LESSON_ICON_SVG;
  if (att.kind === "course") return ATTACHMENT_COURSE_ICON_SVG;
  if (att.kind === "folder") return ATTACHMENT_FOLDER_ICON_SVG;
  return ATTACHMENT_FILE_ICON_SVG;
}

export function labelForAttachment(att) {
  return att.kind === "file" ? att.name : att.title;
}

// The preview badge looks up `itemType` first, so youtube_video / youtube_playlist win over the generic kind.
export const ATTACHMENT_KIND_LABEL_AR = {
  quiz: "امتحان", lesson: "درس", notebook: "دفتر", course: "مادة", folder: "مجلد", file: "ملف",
  youtube: "فيديو", youtube_video: "فيديو", youtube_playlist: "قائمة تشغيل",
};


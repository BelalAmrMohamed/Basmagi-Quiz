// Pure text helper for the admin upload modal: «3 امتحان و2 درس و1 دفتر».
// Only non-zero parts are listed, so a notebook-only upload no longer reads
// "0 امتحان و0 درس". `youtube` is the server's single "uploaded" total;
// `videos` / `playlists` are used when the kinds are known (review step).
export function formatItemCounts({ quizzes = 0, lessons = 0, notebooks = 0, videos = 0, playlists = 0, youtube = 0 } = {}) {
  const parts = [];
  if (quizzes) parts.push(`${quizzes} امتحان`);
  if (lessons) parts.push(`${lessons} درس`);
  if (notebooks) parts.push(`${notebooks} دفتر`);
  if (videos) parts.push(`${videos} ${videos === 1 ? "فيديو" : "فيديوهات"}`);
  if (playlists) parts.push(`${playlists} ${playlists === 1 ? "قائمة تشغيل" : "قوائم تشغيل"}`);
  if (youtube) parts.push(`${youtube} من يوتيوب`);
  return parts.length ? parts.join(" و") : "0 عنصر";
}

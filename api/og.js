// =============================================================================
// api/og.js
//
// Vercel Edge Function — the ONLY OG-image function. Generates dynamic
// 1200×630 thumbnails (Satori via @vercel/og) for link previews. It is a thin
// dispatcher: every image type lives in its own module under api/_og/ (an
// underscore-prefixed folder is not deployed as a function, so Vercel Hobby's
// 12-function cap is untouched).
//
//   /api/og?quizId=ABCD1234              api/_og/quiz.js      (also the default/brand image)
//   /api/og?course=<id>[&folder=A/B]     api/_og/course.js    (course & folder thumbnails)
//   /api/og?lesson=<id|slug>             api/_og/lesson.js
//   /api/og?notebook=<id|slug>           api/_og/notebook.js  (dark code-editor card)
//   /api/og?profile=<handle>[&v=hash]    api/_og/profile.js
//
// Shared code: api/_og/common.js (font, Arabic/bidi text, icons, Supabase REST,
// safe PNG rendering with static fallback) and api/_og/blocks.js (card layout
// blocks). Cache-busting versions: api/_og/version.js.
//
// Cache: immutable 1-year CDN cache per URL; the URL carries a version/content
// stamp (see version.js). Incomplete renders (font/data missing) are cached
// for 5 minutes only, and a render crash redirects to a static thumbnail.
// =============================================================================

import { renderQuizImage } from "./_og/quiz.js";
import { renderCourseImage } from "./_og/course.js";
import { renderLessonImage } from "./_og/lesson.js";
import { renderNotebookImage } from "./_og/notebook.js";
import { renderProfileImage } from "./_og/profile.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);

  const lessonId = searchParams.get("lesson");
  if (lessonId) return renderLessonImage(lessonId);

  const notebookId = searchParams.get("notebook");
  if (notebookId) return renderNotebookImage(notebookId);

  const profileHandle = searchParams.get("profile");
  if (profileHandle) return renderProfileImage(profileHandle, searchParams.get("v"));

  const courseId = searchParams.get("course");
  if (courseId) {
    // ?folder=Algebra/Second (raw folder names, "/"-joined) → nested-folder variant.
    const folderPath = searchParams.get("folder");
    return renderCourseImage(courseId, folderPath ? folderPath.split("/").filter(Boolean) : null);
  }

  return renderQuizImage(searchParams.get("quizId"));
}

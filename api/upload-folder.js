// =============================================================================
// api/upload-folder.js
// Authenticated endpoint — bulk-uploads an entire folder/course tree (picked
// via the "رفع مجلد" admin action) to the DB in one request, preserving
// nesting via the relational courses/folders tables instead of flattening
// everything into a single subject/subfolder pair the way a plain
// multi-file import would.
//
// POST /api/upload-folder
// Headers: Authorization: Bearer <token>
// Body: {
//   education_type, college?, year?, term?,
//   // Flat list of every node in the picked directory tree. Each node's
//   // `folderSegments` is the ordered chain of ancestor folder/course
//   // names ABOVE it (not including its own name if it's itself a
//   // folder/course) — the same shape the client already computes from
//   // File.webkitRelativePath for the local userQuizzes folder-tree
//   // import, reused here for the remote path.
//   items: [
//     { type: "course", name, rootName },
//     { type: "folder", name, folderSegments: ["CourseName"], rootName },
//     { type: "quiz", folderSegments: ["CourseName","Unit1"], rootName, quiz },
//     ...
//   ]
// }
//
// Validation (see api/_courseFolders.js#validateBatchCourseRules):
//   - A course item must be top-level (empty folderSegments) — courses can
//     never be nested under a folder or another course.
//   - At most one course per batch, and when a batch includes a course,
//     every other item in it must be nested under that course (no stray
//     independent top-level items riding alongside it).
// Folders and quizzes are otherwise resolved/created idempotently by name
// per parent level (get-or-create), so re-running an upload over an
// already-partially-uploaded tree reuses existing folders instead of
// duplicating them.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { requireAdmin, applyCors, handleAuthError } from "./_middleware.js";
import { validateQuizPayload, validatePath, computeStats } from "./_validateQuiz.js";
import { generateQuizId } from "../scripts/lib/quizId.js";
import { isValidEducationType, validateTrackPath, buildDbPath, parseDbPath, buildDbColumns } from "../scripts/lib/quizPath.js";
import { resolveCourse, resolveFolderPath, validateBatchCourseRules } from "./_courseFolders.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const MAX_ITEMS_PER_BATCH = 500; // generous cap against accidental multi-GB folder picks

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  let adminPayload;
  try {
    adminPayload = requireAdmin(req);
  } catch (err) {
    if (handleAuthError(err, res)) return;
    return res.status(401).json({ error: "غير مصرح" });
  }

  const { college, year, term, education_type: rawEducationType, items } = req.body || {};

  const education_type =
    rawEducationType && isValidEducationType(rawEducationType) ? rawEducationType : "University";

  if (!adminPayload.isOwner && adminPayload.allowed_scopes) {
    if (!adminPayload.allowed_scopes.includes(education_type)) {
      return res.status(403).json({ error: "ليس لديك صلاحية لإضافة امتحانات في هذا المسار." });
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "لا توجد عناصر لرفعها." });
  }
  if (items.length > MAX_ITEMS_PER_BATCH) {
    return res.status(400).json({ error: `الحد الأقصى ${MAX_ITEMS_PER_BATCH} عنصر لكل دفعة.` });
  }

  const ruleCheck = validateBatchCourseRules(items);
  if (!ruleCheck.ok) {
    return res.status(400).json({ error: ruleCheck.error });
  }

  for (const item of items) {
    try {
      validatePath({
        name: item.name,
        ...Object.fromEntries((item.folderSegments || []).map((s, i) => [`seg${i}`, s])),
      });
    } catch (e) {
      return res.status(400).json({ error: `"${item.name}": ${e.message}` });
    }
  }

  try {
    validateTrackPath(education_type, { college, year, term, subject: "placeholder" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // Resolve admin identity once for the whole batch.
  let adminId = null;
  if (adminPayload?.email) {
    const { data: adminData } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", adminPayload.email)
      .maybeSingle();
    if (adminData) adminId = adminData.id;
  }

  // The batch's single course (if any) is created/resolved first so every
  // folder/quiz item nested under it can reference the same courseId.
  // Non-course batches (uploading folders/quizzes into an EXISTING course)
  // still need a course to attach to — the first segment of every item's
  // folderSegments chain names that existing course, resolved the same way
  // (get-or-create is safe here too: it just finds the existing row).
  const courseItem = items.find((i) => i.type === "course");
  const anyItem = items[0];
  const courseName = courseItem ? courseItem.name : anyItem.rootName;

  let courseId;
  try {
    const course = await resolveCourse(supabase, {
      educationType: education_type,
      college: education_type === "University" ? college : null,
      year: ["University", "Primary", "Middle", "High"].includes(education_type) ? year : null,
      term: ["University", "Primary", "Middle", "High"].includes(education_type) ? term : null,
      name: courseName,
      adminId,
    });
    courseId = course.id;
  } catch (e) {
    console.error("[upload-folder] course resolution failed:", e.message);
    return res.status(500).json({ error: "فشل تجهيز المادة. حاول مجددًا." });
  }

  // Resolve/create every folder level exactly once, in shortest-path-first
  // order, caching by joined segment key so a folder referenced by
  // multiple quizzes (e.g. two quizzes both under "Unit1/Week2") is only
  // created once instead of racing itself within the same batch.
  const folderIdByKey = new Map(); // "" => null (course root)
  folderIdByKey.set("", null);

  async function resolveFolderChain(segments) {
    // Drop the leading course-name segment — folderSegments includes the
    // course name itself as the first element for nested items, but
    // resolveFolderPath only wants the folder levels underneath it.
    const folderOnly = segments.length > 0 && segments[0] === courseName ? segments.slice(1) : segments;
    const key = folderOnly.join("/");
    if (folderIdByKey.has(key)) return folderIdByKey.get(key);
    const id = await resolveFolderPath(supabase, { courseId, segments: folderOnly, adminId });
    folderIdByKey.set(key, id);
    return id;
  }

  const results = { foldersCreated: 0, quizzesUploaded: 0, failed: [] };

  for (const item of items) {
    if (item.type === "course") continue; // already resolved as courseId above

    try {
      if (item.type === "folder") {
        const fullChain = [...(item.folderSegments || []), item.name];
        const before = folderIdByKey.size;
        await resolveFolderChain(fullChain);
        if (folderIdByKey.size > before) results.foldersCreated++;
        continue;
      }

      if (item.type === "quiz") {
        const folderId = await resolveFolderChain(item.folderSegments || []);

        if (item.quiz?.meta && typeof item.quiz.meta.id !== "string") {
          item.quiz.meta.id = "AAAAAAAA";
        }
        const cleanQuiz = validateQuizPayload(item.quiz);

        const folderPathForStorage = (item.folderSegments || [])
          .filter((s) => s !== courseName);
        const fullPath = buildDbPath({
          education_type,
          college,
          year,
          term,
          subject: courseName,
          subfolder: folderPathForStorage.join("/") || undefined,
        });
        const parsedPath = parseDbPath(fullPath);
        const dbCols = buildDbColumns(parsedPath);

        const safeTitle = cleanQuiz.meta.title
          .replace(/[^\u0600-\u06FF\w\s\-]/gu, "")
          .trim()
          .replace(/\s+/g, "_");
        const filename = `${safeTitle || "quiz"}.json`;

        cleanQuiz.meta.path = `quizzes/${fullPath}/${filename}`;
        cleanQuiz.meta.id = generateQuizId(cleanQuiz.meta.path);
        cleanQuiz.stats = computeStats(cleanQuiz.questions);
        cleanQuiz.meta.author_id = adminId;

        let passwordHash = null;
        if (cleanQuiz.meta.password) {
          delete cleanQuiz.meta.password; // bulk folder upload doesn't support per-quiz passwords
        }

        const { data: existing } = await supabase
          .from("quizzes")
          .select("id")
          .eq("path", fullPath)
          .eq("filename", filename)
          .maybeSingle();

        if (existing) {
          results.failed.push({ name: item.name || cleanQuiz.meta.title, reason: "يوجد اختبار بنفس الاسم في هذا المسار" });
          continue;
        }

        const { error: insertErr } = await supabase.from("quizzes").insert({
          path: fullPath,
          category: dbCols.category,
          subject: dbCols.subject,
          subfolder: dbCols.subfolder,
          title: cleanQuiz.meta.title,
          filename,
          data: cleanQuiz,
          education_type,
          password: passwordHash,
          college: dbCols.college || null,
          year: dbCols.year || null,
          term: dbCols.term || null,
          uploaded_by: adminId,
          course_id: courseId,
          folder_id: folderId,
        });

        if (insertErr) {
          results.failed.push({ name: cleanQuiz.meta.title, reason: insertErr.message });
          continue;
        }
        results.quizzesUploaded++;
      }
    } catch (e) {
      results.failed.push({ name: item.name || "?", reason: e.message });
    }
  }

  if (adminId && results.quizzesUploaded > 0) {
    try {
      await supabase.rpc("increment_uploaded_quizzes", { p_admin_id: adminId, p_count: results.quizzesUploaded });
    } catch (rpcErr) {
      console.error("[upload-folder] Failed to call increment_uploaded_quizzes RPC:", rpcErr.message || rpcErr);
    }
  }

  return res.status(results.failed.length > 0 && results.quizzesUploaded === 0 ? 207 : 201).json({
    success: results.quizzesUploaded > 0,
    courseId,
    ...results,
  });
}
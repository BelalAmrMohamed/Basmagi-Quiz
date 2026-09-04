// =============================================================================
// api/upload-quiz.js
// Authenticated endpoint — validates JWT then writes quiz(zes) to Supabase.
//
// Merged into a single file/serverless-function (same pattern as
// api/admin.js's control+stats merge) rather than adding a dedicated
// api/upload-folder.js: this project deploys on Vercel Hobby, which caps
// serverless functions at 12, and the API directory was already at that
// cap — see the comment in public/src/shared/quizManifest.js about moving
// the manifest fetch off a serverless function for the same reason.
//
// Modes (dispatched by req.body.mode):
//   "single" (default, omitted mode) — one quiz or a same-placement batch,
//     from createUploadButton(quiz) / openAdminUploadModal(quizzes[]).
//     Body: { college, year, term, subject, subfolder?, subfolderPath?,
//             education_type?, quiz: {...} }
//   "folder" — an entire local folder/course tree in one request, from the
//     "رفع مجلد" admin action.
//     Body: { education_type, college?, year?, term?, items: [...] }
//     See handleFolderUpload's header comment for the `items` shape.
//
// `subject` (single mode) / each item's course name (folder mode) resolves
// to (or creates) a row in `courses` — courses are top-level-only
// groupings, never nestable. `subfolder`/`subfolderPath` (single mode) or
// each item's `folderSegments` (folder mode) resolves/creates the
// corresponding chain of rows in `folders`, nested under that course. See
// api/_courseFolders.js for the resolution logic and
// supabase/migrations/20260901195646_courses_and_folders.sql for the
// schema and the reasoning for keeping the legacy path/category/subject/
// subfolder columns as denormalized mirrors alongside the new
// course_id/folder_id relational columns.
// =============================================================================

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, applyCors, handleAuthError } from "./_middleware.js";
import {
  validateQuizPayload,
  validatePath,
  computeStats,
} from "./_validateQuiz.js";
import { generateQuizId } from "../scripts/lib/quizId.js";
import {
  isValidEducationType,
  validateTrackPath,
  buildDbPath,
  buildDbColumns,
  parseDbPath,
} from "../scripts/lib/quizPath.js";
import { resolveCourse, resolveFolderPath, validateBatchCourseRules } from "./_courseFolders.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const SCHOOL_TRACKS = ["University", "Primary", "Middle", "High"];
const MAX_ITEMS_PER_BATCH = 500; // generous cap against accidental multi-GB folder picks

// ─── Shared helpers ─────────────────────────────────────────────────────────

async function resolveAdminIdentity(adminPayload) {
  let adminId = null;
  if (adminPayload?.email) {
    const { data: adminData, error: adminErr } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", adminPayload.email)
      .maybeSingle();
    if (adminData && !adminErr) adminId = adminData.id;
  }
  return adminId;
}

function checkScope(adminPayload, education_type, res) {
  if (!adminPayload.isOwner && adminPayload.allowed_scopes) {
    if (!adminPayload.allowed_scopes.includes(education_type)) {
      res.status(403).json({ error: "ليس لديك صلاحية لإضافة امتحانات في هذا المسار." });
      return false;
    }
  }
  return true;
}

// ─── Mode: single (one quiz, or a same-placement batch) ─────────────────────

async function handleSingleUpload(req, res, adminPayload) {
  const {
    college,
    year,
    term,
    subject,
    subfolder,
    // New: an ordered array of nested folder names, e.g. ["Unit1", "Week2"].
    // Optional and backward-compatible — when omitted, a plain `subfolder`
    // string (single legacy level) still works exactly as before.
    subfolderPath,
    education_type: rawEducationType,
    quiz,
  } = req.body || {};

  const education_type =
    rawEducationType && isValidEducationType(rawEducationType)
      ? rawEducationType
      : "University";

  if (!checkScope(adminPayload, education_type, res)) return;

  try {
    validatePath({ college, year, term, subject, subfolder });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    validateTrackPath(education_type, { college, year, term, subject, subfolder });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // validateQuizPayload requires meta.id to already be a valid 8-char
  // base32 string, but the client (adminUpload.js's normalizeQuizSchema)
  // never sends one — the real ID can only be computed once we know the
  // final storage path (below), which depends on fields validated here.
  // A placeholder that satisfies the format check is filled in first; the
  // real, path-derived ID overwrites it further down before anything is
  // persisted, so this value is never actually stored or returned.
  if (quiz && quiz.meta && typeof quiz.meta.id !== "string") {
    quiz.meta.id = "AAAAAAAA";
  }

  let cleanQuiz;
  try {
    cleanQuiz = validateQuizPayload(quiz);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // Normalize the folder chain: prefer the new subfolderPath array; fall
  // back to wrapping the legacy single `subfolder` string in a one-element
  // array so old callers (or the modal's existing single-subfolder step)
  // keep working unchanged.
  const folderSegments = Array.isArray(subfolderPath) && subfolderPath.length > 0
    ? subfolderPath
    : (subfolder ? [subfolder] : []);

  const fullPath = buildDbPath({ education_type, college, year, term, subject, subfolder: folderSegments.join("/") || undefined });
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

  const adminId = await resolveAdminIdentity(adminPayload);

  // Identity enforcement:
  // - `author_id` (adminId) is ALWAYS server-derived and never trusted from the client.
  //   This is the stable identifier used to fetch up-to-date admin profile data
  //   (display name, handle, avatar) during rendering.
  cleanQuiz.meta.author_id = adminId;

  // `view` / `mode` come from validated quiz.meta — already in cleanQuiz

  // Resolve (or create) the relational course row, and the full nested
  // folder chain under it. Done after we know adminId so newly-created
  // course/folder rows correctly attribute created_by; done before the
  // existing-quiz duplicate check so a genuine failure here doesn't leave
  // the quizzes table untouched but course/folder rows half-created.
  let courseId;
  let folderId = null;
  try {
    const course = await resolveCourse(supabase, {
      educationType: education_type,
      college: education_type === "University" ? college : null,
      year: SCHOOL_TRACKS.includes(education_type) ? year : null,
      term: SCHOOL_TRACKS.includes(education_type) ? term : null,
      name: subject,
      adminId,
    });
    courseId = course.id;
    folderId = await resolveFolderPath(supabase, {
      courseId,
      segments: folderSegments,
      adminId,
    });
  } catch (e) {
    console.error("[upload-quiz] course/folder resolution failed:", e.message);
    return res.status(500).json({ error: "فشل تجهيز المادة/المجلد. حاول مجددًا." });
  }

  let passwordHash = null;
  if (cleanQuiz.meta.password) {
    passwordHash = crypto
      .createHash("sha256")
      .update(cleanQuiz.meta.password)
      .digest("hex");
    delete cleanQuiz.meta.password;
  }

  const { data: existing } = await supabase
    .from("quizzes")
    .select("id")
    .eq("path", fullPath)
    .eq("filename", filename)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({
      error: `يوجد اختبار بنفس الاسم في هذا المسار:\n${fullPath}/${filename}`,
    });
  }

  const { data, error } = await supabase
    .from("quizzes")
    .insert({
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
      // Relational placement — course_id is always set; folder_id is only
      // set when the quiz sits inside a subfolder chain (null = directly
      // under the course, same meaning as the legacy subfolder column
      // being null).
      course_id: courseId,
      folder_id: folderId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[upload-quiz] Supabase error:", error.message);
    return res.status(500).json({ error: "فشل رفع الاختبار. حاول مجددًا." });
  }

  if (adminId) {
    // Use an atomic DB-side increment via an RPC for safety under concurrency.
    try {
      await supabase.rpc("increment_uploaded_quizzes", { p_admin_id: adminId });
    } catch (rpcErr) {
      console.error("Failed to call increment_uploaded_quizzes RPC:", rpcErr.message || rpcErr);
    }
  }

  return res.status(201).json({
    success: true,
    id: data.id,
    quizId: cleanQuiz.meta.id,
    path: fullPath,
    courseId,
    folderId,
  });
}

// ─── Mode: folder (entire local folder/course tree in one request) ──────────
//
// items: [
//   { type: "course", name, rootName },
//   { type: "folder", name, folderSegments: ["CourseName"], rootName },
//   { type: "quiz", folderSegments: ["CourseName","Unit1"], rootName, quiz },
//   ...
// ]
// Each item's `folderSegments` is the ordered chain of ancestor
// folder/course names ABOVE it (not including its own name if it's itself
// a folder/course) — the same shape the client already computes from
// File.webkitRelativePath for the local userQuizzes folder-tree import,
// reused here for the remote path. `rootName` names the top-level
// directory the whole batch was picked from, used to resolve an existing
// course when the batch doesn't itself include a "course" item (i.e.
// uploading folders/quizzes into an already-existing course).
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

async function handleFolderUpload(req, res, adminPayload) {
  const { college, year, term, education_type: rawEducationType, items } = req.body || {};

  const education_type =
    rawEducationType && isValidEducationType(rawEducationType) ? rawEducationType : "University";

  if (!checkScope(adminPayload, education_type, res)) return;

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
      validatePath({ name: item.name, folderSegments: (item.folderSegments || []).join("/") });
    } catch (e) {
      return res.status(400).json({ error: `"${item.name}": ${e.message}` });
    }
  }

  try {
    // Only track-level fields (college/year/term) matter here; "subject"
    // is required by validateTrackPath's signature but the actual course
    // name is resolved per-batch below, not from this placeholder.
    validateTrackPath(education_type, { college, year, term, subject: "placeholder" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const adminId = await resolveAdminIdentity(adminPayload);

  // Resolve courses in this batch: each distinct course is resolved/created
  // once and cached in courseIdByName so multiple courses can be uploaded
  // in a single batch to the same education_type/college/year/term.
  const courseIdByName = new Map();

  async function getOrResolveCourse(cName) {
    const trimmed = (cName || "").trim();
    if (!trimmed) throw new Error("اسم المادة مفقود.");
    if (courseIdByName.has(trimmed)) return courseIdByName.get(trimmed);
    const course = await resolveCourse(supabase, {
      educationType: education_type,
      college: education_type === "University" ? college : null,
      year: SCHOOL_TRACKS.includes(education_type) ? year : null,
      term: SCHOOL_TRACKS.includes(education_type) ? term : null,
      name: trimmed,
      adminId,
    });
    courseIdByName.set(trimmed, course.id);
    return course.id;
  }

  // Pre-resolve all explicit course items in the batch
  for (const item of items) {
    if (item.type === "course") {
      try {
        await getOrResolveCourse(item.name);
      } catch (e) {
        console.error("[upload-quiz:folder] course resolution failed:", item.name, e.message);
        return res.status(500).json({ error: `فشل تجهيز المادة "${item.name}". حاول مجددًا.` });
      }
    }
  }

  // If no explicit course item exists, resolve from rootName of the items
  if (courseIdByName.size === 0 && items[0]?.rootName) {
    try {
      await getOrResolveCourse(items[0].rootName);
    } catch (e) {
      console.error("[upload-quiz:folder] rootName course resolution failed:", e.message);
      return res.status(500).json({ error: "فشل تجهيز المادة. حاول مجددًا." });
    }
  }

  // Cache folder IDs by unique composite key "courseId:subpath"
  const folderIdByKey = new Map();

  async function resolveFolderChain(targetCourseId, courseName, segments) {
    const folderOnly = segments.length > 0 && segments[0] === courseName ? segments.slice(1) : segments;
    const key = `${targetCourseId}:${folderOnly.join("/")}`;
    if (folderIdByKey.has(key)) return folderIdByKey.get(key);
    const id = await resolveFolderPath(supabase, { courseId: targetCourseId, segments: folderOnly, adminId });
    folderIdByKey.set(key, id);
    return id;
  }

  const results = { coursesCount: courseIdByName.size, foldersCreated: 0, quizzesUploaded: 0, failed: [] };

  for (const item of items) {
    if (item.type === "course") continue; // already resolved above

    try {
      const itemCourseName = (item.folderSegments && item.folderSegments.length > 0)
        ? item.folderSegments[0]
        : (item.rootName || courseIdByName.keys().next().value);
      const targetCourseId = await getOrResolveCourse(itemCourseName);

      if (item.type === "folder") {
        const fullChain = [...(item.folderSegments || []), item.name];
        const before = folderIdByKey.size;
        await resolveFolderChain(targetCourseId, itemCourseName, fullChain);
        if (folderIdByKey.size > before) results.foldersCreated++;
        continue;
      }

      if (item.type === "quiz") {
        const folderId = await resolveFolderChain(targetCourseId, itemCourseName, item.folderSegments || []);

        if (item.quiz?.meta && typeof item.quiz.meta.id !== "string") {
          item.quiz.meta.id = "AAAAAAAA";
        }
        const cleanQuiz = validateQuizPayload(item.quiz);

        const folderPathForStorage = (item.folderSegments || []).filter((s) => s !== itemCourseName);
        const fullPath = buildDbPath({
          education_type,
          college,
          year,
          term,
          subject: itemCourseName,
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
        // Bulk folder upload doesn't support per-quiz passwords
        if (cleanQuiz.meta.password) delete cleanQuiz.meta.password;

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
          password: null,
          college: dbCols.college || null,
          year: dbCols.year || null,
          term: dbCols.term || null,
          uploaded_by: adminId,
          course_id: targetCourseId,
          folder_id: folderId,
        });

        if (insertErr) {
          results.failed.push({ name: cleanQuiz.meta.title, reason: insertErr.message });
          continue;
        }
        results.quizzesUploaded++;

        if (adminId) {
          try {
            await supabase.rpc("increment_uploaded_quizzes", { p_admin_id: adminId });
          } catch (rpcErr) {
            console.error("[upload-quiz:folder] Failed to call increment_uploaded_quizzes RPC:", rpcErr.message || rpcErr);
          }
        }
      }
    } catch (e) {
      results.failed.push({ name: item.name || "?", reason: e.message });
    }
  }

  const isSuccess = results.quizzesUploaded > 0 || results.foldersCreated > 0 || courseIdByName.size > 0;
  return res.status(results.failed.length > 0 && results.quizzesUploaded === 0 && results.foldersCreated === 0 ? 207 : 201).json({
    success: isSuccess,
    courseIds: Array.from(courseIdByName.values()),
    ...results,
  });
}

// ─── Dispatcher ───────────────────────────────────────────────────────────

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

  if (req.body?.mode === "folder") {
    return handleFolderUpload(req, res, adminPayload);
  }
  return handleSingleUpload(req, res, adminPayload);
}
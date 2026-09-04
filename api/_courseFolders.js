// =============================================================================
// api/_courseFolders.js
// Resolution and validation helpers for relational courses and folders.
//
// Shared by api/upload-quiz.js (single and "folder" batch modes) to manage get-or-create
// operations on the `courses` and `folders` tables in Supabase.
// =============================================================================

/**
 * Validates course placement rules across a batch of items being uploaded.
 *
 * Rules:
 *   - Courses can ONLY exist at the root level (empty or no folderSegments).
 *   - Any item that is not a course must specify its parent course either via
 *     rootName or as the first element of folderSegments.
 *
 * @param {Array<object>} items
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateBatchCourseRules(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "لا توجد عناصر لرفعها." };
  }

  const courseItems = items.filter((i) => i.type === "course");

  // Courses must never be nested inside a folder or another course
  for (const course of courseItems) {
    if (course.folderSegments && course.folderSegments.length > 0) {
      return {
        ok: false,
        error: `المادة "${course.name}" يجب أن تكون في المستوى الرئيسي فقط ولا يمكن وضعها داخل مجلد.`,
      };
    }
  }

  // If the batch has courses, every other item must belong to one of those courses
  if (courseItems.length > 0) {
    const courseNames = new Set(courseItems.map((c) => (c.name || "").trim()));
    for (const item of items) {
      if (item.type === "course") continue;
      const leadingSegment = (item.folderSegments && item.folderSegments.length > 0)
        ? item.folderSegments[0]
        : null;
      const targetCourse = leadingSegment || item.rootName;
      if (!targetCourse || !courseNames.has(targetCourse.trim())) {
        return {
          ok: false,
          error: `العنصر "${item.name}" غير مرتبط بأي من المواد المحددة للرفع.`,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Resolves or creates a course in the `courses` table.
 * Matches unique slot: (education_type, college, year, term, name).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   educationType: string,
 *   college?: string|null,
 *   year?: number|string|null,
 *   term?: number|string|null,
 *   name: string,
 *   adminId?: string|null
 * }} params
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function resolveCourse(supabase, { educationType, college, year, term, name, adminId }) {
  if (!name || !name.trim()) {
    throw new Error("اسم المادة مطلوب.");
  }
  const courseName = name.trim();

  let collegeId = null;
  if (educationType === "University" && college) {
    const normalizedCollege = college.trim().replace(/\s+/g, " ").toLowerCase();
    const { data: collegeRow } = await supabase
      .from("colleges")
      .select("id")
      .eq("education_type", "University")
      .eq("normalized_name", normalizedCollege)
      .eq("is_active", true)
      .maybeSingle();
    collegeId = collegeRow?.id || null;
  }

  let query = supabase
    .from("courses")
    .select("id, name")
    .eq("education_type", educationType)
    .eq("name", courseName);

  if (collegeId) {
    query = query.eq("college_id", collegeId);
  } else if (college) {
    query = query.eq("college", college);
  } else {
    query = query.is("college", null);
  }

  const numYear = year != null && year !== "" ? parseInt(year, 10) : null;
  const numTerm = term != null && term !== "" ? parseInt(term, 10) : null;

  if (numYear != null && !Number.isNaN(numYear)) {
    query = query.eq("year", numYear);
  } else {
    query = query.is("year", null);
  }

  if (numTerm != null && !Number.isNaN(numTerm)) {
    query = query.eq("term", numTerm);
  } else {
    query = query.is("term", null);
  }

  const { data: existing, error: selectErr } = await query.maybeSingle();
  if (selectErr) {
    console.error("[resolveCourse] lookup failed:", selectErr.message);
  }
  if (existing) {
    return existing;
  }

  // Insert newly created course
  const { data: inserted, error: insertErr } = await supabase
    .from("courses")
    .insert({
      name: courseName,
      education_type: educationType,
      college: college || null,
      college_id: collegeId,
      year: numYear,
      term: numTerm,
      created_by: adminId || null,
    })
    .select("id, name")
    .single();

  if (insertErr) {
    // If concurrent insert or duplicate constraint hit, retry selection once
    const { data: retryData } = await query.maybeSingle();
    if (retryData) return retryData;
    throw new Error(insertErr.message || "فشل إنشاء المادة في قاعدة البيانات.");
  }

  return inserted;
}

/**
 * Resolves or creates an arbitrary-depth chain of nested folders under a course.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   courseId: string,
 *   segments: string[],
 *   adminId?: string|null
 * }} params
 * @returns {Promise<string|null>} the ID of the leaf folder, or null if segments is empty
 */
export async function resolveFolderPath(supabase, { courseId, segments, adminId }) {
  if (!segments || segments.length === 0) return null;

  let currentParentId = null;

  for (const rawSeg of segments) {
    const segName = (rawSeg || "").trim();
    if (!segName) continue;

    let query = supabase
      .from("folders")
      .select("id, name")
      .eq("course_id", courseId)
      .eq("name", segName);

    if (currentParentId) {
      query = query.eq("parent_folder_id", currentParentId);
    } else {
      query = query.is("parent_folder_id", null);
    }

    const { data: existing, error: selErr } = await query.maybeSingle();
    if (existing) {
      currentParentId = existing.id;
      continue;
    }

    const { data: inserted, error: insErr } = await supabase
      .from("folders")
      .insert({
        course_id: courseId,
        parent_folder_id: currentParentId,
        name: segName,
        created_by: adminId || null,
      })
      .select("id, name")
      .single();

    if (insErr) {
      // Retry in case of concurrent insert
      const { data: retryData } = await query.maybeSingle();
      if (retryData) {
        currentParentId = retryData.id;
        continue;
      }
      throw new Error(insErr.message || `فشل إنشاء المجلد "${segName}".`);
    }

    currentParentId = inserted.id;
  }

  return currentParentId;
}

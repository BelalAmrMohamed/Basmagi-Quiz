/**
 * Resolves an ordered chain of folder names inside a course to a folder id.
 * The browser knows folders by path (the same "A/B/C" strings the lesson
 * wizard shows); ids are resolved here so the client never sends a trusted id.
 * @returns {Promise<{ok:true, folderId:string|null}|{ok:false, error:string}>}
 */
export async function resolveFolderPath(supabase, courseId, segments) {
  const chain = Array.isArray(segments) ? segments.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  if (!chain.length) return { ok: true, folderId: null };
  if (chain.length > 12) return { ok: false, error: "مسار المجلد طويل جدًا." };
  const { data, error } = await supabase
    .from("folders")
    .select("id, name, parent_folder_id")
    .eq("course_id", courseId)
    .limit(5000);
  if (error) return { ok: false, error: "تعذّر قراءة مجلدات المادة." };
  let parent = null;
  for (const name of chain) {
    const hits = (data || []).filter((f) => (f.parent_folder_id || null) === parent && f.name === name);
    if (hits.length !== 1) {
      return { ok: false, error: hits.length ? `اسم المجلد "${name}" مكرر في نفس المستوى.` : `المجلد "${name}" غير موجود في هذه المادة.` };
    }
    parent = hits[0].id;
  }
  return { ok: true, folderId: parent };
}


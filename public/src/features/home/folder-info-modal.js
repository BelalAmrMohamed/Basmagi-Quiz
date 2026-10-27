// ============================================================================
// public/src/features/home/folder-info-modal.js
// FOLDER INFO MODAL — "معلومات المجلد" for shared (platform) folders, plus a
// local variant for folders/courses in "امتحاناتك". Same overlay shell and
// shimmer as the course info modal.
// ============================================================================

import { getFromStorage } from "../../shared/storage-helpers.js";
import { getCourseContentsStats } from "./course-actions.js";
import {
  openInfoOverlay,
  buildInfoTableHtml,
  buildCreatorSectionHtml,
  fetchFolderDetails,
  fetchCreatorById,
  formatDateForInfo,
} from "./info-details.js";

function statsHtml({ quizCount, lessonCount, subfolderCount }) {
  return `
    <div class="course-info-stat"><strong>${quizCount}</strong><span>امتحان</span></div>
    <div class="course-info-stat"><strong>${lessonCount}</strong><span>درس</span></div>
    <div class="course-info-stat"><strong>${subfolderCount}</strong><span>مجلد فرعي</span></div>
  `;
}

/**
 * @param {object} folder - category-tree folder node (path, id, icon,
 *   created_by, created_at, …).
 */
export function showFolderInfoModal(folder) {
  const { body, isOpen } = openInfoOverlay({
    title: "معلومات المجلد",
    statsHtml: statsHtml(getCourseContentsStats(folder)),
  });

  (async () => {
    const details = await fetchFolderDetails(folder?.id);
    const creator = await fetchCreatorById(details?.created_by || folder?.created_by);
    if (!isOpen()) return;

    const path = Array.isArray(folder?.path) && folder.path.length ? folder.path : [folder?.name];
    const created = formatDateForInfo(details?.created_at || folder?.created_at);
    const updated = formatDateForInfo(details?.updated_at);
    const rows = [
      { label: "الاسم", val: folder?.name || path[path.length - 1] },
      { label: "الأيقونة", val: folder?.icon || null },
      { label: "المادة", val: path[0] },
      { label: "المجلد الأب", val: path.length > 2 ? path[path.length - 2] : null },
      { label: "المسار", val: path.join(" › ") },
      { label: "تاريخ الإنشاء", val: created, ltr: true },
      { label: "آخر تعديل", val: updated && updated !== created ? updated : null, ltr: true },
      { label: "ID", val: folder?.id || null, ltr: true },
    ];
    body.innerHTML = buildInfoTableHtml(rows) + buildCreatorSectionHtml(creator);
  })();
}

/**
 * Local (امتحاناتك) folder or course. Only fields that exist locally are
 * shown — there is no creator or server-side update date.
 * @param {string} itemId
 */
export function showLocalFolderInfoModal(itemId) {
  let rows = [];
  try {
    rows = JSON.parse(getFromStorage("user_quizzes", "[]"));
  } catch (_) {
    rows = [];
  }
  const byId = new Map(rows.map((r) => [r.id || r.meta?.id, r]));
  const item = byId.get(itemId);
  if (!item) return;

  const isCourse = item.meta?.type === "course";
  const chain = [];
  const seen = new Set();
  let cur = item;
  while (cur && !seen.has(cur.id || cur.meta?.id)) {
    seen.add(cur.id || cur.meta?.id);
    chain.unshift(cur.meta?.title || "");
    cur = cur.meta?.parentId ? byId.get(cur.meta.parentId) : null;
  }

  // Descendant counts: walk children breadth-first.
  let quizCount = 0;
  let lessonCount = 0;
  let subfolderCount = 0;
  const queue = [itemId];
  while (queue.length) {
    const parent = queue.shift();
    for (const r of rows) {
      if ((r.meta?.parentId || null) !== parent) continue;
      const type = r.meta?.type || "quiz";
      if (type === "folder" || type === "course") {
        subfolderCount += 1;
        queue.push(r.id || r.meta?.id);
      } else if (type === "lesson") lessonCount += 1;
      else quizCount += 1;
    }
  }

  const { body } = openInfoOverlay({
    title: isCourse ? "معلومات المادة" : "معلومات المجلد",
    statsHtml: statsHtml({ quizCount, lessonCount, subfolderCount }),
  });
  const created = formatDateForInfo(item.meta?.createdAt);
  const updated = formatDateForInfo(item.meta?.updatedAt);
  body.innerHTML = buildInfoTableHtml([
    { label: "الاسم", val: item.meta?.title },
    { label: "النوع", val: isCourse ? "مادة (محلية)" : "مجلد (محلي)" },
    { label: "المسار", val: chain.length > 1 ? chain.join(" › ") : null },
    { label: "تاريخ الإنشاء", val: created, ltr: true },
    { label: "آخر تعديل", val: updated && updated !== created ? updated : null, ltr: true },
    { label: "ID", val: itemId, ltr: true },
  ]);
}
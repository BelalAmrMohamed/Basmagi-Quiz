// ============================================================================
// public/src/features/lesson/lesson-embeds.js
// Shared helpers for notebook / folder / course link-out embeds, used by the
// lesson reader (lesson-view.js) and the lesson editor preview (create-lesson).
// ============================================================================
import { toSlug } from "../home/slug-utils.js";

/** `/course/<slug>/<slug>...` — every part is `toSlug(name)`, as in category-view.js. */
export function courseHref(courseName, folderNames = []) {
  return "/course/" + [courseName, ...folderNames].map((part) => encodeURIComponent(toSlug(String(part)))).join("/");
}

/**
 * Builds a folder lookup entry (path from the course root, route, label).
 * `foldersById` must contain the folder's ancestors (all folders of its
 * course). Returns null when the parent course is unknown: without it there
 * is no valid route, so the card should render as unavailable.
 */
export function buildFolderEntry(folder, foldersById, course) {
  if (!folder || !course) return null;
  const names = [];
  const seen = new Set();
  let cursor = folder;
  while (cursor && !seen.has(String(cursor.id))) {
    seen.add(String(cursor.id));
    names.unshift(cursor.name);
    cursor = cursor.parent_folder_id ? foldersById.get(String(cursor.parent_folder_id)) : null;
  }
  return {
    ...folder,
    path: names,
    pathLabel: [course.name, ...names.slice(0, -1)].join(" / "),
    href: courseHref(course.name, names),
  };
}

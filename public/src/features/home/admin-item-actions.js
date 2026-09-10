// =============================================================================
// public/src/features/home/admin-item-actions.js
// ADMIN ITEM ACTIONS — the shared/admin (Supabase-backed) ⋮ dropdown action
// set for quizzes, folders, and courses: تعديل (edit), نقل (move),
// إعادة تسمية (rename), حذف (soft-delete → trash). See
// docs/plans/Admin actions and deletion flow for quizzes.md §5.
//
//   - canManageItem() — per-item UX gate (owner → creator match → scope match),
//     generalized from delete-quiz.js's canDeleteQuiz() to folders/courses.
//   - renameSharedItem() / deleteSharedItem() — prompt/confirm + the matching
//     /api/admin?action=... server call.
//   - openSharedMoveToDialog() — the Supabase-backed MoveSource adapter for
//     move-to-dialog.js (the localStorage "امتحاناتك" half lives in
//     user-quizzes-folders.js).
//   - refreshSharedArea() — invalidate manifest, refetch, re-render the view.
//
// The server is ALWAYS the real authorization boundary (isAuthorizedForItem
// in api/_trash.js); canManageItem() is UX only.
// =============================================================================

import {
  isAdminAuthenticated,
  getAdminRoleInfo,
  getToken,
} from "../../shared/adminAuth.js";
import {
  invalidateManifestCache,
  getManifest,
} from "../../shared/quizManifest.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import {
  showNotification,
  _confirm,
  _prompt,
} from "../../components/notifications/notifications.js";
import { openMoveToDialogWithSource } from "./move-to-dialog.js";

// ── Type / id resolution ─────────────────────────────────────────────────────
// The three item shapes fed into this module (see quizManifest.js):
//   - quiz:    { dbId, id (8-char meta id), title, education_type, author,
//                author_email, author_id, courseId, folderId, ... }
//   - folder:  { id (folder DB uuid), name, education_type, parent (path key),
//                course_id, parent_folder_id, created_by, ... }
//   - course:  { id (course DB uuid), name, education_type, parent: null,
//                created_by, ... }
function resolveItemType(item) {
  if (!item) return null;
  if (item.dbId) return "quiz";
  // Category-tree folder nodes carry a string `parent` path key; course nodes
  // have parent: null. A folder node is also identifiable by its DB
  // `course_id`/`parent_folder_id` threading (added in quizManifest.js).
  if (item.parent_folder_id !== undefined || (typeof item.parent === "string" && item.parent)) {
    return "folder";
  }
  if (item.parent === null || item.parent === undefined) {
    return "course";
  }
  return null;
}

/** The DB row id used by every /api/admin item action for this item. */
function resolveItemId(item) {
  if (!item) return null;
  if (item.dbId) return item.dbId; // quizzes use the Supabase row uuid
  return item.id || null;
}

// ── Visibility gate (UX only — the server re-authorizes everything) ──────────

/**
 * Generalized 3-tier admin gate, parallel to delete-quiz.js's canDeleteQuiz():
 *   1. platform owner
 *   2. the item's own creator/uploader (quizzes match author_handle /
 *      author_email against the JWT — folders/courses carry a DB uuid in
 *      created_by that the client JWT doesn't have, so that tier only applies
 *      client-side for quizzes; the server matches the real uuid for all)
 *   3. allowed_scopes includes the item's education_type
 * @param {object} item - manifest quiz entry / category-tree course or folder node
 * @returns {boolean}
 */
export function canManageItem(item) {
  if (!item) return false;
  if (!isAdminAuthenticated()) return false;

  const roleInfo = getAdminRoleInfo();
  if (!roleInfo) return false;

  // Tier 1 — platform owner
  if (roleInfo.isOwner) return true;

  // Tier 2 — creator/uploader match (quizzes carry author_handle/author_email)
  if (item.author_handle && roleInfo.handle && item.author_handle === roleInfo.handle) {
    return true;
  }
  if (
    item.author_email &&
    roleInfo.email &&
    String(item.author_email).toLowerCase() === String(roleInfo.email).toLowerCase()
  ) {
    return true;
  }

  // Tier 3 — scope match
  if (
    item.education_type &&
    roleInfo.allowed_scopes &&
    roleInfo.allowed_scopes.includes(item.education_type)
  ) {
    return true;
  }

  return false;
}

// ── Low-level POST to /api/admin ──────────────────────────────────────────────

/**
 * POSTs an `action=` request to /api/admin with the admin JWT. Shows its own
 * error notification on failure.
 * @param {string} action
 * @param {object} [body]
 * @returns {Promise<object|null>} parsed JSON on 2xx, or null on failure
 */
export async function postAdminAction(action, body = {}) {
  const token = getToken();
  if (!token) {
    showNotification("خطأ", "يجب تسجيل الدخول كمشرف أولاً", "error");
    return null;
  }

  let res;
  try {
    res = await fetch("/api/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...body }),
    });
  } catch (networkErr) {
    console.error("[admin-item-actions] Network error:", networkErr);
    showNotification(
      "خطأ",
      "تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.",
      "error",
    );
    return null;
  }

  let json = {};
  try {
    json = await res.json();
  } catch (_) {}

  if (!res.ok) {
    console.error(`[admin-item-actions] ${action} failed:`, res.status, json);
    showNotification("خطأ", json.error || "فشل تنفيذ العملية. حاول مرة أخرى.", "error");
    return null;
  }

  return json;
}
// ── Post-mutation refresh ─────────────────────────────────────────────────────

/**
 * Invalidates the in-memory manifest, re-fetches it, and re-renders the
 * current view (root / course / folder / my-quizzes) from the fresh tree.
 * Falls back to a hard reload if anything throws.
 *
 * navigation.js is imported dynamically so this module (which category-view.js
 * and root-view.js import) can call restoreViewFromURL without creating a
 * static import cycle: the static graph stays acyclic, and the dynamic edge
 * only exists at call time, after the whole home-page module graph has
 * already loaded.
 */
export async function refreshSharedArea() {
  try {
    invalidateManifestCache();
    const manifest = await getManifest();

    // The tree must be fresh BEFORE restoreViewFromURL reads it.
    const { setCategoryTree, setRestoring } = await import("./app-state.js");
    setCategoryTree(manifest.categoryTree);

    const { restoreViewFromURL } = await import("./navigation.js");
    setRestoring(true);
    try {
      restoreViewFromURL();
    } finally {
      setRestoring(false);
    }
  } catch (err) {
    console.error("[admin-item-actions] refreshSharedArea failed:", err);
    window.location.reload();
  }
}

// ── Rename ────────────────────────────────────────────────────────────────────

/**
 * Renames a shared (Supabase-backed) quiz/folder/course via
 * action=rename-item. Uses the same _prompt() flow as the localStorage
 * renameItem() in user-quizzes-folders.js.
 * @param {object} item - quiz entry / course / folder node
 * @returns {Promise<boolean>} true on success (refresh already triggered)
 */
export async function renameSharedItem(item) {
  const itemType = resolveItemType(item);
  const itemId = resolveItemId(item);
  if (!itemType || !itemId) return false;

  const currentTitle = item.title || item.name || "";
  const newName = await _prompt("أدخل الاسم الجديد:", currentTitle);
  if (!newName || !newName.trim()) return false;

  const res = await postAdminAction("rename-item", {
    itemType,
    itemId,
    newName,
  });
  if (!res) return false;

  const label = item.title || item.name || "العنصر";
  showNotification(
    "تمت إعادة التسمية",
    `تم تغيير اسم "${label}" بنجاح`,
    "success",
  );
  await refreshSharedArea();
  return true;
}

// ── Delete / soft-delete (→ trash) ────────────────────────────────────────────

/**
 * Soft-deletes a shared item: quizzes go through the existing /api/delete-quiz
 * DELETE endpoint (which snapshots into trash_items); folders/courses go
 * through action=delete-folder / delete-course (which cascade the whole
 * subtree into one trash batch). All are fully reversible from the trash UI
 * until purged. Uses the plan's "سيُنقل … إلى سلة المهملات" confirmation
 * wording (no longer "لا يمكن التراجع").
 * @param {object} item
 * @returns {Promise<boolean>} true on success (refresh already triggered)
 */
export async function deleteSharedItem(item) {
  const itemType = resolveItemType(item);
  const itemId = resolveItemId(item);
  if (!itemType || !itemId) return false;

  const label = item.title || item.name || "العنصر";
  const copyByType = {
    quiz: `سيُنقل "${label}" إلى سلة المهملات ويمكن استعادته لاحقاً.`,
    folder: `سيُنقل المجلد "${label}" وكل ما يحتويه إلى سلة المهملات ويمكن استعادتها لاحقاً.`,
    course: `سيُنقل المادة "${label}" وكل مجلداتها وامتحاناتها إلى سلة المهملات ويمكن استعادتها لاحقاً.`,
  };

  const confirmed = await _confirm(copyByType[itemType]);
  if (!confirmed) return false;

  if (itemType === "quiz") {
    // Reuse the existing server-validated quiz soft-delete endpoint.
    const { deleteQuizFromDatabase } = await import("./delete-quiz.js");
    const ok = await deleteQuizFromDatabase(item);
    if (!ok) return false;
  } else {
    const action = itemType === "folder" ? "delete-folder" : "delete-course";
    const res = await postAdminAction(action, { id: itemId });
    if (!res) return false;
    showNotification(
      "تم النقل إلى سلة المهملات",
      `تم نقل "${label}" إلى سلة المهملات.`,
      "success",
    );
  }

  await refreshSharedArea();
  return true;
}
// ── Move (shared MoveSource adapter) ──────────────────────────────────────────

/**
 * Fetches the fresh course/folder tree via the public (anon) Supabase read
 * path — the same read the manifest uses — so the move dialog lists every
 * valid destination, including courses/folders the current category view
 * doesn't render (e.g. a folder with no quizzes).
 * @returns {Promise<Array<{id, prefix, raw, parentId, title, icon}>|null>}
 */
async function fetchSharedDestinationNodes() {
  const supabase = await ensureSharedSupabaseClient();
  if (!supabase) return null;

  const [{ data: courses }, { data: folders }] = await Promise.all([
    supabase.from("courses").select("id, name, icon").order("name", { ascending: true }),
    supabase.from("folders").select("id, course_id, name, parent_folder_id").order("name", { ascending: true }),
  ]);
  if (!Array.isArray(courses) || !Array.isArray(folders)) return null;

  const nodes = [];

  // Courses are the depth-0 roots of the shared/admin tree.
  for (const course of courses) {
    nodes.push({
      id: `course:${course.id}`,
      prefix: "course",
      raw: course,
      parentId: null,
      title: course.name,
      icon: course.icon || "📚",
    });
  }

  const folderById = new Map(folders.map((f) => [f.id, f]));

  function folderParentId(folder) {
    if (folder.parent_folder_id) return `folder:${folder.parent_folder_id}`;
    return `course:${folder.course_id}`;
  }

  for (const folder of folders) {
    nodes.push({
      id: `folder:${folder.id}`,
      prefix: "folder",
      raw: folder,
      parentId: folderParentId(folder),
      title: folder.name,
      icon: folder.icon || "📁",
    });
  }

  return nodes;
}

/** True if `nodePrefix` is (transitively) under `ancestorPrefix`. */
function isFolderDescendant(nodesByPrefix, ancestorPrefix, nodePrefix) {
  let cursor = nodePrefix;
  const seen = new Set();
  while (cursor) {
    if (cursor === ancestorPrefix) return true;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const node = nodesByPrefix.get(cursor);
    if (!node || node.parentId === null) break;
    cursor = node.parentId;
  }
  return false;
}

/**
 * Builds the MoveSource adapter (see move-to-dialog.js's interface doc) for
 * the shared Supabase-backed courses+folders tree, then opens the shared
 * dialog with it. Mirrors createLocalUserQuizzesMoveSource() in
 * user-quizzes-folders.js but for DB quizzes/folders.
 *
 * Courses are never move targets (they're top-level by construction — the
 * server enforces this via canPlaceItemServer), so this dialog has no root
 * row: every destination is a course or a folder.
 * @param {object} item - quiz entry or folder node
 */
export async function openSharedMoveToDialog(item) {
  const itemType = resolveItemType(item);
  const itemId = resolveItemId(item);
  if (!itemType || itemId === null) return;

  if (itemType === "course") {
    // Courses are top-level only — nowhere to move them to (mirrors the
    // localStorage lone-course guard in createLocalUserQuizzesMoveSource).
    showNotification(
      "لا يمكن النقل",
      "المواد تبقى في المستوى الرئيسي دائماً ولا يمكن نقلها.",
      "warning",
    );
    return;
  }

  const nodes = await fetchSharedDestinationNodes();
  if (!nodes) {
    showNotification(
      "خطأ",
      "تعذّر تحميل قائمة الوجهات. حاول مرة أخرى.",
      "error",
    );
    return;
  }

  const nodesByPrefix = new Map(nodes.map((n) => [n.id, n]));
  const itemLabel = item.title || item.name
    ? `"${item.title || item.name}"`
    : "العنصر";

  // Current location of the moving item, for the "الموقع الحالي" badge.
  const currentId =
    itemType === "quiz"
      ? item.folderId
        ? `folder:${item.folderId}`
        : item.courseId
          ? `course:${item.courseId}`
          : null
      : item.parent_folder_id
        ? `folder:${item.parent_folder_id}`
        : item.course_id
          ? `course:${item.course_id}`
          : null;

  const source = {
    itemLabel,
    rootLabel: null,
    includeRoot: false,
    showNotification,

    isCurrentDestination(nodeId) {
      return (nodeId || null) === currentId;
    },

    getNodes() {
      return nodes.map((n) => ({
        id: n.id,
        parentId: n.parentId,
        title: n.title,
        icon: n.icon,
      }));
    },

    getDisabledReason(nodeId) {
      if (itemType === "quiz") return null; // any course/folder is a valid quiz destination

      // Folder moves: exclude the folder itself and its own subtree (cycle).
      const selfId = `folder:${itemId}`;
      if (nodeId === selfId) return "لا يمكن نقل مجلد إلى نفسه.";
      if (isFolderDescendant(nodesByPrefix, selfId, nodeId)) {
        return "لا يمكن نقل مجلد إلى داخل نفسه أو أحد مجلداته الفرعية.";
      }
      return null;
    },

    isFullyBlocked(nodeId) {
      if (itemType !== "folder") return false;
      const selfId = `folder:${itemId}`;
      return nodeId === selfId || isFolderDescendant(nodesByPrefix, selfId, nodeId);
    },

    async moveTo(nodeId) {
      const targetNode = nodesByPrefix.get(nodeId);
      if (!targetNode) return { moved: 0, blocked: 1 };

      // Server contract: { itemType, itemId, targetFolderId?, targetCourseId }
      const targetCourseId =
        targetNode.prefix === "course"
          ? targetNode.raw.id
          : targetNode.raw.course_id;
      const targetFolderId = targetNode.prefix === "folder" ? targetNode.raw.id : null;

      const res = await postAdminAction("move-item", {
        itemType,
        itemId,
        targetFolderId,
        targetCourseId,
      });
      return res ? { moved: 1, blocked: 0 } : { moved: 0, blocked: 1 };
    },

    async onMoved() {
      await refreshSharedArea();
    },
  };

  openMoveToDialogWithSource(source);
}
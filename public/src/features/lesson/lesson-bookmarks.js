import { registerLessonPanel } from "./lesson-panel-manager.js";

const KEY = "basmagi:lesson-bookmarks:v1";
function readAll() {
  try { const value = JSON.parse(localStorage.getItem(KEY) || "{}"); return value && typeof value === "object" ? value : {}; }
  catch { return {}; }
}
function writeAll(value) { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch (error) { console.warn("[lesson-bookmarks] Could not persist bookmarks", error); } }
export function getLessonBookmarks(lessonId) { const all = readAll(); return Array.isArray(all[lessonId]) ? all[lessonId] : []; }
export function isLessonSectionBookmarked(lessonId, sectionId) { return getLessonBookmarks(lessonId).some((item) => item.sectionId === sectionId); }
export function toggleLessonBookmark(lessonId, sectionId, title = "") {
  const all = readAll(); const items = Array.isArray(all[lessonId]) ? all[lessonId] : [];
  const index = items.findIndex((item) => item.sectionId === sectionId);
  if (index >= 0) items.splice(index, 1);
  else items.push({ sectionId, title, createdAt: new Date().toISOString() });
  all[lessonId] = items; writeAll(all); return items;
}
export function renderLessonBookmarks(lessonId) {
  const items = getLessonBookmarks(lessonId);
  return `<div class="lesson-bookmarks"><button type="button" class="lesson-bookmarks__toggle" aria-expanded="false">🔖 العلامات المرجعية (${items.length})</button><div class="lesson-bookmarks__panel" hidden>${items.length ? items.map((item) => `<div class="lesson-bookmarks__item"><button type="button" data-bookmark-jump="${escapeAttr(item.sectionId)}">${escapeText(item.title || "قسم من الدرس")}</button><button type="button" data-bookmark-remove="${escapeAttr(item.sectionId)}" aria-label="إزالة العلامة">×</button></div>`).join("") : `<p>لم تحفظ أي قسم بعد.</p>`}</div></div>`;
}
function escapeText(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]); }
function escapeAttr(value) { return escapeText(value); }
const bookmarkPanelCleanup = new WeakMap();

export function cleanupLessonBookmarks(root) {
  const cleanup = bookmarkPanelCleanup.get(root);
  if (cleanup) cleanup();
  bookmarkPanelCleanup.delete(root);
}

export function equipLessonBookmarks(root, lessonId, rerender) {
  if (!root) return () => {};
  cleanupLessonBookmarks(root);
  const toggle = root.querySelector(".lesson-bookmarks__toggle");
  const panel = root.querySelector(".lesson-bookmarks__panel");
  let panelCleanup = () => {};
  if (toggle && panel) {
    panelCleanup = registerLessonPanel({
      toggle,
      panel,
      isOpen: () => !panel.hidden,
      setOpen: (open) => {
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
      },
    });
    bookmarkPanelCleanup.set(root, panelCleanup);
  }
  root.querySelectorAll("[data-bookmark-jump]").forEach((button) => button.addEventListener("click", () => {
    const target = root.querySelector(`#lesson-section-${CSS.escape(button.dataset.bookmarkJump)}`); target?.scrollIntoView({ behavior: "smooth", block: "start" }); target?.setAttribute("tabindex", "-1"); target?.focus({ preventScroll: true });
  }));
  root.querySelectorAll("[data-bookmark-remove]").forEach((button) => button.addEventListener("click", () => { toggleLessonBookmark(lessonId, button.dataset.bookmarkRemove); rerender?.(); }));
  root.querySelectorAll("[data-bookmark-toggle]").forEach((button) => button.addEventListener("click", () => {
    const section = button.closest(".lesson-section"); const title = section?.querySelector(".lesson-section__title")?.textContent || "قسم من الدرس";
    toggleLessonBookmark(lessonId, button.dataset.bookmarkToggle, title); rerender?.();
  }));
  return () => cleanupLessonBookmarks(root);
}

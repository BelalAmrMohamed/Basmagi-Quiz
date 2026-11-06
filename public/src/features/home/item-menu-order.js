// ============================================================================
// public/src/features/home/item-menu-order.js
// ONE fixed order for every item ⋮ dropdown (quiz, lesson, notebook, folder,
// course — platform and "محتواي" alike), so the same action always sits in the
// same place regardless of the item type:
//
//   admin-upload → primary (mobile تحميل) → نسخ إلى محتواي → معلومات → اسأل
//   → نسخ الرابط → مشاركة الرابط → نسخ كود التضمين → [other]
//   ── divider ──
//   تحديد → تعديل → نقل → إدارة → حذف / إلغاء الاشتراك
//
// Rows that don't apply to a type are simply absent; the rest keep their
// relative position. openItemDropdownMenu() calls orderItemMenu() after a
// builder runs, so individual builders never have to care about ordering.
// Pure helpers (slotForLabel / orderSlots) are unit-tested.
// ============================================================================

export const MENU_SLOTS = [
  "admin-upload", "primary", "copy-mine", "info", "ask",
  "copy-link", "share", "embed", "other",
  "select", "edit", "move", "manage", "delete",
];

/** Slots that start the "management zone" (everything after the divider). */
const MANAGEMENT_SLOTS = new Set(["select", "edit", "move", "manage", "delete"]);

const RULES = [
  [/^رفع\s/, "admin-upload"],
  [/^تحميل/, "primary"],
  [/نسخ إلى محتواي/, "copy-mine"],
  [/^معلومات/, "info"],
  [/اسأل/, "ask"],
  [/^نسخ الرابط/, "copy-link"],
  [/^مشاركة/, "share"],
  [/كود التضمين/, "embed"],
  [/^تحديد/, "select"],
  [/^تعديل/, "edit"],
  [/^نقل/, "move"],
  [/^إدارة/, "manage"],
  [/^(حذف|إلغاء الإشتراك|إلغاء الاشتراك)/, "delete"],
];

/** Maps a visible menu label to its slot name ("other" when unknown). */
export function slotForLabel(label) {
  const text = String(label || "").replace(/\s+/g, " ").trim();
  for (const [re, slot] of RULES) if (re.test(text)) return slot;
  return "other";
}

/**
 * Pure: given labels in their current order, returns the indexes in the final
 * order plus where the divider goes (index into the returned array, or -1).
 */
export function orderSlots(labels) {
  const ranked = labels.map((label, index) => {
    const slot = slotForLabel(label);
    return { index, slot, rank: MENU_SLOTS.indexOf(slot) };
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const firstManagement = ranked.findIndex((r) => MANAGEMENT_SLOTS.has(r.slot));
  return {
    order: ranked.map((r) => r.index),
    dividerBefore: firstManagement > 0 ? firstManagement : -1,
  };
}

function labelOf(el) {
  const button = el.matches?.("button") ? el : el.querySelector?.("button");
  return (button?.textContent || el.textContent || "").trim();
}

/** Re-orders a built dropdown's children in place and (re)places the divider. */
export function orderItemMenu(menu) {
  if (menu.dataset?.unordered === "1") return; // builder opted out (create / root menus)
  const items = Array.from(menu.children).filter((el) => !el.classList.contains("exam-action-divider"));
  if (items.length < 2) return;
  const { order, dividerBefore } = orderSlots(items.map(labelOf));
  const sorted = order.map((i) => items[i]);
  menu.querySelectorAll(":scope > .exam-action-divider").forEach((d) => d.remove());
  const frag = document.createDocumentFragment();
  sorted.forEach((el, i) => {
    if (i === dividerBefore) {
      const divider = document.createElement("div");
      divider.className = "exam-action-divider";
      frag.appendChild(divider);
    }
    frag.appendChild(el);
  });
  menu.appendChild(frag);
}

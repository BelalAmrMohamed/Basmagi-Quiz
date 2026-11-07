// ============================================================================
// public/src/features/home/card-type.js
// Visual identity per item type, shared by every card on the platform and in
// «محتواي». The emoji icon is hidden on desktop, so each card also carries a
// small type chip and a data-item-type attribute that the CSS uses for the
// border, accent strip and button colours (see card-types.css).
// ============================================================================

export const ITEM_TYPES = {
  quiz: { label: "امتحان", emoji: "📝" },
  lesson: { label: "درس", emoji: "📘" },
  notebook: { label: "دفتر", emoji: "💻" },
};

/** Tags a card element with its item type (drives card-types.css). */
export function tagCardType(card, kind) {
  if (card && ITEM_TYPES[kind]) card.dataset.itemType = kind;
  return card;
}

/**
 * Small chip shown at the top of a card, e.g. "💻 دفتر · MATLAB".
 * `detail` is optional extra text (the notebook runtime).
 */
export function createTypeChip(kind, detail = "") {
  const type = ITEM_TYPES[kind];
  const chip = document.createElement("span");
  chip.className = `item-type-chip item-type-chip--${kind}`;
  chip.setAttribute("aria-hidden", "true"); // the card's aria-label already names the type
  chip.textContent = `${type?.emoji || ""} ${type?.label || ""}${detail ? ` · ${detail}` : ""}`.trim();
  return chip;
}

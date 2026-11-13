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

/**
 * Cards v2 (cards-v2.css): every item card carries a `.shape` span — the
 * silhouette layer (manila folder / ticket / dog-eared page / spiral notebook)
 * that the CSS paints behind the content — and a `data-card-kind` the CSS keys
 * on. Notebook cards also get the "In [ ]:" gutter. Call once, right before the
 * builder returns the card. kind: "folder" | "quiz" | "lesson" | "notebook".
 */
export function addCardShape(card, kind) {
  if (!card || !kind) return card;
  card.dataset.cardKind = kind;
  if (card.querySelector(":scope > .shape")) return card;
  const shape = document.createElement("span");
  shape.className = "shape";
  shape.setAttribute("aria-hidden", "true");
  card.prepend(shape);
  if (kind === "notebook") {
    const gut = document.createElement("div");
    gut.className = "gut";
    gut.setAttribute("dir", "ltr");
    gut.setAttribute("aria-hidden", "true");
    gut.innerHTML = '<span>In [ ]:</span><span class="kdot"></span>';
    shape.after(gut);
  }
  return card;
}

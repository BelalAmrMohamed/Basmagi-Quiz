const ITEM_CARD_PREFIX = "[PLATFORM_ITEM_CARD]";
const FLASHCARD_DECK_PREFIX = "[FLASHCARD_DECK]";

export function createItemCardResult(item) {
  return `${ITEM_CARD_PREFIX}${JSON.stringify(item)}`;
}

export function createFlashcardDeckResult(deck) {
  return `${FLASHCARD_DECK_PREFIX}${JSON.stringify(deck)}`;
}

function parseResult(value, prefix) {
  if (typeof value !== "string" || !value.startsWith(prefix)) return null;
  try {
    return JSON.parse(value.slice(prefix.length));
  } catch {
    return null;
  }
}

export function platformItemCardModelSummary(value) {
  const item = parseResult(value, ITEM_CARD_PREFIX);
  if (!item) return value;
  const names = { quiz: "الامتحان", lesson: "الدرس", folder: "المجلد", course: "المادة" };
  return `تم إنشاء ${names[item.kind] || "العنصر"} «${item.title || "بدون عنوان"}» وإضافته إلى مكتبة المستخدم.`;
}

export function flashcardDeckModelSummary(value) {
  const deck = parseResult(value, FLASHCARD_DECK_PREFIX);
  if (!deck) return value;
  const count = Array.isArray(deck.cards) ? deck.cards.length : 0;
  return `تم عرض ${count} بطاقة مراجعة تفاعلية بعنوان «${deck.title || "بطاقات الدرس"}» داخل المحادثة.`;
}

export function renderPlatformItemCard(value) {
  const item = parseResult(value, ITEM_CARD_PREFIX);
  if (!item || !["quiz", "lesson", "folder", "course"].includes(item.kind)) return null;

  const iconByKind = { quiz: "✦", lesson: "▤", folder: "▰", course: "◈" };
  const labelByKind = { quiz: "امتحان جديد", lesson: "درس جديد", folder: "مجلد جديد", course: "مادة جديدة" };
  const actionByKind = { quiz: "ابدأ الامتحان", lesson: "افتح الدرس", folder: "افتح المجلد", course: "افتح المادة" };
  const card = document.createElement("article");
  card.className = `ai-agent-created-item ai-agent-created-item--${item.kind}`;
  card.dir = "rtl";

  const top = document.createElement("div");
  top.className = "ai-agent-created-item-topline";
  const badge = document.createElement("span");
  badge.className = "ai-agent-created-item-badge";
  badge.textContent = labelByKind[item.kind];
  const check = document.createElement("span");
  check.className = "ai-agent-created-item-check";
  check.setAttribute("aria-label", "تم الحفظ بنجاح");
  check.textContent = "✓";
  top.append(badge, check);

  const body = document.createElement("div");
  body.className = "ai-agent-created-item-body";
  const icon = document.createElement("span");
  icon.className = "ai-agent-created-item-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = iconByKind[item.kind];
  const copy = document.createElement("div");
  copy.className = "ai-agent-created-item-copy";
  const title = document.createElement("h3");
  title.textContent = item.title || "عنصر بدون عنوان";
  const detail = document.createElement("p");
  detail.textContent = item.detail || "أُضيف إلى مكتبتك وجاهز للاستخدام.";
  copy.append(title, detail);
  body.append(icon, copy);

  const footer = document.createElement("div");
  footer.className = "ai-agent-created-item-footer";
  const destination = document.createElement("span");
  destination.className = "ai-agent-created-item-destination";
  destination.textContent = item.destination || "مكتبتك التعليمية";
  footer.appendChild(destination);
  if (item.href) {
    const link = document.createElement("a");
    link.className = "ai-agent-created-item-action";
    link.href = item.href;
    link.textContent = actionByKind[item.kind];
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "←";
    link.appendChild(arrow);
    footer.appendChild(link);
  }

  card.append(top, body, footer);
  return card;
}

export function renderFlashcardDeck(value) {
  const deck = parseResult(value, FLASHCARD_DECK_PREFIX);
  const cards = Array.isArray(deck?.cards)
    ? deck.cards.map((card) => ({
      question: String(card?.question || "").trim().slice(0, 1200),
      answer: String(card?.answer || "").trim().slice(0, 2000),
    })).filter((card) => card.question && card.answer).slice(0, 30)
    : [];
  if (!deck || !cards.length) return null;

  const section = document.createElement("section");
  section.className = "ai-agent-flashcard-deck";
  section.dir = "rtl";
  section.setAttribute("aria-label", `بطاقات مراجعة: ${String(deck.title || "بطاقات الدرس")}`);

  const header = document.createElement("header");
  header.className = "ai-agent-flashcard-deck-header";
  const headingWrap = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "ai-agent-flashcard-deck-eyebrow";
  eyebrow.textContent = "مراجعة تفاعلية";
  const title = document.createElement("h3");
  title.textContent = String(deck.title || "بطاقات من هذا الدرس").slice(0, 140);
  headingWrap.append(eyebrow, title);
  const count = document.createElement("span");
  count.className = "ai-agent-flashcard-deck-count";
  count.textContent = `${cards.length} ${cards.length === 1 ? "بطاقة" : "بطاقات"}`;
  header.append(headingWrap, count);

  const grid = document.createElement("div");
  grid.className = "ai-agent-flashcard-grid";
  cards.forEach((data, index) => {
    const flip = document.createElement("button");
    flip.type = "button";
    flip.className = "ai-agent-flashcard";
    flip.setAttribute("aria-pressed", "false");
    flip.setAttribute("aria-label", `البطاقة ${index + 1}: اعرض الإجابة`);

    const inner = document.createElement("span");
    inner.className = "ai-agent-flashcard-inner";
    const front = document.createElement("span");
    front.className = "ai-agent-flashcard-face ai-agent-flashcard-front";
    const frontLabel = document.createElement("span");
    frontLabel.className = "ai-agent-flashcard-label";
    frontLabel.textContent = `السؤال ${String(index + 1).padStart(2, "0")}`;
    const question = document.createElement("span");
    question.className = "ai-agent-flashcard-text";
    question.textContent = data.question;
    question.dir = "auto";
    const flipHint = document.createElement("span");
    flipHint.className = "ai-agent-flashcard-hint";
    flipHint.textContent = "اضغط لعرض الإجابة · ↻";
    front.append(frontLabel, question, flipHint);

    const back = document.createElement("span");
    back.className = "ai-agent-flashcard-face ai-agent-flashcard-back";
    back.setAttribute("aria-hidden", "true");
    const backLabel = document.createElement("span");
    backLabel.className = "ai-agent-flashcard-label";
    backLabel.textContent = "الإجابة";
    const answer = document.createElement("span");
    answer.className = "ai-agent-flashcard-text";
    answer.textContent = data.answer;
    answer.dir = "auto";
    const backHint = document.createElement("span");
    backHint.className = "ai-agent-flashcard-hint";
    backHint.textContent = "اضغط للعودة إلى السؤال · ↻";
    back.append(backLabel, answer, backHint);
    inner.append(front, back);
    flip.appendChild(inner);
    flip.addEventListener("click", () => {
      const isFlipped = flip.classList.toggle("is-flipped");
      flip.setAttribute("aria-pressed", String(isFlipped));
      flip.setAttribute("aria-label", `البطاقة ${index + 1}: ${isFlipped ? "اعرض السؤال" : "اعرض الإجابة"}`);
      front.setAttribute("aria-hidden", String(isFlipped));
      back.setAttribute("aria-hidden", String(!isFlipped));
      front.toggleAttribute("inert", isFlipped);
      back.toggleAttribute("inert", !isFlipped);
    });
    grid.appendChild(flip);
  });

  const note = document.createElement("p");
  note.className = "ai-agent-flashcard-deck-note";
  note.textContent = "اضغط على أي بطاقة لتقلبها. هذه البطاقات للمراجعة ولا تُحفظ ضمن امتحاناتك.";
  section.append(header, grid, note);
  return section;
}

export function resultCardModelSummary(value) {
  return platformItemCardModelSummary(value) !== value
    ? platformItemCardModelSummary(value)
    : flashcardDeckModelSummary(value);
}

export function renderResultCard(value) {
  return renderPlatformItemCard(value) || renderFlashcardDeck(value);
}

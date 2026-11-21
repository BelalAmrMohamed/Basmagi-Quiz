import { ATTACHMENT_KIND_LABEL_AR, ATTACHMENT_NOTEBOOK_ICON_SVG, ATTACHMENT_YOUTUBE_ICON_SVG } from "./core/chat-attachments.js";

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
  const names = { quiz: "الامتحان", lesson: "الدرس", notebook: "الدفتر", folder: "المجلد", course: "المادة" };
  if (item.kind === "youtube_video" || item.kind === "youtube_playlist") {
    const noun = item.kind === "youtube_video" ? "الفيديو" : "قائمة التشغيل";
    return `تمت إضافة ${noun} «${item.title || "بدون عنوان"}» إلى مكتبة المستخدم، وظهرت بطاقة تفتحه في المحادثة.`;
  }
  return `تم إنشاء ${names[item.kind] || "العنصر"} «${item.title || "بدون عنوان"}» وإضافته إلى مكتبة المستخدم.`;
}

export function flashcardDeckModelSummary(value) {
  const deck = parseResult(value, FLASHCARD_DECK_PREFIX);
  if (!deck) return value;
  const count = Array.isArray(deck.cards) ? deck.cards.length : 0;
  return `تم عرض ${count} بطاقة مراجعة تفاعلية بعنوان «${deck.title || "بطاقات الدرس"}» داخل المحادثة.`;
}

// Stroke icons (24x24, currentColor). Static strings: never built from model output.
const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ITEM_KIND_ICONS = {
  // clipboard with a check: an exam
  quiz: svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>'),
  // open book: a lesson
  lesson: svg('<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>'),
  // notebook / YouTube: the same icons the attachment chips use
  notebook: ATTACHMENT_NOTEBOOK_ICON_SVG,
  youtube_video: ATTACHMENT_YOUTUBE_ICON_SVG,
  youtube_playlist: ATTACHMENT_YOUTUBE_ICON_SVG,
  // folder
  folder: svg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>'),
  // graduation cap: a course
  course: svg('<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/><path d="M22 10v6"/>'),
};
const LINK_ARROW_ICON = svg('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>');

const CARD_KINDS = ["quiz", "lesson", "notebook", "folder", "course", "youtube_video", "youtube_playlist"];

async function openYoutubeItem(item) {
  try {
    const { findLibraryItem } = await import("../../features/home/youtube-library.js");
    const entry = findLibraryItem(item.id);
    if (!entry) {
      const { showNotification } = await import("../notifications/notifications.js");
      showNotification("غير موجود", "لم يعد هذا العنصر في «محتواي».", "warning", 6);
      return;
    }
    if (item.kind === "youtube_playlist") {
      const { openYoutubePlaylistWindow } = await import("../../features/home/youtube-playlist-window.js");
      openYoutubePlaylistWindow(entry);
    } else {
      const { openYoutubeVideoPlayer } = await import("../../features/home/youtube-player-window.js");
      openYoutubeVideoPlayer(entry);
    }
  } catch (err) {
    console.error("[ai-agent] failed to open YouTube item", err);
  }
}

/**
 * Compact one-row card: [icon] [title / label] [link].
 * Rendered in a group below the response text (see appendResultCardsGroup in
 * ai-agent-chat.js), never inline between the tool cards and the answer.
 */
export function renderPlatformItemCard(value) {
  const item = parseResult(value, ITEM_CARD_PREFIX);
  if (!item || !CARD_KINDS.includes(item.kind)) return null;

  const labelByKind = {
    quiz: "امتحان جديد", lesson: "درس جديد", notebook: "دفتر جديد", folder: "مجلد جديد", course: "مادة جديدة",
    youtube_video: ATTACHMENT_KIND_LABEL_AR.youtube_video, youtube_playlist: ATTACHMENT_KIND_LABEL_AR.youtube_playlist,
  };
  const actionByKind = {
    quiz: "ابدأ الامتحان", lesson: "افتح الدرس", notebook: "افتح الدفتر", folder: "افتح المجلد", course: "افتح المادة",
    youtube_video: "شغّل الفيديو", youtube_playlist: "افتح القائمة",
  };
  const isYoutube = item.kind === "youtube_video" || item.kind === "youtube_playlist";
  const card = document.createElement("article");
  card.className = `ai-agent-created-item ai-agent-created-item--${item.kind}`;
  card.dir = "rtl";

  const icon = document.createElement("span");
  icon.className = "ai-agent-created-item-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = ITEM_KIND_ICONS[item.kind];

  const copy = document.createElement("div");
  copy.className = "ai-agent-created-item-copy";
  const title = document.createElement("h3");
  title.className = "ai-agent-created-item-title";
  title.dir = "auto";
  title.textContent = item.title || "عنصر بدون عنوان";
  title.title = title.textContent;
  const label = document.createElement("span");
  label.className = "ai-agent-created-item-label";
  label.textContent = labelByKind[item.kind];
  copy.append(title, label);

  card.append(icon, copy);

  if (isYoutube && item.id) {
    // YouTube items open in their floating window (no route), loaded on demand.
    const open = document.createElement("button");
    open.type = "button";
    open.className = "ai-agent-created-item-action";
    open.addEventListener("click", () => { void openYoutubeItem(item); });
    const text = document.createElement("span");
    text.textContent = actionByKind[item.kind];
    open.appendChild(text);
    open.insertAdjacentHTML("beforeend", LINK_ARROW_ICON);
    card.appendChild(open);
  } else if (item.href) {
    // A button, not an <a href>: items the agent creates live only in this
    // browser (محتواي), so there must be no copyable/shareable link to them.
    const link = document.createElement("button");
    link.type = "button";
    link.className = "ai-agent-created-item-action";
    link.addEventListener("click", () => { window.location.href = item.href; });
    const text = document.createElement("span");
    text.textContent = actionByKind[item.kind];
    link.appendChild(text);
    link.insertAdjacentHTML("beforeend", LINK_ARROW_ICON);
    card.appendChild(link);
  }

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
  note.textContent = "اضغط على أي بطاقة لتقلبها. هذه البطاقات للمراجعة ولا تُحفظ ضمن محتواي.";
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

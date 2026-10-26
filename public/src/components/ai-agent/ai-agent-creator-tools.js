// Read-only creator profile tools for the home chat. Keep these details in
// sync with public/about.html; the card renderer consumes a small typed
// payload and builds its DOM without injecting model-controlled HTML.
export const CREATOR_TOOL_NAMES = ["get_creator_info", "display_creator_card"];

const CREATOR = {
  name: "بلال عمرو محمد",
  image: "/assets/images/developer.jpg",
  portfolioImage: "/assets/images/portfolio-thumbnail.jpg",
  description: "مطور منصة بصمجي ومهتم ببناء أدوات عربية عملية للتعلم وإنشاء المحتوى.",
  portfolio: "https://belal-amr.vercel.app/",
  platformProfile: "https://basmagi-quiz.vercel.app/@belalamrofficial",
  youtube: "https://www.youtube.com/@طالب-حاسبات",
  github: "https://github.com/BelalAmrMohamed/",
  mostaql: "https://mostaql.com/u/BelalAmrMohamed/portfolio",
  upwork: "https://www.upwork.com/freelancers/~0169eeff3e0d6045d8?mp_source=share",
  email: "belalamrofficial@gmail.com",
  whatsapp: "https://wa.me/201118482193",
  telegram: "https://t.me/BelalAmrMohamed",
};

const CARD_PREFIX = "[CREATOR_CARD]";

export function isCreatorCardResult(value) {
  return typeof value === "string" && value.startsWith(CARD_PREFIX);
}

export function parseCreatorCardResult(value) {
  if (!isCreatorCardResult(value)) return null;
  try {
    return JSON.parse(value.slice(CARD_PREFIX.length));
  } catch {
    return null;
  }
}

export function creatorCardModelSummary(value) {
  const card = parseCreatorCardResult(value);
  return card ? `تم عرض بطاقة تفاعلية لمعلومات ${CREATOR.name} داخل المحادثة.` : value;
}

export function handleCreatorToolCall(toolCall) {
  if (toolCall?.name === "get_creator_info") {
    return `معلومات مطوّر بصمجي:\nالاسم: ${CREATOR.name}\nنبذة: ${CREATOR.description}\nالموقع الشخصي: ${CREATOR.portfolio}\nالملف الشخصي على بصمجي: ${CREATOR.platformProfile}\nيوتيوب: ${CREATOR.youtube}\nGitHub: ${CREATOR.github}\nمستقل: ${CREATOR.mostaql}\nUpwork: ${CREATOR.upwork}\nالبريد: ${CREATOR.email}\nواتساب: ${CREATOR.whatsapp}\nتيليجرام: ${CREATOR.telegram}`;
  }

  if (toolCall?.name === "display_creator_card") {
    const section = ["all", "portfolio", "social", "contact"].includes(toolCall.input?.section)
      ? toolCall.input.section
      : "all";
    return `${CARD_PREFIX}${JSON.stringify({ section })}`;
  }

  const err = new Error(`Unknown creator tool: ${toolCall?.name}`);
  err.userMessage = "تعذر عرض معلومات المطوّر.";
  throw err;
}

/** Render a curated creator card. All text and hrefs come from CREATOR. */
export function renderCreatorCard(value) {
  const payload = parseCreatorCardResult(value);
  if (!payload) return null;
  const section = payload.section;
  const card = document.createElement("section");
  card.className = "ai-agent-creator-card";
  card.setAttribute("aria-label", `معلومات ${CREATOR.name}`);

  const header = document.createElement("div");
  header.className = "ai-agent-creator-card-header";
  const photo = document.createElement("img");
  photo.src = CREATOR.image;
  photo.alt = CREATOR.name;
  photo.width = 58;
  photo.height = 58;
  photo.loading = "lazy";
  const identity = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = CREATOR.name;
  const description = document.createElement("p");
  description.textContent = CREATOR.description;
  identity.append(name, description);
  header.append(photo, identity);
  card.appendChild(header);

  const links = document.createElement("div");
  links.className = "ai-agent-creator-card-links";
  const addLink = (label, href, image = "") => {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", label);
    if (image) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = "";
      img.loading = "lazy";
      link.appendChild(img);
    }
    const text = document.createElement("span");
    text.textContent = label;
    link.appendChild(text);
    links.appendChild(link);
  };

  if (section === "all" || section === "portfolio") {
    addLink("الموقع الشخصي ومعرض الأعمال", CREATOR.portfolio, CREATOR.portfolioImage);
    addLink("الملف الشخصي على بصمجي", CREATOR.platformProfile);
    addLink("مستقل", CREATOR.mostaql);
    addLink("Upwork", CREATOR.upwork);
  }
  if (section === "all" || section === "social") {
    addLink("قناة يوتيوب", CREATOR.youtube);
    addLink("GitHub", CREATOR.github);
  }
  if (section === "all" || section === "contact") {
    addLink(`البريد الإلكتروني · ${CREATOR.email}`, `mailto:${CREATOR.email}`);
    addLink("واتساب", CREATOR.whatsapp);
    addLink("تيليجرام", CREATOR.telegram);
  }
  card.appendChild(links);
  return card;
}

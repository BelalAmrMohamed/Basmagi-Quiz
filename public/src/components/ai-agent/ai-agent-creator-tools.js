// Read-only creator profile tools for the home chat. Keep these details in
// sync with public/about.html; the card renderer consumes a small typed
// payload and builds its DOM without injecting model-controlled HTML.
export const CREATOR_TOOL_NAMES = ["get_creator_info", "display_creator_card"];

const CREATOR = {
  name: "بلال عمرو محمد",
  image: "/assets/images/developer.jpg",
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

const LINK_ICONS = {
  portfolio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4 10 14"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg>',
  basmagi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m8 10 4-2 4 2v5l-4 2-4-2v-5Z"/><path d="m8 10 4 2 4-2M12 12v5"/></svg>',
  mostaql: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 17.5V8.25A3.25 3.25 0 0 1 8.75 5h6.5a3.25 3.25 0 0 1 3.25 3.25v1.5A3.25 3.25 0 0 1 15.25 13h-5.5"/><path d="M5.5 15.5h6.75"/></svg>',
  upwork: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5v5a3.25 3.25 0 0 0 6.5 0v-5"/><path d="M10.5 12.5c1.3-2.4 2.8-4 5.25-4A4.25 4.25 0 1 1 11.5 13"/><path d="M18.75 11.5v6"/><path d="M4 18.5h4.75"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="4"/><path d="m10 9 5 3-5 3V9Z"/></svg>',
  github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.14.68-3.8-1.34-3.8-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.7 2.63 1.2 3.27.92.1-.72.4-1.2.72-1.48-2.51-.29-5.15-1.26-5.15-5.61 0-1.24.44-2.25 1.16-3.04-.12-.29-.51-1.44.11-3 0 0 .95-.3 3.1 1.16a10.75 10.75 0 0 1 5.64 0c2.16-1.46 3.1-1.16 3.1-1.16.62 1.56.23 2.71.11 3 .73.79 1.16 1.8 1.16 3.04 0 4.36-2.65 5.32-5.17 5.6.4.35.76 1.03.76 2.08v3.1c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z"/></svg>',
  email: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.02 2.1a9.7 9.7 0 0 0-8.3 14.72L2.3 21.9l5.2-1.37A9.7 9.7 0 1 0 12.02 2.1Zm0 17.6h-.01a7.9 7.9 0 0 1-4.02-1.1l-.29-.17-3.09.81.83-3.01-.19-.31a7.9 7.9 0 1 1 6.77 3.78Zm4.34-5.92c-.24-.12-1.45-.72-1.67-.8-.22-.08-.39-.12-.56.12-.17.24-.64.8-.79.96-.14.16-.29.18-.53.06-.24-.12-1.03-.38-1.96-1.22-.73-.65-1.22-1.45-1.37-1.7-.14-.24-.02-.37.11-.49.11-.11.24-.29.37-.43.12-.14.16-.24.24-.4.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.76-1.85-.2-.48-.4-.41-.56-.42h-.48c-.16 0-.43.06-.65.3-.22.24-.85.83-.85 2.03s.87 2.36.99 2.52c.12.16 1.71 2.62 4.14 3.67.58.25 1.03.4 1.38.52.58.18 1.1.16 1.51.1.46-.07 1.45-.59 1.65-1.16.2-.58.2-1.07.14-1.17-.06-.1-.22-.16-.46-.28Z"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 4-3.2 16-6.1-4.5-3.2 3.1.5-5.2L19 6 7.3 12.7 3 11.2 21 4Z"/></svg>',
};

const LINK_GROUPS = {
  portfolio: {
    title: "المشاريع والعمل",
    links: [
      { label: "الموقع الشخصي", detail: "معرض الأعمال والمشاريع", href: CREATOR.portfolio, icon: "portfolio" },
      { label: "بصمجي", detail: "الملف الشخصي على المنصة", href: CREATOR.platformProfile, icon: "basmagi" },
      { label: "مستقل", detail: "الملف الشخصي للأعمال الحرة", href: CREATOR.mostaql, icon: "mostaql" },
      { label: "Upwork", detail: "الملف الشخصي للأعمال الحرة", href: CREATOR.upwork, icon: "upwork" },
    ],
  },
  social: {
    title: "تابع العمل",
    links: [
      { label: "YouTube", detail: "قناة طالب حاسبات", href: CREATOR.youtube, icon: "youtube" },
      { label: "GitHub", detail: "المشاريع البرمجية", href: CREATOR.github, icon: "github" },
    ],
  },
  contact: {
    title: "تواصل مباشر",
    links: [
      { label: "البريد الإلكتروني", detail: CREATOR.email, href: `mailto:${CREATOR.email}`, icon: "email" },
      { label: "WhatsApp", detail: "راسلني مباشرة", href: CREATOR.whatsapp, icon: "whatsapp" },
      { label: "Telegram", detail: "ابدأ محادثة", href: CREATOR.telegram, icon: "telegram" },
    ],
  },
};

/** Render a curated creator card. All text and hrefs come from CREATOR. */
export function renderCreatorCard(value) {
  const payload = parseCreatorCardResult(value);
  if (!payload) return null;
  const requestedSection = payload.section;
  const section = ["all", "portfolio", "social", "contact"].includes(requestedSection) ? requestedSection : "all";
  const card = document.createElement("section");
  card.className = "ai-agent-creator-card";
  card.setAttribute("aria-label", `بطاقة ${CREATOR.name} التعريفية`);
  card.dir = "rtl";

  const hero = document.createElement("header");
  hero.className = "ai-agent-creator-card-hero";
  const avatarFrame = document.createElement("div");
  avatarFrame.className = "ai-agent-creator-card-avatar-frame";
  const photo = document.createElement("img");
  photo.src = CREATOR.image;
  photo.alt = CREATOR.name;
  photo.width = 76;
  photo.height = 76;
  photo.loading = "lazy";
  avatarFrame.appendChild(photo);

  const identity = document.createElement("div");
  identity.className = "ai-agent-creator-card-identity";
  const eyebrow = document.createElement("span");
  eyebrow.className = "ai-agent-creator-card-eyebrow";
  eyebrow.textContent = "الشخص خلف بصمجي";
  const name = document.createElement("h3");
  name.textContent = CREATOR.name;
  const description = document.createElement("p");
  description.textContent = CREATOR.description;
  identity.append(eyebrow, name, description);
  hero.append(avatarFrame, identity);

  const groups = document.createElement("div");
  groups.className = "ai-agent-creator-card-groups";
  const groupNames = section === "all" ? ["portfolio", "social", "contact"] : [section];
  for (const groupName of groupNames) {
    const groupData = LINK_GROUPS[groupName];
    if (!groupData) continue;
    const group = document.createElement("section");
    group.className = `ai-agent-creator-card-group ai-agent-creator-card-group--${groupName}`;
    const heading = document.createElement("h4");
    heading.textContent = groupData.title;
    const links = document.createElement("div");
    links.className = "ai-agent-creator-card-links";
    for (const item of groupData.links) {
      const link = document.createElement("a");
      link.href = item.href;
      link.target = item.href.startsWith("mailto:") ? "_self" : "_blank";
      link.rel = "noopener noreferrer";
      link.className = `ai-agent-creator-card-link ai-agent-creator-card-link--${item.icon}`;
      link.setAttribute("aria-label", `${item.label}: ${item.detail}`);

      const icon = document.createElement("span");
      icon.className = "ai-agent-creator-card-link-icon";
      if (item.icon === "basmagi") {
        const logo = document.createElement("img");
        logo.src = "/assets/images/icon-192.png";
        logo.alt = "";
        logo.width = 22;
        logo.height = 22;
        icon.appendChild(logo);
      } else {
        icon.innerHTML = LINK_ICONS[item.icon];
      }
      const copy = document.createElement("span");
      copy.className = "ai-agent-creator-card-link-copy";
      const label = document.createElement("strong");
      label.textContent = item.label;
      const detail = document.createElement("small");
      detail.textContent = item.detail;
      const arrow = document.createElement("span");
      arrow.className = "ai-agent-creator-card-link-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      copy.append(label, detail);
      link.append(icon, copy, arrow);
      links.appendChild(link);
    }
    group.append(heading, links);
    groups.appendChild(group);
  }

  const footer = document.createElement("div");
  footer.className = "ai-agent-creator-card-footer";
  footer.innerHTML = '<span class="ai-agent-creator-card-footer-mark" aria-hidden="true">✦</span><span>أدوات عربية عملية للتعلّم وصناعة المحتوى</span>';
  card.append(hero, groups, footer);
  return card;
}

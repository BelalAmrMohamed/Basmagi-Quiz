// =============================================================================
// api/render-ai-agent.js
//
// Serves /ai-agent and /my-content/ai-agent (see vercel.json rewrites).
//
// These URLs are the normal SPA shell (public/index.html): the client reads
// the pathname, renders «محتواي» and opens الباشــمبصمج maximized (see
// public/src/components/ai-agent/ai-agent-route.js). The only thing this
// function changes is the <head> metadata, so link previews (WhatsApp,
// Telegram, X, Facebook, ...) — which never run JS — show the agent's own
// title, description and thumbnail instead of the generic home-page ones.
// =============================================================================

import fs from "fs";
import path from "path";

const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://basmagi-quiz.vercel.app";
const TEMPLATE_PATH = path.join(process.cwd(), "public", "index.html");

const PAGE_URL = `${SITE_ORIGIN}/ai-agent`;
const TITLE = "الباشــمبصمج | منصة امتحانات بصمجي";
const OG_TITLE = "الباشــمبصمج: مساعدك الذكي لإنشاء وتنظيم الامتحانات والدروس";
const DESCRIPTION =
  "الباشــمبصمج هو المساعد الذكي في منصة امتحانات بصمجي: يكتب لك الامتحانات والدروس، وينظّم محتواك في مجلدات، ويجاوب على أسئلتك.";
// Keep in sync with the asset in public/assets/images/thumbnails (1200x630).
const IMAGE = `${SITE_ORIGIN}/assets/images/thumbnails/ai-agent-thumbnail.png?v=3`;
const IMAGE_ALT = "الباشــمبصمج — مساعد منصة امتحانات بصمجي الذكي";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let templateCache = null;
function loadTemplate() {
  if (templateCache === null) templateCache = fs.readFileSync(TEMPLATE_PATH, "utf8");
  return templateCache;
}

// Replaces the content="" of the first <meta> whose attribute matches, or adds
// the tag before </head> when the template doesn't have it.
function setMeta(html, attr, key, value) {
  const tag = `<meta ${attr}="${key}" content="${esc(value)}">`;
  const re = new RegExp(`<meta\\s+[^>]*${attr}=["']${key}["'][^>]*>`, "i");
  return re.test(html) ? html.replace(re, () => tag) : html.replace("</head>", () => `    ${tag}\n</head>`);
}

export function renderAIAgentHtml(html) {
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${esc(TITLE)}</title>`);
  out = out.replace(/<link\s+rel=["']canonical["'][^>]*>/i, () => `<link rel="canonical" href="${PAGE_URL}">`);
  const metas = [
    ["name", "description", DESCRIPTION],
    ["property", "og:url", PAGE_URL],
    ["property", "og:title", OG_TITLE],
    ["property", "og:description", DESCRIPTION],
    ["property", "og:image", IMAGE],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", IMAGE_ALT],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", OG_TITLE],
    ["name", "twitter:description", DESCRIPTION],
    ["name", "twitter:image", IMAGE],
    ["name", "twitter:image:alt", IMAGE_ALT],
  ];
  for (const [attr, key, value] of metas) out = setMeta(out, attr, key, value);
  return out;
}

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
  let html;
  try {
    html = renderAIAgentHtml(loadTemplate());
  } catch (err) {
    console.error("[render-ai-agent] could not build page:", err);
    return res.redirect(302, "/my-content");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Same shell for everyone; let the CDN hold it briefly but always revalidate.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
  return res.status(200).send(html);
}

// =============================================================================
// api/render-profile.js
// =============================================================================

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const TEMPLATE_PATH = path.join(process.cwd(), "public", "profile.html");
const SITE_ORIGIN = "https://basmagi-quiz.vercel.app";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).end();
  }

  const handle = req.query.handle;
  if (!handle || typeof handle !== "string" || handle.trim() === "") {
    return res.redirect(302, "/");
  }

  const cleanHandle = handle.trim();

  // NOTE: use case-insensitive matching here, same as admin-stats.js and
  // auth.js. A plain `.eq()` previously caused this route to silently
  // 302-redirect to /profile.html for handles that didn't match on exact
  // case/whitespace, which looked like "the profile doesn't exist" to
  // visitors even though the account and handle were both valid.
  const normalizedHandle = cleanHandle.toLowerCase().replace(/[%_\\]/g, "\\$&");

  // Fetch admin metadata
  const { data: adminData, error } = await supabase
    .from("admin_users")
    .select("display_name, handle")
    .ilike("handle", normalizedHandle)
    .maybeSingle();

  // TEMP DIAGNOSTIC — remove once the redirect issue is confirmed fixed.
  console.log("[render-profile] lookup", {
    rawHandle: handle,
    cleanHandle,
    normalizedHandle,
    found: !!adminData,
    adminData,
    error: error ? { message: error.message, code: error.code, details: error.details } : null,
  });

  if (error || !adminData) {
    // Admin not found
    return res.redirect(302, "/profile.html");
  }

  let html;
  try {
    html = fs.readFileSync(TEMPLATE_PATH, "utf8");
  } catch (err) {
    console.error("[render-profile] Could not read profile.html:", err);
    return res.status(500).send("Internal Server Error");
  }

  // Inject meta tag for client-side JS to pick up
  html = html.replace(
    "</head>",
    `  <meta name="admin:handle" content="${escapeHtml(cleanHandle)}">\n</head>`
  );

  const title = `${adminData.display_name} | منصة إمتحانات بصمجي`;
  const description = `الصفحة الشخصية للمشرف ${adminData.display_name} على منصة إمتحانات بصمجي`;
  const canonicalUrl = `${SITE_ORIGIN}/@${encodeURIComponent(cleanHandle)}`;

  html = html.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${escapeHtml(title)}</title>`
  );

  html = replaceLinkHref(html, "canonical", canonicalUrl);
  html = replaceMetaContent(html, "property", "og:title", title);
  html = replaceMetaContent(html, "property", "og:url", canonicalUrl);
  html = replaceMetaContent(html, "property", "og:description", description);
  html = replaceMetaContent(html, "name", "twitter:title", title);
  html = replaceMetaContent(html, "name", "twitter:description", description);
  html = replaceMetaContent(html, "name", "description", description);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=3600, stale-while-revalidate=86400"
  );
  return res.status(200).send(html);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function replaceMetaContent(html, attr, value, newContent) {
  const tagRe = new RegExp(
    `<meta[^>]*\\b${attr}=["']${escapeRegex(value)}["'][^>]*>`,
    "i"
  );
  return html.replace(tagRe, (tag) => {
    if (/content=["'][^"']*["']/i.test(tag)) {
      return tag.replace(
        /content=["'][^"']*["']/i,
        `content="${escapeHtml(newContent)}"`
      );
    }
    return tag;
  });
}

function replaceLinkHref(html, rel, newHref) {
  const tagRe = new RegExp(
    `<link[^>]*\\brel=["']${escapeRegex(rel)}["'][^>]*>`,
    "i"
  );
  return html.replace(tagRe, (tag) => {
    if (/href=["'][^"']*["']/i.test(tag)) {
      return tag.replace(
        /href=["'][^"']*["']/i,
        `href="${escapeHtml(newHref)}"`
      );
    }
    return tag;
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

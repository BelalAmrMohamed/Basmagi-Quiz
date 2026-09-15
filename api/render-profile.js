// =============================================================================
// api/render-profile.js
//
// Serves /@handle by injecting the visited admin's metadata into the static
// public/profile.html shell.
//
// PERFORMANCE NOTES (see the profile loading work):
//   * The ~90KB template is read ONCE per lambda instance and kept in module
//     scope. Previously every request paid a synchronous fs.readFileSync of
//     the whole file, which blocks the event loop and serializes concurrent
//     requests hitting the same instance.
//   * The template read and the Supabase lookup are independent, so they now
//     run concurrently instead of DB-then-disk.
//   * The Supabase lookup is raced against a hard deadline. Without one, a
//     cold or degraded database stalls the response before a single byte has
//     been sent — which is precisely how this route produced a blank page for
//     ~10s. Serving a valid shell the client can hydrate beats holding the
//     connection open.
//   * Metadata injection is a single pass over the string instead of nine
//     separate regex replacements, each of which allocated a fresh ~90KB copy.
// =============================================================================

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const TEMPLATE_PATH = path.join(process.cwd(), "public", "profile.html");
const SITE_ORIGIN = "https://basmagi-quiz.vercel.app";

// Upper bound on how long we'll wait for the handle lookup before falling back
// to an un-personalised shell. Sits comfortably under Vercel's own function
// timeout so we control the failure mode rather than the platform doing it for
// us with a 504.
const DB_LOOKUP_TIMEOUT_MS = 2500;

// Sanity ceiling on handle length before it ever reaches the database — cheap
// rejection of obviously malformed paths.
const MAX_HANDLE_LENGTH = 64;

// ── Template cache ──────────────────────────────────────────────────────────
// Warm lambdas reuse this. The template is a build artifact and cannot change
// underneath a running instance, so there's no invalidation to worry about: a
// new deploy means new instances.
let templateCache = null;
let templateCachePromise = null;

function loadTemplate() {
  if (templateCache !== null) return Promise.resolve(templateCache);

  // Deduplicate concurrent cold-start reads: without this, N simultaneous
  // requests to a fresh instance each kick off their own read of the same file.
  if (templateCachePromise) return templateCachePromise;

  templateCachePromise = fsp
    .readFile(TEMPLATE_PATH, "utf8")
    .then((html) => {
      templateCache = html;
      templateCachePromise = null;
      return html;
    })
    .catch((err) => {
      templateCachePromise = null;
      throw err;
    });

  return templateCachePromise;
}

// Prime the cache at module load so the very first request doesn't pay for the
// read at all. Synchronous specifically because this runs during cold start,
// when there is no request in flight to block, and it guarantees the cache is
// warm before the handler can possibly be invoked. Failures are swallowed —
// the async path in the handler surfaces them properly.
try {
  templateCache = fs.readFileSync(TEMPLATE_PATH, "utf8");
} catch {
  templateCache = null;
}

// Races a promise against a deadline. Resolves to `null` on timeout rather
// than rejecting, because every caller here treats "no data" and "took too
// long" identically: render the shell and let the client hydrate.
function withTimeout(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).end();
  }

  const handle = req.query.handle;
  if (!handle || typeof handle !== "string" || handle.trim() === "") {
    return res.redirect(302, "/");
  }

  const cleanHandle = handle.trim();
  if (cleanHandle.length > MAX_HANDLE_LENGTH) {
    return res.redirect(302, "/");
  }

  // NOTE: use case-insensitive matching here, same as admin-stats.js and
  // auth.js. A plain `.eq()` previously caused this route to silently
  // 302-redirect to /profile for handles that didn't match on exact
  // case/whitespace, which looked like "the profile doesn't exist" to
  // visitors even though the account and handle were both valid.
  const normalizedHandle = cleanHandle.toLowerCase().replace(/[%_\\]/g, "\\$&");

  // These two are independent, so start them together. The DB lookup is the
  // only one that can realistically be slow; racing it against a deadline
  // caps a degraded Supabase at DB_LOOKUP_TIMEOUT_MS of latency instead of an
  // open-ended stall.
  const lookupPromise = supabase
    .from("admin_users")
    .select("display_name, handle, avatar_url, thumbnail_url")
    .ilike("handle", normalizedHandle)
    .maybeSingle()
    .then((result) => result)
    .catch((err) => ({ data: null, error: err }));

  let html;
  let lookup;

  try {
    [html, lookup] = await Promise.all([
      loadTemplate(),
      withTimeout(lookupPromise, DB_LOOKUP_TIMEOUT_MS),
    ]);
  } catch (err) {
    console.error("[render-profile] Could not read profile.html:", err);
    return res.status(500).send("Internal Server Error");
  }

  // `lookup === null` means the deadline won the race. That is NOT the same as
  // "this handle doesn't exist", so it must not trigger the redirect below —
  // bouncing a valid profile to /profile because the database was briefly slow
  // is a far worse outcome than serving a shell.
  const timedOut = lookup === null;
  const adminData = timedOut ? null : lookup.data;
  const error = timedOut ? null : lookup.error;

  // Diagnostic logging, deliberately slimmed. The previous version logged the
  // entire adminData object on every request — including avatar_url, which is
  // frequently a base64 data URL measured in hundreds of KB. Serializing and
  // shipping that to the log drain per request was itself a meaningful chunk
  // of this route's latency. Log only what's diagnosable, only on failure.
  if (timedOut || error || !adminData) {
    console.warn("[render-profile] lookup did not resolve a profile", {
      normalizedHandle,
      timedOut,
      found: !!adminData,
      errorCode: error?.code || null,
      errorMessage: error?.message || null,
    });
  }

  if (!timedOut && (error || !adminData)) {
    // Admin genuinely not found (as opposed to "we couldn't check in time").
    return res.redirect(302, "/profile");
  }

  if (timedOut) {
    // Serve the bare shell. The client already handles a missing admin:handle
    // meta tag — it falls through to the owner dashboard path — and crucially
    // the visitor gets a skeleton and then a page rather than a hung
    // connection. no-store so this degraded response can never be cached at
    // the edge in place of a good one.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
  }

  // Fall back to the handle when display_name hasn't been set (NULL in the
  // DB) — without this, the title/description literally read "null | ..." for
  // any admin/dev who never set a display name.
  const displayLabel = adminData.display_name || adminData.handle;

  const title = displayLabel;
  const description = `الصفحة الشخصية للمشرف ${displayLabel} على منصة امتحانات بصمجي`;
  const canonicalUrl = `${SITE_ORIGIN}/@${encodeURIComponent(cleanHandle)}`;

  // Inject meta tags for client-side JS to pick up. avatar_url is a (possibly
  // large) data-URL — escapeHtml handles the characters that matter inside a
  // double-quoted attribute (", &, <, >), which is all that's needed here
  // since we're not writing it into a URL context.
  const displayNameMetaTag = adminData.display_name
    ? `  <meta name="admin:display-name" content="${escapeHtml(adminData.display_name)}">\n`
    : "";
  const avatarMetaTag = adminData.avatar_url
    ? `  <meta name="admin:avatar" content="${escapeHtml(adminData.avatar_url)}">\n`
    : "";
  // No thumbnail set -> fall back to the default Featured Thumbnail (2.jpg),
  // same asset path convention as the Featured Thumbnails picker
  // (public/assets/profile-featured/thumbnails/, see avatarEngine.js's
  // FEATURED_THUMBNAILS_BASE). Unlike avatarMetaTag/displayNameMetaTag this
  // tag is unconditional — there's always a value to inject, either the real
  // one or this default — so visitor view never renders an empty banner and
  // OG/crawler consumers always get a picture. This only affects what visitors
  // see; admin-stats.js's own GET response (`thumbnailUrl:
  // adminUser.thumbnail_url || null`) is untouched, so the owner's own
  // dashboard/picker UI still correctly shows "no thumbnail set" rather than
  // silently adopting this default.
  const thumbnailValue =
    adminData.thumbnail_url || "/assets/profile-featured/thumbnails/2.jpg";
  const thumbnailMetaTag = `  <meta name="admin:thumbnail" content="${escapeHtml(thumbnailValue)}">\n`;

  // JSON-LD (plan §8.4): ProfilePage with a Person `about`.
  const profileJsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: title,
    url: canonicalUrl,
    inLanguage: "ar",
    about: {
      "@type": "Person",
      name: displayLabel,
      url: canonicalUrl,
      image: thumbnailValue || undefined,
    },
  };

  // Preconnect to the avatar/thumbnail origin when it's a real remote URL
  // (e.g. Supabase storage) rather than a data URL or same-origin asset path.
  // The cover strip is the largest above-the-fold paint on visitor view, so
  // opening that connection during head parse instead of at <img> discovery is
  // worth the two extra tags.
  const assetPreconnect = buildAssetPreconnect(thumbnailValue);

  // ── Single-pass head injection ────────────────────────────────────────────
  // Everything destined for <head> is assembled once and inserted with a
  // single replace, instead of the previous two separate </head> replaces plus
  // seven regex passes over a ~90KB string.
  const headInjection =
    `  <meta name="admin:handle" content="${escapeHtml(cleanHandle)}">\n` +
    displayNameMetaTag +
    avatarMetaTag +
    thumbnailMetaTag +
    assetPreconnect +
    `  <script type="application/ld+json">${JSON.stringify(profileJsonLd)}</script>\n`;

  html = html.replace("</head>", `${headInjection}</head>`);

  // The remaining rewrites each target a distinct, unique tag, so they're
  // collapsed into one walk over the document rather than one walk each.
  html = applyHeadRewrites(html, { title, description, canonicalUrl });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=3600, stale-while-revalidate=86400",
  );
  return res.status(200).send(html);
}

// Collapses the title/canonical/OG/Twitter/description rewrites into a single
// pass. Each match is dispatched by tag identity, so the document is scanned
// once instead of once per field.
function applyHeadRewrites(html, { title, description, canonicalUrl }) {
  const metaTargets = new Map([
    ["og:title", title],
    ["og:url", canonicalUrl],
    ["og:description", description],
    ["twitter:title", title],
    ["twitter:description", description],
    ["description", description],
  ]);

  return html.replace(
    /<title>[^<]*<\/title>|<link\b[^>]*>|<meta\b[^>]*>/gi,
    (tag) => {
      if (/^<title>/i.test(tag)) {
        return `<title>${escapeHtml(title)}</title>`;
      }

      if (/^<link/i.test(tag)) {
        if (!/\brel=["']canonical["']/i.test(tag)) return tag;
        return replaceAttr(tag, "href", canonicalUrl);
      }

      // <meta>: match on property= first (OG), then name= (Twitter/description).
      const key =
        matchAttr(tag, "property") ??
        (matchAttr(tag, "name") || "").toLowerCase();
      if (!key || !metaTargets.has(key)) return tag;

      return replaceAttr(tag, "content", metaTargets.get(key));
    },
  );
}

function matchAttr(tag, attr) {
  const m = tag.match(new RegExp(`\\b${attr}=["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
}

// Rewrites an attribute's value in place, preserving the rest of the tag. Only
// touches the attribute if it already exists — mirrors the previous behaviour,
// where a tag without a `content`/`href` attribute was left untouched rather
// than having one grafted on.
function replaceAttr(tag, attr, value) {
  const re = new RegExp(`\\b${attr}=["'][^"']*["']`, "i");
  if (!re.test(tag)) return tag;
  return tag.replace(re, `${attr}="${escapeHtml(value)}"`);
}

// Emits preconnect/dns-prefetch for a remote asset origin. Returns an empty
// string for data URLs, relative paths, and anything unparseable — there's no
// connection to warm in those cases and an invalid hint just costs bytes.
function buildAssetPreconnect(assetUrl) {
  if (!assetUrl || typeof assetUrl !== "string") return "";
  if (!/^https?:\/\//i.test(assetUrl)) return "";

  let origin;
  try {
    origin = new URL(assetUrl).origin;
  } catch {
    return "";
  }

  if (origin === SITE_ORIGIN) return "";

  return (
    `  <link rel="preconnect" href="${escapeHtml(origin)}" crossorigin>\n` +
    `  <link rel="dns-prefetch" href="${escapeHtml(origin)}">\n`
  );
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
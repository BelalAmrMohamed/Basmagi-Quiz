// =============================================================================
// api/_og/profile.js
// Profile card  —  /api/og?profile=<handle>[&v=hash]
// =============================================================================
import { ImageResponse } from "@vercel/og";
import { toVisual } from "../_arabicShape.js";
import { BRAND_BLUE, FONT_FAMILY_STACK, SITE_ORIGIN, SUPABASE_ANON_KEY, SUPABASE_URL, TEAL, clampText, detectArabic, loadFont, svgIcon, wrapText } from "./common.js";

// =============================================================================
// Profile OG image  —  /api/og?profile=<handle>[&v=<hash>]
// =============================================================================
// 1200×630 share card for /@handle. Layout (RTL):
//
//   ┌────────────────────────────────────────────────────────────┐
//   │ [brand pill]                  BANNER (user's thumbnail)    │ 0–260
//   │                                                  ◯ avatar  │
//   │   Name (fit-to-width)                           ━━━━━━━    │
//   │   @handle  · مشرف                          ★ المستوى 12    │
//   │   │ bio, up to two lines                                   │
//   │ [ شارات ] [ النقاط ] [ الامتحانات المرفوعة ]                │ 482–566
//   │               basmagi-quiz.vercel.app/@handle              │
//   └────────────────────────────────────────────────────────────┘
//
// Data comes straight from the public `admin_users` row over Supabase REST
// (RLS "Public can read admin profile fields"), so it works at the edge with
// no supabase-js and no new serverless function.
//
// Robustness: Satori throws (lazily, while the PNG stream is read) on an
// undecodable <img>. Avatar/banner are therefore (a) sniffed by magic bytes
// and only passed through if PNG/JPEG/GIF/SVG, (b) fetched with a timeout and
// size cap when they are URLs, and (c) the whole render is retried once
// without user images (initial-letter avatar + brand gradient banner) if it
// still fails. The finished PNG is palette-quantised (profileOptimizePng) so a
// sharp photo banner stays ~100–150KB. A profile that doesn't exist redirects to the static profile
// thumbnail instead of returning an error image.
// =============================================================================

const PROFILE_DEFAULT_BANNER = "/assets/profile-featured/thumbnails/2.jpg";

const PROFILE_FALLBACK_IMAGE = `${SITE_ORIGIN}/assets/images/thumbnails/profile-thumbnail.png`;

const PROFILE_LOGO_URL = `${SITE_ORIGIN}/assets/images/icon-192.png`;

const PROFILE_GOLD = "#f59e0b";

const PROFILE_IMAGE_MAX_BYTES = 2_500_000;

const PROFILE_ICONS = {
  upload: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"],
  zap: ["M13 2 4 14h7l-1 8 9-12h-7l1-8z"],
  award: ["M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z", "M8.2 13.9 7 22l5-3 5 3-1.2-8.1"],
  star: ["M12 2.5 15 9l7 1-5 5 1.3 7L12 18.5 5.7 22 7 15 2 10l7-1z"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"], // same glyphs as profile.js role badges
  code: ["M16 18l6-6-6-6", "M8 6l-6 6 6 6"],
};

// Role badge palette — identical gradients to .role-badge in profile.css.
const PROFILE_ROLES = {
  admin: { label: "مشرف", icon: "shield", from: "#3b82f6", to: "#1e40af", shadow: "rgba(37,99,235,0.40)" },
  developer: { label: "مطور", icon: "code", from: "#a855f7", to: "#6d28d9", shadow: "rgba(109,40,217,0.40)" },
};

// Initial-letter avatar palettes (brand-family gradients), picked by name hash.
const PROFILE_AVATAR_GRADIENTS = [
  ["#0088cc", "#0d9488"],
  ["#7c3aed", "#0088cc"],
  ["#0d9488", "#16a34a"],
  ["#db2777", "#7c3aed"],
  ["#ea580c", "#d97706"],
];

let _profileLogoPromise = null;

function profileFetchTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function profileBytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Magic-byte sniff → "image/png" | "image/jpeg" | "image/gif" | "image/svg+xml" | null (WebP etc. unsupported by Satori). */
function profileSniffMime(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  const head = String.fromCharCode(...b.subarray(0, 16)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return null;
}

/**
 * Turns an avatar/thumbnail value (data URL, site-relative path, or an
 * https URL on our own origin / Supabase storage) into a Satori-safe data URL,
 * or null when it can't be used.
 */
async function profileSafeImage(src) {
  if (!src || typeof src !== "string") return null;
  try {
    if (src.startsWith("data:")) {
      const comma = src.indexOf(",");
      if (comma < 0 || !/;base64$/i.test(src.slice(0, comma))) return null;
      const b64 = src.slice(comma + 1);
      if (b64.length > PROFILE_IMAGE_MAX_BYTES * 1.4) return null;
      const head = Uint8Array.from(atob(b64.slice(0, 24)), (c) => c.charCodeAt(0));
      const mime = profileSniffMime(head);
      return mime ? `data:${mime};base64,${b64}` : null;
    }

    let url;
    if (src.startsWith("/")) url = new URL(src, SITE_ORIGIN);
    else url = new URL(src);
    // Satori cannot decode WebP. Static assets that are (or will be) shipped as
    // .webp for the site keep a .jpg twin next to them for this renderer.
    if (url.origin === new URL(SITE_ORIGIN).origin) url.pathname = url.pathname.replace(/\.webp$/i, ".jpg");
    const allowed = new Set([new URL(SITE_ORIGIN).origin]);
    if (SUPABASE_URL) allowed.add(new URL(SUPABASE_URL).origin);
    if (url.protocol !== "https:" || !allowed.has(url.origin)) return null;

    const res = await profileFetchTimeout(url.toString(), {}, 3000);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > PROFILE_IMAGE_MAX_BYTES) return null;
    const mime = profileSniffMime(bytes);
    return mime ? `data:${mime};base64,${profileBytesToBase64(bytes)}` : null;
  } catch (err) {
    console.error("[og] profile image skipped:", err?.message || err);
    return null;
  }
}

function loadProfileLogo() {
  if (_profileLogoPromise) return _profileLogoPromise;
  _profileLogoPromise = profileFetchTimeout(PROFILE_LOGO_URL, {}, 3000)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`logo ${res.status}`))))
    .then((buf) => `data:image/png;base64,${profileBytesToBase64(new Uint8Array(buf))}`)
    .catch((err) => {
      console.error("[og] profile logo error:", err);
      _profileLogoPromise = null;
      return null;
    });
  return _profileLogoPromise;
}

/**
 * Developer vs admin. A developer is an admin whose email is in DEVELOPERS_EMAILS
 * (same rule as api/admin.js getOwnerEmails / auth.js isOwner). The email is
 * read with the service key, compared here and never leaves this function.
 * Any failure (no env, no key, timeout) degrades to "admin".
 */
async function fetchProfileRole(handle) {
  const developers = (process.env.DEVELOPERS_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!developers.length || !serviceKey || !SUPABASE_URL) return "admin";
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/admin_users`);
    url.searchParams.set("select", "email");
    url.searchParams.set("handle", `ilike.${handle.replace(/[%_\\*]/g, "\\$&")}`);
    url.searchParams.set("limit", "1");
    const res = await profileFetchTimeout(
      url.toString(),
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      2500,
    );
    if (!res.ok) return "admin";
    const rows = await res.json();
    const email = String(rows?.[0]?.email || "").trim().toLowerCase();
    return email && developers.includes(email) ? "developer" : "admin";
  } catch (err) {
    console.error("[og] profile role lookup failed:", err?.message || err);
    return "admin";
  }
}

function profileHexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function profileFormatCount(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v >= 1_000_000) return `${Math.floor(v / 100_000) / 10}M`;
  return v.toLocaleString("en-US");
}

function profileHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Tiny element helper: every Satori div needs display:flex when it has >1 child. */
function pd(style, children) {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

function profileBannerImage(dataUrl) {
  return {
    type: "img",
    props: {
      src: dataUrl, width: 1200, height: 244,
      style: { position: "absolute", left: "0px", top: "0px", width: "1200px", height: "244px", objectFit: "cover" },
    },
  };
}

/**
 * One right-anchored text line, pre-shaped (see api/_arabicShape.js).
 *
 * Satori still runs its own contextual shaping / bidi reordering on any
 * adjacent Arabic-block characters inside one text node (it swaps neighbouring
 * isolated letters and swallows spaces next to them). So after shaping, every
 * Arabic glyph is placed in its OWN flex item, in final left-to-right order:
 * nothing is left for Satori to re-join or reorder, and each box is exactly
 * one glyph wide. Latin/digit runs stay together as one text node.
 */
const PROFILE_ARABIC_GLYPH = /[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]/;

function profileText(text, style = {}) {
  const fs = parseInt(style.fontSize, 10) || 24;
  const visual = Array.from(toVisual(text));
  const children = [];
  let latin = "";
  const flush = () => {
    if (latin) children.push({ type: "div", props: { style: { display: "flex" }, children: latin } });
    latin = "";
  };
  for (const ch of visual) {
    if (ch === " ") {
      flush();
      children.push({ type: "div", props: { style: { display: "flex", width: `${Math.round(fs * 0.26)}px`, height: "1px", flexShrink: 0 } } });
    } else if (PROFILE_ARABIC_GLYPH.test(ch)) {
      flush();
      children.push({ type: "div", props: { style: { display: "flex" }, children: ch } });
    } else {
      latin += ch;
    }
  }
  flush();
  return {
    type: "div",
    props: {
      style: {
        display: "flex", flexDirection: "row", direction: "ltr", whiteSpace: "nowrap",
        justifyContent: "flex-end", alignItems: "baseline", ...style,
      },
      children,
    },
  };
}

function buildProfileElement({ meta, avatar, banner, logo }) {
  const handle = String(meta.handle || "").toLowerCase();
  const nameRaw = String(meta.display_name || meta.handle || "").replace(/\s+/g, " ").trim();
  const nameAr = !!detectArabic(nameRaw);
  const level = Math.max(1, Math.floor(Number(meta.current_level) || 1));

  // ── Name: biggest tier that fits one line in the identity column ──────────
  const COL_LEFT = 64;
  const COL_RIGHT = 868; // 1200 − (avatar ring 232 + right gap 60 + gutter 40)
  const COL_W = COL_RIGHT - COL_LEFT;
  const nameFactor = nameAr ? 0.62 : 0.58;
  let nFont = 60;
  for (const f of [60, 54, 48, 42, 36]) {
    nFont = f;
    if (nameRaw.length <= Math.floor(COL_W / (f * nameFactor))) break;
  }
  const nameText = clampText(nameRaw, Math.floor(COL_W / (nFont * nameFactor)));

  // ── Bio: up to two lines ─────────────────────────────────────────────────
  const bioRaw = String(meta.bio || "").replace(/\s+/g, " ").trim();
  const hasBio = bioRaw.length > 0;
  const bioText = hasBio
    ? bioRaw
    : meta.role === "developer"
      ? "ضمن فريق تطوير منصة امتحانات بصمجي"
      : "مشرف يساهم بالمحتوى التعليمي على منصة امتحانات بصمجي";
  const bioAr = !!detectArabic(bioText);
  const bFont = 25;
  const bioLines = wrapText(bioText, Math.floor((COL_W - 22) / (bFont * (bioAr ? 0.74 : 0.58))), 2);

  // ── Banner ───────────────────────────────────────────────────────────────
  const bannerLayers = [
    banner ? profileBannerImage(banner) : null,
    pd({
      position: "absolute", left: "0px", top: "0px", width: "1200px", height: "244px",
      backgroundImage: banner
        ? "linear-gradient(180deg, rgba(6,14,34,0.62) 0%, rgba(6,14,34,0.12) 48%, rgba(6,14,34,0.50) 100%)"
        : "linear-gradient(120deg, #0a3552 0%, #0088cc 58%, #0d9488 100%)",
    }),
    // Brand accent line where banner meets the card body.
    pd({
      position: "absolute", left: "0px", top: "238px", width: "1200px", height: "6px",
      backgroundImage: `linear-gradient(90deg, ${BRAND_BLUE} 0%, ${TEAL} 100%)`,
    }),
  ].filter(Boolean);

  // Platform mark (top-left of banner): logo only, in a round glass badge.
  const brandPill = pd({
    position: "absolute", left: "34px", top: "26px", width: "88px", height: "88px", borderRadius: "44px",
    alignItems: "center", justifyContent: "center",
    background: "rgba(6,14,34,0.50)", border: "2px solid rgba(255,255,255,0.34)",
    boxShadow: "0 10px 28px rgba(0,0,0,0.30)",
  }, logo
    ? { type: "img", props: { src: logo, width: 68, height: 68, style: { width: "68px", height: "68px", borderRadius: "34px" } } }
    : pd({ width: "68px", height: "68px", borderRadius: "34px", background: BRAND_BLUE }));

  // ── Avatar (gradient ring + white gap) ───────────────────────────────────
  const AV = { outer: 232, right: 60, top: 126 };
  const [g1, g2] = PROFILE_AVATAR_GRADIENTS[profileHash(handle) % PROFILE_AVATAR_GRADIENTS.length];
  const initial = Array.from(nameRaw || handle)[0] || "؟";
  const avatarFace = avatar
    ? { type: "img", props: { src: avatar, width: 210, height: 210, style: { width: "210px", height: "210px", borderRadius: "105px", objectFit: "cover" } } }
    : pd({
      width: "210px", height: "210px", borderRadius: "105px", alignItems: "center", justifyContent: "center",
      backgroundImage: `linear-gradient(135deg, ${g1} 0%, ${g2} 100%)`,
      color: "#ffffff", fontSize: "104px", fontWeight: "700",
    }, initial);

  const avatarGlow = pd({
    position: "absolute", right: `${AV.right - 70}px`, top: `${AV.top - 70}px`,
    width: `${AV.outer + 140}px`, height: `${AV.outer + 140}px`, borderRadius: "999px",
    backgroundImage: "radial-gradient(circle, rgba(0,136,204,0.20) 0%, rgba(0,136,204,0) 68%)",
  });

  const avatarRing = pd({
    position: "absolute", right: `${AV.right}px`, top: `${AV.top}px`,
    width: `${AV.outer}px`, height: `${AV.outer}px`, borderRadius: "116px",
    alignItems: "center", justifyContent: "center",
    backgroundImage: `linear-gradient(135deg, ${BRAND_BLUE} 0%, ${TEAL} 100%)`,
    boxShadow: "0 22px 44px rgba(15,23,42,0.28)",
  }, pd({
    width: "220px", height: "220px", borderRadius: "110px", background: "#ffffff",
    alignItems: "center", justifyContent: "center",
  }, avatarFace));

  // ── Level medal straddling the avatar's lower edge ───────────────────────
  const PILL_W = 244;
  const avatarCx = 1200 - AV.right - AV.outer / 2;
  // Children are absolutely placed: Satori under-measures Arabic runs, so a
  // flow layout lets the digits collide with the label.
  const levelPill = pd({
    position: "absolute", left: `${avatarCx - PILL_W / 2}px`, top: `${AV.top + AV.outer - 30}px`,
    width: `${PILL_W}px`, height: "54px", borderRadius: "27px",
    backgroundImage: "linear-gradient(135deg, #fde68a 0%, #f59e0b 55%, #d97706 100%)",
    border: "4px solid #ffffff", boxShadow: "0 12px 26px rgba(180,83,9,0.35)",
  }, [
    pd({ position: "absolute", right: "14px", top: "11px" }, svgIcon(PROFILE_ICONS.star, 24, "#3b2300", 2.4)),
    pd({ position: "absolute", right: "46px", top: "7px", width: "120px", justifyContent: "flex-end" },
      profileText("المستوى", { fontSize: "25px", fontWeight: "700", color: "#3b2300" })),
    pd({
      position: "absolute", left: "8px", top: "5px", width: "40px", height: "36px", borderRadius: "18px",
      alignItems: "center", justifyContent: "center", background: "#ffffff",
      fontSize: level >= 100 ? "20px" : "25px", fontWeight: "700", color: "#92400e", direction: "ltr",
    }, String(level)),
  ]);

  // ── Identity column ──────────────────────────────────────────────────────
  const nameRow = profileText(nameText, {
    fontSize: `${nFont}px`, fontWeight: "700", color: "#0f172a", lineHeight: "1.2", width: "100%",
  });

  const handleChip = pd({
    flexDirection: "row", alignItems: "center", padding: "3px 18px", borderRadius: "999px",
    background: profileHexA(BRAND_BLUE, 0.10), border: `1.5px solid ${profileHexA(BRAND_BLUE, 0.30)}`,
    color: BRAND_BLUE, fontSize: "27px", fontWeight: "700", direction: "ltr", whiteSpace: "nowrap",
  }, `@${handle.length > 24 ? handle.slice(0, 23) + "…" : handle}`);

  const role = PROFILE_ROLES[meta.role === "developer" ? "developer" : "admin"];
  const adminChip = pd({
    flexDirection: "row-reverse", alignItems: "center", gap: "9px", padding: "4px 18px 4px 14px", borderRadius: "999px",
    backgroundImage: `linear-gradient(135deg, ${role.from} 0%, ${role.to} 100%)`,
    boxShadow: `0 6px 14px ${role.shadow}`,
  }, [
    svgIcon(PROFILE_ICONS[role.icon], 24, "#ffffff", 2.5),
    profileText(role.label, { fontSize: "24px", fontWeight: "700", color: "#ffffff" }),
  ]);

  const badgeRow = pd({ flexDirection: "row-reverse", alignItems: "center", gap: "12px", marginTop: "6px" }, [handleChip, adminChip]);

  const bioBlock = pd({
    flexDirection: "column", alignItems: "flex-end", width: "100%", marginTop: "14px",
    paddingRight: "18px", borderRight: `4px solid ${hasBio ? TEAL : "#cbd5e1"}`, gap: "2px",
  }, bioLines.map((line) =>
    profileText(line, {
      fontSize: `${bFont}px`, color: hasBio ? "#475569" : "#94a3b8", fontWeight: "400", lineHeight: "1.4", width: "100%",
    }),
  ));

  const identity = pd({
    position: "absolute", left: `${COL_LEFT}px`, top: "262px", width: `${COL_W}px`,
    flexDirection: "column", alignItems: "flex-end", direction: "ltr", textAlign: "right",
  }, [nameRow, badgeRow, bioBlock]);

  // ── Stat tiles ───────────────────────────────────────────────────────────
  const tile = (icon, color, value, label) =>
    pd({
      flex: "1", flexDirection: "row-reverse", alignItems: "center", gap: "14px", height: "80px",
      padding: "0 20px", backgroundColor: "#ffffff", border: `1.5px solid ${profileHexA(color, 0.22)}`,
      borderRadius: "22px", boxShadow: "0 10px 24px rgba(15,23,42,0.07)", overflow: "hidden",
    }, [
      pd({
        width: "54px", height: "54px", borderRadius: "27px", flexShrink: 0,
        alignItems: "center", justifyContent: "center", background: profileHexA(color, 0.12),
      }, svgIcon(icon, 28, color, 2.2)),
      pd({ flexDirection: "column", alignItems: "flex-end", flex: "1" }, [
        pd({ fontSize: "34px", fontWeight: "700", color: "#0f172a", direction: "ltr", lineHeight: "1.1" }, value),
        profileText(label, { fontSize: "20px", color: "#64748b", fontWeight: "700" }),
      ]),
    ]);

  const stats = pd({
    position: "absolute", left: "60px", right: "60px", top: "490px", flexDirection: "row-reverse", gap: "20px",
  }, [
    tile(PROFILE_ICONS.upload, BRAND_BLUE, // Quizzes + lessons in one tile: a 4th tile would not fit the card width.
    profileFormatCount((Number(meta.uploaded_quizzes) || 0) + (Number(meta.uploaded_lessons) || 0)), "المحتوى المرفوع"),
    tile(PROFILE_ICONS.zap, "#d97706", profileFormatCount(meta.total_points), "النقاط"),
    tile(PROFILE_ICONS.award, "#7c3aed", profileFormatCount(meta.total_badges), "الشارات"),
  ]);

  const footer = pd({
    position: "absolute", left: "40px", right: "40px", bottom: "16px", justifyContent: "center",
    fontSize: "20px", color: "#94a3b8", fontWeight: "400", whiteSpace: "nowrap", direction: "ltr",
  }, `basmagi-quiz.vercel.app/@${handle.length > 40 ? handle.slice(0, 39) + "…" : handle}`);

  return pd({
    width: "100%", height: "100%", position: "relative", fontFamily: FONT_FAMILY_STACK, backgroundColor: "#f8fafc",
    backgroundImage:
      "radial-gradient(circle at 0% 100%, rgba(13,148,136,0.12) 0%, rgba(13,148,136,0) 42%), radial-gradient(circle at 100% 100%, rgba(0,136,204,0.10) 0%, rgba(0,136,204,0) 40%)",
  }, [...bannerLayers, brandPill, avatarGlow, avatarRing, levelPill, identity, stats, footer]);
}

/** Renders to PNG bytes inside try/catch — Satori errors surface while reading, not on construction. */
async function profileRenderPng(element, fontData) {
  try {
    const res = new ImageResponse(element, {
      width: 1200,
      height: 630,
      fonts: fontData
        ? fontData.map((f) => ({ name: f.name, data: f.data, weight: 700, style: "normal" }))
        : [],
    });
    return await res.arrayBuffer();
  } catch (err) {
    console.error("[og] profile render failed:", err);
    return null;
  }
}

/**
 * ImageResponse can only emit 24-bit PNG, and a photo banner makes that
 * 450–700KB (WhatsApp previews get unreliable above ~300KB). Re-encoding to a
 * 256-colour palette PNG (UPNG's quantiser) keeps the banner fully sharp at
 * ~100–150KB. Loaded lazily and wrapped in try/catch: if the library or the
 * quantiser ever fails, the original PNG is served unchanged.
 */
async function profileOptimizePng(pngBuffer) {
  try {
    const UPNG = (await import("upng-js")).default;
    const img = UPNG.decode(pngBuffer);
    const rgba = UPNG.toRGBA8(img)[0];
    const out = UPNG.encode([rgba], img.width, img.height, 256);
    return out.byteLength > 0 && out.byteLength < pngBuffer.byteLength ? out : pngBuffer;
  } catch (err) {
    console.error("[og] png optimise skipped:", err?.message || err);
    return pngBuffer;
  }
}

export async function renderProfileImage(handleRaw, version) {
  const handle = String(handleRaw || "").trim().toLowerCase();
  const fallback = () =>
    new Response(null, {
      status: 302,
      headers: { Location: PROFILE_FALLBACK_IMAGE, "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
    });
  if (!/^[a-z0-9_-]{1,64}$/.test(handle)) return fallback();

  const [fontData, meta, logo] = await Promise.all([
    loadFont().catch((err) => { console.error("[og] profile font load error:", err); return null; }),
    fetchProfileOgMeta(handle),
    loadProfileLogo(),
  ]);
  if (!meta) return fallback();

  const [avatar, banner] = await Promise.all([
    profileSafeImage(meta.avatar_url),
    profileSafeImage(meta.thumbnail_url || PROFILE_DEFAULT_BANNER),
  ]);

  let png = await profileRenderPng(buildProfileElement({ meta, avatar, banner, logo }), fontData);
  let degraded = false;
  if (!png && (avatar || banner)) {
    degraded = true;
    png = await profileRenderPng(buildProfileElement({ meta, avatar: null, banner: null, logo }), fontData);
  }
  if (!png) return fallback();
  png = await profileOptimizePng(png);

  // With ?v=<content hash> (render-profile.js changes it whenever the profile
  // changes) the URL is immutable; without it, revalidate hourly.
  const complete = fontData !== null && !degraded && Boolean(avatar || !meta.avatar_url) && Boolean(banner);
  const cache = complete && version && /^[a-z0-9]{4,32}$/i.test(version)
    ? "public, immutable, no-transform, max-age=31536000, s-maxage=31536000"
    : complete
      ? "public, s-maxage=3600, stale-while-revalidate=86400"
      : "public, s-maxage=300, stale-while-revalidate=3600";

  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": cache } });
}

async function fetchProfileOgMeta(handle) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[og] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/admin_users`);
    url.searchParams.set(
      "select",
      "display_name,handle,bio,avatar_url,thumbnail_url,current_level,uploaded_quizzes,uploaded_lessons,total_points,total_badges",
    );
    // ilike = case-insensitive like render-profile.js; escape LIKE wildcards
    // ("_" is legal in handles).
    url.searchParams.set("handle", `ilike.${handle.replace(/[%_\\*]/g, "\\$&")}`);
    url.searchParams.set("limit", "1");
    const [res, role] = await Promise.all([
      profileFetchTimeout(
        url.toString(),
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
        3000,
      ),
      fetchProfileRole(handle),
    ]);
    if (!res.ok) {
      console.error(`[og] admin_users lookup returned ${res.status}`);
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? { ...rows[0], role } : null;
  } catch (err) {
    console.error("[og] fetchProfileOgMeta error:", err);
    return null;
  }
}


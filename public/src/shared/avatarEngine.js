// public/src/shared/avatarEngine.js - Client-side Avatar Storage & Processing
// All avatar data lives in localStorage since non-admin users have no
// Supabase account. Kept in its own key (separate from quiz_user_profile)
// so avatar payloads never bloat the read/write path of the main profile
// object, and a corrupt/oversized avatar can never break quiz progress.

import { getAdminRoleInfo } from "../shared/adminAuth.js";

const AVATAR_KEY = "quiz_user_avatar";
const AVATAR_SIZE = 256; // px, output square dimension
const JPEG_QUALITY = 0.82;

// A small, deterministic palette pulled from the site's own accent family
// (see themes.css --color-primary / --gradient-accent stops) so generated
// avatars always feel native to the product rather than random colors.
// Each entry is a [from, to] gradient pair (was flat colors) — flat
// circles read as a placeholder; a soft diagonal gradient plus the ring
// motif below make the generated fallback feel like a designed avatar
// rather than "no avatar set".
const DEFAULT_AVATAR_PALETTE = [
  ["#818cf8", "#4f46e5"],
  ["#a78bfa", "#7c3aed"],
  ["#f472b6", "#db2777"],
  ["#fbbf24", "#d97706"],
  ["#34d399", "#059669"],
  ["#60a5fa", "#2563eb"],
  ["#f87171", "#dc2626"],
  ["#2dd4bf", "#0d9488"],
];

export const avatarEngine = {
  // 1. Get the stored avatar (base64 data URL) or null if none set
  getAvatar() {
    try {
      return localStorage.getItem(AVATAR_KEY) || null;
    } catch (err) {
      console.error("Failed to read avatar from storage:", err);
      return null;
    }
  },

  // 2. Save a data URL directly (used for default/preset avatars, already small)
  saveAvatar(dataUrl) {
    try {
      localStorage.setItem(AVATAR_KEY, dataUrl);
      return true;
    } catch (err) {
      console.error("Failed to save avatar to storage:", err);
      return false;
    }
  },

  // 3. Remove the stored avatar, falling back to the generated default
  removeAvatar() {
    try {
      localStorage.removeItem(AVATAR_KEY);
    } catch (err) {
      console.error("Failed to remove avatar from storage:", err);
    }
  },

  // 4. Process a File (upload or camera capture) into a compressed,
  //    square, base64-encoded JPEG sized for localStorage.
  //    Returns a Promise<string> resolving to the data URL.
  async processImageFile(file) {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      throw new Error("الملف المختار ليس صورة صالحة");
    }

    const bitmap = await this._loadImage(file);
    const dataUrl = this._resizeAndCompress(bitmap);

    // Guard: localStorage entries are realistically capped well under 5MB
    // per key across browsers. A 256x256 JPEG at q=0.82 is normally tens
    // of KB, but if a pathological image still comes out huge, fail loudly
    // rather than silently corrupting storage.
    const approxBytes = Math.round((dataUrl.length * 3) / 4);
    if (approxBytes > 1.5 * 1024 * 1024) {
      throw new Error("الصورة كبيرة جداً، جرّب صورة أخرى");
    }

    return dataUrl;
  },

  _loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("تعذّر قراءة الصورة"));
      };
      img.src = url;
    });
  },

  // Crop to center square, downscale to AVATAR_SIZE, encode as JPEG
  _resizeAndCompress(img) {
    const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = ((img.naturalWidth || img.width) - side) / 2;
    const sy = ((img.naturalHeight || img.height) - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  },

  // 5. Deterministic gradient pick for a given name, so the same name
  //    always gets the same default-avatar colors across sessions/devices.
  //    Returns [from, to]; use colorForName() below where only a single
  //    flat color is needed (e.g. preset swatch backgrounds).
  gradientForName(name) {
    const str = (name || "?").trim();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return DEFAULT_AVATAR_PALETTE[hash % DEFAULT_AVATAR_PALETTE.length];
  },

  // Back-compat single-color accessor (returns the gradient's start color).
  colorForName(name) {
    return this.gradientForName(name)[0];
  },

  // 6. First "letter" of a name, Arabic-aware. Arabic has no case, and
  //    combining marks (tashkeel) shouldn't be picked as the initial, so
  //    skip them. Falls back to "؟" if nothing usable is found.
  initialForName(name) {
    const str = (name || "").trim();
    if (!str) return "؟";

    const arabicDiacritics = /[\u064B-\u065F\u0670]/;
    for (const ch of str) {
      if (arabicDiacritics.test(ch)) continue;
      return ch.toUpperCase();
    }
    return "؟";
  },

  // 7. Build a default avatar as an inline SVG data URL (not stored,
  //    computed on demand so it always reflects the current username).
  //    Creates a modern, generative abstract geometric pattern for high
  //    visual variety instead of a simple single-letter gradient.
  generateDefaultAvatarSVG(name) {
    const str = (name || "?").trim();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }

    const getBits = (start, len) => (hash >> start) & ((1 << len) - 1);
    
    // Pick 3 gradient pairs from the palette
    const c1 = DEFAULT_AVATAR_PALETTE[getBits(0, 3) % DEFAULT_AVATAR_PALETTE.length];
    const c2 = DEFAULT_AVATAR_PALETTE[(getBits(3, 3) + 1) % DEFAULT_AVATAR_PALETTE.length];
    const c3 = DEFAULT_AVATAR_PALETTE[(getBits(6, 3) + 2) % DEFAULT_AVATAR_PALETTE.length];

    const gradId1 = `bgGrad${hash}`;
    const gradId2 = `fg1Grad${hash}`;
    const gradId3 = `fg2Grad${hash}`;

    const shape1 = getBits(9, 2);
    const shape2 = getBits(11, 2);
    const shape3 = getBits(13, 2);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="${gradId1}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${c1[0]}"/>
          <stop offset="100%" stop-color="${c1[1]}"/>
        </linearGradient>
        <linearGradient id="${gradId2}" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${c2[0]}"/>
          <stop offset="100%" stop-color="${c2[1]}"/>
        </linearGradient>
        <linearGradient id="${gradId3}" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${c3[0]}"/>
          <stop offset="100%" stop-color="${c3[1]}"/>
        </linearGradient>
      </defs>
      
      <rect width="100" height="100" fill="url(#${gradId1})"/>
      
      <g transform="translate(50, 50) rotate(${getBits(15, 3) * 45})">
        ${shape1 === 0 ? `<circle cx="-15" cy="-15" r="45" fill="url(#${gradId2})" opacity="0.9"/>` :
          shape1 === 1 ? `<rect x="-35" y="-35" width="70" height="70" rx="16" fill="url(#${gradId2})" opacity="0.9"/>` :
          shape1 === 2 ? `<polygon points="0,-50 45,35 -45,35" fill="url(#${gradId2})" opacity="0.9"/>` :
          `<path d="M-40,0 A40,40 0 1,1 40,0" fill="url(#${gradId2})" opacity="0.9"/>`}
      </g>

      <g transform="translate(50, 50) rotate(${getBits(18, 3) * 45})">
        ${shape2 === 0 ? `<circle cx="20" cy="20" r="35" fill="url(#${gradId3})" opacity="0.8"/>` :
          shape2 === 1 ? `<rect x="-15" y="-15" width="50" height="50" rx="12" fill="url(#${gradId3})" opacity="0.8"/>` :
          shape2 === 2 ? `<polygon points="-30,-15 30,-15 0,45" fill="url(#${gradId3})" opacity="0.8"/>` :
          `<path d="M-35,15 A35,35 0 1,0 35,15" fill="url(#${gradId3})" opacity="0.8"/>`}
      </g>
      
      <g transform="translate(50, 50) rotate(${getBits(21, 3) * 45})">
        ${shape3 === 0 ? `<circle cx="-25" cy="25" r="12" fill="#ffffff" opacity="0.5"/>` :
          shape3 === 1 ? `<rect x="-35" y="15" width="25" height="25" rx="6" fill="#ffffff" opacity="0.5"/>` :
          shape3 === 2 ? `<polygon points="25,-25 40,-5 10,-5" fill="#ffffff" opacity="0.5"/>` :
          `<circle cx="25" cy="-25" r="10" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.6"/>`}
      </g>
      
      <circle cx="50" cy="50" r="44" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="1.5"/>
    </svg>`;
  },

  // Internal: small string hash, used to key gradient defs uniquely per
  // name so multiple generated avatars can coexist in the same DOM
  // (defs are id-scoped per document) without id collisions.
  _hash(name) {
    const str = (name || "?").trim();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return hash;
  },

  // 8. Same as generateDefaultAvatarSVG, but pre-encoded as a data URL
  //    ready to drop straight into an <img src>.
  generateDefaultAvatarDataUrl(name) {
    const svg = this.generateDefaultAvatarSVG(name);
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  },
};

// 9. Global nav avatar sync — intended to run on EVERY page, not just the
// profile page, so the sidebar/bottom-nav account icon reflects whatever
// avatar (custom or generated-default) the user currently has.
//
// Deliberately defensive: localStorage may be empty, corrupted, or the
// target elements may not exist on a given page yet. Any failure here must
// silently fall back to the default SVG icon that already ships in the
// markup - it must never leave the nav in a broken or blank state.
export function syncNavAvatars() {
  const targets = [
    { imgId: "navSidebarAvatar", iconClass: "menu-item-default-icon" },
    { imgId: "navBottomAvatar", iconClass: "bottom-nav-default-icon" },
  ];

  let dataUrl = null;
  try {
    const name = localStorage.getItem("username") || "مستخدم";
    dataUrl = avatarEngine.getAvatar() || avatarEngine.generateDefaultAvatarDataUrl(name);
  } catch (err) {
    console.error("syncNavAvatars: failed to resolve avatar, keeping default icon", err);
    return;
  }

  if (!dataUrl) return;

  // Render Role Badges for Nav Avatars
  let roleInfo = null;
  try {
    roleInfo = getAdminRoleInfo();
  } catch (err) {}

  targets.forEach(({ imgId, iconClass }) => {
    const img = document.getElementById(imgId);
    if (!img) return; // Guard: element not present on this page

    const parent = img.parentElement;
    const icon = parent ? parent.querySelector(`.${iconClass}`) : null;

    if (roleInfo && parent) {
      parent.style.position = "relative";
      let overlay = parent.querySelector(".nav-badge-overlay");

      if (!overlay) {
        overlay = document.createElement("img");
        // Sizing/position/radius/shadow live in side-menu.css (.nav-badge-overlay,
        // with a .bottom-nav-item-profile override for mobile) so every page gets
        // correct badge sizing. Only the animated transform stays inline since
        // it's driven by JS hover listeners below.
        overlay.className = "nav-badge-overlay";
        overlay.style.transform = "rotate(25deg) scale(1)";

        /* Optional hover animation */
        overlay.addEventListener("mouseenter", () => {
          overlay.style.transform = "rotate(35deg) scale(1.15)";
        });
        overlay.addEventListener("mouseleave", () => {
          overlay.style.transform = "rotate(25deg) scale(1)";
        });

        parent.appendChild(overlay);
      }
      overlay.src = roleInfo.isOwner ? "assets/images/white-icon.png" : "favicon.png";
      overlay.style.display = "block";
    }

    // Verify the image actually decodes before swapping it in, so a
    // corrupt data URL can never blank out the nav icon.
    const probe = new Image();
    probe.onload = () => {
      img.src = dataUrl;
      img.style.display = "";
      if (icon) icon.style.display = "none";
    };
    probe.onerror = () => {
      img.style.display = "none";
      if (icon) icon.style.display = "";
    };
    probe.src = dataUrl;
  });
}
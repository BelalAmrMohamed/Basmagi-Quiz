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
const DEFAULT_AVATAR_PALETTE = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#14b8a6",
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

  // 5. Deterministic color pick for a given name, so the same name always
  //    gets the same default-avatar color across sessions/devices.
  colorForName(name) {
    const str = (name || "?").trim();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return DEFAULT_AVATAR_PALETTE[hash % DEFAULT_AVATAR_PALETTE.length];
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
  generateDefaultAvatarSVG(name) {
    const initial = this.initialForName(name);
    const color = this.colorForName(name);
    const escaped = initial.replace(/&/g, "&amp;").replace(/</g, "&lt;");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect width="100" height="100" rx="50" fill="${color}"/>
      <text x="50" y="50" font-family="IBM Plex Sans Arabic, sans-serif" font-size="42" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${escaped}</text>
    </svg>`;
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
        overlay.className = "nav-badge-overlay";

        Object.assign(overlay.style, {
          position: "absolute",
          width: "16px",
          height: "16px",
          top: "3px",
          right: "3px",
          borderRadius: "50%",
          zIndex: "10",
          transform: "rotate(25deg) scale(1)",
          transition: "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
          filter: "drop-shadow(0px 2px 3px rgba(0, 0, 0, 0.25))"
        });

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
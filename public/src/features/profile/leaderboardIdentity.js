// public/src/features/profile/leaderboardIdentity.js
// Visual identity for leaderboard rows:
//   1. Local "bot" fallback leaderboard (profile.js's mockUsers) — each
//      bot gets a deterministic geometric-star avatar (8-point khatam
//      pattern, no figures) drawn from a small accent palette, plus a
//      short poetic Arabic line shown on hover.
//   2. Real admin leaderboard (/api/admin-stats?leaderboard=true) — shows
//      each admin's actual avatar (or generated initial) with a hover
//      card summarizing name / level / points / uploaded quizzes.
//
// Nothing here talks to the network or localStorage directly; callers
// pass in whatever data they already fetched.

import { avatarEngine } from "../../shared/avatarEngine.js";
import { gameEngine } from "../../shared/gameEngine.js";

// ==================== Bot identities ====================

const BOT_PALETTE = [
  ["#0ea5e9", "#0369a1"], // teal-blue
  ["#f59e0b", "#b45309"], // amber
  ["#10b981", "#047857"], // emerald
  ["#a78bfa", "#6d28d9"], // violet
  ["#f472b6", "#be185d"], // rose
  ["#fb923c", "#c2410c"], // orange
];

// One poetic line per named bot — a wry, warm little "character sketch"
// rather than a real bio, in keeping with the tongue-in-cheek bot names
// already used in profile.js's mockUsers list.
const BOT_LORE = {
  "عم فوزي الحريف": "خبرة السنين في عينيه، وحيلة في كل إجابة يهمس بها.",
  "سيد سِكّة": "يمشي في دروب الأسئلة كأنه رسمها بنفسه من زمان.",
  "زيزو حركات": "سريع البديهة، يقفز بين الأسئلة كالعصفور بين الأغصان.",
  "علي علكّه": "هادئ الظاهر، لكنه لا يترك سؤالاً إلا وحلّه بابتسامة.",
  "شيكو الغلبان": "يحارب كل اختبار وكأنه المعركة الأخيرة، ولا يكل.",
  "زيزي على الهادي": "خطوة بخطوة، بلا عجلة، يصعد نحو القمة بصبر جميل.",
};
const DEFAULT_LORE = "اسم جديد يظهر في السجلات، ولمن يعرف حكايته الكاملة؟";

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Deterministic 8-point star / rosette (khatam-style geometric motif —
// no figurative imagery), colored from BOT_PALETTE by name hash. Pure
// vector paths, so it stays crisp at any leaderboard avatar size.
export function generateBotAvatarSVG(name) {
  const hash = hashString(name || "بوت");
  const [from, to] = BOT_PALETTE[hash % BOT_PALETTE.length];
  const rotation = hash % 45; // subtle per-bot variety without looking random

  const points = [];
  const cx = 50, cy = 50, outerR = 40, innerR = 17;
  for (let i = 0; i < 16; i++) {
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    points.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="botGrad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${from}"/>
        <stop offset="100%" stop-color="${to}"/>
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="50" fill="url(#botGrad${hash})"/>
    <g transform="rotate(${rotation} 50 50)" opacity="0.92">
      <polygon points="${points.join(" ")}" fill="none" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" opacity="0.85"/>
      <circle cx="50" cy="50" r="9" fill="#ffffff" opacity="0.9"/>
    </g>
  </svg>`;
}

export function generateBotAvatarDataUrl(name) {
  const svg = generateBotAvatarSVG(name);
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

export function loreForBot(name) {
  return BOT_LORE[name] || DEFAULT_LORE;
}

// ==================== Admin identities ====================

// Builds the small hover card shown for a real admin leaderboard row.
// entry: { handle, displayName, totalQuizzes, currentLevel, avatarUrl? }
export function adminHoverCardHtml(entry) {
  const name = entry.displayName || entry.handle;
  const level = entry.currentLevel || 1;
  const quizzes = (entry.totalQuizzes || 0).toLocaleString();
  const points = typeof entry.totalPoints === "number" ? entry.totalPoints.toLocaleString() : null;

  return `
    <div class="lb-hover-card" role="tooltip">
      <div class="lb-hover-name">${name}</div>
      <div class="lb-hover-stats">
        <span class="lb-hover-stat"><strong>${level}</strong> المستوى</span>
        <span class="lb-hover-stat"><strong>${quizzes}</strong> اختبار مرفوع</span>
        ${points !== null ? `<span class="lb-hover-stat"><strong>${points}</strong> نقطة</span>` : ""}
      </div>
    </div>`;
}

export function adminAvatarUrl(entry) {
  if (entry.avatarUrl) return entry.avatarUrl;
  const svg = avatarEngine.generateDefaultAvatarSVG(entry.displayName || entry.handle);
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}
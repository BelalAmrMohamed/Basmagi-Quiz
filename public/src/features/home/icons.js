// ============================================================================
// public/src/features/home/icons.js
// ICONS — shared inline SVG constants
// ============================================================================
// Centralized here so every module that needs a lock/copy/share/etc. glyph
// imports the same constant instead of re-declaring an identical SVG string
// (as the original file did in several places).

/** `<img src>` for an SVG string. Gradient and filter ids stay inside the image. */
export function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const BASMAGI_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <!-- Main Bulb Gradient -->
    <linearGradient id="bulbGrad" x1="25%" y1="15%" x2="75%" y2="85%">
      <stop offset="0%" stop-color="#FFE600" />
      <stop offset="55%" stop-color="#FFC700" />
      <stop offset="100%" stop-color="#F29400" />
    </linearGradient>

    <!-- Bottom/Right Rim Shadow Gradient -->
    <linearGradient id="bulbShade" x1="30%" y1="30%" x2="80%" y2="90%">
      <stop offset="0%" stop-color="#FF9D00" stop-opacity="0" />
      <stop offset="65%" stop-color="#F08A00" stop-opacity="0.45" />
      <stop offset="100%" stop-color="#E07600" stop-opacity="0.9" />
    </linearGradient>

    <!-- Left Inner Edge Rim -->
    <linearGradient id="leftEdge" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#E58500" stop-opacity="0.85" />
      <stop offset="100%" stop-color="#FFD400" stop-opacity="0" />
    </linearGradient>

    <!-- Metallic Screw Base Horizontal Gradient -->
    <linearGradient id="metalGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#767676" />
      <stop offset="18%" stop-color="#D8D8D8" />
      <stop offset="32%" stop-color="#FFFFFF" />
      <stop offset="48%" stop-color="#8C8C8C" />
      <stop offset="68%" stop-color="#E6E6E6" />
      <stop offset="86%" stop-color="#B0B0B0" />
      <stop offset="100%" stop-color="#6A6A6A" />
    </linearGradient>

    <!-- Metallic Base Bottom Bowl Gradient -->
    <linearGradient id="metalCapGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4A423A" />
      <stop offset="25%" stop-color="#C8C4BE" />
      <stop offset="40%" stop-color="#FFFFFF" />
      <stop offset="62%" stop-color="#7D766E" />
      <stop offset="85%" stop-color="#B8B2AA" />
      <stop offset="100%" stop-color="#4A423A" />
    </linearGradient>

    <!-- Contact Tip Gradient -->
    <radialGradient id="tipGrad" cx="45%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#754916" />
      <stop offset="55%" stop-color="#331E06" />
      <stop offset="100%" stop-color="#0D0701" />
    </radialGradient>

    <!-- Clip Path for Bulb Glass -->
    <clipPath id="bulbClip">
      <path d="M 128 38 C 88 38, 60 66, 60 103 C 60 130, 76 146, 87 161 C 93 170, 96 180, 97 190 C 97.5 193, 100 194, 104 194 L 152 194 C 156 194, 158.5 193, 159 190 C 160 180, 163 170, 169 161 C 180 146, 196 130, 196 103 C 196 66, 168 38, 128 38 Z" />
    </clipPath>
  </defs>

  <!-- Light Rays -->
  <g fill="#FFD500">
    <!-- Top Center (0 deg) -->
    <rect x="125" y="12" width="6" height="16" rx="3" />
    <!-- Top Right Small (~30 deg) -->
    <rect x="171" y="21" width="6" height="16" rx="3" transform="rotate(30 174 29)" />
    <!-- Top Right Large (~45 deg) -->
    <rect x="206" y="34" width="12" height="33" rx="3.5" transform="rotate(45 212 50.5)" />
    <!-- Middle Right (90 deg) -->
    <rect x="212" y="96" width="30" height="12" rx="3.5" />
    <!-- Bottom Right Large (~135 deg) -->
    <rect x="206" y="135" width="12" height="33" rx="3.5" transform="rotate(135 212 151.5)" />
    <!-- Bottom Left Large (~-135 deg) -->
    <rect x="38" y="135" width="12" height="33" rx="3.5" transform="rotate(-135 44 151.5)" />
    <!-- Middle Left (-90 deg) -->
    <rect x="14" y="96" width="30" height="12" rx="3.5" />
    <!-- Top Left Large (~-45 deg) -->
    <rect x="38" y="34" width="12" height="33" rx="3.5" transform="rotate(-45 44 50.5)" />
    <!-- Top Left Small (~-30 deg) -->
    <rect x="79" y="21" width="6" height="16" rx="3" transform="rotate(-30 82 29)" />
  </g>

  <!-- Glass Bulb Body -->
  <g clip-path="url(#bulbClip)">
    <!-- Base Yellow/Orange Fill -->
    <rect x="55" y="35" width="146" height="165" fill="url(#bulbGrad)" />

    <!-- Inner Bright Glow Core -->
    <ellipse cx="122" cy="95" rx="52" ry="50" fill="#FFE600" opacity="0.7" />

    <!-- Right & Bottom Warm Orange Shading -->
    <path d="M 150 38 C 185 45, 200 75, 198 108 C 195 140, 172 158, 162 195 L 94 195 C 94 175, 86 155, 70 135 C 92 145, 128 145, 152 122 C 175 100, 175 62, 150 38 Z" fill="url(#bulbShade)" />

    <!-- Subtle Left Rim Contour -->
    <path d="M 60 38 L 72 38 C 65 75, 65 115, 85 145 C 102 168, 102 182, 102 195 L 94 195 C 94 175, 85 160, 72 142 C 58 122, 58 80, 60 38 Z" fill="url(#leftEdge)" />
  </g>

  <!-- Glossy Highlights (Top-Left) -->
  <path d="M 85 67 C 81 63, 84 56, 91 53 C 97 50, 102 53, 102 58 C 102 63, 95 69, 89 70 C 87 70, 86 69, 85 67 Z" fill="#FFFBE0" opacity="0.85" />
  <ellipse cx="77" cy="78" rx="5" ry="7" transform="rotate(32 77 78)" fill="#FFFBE0" opacity="0.85" />

  <!-- Question Mark -->
  <g fill="#2C1D59">
    <!-- Hook -->
    <path d="M 101.5 93.5 C 101.5 76.5, 112.5 66, 128 66 C 143.5 66, 154 76, 154 90.5 C 154 101.5, 148 107.5, 141 112.5 C 136.5 116, 135.5 118.5, 135.5 124.5 C 135.5 126.5, 134 128, 132 128 L 122.5 128 C 120.5 128, 119 126.5, 119 124.5 L 119 122 C 119 113.5, 122 108.5, 128.5 103.5 C 134 99.5, 137 96.5, 137 91 C 137 85, 133 81.5, 127.5 81.5 C 121.5 81.5, 118.5 85.5, 118.5 92.5 C 118.5 94.5, 117 96, 115 96 L 104 96 C 102.5 96, 101.5 95, 101.5 93.5 Z" />
    <!-- Dot -->
    <rect x="119" y="135" width="17" height="17" rx="3" />
  </g>

  <!-- Metallic Screw Base -->
  <g>
    <!-- Bottom Contact Tip -->
    <path d="M 110 232 C 113 241, 120 245, 128 245 C 136 245, 143 241, 146 232 Z" fill="url(#tipGrad)" />

    <!-- Rounded Base Collar -->
    <path d="M 101 224 C 103 231, 112 235, 128 235 C 144 235, 153 231, 155 224 Z" fill="url(#metalCapGrad)" />

    <!-- Dark Groove 3 -->
    <path d="M 100 221.5 L 156 220 L 155 224.5 L 101 225.5 Z" fill="#2A241E" />

    <!-- Thread Ridge 3 -->
    <path d="M 99.5 217 L 156.5 215.5 C 158 215.5, 158 220.5, 156.5 220.5 L 99.5 222 C 98 222, 98 217, 99.5 217 Z" fill="url(#metalGrad)" />

    <!-- Dark Groove 2 -->
    <path d="M 100 212.5 L 156 211 L 155.5 215.5 L 100.5 217 Z" fill="#2A241E" />

    <!-- Thread Ridge 2 -->
    <path d="M 99.5 208 L 156.5 206.5 C 158 206.5, 158 211.5, 156.5 211.5 L 99.5 213 C 98 213, 98 208, 99.5 208 Z" fill="url(#metalGrad)" />

    <!-- Dark Groove 1 -->
    <path d="M 100 203.5 L 156 202 L 155.5 206.5 L 100.5 208 Z" fill="#2A241E" />

    <!-- Thread Ridge 1 -->
    <path d="M 99.5 199 L 156.5 197.5 C 158 197.5, 158 202.5, 156.5 202.5 L 99.5 204 C 98 204, 98 199, 99.5 199 Z" fill="url(#metalGrad)" />

    <!-- Top Neck Ring -->
    <path d="M 99 194.5 L 157 194.5 L 156.5 198 L 99.5 199.5 Z" fill="url(#metalGrad)" />

    <!-- Bulb-to-Base Contact Seam Shadow -->
    <path d="M 98.5 193.5 Q 128 196.5 157.5 193.5 L 157 195.5 Q 128 198 99 195.5 Z" fill="#261D15" />
  </g>
</svg>`;

// Small lock glyph shown on download buttons/badges for password-protected
// quizzes. Inline SVG (no extra asset request), inherits currentColor.
export const LOCK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

// Trash glyph used by delete actions (exam actions overlay, user-content overlay).
export const TRASH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

// Pencil glyph — used by the "تعديل الامتحان" row inside the Action Overlay
// (shown on all screen sizes; no standalone card icon exists for edit anymore).
export const EDIT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>`;

// Pen-with-corner-fold glyph — used by "تغيير العنوان" (rename) rows. Same
// path data as the right-click context menu's own local RENAME_SVG in
// user-content-folders.js, exported here at this file's 18x18 icon scale
// so the ⋮ dropdown overlay (showUserContentActionsOverlay) can share one
// rename entry point's icon with every other "flow" icon it imports from
// here instead of hand-declaring a duplicate SVG string.
export const RENAME_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

export const COPY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

// Small icon pair for copyable submenu rows (e.g. المصدر) — a copy glyph by
// default, swapped via CSS (.copied) for a checkmark once the value has
// been copied. Sits next to the label so copying never shifts the value.
export const COPY_CHECK_ICON_SVG = `<span class="copy-icon-wrap" aria-hidden="true"><svg class="copy-icon copy-icon--copy" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><svg class="copy-icon copy-icon--check" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>`;

export const SHARE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>`;

// Duplicate/copy-to-collection glyph — distinct from COPY_ICON_SVG (used for
// "نسخ الرابط" / copy link) so "نسخ لامتحاناتي" doesn't share an icon with
// copy-link in the same dropdown menu.
export const DUPLICATE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2v2"/></svg>`;

export const INFO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;

export const DOWNLOAD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;

// Course/quiz info circle-i icon used on category cards' info button.
export const CIRCLE_INFO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;

// Three-dot "more actions" icon used on exam/user-content cards.
export const MORE_DOTS_HORIZONTAL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>`;

export const MORE_DOTS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;


// Download-to-line icon used on the "Download Source" button.
export const DOWNLOAD_SOURCE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-to-line-icon lucide-arrow-down-to-line"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg>`;

// JSON file icon used on the "Download JSON" button.
export const JSON_FILE_ICON_SVG = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-braces-icon lucide-file-braces"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/></svg>`;

// PPTX file icon used on the "Download PPTX" button.
export const PPTX_FILE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <filter id="tileShadow" x="-15%" y="-15%" width="140%" height="140%">
      <feDropShadow dx="1.5" dy="2" stdDeviation="1.8" flood-color="#000000" flood-opacity="0.35" />
    </filter>
  </defs>

  <!-- Background Pie Chart -->
  <g transform="translate(36, 32)">
    <!-- Bottom Half (Darker Burnt Orange) -->
    <path d="M -26,0 A 26,26 0 0,0 26,0 Z" fill="#D24726" />
    
    <!-- Top-Left Quadrant (Medium Coral Orange) -->
    <path d="M 0,0 L -26,0 A 26,26 0 0,1 0,-26 Z" fill="#EB6C4D" />
    
    <!-- Top-Right Quadrant (Light Peach/Salmon Orange) -->
    <path d="M 0,0 L 0,-26 A 26,26 0 0,1 26,0 Z" fill="#FF8F6B" />
  </g>

  <!-- Foreground Rounded Square Tile -->
  <rect x="2.5" y="17" width="30" height="30" rx="3.5" fill="#C43E1C" filter="url(#tileShadow)" />

  <!-- Letter "P" -->
  <path d="M 10,41 V 23 H 18.2 C 21.8,23 24.3,25 24.3,28.7 C 24.3,32.5 21.8,34.5 18.1,34.5 H 13.7 V 41 H 10 Z M 13.7,31.5 H 17.6 C 19.6,31.5 20.6,30.5 20.6,28.7 C 20.6,27 19.6,26 17.6,26 H 13.7 V 31.5 Z" fill="#F8F8F8" />
</svg>`;

// 
export const MD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<defs>
    <linearGradient id="markGradient" gradientUnits="userSpaceOnUse" x1="6" y1="32" x2="58" y2="32">
    <stop offset="0%" stop-color="#6018A8" />
    <stop offset="48%" stop-color="#2B67D9" />
    <stop offset="100%" stop-color="#00B5FF" />
    </linearGradient>
</defs>

<g fill="none" stroke="url(#markGradient)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <!-- Document Outline -->
    <path d="M14 40 V10 A3 3 0 0 1 17 7 H36 L50 21 V40" />

    <!-- Folded Corner -->
    <path d="M36 7 V21 H50" />

    <!-- 3 Horizontal Lines -->
    <path d="M18.5 14.5 H31.5" />
    <path d="M18.5 21.5 H29.5" />
    <path d="M18.5 28.5 H27.5" />

    <!-- Bottom Label Box -->
    <rect x="6" y="40" width="52" height="18" rx="3.5" ry="3.5" />

    <!-- Letter M -->
    <path d="M12.5 53.5 V47.5 A2.2 2.2 0 0 1 16.9 47.5 V53.5 M16.9 47.5 A2.2 2.2 0 0 1 21.3 47.5 V53.5" />

    <!-- Letter A -->
    <path d="M25.5 53.5 L29 45 L32.5 53.5 M26.8 50.8 H31.2" />

    <!-- Letter R -->
    <path d="M36.8 53.5 V45 H40.5 A2.3 2.3 0 0 1 40.5 49.6 H36.8 M40.2 49.6 L43.2 53.5" />

    <!-- Letter K -->
    <path d="M47.5 45 V53.5 M52.5 45 L47.5 49.5 L52.5 53.5" />
</g>
</svg>`;

export const HTML5_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path fill="#E34F26" d="M107.6 471l-33-370.4h362.8l-33 370.2L255.7 512" />
  <path fill="#EF652A" d="M256 480.5V131H404.3L376 447" />
  <path fill="#EBEBEB" d="M142 176.3h114v45.4h-64.2l4.2 46.5h60v45.3H154.4M156.4 336.3H202l3.2 36.3 50.8 13.6v47.4l-93.2-26" />
  <path fill="#FFFFFF" d="M369.6 176.3H255.8v45.4h109.6M361.3 268.2H255.8v45.4h56l-5.3 59-50.7 13.6v47.2l93-25.8" />
  <path fill="#000000" d="M108.4 0h23v22.8h21.2V0h23v69h-23V46h-21v23h-23.2M206 23h-20.3V0h63.7v23H229v46h-23M259.5 0h24.1l14.8 24.3L313.2 0h24.1v69h-23V34.8l-16.1 24.8l-16.1-24.8v34.2h-22.6M348.7 0h23v46.2h32.6V69h-55.6" />
</svg>`;

export const PDF_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <!-- Main Document Body -->
  <path d="M16 4h23l13 13v39c0 2.2-1.8 4-4 4H16c-2.2 0-4-1.8-4-4V8c0-2.2 1.8-4 4-4z" fill="#E52521" />
  
  <!-- Folded Top-Right Corner -->
  <path d="M39 4l13 13H41c-1.1 0-2-.9-2-2V4z" fill="#FF524F" />
  
  <!-- Subtle Shadow Under Fold -->
  <path d="M39 17h13v1.5H39z" fill="#B71C1C" opacity="0.25" />

  <!-- Adobe PDF Trefoil Loop (Scaled & Positioned Above Text) -->
  <g transform="translate(3.2, -1.5) scale(0.9)">
    <path d="M31.6 21.8c-.7 0-1.2.9-1.2 2.4 0 2 .6 4.7 1.6 7.3-1.4 3.4-3.3 6.9-5.1 9.4-2.7 1.1-4.8 2.4-5.1 3.6-.2.7.2 1.5 1.1 1.7.3.1.6.1.9.1 1.5 0 3.3-1.7 5.2-4.6 2.3-.9 4.9-1.6 7.4-2 2.2 1.3 4.3 2.1 5.6 2.1 1.1 0 1.8-.5 2-1.2.2-.8-.3-1.6-1.5-2-1.1-.4-2.9-.5-4.9-.4-1.7-1.2-3.2-2.9-4.3-4.9.8-2.3 1.3-4.6 1.3-6.5 0-3.1-1.2-5-2.9-5zm-.1 1.5c.7 0 1.2 1.2 1.2 3.3 0 1.4-.3 3.2-.9 5-.7-2-1.1-4.1-1.1-5.6 0-1.8.4-2.7.8-2.7zm1.2 10.2c.9 1.5 2.1 2.9 3.4 3.9-2 .3-4 .9-5.8 1.5 1-1.6 1.8-3.5 2.4-5.4zm6.4 4.2c1.4 0 2.6.2 3.2.4.5.2.6.5.5.7-.1.3-.4.4-.8.4-.9 0-2.4-.5-4.1-1.4.4 0 .8-.1 1.2-.1zm-11.5 3.6c-1.4 2.1-2.8 3.3-3.7 3.3-.2 0-.4 0-.5-.1-.3-.1-.4-.3-.3-.6.2-.6 1.7-1.6 4.5-2.6z" fill="#FFFFFF" />
  </g>

  <!-- PDF Text -->
  <text x="32" y="54" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF" text-anchor="middle" letter-spacing="0.5">PDF</text>
</svg>`;

export const ZIP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>`;

export const WORD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <!-- Clip path for the four horizontal stripes of the main document -->
    <clipPath id="doc-clip">
      <rect x="34" y="14" width="80" height="100" rx="6" />
    </clipPath>

    <!-- Drop shadow filter for the foreground "W" tile -->
    <filter id="tile-shadow" x="-15%" y="-15%" width="145%" height="145%">
      <feDropShadow dx="2" dy="3" stdDeviation="3.5" flood-color="#000000" flood-opacity="0.35" />
    </filter>
  </defs>

  <!-- Document Base with 4 Horizontal Blue Bands -->
  <g clip-path="url(#doc-clip)">
    <rect x="34" y="14" width="80" height="25" fill="#41A5EE" />
    <rect x="34" y="39" width="80" height="25" fill="#2B7CD3" />
    <rect x="34" y="64" width="80" height="25" fill="#185ABD" />
    <rect x="34" y="89" width="80" height="25" fill="#103F91" />
  </g>

  <!-- Foreground Square Tile -->
  <rect x="10" y="36" width="54" height="54" rx="6" fill="#185ABD" filter="url(#tile-shadow)" />

  <!-- Bold White "W" Letterform -->
  <path d="M 18.5 48.5 H 24.5 L 28.5 68.5 L 33.8 48.5 H 40.2 L 45.5 68.5 L 49.5 48.5 H 55.5 L 48.5 77.5 H 42.3 L 37.0 58.0 L 31.7 77.5 H 25.5 Z" fill="#FFFFFF" />
</svg>`;

export const MATLAB_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 17-5-5 5-5"/><path d="m16 7 5 5-5 5"/><path d="m14 4-4 16"/></svg>`;

export const YOUTUBE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="240" height="240">
  <path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" />
  <path fill="#FFFFFF" d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
</svg>`;

export const GOOGLE_DRIVE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 232" width="256" height="232">
  <defs>
    <!-- Green to Light Blue Gradient (Top-Left to Bottom-Left transition) -->
    <linearGradient id="green-blue-grad" x1="36%" y1="68%" x2="18%" y2="57%">
      <stop offset="0%" stop-color="#0FA958" />
      <stop offset="100%" stop-color="#6AC1FF" />
    </linearGradient>

    <!-- Blue to Lavender Gradient (Bottom-Left to Bottom-Right transition) -->
    <linearGradient id="blue-purple-grad" x1="35%" y1="84%" x2="55%" y2="95%">
      <stop offset="0%" stop-color="#2684FC" />
      <stop offset="100%" stop-color="#A4A4FF" />
    </linearGradient>

    <!-- Clip path for the rounded triangular outer shape with a transparent center triangle hole -->
    <clipPath id="drive-shape-hole">
      <path fill-rule="evenodd" d="M 80.5 27.4 
               C 101.6 -9.1 154.4 -9.1 175.5 27.4 
               L 248.6 154.0 
               C 269.7 190.5 243.3 232.0 201.1 232.0 
               L 54.9 232.0 
               C 12.7 232.0 -13.7 190.5 7.4 154.0 
               Z
               M 87 112
               L 169 112
               L 128 182
               Z" />
    </clipPath>
  </defs>

  <g clip-path="url(#drive-shape-hole)">
    <!-- Top Green Section with Left Gradient -->
    <polygon points="0,0 256,0 256,112 0,112" fill="url(#green-blue-grad)" />

    <!-- Bottom Left Blue Section with Bottom Gradient -->
    <polygon points="0,112 87,112 157,232 0,232" fill="url(#blue-purple-grad)" />

    <!-- Right Yellow Section -->
    <polygon points="198.5,63 256,162 256,232 157,232 128,182" fill="#FFCA00" />
  </g>
</svg>`;

// Upload icon used on the import-file button in the create-quiz modal.
export const UPLOAD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-upload"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`;

// Copy / download-as-txt icons used by buildCopyDownloadButton.
export const COPY_TEXT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
export const DOWNLOAD_TXT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;

// Admin sign-in / sign-out icons used on the "محتواي" actions bar.
export const ADMIN_SIGN_OUT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="15px" width="15px" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`;
export const ADMIN_SIGN_IN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" height="15px" width="15px" fill="var(--color-text-secondary)"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z"/></svg>`;

// "Select all" checkmark-square icon on the bulk-selection toggle button.
export const CHECK_SQUARE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-square"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;

export const MOVE_TO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9V5c0-1.1.9-2 2-2h3.9c.7 0 1.3.3 1.7.9l.8 1.2c.4.6 1 .9 1.7.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/></svg>`;

// PHASE 2: shared sparkle glyph for "اسأل الباشـمبصمج" entry points
// (user-content-card.js) — same icon ai-agent.js
// already uses for its own FAB/header (SPARKLE_ICON_SVG, defined locally
// there), duplicated here as a shared export so both entry-point call
// sites and the AI Agent module itself stay visually consistent without
// either importing from the other (ai-agent.js is a self-contained
// component per its own header comment, so it doesn't import from
// features/home/, and features/home/ files importing an SVG constant from
// deep inside a component module would be an odd direction of coupling).
export const SPARKLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>`;

// Local ("محتواي") trash panel — entry point on the card's dropdown
// (root-view.js) and the restore action inside the panel itself
// (user-content-trash-panel.js). A simple trash-can-with-arrow glyph, kept
// visually distinct from TRASH_ICON_SVG (delete) so the two aren't confused
// at a glance in the same menu.
export const TRASH_BIN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
export const RESTORE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`;

/** Alert triangle (lucide triangle-alert), amber so it reads on dark and light toasts. */
export const WARNING_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;

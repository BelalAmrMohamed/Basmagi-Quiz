// Self-contained inline SVG icon set for lesson-page controls.
// Keeping the icons in markup avoids emoji/platform rendering differences.

const ICONS = {
  book: '<path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h12.5v16.5H7a2.5 2.5 0 0 0-2.5 2V5.5Z"/><path d="M4.5 21.5A2.5 2.5 0 0 1 7 19h12.5"/><path d="M7 3v16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.5v6"/><path d="M12 7.5h.01"/>',
  settings: '<path d="M12 3.75v2.1M12 18.15v2.1M20.25 12h-2.1M5.85 12h-2.1"/><circle cx="12" cy="12" r="2.75"/><path d="m17.84 6.16-1.48 1.48M7.64 16.36l-1.48 1.48M17.84 17.84l-1.48-1.48M7.64 7.64 6.16 6.16"/>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.6L6 21V4.5Z"/>',
  reset: '<path d="M4.75 9.5A7.5 7.5 0 1 1 6.95 17"/><path d="M4.75 5.5v4h4"/>',
  exam: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h6M8 17h4"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  sparkle: '<path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z"/><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
};

export function lessonIcon(name, className = "") {
  const paths = ICONS[name] || ICONS.info;
  const safeClass = className ? ` ${className}` : "";
  return `<svg class="lesson-icon${safeClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

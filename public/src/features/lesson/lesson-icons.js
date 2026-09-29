// Self-contained inline SVG icon set for lesson-page controls.
// Keeping the icons in markup avoids emoji/platform rendering differences.

const ICONS = {
  book: '<path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h12.5v16.5H7a2.5 2.5 0 0 0-2.5 2V5.5Z"/><path d="M4.5 21.5A2.5 2.5 0 0 1 7 19h12.5"/><path d="M7 3v16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.5v6"/><path d="M12 7.5h.01"/>',
  settings: '<path d="M12 3.75v2.1M12 18.15v2.1M20.25 12h-2.1M5.85 12h-2.1"/><circle cx="12" cy="12" r="2.75"/><path d="m17.84 6.16-1.48 1.48M7.64 16.36l-1.48 1.48M17.84 17.84l-1.48-1.48M7.64 7.64 6.16 6.16"/>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.6L6 21V4.5Z"/>',
  reset: '<path d="M4.75 9.5A7.5 7.5 0 1 1 6.95 17"/><path d="M4.75 5.5v4h4"/>',
};

export function lessonIcon(name, className = "") {
  const paths = ICONS[name] || ICONS.info;
  const safeClass = className ? ` ${className}` : "";
  return `<svg class="lesson-icon${safeClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

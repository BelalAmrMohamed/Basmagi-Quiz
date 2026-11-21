// Inline SVG icons for the admin upload wizard (replaces the emoji it used).
// All use currentColor, so they follow the theme.

const s = (d, extra = "") =>
  `<svg class="adm-ic" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;

export const ICON = {
  cloud: s('<path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1 .5 9z"/><path d="M12 12v6M9.5 14.5L12 12l2.5 2.5"/>'),
  check: s('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  x: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  alert: s('<path d="M12 3l10 17H2z"/><path d="M12 10v4M12 17.5v.5"/>'),
  folder: s('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  course: s('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6"/>'),
  lesson: s('<path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/>'),
  quiz: s('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  notebook: s('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  video: s('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>'),
  playlist: s('<path d="M3 6h12M3 11h12M3 16h7"/><path d="M17 12.5v7l5-3.5z" fill="currentColor"/>'),
  copy: s('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
};

const STATUS = { success: ["check", "var(--color-success)"], error: ["x", "var(--color-error)"], warning: ["alert", "var(--color-warning)"] };

/** Writes "icon + text" into `el`; `text` is inserted as text, never as HTML. */
export function setStatus(el, kind, text) {
  if (!el) return;
  const [icon, color] = STATUS[kind] || STATUS.success;
  el.replaceChildren();
  const ic = document.createElement("span");
  ic.className = "adm-status-ic";
  ic.style.color = color;
  ic.innerHTML = ICON[icon];
  el.append(ic, document.createTextNode(" " + text));
}

// public/src/components/quiz-info-modal/quiz-info-modal-css.js
// Must be always up to date with `quiz-info-modal.css`

export const QuizInfoModalCSS = `
/* ============================================================================
   quiz-info-modal.css
   Shared styles for the "معلومات الامتحان" (Quiz Info) dialog across all pages.
   ============================================================================ */

/* ─── Dialog Shell & Backdrop ─── */
dialog.quiz-info-dialog,
.quiz-info-dialog {
  border: none;
  border-radius: 20px;
  padding: 0;
  background: var(--color-background, #fff);
  box-shadow: var(--shadow-xl, 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04));
  max-width: min(560px, 92vw);
  max-height: min(85vh, 640px);
  width: 100%;
  color: var(--color-text-primary, #111);
  overflow: hidden;
  position: fixed;
  inset: 0;
  margin: auto;
  z-index: 9999;
  direction: rtl;
  text-align: right;
}

.quiz-info-dialog::backdrop {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  scrollbar-gutter: stable;
}

/* Animations */
.quiz-info-dialog[open],
.quiz-info-dialog.is-open {
  animation: dialog-pop-in 0.22s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
}

@keyframes dialog-pop-in {
  from {
    opacity: 0;
    transform: scale(0.93) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* ─── Inner Layout ─── */
.quiz-info-dialog-inner {
  display: flex;
  flex-direction: column;
  max-height: inherit;
}

/* ─── Header ─── */
.quiz-info-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
  position: relative;
  flex-shrink: 0;
}

.quiz-info-dialog-header::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--gradient-accent, linear-gradient(90deg, #3b82f6, #8b5cf6));
  border-radius: 20px 20px 0 0;
}

.quiz-info-dialog-header h2 {
  font-size: 1.1rem;
  font-weight: 700;
  margin: 0;
  line-height: 1.4;
  color: var(--color-primary, #0f6e56);
  opacity: 0;
  transform: translateY(4px);
  animation: dialog-h2-enter 0.4s ease-out forwards;
  transition: color 0.2s ease;
}

@keyframes dialog-h2-enter {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

html[data-motion="reduced"] .quiz-info-dialog-header h2 {
  animation: none;
  opacity: 1;
  transform: none;
}

/* Theme overrides for header */
[data-theme="dark"] .quiz-info-dialog-header h2 {
  color: #5dcaa5;
}
[data-theme="dark-slate"] .quiz-info-dialog-header h2 {
  color: #85b7eb;
}

.quiz-info-dialog-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--color-border, #ccc);
  background: transparent;
  color: var(--color-text-secondary, #6b7280);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.quiz-info-dialog-close:hover {
  background: var(--color-background-secondary, #f3f4f6);
  color: var(--color-text-primary, #111);
  transform: scale(1.08);
}

.quiz-info-dialog-close:focus-visible {
  outline: 2px solid var(--color-primary, #6366f1);
  outline-offset: 2px;
}

/* ─── Body Scrollable Area ─── */
.quiz-info-dialog-body {
  padding: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--color-text-secondary, #9ca3af) transparent;
  background-color: var(--color-background-light, #fafafa);
  flex-grow: 1;
  display: flex;
  flex-direction: column;
}

/* ─── Sections ─── */
.quiz-info-section {
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
}

.quiz-info-section:last-child {
  border-bottom: none;
}

/* Section Titles */
.quiz-info-section-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text-secondary, #6b7280);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Hero Section (Overview) */
.quiz-info-hero {
  background-color: var(--color-background, #fff);
  padding: 24px;
  border-bottom: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
  text-align: center;
}

.quiz-info-hero h3 {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--color-text-primary, #111);
  margin: 0 0 8px 0;
  line-height: 1.3;
}

.quiz-info-hero p.quiz-desc {
  font-size: 0.95rem;
  color: var(--color-text-secondary, #4b5563);
  margin: 0 0 16px 0;
  line-height: 1.6;
}

.quiz-metrics-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.quiz-metric-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 9999px;
  background: var(--color-background-secondary, #f3f4f6);
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-primary, #111);
  border: 1px solid var(--color-border, rgba(0,0,0,0.05));
}

.quiz-metric-pill svg {
  color: var(--color-text-secondary, #6b7280);
}

/* Grid layout for meta info */
.quiz-meta-grid {
  display: grid;
  grid-template-columns: minmax(80px, max-content) 1fr;
  gap: 12px 16px;
  font-size: 0.9rem;
  align-items: start;
}

.quiz-meta-label {
  color: var(--color-text-secondary, #6b7280);
  font-weight: 600;
  direction: rtl;
  text-align: right;
}

.quiz-meta-value {
  color: var(--color-text-primary, #111);
  word-break: break-word;
  direction: ltr;
  text-align: left;
}

.quiz-meta-value a {
  color: var(--color-primary, #3b82f6);
  text-decoration: none;
}
.quiz-meta-value a:hover {
  text-decoration: underline;
}

.quiz-id-badge {
  font-family: monospace;
  background: var(--color-background-secondary, #f3f4f6);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.85em;
  border: 1px solid var(--color-border, #ccc);
  color: var(--color-text-primary, #111);
}

/* Creator Card */
.quiz-creator-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--color-background, #fff);
  border-radius: 12px;
  border: 1px solid var(--color-border, rgba(0,0,0,0.08));
  text-decoration: none;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

a.quiz-creator-card:hover {
  
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  border-color: var(--color-primary, #3b82f6);
}

.quiz-creator-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  background-color: var(--color-background-secondary, #f3f4f6);
  flex-shrink: 0;
}

.quiz-creator-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-grow: 1;
}

.quiz-creator-name {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary, #111);
}

.quiz-creator-handle {
  font-size: 0.85rem;
  color: var(--color-text-secondary, #6b7280);
  direction: ltr;
  text-align: right;
}

.quiz-creator-cta {
  color: var(--color-primary, #3b82f6);
  font-size: 0.85rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0.8;
  transition: opacity 0.2s;
}

a.quiz-creator-card:hover .quiz-creator-cta {
  opacity: 1;
}

/* ─── Info modal loading skeleton (shimmer) ─── */
.info-skeleton { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
.info-skeleton-pills { display: flex; gap: 8px; flex-wrap: wrap; }
.info-skel {
  position: relative; overflow: hidden; border-radius: 8px;
  background: var(--color-bg-hover, rgba(128, 128, 128, 0.18));
}
.info-skel::after {
  content: ""; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.28), transparent);
  animation: info-skel-shimmer 1.4s ease-in-out infinite;
}
@keyframes info-skel-shimmer { to { transform: translateX(100%); } }
.info-skel--title { height: 22px; width: 55%; }
.info-skel--pill { height: 26px; width: 84px; border-radius: 999px; }
.info-skel--row { height: 16px; }
.info-skel--card { height: 58px; border-radius: 14px; }
@media (prefers-reduced-motion: reduce) { .info-skel::after { animation: none; } }

.source-platform-icon { width: 18px; height: 18px; vertical-align: middle; margin-inline-end: 6px; border-radius: 3px; object-fit: contain; }
.info-link-group { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; vertical-align: middle; }
.info-link-group > a { min-width: 0; overflow-wrap: anywhere; }
.info-platform-icon { width: 16px; height: 16px; object-fit: contain; flex: 0 0 auto; }
.info-copy-btn { display: inline-flex; align-items: center; justify-content: center; width: 23px; height: 23px; flex: 0 0 auto; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--color-text-secondary, #64748b); cursor: pointer; }
.info-copy-btn:hover, .info-copy-btn:focus-visible { color: var(--color-primary, #3b82f6); background: var(--color-background-secondary, #f1f5f9); }
.info-copy-btn.copied { color: #16a34a; background: rgba(22, 163, 74, 0.12); }

/* ─── Unified info modal (quiz / lesson / notebook): chips, trail, date tiles ─── */
.info-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; padding: 16px 24px 4px; direction: rtl; }
.info-chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 6px 12px; border-radius: 12px; background: color-mix(in srgb, var(--color-primary, #6366f1) 8%, var(--color-background, #fff)); border: 1px solid color-mix(in srgb, var(--color-primary, #6366f1) 20%, transparent); font-size: 0.85rem; }
.info-chip__label { color: var(--color-text-secondary, #6b7280); font-size: 0.75rem; font-weight: 600; }
.info-chip__value { color: var(--color-text-primary, #111); font-weight: 700; }

.info-location { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 24px 4px; direction: rtl; }
.info-location__label { font-size: 0.75rem; font-weight: 700; color: var(--color-text-secondary, #6b7280); }
.info-trail { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; font-size: 0.9rem; }
.info-trail__course { font-weight: 700; color: var(--color-text-primary, #111); overflow-wrap: anywhere; }
.info-trail__folder { color: var(--color-text-secondary, #4b5563); overflow-wrap: anywhere; }
.info-trail__sep { color: var(--color-text-secondary, #9ca3af); }
.info-local-badge { padding: 3px 10px; border-radius: 9999px; font-size: 0.78rem; font-weight: 700; color: var(--color-text-secondary, #4b5563); background: var(--color-background-secondary, #f3f4f6); border: 1px dashed var(--color-border, #cbd5e1); }

.info-dates { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; padding: 12px 24px 16px; border-bottom: 1px solid var(--color-border, rgba(0, 0, 0, 0.08)); direction: rtl; }
.info-date-tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border-radius: 12px; background: var(--color-background-secondary, #f3f4f6); border: 1px solid var(--color-border, rgba(0, 0, 0, 0.05)); }
.info-date-tile__label { font-size: 0.75rem; font-weight: 600; color: var(--color-text-secondary, #6b7280); }
.info-date-tile__value { font-size: 1rem; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; color: var(--color-text-primary, #111); }

.info-specific > summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 0; user-select: none; }
.info-specific > summary::-webkit-details-marker { display: none; }
.info-specific > summary::after { content: "عرض ▾"; flex: 0 0 auto; padding: 4px 12px; border-radius: 9999px; border: 1px solid color-mix(in srgb, var(--color-primary, #6366f1) 35%, transparent); background: color-mix(in srgb, var(--color-primary, #6366f1) 10%, transparent); color: var(--color-primary, #6366f1); font-size: 0.78rem; font-weight: 700; letter-spacing: 0; text-transform: none; transition: background 0.15s, border-color 0.15s; }
.info-specific > summary:hover::after { background: color-mix(in srgb, var(--color-primary, #6366f1) 18%, transparent); border-color: var(--color-primary, #6366f1); }
.info-specific > summary:focus-visible { outline: 2px solid var(--color-primary, #6366f1); outline-offset: 4px; border-radius: 6px; }
.info-specific[open] > summary { margin-bottom: 12px; }
.info-specific[open] > summary::after { content: "إخفاء ▴"; }
@media (max-width: 600px) { .info-chips, .info-location, .info-dates { padding-inline: 16px; } }

.info-id-footer { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 24px 18px; font-size: 0.75rem; color: var(--color-text-secondary, #6b7280); }
.info-id-footer > span:first-child { font-weight: 700; }

.info-specific .quiz-meta-value { unicode-bidi: plaintext; text-align: left; }

/* Long creator names/handles must never push the card past the dialog. */
.quiz-creator-card { min-width: 0; max-width: 100%; box-sizing: border-box; gap: 12px; }
.quiz-creator-info { min-width: 0; flex: 1 1 0; }
.quiz-creator-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; line-height: 1.35; }
.quiz-creator-handle { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quiz-creator-cta { flex: 0 0 auto; white-space: nowrap; }
@media (max-width: 480px) { .quiz-creator-card { padding: 12px; } .quiz-creator-avatar { width: 40px; height: 40px; } }
`;

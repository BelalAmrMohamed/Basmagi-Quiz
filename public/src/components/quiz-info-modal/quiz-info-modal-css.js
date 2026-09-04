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
  transform: translateY(-2px);
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
`;
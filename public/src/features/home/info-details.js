// ============================================================================
// public/src/features/home/info-details.js
// INFO DETAILS — shared helpers for the quiz / lesson / folder / course info
// modals: on-demand detail fetches (fields the catalog manifest deliberately
// does not download), the shimmer skeleton markup, and the overlay shell used
// by the course and folder modals.
// ============================================================================

import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { escapeHtml } from "./escape-html.js";
import {
  fetchCreatorProfile,
  buildCreatorSectionHtml,
  formatDateForInfo,
} from "../../components/quiz-info-modal/quiz-info-html.js";

export { fetchCreatorProfile, buildCreatorSectionHtml, formatDateForInfo };

/** Fetches one row by id; resolves null on any failure (info is best-effort). */
async function fetchRow(table, id, columns) {
  if (!id) return null;
  try {
    const supabase = await ensureSharedSupabaseClient();
    if (!supabase) return null;
    const { data, error } = await supabase.from(table).select(columns).eq("id", id).maybeSingle();
    if (error) return null;
    return data || null;
  } catch (_) {
    return null;
  }
}

/**
 * Extra quiz facts. `attempt_count` needs the 20261028120000 migration; if it
 * has not been applied yet the first query fails, so retry without it rather
 * than losing every other field.
 */
export async function fetchQuizDetails(dbId) {
  const base = "created_at, synced_at, uploaded_by, college, year, term, education_type";
  return (await fetchRow("quizzes", dbId, `${base}, attempt_count`)) || (await fetchRow("quizzes", dbId, base));
}

export const fetchCourseDetails = (id) => fetchRow("courses", id, "created_at, updated_at, created_by");
export const fetchFolderDetails = (id) => fetchRow("folders", id, "created_at, updated_at, created_by");

/** Creator profile from an account uuid, or null. */
export async function fetchCreatorById(userId) {
  return userId ? fetchCreatorProfile(String(userId), "id") : null;
}

// ── Shimmer skeleton ────────────────────────────────────────────────────────

/**
 * Loading placeholder shaped like the loaded content (title, pills, rows,
 * creator card) so the modal doesn't jump when data arrives.
 */
export function buildInfoSkeletonHtml({ title = true, pills = 3, rows = 5, card = true } = {}) {
  const pillsHtml = Array.from({ length: pills }, () => '<span class="info-skel info-skel--pill"></span>').join("");
  const rowsHtml = Array.from({ length: rows }, (_, i) =>
    `<div class="info-skel info-skel--row" style="width:${i % 2 ? 70 : 92}%"></div>`).join("");
  return `
    <div class="info-skeleton" role="status" aria-busy="true" aria-label="جاري التحميل">
      ${title ? '<div class="info-skel info-skel--title"></div>' : ""}
      ${pills ? `<div class="info-skeleton-pills">${pillsHtml}</div>` : ""}
      ${rowsHtml}
      ${card ? '<div class="info-skel info-skel--card"></div>' : ""}
    </div>`;
}

/** Full dialog inner markup (header + close + skeleton) for `<dialog>` modals. */
export function buildInfoSkeletonDialogHtml(title) {
  return `
    <div class="quiz-info-dialog-inner">
      <div class="quiz-info-dialog-header">
        <h2 id="quizInfoDialogTitle">${escapeHtml(title)}</h2>
        <button class="quiz-info-dialog-close" type="button" aria-label="إغلاق">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div class="quiz-info-dialog-body">${buildInfoSkeletonHtml()}</div>
    </div>`;
}

// ── Table helpers (course / folder modals) ──────────────────────────────────

/** @param {{label:string,val:string|number|null,highlight?:boolean,ltr?:boolean}[]} rows */
export function buildInfoTableHtml(rows) {
  const body = rows
    .filter((r) => r.val !== null && r.val !== undefined && r.val !== "")
    .map(({ label, val, highlight, ltr }) => {
      const v = escapeHtml(String(val));
      const inner = highlight ? `<span class="featured-value">${v}</span>` : ltr ? `<span dir="ltr">${v}</span>` : v;
      return `<tr><th>${escapeHtml(label)}</th><td${highlight ? ' class="featured-value-cell"' : ""}>${inner}</td></tr>`;
    })
    .join("");
  return `<div class="quiz-info-table-wrap"><table class="quiz-info-table"><tbody>${body}</tbody></table></div>`;
}

/**
 * Opens the shared info overlay (same shell the course modal always used).
 * Returns `{ body, close }`: `body` is a container that starts with the
 * shimmer skeleton; callers replace its innerHTML once data is ready.
 */
export function openInfoOverlay({ title, statsHtml = "" }) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const close = () => modal.remove();
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  const card = document.createElement("div");
  card.className = "modal-card quiz-info-modal-card course-info-modal-card";

  const h2 = document.createElement("h2");
  h2.textContent = title;
  card.appendChild(h2);

  if (statsHtml) {
    const stats = document.createElement("div");
    stats.className = "course-info-stats";
    stats.innerHTML = statsHtml;
    card.appendChild(stats);
  }

  const body = document.createElement("div");
  body.innerHTML = buildInfoSkeletonHtml({ title: false, pills: 0, rows: 5, card: true });
  card.appendChild(body);

  // Elegant "x" pinned to the top-left corner (replaces the old text button).
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "info-overlay-close";
  closeBtn.setAttribute("aria-label", "إغلاق");
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  closeBtn.onclick = close;
  card.prepend(closeBtn);

  modal.appendChild(card);
  document.body.appendChild(modal);
  return { body, close, isOpen: () => modal.isConnected };
}
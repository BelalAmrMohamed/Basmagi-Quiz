// public/src/components/quiz-info-modal/quiz-info-html.js
import { escapeHtml } from "../../features/home/escape-html.js";
import { avatarEngine } from "../../shared/avatarEngine.js";

/** Normalise a stored date string down to just its date portion. */
export function formatDateForInfo(raw) {
  if (!raw) return null;
  let d = String(raw);
  // ISO timestamps from the database ("2026-10-28T10:00:00+00:00") → date only.
  if (/^\d{4}-\d{2}-\d{2}T/.test(d)) return d.slice(0, 10);
  if (d.includes(",")) d = d.split(",")[0];
  else if (d.includes(" - ")) d = d.split(" - ")[0];
  else if (d.includes(" ")) d = d.split(" ")[0];
  return d || null;
}

/** Generate a fallback data-URL avatar from a name using avatarEngine */
function getDefaultAvatarDataUrl(name) {
  if (!name) return "";
  try {
    const svg = avatarEngine.generateDefaultAvatarSVG(name);
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  } catch (_) {
    return "";
  }
}

/**
 * Fetches the creator's real account profile from the admin-stats API.
 * Returns { displayName, handle, avatarUrl } or null on failure.
 * @param {string} identifier - The handle or ID of the creator.
 * @param {string} type - 'handle' (default) or 'id'.
 */
export async function fetchCreatorProfile(identifier, type = "handle") {
  if (!identifier) return null;
  const cleanId = identifier.replace(/^@/, "");
  if (!cleanId) return null;
  try {
    const queryParam = type === "id" ? "id" : "handle";
    const res = await fetch(`/api/admin-stats?${queryParam}=${encodeURIComponent(cleanId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      displayName: data.displayName || cleanId,
      handle: data.handle || (type === "handle" ? cleanId : null),
      avatarUrl: data.avatarUrl || null,
    };
  } catch (_) {
    return null;
  }
}

/**
 * "إعداد" creator card section (avatar + name + handle + profile link).
 * Returns "" when there is no profile. Shared by the quiz, course and
 * folder info modals so they all look identical.
 * @param {{displayName?: string, handle?: string|null, avatarUrl?: string|null, profileUrl?: string}|null} creatorProfile
 * @param {string} [sectionTitle]
 */
export function buildCreatorSectionHtml(creatorProfile, sectionTitle = "إعداد") {
  if (!creatorProfile) return "";
  const { displayName, handle, avatarUrl } = creatorProfile;
  const cleanHandle = handle ? handle.replace(/^@/, "") : "";
  const profileHref = creatorProfile.profileUrl || (cleanHandle ? `/@${encodeURIComponent(cleanHandle)}` : null);
  const avatarSrc = avatarUrl || getDefaultAvatarDataUrl(displayName || cleanHandle);

  const WrapperTag = profileHref ? "a" : "div";
  const hrefAttr = profileHref ? ` href="${profileHref}" target="_blank" rel="noopener noreferrer"` : "";

  return `
      <div class="quiz-info-section">
        <div class="quiz-info-section-title">${escapeHtml(sectionTitle)}</div>
        <${WrapperTag} class="quiz-creator-card"${hrefAttr}>
          <img src="${escapeHtml(avatarSrc)}" class="quiz-creator-avatar" alt="" loading="lazy" onerror="this.src='${escapeHtml(getDefaultAvatarDataUrl(displayName || cleanHandle))}'" />
          <div class="quiz-creator-info">
            <span class="quiz-creator-name">${escapeHtml(displayName || cleanHandle)}</span>
            ${cleanHandle ? `<span class="quiz-creator-handle">@${escapeHtml(cleanHandle)}</span>` : ""}
          </div>
          ${profileHref ? `
            <span class="quiz-creator-cta">
              الملف الشخصي
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </span>` : ""}
        </${WrapperTag}>
      </div>
    `;
}

/**
 * Builds the modern modular HTML for the quiz info dialog inner contents.
 * Replaces the old single table with semantic sections.
 *
 * @param {object} config       - Quiz metadata (id, title, description, category, path, etc.)
 * @param {number|null} questionCount
 * @param {object|null} creatorProfile - Account data: { displayName, handle, avatarUrl }
 *                                       Pass null to skip the creator card.
 */
export function buildQuizInfoModalHtml(config, questionCount = null, creatorProfile = null) {
  const isUrl = (s) => /^https?:\/\//i.test(s);
  const linkify = (val) => {
    const v = String(val);
    return isUrl(v)
      ? `<a href="${escapeHtml(v)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v)}</a>`
      : escapeHtml(v);
  };

  // 1. Header
  const headerHtml = `
    <div class="quiz-info-dialog-header">
      <h2 id="quizInfoDialogTitle">معلومات الامتحان</h2>
      <button class="quiz-info-dialog-close" id="quizInfoDialogClose" type="button" aria-label="إغلاق">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  `;

  // 2. Overview / Hero
  const title = config.title || config.id || "بدون عنوان";
  const descHtml = config.description
    ? `<p class="quiz-desc">${escapeHtml(config.description)}</p>`
    : "";

  const pills = [];
  if (questionCount !== null) {
    pills.push(`
      <span class="quiz-metric-pill" title="عدد الأسئلة">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
        ${questionCount} سؤال
      </span>`);
  }
  if (config.questionTypes) {
    pills.push(`
      <span class="quiz-metric-pill" title="أنواع الأسئلة">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        ${escapeHtml(config.questionTypes)}
      </span>`);
  }
  if (typeof config.attemptCount === "number") {
    pills.push(`
      <span class="quiz-metric-pill" title="عدد مرات حل الامتحان">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
        ${config.attemptCount} محاولة
      </span>`);
  }
  if (config.passwordProtected === true) {
    pills.push(`
      <span class="quiz-metric-pill" title="الخصوصية">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        محمي بكلمة مرور
      </span>`);
  }
  if (config.mode) {
    pills.push(`
      <span class="quiz-metric-pill" title="الوضع الإجباري">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        ${escapeHtml(config.mode)}
      </span>`);
  }
  if (config.view) {
    const viewLabel = config.view === "pagination" ? "Pagination" : (config.view === "vertical" ? "Vertical" : config.view);
    pills.push(`
      <span class="quiz-metric-pill" title="الشكل الإجباري">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
        ${escapeHtml(viewLabel)}
      </span>`);
  }

  const pillsHtml = pills.length > 0 ? `<div class="quiz-metrics-row">${pills.join("")}</div>` : "";

  const heroHtml = `
    <div class="quiz-info-hero">
      <h3>${escapeHtml(title)}</h3>
      ${descHtml}
      ${pillsHtml}
    </div>
  `;

  // 3. Classification & Source Grid
  const gridItems = [];

  // Subject (المادة) + folder path. `category` is the category-tree key
  // ("Course/Folder/Sub"), so the first segment is the course and the rest
  // is the folder path inside it.
  const categorySegments = String(config.category || "").split("/").filter(Boolean);
  const subject = categorySegments[0] || "";
  if (subject) {
    gridItems.push(`
      <div class="quiz-meta-label">المادة</div>
      <div class="quiz-meta-value">${escapeHtml(subject)}</div>
    `);
  }
  if (categorySegments.length > 1) {
    gridItems.push(`
      <div class="quiz-meta-label">المجلد</div>
      <div class="quiz-meta-value">${escapeHtml(categorySegments.slice(1).join(" › "))}</div>
    `);
  }
  const extraRows = [
    ["نوع التعليم", config.eduTypeLabel],
    ["الكلية", config.college],
    ["العام", config.year],
    ["الترم", config.term],
  ];
  for (const [label, val] of extraRows) {
    if (val === null || val === undefined || val === "") continue;
    gridItems.push(`
      <div class="quiz-meta-label">${label}</div>
      <div class="quiz-meta-value">${escapeHtml(String(val))}</div>
    `);
  }
  if (typeof config.passwordProtected === "boolean") {
    gridItems.push(`
      <div class="quiz-meta-label">الخصوصية</div>
      <div class="quiz-meta-value">${config.passwordProtected ? "محمي بكلمة مرور" : "عام"}</div>
    `);
  }

  // Date
  const date = formatDateForInfo(config.createdAt);
  if (date) {
    gridItems.push(`
      <div class="quiz-meta-label">التاريخ</div>
      <div class="quiz-meta-value">${escapeHtml(date)}</div>
    `);
  }

  const updated = formatDateForInfo(config.syncedAt);
  if (updated && updated !== date) {
    gridItems.push(`
      <div class="quiz-meta-label">آخر تحديث</div>
      <div class="quiz-meta-value">${escapeHtml(updated)}</div>
    `);
  }

  // Source
  if (config.source) {
    gridItems.push(`
      <div class="quiz-meta-label">المصدر</div>
      <div class="quiz-meta-value">${linkify(config.source)}</div>
    `);
  }

  // On the quiz-taking page the URL is informational text; in library
  // dialogs it is a convenient shareable link.
  if (config.quizUrl) {
    const urlHtml = config.quizUrlAsText
      ? escapeHtml(config.quizUrl)
      : `<a href="${escapeHtml(config.quizUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(config.quizUrl)}</a>`;
    gridItems.push(`
      <div class="quiz-meta-label">رابط الامتحان</div>
      <div class="quiz-meta-value" dir="ltr">${urlHtml}</div>
    `);
  }

  // ID
  if (config.id) {
    gridItems.push(`
      <div class="quiz-meta-label">ID</div>
      <div class="quiz-meta-value"><span class="quiz-id-badge">${escapeHtml(config.id)}</span></div>
    `);
  }

  let classificationHtml = "";
  if (gridItems.length > 0) {
    classificationHtml = `
      <div class="quiz-info-section">
        <div class="quiz-info-section-title">التصنيف والمصدر</div>
        <div class="quiz-meta-grid">
          ${gridItems.join("")}
        </div>
      </div>
    `;
  }

  // 4. Creator Card — use creatorProfile from account, not quiz meta
  const creatorHtml = buildCreatorSectionHtml(creatorProfile);

  // Assemble full inner body
  return `
    <div class="quiz-info-dialog-inner">
      ${headerHtml}
      <div class="quiz-info-dialog-body">
        ${heroHtml}
        ${classificationHtml}
        ${creatorHtml}
      </div>
    </div>
  `;
}
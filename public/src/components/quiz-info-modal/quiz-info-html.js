// public/src/components/quiz-info-modal/quiz-info-html.js
import { infoItemLinkHtml, infoSourceHtml } from "../../shared/info-link.js";
import { escapeHtml } from "../../features/home/escape-html.js";
import { avatarEngine } from "../../shared/avatarEngine.js";
import { buildInfoModel, formatInfoDate, parseQuizPath } from "./info-model.js";

/** Any stored date → "YYYY-MM-DD" (shared by every info modal). */
export function formatDateForInfo(raw) {
  return formatInfoDate(raw);
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
            <span class="quiz-creator-name" title="${escapeHtml(displayName || cleanHandle)}">${escapeHtml(displayName || cleanHandle)}</span>
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

const svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const INFO_ICONS = {
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  sections: '<rect x="3" y="3" width="18" height="6" rx="1"/><rect x="3" y="12" width="18" height="9" rx="1"/>',
  hidden: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  cells: '<rect x="3" y="3" width="18" height="7" rx="1"/><rect x="3" y="14" width="18" height="7" rx="1"/>',
};

/** Metric pill (icon + text); every value escaped. */
export function infoPill(iconPath, text, title = "") {
  return `<span class="quiz-metric-pill" title="${escapeHtml(title)}">${svg(iconPath)}${escapeHtml(text)}</span>`;
}

const CHAIN_SEP = '<span class="info-trail__sep" aria-hidden="true">›</span>';

/**
 * Shared body of every info modal (quiz / lesson / notebook): hero + stat,
 * classification chips, course › folder trail, date tiles, type-specific
 * section, link rows, creator and ID. Empty parts are omitted, never
 * replaced by placeholders. `model` comes from buildInfoModel().
 * @param {ReturnType<typeof buildInfoModel>} model
 * @param {{creatorHtml?: string, creatorSlot?: boolean}} [opts]
 */
export function buildInfoBodyHtml(model, { creatorHtml = "", creatorSlot = false } = {}) {
  const m = model;
  const pills = [...m.pills];
  if (m.passwordProtected) pills.push(infoPill(INFO_ICONS.lock, "محمي بكلمة مرور", "الخصوصية"));
  const e = m.engagement;
  const statHtml = e
    ? `<div class="quiz-attempts-stat" data-info-engagement${e.count === null ? " hidden" : ""} title="${escapeHtml(e.label)}">
        <span class="quiz-attempts-stat__icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg></span>
        <span class="quiz-attempts-stat__value" data-info-engagement-value>${e.count === null ? "" : Number(e.count).toLocaleString("en-US")}</span>
        <span class="quiz-attempts-stat__label">${escapeHtml(e.label)}</span>
      </div>`
    : "";
  const hero = `
    <div class="quiz-info-hero">
      <h3 dir="auto">${escapeHtml(m.title || "بدون عنوان")}</h3>
      ${m.description ? `<p class="quiz-desc">${escapeHtml(m.description)}</p>` : ""}
      ${statHtml}
      ${pills.length ? `<div class="quiz-metrics-row">${pills.join("")}</div>` : ""}
    </div>`;

  const chips = m.classification.length
    ? `<div class="info-chips" role="list">${m.classification.map(([label, value]) =>
        `<span class="info-chip" role="listitem"><span class="info-chip__label">${escapeHtml(label)}</span><span class="info-chip__value">${escapeHtml(value)}</span></span>`).join("")}</div>`
    : "";

  const trail = [];
  if (m.course) trail.push(`<span class="info-trail__course" title="المادة">${escapeHtml(m.course)}</span>`);
  for (const f of m.folders) trail.push(`<span class="info-trail__folder" title="المجلد">${escapeHtml(f)}</span>`);
  const locationHtml = trail.length || m.local
    ? `<div class="info-location">
        ${trail.length ? `<span class="info-location__label">${m.folders.length ? "المادة › المجلد" : "المادة"}</span><div class="info-trail">${trail.join(CHAIN_SEP)}</div>` : ""}
        ${m.local ? '<span class="info-local-badge">محلي · على جهازك</span>' : ""}
      </div>`
    : "";

  const tile = (label, value, title) =>
    `<div class="info-date-tile"><span class="info-date-tile__label">${label}</span><span class="info-date-tile__value" dir="ltr"${title ? ` title="${escapeHtml(title)}"` : ""}>${escapeHtml(value)}</span></div>`;
  const dates = m.created || m.updated
    ? `<div class="info-dates">${m.created ? tile("تاريخ الإنشاء", m.created, m.createdTitle) : ""}${m.updated ? tile("آخر تعديل", m.updated, m.updatedTitle) : ""}</div>`
    : "";

  const specific = m.specific.length
    ? `<details class="quiz-info-section info-specific" open>
        <summary class="quiz-info-section-title">${escapeHtml(m.specificTitle || "التفاصيل")}</summary>
        <div class="quiz-meta-grid">${m.specific.map(([label, value]) =>
          `<div class="quiz-meta-label">${escapeHtml(label)}</div><div class="quiz-meta-value">${typeof value === "object" && value?.html ? value.html : escapeHtml(String(value))}</div>`).join("")}</div>
      </details>`
    : "";

  const linkRows = [];
  if (m.source) linkRows.push(`<div class="quiz-meta-label">المصدر</div><div class="quiz-meta-value">${infoSourceHtml(m.source)}</div>`);
  if (m.link) {
    linkRows.push(`<div class="quiz-meta-label">${escapeHtml(m.linkLabel || "الرابط")}</div><div class="quiz-meta-value" dir="ltr">${infoItemLinkHtml(m.link, m.title, m.linkLabel || "الرابط")}</div>`);
  }
  const links = linkRows.length
    ? `<div class="quiz-info-section"><div class="quiz-info-section-title">الروابط</div><div class="quiz-meta-grid">${linkRows.join("")}</div></div>`
    : "";

  const creator = creatorHtml || (creatorSlot ? '<div data-info-creator-slot><div class="info-skel info-skel--card"></div></div>' : "");
  const idFooter = m.id ? `<div class="info-id-footer"><span>ID</span><span class="quiz-id-badge">${escapeHtml(m.id)}</span></div>` : "";

  return `${hero}${chips}${locationHtml}${dates}${specific}${links}${creator}${idFooter}`;
}

/** Wraps a body in the standard dialog frame (header + close button). */
export function buildInfoDialogHtml(headerTitle, bodyHtml, { titleId = "quizInfoDialogTitle" } = {}) {
  return `
    <div class="quiz-info-dialog-inner">
      <div class="quiz-info-dialog-header">
        <h2 id="${titleId}">${escapeHtml(headerTitle)}</h2>
        <button class="quiz-info-dialog-close" type="button" aria-label="إغلاق">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div class="quiz-info-dialog-body">${bodyHtml}</div>
    </div>`;
}

/**
 * Quiz info dialog contents.
 * @param {object} config - Quiz metadata (id, title, description, category, path, college, year, term, …)
 * @param {number|null} questionCount
 * @param {object|null} creatorProfile - { displayName, handle, avatarUrl } or null
 */
export function buildQuizInfoModalHtml(config, questionCount = null, creatorProfile = null) {
  // Course + folders: explicit values win; otherwise parse the stored path.
  // `category` (legacy "A → B" / "A/B" trail) is only a last resort.
  const parsed = parseQuizPath(config.path, { hasFile: true });
  let course = config.course || parsed.course || "";
  let folders = config.folders || parsed.folders || [];
  if (!course && config.category) {
    const segs = String(config.category).split(/\s*(?:\/|→)\s*/).filter((x) => x && !/^\d+$/.test(x));
    course = segs[0] || "";
    if (!folders.length) folders = segs.slice(1);
  }

  const pills = [];
  if (questionCount !== null) pills.push(infoPill(INFO_ICONS.question, `${questionCount} سؤال`, "عدد الأسئلة"));
  if (config.questionTypes) pills.push(infoPill(INFO_ICONS.upload, config.questionTypes, "أنواع الأسئلة"));
  if (config.mode) pills.push(infoPill(INFO_ICONS.lock, config.mode, "الوضع الإجباري"));
  if (config.view) {
    const viewLabel = config.view === "pagination" ? "Pagination" : (config.view === "vertical" ? "Vertical" : config.view);
    pills.push(infoPill(INFO_ICONS.layout, viewLabel, "الشكل الإجباري"));
  }

  const model = buildInfoModel("quiz", {
    id: config.id,
    title: config.title || config.id,
    description: config.description,
    passwordProtected: config.passwordProtected,
    eduTypeLabel: config.eduTypeLabel,
    eduType: parsed.eduType,
    college: config.college ?? parsed.college,
    year: config.year ?? parsed.year,
    term: config.term ?? parsed.term,
    course,
    folders,
    local: config.local,
    createdAt: config.createdAt,
    updatedAt: config.syncedAt || config.updatedAt,
    source: config.source,
    link: config.quizUrl,
    linkLabel: "رابط الامتحان",
    engagementCount: typeof config.attemptCount === "number" ? config.attemptCount : undefined,
    engagementLabel: "مرة تم حل هذا الامتحان",
    pills,
  });

  return buildInfoDialogHtml("معلومات الامتحان", buildInfoBodyHtml(model, { creatorHtml: buildCreatorSectionHtml(creatorProfile) }));
}

// =============================================================================
// public/src/features/lesson/lesson-comments.js
// "تعليقات الدرس" — Phase 4 community discussion.
//
// Talks to api/college-quiz.js (lessonComments=true). Replies (one level),
// reactions, sort, edit/delete (server-verified via getUserToken()'s
// device-profile JWT), report, pagination, and permalinks all round-trip
// through the real API — this file renders/wires, it never fakes state.
// =============================================================================

import { escapeHtml } from "../home/escape-html.js";
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { getUserToken } from "../../shared/userLevel.js";
import { getToken as getAdminToken, isAdminAuthenticated } from "../../shared/adminAuth.js";
import { renderMarkdown } from "../../shared/markdown.js";
import { attachRichInputHighlighter } from "../../shared/rich-input-highlighter.js";
import { showNotification, _confirm } from "../../components/notifications/notifications.js";

const SORTS = [
  { key: "newest", label: "الأحدث" },
  { key: "most_discussed", label: "الأكثر تفاعلاً" },
  { key: "most_reacted", label: "الأكثر فائدة" },
];

const DRAFT_KEY_PREFIX = "lesson_comment_draft_"; // + lessonId, or + lessonId + ":" + parentId for a reply draft

function draftKey(lessonId, parentId) {
  return `${DRAFT_KEY_PREFIX}${lessonId}${parentId ? `:${parentId}` : ""}`;
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `منذ ${days} يوم`;
  return new Date(iso).toLocaleDateString("ar-EG");
}

export function renderLessonComments() {
  return `<section class="lesson-comments" id="lesson-comments" aria-labelledby="lessonCommentsTitle">
    <div class="lesson-comments__ambient" aria-hidden="true"></div>
    <header class="lesson-comments__head">
      <div class="lesson-comments__identity">
        <span class="lesson-comments__mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-9.5A7.5 7.5 0 0 1 10.5 4H12"/><path d="M15 3h6M18 0v6M7.5 10h7M7.5 14h4"/></svg></span>
        <div class="lesson-comments__heading-copy">
          <span class="lesson-comments__eyebrow">مساحة التعلّم المشتركة</span>
          <h2 id="lessonCommentsTitle">تعليقات الدرس</h2>
          <p>تبادل الأفكار والأسئلة مع زملائك حول هذا الدرس.</p>
        </div>
      </div>
      <div class="lesson-comments__stat" aria-live="polite">
        <strong id="lessonCommentsVisibleCount">0</strong>
        <span>تعليق</span>
      </div>
    </header>
    <div class="lesson-comments__toolbar">
      <span class="lesson-comments__toolbar-label">ترتيب النقاش</span>
      <div class="lesson-comments__sort" role="tablist" aria-label="ترتيب المشاركات">
        ${SORTS.map((s, i) => `<button type="button" class="lesson-comments__sort-btn${i === 0 ? " is-active" : ""}" data-sort="${s.key}" role="tab" aria-selected="${i === 0}">${s.label}</button>`).join("")}
      </div>
    </div>
    <div class="lesson-comments__notice"><span class="lesson-comments__notice-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></svg></span><span>تظهر مشاركتك فوراً. حافظ على نقاش مفيد ومحترم.</span></div>
    <form class="lesson-comments__form lesson-comments__composer" data-role="top-level">
      <div class="lesson-comments__composer-head">
        <span class="lesson-comments__composer-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></span>
        <div><label for="lessonCommentInput">أضف إلى النقاش</label><p>سؤالك أو فكرتك قد تساعد زميلاً آخر.</p></div>
      </div>
      <textarea id="lessonCommentInput" rows="1" dir="auto" maxlength="2000" required placeholder="اكتب مشاركة مفيدة أو اسأل عن نقطة في الدرس…"></textarea>
      <div class="lesson-comments__form-row">
        <span class="lesson-comments__count" dir="ltr" aria-live="polite">0 / 2000</span>
        <button type="submit"><span>إرسال المشاركة</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg></button>
      </div>
    </form>
    <div class="lesson-comments__list" aria-live="polite"><div class="lesson-comments__skeleton"></div><div class="lesson-comments__skeleton"></div></div>
    <button type="button" class="lesson-comments__more" hidden>عرض المزيد من المشاركات</button>
  </section>`;
}

export async function equipLessonComments(root, lessonId) {
  const section = root.querySelector(".lesson-comments");
  if (!section || !lessonId) return;

  const list = section.querySelector(".lesson-comments__list");
  const moreBtn = section.querySelector(".lesson-comments__more");
  const topForm = section.querySelector('.lesson-comments__form[data-role="top-level"]');
  const topTextarea = topForm.querySelector("textarea");
  const topCount = topForm.querySelector(".lesson-comments__count");
  const visibleCount = section.querySelector("#lessonCommentsVisibleCount");

  const state = { sort: "newest", page: 1, comments: [], hasMore: false, myToken: null };
  let activeAuthorCard = null;
  let activeAuthorTrigger = null;
  let activeAuthorParent = null;
  const highlighters = new Map();
  const pendingReactions = new Set();
  let sortRequestVersion = 0;

  function closeAuthorCard() {
    if (activeAuthorCard) {
      activeAuthorCard.hidden = true;
      if (activeAuthorParent?.isConnected) activeAuthorParent.appendChild(activeAuthorCard);
      else activeAuthorCard.remove();
    }
    activeAuthorTrigger?.setAttribute("aria-expanded", "false");
    activeAuthorCard = null;
    activeAuthorTrigger = null;
    activeAuthorParent = null;
  }

  function permalinkFor(id) {
    // Preserve the public lesson route as opened (including a slug when one
    // is used) so copied links always point back to this lesson.
    return `${location.origin}${location.pathname}${location.search}#comment-${encodeURIComponent(id)}`;
  }

  function autoSize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 180 ? "auto" : "hidden";
  }

  const topHighlighter = attachRichInputHighlighter({ textarea: topTextarea, wrapperClass: "lesson-comments__input-wrapper" });
  highlighters.set(topTextarea, topHighlighter);

  function updateTopCount() {
    const length = topTextarea.value.length;
    topCount.textContent = `${length} / 2000`;
    topCount.classList.toggle("is-near-limit", length >= 1800);
    autoSize(topTextarea);
    topHighlighter.refresh();
    // Resizing a capped textarea can make the browser scroll its native text
    // to keep the caret visible after this input handler returns. Refresh once
    // layout/scroll have settled or the syntax mirror lags behind selection.
    requestAnimationFrame(() => {
      if (topTextarea.isConnected) topHighlighter.refresh();
    });
  }

  // Restore a preserved top-level draft (plan step 4.4.8 — survive
  // navigation/accidental close).
  const savedDraft = getFromStorage(draftKey(lessonId), "");
  if (savedDraft) {
    topTextarea.value = savedDraft;
    updateTopCount();
  }
  topTextarea.addEventListener("input", () => {
    updateTopCount();
    setInStorage(draftKey(lessonId), topTextarea.value);
  });
  autoSize(topTextarea);
  topHighlighter.refresh();

  async function ensureToken() {
    if (isAdminAuthenticated()) return getAdminToken();
    if (!state.myToken) state.myToken = await getUserToken();
    return state.myToken;
  }

  function authHeaders(token) {
    return token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      : { "Content-Type": "application/json" };
  }

  function renderReactionControls(comment) {
    const likes = Math.max(0, Number(comment.like_count) || 0);
    const dislikes = Math.max(0, Number(comment.dislike_count) || 0);
    const total = likes + dislikes;
    const likeRatio = total ? Math.round((likes / total) * 100) : 0;
    const dislikeRatio = total ? 100 - likeRatio : 0;
    const likeActive = comment.my_reaction === "like";
    const dislikeActive = comment.my_reaction === "dislike";
    return `<div class="lesson-comment__vote-group" role="group" aria-label="تقييم المشاركة">
      <div class="lesson-comment__vote-buttons">
        <button type="button" class="lesson-comment__react${likeActive ? " is-active" : ""}" data-action="react" data-reaction="like" data-id="${comment.id}" aria-pressed="${likeActive}" aria-label="إعجاب، ${likes}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3ZM7 10l5-8 1.2.4a3 3 0 0 1 1.8 3.8L14 10h5.2a2.8 2.8 0 0 1 2.7 3.5l-1.7 6A3.4 3.4 0 0 1 17 22H7"/></svg>
          <span>إعجاب</span><strong>${likes}</strong>
        </button>
        <button type="button" class="lesson-comment__react${dislikeActive ? " is-active" : ""}" data-action="react" data-reaction="dislike" data-id="${comment.id}" aria-pressed="${dislikeActive}" aria-label="عدم إعجاب، ${dislikes}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M17 14V3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3ZM17 14l-5 8-1.2-.4a3 3 0 0 1-1.8-3.8L10 14H4.8a2.8 2.8 0 0 1-2.7-3.5l1.7-6A3.4 3.4 0 0 1 7 2h10"/></svg>
          <span>عدم إعجاب</span><strong>${dislikes}</strong>
        </button>
      </div>
      <div class="lesson-comment__ratio" aria-label="نسبة الإعجاب ${likeRatio} بالمئة، وعدم الإعجاب ${dislikeRatio} بالمئة">
        <div class="lesson-comment__ratio-labels" dir="ltr"><span>${likeRatio}%</span><span>${dislikeRatio}%</span></div>
        <div class="lesson-comment__ratio-track" dir="ltr"><span class="lesson-comment__ratio-like" style="width:${likeRatio}%"></span><span class="lesson-comment__ratio-dislike" style="width:${dislikeRatio}%"></span></div>
      </div>
    </div>`;
  }

  function renderCommentActions(comment) {
    if (comment.pending) return `<span class="lesson-comment__pending-note" role="status">جارٍ النشر…</span>`;
    const buttons = [renderReactionControls(comment)];
    if (!comment.parent_id) {
      buttons.push(`<button type="button" class="lesson-comment__link" data-action="reply" data-id="${comment.id}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 10 4 15l5 5"/><path d="M4 15h9a7 7 0 0 0 7-7V5"/></svg> رد</button>`);
    }
    if (comment.is_mine) {
      buttons.push(`<button type="button" class="lesson-comment__link" data-action="edit" data-id="${comment.id}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 5 4 4M4 20l4-.8L20 7a2.8 2.8 0 0 0-4-4L4 15l-.8 5Z"/></svg> تعديل</button>`);
      buttons.push(`<button type="button" class="lesson-comment__link lesson-comment__link--danger" data-action="delete" data-id="${comment.id}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg> حذف</button>`);
    } else if (isAdminAuthenticated()) {
      buttons.push(`<button type="button" class="lesson-comment__link lesson-comment__link--danger" data-action="delete" data-id="${comment.id}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg> حذف</button>`);
    } else {
      buttons.push(`<button type="button" class="lesson-comment__link" data-action="report" data-id="${comment.id}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 21V5m0 1c5-5 11 5 16 0v11c-5 5-11-5-16 0"/></svg> إبلاغ</button>`);
    }
    buttons.push(`<button type="button" class="lesson-comment__link" data-action="permalink" data-id="${comment.id}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/></svg><span>نسخ الرابط</span></button>`);
    return buttons.join("");
  }

  function safeImageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const parsed = new URL(value, location.origin);
      return parsed.protocol === "https:" || parsed.origin === location.origin ? parsed.href : "";
    } catch (_) {
      return "";
    }
  }

  function renderAuthorIdentity(comment, author, initials, avatarTone) {
    const official = comment.author_role === "admin" || comment.author_role === "developer";
    if (!official) {
      return `<span class="lesson-comment__avatar lesson-comment__avatar--${avatarTone}" aria-hidden="true">${escapeHtml(initials)}</span>`;
    }
    const avatarUrl = safeImageUrl(comment.author_avatar_url);
    const thumbnailUrl = safeImageUrl(comment.author_thumbnail_url);
    const handle = String(comment.author_handle || "").replace(/^@/, "");
    const profileHref = /^\/@[a-z0-9][a-z0-9._-]{0,49}$/i.test(comment.author_profile_url || "")
      ? comment.author_profile_url
      : (handle ? `/@${encodeURIComponent(handle)}` : "");
    const cardId = `comment-author-${comment.id}`;
    const roleLabel = comment.author_role === "developer" ? "مطور المنصة" : "مشرف";
    return `<span class="lesson-comment__author-identity">
      <button type="button" class="lesson-comment__avatar-button" data-action="author-card" data-id="${comment.id}" aria-label="عرض الملف الشخصي لـ ${escapeHtml(author)}" aria-expanded="false" aria-controls="${cardId}">
        ${avatarUrl ? `<img class="lesson-comment__avatar-image" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy">` : `<span class="lesson-comment__avatar lesson-comment__avatar--${avatarTone}" aria-hidden="true">${escapeHtml(initials)}</span>`}
      </button>
      <span class="lesson-comment__author-card" id="${cardId}" role="dialog" aria-label="الملف الشخصي لـ ${escapeHtml(author)}" hidden>
        ${thumbnailUrl ? `<span class="lesson-comment__author-cover"><img src="${escapeHtml(thumbnailUrl)}" alt="" loading="lazy"></span>` : `<span class="lesson-comment__author-cover lesson-comment__author-cover--plain"></span>`}
        <span class="lesson-comment__author-card-body">
          <span class="lesson-comment__author-card-role">${roleLabel}</span>
          <strong>${escapeHtml(author)}</strong>
          ${handle ? `<span class="lesson-comment__author-card-handle" dir="ltr">@${escapeHtml(handle)}</span>` : ""}
          <span class="lesson-comment__author-card-bio">${escapeHtml(comment.author_bio || "مشارك في تطوير بصمجي ومجتمعها التعليمي.")}</span>
          ${profileHref ? `<a class="lesson-comment__author-profile-link" href="${escapeHtml(profileHref)}">زيارة الملف الشخصي <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg></a>` : ""}
        </span>
      </span>
    </span>`;
  }

  function renderOne(comment, { isReply = false } = {}) {
    const author = String(comment.author || "طالب");
    const initials = Array.from(author.trim())[0] || "ط";
    const avatarTone = (initials.codePointAt(0) || 0) % 5;
    return `<article class="lesson-comment${isReply ? " lesson-comment--reply" : ""}" id="comment-${comment.id}" data-id="${comment.id}">
      <div class="lesson-comment__meta">
        ${renderAuthorIdentity(comment, author, initials, avatarTone)}
        <span class="lesson-comment__author-wrap"><strong>${escapeHtml(author)}</strong>${comment.author_handle ? `<span class="lesson-comment__author-handle" dir="ltr">@${escapeHtml(String(comment.author_handle).replace(/^@/, ""))}</span>` : `<span class="lesson-comment__author-label">${isReply ? "ردّ على النقاش" : "مشارك في الدرس"}</span>`}</span>
        ${comment.author_role ? `<span class="lesson-comment__role-badge">${comment.author_role === "developer" ? "مطور" : "مشرف"}</span>` : ""}
        <time datetime="${escapeHtml(comment.created_at || "")}">${timeAgo(comment.created_at)}</time>
        ${comment.edited_at ? '<span class="lesson-comment__edited">تم التعديل</span>' : ""}
      </div>
      <div class="lesson-comment__body md-content" dir="auto" data-raw-body="${escapeHtml(comment.body || "")}">${renderMarkdown(comment.body || "")}</div>
      <div class="lesson-comment__actions">${renderCommentActions(comment)}</div>
      ${!isReply ? `<div class="lesson-comment__replies">${(comment.replies || []).map((r) => renderOne(r, { isReply: true })).join("")}</div>
      <div class="lesson-comment__reply-slot" data-reply-slot="${comment.id}"></div>` : ""}
    </article>`;
  }

  function findComment(id) {
    for (const parent of state.comments) {
      if (parent.id === id) return parent;
      const reply = (parent.replies || []).find((item) => item.id === id);
      if (reply) return reply;
    }
    return null;
  }

  function syncVisibleCount() {
    if (visibleCount) visibleCount.textContent = String(countVisibleComments(state.comments));
  }

  function appendSubmittedComment(comment, parentId) {
    if (!comment) return;
    comment.replies = [];
    if (parentId) {
      const parent = findComment(parentId);
      const parentArticle = list.querySelector(`.lesson-comment[data-id="${CSS.escape(parentId)}"]`);
      if (!parent) return;
      parent.replies = parent.replies || [];
      parent.replies.push(comment);
      parent.reply_count = (Number(parent.reply_count) || 0) + 1;
      let replies = parentArticle?.querySelector(".lesson-comment__replies");
      if (parentArticle && !replies) {
        parentArticle.querySelector(".lesson-comment__reply-slot")?.insertAdjacentHTML("beforebegin", '<div class="lesson-comment__replies"></div>');
        replies = parentArticle.querySelector(".lesson-comment__replies");
      }
      replies?.insertAdjacentHTML("beforeend", renderOne(comment, { isReply: true }));
    } else {
      state.comments.unshift(comment);
      list.querySelector(".lesson-comments__empty")?.remove();
      list.querySelector(".lesson-comments__permalink-note")?.remove();
      list.insertAdjacentHTML("afterbegin", renderOne(comment));
    }
    syncVisibleCount();
  }

  function replacePendingComment(pendingId, created, parentId) {
    if (!created) return;
    created.replies = [];
    const article = list.querySelector(`.lesson-comment[data-id="${CSS.escape(pendingId)}"]`);
    if (parentId) {
      const parent = findComment(parentId);
      if (parent) {
        const index = (parent.replies || []).findIndex((item) => item.id === pendingId);
        if (index >= 0) parent.replies[index] = created;
      }
      article?.replaceWith(document.createRange().createContextualFragment(renderOne(created, { isReply: true })));
    } else {
      const index = state.comments.findIndex((item) => item.id === pendingId);
      if (index >= 0) state.comments[index] = created;
      article?.replaceWith(document.createRange().createContextualFragment(renderOne(created)));
    }
    syncVisibleCount();
  }

  function removePendingComment(pendingId, parentId) {
    const article = list.querySelector(`.lesson-comment[data-id="${CSS.escape(pendingId)}"]`);
    article?.remove();
    if (parentId) {
      const parent = findComment(parentId);
      if (parent) {
        const before = (parent.replies || []).length;
        parent.replies = (parent.replies || []).filter((item) => item.id !== pendingId);
        if (parent.replies.length < before) parent.reply_count = Math.max(0, (Number(parent.reply_count) || before) - 1);
      }
    } else {
      state.comments = state.comments.filter((item) => item.id !== pendingId);
      if (!state.comments.length) {
        list.insertAdjacentHTML("afterbegin", '<div class="lesson-comments__empty"><strong>ابدأ أول نقاش</strong><span>لا توجد مشاركات منشورة بعد. شارك فكرة أو سؤالاً لتبدأ المحادثة.</span></div>');
      }
    }
    syncVisibleCount();
  }

  function setEditedComment(comment, body, editedAt) {
    if (!comment) return;
    comment.body = body;
    comment.edited_at = editedAt || null;
    const article = list.querySelector(`.lesson-comment[data-id="${CSS.escape(comment.id)}"]`);
    if (!article) return;
    const bodyEl = article.querySelector(".lesson-comment__body");
    if (bodyEl) {
      bodyEl.innerHTML = renderMarkdown(body);
      bodyEl.dataset.rawBody = body;
      bodyEl.hidden = false;
    }
    article.querySelector(".lesson-comment__edit-form")?.remove();
    if (comment.edited_at && !article.querySelector(".lesson-comment__edited")) {
      article.querySelector(".lesson-comment__meta time")?.insertAdjacentHTML("afterend", '<span class="lesson-comment__edited">تم التعديل</span>');
    }
    if (!comment.edited_at) article.querySelector(".lesson-comment__edited")?.remove();
  }

  function countVisibleComments(comments) {
    return (comments || []).reduce((count, comment) => count + 1 + (comment.replies?.length || 0), 0);
  }

  function sortLoadedComments() {
    const metric = (comment) => state.sort === "most_reacted"
      ? (Number(comment.like_count) || 0) + (Number(comment.dislike_count) || 0)
      : Number(comment.reply_count ?? comment.replies?.length ?? 0);
    state.comments.sort((a, b) => {
      if (state.sort !== "newest" && metric(a) !== metric(b)) return metric(b) - metric(a);
      return new Date(b.created_at) - new Date(a.created_at);
    });
    for (const comment of state.comments) {
      const article = [...list.children].find((node) => node.matches?.(".lesson-comment") && node.dataset.id === comment.id);
      if (article) list.appendChild(article);
    }
  }

  function updateSortSelection() {
    section.querySelectorAll(".lesson-comments__sort-btn").forEach((btn) => {
      const active = btn.dataset.sort === state.sort;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
  }

  function showInteractionError(message) {
    section.querySelector(".lesson-comments__error-note")?.remove();
    const note = document.createElement("p");
    note.className = "lesson-comments__error-note";
    note.setAttribute("role", "alert");
    note.textContent = message || "تعذر تنفيذ هذا الإجراء. حاول مرة أخرى.";
    section.querySelector(".lesson-comments__toolbar")?.insertAdjacentElement("afterend", note);
    setTimeout(() => note.remove(), 6000);
  }

  function clearInteractionError() {
    section.querySelector(".lesson-comments__error-note")?.remove();
  }

  function applyReaction(comment, next) {
    const previous = comment.my_reaction || null;
    if (previous === next) return;
    if (previous) {
      const key = previous === "like" ? "like_count" : "dislike_count";
      comment[key] = Math.max(0, (Number(comment[key]) || 0) - 1);
    }
    if (next) {
      const key = next === "like" ? "like_count" : "dislike_count";
      comment[key] = (Number(comment[key]) || 0) + 1;
    }
    comment.my_reaction = next;
  }

  function refreshReactionControls(comment, article) {
    const group = article?.querySelector(".lesson-comment__vote-group");
    if (group) group.outerHTML = renderReactionControls(comment);
  }

  function render() {
    closeAuthorCard();
    if (visibleCount) visibleCount.textContent = String(countVisibleComments(state.comments));
    if (!state.comments.length) {
      list.innerHTML = state.page === 1 ? `<div class="lesson-comments__empty"><span class="lesson-comments__empty-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 12h8M8 9h5"/></svg></span><strong>ابدأ أول نقاش</strong><span>لا توجد مشاركات منشورة بعد. شارك فكرة أو سؤالاً لتبدأ المحادثة.</span></div>` : list.innerHTML;
    } else {
      const html = state.comments.map((c) => renderOne(c)).join("");
      list.innerHTML = html;
    }
    moreBtn.hidden = !state.hasMore;
    section.querySelectorAll(".lesson-comments__sort-btn").forEach((btn) => {
      const active = btn.dataset.sort === state.sort;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    maybeScrollToPermalink();
  }

  function maybeScrollToPermalink() {
    if (!location.hash.startsWith("#comment-")) return;
    const target = section.querySelector(location.hash);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("lesson-comment--highlighted");
      setTimeout(() => target.classList.remove("lesson-comment--highlighted"), 2000);
    }
  }

  async function load({ append = false } = {}) {
    if (!append) {
      list.innerHTML = '<div class="lesson-comments__skeleton"></div><div class="lesson-comments__skeleton"></div><div class="lesson-comments__skeleton"></div>';
    }
    try {
      const token = await ensureToken();
      const params = new URLSearchParams({ lessonComments: "true", lessonId, sort: state.sort, page: String(state.page) });
      const res = await fetch(`/api/college-quiz?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل تحميل النقاش");
      state.comments = append ? [...state.comments, ...(data.comments || [])] : (data.comments || []);
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) {
      if (!append) list.innerHTML = `<p class="lesson-comments__error">${escapeHtml(err.message || "تعذر تحميل النقاش حالياً.")}</p>`;
    }
  }

  // If the URL already points at a specific comment, fetch it directly via
  // the permalink endpoint so it resolves even off the current page/sort.
  async function loadPermalinkIfPresent() {
    const match = location.hash.match(/^#comment-([0-9a-f-]{36})$/i);
    if (!match) return false;
    try {
      const token = await ensureToken();
      const params = new URLSearchParams({ lessonComments: "true", lessonId, commentId: match[1] });
      const res = await fetch(`/api/college-quiz?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await res.json();
      if (!res.ok) return false;
      const context = data.parent ? { ...data.parent, reply_count: Math.max(Number(data.parent.reply_count) || 0, 1), replies: [data.comment] } : data.comment;
      state.comments = context ? [context] : [];
      syncVisibleCount();
      list.innerHTML = `<div class="lesson-comments__permalink-note">عرض هذه المشاركة وسياقها في النقاش</div>` + (context ? renderOne(context) : "");
      moreBtn.hidden = true;
      maybeScrollToPermalink();
      return true;
    } catch (_) {
      return false;
    }
  }

  function openReplyComposer(parentId) {
    const slot = section.querySelector(`[data-reply-slot="${parentId}"]`);
    if (!slot) return;
    if (slot.querySelector("form")) { slot.querySelector("textarea")?.focus(); return; }
    const saved = getFromStorage(draftKey(lessonId, parentId), "");
    slot.innerHTML = `<form class="lesson-comments__form lesson-comments__form--reply" data-role="reply" data-parent="${parentId}">
      <textarea dir="auto" maxlength="2000" required placeholder="اكتب ردك…">${escapeHtml(saved)}</textarea>
      <div class="lesson-comments__form-row">
        <button type="button" data-action="cancel-reply">إلغاء</button>
        <button type="submit">إرسال الرد</button>
      </div>
    </form>`;
    const textarea = slot.querySelector("textarea");
    const highlighter = attachRichInputHighlighter({ textarea, wrapperClass: "lesson-comments__input-wrapper" });
    highlighters.set(textarea, highlighter);
    autoSize(textarea);
    highlighter.refresh();
    textarea.addEventListener("input", () => setInStorage(draftKey(lessonId, parentId), textarea.value));
    textarea.focus();
  }

  async function submitComment({ body, parentId, button }) {
    button.disabled = true;
    try {
      const token = await ensureToken();
      const res = await fetch("/api/college-quiz?lessonComments=true", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ action: "submit-lesson-comment", lesson_id: lessonId, body, parent_id: parentId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "تعذر إرسال التعليق.");
      setInStorage(draftKey(lessonId, parentId), "");
      return data.comment || null;
    } catch (err) {
      showInteractionError(err.message || "تعذر إرسال التعليق.");
      return null;
    } finally {
      button.disabled = false;
    }
  }

  function showPublishedNotice(text) {
    clearInteractionError();
    section.querySelector(".lesson-comments__success-note")?.remove();
    topForm.insertAdjacentHTML("afterend", `<p class="lesson-comments__success-note" role="status">${escapeHtml(text)}</p>`);
    setTimeout(() => section.querySelector(".lesson-comments__success-note")?.remove(), 4200);
  }

  topForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = topForm.querySelector("button[type=submit]");
    if (button?.disabled) return;
    const body = topTextarea.value.trim();
    if (!body) return;
    button.disabled = true;
    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    appendSubmittedComment({ id: pendingId, body, author: "أنت", created_at: new Date().toISOString(), parent_id: null, replies: [], like_count: 0, dislike_count: 0, is_mine: false, pending: true });
    topTextarea.value = "";
    setInStorage(draftKey(lessonId), "");
    updateTopCount();
    const created = await submitComment({ body, button });
    if (created) {
      replacePendingComment(pendingId, created);
      showPublishedNotice("نُشرت مشاركتك في النقاش.");
    } else {
      removePendingComment(pendingId);
      topTextarea.value = body;
      setInStorage(draftKey(lessonId), body);
      updateTopCount();
    }
  });

  section.querySelectorAll(".lesson-comments__sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.sort === state.sort) return;
      const previousSort = state.sort;
      const previousPage = state.page;
      state.sort = btn.dataset.sort;
      state.page = 1;
      sortLoadedComments();
      updateSortSelection();
      const requestVersion = ++sortRequestVersion;
      (async () => {
        try {
          const token = await ensureToken();
          const params = new URLSearchParams({ lessonComments: "true", lessonId, sort: state.sort, page: "1" });
          const res = await fetch(`/api/college-quiz?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "تعذر ترتيب المشاركات.");
          if (requestVersion !== sortRequestVersion) return;
          state.comments = data.comments || [];
          state.hasMore = !!data.hasMore;
          clearInteractionError();
          render();
        } catch (err) {
          if (requestVersion !== sortRequestVersion) return;
          state.sort = previousSort;
          state.page = previousPage;
          sortLoadedComments();
          updateSortSelection();
          showInteractionError(err.message || "تعذر ترتيب المشاركات.");
        }
      })();
    });
  });

  moreBtn.addEventListener("click", () => {
    state.page += 1;
    load({ append: true });
  });

  list.addEventListener("submit", async (event) => {
    const form = event.target.closest('form[data-role="reply"]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    if (button?.disabled) return;
    const parentId = form.dataset.parent;
    const textarea = form.querySelector("textarea");
    const body = textarea.value.trim();
    if (!body) return;
    button.disabled = true;
    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    appendSubmittedComment({ id: pendingId, body, author: "أنت", created_at: new Date().toISOString(), parent_id: parentId, replies: [], like_count: 0, dislike_count: 0, is_mine: false, pending: true }, parentId);
    const created = await submitComment({ body, parentId, button });
    if (created) {
      replacePendingComment(pendingId, created, parentId);
      const textarea = form.querySelector("textarea");
      highlighters.get(textarea)?.destroy();
      highlighters.delete(textarea);
      form.remove();
      showPublishedNotice("نُشر ردك في النقاش.");
    } else {
      removePendingComment(pendingId, parentId);
    }
  });

  list.addEventListener("click", async (event) => {
    const cancelBtn = event.target.closest('[data-action="cancel-reply"]');
    if (cancelBtn) {
      const slot = cancelBtn.closest("[data-reply-slot]");
      const textarea = slot?.querySelector("textarea");
      highlighters.get(textarea)?.destroy();
      highlighters.delete(textarea);
      if (slot) slot.innerHTML = "";
      return;
    }

    const actionBtn = event.target.closest("[data-action]");
    if (!actionBtn) return;
    const { action, id } = actionBtn.dataset;

    if (action === "author-card") {
      if (activeAuthorTrigger === actionBtn) {
        closeAuthorCard();
        return;
      }
      const card = actionBtn.parentElement.querySelector(".lesson-comment__author-card");
      const open = card?.hidden;
      if (card && open) {
        closeAuthorCard();
        activeAuthorParent = card.parentElement;
        document.body.appendChild(card);
        card.hidden = false;
        actionBtn.setAttribute("aria-expanded", "true");
        const rect = actionBtn.getBoundingClientRect();
        const gap = 10;
        const width = Math.min(320, window.innerWidth - 24);
        card.style.position = "fixed";
        card.style.setProperty("--community-accent", getComputedStyle(section).getPropertyValue("--community-accent").trim());
        card.style.width = `${width}px`;
        card.style.maxHeight = `${Math.max(180, window.innerHeight - 24)}px`;
        card.style.overflowY = "auto";
        card.style.bottom = "auto";
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
        card.style.left = `${left}px`;
        card.style.right = "auto";
        card.style.top = `${Math.max(12, Math.min(rect.bottom + gap, window.innerHeight - Math.min(card.offsetHeight || 280, window.innerHeight - 24) - 12))}px`;
        activeAuthorCard = card;
        activeAuthorTrigger = actionBtn;
      }
      return;
    }

    if (action === "reply") return openReplyComposer(id);

    if (action === "permalink") {
      const shareUrl = permalinkFor(id);
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareUrl);
        } else {
          const helper = document.createElement("textarea");
          helper.value = shareUrl;
          helper.setAttribute("readonly", "");
          helper.style.position = "fixed";
          helper.style.opacity = "0";
          document.body.appendChild(helper);
          helper.select();
          const copied = document.execCommand("copy");
          helper.remove();
          if (!copied) throw new Error("تعذّر نسخ الرابط.");
        }
        const label = actionBtn.querySelector("span");
        if (label) {
          label.textContent = "تم نسخ الرابط";
          actionBtn.classList.add("is-copied");
          window.setTimeout(() => {
            if (label.isConnected) label.textContent = "نسخ الرابط";
            actionBtn.classList.remove("is-copied");
          }, 2200);
        }
        showPublishedNotice("تم نسخ رابط المشاركة.");
      } catch (_) {
        showInteractionError("تعذّر نسخ الرابط. حاول مرة أخرى.");
      }
      return;
    }

    if (action === "react") {
      if (pendingReactions.has(id)) return;
      const comment = findComment(id);
      const article = actionBtn.closest(".lesson-comment");
      if (!comment || !article) return;
      const before = {
        my_reaction: comment.my_reaction || null,
        like_count: Number(comment.like_count) || 0,
        dislike_count: Number(comment.dislike_count) || 0,
      };
      const requested = actionBtn.dataset.reaction;
      const optimistic = comment.my_reaction === requested ? null : requested;
      applyReaction(comment, optimistic);
      refreshReactionControls(comment, article);
      pendingReactions.add(id);
      const voteGroup = article.querySelector(".lesson-comment__vote-group");
      voteGroup?.setAttribute("aria-busy", "true");
      voteGroup?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      try {
        const token = await ensureToken();
        if (!token) throw new Error("تعذر التحقق من هويتك. سجّل الدخول ثم حاول مرة أخرى.");
        const res = await fetch("/api/college-quiz?lessonComments=true", {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ action: "react-lesson-comment", comment_id: id, reaction: actionBtn.dataset.reaction }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "تعذر تسجيل التفاعل.");
        applyReaction(comment, data.my_reaction || null);
        clearInteractionError();
        refreshReactionControls(comment, article);
      } catch (err) {
        Object.assign(comment, before);
        refreshReactionControls(comment, article);
        showInteractionError(err.message);
      } finally {
        pendingReactions.delete(id);
        const currentGroup = article.querySelector(".lesson-comment__vote-group");
        currentGroup?.removeAttribute("aria-busy");
        currentGroup?.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      }
      return;
    }

    if (action === "edit") {
      const article = actionBtn.closest(".lesson-comment");
      const bodyEl = article.querySelector(".lesson-comment__body");
      const current = bodyEl.dataset.rawBody || bodyEl.textContent;
      if (article.querySelector(".lesson-comment__edit-form")) return;
      bodyEl.insertAdjacentHTML(
        "afterend",
        `<form class="lesson-comment__edit-form"><textarea dir="auto" maxlength="2000">${escapeHtml(current)}</textarea><div class="lesson-comments__form-row"><button type="button" data-action="cancel-edit">إلغاء</button><button type="submit">حفظ</button></div></form>`
      );
      bodyEl.hidden = true;
      const editTextarea = article.querySelector(".lesson-comment__edit-form textarea");
      highlighters.set(editTextarea, attachRichInputHighlighter({ textarea: editTextarea, wrapperClass: "lesson-comments__input-wrapper" }));
      return;
    }

    if (action === "cancel-edit") {
      const article = actionBtn.closest(".lesson-comment");
      const textarea = article.querySelector(".lesson-comment__edit-form textarea");
      highlighters.get(textarea)?.destroy();
      highlighters.delete(textarea);
      article.querySelector(".lesson-comment__edit-form").remove();
      article.querySelector(".lesson-comment__body").hidden = false;
      return;
    }

    if (action === "delete") {
      if (!await _confirm("هل تريد حذف هذا التعليق؟")) return;
      const comment = findComment(id);
      const article = actionBtn.closest(".lesson-comment");
      if (!comment || !article) return;
      const previousComments = JSON.parse(JSON.stringify(state.comments));
      if (comment.parent_id) {
        const parent = findComment(comment.parent_id);
        if (parent) parent.replies = (parent.replies || []).filter((reply) => reply.id !== id);
      } else {
        state.comments = state.comments.filter((entry) => entry.id !== id);
      }
      render();
      try {
        const token = await ensureToken();
        if (!token) throw new Error("تعذر التحقق من هويتك. سجّل الدخول ثم حاول مرة أخرى.");
        const res = await fetch("/api/college-quiz?lessonComments=true", {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ action: "delete-lesson-comment", comment_id: id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "تعذر حذف التعليق.");
        clearInteractionError();
      } catch (err) {
        state.comments = previousComments;
        render();
        showInteractionError(err.message);
      }
      return;
    }

    if (action === "report") {
      const reason = prompt("سبب البلاغ:");
      if (!reason || !reason.trim()) return;
      const token = await ensureToken();
      try {
        const res = await fetch("/api/college-quiz?lessonComments=true", {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ action: "report-lesson-comment", comment_id: id, reason: reason.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        alert("تم إرسال البلاغ، شكراً لك.");
      } catch (err) {
        alert(err.message || "تعذر إرسال البلاغ.");
      }
      return;
    }
  });

  const handleDocumentClick = (event) => {
    if (event.target.closest(".lesson-comment__author-identity, .lesson-comment__author-card")) return;
    closeAuthorCard();
  };
  const handleDocumentKeydown = (event) => {
    if (event.key === "Escape") closeAuthorCard();
  };
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);

  list.addEventListener("submit", async (event) => {
    const form = event.target.closest(".lesson-comment__edit-form");
    if (!form) return;
    event.preventDefault();
    const article = form.closest(".lesson-comment");
    const id = article.dataset.id;
    const body = form.querySelector("textarea").value.trim();
    if (!body) return;
    const comment = findComment(id);
    if (!comment) return;
    const before = { body: comment.body, edited_at: comment.edited_at };
    const editedAt = new Date().toISOString();
    const textarea = form.querySelector("textarea");
    highlighters.get(textarea)?.destroy();
    highlighters.delete(textarea);
    setEditedComment(comment, body, editedAt);
    try {
      const token = await ensureToken();
      const res = await fetch("/api/college-quiz?lessonComments=true", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ action: "edit-lesson-comment", comment_id: id, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "تعذر تعديل التعليق.");
      comment.edited_at = data.edited_at || editedAt;
      clearInteractionError();
    } catch (err) {
      setEditedComment(comment, before.body, before.edited_at);
      showInteractionError(err.message);
    }
  });

  (async () => {
    const handledPermalink = await loadPermalinkIfPresent();
    if (!handledPermalink) load();
  })();

  return () => {
    closeAuthorCard();
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("keydown", handleDocumentKeydown);
    for (const highlighter of highlighters.values()) highlighter.destroy();
    highlighters.clear();
  };
}

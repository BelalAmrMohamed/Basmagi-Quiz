// =============================================================================
// public/src/features/lesson/lesson-comments.js
// "مجتمع الدرس" — Phase 4 community discussion.
//
// Talks to api/college-quiz.js (lessonComments=true). Replies (one level),
// reactions, sort, edit/delete (server-verified via getUserToken()'s
// device-profile JWT), report, pagination, and permalinks all round-trip
// through the real API — this file renders/wires, it never fakes state.
// =============================================================================

import { escapeHtml } from "../home/escape-html.js";
import { getFromStorage, setInStorage } from "../../shared/storage-helpers.js";
import { getUserToken } from "../../shared/userLevel.js";

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
  return `<section class="lesson-comments" aria-labelledby="lessonCommentsTitle">
    <div class="lesson-comments__head">
      <h2 id="lessonCommentsTitle">مجتمع الدرس</h2>
      <div class="lesson-comments__sort" role="tablist" aria-label="ترتيب المشاركات">
        ${SORTS.map((s, i) => `<button type="button" class="lesson-comments__sort-btn${i === 0 ? " is-active" : ""}" data-sort="${s.key}" role="tab" aria-selected="${i === 0}">${s.label}</button>`).join("")}
      </div>
    </div>
    <p class="lesson-comments__hint">شارك فكرة أو اسأل أو ناقش نقطة في الدرس. تُراجع المشاركات قبل نشرها.</p>
    <div class="lesson-comments__list" aria-live="polite"><div class="lesson-comments__skeleton"></div><div class="lesson-comments__skeleton"></div></div>
    <button type="button" class="lesson-comments__more" hidden>عرض المزيد</button>
    <form class="lesson-comments__form" data-role="top-level">
      <label>اكتب تعليقك
        <textarea maxlength="2000" required placeholder="شارك سؤالاً أو ملاحظة أو شرحاً مفيداً لزملائك…"></textarea>
      </label>
      <div class="lesson-comments__form-row">
        <span class="lesson-comments__count">0 / 2000</span>
        <button type="submit">إرسال التعليق</button>
      </div>
    </form>
  </section>`;
}

export function equipLessonComments(root, lessonId) {
  const section = root.querySelector(".lesson-comments");
  if (!section || !lessonId) return;

  const list = section.querySelector(".lesson-comments__list");
  const moreBtn = section.querySelector(".lesson-comments__more");
  const topForm = section.querySelector('.lesson-comments__form[data-role="top-level"]');
  const topTextarea = topForm.querySelector("textarea");
  const topCount = topForm.querySelector(".lesson-comments__count");

  const state = { sort: "newest", page: 1, comments: [], hasMore: false, myToken: null };

  // Restore a preserved top-level draft (plan step 4.4.8 — survive
  // navigation/accidental close).
  const savedDraft = getFromStorage(draftKey(lessonId), "");
  if (savedDraft) {
    topTextarea.value = savedDraft;
    topCount.textContent = `${savedDraft.length} / 2000`;
  }
  topTextarea.addEventListener("input", () => {
    topCount.textContent = `${topTextarea.value.length} / 2000`;
    setInStorage(draftKey(lessonId), topTextarea.value);
  });

  async function ensureToken() {
    if (!state.myToken) state.myToken = await getUserToken();
    return state.myToken;
  }

  function authHeaders(token) {
    return token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      : { "Content-Type": "application/json" };
  }

  function renderReactionButton(comment) {
    return `<button type="button" class="lesson-comment__react${comment.reacted_by_me ? " is-active" : ""}" data-action="react" data-id="${comment.id}" aria-pressed="${comment.reacted_by_me}">
      <span aria-hidden="true">👍</span> مفيد${comment.reaction_count ? ` (${comment.reaction_count})` : ""}
    </button>`;
  }

  function renderCommentActions(comment) {
    const buttons = [renderReactionButton(comment)];
    if (!comment.parent_id) {
      buttons.push(`<button type="button" class="lesson-comment__link" data-action="reply" data-id="${comment.id}">رد</button>`);
    }
    if (comment.is_mine) {
      buttons.push(`<button type="button" class="lesson-comment__link" data-action="edit" data-id="${comment.id}">تعديل</button>`);
      buttons.push(`<button type="button" class="lesson-comment__link lesson-comment__link--danger" data-action="delete" data-id="${comment.id}">حذف</button>`);
    } else {
      buttons.push(`<button type="button" class="lesson-comment__link" data-action="report" data-id="${comment.id}">إبلاغ</button>`);
    }
    buttons.push(`<a class="lesson-comment__link" href="#comment-${comment.id}" data-action="permalink" data-id="${comment.id}">رابط</a>`);
    return buttons.join("");
  }

  function renderOne(comment, { isReply = false } = {}) {
    if (comment.deleted) {
      return `<article class="lesson-comment${isReply ? " lesson-comment--reply" : ""}" id="comment-${comment.id}" data-id="${comment.id}"><p class="lesson-comment__tombstone">تم حذف هذا التعليق.</p></article>`;
    }
    return `<article class="lesson-comment${isReply ? " lesson-comment--reply" : ""}" id="comment-${comment.id}" data-id="${comment.id}">
      <div class="lesson-comment__meta"><strong>${escapeHtml(comment.author)}</strong><time>${timeAgo(comment.created_at)}${comment.edited_at ? " · تم التعديل" : ""}</time></div>
      <p class="lesson-comment__body">${escapeHtml(comment.body)}</p>
      <div class="lesson-comment__actions">${renderCommentActions(comment)}</div>
      ${!isReply ? `<div class="lesson-comment__replies">${(comment.replies || []).map((r) => renderOne(r, { isReply: true })).join("")}</div>
      <div class="lesson-comment__reply-slot" data-reply-slot="${comment.id}"></div>` : ""}
    </article>`;
  }

  function render() {
    if (!state.comments.length) {
      list.innerHTML = state.page === 1 ? '<p class="lesson-comments__empty">لا توجد مشاركات منشورة بعد. كن أول من يشارك!</p>' : list.innerHTML;
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
      list.innerHTML = '<div class="lesson-comments__skeleton"></div><div class="lesson-comments__skeleton"></div>';
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
      const items = data.parent ? [data.parent, data.comment] : [data.comment];
      list.innerHTML = `<p class="lesson-comments__hint">عرض مشاركة محددة —</p>` + items.map((c, i) => renderOne(c, { isReply: i > 0 && !!data.parent })).join("");
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
      <textarea maxlength="2000" required placeholder="اكتب ردك…">${escapeHtml(saved)}</textarea>
      <div class="lesson-comments__form-row">
        <button type="button" data-action="cancel-reply">إلغاء</button>
        <button type="submit">إرسال الرد</button>
      </div>
    </form>`;
    const textarea = slot.querySelector("textarea");
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
      return true;
    } catch (err) {
      alert(err.message || "تعذر إرسال التعليق.");
      return false;
    } finally {
      button.disabled = false;
    }
  }

  topForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = topTextarea.value.trim();
    if (!body) return;
    const button = topForm.querySelector("button[type=submit]");
    const ok = await submitComment({ body, button });
    if (ok) {
      topTextarea.value = "";
      topCount.textContent = "0 / 2000";
      list.insertAdjacentHTML("afterbegin", '<p class="lesson-comments__pending-note">تم إرسال مشاركتك للمراجعة. ستظهر بعد الموافقة عليها.</p>');
    }
  });

  section.querySelectorAll(".lesson-comments__sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.sort === state.sort) return;
      state.sort = btn.dataset.sort;
      state.page = 1;
      load();
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
    const parentId = form.dataset.parent;
    const textarea = form.querySelector("textarea");
    const body = textarea.value.trim();
    if (!body) return;
    const button = form.querySelector("button[type=submit]");
    const ok = await submitComment({ body, parentId, button });
    if (ok) {
      form.closest("[data-reply-slot]").innerHTML = '<p class="lesson-comments__pending-note">تم إرسال ردك للمراجعة.</p>';
    }
  });

  list.addEventListener("click", async (event) => {
    const cancelBtn = event.target.closest('[data-action="cancel-reply"]');
    if (cancelBtn) {
      cancelBtn.closest("[data-reply-slot]").innerHTML = "";
      return;
    }

    const actionBtn = event.target.closest("[data-action]");
    if (!actionBtn) return;
    const { action, id } = actionBtn.dataset;

    if (action === "reply") return openReplyComposer(id);

    if (action === "permalink") {
      event.preventDefault();
      history.replaceState(null, "", `#comment-${id}`);
      const target = section.querySelector(`#comment-${id}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      navigator.clipboard?.writeText(location.href).catch(() => { });
      return;
    }

    if (action === "react") {
      const token = await ensureToken();
      if (!token) return alert("تعذر التحقق من هويتك، حاول تحديث الصفحة.");
      actionBtn.disabled = true;
      try {
        const res = await fetch("/api/college-quiz?lessonComments=true", {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ action: "react-lesson-comment", comment_id: id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        load(); // re-fetch current page so counts stay accurate everywhere
      } catch (err) {
        alert(err.message || "تعذر تسجيل التفاعل.");
      } finally {
        actionBtn.disabled = false;
      }
      return;
    }

    if (action === "edit") {
      const article = actionBtn.closest(".lesson-comment");
      const bodyEl = article.querySelector(".lesson-comment__body");
      const current = bodyEl.textContent;
      if (article.querySelector(".lesson-comment__edit-form")) return;
      bodyEl.insertAdjacentHTML(
        "afterend",
        `<form class="lesson-comment__edit-form"><textarea maxlength="2000">${escapeHtml(current)}</textarea><div class="lesson-comments__form-row"><button type="button" data-action="cancel-edit">إلغاء</button><button type="submit">حفظ</button></div></form>`
      );
      bodyEl.hidden = true;
      return;
    }

    if (action === "cancel-edit") {
      const article = actionBtn.closest(".lesson-comment");
      article.querySelector(".lesson-comment__edit-form").remove();
      article.querySelector(".lesson-comment__body").hidden = false;
      return;
    }

    if (action === "delete") {
      if (!confirm("هل تريد حذف هذا التعليق؟")) return;
      const token = await ensureToken();
      actionBtn.disabled = true;
      try {
        const res = await fetch("/api/college-quiz?lessonComments=true", {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ action: "delete-lesson-comment", comment_id: id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        load();
      } catch (err) {
        alert(err.message || "تعذر حذف التعليق.");
      } finally {
        actionBtn.disabled = false;
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

  list.addEventListener("submit", async (event) => {
    const form = event.target.closest(".lesson-comment__edit-form");
    if (!form) return;
    event.preventDefault();
    const article = form.closest(".lesson-comment");
    const id = article.dataset.id;
    const body = form.querySelector("textarea").value.trim();
    if (!body) return;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const token = await ensureToken();
      const res = await fetch("/api/college-quiz?lessonComments=true", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ action: "edit-lesson-comment", comment_id: id, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      load();
    } catch (err) {
      alert(err.message || "تعذر تعديل التعليق.");
      button.disabled = false;
    }
  });

  (async () => {
    const handledPermalink = await loadPermalinkIfPresent();
    if (!handledPermalink) load();
  })();
}
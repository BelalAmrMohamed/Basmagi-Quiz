// =============================================================================
// public/src/features/control/control.js — logic for control.html
//
// Manages admin users and displays platform stats for the owner.
// Access-code logic was removed in v6.1 — only email/OAuth auth is supported.
// =============================================================================
import {
  getToken,
  isAdminAuthenticated,
  getAdminRoleInfo,
  fullSignOut,
} from "../../shared/adminAuth.js";
import { syncAdminSession } from "../../shared/adminBadgeSync.js";

import { _alert } from "../../components/notifications/notifications.js";

const API_URL = "/api/admin-control";
// Trash actions (list/restore/empty/settings) live on the general admin
// items surface (/api/admin?action=...) rather than /api/admin-control —
// see docs/plans/Admin actions and deletion flow for quizzes.md §2.
const ADMIN_ACTIONS_URL = "/api/admin";

// Module-scoped Supabase client — set once in init() via the shared
// registry (see supabaseClientRegistry.js), used in logout().
let _supabaseClient = null;
let _token = getToken();

// Resolves once init()'s async session reconciliation (step 2 below) has
// settled and _token reflects its result. Every action that reads _token
// (via getHeaders(), below) awaits this first — see its declaration site
// for why: trashNavBtn's onclick is live in the DOM (and callable) from
// first paint, well before init() finishes, so without this a click in
// that window could read this module's _token (captured synchronously at
// line 26, above) or adminAuth.js's own copy before syncAdminSession() has
// had a chance to replace a stale/soon-to-be-invalidated token with a
// fresh one — or, if reconciliation determines the session is dead, before
// onSignedOut's redirect has fired. Resolves immediately (already-resolved
// microtask) on any run after the first, so this costs nothing once
// startup has completed.
let _resolveInitReady;
const _initReady = new Promise((resolve) => {
  _resolveInitReady = resolve;
});

// ── Bootstrap ──────────────────────────────────────────────────────────────────
// trashNavBtn is disabled at parse time (see control.html) since its
// onclick is live from first paint but _initReady hasn't resolved yet —
// clicking it before that point used to just silently wait on
// postAdminItemAction's internal `await _initReady` with no visible
// feedback, which is itself confusable with the stuck-spinner symptom item
// 12 is meant to close out. Re-enabled here once _initReady resolves.
async function init() {
  // 1. Redirect immediately if no local admin JWT exists
  if (!isAdminAuthenticated()) {
    window.location.href = "/#my-quizzes";
    return;
  }

  // 2. Reconcile local admin state with the live Supabase session
  try {
    _supabaseClient = await syncAdminSession({
      onSignedOut: () => {
        window.location.href = "/#my-quizzes";
      },
    });
  } catch (err) {
    console.error("[control] Failed to sync admin session:", err);
  }

  // Re-read token in case reconciliation updated it
  _token = getToken();

  if (!_token) {
    window.location.href = "/#my-quizzes";
    return;
  }

  _resolveInitReady();
  document.getElementById("trashNavBtn").disabled = false;
  document.getElementById("trashNavBtn").classList.remove("btn-loading");

  // 3. Load admin-control data (admins + platform stats)
  loadData();
}

function getHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${_token}`,
  };
}

/**
 * POSTs an `action=` request to /api/admin (the trash/move/rename/delete
 * surface — see admin-item-actions.js on the home page side, which this
 * mirrors for the control-page trash panel). Throws on failure so callers
 * can share one try/catch + showMessage() flow with the rest of this file.
 *
 * Awaits _initReady first — see that declaration's comment. Without this,
 * an action fired in the window before init() finishes could run with a
 * token that's about to be replaced or invalidated, producing a spurious
 * 401 (or, worse, hanging its caller's loading state if the resulting
 * redirect races with the fetch — see loadTrash()'s stuck-spinner symptom
 * this was meant to close off).
 */
async function postAdminItemAction(action, body = {}) {
  await _initReady;
  const res = await fetch(ADMIN_ACTIONS_URL, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "فشل تنفيذ العملية.");
  return data;
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showMessage(msg, isError = false) {
  const el = document.getElementById("statusMessage");
  el.textContent = msg;
  el.className = `toast ${isError ? "error" : "success"}`;
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 3500);
}

// ── Button loading feedback (item 12) ──────────────────────────────────────────
// Shared helper for every in-flight action button (save college, add/remove
// admin, update scopes, trash restore/purge/empty, save retention): adds a
// disabled + spinner state (see .btn-loading in control.css) for the
// duration of `asyncFn`, and always restores the button afterwards via
// `finally` — including when `asyncFn` throws, so a failed request never
// leaves a button stuck spinning. Buttons that get re-created/removed from
// the DOM as part of a re-render (e.g. after loadData()/loadTrash()
// refresh the list) don't need manual restoration since they're discarded
// entirely, but `finally` still runs safely against the detached node.
async function withButtonLoading(button, asyncFn) {
  if (!button) return asyncFn();
  if (button.classList.contains("btn-loading")) return; // already in flight
  button.classList.add("btn-loading");
  button.disabled = true;
  try {
    return await asyncFn();
  } finally {
    button.classList.remove("btn-loading");
    button.disabled = false;
  }
}

// ── Platform Stats ─────────────────────────────────────────────────────────────
// Each stat-card carries a .control-skeleton-stat class (see control.css)
// that hides its real .stat-icon/.stat-value/.stat-label content behind a
// shimmer placeholder until data actually arrives. Once we have real values
// to show, drop the class so the underlying content becomes visible again —
// otherwise the shimmer would stay glued on top of the numbers forever.
function renderPlatformStats(stats) {
  if (!stats) return;
  const statQuizzes = document.getElementById("statQuizzes");
  const statCategories = document.getElementById("statCategories");
  const statAdmins = document.getElementById("statAdmins");
  const ownerEmailDisplay = document.getElementById("ownerEmailDisplay");

  if (statQuizzes) statQuizzes.textContent = stats.totalQuizzes ?? "—";
  if (statCategories) statCategories.textContent = stats.totalCategories ?? "—";
  if (statAdmins) statAdmins.textContent = stats.totalAdmins ?? "—";
  if (ownerEmailDisplay)
    ownerEmailDisplay.textContent = stats.ownerEmail ?? "—";

  document
    .getElementById("statQuizzesCard")
    ?.classList.remove("control-skeleton-stat");
  document
    .getElementById("statCategoriesCard")
    ?.classList.remove("control-skeleton-stat");
  document
    .getElementById("statAdminsCard")
    ?.classList.remove("control-skeleton-stat");
}

let loadedColleges = [];

function resetCollegeForm() {
  document.getElementById("collegeForm").reset();
  document.getElementById("collegeId").value = "";
  document.getElementById("collegeYearCount").value = "4";
  document.getElementById("cancelCollegeEdit").hidden = true;
}

function renderColleges(colleges) {
  loadedColleges = colleges || [];
  const list = document.getElementById("collegesList");
  list.replaceChildren();
  if (!loadedColleges.length) {
    list.innerHTML = '<div class="admin-empty">لا توجد كليات مضافة</div>';
    return;
  }
  loadedColleges.forEach((college) => {
    const card = document.createElement("div");
    card.className = "college-card";
    const info = document.createElement("div");
    info.className = "college-info";
    info.innerHTML = `<strong></strong><span></span>`;
    info.querySelector("strong").textContent = college.name;
    info.querySelector("span").textContent = `${college.education_type} · ${college.year_count} سنوات · ${(college.terms || []).join(", ")} ترم`;
    const actions = document.createElement("div");
    actions.className = "college-actions";
    const edit = document.createElement("button");
    edit.className = "btn-primary";
    edit.textContent = "تعديل";
    edit.onclick = () => editCollege(college.id);
    const remove = document.createElement("button");
    remove.className = "btn-remove";
    remove.textContent = "تعطيل";
    remove.onclick = () => deactivateCollege(college.id, remove);
    actions.append(edit, remove);
    card.append(info, actions);
    list.appendChild(card);
  });
}

function editCollege(id) {
  const college = loadedColleges.find((item) => item.id === id);
  if (!college) return;
  document.getElementById("collegeId").value = college.id;
  document.getElementById("collegeName").value = college.name;
  document.getElementById("collegeEducationType").value = college.education_type;
  document.getElementById("collegeYearCount").value = college.year_count;
  document.querySelectorAll("#collegeForm .college-terms input").forEach((input) => {
    input.checked = (college.terms || []).includes(Number(input.value));
  });
  document.getElementById("cancelCollegeEdit").hidden = false;
}

async function saveCollege(event) {
  event.preventDefault();
  const terms = [...document.querySelectorAll("#collegeForm .college-terms input:checked")]
    .map((input) => Number(input.value));
  const submitBtn = document.querySelector("#collegeForm button[type='submit']");
  await withButtonLoading(submitBtn, async () => {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          action: "save_college",
          id: document.getElementById("collegeId").value || undefined,
          name: document.getElementById("collegeName").value,
          education_type: document.getElementById("collegeEducationType").value,
          year_count: Number(document.getElementById("collegeYearCount").value),
          terms,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showMessage("تم حفظ الكلية بنجاح");
      resetCollegeForm();
      loadData();
    } catch (err) {
      showMessage(err.message, true);
    }
  });
}

async function deactivateCollege(id, button) {
  if (!window.confirm("سيتم إخفاء الكلية من خيارات الرفع. هل تريد المتابعة؟")) return;
  await withButtonLoading(button, async () => {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ action: "delete_college", id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showMessage("تم تعطيل الكلية");
      loadData();
    } catch (err) {
      showMessage(err.message, true);
    }
  });
}

// ── Data loading ───────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const res = await fetch(API_URL, { headers: getHeaders() });
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        _alert("غير مصرح لك بالدخول إلى هذه الصفحة.");
        window.location.href = "/#my-quizzes";
        return;
      }
      throw new Error(data.error || "فشل تحميل البيانات");
    }

    // Render platform stats
    renderPlatformStats(data.platformStats);
    renderColleges(data.colleges);

    // Render admin list
    const list = document.getElementById("adminsTableBody");
    list.innerHTML = "";

    if (!data.admins || data.admins.length === 0) {
      list.innerHTML = '<div class="admin-empty">لا يوجد مشرفين</div>';
    } else {
      data.admins.forEach((admin) => {
        const date = new Date(admin.created_at).toLocaleDateString("ar-EG");
        const card = document.createElement("div");
        card.className = "admin-card";
        card.innerHTML = `
                <div class="admin-info">
                    <span class="admin-email">${admin.email}</span>
                    <div class="admin-meta">
                        <span class="admin-meta-item">أُضيف بواسطة: ${admin.added_by}</span>
                        <span class="meta-dot"></span>
                        <span class="admin-meta-item">${date}</span>
                    </div>
                <div class="admin-actions" style="margin-top: 10px; display: flex; gap: 8px;">
                    <button class="btn-primary" style="padding: 4px 8px; font-size: 0.9em;" onclick='openScopeModal("${admin.email}", ${JSON.stringify(admin.allowed_scopes || ["Primary", "Middle", "High", "University", "Featured"])})'>&#128274;&nbsp;الصلاحيات</button>
                    <button class="btn-remove" style="padding: 4px 8px; font-size: 0.9em;" onclick="removeAdmin('${admin.email}')">&#10005;&nbsp;إزالة</button>
                </div>
            `;
        list.appendChild(card);
      });
    }
  } catch (err) {
    showMessage(err.message, true);
  }
}

// ── Actions ────────────────────────────────────────────────────────────────────
async function submitAddAdmin() {
  const email = document.getElementById("newAdminEmail").value.trim();
  if (!email) {
    showMessage("يرجى إدخال البريد الإلكتروني", true);
    return;
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    showMessage("يرجى إدخال بريد إلكتروني صالح", true);
    return;
  }
  const addBtn = document.querySelector(".search-row .btn-primary");
  await withButtonLoading(addBtn, async () => {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ action: "add_admin", email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showMessage("تم إضافة المشرف بنجاح");
      document.getElementById("newAdminEmail").value = "";
      loadData();
    } catch (err) {
      showMessage(err.message, true);
    }
  });
}

// Item-12 fix-round note: testing found the trash panel staying visible
// (and, per the report, painting above) the confirm modal when a
// restore/purge/remove confirmation opens from within the trash view. The
// modal's own CSS is a standard fixed-position, z-index:5000 overlay with
// no competing z-index found anywhere under #trashSection, so rather than
// rely on a stacking-context diagnosis that couldn't be reproduced by
// reading the CSS alone, this hides the trash section outright while
// either confirm modal is open — matching what the report explicitly
// asked for ("it should close when the modal pops up") and removing any
// possibility of it visually competing with the modal regardless of cause.
function hideTrashSectionForModal(hide) {
  const trashSection = document.getElementById("trashSection");
  if (trashSection && !trashSection.hidden) {
    trashSection.classList.toggle("trash-section--dimmed-for-modal", hide);
  }
}

function closeModal() {
  document.getElementById("confirmModal").classList.remove("show");
  hideTrashSectionForModal(false);
}
window.closeModal = closeModal;

function openConfirmModal({
  icon = "&#9888;",
  title,
  bodyHtml,
  confirmLabel = "تأكيد",
  onConfirm,
}) {
  document.getElementById("modalIcon").innerHTML = icon;
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHtml;
  const confirmBtn = document.getElementById("modalConfirmBtn");
  confirmBtn.textContent = confirmLabel;

  const modal = document.getElementById("confirmModal");
  modal.classList.add("show");
  hideTrashSectionForModal(true);

  confirmBtn.onclick = async function () {
    // Async onConfirm handlers (the actual delete/restore/purge network
    // call) get the button's own loading spinner while the modal stays
    // open, so the user sees explicit in-flight feedback instead of the
    // modal just vanishing with nothing happening for a moment. Purely
    // synchronous onConfirm handlers (e.g. openEmptyTrashConfirm's, which
    // just swaps in the typed-confirm modal) resolve withButtonLoading
    // immediately, so this adds no delay for them.
    await withButtonLoading(confirmBtn, onConfirm);
    closeModal();
  };
}

// Must be on window so inline onclick="removeAdmin(...)" in dynamic HTML works
window.removeAdmin = function (email) {
  openConfirmModal({
    icon: "&#9888;",
    title: "تأكيد الإزالة",
    bodyHtml: `هل أنت متأكد من إزالة هذا المشرف؟ لا يمكن التراجع عن هذا الإجراء.<span class="modal-email">${email}</span>`,
    confirmLabel: "إزالة",
    onConfirm: async () => {
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ action: "remove_admin", email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showMessage("تم إزالة المشرف بنجاح");
        loadData();
      } catch (err) {
        showMessage(err.message, true);
      }
    },
  });
};

window.submitAddAdmin = submitAddAdmin;

document.getElementById("collegeForm").addEventListener("submit", saveCollege);
document.getElementById("cancelCollegeEdit").addEventListener("click", resetCollegeForm);

// ── Scopes Modal ─────────────────────────────────────────────────────────────
let currentScopeEmail = null;

function closeScopeModal() {
  document.getElementById("scopeModal").classList.remove("show");
  currentScopeEmail = null;
}
window.closeScopeModal = closeScopeModal;

window.openScopeModal = function (email, currentScopes) {
  currentScopeEmail = email;
  const checkboxes = document.querySelectorAll(".scope-checkbox");
  checkboxes.forEach((cb) => {
    cb.checked = currentScopes.includes(cb.value);
  });
  document.getElementById("scopeModal").classList.add("show");
};

document.getElementById("saveScopesBtn").addEventListener("click", async (e) => {
  if (!currentScopeEmail) return;

  const checkboxes = document.querySelectorAll(".scope-checkbox:checked");
  const selectedScopes = Array.from(checkboxes).map((cb) => cb.value);

  await withButtonLoading(e.currentTarget, async () => {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          action: "update_scopes",
          email: currentScopeEmail,
          scopes: selectedScopes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showMessage("تم تحديث الصلاحيات بنجاح");
      closeScopeModal();
      loadData();
    } catch (err) {
      showMessage(err.message, true);
    }
  });
});

document.getElementById("confirmModal").addEventListener("click", function (e) {
  if (e.target === this) closeModal();
});
document.getElementById("scopeModal").addEventListener("click", function (e) {
  if (e.target === this) closeScopeModal();
});

// ── Trash view (shared/admin quizzes+folders+courses soft-delete area) ──────
// See docs/plans/Admin actions and deletion flow for quizzes.md §6. Backed
// entirely by /api/admin's trash-list / trash-restore / trash-empty /
// trash-settings actions (already implemented server-side).
//
// Fix-round note (docs/plans/implementation-plan.md item 8): the
// pre-init()-ready click race on trashNavBtn (see _initReady's comment,
// above) is fixed — postAdminItemAction() now can't fire with a token
// that's about to be replaced or invalidated by syncAdminSession(). That
// was a confirmed real bug, but not confirmed to be *the* cause of the
// originally-reported "stuck on جاري التحميل... until manual refresh"
// symptom: loadTrash()'s own error handling (below) already surfaces a
// thrown error as visible text rather than silently swallowing it, so a
// genuine stall (as opposed to a visible-but-unwanted error message) would
// require the request to never settle at all — nothing found by reading
// through handleTrashList/handleItemActions suggests why that would
// happen. If this still reproduces after this fix, it needs a live
// console/network trace to pin down further (per the plan's own note).

let trashItemsCache = [];
let trashFilter = "all";

function showTrashView() {
  document.getElementById("overviewView").hidden = true;
  document.getElementById("trashSection").hidden = false;
  document.getElementById("trashNavBtn").hidden = true;
  document.getElementById("overviewNavBtn").hidden = false;
  loadTrash();
}
window.showTrashView = showTrashView;

function showOverviewView() {
  document.getElementById("trashSection").hidden = true;
  document.getElementById("overviewView").hidden = false;
  document.getElementById("overviewNavBtn").hidden = true;
  document.getElementById("trashNavBtn").hidden = false;
}
window.showOverviewView = showOverviewView;

const TRASH_TYPE_LABELS = { quiz: "امتحان", folder: "مجلد", course: "مادة" };

function formatTrashDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (_) {
    return "—";
  }
}

/** Days remaining until `expiresAt` (can be negative if already past —
 * sweepExpiredTrash on the server will clean those up on next access). */
function daysUntil(expiresAtIso) {
  if (!expiresAtIso) return null;
  const diffMs = new Date(expiresAtIso).getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function renderTrashList() {
  const list = document.getElementById("trashList");
  const filtered =
    trashFilter === "all"
      ? trashItemsCache
      : trashItemsCache.filter((item) => item.itemType === trashFilter);

  if (!filtered.length) {
    list.innerHTML = '<div class="admin-empty">سلة المهملات فارغة</div>';
    return;
  }

  list.replaceChildren();
  filtered.forEach((item) => {
    const daysLeft = daysUntil(item.expiresAt);
    const urgent = daysLeft !== null && daysLeft <= 3;

    const card = document.createElement("div");
    card.className = "trash-card";
    card.innerHTML = `
      <div class="trash-card-info">
        <div class="trash-card-name">
          <span class="trash-type-badge">${TRASH_TYPE_LABELS[item.itemType] || item.itemType}</span>
          <span></span>
        </div>
        <div class="trash-card-meta">
          <span class="admin-meta-item">حُذف في: ${formatTrashDate(item.deletedAt)}</span>
          <span class="meta-dot"></span>
          <span class="admin-meta-item trash-expiry${urgent ? " trash-expiry--urgent" : ""}">
            ${daysLeft === null ? "—" : daysLeft > 0 ? `يُحذف نهائياً خلال ${daysLeft} يوم` : "سيُحذف نهائياً قريباً"}
          </span>
        </div>
      </div>
      <div class="trash-card-actions">
        <button class="btn-restore" data-action="restore">↺ استعادة</button>
        <button class="btn-remove" data-action="purge">&#10005; حذف نهائي</button>
      </div>
    `;
    card.querySelector(".trash-card-name span:last-child").textContent = item.name;

    card.querySelector('[data-action="restore"]').onclick = (e) =>
      restoreTrashItem(item, e.currentTarget);
    card.querySelector('[data-action="purge"]').onclick = () => purgeTrashItem(item);

    list.appendChild(card);
  });
}

// Same 3-row shimmer markup as the static placeholder in control.html (see
// .control-skeleton-row/.control-skeleton-block in control.css) — reused
// here so a manual refresh/filter click shows the same loading state as
// first paint instead of falling back to plain "جاري التحميل..." text.
const TRASH_SKELETON_HTML = Array.from(
  { length: 3 },
  () =>
    '<div class="control-skeleton-row"><div class="control-skeleton-block"></div><div class="control-skeleton-block"></div></div>',
).join("");

async function loadTrash() {
  const list = document.getElementById("trashList");
  list.innerHTML = TRASH_SKELETON_HTML;
  try {
    const data = await postAdminItemAction("trash-list");
    trashItemsCache = data.items || [];
    renderTrashList();
  } catch (err) {
    list.innerHTML = `<div class="admin-empty">${err.message}</div>`;
  }

  // Retention setting box — owner-only (server also enforces this on write;
  // this just avoids showing a control that would 403 for anyone else).
  const roleInfo = getAdminRoleInfo();
  const retentionBox = document.getElementById("trashRetentionBox");
  if (roleInfo?.isOwner) {
    try {
      const settings = await postAdminItemAction("trash-settings");
      document.getElementById("trashRetentionInput").value = settings.retentionDays ?? 30;
      retentionBox.hidden = false;
    } catch (_) {
      retentionBox.hidden = true;
    }
  } else {
    retentionBox.hidden = true;
  }
}

async function restoreTrashItem(item, button) {
  await withButtonLoading(button, async () => {
    try {
      const data = await postAdminItemAction("trash-restore", { trashItemId: item.id });
      if (data.failed?.length) {
        showMessage(
          `تمت استعادة ${data.restored} عنصر، وتعذّرت استعادة ${data.failed.length}.`,
          data.restored === 0,
        );
      } else {
        showMessage(`تمت استعادة "${item.name}" بنجاح.`);
      }
      loadTrash();
    } catch (err) {
      showMessage(err.message, true);
    }
  });
}

function purgeTrashItem(item) {
  openConfirmModal({
    icon: "&#128465;",
    title: "حذف نهائي",
    bodyHtml: `سيتم حذف "${item.name}" نهائياً${item.itemType !== "quiz" ? " وكل ما تحتويه" : ""}، بما في ذلك ملفات الوسائط المرتبطة به. لا يمكن التراجع عن هذا الإجراء.`,
    confirmLabel: "حذف نهائياً",
    onConfirm: async () => {
      try {
        await postAdminItemAction("trash-empty", { trashItemId: item.id });
        showMessage(`تم حذف "${item.name}" نهائياً.`);
        loadTrash();
      } catch (err) {
        showMessage(err.message, true);
      }
    },
  });
}

// ── "إفراغ السلة" — double-confirm (button confirm + typed phrase), same
// pattern as deleteAllUserQuizzes() on the home page for "حذف الكل". Uses
// control.html's own typed-confirm modal (rather than the shared
// notifications.js _confirmTyped(), which depends on theme CSS variables
// that this standalone dark-gold page doesn't define).
const EMPTY_TRASH_PHRASE = "افراغ السلة";

function closeTypedConfirmModal() {
  document.getElementById("typedConfirmModal").classList.remove("show");
  document.getElementById("typedConfirmInput").value = "";
  document.getElementById("typedConfirmBtn").disabled = true;
  hideTrashSectionForModal(false);
}
window.closeTypedConfirmModal = closeTypedConfirmModal;

function openEmptyTrashConfirm() {
  openConfirmModal({
    icon: "&#9888;",
    title: "إفراغ سلة المهملات",
    bodyHtml: "سيتم حذف كل العناصر المرئية لك في سلة المهملات نهائياً، بما في ذلك ملفات الوسائط المرتبطة بها. لا يمكن التراجع عن هذا الإجراء.",
    confirmLabel: "متابعة",
    onConfirm: () => {
      // Keep the trash section hidden through the handoff to the typed
      // modal — openConfirmModal's own closeModal() (called right after
      // this onConfirm resolves) would otherwise un-hide it for the brief
      // moment before the typed modal takes over.
      hideTrashSectionForModal(true);
      document.getElementById("typedConfirmBody").textContent =
        `اكتب العبارة التالية بالضبط لتأكيد إفراغ السلة نهائياً:`;
      document.getElementById("typedConfirmPhrase").textContent = EMPTY_TRASH_PHRASE;
      document.getElementById("typedConfirmModal").classList.add("show");

      const input = document.getElementById("typedConfirmInput");
      const confirmBtn = document.getElementById("typedConfirmBtn");
      input.oninput = () => {
        confirmBtn.disabled = input.value.trim() !== EMPTY_TRASH_PHRASE;
      };
      confirmBtn.onclick = async () => {
        await withButtonLoading(confirmBtn, async () => {
          try {
            const data = await postAdminItemAction("trash-empty", { all: true });
            showMessage(`تم حذف ${data.purged} عنصر نهائياً.`);
            loadTrash();
          } catch (err) {
            showMessage(err.message, true);
          }
        });
        closeTypedConfirmModal();
      };
    },
  });
}

async function saveTrashRetention() {
  const days = Number(document.getElementById("trashRetentionInput").value);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    showMessage("مدة الاحتفاظ يجب أن تكون بين 1 و 365 يوماً.", true);
    return;
  }
  await withButtonLoading(document.getElementById("saveRetentionBtn"), async () => {
    try {
      await postAdminItemAction("trash-settings", { retentionDays: days });
      showMessage("تم تحديث مدة الاحتفاظ بنجاح.");
    } catch (err) {
      showMessage(err.message, true);
    }
  });
}

document.getElementById("refreshTrashBtn").addEventListener("click", loadTrash);
document.getElementById("emptyTrashBtn").addEventListener("click", openEmptyTrashConfirm);
document.getElementById("saveRetentionBtn").addEventListener("click", saveTrashRetention);
document.getElementById("typedConfirmModal").addEventListener("click", function (e) {
  if (e.target === this) closeTypedConfirmModal();
});
document.querySelectorAll(".trash-filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".trash-filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    trashFilter = tab.dataset.filter;
    renderTrashList();
  });
});

// ── Logout ─────────────────────────────────────────────────────────────────────
// fullSignOut() clears BOTH the local JWT AND calls supabaseClient.auth.signOut()
// so the Supabase session in localStorage is also terminated.
// Redirects to /#my-quizzes — the owner can decide to sign back in from there.
window.logout = async function () {
  try {
    await fullSignOut(_supabaseClient);
  } catch (err) {
    console.error("[control] Error during logout:", err);
  }
  window.location.href = "/#my-quizzes";
};

// ── Start ───────────────────────────────────────────────────────────────────────
init();
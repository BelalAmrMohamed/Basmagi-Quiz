// ============================================================================
// LESSON ACCESS — shared password verification and protected-content gate.
// ============================================================================

import { showNotification } from "../../components/notifications/notifications.js";

const PASSWORD_MIN = 4;
const PASSWORD_MAX = 128;

export function isLessonProtected(lesson) {
  return Boolean(
    lesson?.password_protected ||
    lesson?.passwordProtected ||
    lesson?.meta?.passwordProtected ||
    lesson?.passwordHash ||
    lesson?.password_hash,
  );
}

export function validateLessonPasswordInput(password) {
  const value = typeof password === "string" ? password : "";
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    throw new Error(`كلمة مرور الدرس يجب أن تكون بين ${PASSWORD_MIN} و${PASSWORD_MAX} حرفاً.`);
  }
  return value;
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyLessonPasswordHash(password, hash) {
  if (!hash) return false;
  return constantTimeEqual(await sha256Hex(password), String(hash));
}

export async function verifyLocalLessonPassword(row, password) {
  const hash = row?.passwordHash || row?.password_hash || "";
  return Boolean(hash) && verifyLessonPasswordHash(password, hash);
}

function constantTimeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function dialogMarkup(title, message, submitLabel = "فتح الدرس") {
  return `
    <dialog class="lesson-password-dialog" aria-labelledby="lessonPasswordDialogTitle">
      <form method="dialog" class="lesson-password-dialog__panel">
        <div class="lesson-password-dialog__header">
          <div>
            <span class="lesson-password-dialog__eyebrow">محتوى محمي</span>
            <h2 id="lessonPasswordDialogTitle">${escapeMarkup(title)}</h2>
          </div>
          <button type="button" class="lesson-password-dialog__close" data-password-close aria-label="إغلاق" title="إغلاق">×</button>
        </div>
        <p class="lesson-password-dialog__message">${escapeMarkup(message)}</p>
        <label class="lesson-password-dialog__label" for="lessonPasswordDialogInput">كلمة المرور</label>
        <div class="lesson-password-dialog__field">
          <input id="lessonPasswordDialogInput" type="password" autocomplete="current-password" minlength="${PASSWORD_MIN}" maxlength="${PASSWORD_MAX}" required>
          <button type="button" class="lesson-password-dialog__toggle" data-password-toggle aria-label="إظهار كلمة المرور" title="إظهار كلمة المرور">عرض</button>
        </div>
        <p class="lesson-password-dialog__error" role="alert" hidden></p>
        <div class="lesson-password-dialog__actions">
          <button type="button" class="btn btn-secondary" data-password-cancel>إلغاء</button>
          <button type="submit" class="btn btn-primary" data-password-submit>${escapeMarkup(submitLabel)}</button>
        </div>
      </form>
    </dialog>`;
}

function escapeMarkup(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function requestLessonPassword({
  title = "هذا الدرس",
  message = "أدخل كلمة المرور للمتابعة.",
  verify,
  submitLabel = "فتح الدرس",
} = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement("div");
    dialog.innerHTML = dialogMarkup(title, message, submitLabel);
    const nativeDialog = dialog.firstElementChild;
    document.body.appendChild(nativeDialog);

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const input = nativeDialog.querySelector("#lessonPasswordDialogInput");
    const error = nativeDialog.querySelector("[data-password-error], .lesson-password-dialog__error");
    const submit = nativeDialog.querySelector("[data-password-submit]");
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { nativeDialog.close(); } catch { /* no-op */ }
      nativeDialog.remove();
      if (previousFocus && document.body.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      }
      resolve(value);
    };

    const close = () => finish(null);
    nativeDialog.querySelector("[data-password-close]")?.addEventListener("click", close);
    nativeDialog.querySelector("[data-password-cancel]")?.addEventListener("click", close);
    nativeDialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    nativeDialog.addEventListener("click", (event) => {
      if (event.target === nativeDialog) close();
    });
    nativeDialog.querySelector("[data-password-toggle]")?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      const hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
      button.textContent = hidden ? "إخفاء" : "عرض";
      button.setAttribute("aria-label", hidden ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
      input.focus({ preventScroll: true });
    });
    nativeDialog.querySelector("form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (settled || submit.disabled) return;
      const password = input.value;
      try {
        validateLessonPasswordInput(password);
      } catch (validationError) {
        error.textContent = validationError.message;
        error.hidden = false;
        input.focus({ preventScroll: true });
        return;
      }
      submit.disabled = true;
      error.hidden = true;
      try {
        const accepted = await verify?.(password);
        if (!accepted) {
          error.textContent = "كلمة المرور غير صحيحة.";
          error.hidden = false;
          input.select();
          return;
        }
        finish(password);
      } catch (verificationError) {
        error.textContent = verificationError?.message || "تعذّر التحقق من كلمة المرور.";
        error.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });

    if (typeof nativeDialog.showModal === "function") nativeDialog.showModal();
    else nativeDialog.setAttribute("open", "");
    requestAnimationFrame(() => input?.focus({ preventScroll: true }));
  });
}

export async function unlockRemoteLesson(idOrSlug, password) {
  const passwordHash = await sha256Hex(password);
  const response = await fetch(`/api/render-course?contentType=lesson&id=${encodeURIComponent(idOrSlug)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passwordHash }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "تعذّر فتح الدرس.");
    error.status = response.status;
    throw error;
  }
  return result.lesson || null;
}

export async function requireLessonPassword({ lesson, row = lesson, verifyRemote } = {}) {
  if (!isLessonProtected(lesson)) return { unlocked: true, password: null };
  const password = await requestLessonPassword({
    title: lesson?.title || "هذا الدرس",
    verify: async (candidate) => {
      if (typeof verifyRemote === "function") {
        await verifyRemote(candidate);
        return true;
      }
      return verifyLocalLessonPassword(row, candidate);
    },
  });
  return password ? { unlocked: true, password } : { unlocked: false, password: null };
}

export function reportProtectedDownloadBlocked() {
  showNotification("محتوى محمي", "يجب فتح الدرس بكلمة المرور قبل تنزيله.", "warning");
}

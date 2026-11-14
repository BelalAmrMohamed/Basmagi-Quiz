// ============================================================================
// public/src/features/home/download-password.js
// DOWNLOAD PASSWORD GATE
// ============================================================================
// quiz.html is responsible for gating *playing* the quiz — we never touch
// that here. This gate only protects *downloads* initiated from the index
// page's download popups (static exams, DB exams, and user quizzes alike).
//
// Once a correct password is entered for a given quiz id, it's remembered
// for the rest of the tab session (sessionStorage) so the user isn't asked
// again on every format click within the same visit.
// ============================================================================

import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { checkQuizHasPassword } from "./quiz-data-loader.js";

const DOWNLOAD_PASSWORD_SESSION_PREFIX = "dl_pw_ok:";

export function isStoredPasswordHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function quizPasswordMatches(input, stored) {
  if (!stored) return false;
  const storedStr = String(stored).trim();
  const inputStr = String(input).trim();
  if (isStoredPasswordHash(storedStr)) {
    return (await sha256Hex(inputStr)) === storedStr.toLowerCase();
  }
  return inputStr === storedStr;
}

export function isDownloadPasswordVerified(quizId) {
  try {
    return (
      sessionStorage.getItem(DOWNLOAD_PASSWORD_SESSION_PREFIX + quizId) ===
      "1"
    );
  } catch (_) {
    return false; // sessionStorage unavailable (e.g. private mode) — fall through to prompting
  }
}

/**
 * @param {string} quizId
 * @param {string} [storedValue] - for shared quizzes, the value the server
 *   returned after a correct password (needed so exported files stay
 *   protected). Local quizzes just pass nothing.
 */
export function markDownloadPasswordVerified(quizId, storedValue) {
  try {
    sessionStorage.setItem(
      DOWNLOAD_PASSWORD_SESSION_PREFIX + quizId,
      typeof storedValue === "string" && storedValue ? storedValue : "1",
    );
  } catch (_) {
    /* non-fatal — user will just be re-prompted next time */
  }
}

/** The server-returned password value saved by markDownloadPasswordVerified, if any. */
export function getVerifiedQuizPassword(quizId) {
  try {
    const v = sessionStorage.getItem(DOWNLOAD_PASSWORD_SESSION_PREFIX + quizId);
    return v && v !== "1" ? v : null;
  } catch (_) {
    return null;
  }
}

/**
 * Checks a typed password for a shared (database) quiz ON THE SERVER. The
 * stored hash never reaches the browser. Resolves to the stored value (a
 * truthy string) when correct, or `false`.
 */
export async function verifyQuizPasswordRemote(dbId, input) {
  if (!dbId) return false;
  try {
    const supabase = await ensureSharedSupabaseClient();
    if (!supabase) return false;
    const { data, error } = await supabase.rpc("verify_quiz_password", {
      p_quiz_id: dbId,
      p_password: String(input ?? ""),
    });
    if (error) {
      console.warn("[quiz-password] verification failed:", error.message);
      return false;
    }
    return typeof data === "string" && data ? data : false;
  } catch (err) {
    console.warn("[quiz-password] verification failed:", err);
    return false;
  }
}

/**
 * Prompts the user for a quiz's download password in a modal.
 * `verify(input)` returns a truthy value (`true`, or the stored password
 * string for shared quizzes) when the input is correct.
 * Resolves that value if the correct password was entered, `false` if the
 * user cancelled.
 */
function promptDownloadPassword(title, verify) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "downloadPasswordTitle");

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      modal.remove();
      resolve(result);
    };

    modal.addEventListener("click", (e) => {
      if (e.target === modal) finish(false);
    });

    const modalCard = document.createElement("div");
    modalCard.className = "modal-card";

    const h2 = document.createElement("h2");
    h2.id = "downloadPasswordTitle";
    h2.textContent = "هذا الامتحان محمي بكلمة مرور";

    const p = document.createElement("p");
    p.textContent = `أدخل كلمة المرور لتنزيل "${title}"`;

    const form = document.createElement("div");
    form.className = "download-password-form";

    const input = document.createElement("input");
    input.type = "password";
    input.className = "download-password-input";
    input.placeholder = "كلمة المرور";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "كلمة مرور الامتحان");

    const errorMsg = document.createElement("p");
    errorMsg.className = "download-password-error";
    errorMsg.textContent = "كلمة مرور غير صحيحة";
    errorMsg.style.display = "none";

    form.appendChild(input);
    form.appendChild(errorMsg);

    const actions = document.createElement("div");
    actions.className = "download-password-actions";

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "btn btn-primary";
    submitBtn.textContent = "تأكيد";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "close-modal";
    cancelBtn.textContent = "إلغاء";
    cancelBtn.onclick = () => finish(false);

    const attemptSubmit = async () => {
      const ok = await verify(input.value);
      if (ok) {
        finish(ok);
      } else {
        errorMsg.style.display = "block";
        input.value = "";
        input.focus();
      }
    };
    submitBtn.onclick = attemptSubmit;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        attemptSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
      errorMsg.style.display = "none";
    });

    actions.appendChild(submitBtn);
    actions.appendChild(cancelBtn);

    modalCard.appendChild(h2);
    modalCard.appendChild(p);
    modalCard.appendChild(form);
    modalCard.appendChild(actions);
    modal.appendChild(modalCard);

    requestAnimationFrame(() => {
      document.body.appendChild(modal);
      input.focus();
    });
  });
}

/**
 * Ensures the user is allowed to download a (possibly password-protected)
 * quiz. Resolves `true` if download should proceed, `false` if it should be
 * cancelled. Quizzes with no password always resolve `true` immediately.
 *
 * @param {string} quizId - stable id used as the sessionStorage cache key
 * @param {string|null|undefined} password - the quiz's correct password, if any
 * @param {string} title - quiz title, shown in the prompt
 */
export async function ensureDownloadAllowed(quizId, password, title) {
  if (!password) return true;
  if (isDownloadPasswordVerified(quizId)) return true;

  const ok = await promptDownloadPassword(title, (input) =>
    quizPasswordMatches(input, password),
  );
  if (ok) markDownloadPasswordVerified(quizId);
  return Boolean(ok);
}

/**
 * Same gate for shared (database) quizzes, whose password never leaves the
 * server. `exam.passwordProtected` comes from the catalog; when it's missing
 * (e.g. an exam built from a lesson reference) it's looked up by `dbId`.
 *
 * @returns {Promise<{allowed: boolean, password: string|null}>} `password` is
 *   the value to embed in exported files (null when unprotected).
 */
export async function ensureQuizDownloadAllowed(exam) {
  let protectedQuiz = exam?.passwordProtected;
  if (protectedQuiz === undefined && exam?.dbId) {
    try {
      protectedQuiz = await checkQuizHasPassword(exam.dbId);
    } catch (_) {
      protectedQuiz = false; // the modal's own data load will surface the real error
    }
  }
  if (!protectedQuiz) return { allowed: true, password: null };

  const key = exam.id || exam.dbId;
  const cached = getVerifiedQuizPassword(key);
  if (cached) return { allowed: true, password: cached };

  const result = await promptDownloadPassword(
    exam.title || exam.id,
    (input) => verifyQuizPasswordRemote(exam.dbId, input),
  );
  if (!result) return { allowed: false, password: null };
  markDownloadPasswordVerified(key, result);
  return { allowed: true, password: typeof result === "string" ? result : null };
}
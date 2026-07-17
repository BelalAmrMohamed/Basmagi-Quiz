// =============================================================================
// public/src/scripts/sign-in-dialog.js
//
// Self-contained admin sign-in dialog for index.html.
//
// KEY DESIGN DECISIONS:
//   • All DOM queries are scoped to #adminSignInDialog to avoid collisions
//     with existing main-page elements.
//   • After a successful sign-in the dialog closes and the page reloads so
//     every admin-dependent UI element (upload buttons, sign-out button) is
//     re-rendered cleanly — mirrors the reload used on logout.
//   • Non-admin rejections (HTTP 403 from /api/auth) explicitly destroy the
//     Supabase session BEFORE showing the error, preventing the reload loop
//     where syncAdminSessionWithSupabase() finds the live session and re-tries.
//   • OAuth popup flow includes zombie-window cleanup (Phase 3 fix).
// =============================================================================

import { signInWithSupabase } from "./adminAuth.js";

// ── Module state ──────────────────────────────────────────────────────────────

let _supabaseClient = null;
let _dialog = null;
let _initialized = false;

// SSO popup tracking
let _ssoPopup = null;
let _ssoPopupPollInterval = null;
let _ssoMessageHandler = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Opens the admin sign-in dialog.
 * Safe to call multiple times — lazily initialises Supabase on first call.
 */
export async function openSignInDialog() {
  _dialog = document.getElementById("adminSignInDialog");
  if (!_dialog) {
    console.error("[sign-in-dialog] #adminSignInDialog not found in the DOM.");
    return;
  }

  // Reset UI to initial state every time dialog opens
  _resetDialog();

  // Show the dialog
  _dialog.showModal();

  // Lazy-init Supabase (only once per page load)
  if (!_initialized) {
    await _initSupabase();
    _initialized = true;
  }
}

// ── Supabase init ─────────────────────────────────────────────────────────────

async function _initSupabase() {
  try {
    const res = await fetch("/api/env");
    const data = await res.json();
    if (data.supabaseUrl && data.supabaseAnonKey) {
      _supabaseClient = window.supabase.createClient(
        data.supabaseUrl,
        data.supabaseAnonKey
      );
    }
  } catch (err) {
    console.error("[sign-in-dialog] Failed to initialize Supabase:", err);
  }
}

// ── DOM helpers (all scoped inside the dialog) ───────────────────────────────

function _q(id) {
  return _dialog ? _dialog.querySelector(`#${id}`) : null;
}

function _resetDialog() {
  const emailStep = _q("sd-emailStep");
  const otpStep = _q("sd-otpStep");
  const ssoDivider = _q("sd-ssoDivider");
  const ssoButtons = _q("sd-ssoButtonsContainer");
  const emailInput = _q("sd-emailInput");
  const otpInput = _q("sd-otpInput");

  if (emailStep) emailStep.style.display = "";
  if (otpStep) otpStep.style.display = "none";
  if (ssoDivider) ssoDivider.style.display = "";
  if (ssoButtons) ssoButtons.style.display = "";
  if (emailInput) emailInput.value = "";
  if (otpInput) otpInput.value = "";

  _clearError();
  _clearSuccess();
  _setLoading("email", false);
  _setLoading("otp", false);

  // Clean up any in-flight SSO state
  _cleanupSSOState();
}

// ── UI state helpers ──────────────────────────────────────────────────────────

function _setLoading(which, on) {
  if (which === "email") {
    const btn = _q("sd-submitBtnEmail");
    const spinner = _q("sd-spinnerEmail");
    const text = _q("sd-btnTextEmail");
    if (btn) btn.disabled = on;
    if (spinner) spinner.style.display = on ? "block" : "none";
    if (text) text.textContent = on ? "جارٍ الإرسال..." : "إرسال رمز التحقق";
  } else if (which === "otp") {
    const btn = _q("sd-submitBtnOtp");
    const spinner = _q("sd-spinnerOtp");
    const text = _q("sd-btnTextOtp");
    if (btn) btn.disabled = on;
    if (spinner) spinner.style.display = on ? "block" : "none";
    if (text) text.textContent = on ? "جارٍ التحقق..." : "تأكيد رمز التحقق";
  }
}

function _showError(msg) {
  const el = _q("sd-errorMsg");
  if (!el) return;
  el.textContent = "⚠️ " + msg;
  el.style.display = "flex";
  // Re-trigger shake
  el.style.animation = "none";
  requestAnimationFrame(() => { el.style.animation = ""; });
}

function _clearError() {
  const el = _q("sd-errorMsg");
  if (el) { el.textContent = ""; el.style.display = "none"; }
}

function _showSuccess(msg) {
  const el = _q("sd-successMsg");
  if (!el) return;
  el.textContent = "✅ " + msg;
  el.style.display = "flex";
}

function _clearSuccess() {
  const el = _q("sd-successMsg");
  if (el) { el.textContent = ""; el.style.display = "none"; }
}

// ── On successful sign-in ─────────────────────────────────────────────────────

function _onSignedIn() {
  if (_dialog) _dialog.close();
  // Reload so all admin-dependent UI (upload buttons, sign-out button) refreshes.
  window.location.reload();
}

// ── Non-admin rejection — Phase 4 fix ─────────────────────────────────────────
//
// When /api/auth returns 403 (user authenticated with Supabase but is not an
// admin), the Supabase session is still alive in localStorage. Without
// explicitly destroying it here, syncAdminSessionWithSupabase() (in index.js)
// would find it on the next page interaction, call signInWithSupabase() again,
// get 403 again, call fullSignOut(), reload, and loop forever.
//
// Fix: destroy the Supabase session immediately on 403 BEFORE showing the error.

async function _handleNonAdminRejection(errorMsg) {
  // 1. Sign out of Supabase to remove the session from localStorage
  if (_supabaseClient) {
    try {
      await _supabaseClient.auth.signOut();
    } catch (_) {}
  }

  // 2. Belt-and-suspenders: clear all Supabase auth keys from localStorage
  try {
    const keysToRemove = Object.keys(localStorage).filter(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
    );
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (_) {}

  // 3. Show the error in the dialog — do NOT reload (no loop trigger)
  _showError(errorMsg || "هذا الحساب ليس لديه صلاحيات المشرف.");
}

// ── Email → OTP flow ──────────────────────────────────────────────────────────

let _currentEmailForOtp = "";

function _initEmailForm() {
  const emailForm = _q("sd-emailForm");
  if (!emailForm) return;

  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!_supabaseClient) {
      _showError("تعذر الاتصال بخدمة المصادقة.");
      return;
    }

    const emailInput = _q("sd-emailInput");
    const email = emailInput ? emailInput.value.trim() : "";
    if (!email) {
      _showError("الرجاء إدخال البريد الإلكتروني");
      return;
    }

    _setLoading("email", true);
    _clearError();
    _clearSuccess();

    try {
      const callbackUrl = window.location.origin + "/oauth-callback.html";
      const { error } = await _supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callbackUrl },
      });
      if (error) throw error;

      _currentEmailForOtp = email;
      _showSuccess("تم إرسال رمز التحقق إلى بريدك الإلكتروني.");

      // Switch to OTP step
      const emailStep = _q("sd-emailStep");
      const otpStep = _q("sd-otpStep");
      const ssoDivider = _q("sd-ssoDivider");
      const ssoButtons = _q("sd-ssoButtonsContainer");
      if (emailStep) emailStep.style.display = "none";
      if (otpStep) otpStep.style.display = "";
      if (ssoDivider) ssoDivider.style.display = "none";
      if (ssoButtons) ssoButtons.style.display = "none";
      const otpInput = _q("sd-otpInput");
      if (otpInput) otpInput.focus();
    } catch (err) {
      _showError(err.message || "حدث خطأ أثناء إرسال رمز التحقق.");
    } finally {
      _setLoading("email", false);
    }
  });
}

function _initOtpSubmit() {
  const submitBtnOtp = _q("sd-submitBtnOtp");
  if (!submitBtnOtp) return;

  submitBtnOtp.addEventListener("click", async () => {
    const otpInput = _q("sd-otpInput");
    const otp = otpInput ? otpInput.value.trim() : "";
    if (!otp || otp.length < 6) {
      _showError("الرجاء إدخال رمز تحقق صحيح مكون من 6 أرقام");
      return;
    }

    _setLoading("otp", true);
    _clearError();
    _clearSuccess();

    try {
      const { data, error } = await _supabaseClient.auth.verifyOtp({
        email: _currentEmailForOtp,
        token: otp,
        type: "email",
      });
      if (error) throw error;

      // Try to get an admin JWT from our backend
      const ok = await signInWithSupabase(data.session.access_token);
      if (!ok) {
        // Non-admin: destroy the Supabase session before showing error
        await _handleNonAdminRejection(
          "هذا البريد الإلكتروني ليس لديه صلاحيات المشرف."
        );
        return;
      }
      _onSignedIn();
    } catch (err) {
      _showError("رمز التحقق غير صحيح أو منتهي الصلاحية.");
      if (otpInput) otpInput.select();
    } finally {
      _setLoading("otp", false);
    }
  });
}

function _initResendOtp() {
  const resendOtpBtn = _q("sd-resendOtpBtn");
  if (!resendOtpBtn) return;

  resendOtpBtn.addEventListener("click", async () => {
    if (!_currentEmailForOtp) return;
    _clearError();
    _clearSuccess();
    try {
      resendOtpBtn.disabled = true;
      const callbackUrl = window.location.origin + "/oauth-callback.html";
      const { error } = await _supabaseClient.auth.signInWithOtp({
        email: _currentEmailForOtp,
        options: { emailRedirectTo: callbackUrl },
      });
      if (error) throw error;
      _showSuccess("تمت إعادة إرسال رمز التحقق.");
      setTimeout(() => { resendOtpBtn.disabled = false; }, 30000);
    } catch (err) {
      _showError("حدث خطأ أثناء إعادة إرسال الرمز.");
      resendOtpBtn.disabled = false;
    }
  });
}

function _initChangeEmail() {
  const changeEmailBtn = _q("sd-changeEmailBtn");
  if (!changeEmailBtn) return;

  changeEmailBtn.addEventListener("click", () => {
    const emailStep = _q("sd-emailStep");
    const otpStep = _q("sd-otpStep");
    const ssoDivider = _q("sd-ssoDivider");
    const ssoButtons = _q("sd-ssoButtonsContainer");
    const otpInput = _q("sd-otpInput");

    if (otpStep) otpStep.style.display = "none";
    if (emailStep) emailStep.style.display = "";
    if (ssoDivider) ssoDivider.style.display = "";
    if (ssoButtons) ssoButtons.style.display = "";
    if (otpInput) otpInput.value = "";
    _clearError();
    _clearSuccess();

    const emailInput = _q("sd-emailInput");
    if (emailInput) emailInput.focus();
  });
}

// ── SSO (Popup + Fallback) — Phase 3 fixes ───────────────────────────────────
//
// WHY POPUP:
//   skipBrowserRedirect:true gets the OAuth URL without navigating the tab.
//   We open a blank popup SYNCHRONOUSLY (inside the click handler) to avoid
//   popup blocker, then set its href after the async SDK call.
//
// PHASE 3 FIXES:
//   1. _ssoPopup.location.href assignment is wrapped in try-catch — if
//      browser shields block the navigation (Brave/Edge), the SecurityError
//      is caught, the zombie window is closed, and we fall back to
//      full-page redirect automatically.
//   2. The full-page redirect URL is now "/" (not /sign-in.html).

function _cleanupSSOState() {
  if (_ssoPopupPollInterval) {
    clearInterval(_ssoPopupPollInterval);
    _ssoPopupPollInterval = null;
  }
  if (_ssoMessageHandler) {
    window.removeEventListener("message", _ssoMessageHandler);
    _ssoMessageHandler = null;
  }
  _ssoPopup = null;
}

function _setSSOLoading(on, provider) {
  const btnGoogle = _q("sd-btnGoogle");
  const btnGitHub = _q("sd-btnGitHub");
  const btn = provider === "google" ? btnGoogle : btnGitHub;
  const other = provider === "google" ? btnGitHub : btnGoogle;
  if (btn) {
    btn.disabled = on;
    const span = btn.querySelector("span");
    if (span) span.textContent = on ? "جارٍ الاتصال..." : (provider === "google" ? "Google" : "GitHub");
  }
  if (other) other.disabled = on;
}

function _fallbackFullPageRedirect(provider) {
  (async () => {
    try {
      const { error } = await _supabaseClient.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin + "/" },
      });
      if (error) throw error;
      // signInWithOAuth without skipBrowserRedirect navigates the tab — done.
    } catch (err) {
      _showError("فشل تسجيل الدخول بواسطة " + provider);
    }
  })();
}

function _handleSSO(provider) {
  if (!_supabaseClient) return;

  // 1. Open blank popup SYNCHRONOUSLY to beat popup blocker
  const popupFeatures = [
    "width=480",
    "height=640",
    `left=${Math.round(window.screenX + (window.outerWidth - 480) / 2)}`,
    `top=${Math.round(window.screenY + (window.outerHeight - 640) / 2)}`,
    "scrollbars=yes",
    "resizable=yes",
    "noreferrer",
  ].join(",");

  _ssoPopup = window.open("about:blank", "bq_oauth_popup", popupFeatures);

  if (!_ssoPopup) {
    // Popup was blocked — fall back to full-page redirect immediately
    console.warn("[sign-in-dialog] Popup blocked — falling back to full-page redirect.");
    _fallbackFullPageRedirect(provider);
    return;
  }

  _setSSOLoading(true, provider);
  _clearError();

  // 2. Async: get the OAuth URL without triggering navigation
  (async () => {
    try {
      const callbackUrl = window.location.origin + "/oauth-callback.html";
      const { data, error } = await _supabaseClient.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callbackUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error || !data?.url) {
        throw new Error(error?.message || "فشل الحصول على رابط تسجيل الدخول");
      }

      // 3. Navigate the popup — wrapped in try-catch for Phase 3 fix:
      //    Brave/Edge with shields can block the navigation and throw a
      //    SecurityError even though _ssoPopup is non-null.
      try {
        _ssoPopup.location.href = data.url;
      } catch (navErr) {
        // Zombie window cleanup: close the stuck blank popup
        console.warn("[sign-in-dialog] Popup navigation blocked:", navErr.message);
        try { _ssoPopup.close(); } catch (_) {}
        _cleanupSSOState();
        _setSSOLoading(false, provider);
        // Fall back to full-page redirect
        _fallbackFullPageRedirect(provider);
        return;
      }

      // 4. Listen for postMessage from oauth-callback.html
      _ssoMessageHandler = async (event) => {
        // Only trust messages from our own origin
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "BQ_OAUTH_SUCCESS") {
          _cleanupSSOState();
          _setSSOLoading(false, provider);

          const session = event.data.session;
          if (session?.access_token) {
            const ok = await signInWithSupabase(session.access_token);
            if (!ok) {
              // Non-admin: destroy Supabase session before showing error (Phase 4)
              await _handleNonAdminRejection(
                "هذا الحساب ليس لديه صلاحيات المشرف."
              );
              return;
            }
            _onSignedIn();
          }
        } else if (event.data?.type === "BQ_OAUTH_ERROR") {
          _cleanupSSOState();
          _setSSOLoading(false, provider);
          _showError("فشل تسجيل الدخول: " + (event.data.error || "خطأ غير معروف"));
        }
      };

      window.addEventListener("message", _ssoMessageHandler);

      // 5. Poll for popup being closed manually
      _ssoPopupPollInterval = setInterval(() => {
        if (_ssoPopup && _ssoPopup.closed) {
          _cleanupSSOState();
          _setSSOLoading(false, provider);
        }
      }, 500);

    } catch (err) {
      // Close any open popup and clean up
      if (_ssoPopup && !_ssoPopup.closed) {
        try { _ssoPopup.close(); } catch (_) {}
      }
      _cleanupSSOState();
      _setSSOLoading(false, provider);
      _showError("فشل تسجيل الدخول بواسطة " + provider + ": " + (err.message || ""));
    }
  })();
}

function _initSSOButtons() {
  const btnGoogle = _q("sd-btnGoogle");
  const btnGitHub = _q("sd-btnGitHub");
  if (btnGoogle) btnGoogle.addEventListener("click", () => _handleSSO("google"));
  if (btnGitHub) btnGitHub.addEventListener("click", () => _handleSSO("github"));
}

// ── Close button ──────────────────────────────────────────────────────────────

function _initCloseBtn() {
  const closeBtn = _q("sd-closeBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      _cleanupSSOState();
      if (_dialog) _dialog.close();
    });
  }

  // Also close on backdrop click
  if (_dialog) {
    _dialog.addEventListener("click", (e) => {
      // The dialog element itself is the backdrop — a click on ::backdrop
      // hits the dialog, not a descendant.
      if (e.target === _dialog) {
        _cleanupSSOState();
        _dialog.close();
      }
    });
  }
}

// ── Wire up all event listeners after dialog is in DOM ────────────────────────

/**
 * Called once from index.html's DOMContentLoaded to attach all dialog
 * event listeners. Must be called after the dialog HTML is in the page.
 */
export function initSignInDialog() {
  _dialog = document.getElementById("adminSignInDialog");
  if (!_dialog) return;

  _initCloseBtn();
  _initEmailForm();
  _initOtpSubmit();
  _initResendOtp();
  _initChangeEmail();
  _initSSOButtons();
}

// =============================================================================
// public/src/scripts/sign-in.js
// Sign-in page logic.
// =============================================================================

import { signIn, isAdminAuthenticated, getToken } from "./adminAuth.js";

// ── DOM refs ──────────────────────────────────────────────────────────────────

// Forms & Tabs
const tabAccessCode = document.getElementById("tabAccessCode");
const tabEmail = document.getElementById("tabEmail");
const accessCodeForm = document.getElementById("accessCodeForm");
const emailForm = document.getElementById("emailForm");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");

// Access Code UI
const inputAccessCode = document.getElementById("adminIdInput");
const submitBtnAccessCode = document.getElementById("submitBtnAccessCode");
const spinnerAccessCode = document.getElementById("spinnerAccessCode");
const btnTextAccessCode = document.getElementById("btnTextAccessCode");
const errorMsgAccessCode = document.getElementById("errorMsgAccessCode");
const toggleBtnAccessCode = document.getElementById("toggleBtnAccessCode");
const eyeIconAccessCode = document.getElementById("eyeIconAccessCode");
const eyeOffIconAccessCode = document.getElementById("eyeOffIconAccessCode");

// Email UI
const emailStep = document.getElementById("emailStep");
const otpStep = document.getElementById("otpStep");
const inputEmail = document.getElementById("emailInput");
const inputOtp = document.getElementById("otpInput");
const submitBtnEmail = document.getElementById("submitBtnEmail");
const spinnerEmail = document.getElementById("spinnerEmail");
const btnTextEmail = document.getElementById("btnTextEmail");
const submitBtnOtp = document.getElementById("submitBtnOtp");
const spinnerOtp = document.getElementById("spinnerOtp");
const btnTextOtp = document.getElementById("btnTextOtp");
const resendOtpBtn = document.getElementById("resendOtpBtn");
const changeEmailBtn = document.getElementById("changeEmailBtn");
const errorMsgEmail = document.getElementById("errorMsgEmail");
const successMsgEmail = document.getElementById("successMsgEmail");
const ssoDivider = document.getElementById("ssoDivider");
const ssoButtonsContainer = document.getElementById("ssoButtonsContainer");

const btnGitHub = document.getElementById("btnGitHub");
const btnGoogle = document.getElementById("btnGoogle");

let supabaseClient = null;

// ── Helper: get redirect URL ──────────────────────────────────────────────────

function getRedirectUrl() {
  const params = new URLSearchParams(window.location.search);
  const redirectPath = params.get("redirect");
  return redirectPath ? decodeURIComponent(redirectPath) : "/";
}

function redirectToApp() {
  window.location.href = getRedirectUrl();
}

// ── Initialize Supabase ───────────────────────────────────────────────────────

async function initSupabase() {
  try {
    const res = await fetch("/api/env");
    const data = await res.json();
    if (data.supabaseUrl && data.supabaseAnonKey) {
      supabaseClient = window.supabase.createClient(
        data.supabaseUrl,
        data.supabaseAnonKey,
      );

      // Check existing session
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();
      if (session) {
        if (!isAdminAuthenticated()) {
          const { signInWithSupabase } = await import("./adminAuth.js");
          await signInWithSupabase(session.access_token);
        }
        redirectToApp();
      }

      // Listen for auth state changes
      supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_IN" && session) {
          if (!isAdminAuthenticated()) {
            const { signInWithSupabase } = await import("./adminAuth.js");
            await signInWithSupabase(session.access_token);
          }
          redirectToApp();
        }
      });
    }
  } catch (err) {
    console.error("Failed to initialize Supabase:", err);
  }
}

// ── On page load: tab routing & session checks ───────────────────────────────

(function init() {
  // 1. Tab routing — URL query param or path fallback
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");

  if (tab === "email" || path.endsWith("/email")) {
    switchTab("email");
  } else if (tab === "access-code" || path.endsWith("/access-code")) {
    switchTab("access-code");
  } else {
    switchTab("access-code");
  }

  // 2. Admin session check
  if (isAdminAuthenticated()) {
    const token = getToken();
    if (token && !isTokenExpired(token)) {
      redirectToApp();
      return;
    }
    // Token expired — sign out silently
    import("./adminAuth.js").then(({ signOut }) => signOut());
  }

  // 3. Supabase session check
  initSupabase();
})();

function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return Date.now() / 1000 > payload.exp - 30;
  } catch (_) {
    return true;
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
  tabAccessCode.classList.remove("active");
  tabEmail.classList.remove("active");
  accessCodeForm.style.display = "none";
  emailForm.style.display = "none";
  clearError("access-code");
  clearError("email");

  const params = new URLSearchParams(window.location.search);
  params.set("tab", tab);

  // Strip legacy path segments
  let base = window.location.pathname;
  if (base.endsWith("/email")) base = base.slice(0, -6);
  else if (base.endsWith("/access-code")) base = base.slice(0, -12);

  window.history.replaceState({}, "", `${base}?${params.toString()}${window.location.hash}`);

  if (tab === "email") {
    tabEmail.classList.add("active");
    emailForm.style.display = "block";
    pageSubtitle.textContent = "تسجيل الدخول باستخدام البريد الإلكتروني";
  } else {
    tabAccessCode.classList.add("active");
    accessCodeForm.style.display = "block";
    pageSubtitle.textContent = "أدخل رمز الدخول للمتابعة";
  }
}

tabAccessCode.addEventListener("click", () => switchTab("access-code"));
tabEmail.addEventListener("click", () => switchTab("email"));

function setupPasswordToggle(toggleBtn, inputEl, eyeIcon, eyeOffIcon) {
  if (!toggleBtn) return;
  toggleBtn.addEventListener("click", () => {
    const showing = inputEl.type === "text";
    inputEl.type = showing ? "password" : "text";
    eyeIcon.style.display = showing ? "" : "none";
    eyeOffIcon.style.display = showing ? "none" : "";
    inputEl.focus();
  });
}

setupPasswordToggle(toggleBtnAccessCode, inputAccessCode, eyeIconAccessCode, eyeOffIconAccessCode);

// ── Form submission — Access Code ─────────────────────────────────────────────

if (accessCodeForm) {
  accessCodeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const adminId = inputAccessCode.value.trim();
    if (!adminId) {
      showError("access-code", "الرجاء إدخال رمز الدخول");
      inputAccessCode.focus();
      return;
    }

    setLoading("access-code", true);
    clearError("access-code");

    try {
      await signIn(adminId);
      redirectToApp();
    } catch (err) {
      showError("access-code", err.message || "فشل تسجيل الدخول. تحقق من الرمز وحاول مجددًا.");
      inputAccessCode.select();
    } finally {
      setLoading("access-code", false);
    }
  });
}

// ── Form submission — Email (OTP Flow) ────────────────────────────────────────

let currentEmailForOtp = "";

if (emailForm) {
  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supabaseClient) {
      showError("email", "تعذر الاتصال بخدمة المصادقة.");
      return;
    }

    const email = inputEmail.value.trim();
    if (!email) {
      showError("email", "الرجاء إدخال البريد الإلكتروني");
      return;
    }

    setLoading("email", true);
    clearError("email");
    clearSuccess("email");

    try {
      const redirectDest = window.location.origin + "/sign-in.html?redirect=" + encodeURIComponent(getRedirectUrl());
      const { error } = await supabaseClient.auth.signInWithOtp({ 
        email,
        options: {
          emailRedirectTo: redirectDest
        }
      });
      if (error) throw error;

      currentEmailForOtp = email;
      showSuccess("email", "تم إرسال رمز التحقق إلى بريدك الإلكتروني.");
      
      // Switch to OTP step
      emailStep.style.display = "none";
      ssoDivider.style.display = "none";
      ssoButtonsContainer.style.display = "none";
      otpStep.style.display = "block";
      inputOtp.focus();

    } catch (err) {
      console.error(err);
      showError("email", err.message || "حدث خطأ أثناء إرسال رمز التحقق.");
    } finally {
      setLoading("email", false);
    }
  });
}

if (submitBtnOtp) {
  submitBtnOtp.addEventListener("click", async () => {
    const otp = inputOtp.value.trim();
    if (!otp || otp.length < 6) {
      showError("email", "الرجاء إدخال رمز تحقق صحيح مكون من 6 أرقام");
      return;
    }

    setLoading("otp", true);
    clearError("email");
    clearSuccess("email");

    try {
      const { data, error } = await supabaseClient.auth.verifyOtp({
        email: currentEmailForOtp,
        token: otp,
        type: 'email'
      });
      
      if (error) throw error;

      if (!isAdminAuthenticated()) {
        const { signInWithSupabase } = await import("./adminAuth.js");
        await signInWithSupabase(data.session.access_token);
      }
      redirectToApp();

    } catch (err) {
      console.error(err);
      showError("email", "رمز التحقق غير صحيح أو منتهي الصلاحية.");
      inputOtp.select();
    } finally {
      setLoading("otp", false);
    }
  });
}

if (resendOtpBtn) {
  resendOtpBtn.addEventListener("click", async () => {
    if (!currentEmailForOtp) return;
    
    clearError("email");
    clearSuccess("email");
    
    try {
      resendOtpBtn.disabled = true;
      const redirectDest = window.location.origin + "/sign-in.html?redirect=" + encodeURIComponent(getRedirectUrl());
      const { error } = await supabaseClient.auth.signInWithOtp({ 
        email: currentEmailForOtp,
        options: {
          emailRedirectTo: redirectDest
        }
      });
      if (error) throw error;
      
      showSuccess("email", "تمت إعادة إرسال رمز التحقق.");
      setTimeout(() => { resendOtpBtn.disabled = false; }, 30000); // Prevent spamming
    } catch (err) {
      console.error(err);
      showError("email", "حدث خطأ أثناء إعادة إرسال الرمز.");
      resendOtpBtn.disabled = false;
    }
  });
}

if (changeEmailBtn) {
  changeEmailBtn.addEventListener("click", () => {
    otpStep.style.display = "none";
    emailStep.style.display = "block";
    ssoDivider.style.display = "flex";
    ssoButtonsContainer.style.display = "flex";
    inputOtp.value = "";
    clearError("email");
    clearSuccess("email");
    inputEmail.focus();
  });
}

// ── SSO ───────────────────────────────────────────────────────────────────────

async function handleSSO(provider) {
  if (!supabaseClient) return;
  try {
    const redirectDest = window.location.origin + "/sign-in.html?redirect=" + encodeURIComponent(getRedirectUrl());
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirectDest },
    });
    if (error) throw error;
  } catch (err) {
    showError("email", "فشل تسجيل الدخول بواسطة " + provider);
  }
}

if (btnGoogle) btnGoogle.addEventListener("click", () => handleSSO("google"));
if (btnGitHub) btnGitHub.addEventListener("click", () => handleSSO("github"));

// ── UI helpers ────────────────────────────────────────────────────────────────

function setLoading(tab, on) {
  if (tab === "access-code") {
    submitBtnAccessCode.disabled = on;
    spinnerAccessCode.style.display = on ? "block" : "none";
    btnTextAccessCode.textContent = on ? "جارٍ التحقق..." : "تسجيل الدخول";
  } else if (tab === "email") {
    submitBtnEmail.disabled = on;
    spinnerEmail.style.display = on ? "block" : "none";
    btnTextEmail.textContent = on ? "جارٍ الإرسال..." : "إرسال رمز التحقق";
  } else if (tab === "otp") {
    submitBtnOtp.disabled = on;
    spinnerOtp.style.display = on ? "block" : "none";
    btnTextOtp.textContent = on ? "جارٍ التحقق..." : "تأكيد رمز التحقق";
  }
}

function showError(tab, msg) {
  const errEl = tab === "access-code" ? errorMsgAccessCode : errorMsgEmail;
  if (!errEl) return;
  errEl.textContent = "⚠️ " + msg;
  errEl.style.display = "flex";
  // Re-trigger shake animation
  errEl.style.animation = "none";
  requestAnimationFrame(() => {
    errEl.style.animation = "";
  });
}

function clearError(tab) {
  const errEl = tab === "access-code" ? errorMsgAccessCode : errorMsgEmail;
  if (!errEl) return;
  errEl.textContent = "";
  errEl.style.display = "none";
}

function showSuccess(tab, msg) {
  const succEl = tab === "access-code" ? null : successMsgEmail;
  if (!succEl) return;
  succEl.textContent = "✅ " + msg;
  succEl.style.display = "flex";
}

function clearSuccess(tab) {
  const succEl = tab === "access-code" ? null : successMsgEmail;
  if (!succEl) return;
  succEl.textContent = "";
  succEl.style.display = "none";
}
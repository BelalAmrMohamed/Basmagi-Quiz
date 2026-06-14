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
const inputEmail = document.getElementById("emailInput");
const inputEmailPassword = document.getElementById("emailPasswordInput");
const submitBtnEmail = document.getElementById("submitBtnEmail");
const spinnerEmail = document.getElementById("spinnerEmail");
const btnTextEmail = document.getElementById("btnTextEmail");
const errorMsgEmail = document.getElementById("errorMsgEmail");
const toggleBtnEmail = document.getElementById("toggleBtnEmail");
const eyeIconEmail = document.getElementById("eyeIconEmail");
const eyeOffIconEmail = document.getElementById("eyeOffIconEmail");
const btnMicrosoft = document.getElementById("btnMicrosoft");
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
        redirectToApp();
      }

      // Listen for changes
      supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" && session) {
          redirectToApp();
        }
      });
    }
  } catch (err) {
    console.error("Failed to initialize Supabase:", err);
  }
}

// ── On page load: Tab routing & existing sessions ────────────────────────────
(function init() {
  // 1. Tab Routing based on URL query parameter or path fallback
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");

  if (tab === "email" || path.endsWith("/email")) {
    switchTab("email");
  } else if (tab === "access-code" || path.endsWith("/access-code")) {
    switchTab("access-code");
  } else {
    // Default
    switchTab("access-code");
  }

  // 2. Admin Check
  if (isAdminAuthenticated()) {
    const token = getToken();
    if (token && !isTokenExpired(token)) {
      redirectToApp();
      return;
    }
    // Expired
    import("./adminAuth.js").then(({ signOut }) => signOut());
  }

  // 3. Supabase Check
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

// ── Tab Switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  // Reset UI
  tabAccessCode.classList.remove("active");
  tabEmail.classList.remove("active");
  accessCodeForm.style.display = "none";
  emailForm.style.display = "none";
  clearError("access-code");
  clearError("email");

  // Get current search params, set tab, and keep other parameters (like redirect)
  const params = new URLSearchParams(window.location.search);
  params.set("tab", tab);

  // If the pathname currently has /email or /access-code (legacy paths),
  // clean it up to just the base pathname.
  let base = window.location.pathname;
  if (base.endsWith("/email")) {
    base = base.slice(0, -6);
  } else if (base.endsWith("/access-code")) {
    base = base.slice(0, -12);
  }

  const newUrl = `${base}?${params.toString()}${window.location.hash}`;
  window.history.replaceState({}, "", newUrl);

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

// ── Show/hide password toggles ───────────────────────────────────────────────
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

setupPasswordToggle(
  toggleBtnAccessCode,
  inputAccessCode,
  eyeIconAccessCode,
  eyeOffIconAccessCode,
);
setupPasswordToggle(
  toggleBtnEmail,
  inputEmailPassword,
  eyeIconEmail,
  eyeOffIconEmail,
);

// ── Forms Submission ─────────────────────────────────────────────────────────

// Admin Access Code Submit
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
      showError(
        "access-code",
        err.message || "فشل تسجيل الدخول. تحقق من الرمز وحاول مجددًا.",
      );
      inputAccessCode.select();
    } finally {
      setLoading("access-code", false);
    }
  });
}

// Email Form Submit
if (emailForm) {
  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supabaseClient) {
      showError("email", "تعذر الاتصال بخدمة المصادقة.");
      return;
    }

    const email = inputEmail.value.trim();
    const password = inputEmailPassword.value.trim();

    if (!email || !password) {
      showError("email", "الرجاء إدخال البريد الإلكتروني وكلمة المرور");
      return;
    }

    setLoading("email", true);
    clearError("email");

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      redirectToApp();
    } catch (err) {
      showError("email", "البريد الإلكتروني أو كلمة المرور غير صحيحة");
      inputEmailPassword.select();
    } finally {
      setLoading("email", false);
    }
  });
}

// SSO Providers
async function handleSSO(provider) {
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + getRedirectUrl(),
      },
    });
    if (error) throw error;
  } catch (err) {
    showError("email", "فشل تسجيل الدخول بواسطة " + provider);
  }
}

if (btnGoogle) btnGoogle.addEventListener("click", () => handleSSO("google"));
if (btnMicrosoft)
  btnMicrosoft.addEventListener("click", () => handleSSO("azure"));

// ── UI Helpers ────────────────────────────────────────────────────────────────
function setLoading(tab, on) {
  if (tab === "access-code") {
    submitBtnAccessCode.disabled = on;
    spinnerAccessCode.style.display = on ? "block" : "none";
    btnTextAccessCode.textContent = on ? "جارٍ التحقق..." : "تسجيل الدخول";
  } else {
    submitBtnEmail.disabled = on;
    spinnerEmail.style.display = on ? "block" : "none";
    btnTextEmail.textContent = on ? "جارٍ التحقق..." : "تسجيل الدخول";
  }
}

function showError(tab, msg) {
  const errEl = tab === "access-code" ? errorMsgAccessCode : errorMsgEmail;
  if (!errEl) return;
  errEl.textContent = "⚠️ " + msg;
  errEl.style.display = "flex";
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

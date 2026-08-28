import {
  openSignInDialog,
  initSignInDialog,
} from "../../features/home/sign-in.js";

export { openSignInDialog, initSignInDialog };

const modalStyles = "src/features/home/sign-in.css";
const dialogMarkup = `<dialog id="adminSignInDialog" aria-modal="true" aria-label="تسجيل دخول المشرفين" dir="rtl"><div class="sd-card"><button class="sd-close-btn" id="sd-closeBtn" aria-label="إغلاق" type="button">×</button><div class="sd-brand"><img src="/favicon.png" width="32" height="32" alt="بصمجي"><span class="sd-brand-name">منصة إمتحانات بصمجي</span></div><h2 class="sd-title">تسجيل دخول المشرفين</h2><p class="sd-subtitle">يرجى تسجيل الدخول باستخدام بريدك الإلكتروني أو حساب Google/GitHub.</p><form id="sd-emailForm" novalidate><div id="sd-emailStep"><label class="sd-field-label" for="sd-emailInput">البريد الإلكتروني</label><div class="sd-field-wrapper"><input id="sd-emailInput" class="sd-field-input email-ltr" type="email" required dir="ltr"></div><button type="submit" class="sd-btn" id="sd-submitBtnEmail"><div class="sd-spinner" id="sd-spinnerEmail"></div><span id="sd-btnTextEmail">إرسال رمز التحقق</span></button></div><div id="sd-otpStep" style="display:none"><label class="sd-field-label" for="sd-otpInput">رمز التحقق (OTP)</label><div class="sd-field-wrapper"><input id="sd-otpInput" class="sd-field-input otp-ltr" type="text" maxlength="6" inputmode="numeric" dir="ltr"></div><button type="button" class="sd-btn" id="sd-submitBtnOtp"><div class="sd-spinner" id="sd-spinnerOtp"></div><span id="sd-btnTextOtp">تأكيد رمز التحقق</span></button><div class="sd-otp-actions"><button type="button" class="sd-link-btn" id="sd-resendOtpBtn">إعادة إرسال الرمز</button><span class="sd-otp-sep">•</span><button type="button" class="sd-link-btn" id="sd-changeEmailBtn">تغيير البريد</button></div></div><div class="sd-error-msg" id="sd-errorMsg" role="alert"></div><div class="sd-success-msg" id="sd-successMsg" role="status"></div><div class="sd-divider" id="sd-ssoDivider"><span>أو الدخول بواسطة</span></div><div class="sd-sso-buttons" id="sd-ssoButtonsContainer"><button type="button" class="sd-sso-btn" id="sd-btnGitHub"><span>GitHub</span></button><button type="button" class="sd-sso-btn" id="sd-btnGoogle"><span>Google</span></button></div></form><div class="sd-footer"><a href="/privacy-policy.html">سياسة الخصوصية</a> • <a href="/terms-of-service.html">شروط الخدمة</a></div></div></dialog>`;

export function ensureSignInDialog() {
  if (!document.getElementById("adminSignInDialog")) document.body.insertAdjacentHTML("beforeend", dialogMarkup);
  if (!document.querySelector(`link[href="${modalStyles}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = modalStyles;
    document.head.appendChild(link);
  }
  return true;
}

export function mountSignInDialog() {
  if (!ensureSignInDialog()) return;
  initSignInDialog();
}

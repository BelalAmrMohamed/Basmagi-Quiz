import {
  openSignInDialog,
  initSignInDialog,
} from "../../features/home/sign-in.js";

export { openSignInDialog, initSignInDialog };

const modalStyles = "src/features/home/sign-in.css";
const dialogMarkup = `<dialog id="adminSignInDialog" aria-modal="true" aria-label="تسجيل دخول المشرفين" dir="rtl"><div class="sd-card"><button class="sd-close-btn" id="sd-closeBtn" aria-label="إغلاق" type="button">×</button><div class="sd-brand"><img src="/favicon.png" width="32" height="32" alt="بصمجي"><span class="sd-brand-name">منصة امتحانات بصمجي</span></div><h2 class="sd-title">تسجيل دخول المشرفين</h2><p class="sd-subtitle">يرجى تسجيل الدخول باستخدام بريدك الإلكتروني أو حساب Google/GitHub.</p><form id="sd-emailForm" novalidate><div id="sd-emailStep"><label class="sd-field-label" for="sd-emailInput">البريد الإلكتروني</label><div class="sd-field-wrapper"><input id="sd-emailInput" class="sd-field-input email-ltr" type="email" required dir="ltr"></div><button type="submit" class="sd-btn" id="sd-submitBtnEmail"><div class="sd-spinner" id="sd-spinnerEmail"></div><span id="sd-btnTextEmail">إرسال رمز التحقق</span></button></div><div id="sd-otpStep" style="display:none"><label class="sd-field-label" for="sd-otpInput">رمز التحقق (OTP)</label><div class="sd-field-wrapper"><input id="sd-otpInput" class="sd-field-input otp-ltr" type="text" maxlength="6" inputmode="numeric" dir="ltr"></div><button type="button" class="sd-btn" id="sd-submitBtnOtp"><div class="sd-spinner" id="sd-spinnerOtp"></div><span id="sd-btnTextOtp">تأكيد رمز التحقق</span></button><div class="sd-otp-actions"><button type="button" class="sd-link-btn" id="sd-resendOtpBtn">إعادة إرسال الرمز</button><span class="sd-otp-sep">•</span><button type="button" class="sd-link-btn" id="sd-changeEmailBtn">تغيير البريد</button></div></div><div class="sd-error-msg" id="sd-errorMsg" role="alert"></div><div class="sd-success-msg" id="sd-successMsg" role="status"></div><div class="sd-divider" id="sd-ssoDivider"><span>أو الدخول بواسطة</span></div><div class="sd-sso-buttons" id="sd-ssoButtonsContainer"><button type="button" class="sd-sso-btn" id="sd-btnGitHub"><span>GitHub</span><svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.268 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.026 2.747-1.026.546 1.379.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z"/></svg></button><button type="button" class="sd-sso-btn" id="sd-btnGoogle"><span>Google</span><svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.73 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></button></div></form><div class="sd-footer"><a href="/privacy-policy.html">سياسة الخصوصية</a> • <a href="/terms-of-service.html">شروط الخدمة</a></div></div></dialog>`;

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

/* =========================================================
   public/src/components/telegram-bot-card/telegram-bot-card.js
   Telegram bot showcase card (@basmagi_quiz_bot)
   ========================================================= */
import { generateQrSvg } from "./qr-svg-engine.js";
import { showNotification } from "../notifications/notifications.js";

export const TG_BOT_URL = "https://t.me/basmagi_quiz_bot";
export const TG_BOT_DEEP_LINK = "tg://resolve?domain=basmagi_quiz_bot";
export const TG_BOT_HANDLE = "@basmagi_quiz_bot";

export const TELEGRAM_PLANE_ICON_SVG = `<svg class="tg-plane-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.9 3.3 2.7 10.7c-1.3.5-1.3 1.3-.2 1.6l4.9 1.5 1.9 5.8c.2.6.1.8.7.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.2-15c.3-1.3-.5-1.9-1.4-1.5ZM8.4 13.1l9.9-6.2c.5-.3.9-.1.5.2l-8.1 7.3-.3 3.4-2-4.7Z"/></svg>`;
const COPY_ICON = `<svg class="tg-copy-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_ICON = `<svg class="tg-check-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
const DOWNLOAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>`;
const ZOOM_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/></svg>`;
const ARROW_ICON = `<svg class="tg-arrow-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`;
const VERIFIED_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#24A1DE"/><path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const FEATURES = [
  { title: "إنشاء امتحانات فورية", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>` },
  { title: "تصفح المقررات والملفات", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>` },
  { title: "قراءة PDF ومستندات Word", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>` },
  { title: "تصدير بـ 6 صيغ تفاعلية", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>` },
];
const DEFAULT_TITLE = "الباشــمبصمج على تيليجرام";
const DEFAULT_DESC =
  "ذاكر، أنشئ امتحاناتك، وتصفح مقررات المنصة مباشرة من تطبيق تيليجرام في أي وقت ومن أي جهاز.";

let _instanceCounter = 0;

// Hosts that don't <link> telegram-bot-card.css get it injected on demand.
function ensureStyles() {
  const href = new URL("./telegram-bot-card.css", import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}
function qrColor() {
  return currentTheme() === "light" ? "#0b1b2b" : "#ffffff";
}
function buildQr(opts = {}) {
  return generateQrSvg(TG_BOT_URL, {
    ecc: "H",
    margin: 1,
    color: qrColor(),
    logo: true,
    logoColor: "#24A1DE",
    label: "رمز QR لبوت الباشــمبصمج على تيليجرام",
    ...opts,
  });
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- copy ---------- */
export async function copyTelegramBotLink(triggerBtn = null) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(TG_BOT_URL);
      ok = true;
    }
  } catch (_) { /* fall through to legacy path */ }
  if (!ok) {
    try {
      const ta = document.createElement("textarea");
      ta.value = TG_BOT_URL;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch (_) { ok = false; }
  }
  if (ok) {
    showNotification("تم نسخ الرابط", "t.me/basmagi_quiz_bot", "success");
    if (triggerBtn) {
      const label = triggerBtn.querySelector(".tg-copy-label");
      const original = label ? label.textContent : "";
      triggerBtn.classList.add("is-copied");
      if (label) label.textContent = "تم النسخ!";
      clearTimeout(triggerBtn._tgTimer);
      triggerBtn._tgTimer = setTimeout(() => {
        triggerBtn.classList.remove("is-copied");
        if (label) label.textContent = original || "نسخ الرابط";
      }, 2000);
    }
  } else {
    showNotification("تعذّر النسخ", TG_BOT_URL, "error");
  }
  return ok;
}

/* ---------- smart deep link ---------- */
function launchTelegram(e) {
  if (e) e.preventDefault();
  let left = false;
  const onHide = () => { if (document.hidden) left = true; };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("blur", onHide, { once: true });
  try { window.location.href = TG_BOT_DEEP_LINK; } catch (_) { /* ignore */ }
  setTimeout(() => {
    document.removeEventListener("visibilitychange", onHide);
    if (!left && !document.hidden) {
      const w = window.open(TG_BOT_URL, "_blank", "noopener,noreferrer");
      if (!w) window.location.href = TG_BOT_URL;
    }
  }, 1200);
}

/* ---------- QR download ---------- */
function downloadQr(kind = "svg") {
  const svg = buildQr({ color: "#0b1b2b", background: "#ffffff", margin: 4 });
  const name = "basmagi_quiz_bot-qr";
  const save = (blob, ext) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const svgBlob = new Blob([svg], { type: "image/svg+xml" });
  if (kind === "svg") return save(svgBlob, "svg");
  const img = new Image();
  const url = URL.createObjectURL(svgBlob);
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, 1024, 1024);
    URL.revokeObjectURL(url);
    c.toBlob((b) => (b ? save(b, "png") : save(svgBlob, "svg")), "image/png");
  };
  img.onerror = () => { URL.revokeObjectURL(url); save(svgBlob, "svg"); };
  img.src = url;
}

/* ---------- lightbox ---------- */
function openQrLightbox() {
  const prev = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "tg-bot-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "رمز QR مكبّر");
  overlay.innerHTML = `
    <div class="tg-bot-lightbox-inner">
      <div class="tg-bot-lightbox-qr">${buildQr({ color: "#0b1b2b", background: "#ffffff", margin: 2 })}</div>
      <div class="tg-bot-handle" dir="ltr">${TG_BOT_HANDLE}</div>
      <button type="button" class="tg-bot-btn tg-bot-btn--secondary tg-bot-lightbox-close" aria-label="إغلاق"><span>إغلاق</span></button>
    </div>`;
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    if (prev && prev.focus) prev.focus();
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") { ev.stopPropagation(); close(); }
    else if (ev.key === "Tab") { ev.preventDefault(); overlay.querySelector(".tg-bot-lightbox-close").focus(); }
  };
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
  overlay.querySelector(".tg-bot-lightbox-close").addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  overlay.querySelector(".tg-bot-lightbox-close").focus();
}

/* ---------- card ---------- */
export function createTelegramBotCard(options = {}) {
  const {
    variant = "showcase",
    title = DEFAULT_TITLE,
    description = DEFAULT_DESC,
    showFeatures = variant !== "compact" && variant !== "banner",
    showDownload = variant !== "compact" && variant !== "banner",
  } = options;
  ensureStyles();
  const id = ++_instanceCounter;
  const card = document.createElement("div");
  card.className = `tg-bot-card tg-bot-card--${variant}`;
  const showQr = variant !== "banner";

  card.innerHTML = `
    <div class="tg-bot-glow" aria-hidden="true"></div>
    <div class="tg-bot-header">
      <div class="tg-bot-avatar-wrap">
        <img src="/assets/images/el-bash-mebasmag--no-bg.png" alt="الباشــمبصمج" class="tg-bot-avatar" width="56" height="56" loading="lazy">
        <span class="tg-bot-badge-icon" title="بوت رسمي موثق" role="img" aria-label="بوت رسمي موثق">${VERIFIED_ICON}</span>
      </div>
      <div class="tg-bot-identity">
        <div class="tg-bot-status"><span class="tg-bot-pulse-dot" aria-hidden="true"></span><span>متاح 24/7 عبر تيليجرام</span></div>
        <h3 class="tg-bot-title">${esc(title)}</h3>
        <span class="tg-bot-handle" dir="ltr">${TG_BOT_HANDLE}</span>
      </div>
    </div>
    <p class="tg-bot-description">${esc(description)}</p>
    ${showFeatures ? `<ul class="tg-bot-features">${FEATURES.map((f) => `<li class="tg-bot-feature"><span class="tg-bot-feature-icon">${f.icon}</span><span class="tg-bot-feature-text">${f.title}</span></li>`).join("")}</ul>` : ""}
    ${showQr ? `
    <div class="tg-bot-qr-section">
      <button type="button" class="tg-bot-qr-box" id="tgQrContainer-${id}" aria-label="تكبير رمز QR" title="انقر لتكبير الرمز">
        <span class="tg-bot-qr-svg">${buildQr()}</span>
        <span class="tg-bot-qr-overlay-hint">${ZOOM_ICON}<span>انقر للتكبير</span></span>
      </button>
      <div class="tg-bot-qr-meta">
        <span class="tg-bot-qr-tip">امسح الكاميرا بهاتفك لبدء المحادثة فوراً</span>
        ${showDownload ? `<button type="button" class="tg-bot-btn-text tg-bot-download-qr-btn" aria-label="حفظ رمز QR كصورة">${DOWNLOAD_ICON}<span>حفظ رمز QR</span></button>` : ""}
      </div>
    </div>` : ""}
    <div class="tg-bot-actions">
      <a href="${TG_BOT_URL}" target="_blank" rel="noopener noreferrer" class="tg-bot-btn tg-bot-btn--primary tg-bot-redirect-btn" aria-label="فتح الباشــمبصمج في تيليجرام">
        ${TELEGRAM_PLANE_ICON_SVG}<span>فتح في تيليجرام</span>${ARROW_ICON}
      </a>
      <button type="button" class="tg-bot-btn tg-bot-btn--secondary tg-bot-copy-btn" aria-label="نسخ رابط البوت">
        ${COPY_ICON}${CHECK_ICON}<span class="tg-copy-label">نسخ الرابط</span>
      </button>
      ${variant === "banner" ? `<button type="button" class="tg-bot-btn-text tg-bot-show-qr-btn" aria-label="عرض رمز QR">${ZOOM_ICON}<span>عرض رمز QR</span></button>` : ""}
    </div>`;

  card.querySelector(".tg-bot-redirect-btn").addEventListener("click", launchTelegram);
  const copyBtn = card.querySelector(".tg-bot-copy-btn");
  copyBtn.addEventListener("click", () => copyTelegramBotLink(copyBtn));
  const qrBox = card.querySelector(".tg-bot-qr-box");
  if (qrBox) qrBox.addEventListener("click", openQrLightbox);
  const dl = card.querySelector(".tg-bot-download-qr-btn");
  if (dl) dl.addEventListener("click", () => downloadQr("png"));
  const showQrBtn = card.querySelector(".tg-bot-show-qr-btn");
  if (showQrBtn) showQrBtn.addEventListener("click", openQrLightbox);

  // keep QR color in sync with theme switches
  if (qrBox) {
    const mo = new MutationObserver(() => {
      if (!card.isConnected) return mo.disconnect();
      qrBox.querySelector(".tg-bot-qr-svg").innerHTML = buildQr();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  return card;
}

export function mountTelegramBotCard(container, options = {}) {
  if (!container) return null;
  const card = createTelegramBotCard(options);
  container.replaceChildren(card);
  return card;
}

/* ---------- modal ---------- */
export function openTelegramBotModal() {
  const existing = document.querySelector(".tg-bot-modal");
  if (existing) return;
  const prev = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "tg-bot-modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "بوت الباشــمبصمج على تيليجرام");
  const shell = document.createElement("div");
  shell.className = "tg-bot-modal-shell";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tg-bot-modal-close";
  closeBtn.setAttribute("aria-label", "إغلاق");
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  shell.append(closeBtn, createTelegramBotCard({ variant: "modal" }));
  overlay.appendChild(shell);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    if (prev && prev.focus) prev.focus();
  };
  const onKey = (ev) => {
    if (document.querySelector(".tg-bot-lightbox")) return;
    if (ev.key === "Escape") close();
    else if (ev.key === "Tab") {
      const f = overlay.querySelectorAll("button, a[href]");
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  };
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  closeBtn.focus();
}

// public/src/features/privacy-and-terms/documentation-shell.js
const sidebarMarkup = `
  <div class="side-menu-backdrop" id="sideMenuBackdrop" aria-hidden="true" role="presentation"></div>
  <aside class="sidebar" id="sidebar" role="dialog" aria-modal="true" aria-label="القائمة الجانبية" aria-hidden="true" tabindex="-1">
    <div class="sidebar-drag-handle" id="sidebarDragHandle" aria-hidden="true"><span class="sidebar-drag-handle-bar"></span></div>
    <button class="sidebar-favicon" id="sidebarExpandBtn" type="button" title="توسيع القائمة" aria-label="توسيع القائمة" data-tooltip="توسيع القائمة">
      <img src="./favicon.png" alt="منصة إمتحانات بصمجي" width="28" height="28" class="sidebar-favicon-img">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-open-icon sidebar-expand-icon" aria-hidden="true">
        <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/>
      </svg>
    </button>
    <div class="sidebar-header sidebar-expanded-only">
      <a href="/" class="sidebar-brand-link" aria-label="الصفحة الرئيسية">
        <div class="sidebar-logo" title="منصة إمتحانات بصمجي">
          <svg xmlns="http://www.w3.org/2000/svg" width="180" height="40" viewBox="0 0 220 40" style="direction: ltr;"><image x="0" y="0" width="40" height="40" href="./favicon.png" /><text x="50" y="27" font-family="Tajawal, Arial, sans-serif" font-size="17" font-weight="bold" fill="currentColor" text-anchor="start">إمتحانات بصمجي</text></svg>
        </div>
      </a>
      <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" type="button" title="طي القائمة" aria-label="طي القائمة" data-tooltip="طي القائمة">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-left-icon icon-default" aria-hidden="true">
          <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-left-open-icon icon-hover" aria-hidden="true">
          <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>
        </svg>
      </button>
    </div>
    <nav role="navigation" aria-label="روابط التنقل">
      <a href="/" title="الصفحة الرئيسية" class="menu-item" data-tooltip="الصفحة الرئيسية"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg><span class="menu-label">الصفحة الرئيسية</span></a>
      <a href="/create-quiz.html" title="إنشاء إمتحانات" class="menu-item" data-tooltip="إنشاء إمتحانات"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 21h8" /><path d="m15 5 4 4" /><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></svg><span class="menu-label">إنشاء إمتحانات</span></a>
      <a href="/profile.html" title="الحساب" class="menu-item" data-tooltip="الحساب"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg><span class="menu-label">الحساب</span></a>
      <div class="menu-divider desktop-only-divider" role="separator"></div>
      <a href="/settings.html" title="الإعدادات" class="menu-item" data-tooltip="الإعدادات"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg><span class="menu-label">الإعدادات</span></a>
    </nav>
  </aside>
  <nav class="bottom-nav" id="bottomNav" role="navigation" aria-label="التنقل الرئيسي">
    <a href="/" class="bottom-nav-item" data-bottom-nav="home"><span class="bottom-nav-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg></span><span class="bottom-nav-label">الرئيسية</span></a>
    <a href="/create-quiz.html" class="bottom-nav-item" data-bottom-nav="create"><span class="bottom-nav-icon"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 21h8" /><path d="m15 5 4 4" /><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></svg></span><span class="bottom-nav-label">إنشاء</span></a>
    <a href="/profile.html" class="bottom-nav-item bottom-nav-item-profile" data-bottom-nav="profile"><span class="bottom-nav-icon bottom-nav-icon-profile"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg></span><span class="bottom-nav-label">الحساب</span></a>
    <a href="/settings.html" class="bottom-nav-item" data-bottom-nav="settings"><span class="bottom-nav-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.8 1.8-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1.03 1.56V21h-2.54v-.1A1.7 1.7 0 0 0 10.4 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-1.8-1.8.06-.06A1.7 1.7 0 0 0 8.1 15a1.7 1.7 0 0 0-1.56-1.03H6v-2.54h.54A1.7 1.7 0 0 0 8.1 10.37a1.7 1.7 0 0 0-.34-1.88L7.7 8.43l1.8-1.8.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56V5h2.54v.47a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.8 1.8-.06.06A1.7 1.7 0 0 0 19.4 10c.27.63.9 1.03 1.56 1.03h.54v2.54h-.54A1.7 1.7 0 0 0 19.4 15Z" /></svg></span><span class="bottom-nav-label">الإعدادات</span></a>
    <button type="button" class="bottom-nav-item" id="bottomNavMoreBtn" data-bottom-nav="more" aria-haspopup="true" aria-expanded="false" aria-controls="sidebar"><span class="bottom-nav-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg></span><span class="bottom-nav-label">المزيد</span></button>
  </nav>
`;

(function setInitialSidebarState() {
  try {
    const expanded = window.innerWidth > 768 && localStorage.getItem("sidebar_expanded") === "true";
    window.__sidebarExpandedInit = expanded;
    if (expanded) document.body.classList.add("sidebar-expanded");
  } catch (_) {}
})();

document.body.insertAdjacentHTML("afterbegin", sidebarMarkup);

const sidebar = document.getElementById("sidebar");
const profileLink = sidebar?.querySelector('a[href="/profile.html"]');
if (profileLink) {
  profileLink.outerHTML = `<div class="menu-item-dropdown-wrap">
    <button type="button" id="sideMenuProfileTrigger" title="الحساب" class="menu-item" data-tooltip="الحساب" aria-haspopup="true" aria-expanded="false" aria-controls="sideMenuProfileDropdown"><svg class="menu-item-default-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg><img class="menu-item-avatar" id="navSidebarAvatar" src="" alt="" style="display:none;"><span class="menu-label">الحساب</span></button>
    <div id="sideMenuProfileDropdown" class="side-menu-profile-dropdown" role="menu" aria-label="قائمة الحساب"><div class="side-menu-profile-dropdown-header"><div class="side-menu-profile-dropdown-cover" id="sideMenuDropdownCover" aria-hidden="true"></div><div class="side-menu-profile-dropdown-avatar-wrap"><img class="side-menu-profile-dropdown-avatar" id="sideMenuDropdownAvatar" src="" alt="" style="display:none;"><svg class="side-menu-profile-dropdown-default-icon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg></div><div class="side-menu-profile-dropdown-labels"><span id="sideMenuDropdownName" class="side-menu-profile-dropdown-name"></span><span id="sideMenuDropdownEmailRow" class="side-menu-profile-dropdown-email-row" style="display:none;"><span id="sideMenuDropdownEmail" class="side-menu-profile-dropdown-email"></span></span></div></div><div class="side-menu-profile-dropdown-divider" role="separator"></div><a href="/profile.html" class="side-menu-profile-dropdown-item" role="menuitem"><svg id="sideMenuDropdownItemAvatarIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg><img class="side-menu-profile-dropdown-item-avatar" id="sideMenuDropdownItemAvatar" src="" alt="" style="display:none;"><span>الحساب</span></a><a href="/reports.html" class="side-menu-profile-dropdown-item" role="menuitem"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg><span>البلاغات</span></a><button type="button" class="side-menu-profile-dropdown-item" role="menuitem" onclick="changeUsername()"><span>تغيير الإسم</span></button><div class="side-menu-profile-dropdown-divider" role="separator"></div><button type="button" id="sideMenuDropdownSignOut" class="side-menu-profile-dropdown-item side-menu-profile-dropdown-item-danger" role="menuitem" style="display:none;"><span>تسجيل الخروج</span></button><span id="sideMenuDropdownSignIn" class="side-menu-profile-dropdown-item side-menu-profile-dropdown-item-muted" role="menuitem" style="display:none;"><span>تسجيل الدخول</span></span></div>
  </div>`;
}

const sidebarNav = sidebar?.querySelector("nav");
if (sidebarNav) {
  sidebarNav.insertAdjacentHTML("beforeend", `<div class="menu-divider" role="separator" aria-hidden="true"></div><div class="theme-controls-section"><button type="button" class="theme-controls-toggle sidebar-expanded-only" id="themeControlsToggle" aria-expanded="true" aria-controls="themeControlsPanel"><span class="theme-controls-toggle-label"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></svg><span class="menu-label">المظهر والأداء</span></span><svg class="theme-controls-toggle-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></button><button type="button" class="theme-section-header sidebar-collapsed-only" data-tooltip="الخلفية" title="المظهر والأداء" aria-label="فتح إعدادات المظهر والأداء"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></svg></button><div class="theme-controls-panel" id="themeControlsPanel"><div class="theme-selector-grid sidebar-expanded-only" role="group" aria-label="اختيار الخلفية"><button class="theme-selector-btn" title="الخلفية السوداء" data-theme="dark" aria-pressed="false"><span class="theme-btn-preview" aria-hidden="true"><span class="theme-btn-preview-header"></span><span class="theme-btn-preview-list"><span class="theme-btn-preview-row"></span><span class="theme-btn-preview-row"></span></span></span><span class="theme-btn-label">السوداء</span></button><button class="theme-selector-btn" title="الخلفية الزرقاء" data-theme="dark-slate" aria-pressed="false"><span class="theme-btn-preview" aria-hidden="true"><span class="theme-btn-preview-header"></span><span class="theme-btn-preview-list"><span class="theme-btn-preview-row"></span><span class="theme-btn-preview-row"></span></span></span><span class="theme-btn-label">الزرقاء</span></button><button class="theme-selector-btn" title="الخلفية البيضاء" data-theme="light" aria-pressed="false"><span class="theme-btn-preview" aria-hidden="true"><span class="theme-btn-preview-header"></span><span class="theme-btn-preview-list"><span class="theme-btn-preview-row"></span><span class="theme-btn-preview-row"></span></span></span><span class="theme-btn-label">البيضاء</span></button></div><label class="animation-toggle-container sidebar-expanded-only"><span class="animation-toggle-label">رسوم الخلفية</span><input type="checkbox" id="animationToggle" class="toggle-input" checked aria-label="رسوم الخلفية المتحركة"><span class="toggle-switch" aria-hidden="true"></span></label><label class="animation-toggle-container high-performance-toggle-container sidebar-expanded-only"><span class="animation-toggle-label">الأداء الفائق</span><input type="checkbox" id="highPerformanceToggle" class="toggle-input" aria-label="تفعيل الأداء الفائق"><span class="toggle-switch" aria-hidden="true"></span></label></div></div>`);
  sidebar.querySelectorAll(".theme-selector-btn").forEach((button) => {
    const check = document.createElement("span");
    check.className = "theme-btn-check";
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>`;
    button.insertBefore(check, button.querySelector(".theme-btn-label"));
  });
  // side-menu.js locates ".mobile-only-menu-item[onclick*='changeUsername']"
  // to know where to inject the mobile admin-sign-in button and the mobile
  // reports link (see its DOMContentLoaded handler) — that element only
  // existed in the full app sidebar (index.html), not in this shell's
  // trimmed-down copy, so those two nav items silently never appeared on
  // doc pages even though the shared script runs here too. Adding the same
  // anchor element restores parity without duplicating side-menu.js's
  // injection logic a second time.
  sidebarNav.insertAdjacentHTML(
    "beforeend",
    `<button onclick="changeUsername()" class="menu-item mobile-only-menu-item" title="تغيير الإسم" data-tooltip="تغيير الإسم"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg><span class="menu-label">تغيير الإسم: <span class="change-username" id="userNameDisplay"></span></span></button>`,
  );
    sidebar.insertAdjacentHTML("beforeend", `<div class="sidebar-pinned-actions" role="navigation" aria-label="إجراءات إضافية"><button class="menu-item" id="contactDevBtn" title="تواصل مع المطور؛ للتبليغ عن أي عطل" data-tooltip="تواصل مع المطور"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg><span class="menu-label">تواصل مع المطور</span></button><button class="menu-item install-app" title="تثبيت التطبيق" data-action="installApp" data-tooltip="تثبيت التطبيق" style="display:none;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="20" x="5" y="2" rx="2" ry="2" /><path d="M12 18h.01" /></svg><span class="menu-label">تثبيت التطبيق</span></button></div>`);
}

// ── "المستندات" (Docs) links ────────────────────────────────────────────
// This shell (documentation-shell.js) is only loaded on the doc pages
// themselves (about/privacy/terms/how-to-*), not the main app pages, so
// this section only ever renders there — the main app sidebar (rendered by
// side-menu.js alone, without this shell) is intentionally left untouched.
// A flat list (rather than a collapsible submenu) is used since there's no
// existing collapsible-group pattern in side-menu.js to reuse, and six
// links don't really need one.
const DOCS_LINKS = [
  { href: "/about.html", label: "عن المنصة" },
  { href: "/privacy-policy.html", label: "سياسة الخصوصية" },
  { href: "/terms-of-service.html", label: "شروط الخدمة" },
  { href: "/how-to-create-a-quiz.html", label: "إنشاء اختبار" },
  // Still marked "قريباً" (Coming Soon) here, same soft-launch signal the
  // old per-page docs-switcher used to show for this doc specifically.
  { href: "/how-to-upload-a-quiz.html", label: "رفع اختبار", soon: true },
  { href: "/how-to-use-ai-agent.html", label: "البشــمبصمج" },
];

if (sidebarNav) {
  const docsLinksHtml = DOCS_LINKS.map(
    ({ href, label, soon }) =>
      `<a href="${href}" class="menu-item docs-menu-link" title="${label}" data-tooltip="${label}" data-docs-label="${label}">` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>` +
      `<span class="menu-label">${label}${soon ? ' <small class="docs-menu-soon-badge">قريباً</small>' : ""}</span>` +
      `</a>`,
  ).join("");

  sidebarNav.insertAdjacentHTML(
    "beforeend",
    `<div class="menu-divider" role="separator" aria-hidden="true"></div>` +
      `<div class="docs-menu-heading sidebar-expanded-only" aria-hidden="true">المستندات</div>` +
      // Search only makes sense once the sidebar is wide enough to show an
      // input + labels — hidden on the collapsed icon-rail via
      // sidebar-expanded-only, same convention every other text control in
      // this sidebar already follows (see the theme controls section
      // above). With only six links this is a small convenience, not a
      // necessity, but it's cheap and scales naturally if more docs are
      // added later.
      `<div class="docs-menu-search-wrap sidebar-expanded-only">` +
      `<input type="search" id="docsMenuSearch" class="docs-menu-search" placeholder="بحث في المستندات" aria-label="بحث في المستندات" autocomplete="off">` +
      `</div>` +
      `<div class="docs-menu-section" role="navigation" aria-label="مستندات المنصة">${docsLinksHtml}` +
      `<p class="docs-menu-empty" hidden>لا توجد نتائج</p>` +
      `</div>`,
  );

  // Mark the current page's link active via location.pathname, generically,
  // instead of the old per-file hardcoded docs-switcher-link--active class.
  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  sidebarNav.querySelectorAll(".docs-menu-section .menu-item[href]").forEach((link) => {
    const linkPath = link.getAttribute("href").replace(/^\//, "");
    const isActive = linkPath === currentPath;
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  // ── Filter-as-you-type ──────────────────────────────────────────────────
  // Client-side only: filters the six links already in the DOM by their
  // Arabic label, no fetch/index needed at this scale. Collapsing the
  // sidebar back to icon-only (mobile, or a manual collapse) clears the
  // filter so a stale search doesn't leave links hidden with no visible way
  // to search again.
  const searchInput = document.getElementById("docsMenuSearch");
  const docsSection = sidebarNav.querySelector(".docs-menu-section");
  const emptyState = docsSection?.querySelector(".docs-menu-empty");
  if (searchInput && docsSection) {
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.trim().toLowerCase();
      let anyVisible = false;
      docsSection.querySelectorAll(".docs-menu-link").forEach((link) => {
        const label = (link.dataset.docsLabel || "").toLowerCase();
        const matches = !query || label.includes(query);
        link.hidden = !matches;
        if (matches) anyVisible = true;
      });
      if (emptyState) emptyState.hidden = anyVisible;
    });
  }
}

const mobileProfile = document.querySelector('.bottom-nav-item-profile .bottom-nav-icon');
if (mobileProfile) mobileProfile.innerHTML = `<svg class="bottom-nav-default-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg><img class="bottom-nav-avatar" id="navBottomAvatar" src="" alt="" style="display:none;">`;
await import("../../shared/theme-controller.js");
await import("../../components/side-menu/side-menu.js");
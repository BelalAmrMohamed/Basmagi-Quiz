// public/src/features/privacy-and-terms/documentation-shell.js
const sidebarMarkup = `
  <div class="side-menu-backdrop" id="sideMenuBackdrop" aria-hidden="true" role="presentation"></div>
  <aside class="sidebar" id="sidebar" role="dialog" aria-modal="true" aria-label="القائمة الجانبية" aria-hidden="true" tabindex="-1">
    <div class="sidebar-drag-handle" id="sidebarDragHandle" aria-hidden="true"><span class="sidebar-drag-handle-bar"></span></div>
    <button class="sidebar-favicon" id="sidebarExpandBtn" type="button" title="توسيع القائمة" aria-label="توسيع القائمة" data-tooltip="توسيع القائمة">
      <img src="./favicon.png" alt="منصة امتحانات بصمجي" width="28" height="28" class="sidebar-favicon-img">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-open-icon sidebar-expand-icon" aria-hidden="true">
        <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/>
      </svg>
    </button>
    <div class="sidebar-header sidebar-expanded-only">
      <a href="/" class="sidebar-brand-link" aria-label="الصفحة الرئيسية">
        <div class="sidebar-logo" title="منصة امتحانات بصمجي">
          <svg xmlns="http://www.w3.org/2000/svg" width="180" height="40" viewBox="0 0 220 40" style="direction: ltr;"><image x="0" y="0" width="40" height="40" href="./favicon.png" /><text x="50" y="27" font-family="Tajawal, Arial, sans-serif" font-size="17" font-weight="bold" fill="currentColor" text-anchor="start">امتحانات بصمجي</text></svg>
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
      <a href="/create-quiz.html" title="إنشاء امتحانات" class="menu-item" data-tooltip="إنشاء امتحانات"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 21h8" /><path d="m15 5 4 4" /><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></svg><span class="menu-label">إنشاء امتحانات</span></a>
      <a href="/profile.html" title="الحساب" class="menu-item" data-tooltip="الحساب"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg><span class="menu-label">الحساب</span></a>
    </nav>
  </aside>
  <nav class="bottom-nav" id="bottomNav" role="navigation" aria-label="التنقل الرئيسي">
    <a href="/" class="bottom-nav-item" data-bottom-nav="home"><span class="bottom-nav-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg></span><span class="bottom-nav-label">الرئيسية</span></a>
    <a href="/create-quiz.html" class="bottom-nav-item" data-bottom-nav="create"><span class="bottom-nav-icon"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 21h8" /><path d="m15 5 4 4" /><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></svg></span><span class="bottom-nav-label">إنشاء</span></a>
    <a href="/profile.html" class="bottom-nav-item bottom-nav-item-profile" data-bottom-nav="profile"><span class="bottom-nav-icon bottom-nav-icon-profile"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg></span><span class="bottom-nav-label">الحساب</span></a>
    <a href="/settings.html" class="bottom-nav-item" data-bottom-nav="settings"><span class="bottom-nav-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" /></svg></span><span class="bottom-nav-label">الإعدادات</span></a>
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
    <div id="sideMenuProfileDropdown" class="side-menu-profile-dropdown" role="menu" aria-label="قائمة الحساب"><div class="side-menu-profile-dropdown-header"><div class="side-menu-profile-dropdown-cover" id="sideMenuDropdownCover" aria-hidden="true"></div><div class="side-menu-profile-dropdown-avatar-wrap"><img class="side-menu-profile-dropdown-avatar" id="sideMenuDropdownAvatar" src="" alt="" style="display:none;"><svg class="side-menu-profile-dropdown-default-icon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg></div><div class="side-menu-profile-dropdown-labels"><span id="sideMenuDropdownName" class="side-menu-profile-dropdown-name"></span><span id="sideMenuDropdownEmailRow" class="side-menu-profile-dropdown-email-row" style="display:none;"><span id="sideMenuDropdownEmail" class="side-menu-profile-dropdown-email"></span></span></div></div><div class="side-menu-profile-dropdown-divider" role="separator"></div><a href="/profile.html" class="side-menu-profile-dropdown-item" role="menuitem"><svg id="sideMenuDropdownItemAvatarIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg><img class="side-menu-profile-dropdown-item-avatar" id="sideMenuDropdownItemAvatar" src="" alt="" style="display:none;"><span>الحساب</span></a><a href="/reports.html" class="side-menu-profile-dropdown-item" role="menuitem"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg><span>البلاغات</span></a><button type="button" class="side-menu-profile-dropdown-item" role="menuitem" onclick="changeUsername()"><span>تغيير الإسم</span></button><div class="side-menu-profile-dropdown-divider" role="separator"></div><button type="button" id="sideMenuDropdownSignOut" class="side-menu-profile-dropdown-item side-menu-profile-dropdown-item-danger" role="menuitem" style="display:none;"><span>تسجيل الخروج</span></button><span id="sideMenuDropdownSignIn" class="side-menu-profile-dropdown-item side-menu-profile-dropdown-item-signin" role="menuitem" style="display:none;"><svg class="side-menu-dropdown-google-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17Z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"/></svg><span>تسجيل الدخول</span></span></div>
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
    sidebar.insertAdjacentHTML("beforeend", `<div class="sidebar-pinned-actions" role="navigation" aria-label="إجراءات إضافية"><a href="/settings.html" class="menu-item" id="sidebarSettingsBtn" title="الإعدادات" data-tooltip="الإعدادات"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg><span class="menu-label">الإعدادات</span></a><button class="menu-item install-app" title="تثبيت التطبيق" data-action="installApp" data-tooltip="تثبيت التطبيق" style="display:none;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="20" x="5" y="2" rx="2" ry="2" /><path d="M12 18h.01" /></svg><span class="menu-label">تثبيت التطبيق</span></button></div>`);
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
  {
    href: "/about.html",
    label: "عن المنصة",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  },
  {
    href: "/privacy-policy.html",
    label: "سياسة الخصوصية",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
  },
  {
    href: "/terms-of-service.html",
    label: "شروط الخدمة",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  },
  {
    href: "/how-to-create-a-quiz.html",
    label: "إنشاء اختبار",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/><path d="m15 5 3 3"/></svg>`,
  },
  // Still marked "قريباً" (Coming Soon) here, same soft-launch signal the
  // old per-page docs-switcher used to show for this doc specifically.
  {
    href: "/how-to-upload-a-quiz.html",
    label: "رفع اختبار",
    soon: true,
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  },
  {
    href: "/how-to-use-ai-agent.html",
    label: "الباشــمبصمج",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`,
  },
];

if (sidebarNav) {
  const docsLinksHtml = DOCS_LINKS.map(
    ({ href, label, soon, icon }) =>
      `<a href="${href}" class="menu-item docs-menu-link" title="${label}" data-tooltip="${label}" data-docs-label="${label}">` +
      icon +
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

  // ── Search-as-you-type ──────────────────────────────────────────────────
  // Searches each doc's actual page content, not just its six-word sidebar
  // label — a label-only filter technically works as a "filter" but reads
  // as broken "search" the moment someone types a word that's clearly IN
  // one of the docs (e.g. a policy term) and gets no match because that
  // word never appears in the nav label itself.
  //
  // Each doc page is fetched once (lazily, only once the user actually
  // searches) and reduced to lowercased plain text, cached in-memory for
  // the rest of this page's lifetime AND in sessionStorage so navigating
  // between doc pages within the same browsing session doesn't re-fetch
  // and re-parse every doc from scratch on every page load. These are
  // static, same-origin files — no auth/cache-busting concerns — so a
  // plain fetch + DOMParser text extraction is enough; no server-side
  // search index is warranted at six documents.
  const searchInput = document.getElementById("docsMenuSearch");
  const docsSection = sidebarNav.querySelector(".docs-menu-section");
  const emptyState = docsSection?.querySelector(".docs-menu-empty");
  if (searchInput && docsSection) {
    const CONTENT_CACHE_KEY = "docs_search_content_cache_v1";
    let contentCache = null; // href -> lowercased plain text, lazily loaded
    function loadContentCache() {
      if (contentCache) return contentCache;
      try {
        contentCache = JSON.parse(sessionStorage.getItem(CONTENT_CACHE_KEY) || "{}");
      } catch (_) {
        contentCache = {};
      }
      return contentCache;
    }
    function saveContentCache() {
      try {
        sessionStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(contentCache || {}));
      } catch (_) {
        /* sessionStorage full/unavailable — search still works without the cache */
      }
    }

    async function getDocText(href) {
      const cache = loadContentCache();
      if (typeof cache[href] === "string") return cache[href];
      try {
        const res = await fetch(href);
        if (!res.ok) throw new Error(`fetch ${href} failed: ${res.status}`);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        // Only the readable body copy — strip nav/sidebar/scripts/styles so
        // a match doesn't fire on boilerplate every doc page shares (the
        // shell's own sidebar markup, footers, etc.), which would make
        // every query match every doc.
        doc.querySelectorAll("script, style, nav, .sidebar, .bottom-nav, .site-footer, .about-footer").forEach((el) => el.remove());
        const text = (doc.body?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        cache[href] = text;
        saveContentCache();
        return text;
      } catch (_) {
        cache[href] = ""; // don't retry a failed fetch on every keystroke
        return "";
      }
    }

    // Build a short "…matched text…" snippet around the first hit, shown
    // under the link only when the match came from content rather than the
    // already-visible label — otherwise showing a snippet identical to the
    // label the user can already see would be visual noise.
    function buildSnippet(text, query) {
      const idx = text.indexOf(query);
      if (idx === -1) return "";
      const radius = 28;
      const start = Math.max(0, idx - radius);
      const end = Math.min(text.length, idx + query.length + radius);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < text.length ? "…" : "";
      return prefix + text.slice(start, end).trim() + suffix;
    }

    // Removes a previously-inserted snippet AND the <br> that was inserted
    // right before it (see runSearch below) — clearing only the snippet
    // element left the <br> behind forever, which kept forcing the
    // .docs-menu-link into its two-line layout (the CSS is keyed off
    // :has(.docs-menu-link-snippet), which stops matching once the
    // snippet itself is gone, but the leftover line break still visually
    // enlarged the item even with the snippet text removed) and, on top
    // of that, every subsequent search added yet another <br> on top of
    // the orphaned one(s) from before.
    function clearSnippet(link) {
      const snippet = link.querySelector(".docs-menu-link-snippet");
      if (snippet) {
        const prev = snippet.previousSibling;
        if (prev && prev.nodeName === "BR") prev.remove();
        snippet.remove();
      }
    }

    let searchToken = 0; // guards against a slow fetch resolving after a newer query was typed
    async function runSearch(query) {
      const token = ++searchToken;
      const links = Array.from(docsSection.querySelectorAll(".docs-menu-link"));
      let anyVisible = false;

      if (!query) {
        links.forEach((link) => {
          link.hidden = false;
          clearSnippet(link);
        });
        if (emptyState) emptyState.hidden = true;
        return;
      }

      const results = await Promise.all(
        links.map(async (link) => {
          const label = (link.dataset.docsLabel || "").toLowerCase();
          if (label.includes(query)) return { link, matched: true, snippet: "" };
          const href = link.getAttribute("href");
          const text = await getDocText(href);
          const matched = text.includes(query);
          return { link, matched, snippet: matched ? buildSnippet(text, query) : "" };
        }),
      );

      if (token !== searchToken) return; // a newer keystroke superseded this search

      results.forEach(({ link, matched, snippet }) => {
        link.hidden = !matched;
        if (matched) anyVisible = true;
        clearSnippet(link);
        if (matched && snippet) {
          const snippetEl = document.createElement("small");
          snippetEl.className = "docs-menu-link-snippet";
          snippetEl.textContent = snippet;
          link.querySelector(".menu-label")?.appendChild(document.createElement("br"));
          link.querySelector(".menu-label")?.appendChild(snippetEl);
        }
      });
      if (emptyState) emptyState.hidden = anyVisible;
    }

    let debounceHandle = null;
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.trim().toLowerCase();
      clearTimeout(debounceHandle);
      // Instant for the common "just filtering by label" case; debounced
      // only for the network-touching content search path, so typing
      // doesn't fire a fetch per keystroke.
      debounceHandle = setTimeout(() => runSearch(query), query ? 200 : 0);
    });
  }
}

const mobileProfile = document.querySelector('.bottom-nav-item-profile .bottom-nav-icon');
if (mobileProfile) mobileProfile.innerHTML = `<svg class="bottom-nav-default-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg><img class="bottom-nav-avatar" id="navBottomAvatar" src="" alt="" style="display:none;">`;
await import("../../shared/theme-controller.js");
await import("../../components/side-menu/side-menu.js");

// ── .top-bar reading progress ───────────────────────────────────────────
(function initTopBarProgress() {
  const topBar = document.querySelector(".top-bar");
  if (!topBar) return; // pages without a doc-style top-bar (none currently) simply skip this

  const fill = document.createElement("span");
  fill.className = "top-bar-fill";
  fill.setAttribute("aria-hidden", "true");
  topBar.appendChild(fill);

  const content =
    document.querySelector(".page-wrapper") ||
    document.querySelector(".about-page") ||
    document.body;

  function updateProgress() {
    const rect = content.getBoundingClientRect();
    const contentTop = rect.top + window.scrollY;
    const contentHeight = content.scrollHeight;
    const viewport = window.innerHeight;
    const scrolled = window.scrollY + viewport - contentTop;
    const total = Math.max(contentHeight, 1);
    const ratio = Math.min(1, Math.max(0, scrolled / total));
    fill.style.transform = `scaleX(${ratio})`;
  }

  let ticking = false;
  function scheduleUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateProgress();
      ticking = false;
    });
  }

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  updateProgress();
})();
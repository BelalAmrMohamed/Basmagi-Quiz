// public/src/features/documents/documents-shell.js
import "../../shared/flow-field.js";
import { DOCS_GROUPS } from "./docs-nav.js";

const sidebarMarkup = `
<div class="side-menu-backdrop" id="sideMenuBackdrop" aria-hidden="true" role="presentation"></div>

<!-- Side-menu (using side-menu.js and side-menu.css) -->
<aside class="sidebar" id="sidebar" role="dialog" aria-modal="true" aria-label="القائمة الجانبية" aria-hidden="true"
    tabindex="-1">

    <script>
        // Applies the saved expanded/collapsed class the instant this
        // element exists in the DOM — still before the browser paints
        // anything below it — so the sidebar never renders collapsed
        // first. Kept tiny and inline (not deferred to side-menu.js)
        // specifically so it runs synchronously mid-parse.
        (function () {
            try {
                if (window.__sidebarExpandedInit) {
                    document.currentScript.closest(".sidebar").classList.add("expanded");
                }
            } catch (e) {
                console.error("Sidebar expand-state initialization error:", e);
            }
        })();
    </script>

    <!-- Drag handle — mobile bottom-sheet only. A real element (not a
         ::before pseudo-element) so it can receive pointer events for
         the drag-to-dismiss gesture. Hidden on desktop via CSS. -->
    <div class="sidebar-drag-handle" id="sidebarDragHandle" aria-hidden="true">
        <span class="sidebar-drag-handle-bar"></span>
    </div>

    <!-- Sidebar Logo & Controls -->
    <!-- Collapsed (desktop, minimized rail): icon-only favicon button —
         hovering reveals expand icon; clicking expands sidebar -->
    <button class="sidebar-favicon" id="sidebarExpandBtn" type="button" title="توسيع القائمة"
        aria-label="توسيع القائمة" data-tooltip="توسيع القائمة">
        <img src="./favicon.png" alt="منصة امتحانات بصمجي" class="sidebar-favicon-img">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            class="lucide lucide-panel-right-open-icon sidebar-expand-icon" aria-hidden="true">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M15 3v18" />
            <path d="m10 15-3-3 3-3" />
        </svg>
    </button>

    <!-- Expanded header: contains full wordmark logo + collapse toggle button -->
    <div class="sidebar-header sidebar-expanded-only">
        <div class="sidebar-brand-link" aria-label="منصة امتحانات بصمجي">
            <div class="sidebar-logo" title="منصة امتحانات بصمجي">
                <img src="./favicon.png" alt="" class="sidebar-favicon-img">
                <span class="sidebar-brand-text">امتحانات بصمجي</span>
            </div>
        </div>
        <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" type="button" title="طي القائمة"
            aria-label="طي القائمة" data-tooltip="طي القائمة">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                class="lucide lucide-panel-left-icon icon-default" aria-hidden="true">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                class="lucide lucide-panel-left-open-icon icon-hover" aria-hidden="true">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
                <path d="m14 9 3 3-3 3" />
            </svg>
        </button>
    </div>

    <nav role="navigation" aria-label="روابط التنقل">
        <!-- NAV_ITEM:home -->
        <a href="/" class="menu-item" data-tooltip="الصفحة الرئيسية">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
                <path
                    d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <span class="menu-label">الصفحة الرئيسية</span>
        </a>

        <!-- NAV_ITEM:my-content -->
        <a href="/my-content" class="menu-item" data-tooltip="محتواي">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <path d="M8 13h8M8 17h5" />
            </svg>
            <span class="menu-label">محتواي</span>
        </a>

        <!-- NAV_ITEM:create-quiz -->
        <a href="create-quiz" class="menu-item" data-tooltip="إنشاء امتحانات">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <!-- Lightbulb outline -->
                <path
                    d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.9 1.2 1.5 1.5 2.5" />
                <path d="M9 18h6" />
                <path d="M10 22h4" />
                <!-- Question Mark inside -->
                <path d="M10.5 6.5a1.5 1.5 0 0 1 3 0c0 1-1.5 1.5-1.5 2.5" />
                <path d="M12 12h.01" />

                <!-- Subtle "Creator" spark/plus -->
                <line x1="19" y1="18" x2="19" y2="22" />
                <line x1="17" y1="20" x2="21" y2="20" />
            </svg>
            <span class="menu-label">إنشاء امتحانات</span>
        </a>

        <!-- NAV_ITEM:create-lesson -->
        <a href="create-lesson" class="menu-item" data-tooltip="إنشاء دروس">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                <path d="M9 10h6" />
                <path d="M12 7v6" />
            </svg>
            <span class="menu-label">إنشاء دروس</span>
        </a>

        <!-- NAV_ITEM:notebook -->
        <a href="/notebook/new" class="menu-item" data-tooltip="إنشاء دفاتر">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <path d="m18 16 4-4-4-4" />
                <path d="m6 8-4 4 4 4" />
                <path d="m14.5 4-5 16" />
            </svg>
            <span class="menu-label">إنشاء دفاتر</span>
        </a>

        <div class="menu-item-dropdown-wrap">
            <button type="button" id="sideMenuProfileTrigger" title="الحساب" class="menu-item" data-tooltip="الحساب"
                aria-haspopup="true" aria-expanded="false" aria-controls="sideMenuProfileDropdown">
                <svg class="menu-item-default-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round" aria-hidden="true">
                    <path d="m12 14 4-4" />
                    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
                </svg>
                <img class="menu-item-avatar" id="navSidebarAvatar" src="" alt="" style="display:none;">
                <span class="menu-label">الحساب</span>
            </button>

            <div id="sideMenuProfileDropdown" class="side-menu-profile-dropdown" role="menu"
                aria-label="قائمة الحساب">
                <div class="side-menu-profile-dropdown-header">
                    <div class="side-menu-profile-dropdown-cover" id="sideMenuDropdownCover" aria-hidden="true">
                    </div>
                    <div class="side-menu-profile-dropdown-avatar-wrap">
                        <img class="side-menu-profile-dropdown-avatar" id="sideMenuDropdownAvatar" src="" alt=""
                            style="display:none;">
                        <svg class="side-menu-profile-dropdown-default-icon" xmlns="http://www.w3.org/2000/svg"
                            width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="m12 14 4-4" />
                            <path d="M3.34 19a10 10 0 1 1 17.32 0" />
                        </svg>
                    </div>
                    <div class="side-menu-profile-dropdown-labels">
                        <span id="sideMenuDropdownName" class="side-menu-profile-dropdown-name"></span>
                        <span id="sideMenuDropdownEmailRow" class="side-menu-profile-dropdown-email-row"
                            style="display:none;">
                            <span id="sideMenuDropdownEmail" class="side-menu-profile-dropdown-email"></span>
                        </span>
                    </div>
                </div>

                <div class="side-menu-profile-dropdown-divider" role="separator"></div>

                <a href="profile" class="side-menu-profile-dropdown-item" role="menuitem">
                    <img class="side-menu-profile-dropdown-item-avatar" id="sideMenuDropdownItemAvatar" src=""
                        alt="" style="display:none;">
                    <svg id="sideMenuDropdownItemAvatarIcon" xmlns="http://www.w3.org/2000/svg" width="18"
                        height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m12 14 4-4" />
                        <path d="M3.34 19a10 10 0 1 1 17.32 0" />
                    </svg>
                    <span>الحساب</span>
                </a>

                <a href="reports" class="side-menu-profile-dropdown-item" role="menuitem">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                        aria-hidden="true">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>البلاغات</span>
                </a>

                <button type="button" class="side-menu-profile-dropdown-item" role="menuitem"
                    onclick="changeUsername()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                        aria-hidden="true">
                        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                    </svg>
                    <span>تغيير الإسم</span>
                </button>

                <div class="side-menu-profile-dropdown-divider" role="separator"></div>

                <button type="button" id="sideMenuDropdownSignOut"
                    class="side-menu-profile-dropdown-item side-menu-profile-dropdown-item-danger" role="menuitem"
                    style="display:none;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                        aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    <span>تسجيل الخروج</span>
                </button>

                <span id="sideMenuDropdownSignIn"
                    class="side-menu-profile-dropdown-item side-menu-profile-dropdown-item-signin" role="menuitem"
                    style="display:none;" aria-disabled="true">
                    <svg class="side-menu-dropdown-google-icon" width="18" height="18" viewBox="0 0 24 24"
                        aria-hidden="true">
                        <path fill="#4285F4"
                            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17Z" />
                        <path fill="#34A853"
                            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z" />
                        <path fill="#FBBC05"
                            d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15Z" />
                        <path fill="#EA4335"
                            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z" />
                    </svg>
                    <span>تسجيل الدخول</span>
                </span>
            </div>
        </div>

        <button onclick="changeUsername()" class="menu-item mobile-only-menu-item" title="تغيير الإسم"
            data-tooltip="تغيير الإسم">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
            </svg>
            <span class="menu-label">تغيير الإسم: <span class="change-username" id="userNameDisplay"></span></span>
        </button>

        <div class="menu-divider" role="separator" aria-hidden="true"></div>

        <!-- Theme controls — collapsible/accordion so it can be tucked
             away to save vertical space; starts expanded. Only relevant
             in the expanded sidebar (desktop expanded / mobile sheet);
             in the collapsed desktop rail this whole block is hidden by
             the existing .sidebar:not(.expanded) rules, same as before. -->
        <div class="theme-controls-section">
            <button type="button" class="theme-controls-toggle sidebar-expanded-only" id="themeControlsToggle"
                aria-expanded="true" aria-controls="themeControlsPanel">
                <span class="theme-controls-toggle-label">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                        aria-hidden="true">
                        <path
                            d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
                        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                        <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                        <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                        <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                    </svg>
                    <span class="menu-label">المظهر والأداء</span>
                </span>
                <svg class="theme-controls-toggle-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
                    stroke-linejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>

            <!-- Collapsed-rail entry point: the toggle button above is
                 hidden (sidebar-expanded-only), so give the collapsed
                 64px rail its own icon-only affordance that just
                 expands the sidebar itself (handled in side-menu.js). -->
            <button type="button" class="theme-section-header sidebar-collapsed-only" data-tooltip="الخلفية"
                title="المظهر والأداء" aria-label="فتح إعدادات المظهر والأداء">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                    aria-hidden="true">
                    <path
                        d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
                    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                </svg>
            </button>

            <div class="theme-controls-panel" id="themeControlsPanel">
                <div class="theme-selector-grid sidebar-expanded-only" role="group" aria-label="اختيار الخلفية">
                    <button class="theme-selector-btn" title="الخلفية السوداء" data-theme="dark"
                        aria-pressed="false">
                        <span class="theme-btn-preview" aria-hidden="true">
                            <span class="theme-btn-preview-header"></span>
                            <span class="theme-btn-preview-list">
                                <span class="theme-btn-preview-row"></span>
                                <span class="theme-btn-preview-row"></span>
                            </span>
                        </span>
                        <span class="theme-btn-check" aria-hidden="true">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </span>
                        <span class="theme-btn-label">السوداء</span>
                    </button>
                    <button class="theme-selector-btn" title="الخلفية الزرقاء" data-theme="dark-slate"
                        aria-pressed="false">
                        <span class="theme-btn-preview" aria-hidden="true">
                            <span class="theme-btn-preview-header"></span>
                            <span class="theme-btn-preview-list">
                                <span class="theme-btn-preview-row"></span>
                                <span class="theme-btn-preview-row"></span>
                            </span>
                        </span>
                        <span class="theme-btn-check" aria-hidden="true">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </span>
                        <span class="theme-btn-label">الزرقاء</span>
                    </button>
                    <button class="theme-selector-btn" title="الخلفية البيضاء" data-theme="light"
                        aria-pressed="false">
                        <span class="theme-btn-preview" aria-hidden="true">
                            <span class="theme-btn-preview-header"></span>
                            <span class="theme-btn-preview-list">
                                <span class="theme-btn-preview-row"></span>
                                <span class="theme-btn-preview-row"></span>
                            </span>
                        </span>
                        <span class="theme-btn-check" aria-hidden="true">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </span>
                        <span class="theme-btn-label">البيضاء</span>
                    </button>
                </div>

                <label class="animation-toggle-container sidebar-expanded-only"
                    title="تفعيل و تعطيل الرسوم المتحركة في الخلفية (عطّل الرسوم لتحسين الأداء)">
                    <span class="animation-toggle-label">رسوم الخلفية</span>
                    <input type="checkbox" id="animationToggle" class="toggle-input" data-control="animations"
                        aria-label="رسوم الخلفية المتحركة">
                    <span class="toggle-switch" aria-hidden="true"></span>
                </label>

                <label class="animation-toggle-container high-performance-toggle-container sidebar-expanded-only"
                    title="إيقاف كل الرسوم المتحركة والانتقالات في الموقع بالكامل لأفضل أداء ممكن">
                    <span class="animation-toggle-label">الأداء الفائق</span>
                    <input type="checkbox" id="highPerformanceToggle" class="toggle-input"
                        data-control="high-performance" aria-label="تفعيل الأداء الفائق (إيقاف كل الحركات)">
                    <span class="toggle-switch" aria-hidden="true"></span>
                </label>
            </div>
        </div>

        

    </nav>

    <!-- Pinned bottom actions stay outside the scrollable nav so long
              menus cannot paint underneath them. -->
    <div class="sidebar-pinned-actions" role="navigation" aria-label="إجراءات إضافية">
        <a href="/docs" class="menu-item" data-tooltip="الأدلة والمساعدة">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span class="menu-label">الأدلة والمساعدة</span>
        </a>

        <!-- PINNED_ITEM:settings -->
        <a href="settings" class="menu-item" data-tooltip="الإعدادات">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <path
                    d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
                <circle cx="12" cy="12" r="3" />
            </svg>
            <span class="menu-label">الإعدادات</span>
        </a>

        <button class="menu-item install-app" title="تثبيت التطبيق" data-action="installApp"
            data-tooltip="تثبيت التطبيق" style="display:none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                <path d="M12 18h.01" />
            </svg>
            <span class="menu-label">تثبيت التطبيق</span>
        </button>
    </div>
</aside>
<!-- End of the sidebar -->

<!-- Mobile Bottom Navigation Bar -->
<nav class="bottom-nav" id="bottomNav" role="navigation" aria-label="التنقل الرئيسي">
    <!-- BOTTOM_NAV_ITEM:leaderboard -->
    <a href="profile" class="bottom-nav-item bottom-nav-item-profile" data-bottom-nav="leaderboard">
        <span class="bottom-nav-icon bottom-nav-icon-profile">
            <img class="bottom-nav-avatar" id="navBottomAvatar" src="" alt="" style="display:none;">
        </span>
        <span class="bottom-nav-label">الحساب</span>
    </a>

    <!-- BOTTOM_NAV_ITEM:home -->
    <a href="/" class="bottom-nav-item" data-bottom-nav="home">
        <span class="bottom-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
                <path
                    d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
        </span>
        <span class="bottom-nav-label">الرئيسية</span>
    </a>

    <!-- BOTTOM_NAV_ITEM:create -->
    <a href="create-quiz" class="bottom-nav-item" data-bottom-nav="create">
        <span class="bottom-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <!-- Lightbulb outline -->
                <path
                    d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.9 1.2 1.5 1.5 2.5" />
                <path d="M9 18h6" />
                <path d="M10 22h4" />
                <!-- Question Mark inside -->
                <path d="M10.5 6.5a1.5 1.5 0 0 1 3 0c0 1-1.5 1.5-1.5 2.5" />
                <path d="M12 12h.01" />

                <!-- Subtle "Creator" spark/plus -->
                <line x1="19" y1="18" x2="19" y2="22" />
                <line x1="17" y1="20" x2="21" y2="20" />
            </svg>
        </span>
        <span class="bottom-nav-label">امتحان</span>
    </a>

    <!-- BOTTOM_NAV_ITEM:create-lesson -->
    <a href="create-lesson" class="bottom-nav-item" data-bottom-nav="create-lesson">
        <span class="bottom-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                <path d="M9 10h6" />
                <path d="M12 7v6" />
            </svg>
        </span>
        <span class="bottom-nav-label">درس</span>
    </a>

    <!-- BOTTOM_NAV_ITEM:settings -->
    <a href="settings" class="bottom-nav-item" data-bottom-nav="settings">
        <span class="bottom-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <path
                    d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
                <circle cx="12" cy="12" r="3" />
            </svg>
        </span>
        <span class="bottom-nav-label">الإعدادات</span>
    </a>

    <button type="button" class="bottom-nav-item" id="bottomNavMoreBtn" data-bottom-nav="more" aria-haspopup="true"
        aria-expanded="false" aria-controls="sidebar">
        <span class="bottom-nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true">
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
            </svg>
        </span>
        <span class="bottom-nav-label">المزيد</span>
    </button>
</nav>
<!-- End of Bottom Navigation Bar -->
`;

(function setInitialSidebarState() {
  try {
    const expanded = window.innerWidth > 768 && localStorage.getItem("sidebar_expanded") === "true";
    window.__sidebarExpandedInit = expanded;
    if (expanded) document.body.classList.add("sidebar-expanded");
  } catch (_) { }
})();

document.body.insertAdjacentHTML("afterbegin", sidebarMarkup);

const sidebar = document.getElementById("sidebar");
const profileLink = sidebar?.querySelector('a[href="profile"]');
if (profileLink) {
  profileLink.outerHTML = `<div class="menu-item-dropdown-wrap">
    <button type="button" id="sideMenuProfileTrigger" title="الحساب" class="menu-item" data-tooltip="الحساب" aria-haspopup="true" aria-expanded="false" aria-controls="sideMenuProfileDropdown"><svg class="menu-item-default-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg><img class="menu-item-avatar" id="navSidebarAvatar" src="" alt="" style="display:none;"><span class="menu-label">الحساب</span></button>
    <div id="sideMenuProfileDropdown" class="side-menu-profile-dropdown" role="menu" aria-label="قائمة الحساب"><div class="side-menu-profile-dropdown-header"><div class="side-menu-profile-dropdown-cover" id="sideMenuDropdownCover" aria-hidden="true"></div><div class="side-menu-profile-dropdown-avatar-wrap"><img class="side-menu-profile-dropdown-avatar" id="sideMenuDropdownAvatar" src="" alt="" style="display:none;"><svg class="side-menu-profile-dropdown-default-icon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg></div><div class="side-menu-profile-dropdown-labels"><span id="sideMenuDropdownName" class="side-menu-profile-dropdown-name"></span><span id="sideMenuDropdownEmailRow" class="side-menu-profile-dropdown-email-row" style="display:none;"><span id="sideMenuDropdownEmail" class="side-menu-profile-dropdown-email"></span></span></div></div><div class="side-menu-profile-dropdown-divider" role="separator"></div><a href="/profile" class="side-menu-profile-dropdown-item" role="menuitem"><svg id="sideMenuDropdownItemAvatarIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg><img class="side-menu-profile-dropdown-item-avatar" id="sideMenuDropdownItemAvatar" src="" alt="" style="display:none;"><span>الحساب</span></a><a href="/reports" class="side-menu-profile-dropdown-item" role="menuitem"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg><span>البلاغات</span></a><button type="button" class="side-menu-profile-dropdown-item" role="menuitem" onclick="changeUsername()"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg><span>تغيير الإسم</span></button><div class="side-menu-profile-dropdown-divider" role="separator"></div><button type="button" id="sideMenuDropdownSignOut" class="side-menu-profile-dropdown-item side-menu-profile-dropdown-item-danger" role="menuitem" style="display:none;"><span>تسجيل الخروج</span></button><span id="sideMenuDropdownSignIn" class="side-menu-profile-dropdown-item side-menu-profile-dropdown-item-signin" role="menuitem" style="display:none;"><svg class="side-menu-dropdown-google-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17Z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"/></svg><span>تسجيل الدخول</span></span></div>
  </div>`;
}

const sidebarNav = sidebar?.querySelector("nav");
if (sidebarNav) {
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

  sidebarNav.insertAdjacentHTML("beforeend", `<div class="menu-divider" role="separator" aria-hidden="true"></div><div class="theme-controls-section"><button type="button" class="theme-controls-toggle sidebar-expanded-only" id="themeControlsToggle" aria-expanded="true" aria-controls="themeControlsPanel"><span class="theme-controls-toggle-label"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></svg><span class="menu-label">المظهر والأداء</span></span><svg class="theme-controls-toggle-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></button><button type="button" class="theme-section-header sidebar-collapsed-only" data-tooltip="الخلفية" title="المظهر والأداء" aria-label="فتح إعدادات المظهر والأداء"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></svg></button><div class="theme-controls-panel" id="themeControlsPanel"><div class="theme-selector-grid sidebar-expanded-only" role="group" aria-label="اختيار الخلفية"><button class="theme-selector-btn" title="الخلفية السوداء" data-theme="dark" aria-pressed="false"><span class="theme-btn-preview" aria-hidden="true"><span class="theme-btn-preview-header"></span><span class="theme-btn-preview-list"><span class="theme-btn-preview-row"></span><span class="theme-btn-preview-row"></span></span></span><span class="theme-btn-label">السوداء</span></button><button class="theme-selector-btn" title="الخلفية الزرقاء" data-theme="dark-slate" aria-pressed="false"><span class="theme-btn-preview" aria-hidden="true"><span class="theme-btn-preview-header"></span><span class="theme-btn-preview-list"><span class="theme-btn-preview-row"></span><span class="theme-btn-preview-row"></span></span></span><span class="theme-btn-label">الزرقاء</span></button><button class="theme-selector-btn" title="الخلفية البيضاء" data-theme="light" aria-pressed="false"><span class="theme-btn-preview" aria-hidden="true"><span class="theme-btn-preview-header"></span><span class="theme-btn-preview-list"><span class="theme-btn-preview-row"></span><span class="theme-btn-preview-row"></span></span></span><span class="theme-btn-label">البيضاء</span></button></div><label class="animation-toggle-container sidebar-expanded-only"><span class="animation-toggle-label">رسوم الخلفية</span><input type="checkbox" id="animationToggle" class="toggle-input" checked aria-label="رسوم الخلفية المتحركة"><span class="toggle-switch" aria-hidden="true"></span></label><label class="animation-toggle-container high-performance-toggle-container sidebar-expanded-only"><span class="animation-toggle-label">الأداء الفائق</span><input type="checkbox" id="highPerformanceToggle" class="toggle-input" aria-label="تفعيل الأداء الفائق"><span class="toggle-switch" aria-hidden="true"></span></label></div></div>`);
  sidebar.querySelectorAll(".theme-selector-btn").forEach((button) => {
    const check = document.createElement("span");
    check.className = "theme-btn-check";
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>`;
    button.insertBefore(check, button.querySelector(".theme-btn-label"));
  });

  sidebar.insertAdjacentHTML("beforeend", `<div class="sidebar-pinned-actions" role="navigation" aria-label="إجراءات إضافية"><a href="settings" class="menu-item" id="sidebarSettingsBtn" data-tooltip="الإعدادات"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg><span class="menu-label">الإعدادات</span></a><button class="menu-item install-app" title="تثبيت التطبيق" data-action="installApp" data-tooltip="تثبيت التطبيق" style="display:none;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="20" x="5" y="2" rx="2" ry="2" /><path d="M12 18h.01" /></svg><span class="menu-label">تثبيت التطبيق</span></button></div>`);
}

// ── "المستندات" (Docs) links ────────────────────────────────────────────
// This shell (documents-shell.js) is only loaded on the doc pages
// themselves (about/privacy/terms/how-to-*), not the main app pages, so
// this section only ever renders there — the main app sidebar (rendered by
// side-menu.js alone, without this shell) is intentionally left untouched.
// Links come from docs-nav.js, grouped as Start / Create / AI / Legal. Plain
// labelled groups (not collapsible submenus) since seven links don't need one.


if (sidebarNav) {
  const linkHtml = ({ href, label, soon, icon }) =>
    `<a href="${href}" class="menu-item docs-menu-link" title="${label}" data-tooltip="${label}" data-docs-label="${label}">` +
    icon +
    `<span class="menu-label">${label}${soon ? ' <small class="docs-menu-soon-badge">قريباً</small>' : ""}</span>` +
    `</a>`;
  // Grouped: Start / Create / Connect AI / Legal. Group labels only show in the
  // expanded sidebar; the collapsed rail keeps its icon-only list.
  const docsLinksHtml = DOCS_GROUPS.map(
    (group) =>
      `<div class="docs-menu-group" data-group="${group.id}">` +
      `<div class="docs-menu-group-label sidebar-expanded-only" aria-hidden="true">${group.label}</div>` +
      group.links.map(linkHtml).join("") +
      `</div>`,
  ).join("");

  sidebarNav.insertAdjacentHTML(
    "beforeend",
    `<div class="menu-divider" role="separator" aria-hidden="true"></div>` +
    `<div class="docs-menu-section" role="navigation" aria-label="مستندات المنصة">${docsLinksHtml}</div>`,
  );

  // Mark the current page's link active via location.pathname, generically,
  // instead of the old per-file hardcoded docs-switcher-link--active class.
  const currentPath = window.location.pathname.split("/").pop() || "index";
  sidebarNav.querySelectorAll(".docs-menu-section .menu-item[href]").forEach((link) => {
    const linkPath = link.getAttribute("href").replace(/^\//, "");
    const isActive = linkPath === currentPath;
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
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

// ── Interactive Video Guide Timestamp Chips ─────────────────────────────
document.addEventListener("click", (event) => {
  const chip = event.target.closest(".doc-video-chip");
  if (!chip) return;
  const time = chip.dataset.time;
  const card = chip.closest(".doc-video-card");
  const iframe = card?.querySelector(".doc-video-card__iframe");
  if (iframe && typeof time !== "undefined") {
    event.preventDefault();
    // Each card keeps its own video: reuse the iframe's current embed URL
    // (without its query string) instead of a hardcoded video id.
    const baseSrc = iframe.src.split("?")[0];
    iframe.src = `${baseSrc}?start=${time}&autoplay=1&rel=0`;
    card.querySelectorAll(".doc-video-chip").forEach((c) => c.classList.toggle("is-active", c === chip));
  }
});

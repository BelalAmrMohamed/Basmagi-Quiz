// public/src/shared/theme-controller.js - Enhanced Theme Management System

const THEME_KEY = "quiz_theme_pref";
const ANIMATIONS_KEY = "quiz_animations_pref";
const HIGH_PERFORMANCE_KEY = "quiz_high_performance_pref";

export const themeManager = {
  themes: {
    light: { name: "Light", icon: "☀️", label: "Light Mode" },
    "dark-slate": { name: "Dark Slate", icon: "🌙", label: "Dark Slate" },
    dark: { name: "Dark", icon: "🌑", label: "Dark Mode" },
  },

  init() {
    // Load saved preferences or use defaults
    const savedTheme = localStorage.getItem(THEME_KEY) || "light";
    const reducedMotionPref = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const hasSavedAnimations = localStorage.getItem(ANIMATIONS_KEY) !== null;
    const hasSavedHighPerformance =
      localStorage.getItem(HIGH_PERFORMANCE_KEY) !== null;
    const savedAnimations = hasSavedAnimations
      ? localStorage.getItem(ANIMATIONS_KEY) !== "disabled"
      : !reducedMotionPref;
    const savedHighPerformance = hasSavedHighPerformance
      ? localStorage.getItem(HIGH_PERFORMANCE_KEY) === "enabled"
      : reducedMotionPref;

    this.applyTheme(savedTheme);
    this.applyAnimations(savedAnimations, { persist: hasSavedAnimations });
    this.applyHighPerformance(savedHighPerformance);

    // Keep in sync if the OS-level setting changes while the page is open.
    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const onReducedMotionChange = () => {
      this.applyHighPerformance(this.getHighPerformanceEnabled());
      this.updateHighPerformanceToggleVisibility();
    };
    if (typeof reducedMotionQuery.addEventListener === "function") {
      reducedMotionQuery.addEventListener("change", onReducedMotionChange);
    } else if (typeof reducedMotionQuery.addListener === "function") {
      // Safari < 14 fallback
      reducedMotionQuery.addListener(onReducedMotionChange);
    }

    // Setup controls when DOM is ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.setupControls());
    } else {
      this.setupControls();
    }
  },

  applyTheme(theme) {
    // Validate theme
    if (!this.themes[theme]) {
      theme = "light";
    }

    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);

    // FIXED: Ensure body background is restored when animations are off
    this.restoreBodyBackground();

    // Update UI if elements exist
    this.updateThemeUI(theme);
  },

  applyAnimations(enabled, { persist = true } = {}) {
    // NOTE: ownership of the actual #flow-field-bg canvas/instance lives
    // entirely in flow-field.js (it mounts/destroys the canvas via its own
    // MutationObserver on this same [data-animations] attribute). This
    // method used to *also* reach in and toggle `flowField.style.display`
    // directly — a second, redundant owner of the same element that raced
    // against flow-field.js's mount/destroy cycle: toggling off would hide
    // the canvas via inline style while flow-field.js separately destroyed
    // and removed the node entirely; toggling back on then found no element
    // to un-hide (querying a node flow-field.js had already removed) and
    // relied solely on the MutationObserver firing correctly afterward.
    // Any hiccup in that observer timing (attribute already at the target
    // value from a previous toggle in the same tick, browsers coalescing
    // rapid mutations, etc.) left the animation permanently off until a
    // full reload re-ran flow-field.js's synchronous initFlowField() call.
    // Setting the attribute here and letting flow-field.js be the single
    // reactor to it removes that race entirely.
    document.documentElement.setAttribute(
      "data-animations",
      enabled ? "enabled" : "disabled",
    );
    // Dispatched synchronously (same tick) rather than relying solely on
    // flow-field.js's MutationObserver, which batches rapid attribute
    // writes and can silently drop an intermediate toggle. flow-field.js
    // listens for this and mounts/destroys its canvas immediately.
    document.dispatchEvent(new CustomEvent("quiz:animations-changed"));
    if (persist) {
      localStorage.setItem(ANIMATIONS_KEY, enabled ? "enabled" : "disabled");
    }

    this.updateAnimationsUI(enabled);
    // Both directions need this, not just disabling: re-enabling must clear
    // the opaque inline background-color a previous disable left on body
    // (see restoreBodyBackground below), otherwise that solid color keeps
    // painting over the newly-remounted canvas — which sits at z-index:-1 —
    // making "turn animations back on" silently do nothing until a full
    // reload (which never had that stale inline style to begin with).
    this.restoreBodyBackground();
  },

  /**
   * High Performance Mode: the "kill everything" motion switch. Sets
   * data-motion="reduced" on <html>, which themes.css uses to zero out
   * every CSS transition/animation duration site-wide (not just the
   * background shader). Also forces the background canvas/animation
   * toggle off, since the background is the single most expensive
   * animation on the page — but the two preferences are stored
   * separately, so re-disabling High Performance Mode restores whatever
   * the user had the background animation toggle set to before.
   */
  applyHighPerformance(enabled) {
    document.documentElement.setAttribute(
      "data-motion",
      enabled ? "reduced" : "normal",
    );
    localStorage.setItem(
      HIGH_PERFORMANCE_KEY,
      enabled ? "enabled" : "disabled",
    );

    this.updateHighPerformanceUI(enabled);
  },

  getHighPerformanceEnabled() {
    return (
      document.documentElement.getAttribute("data-motion") === "reduced" &&
      localStorage.getItem(HIGH_PERFORMANCE_KEY) === "enabled"
    );
  },

  toggleHighPerformance() {
    this.applyHighPerformance(!this.getHighPerformanceEnabled());
  },

  updateHighPerformanceUI(enabled) {
    document
      .querySelectorAll(".high-performance-toggle-switch")
      .forEach((toggle) => {
        toggle.classList.toggle("active", enabled);
      });

    document
      .querySelectorAll(
        'input[type="checkbox"][data-control="high-performance"]',
      )
      .forEach((checkbox) => {
        checkbox.checked = enabled;
      });
  },

  /** Keep the control visible and actionable for every motion preference. */
  updateHighPerformanceToggleVisibility() {
    document
      .querySelectorAll(".high-performance-toggle-container")
      .forEach((el) => {
        el.style.display = "";
        el.classList.remove("is-disabled");
        el.removeAttribute("aria-disabled");
        el.querySelectorAll(
          'input[type="checkbox"][data-control="high-performance"]',
        ).forEach((checkbox) => {
          checkbox.disabled = false;
        });
      });
  },

  // FIXED: New method to restore body background
  restoreBodyBackground() {
    const animationsEnabled = this.getAnimationsEnabled();

    if (!animationsEnabled) {
      // Force body to use theme background color
      const currentTheme = this.getCurrentTheme();
      const themeBackgrounds = {
        light: "#fafbfc",
        "dark-slate": "#0f172a",
        dark: "#121212",
      };

      document.body.style.backgroundColor =
        themeBackgrounds[currentTheme] || themeBackgrounds.light;
    } else {
      // Let canvas handle the background
      document.body.style.backgroundColor = "";
    }
  },

  getCurrentTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
  },

  getAnimationsEnabled() {
    return (
      document.documentElement.getAttribute("data-animations") !== "disabled"
    );
  },

  cycleTheme() {
    const themeKeys = Object.keys(this.themes);
    const currentTheme = this.getCurrentTheme();
    const currentIndex = themeKeys.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themeKeys.length;
    const nextTheme = themeKeys[nextIndex];

    this.applyTheme(nextTheme);
  },

  toggleAnimations() {
    const enabled = this.getAnimationsEnabled();
    this.applyAnimations(!enabled);
  },

  updateThemeUI(theme) {
    // Update simple theme toggle button (legacy support)
    const themeIcon = document.querySelector(".theme-icon-display");
    if (themeIcon) {
      themeIcon.textContent = this.themes[theme].icon;
    }

    // Update theme selector buttons
    document.querySelectorAll(".theme-selector-btn").forEach((btn) => {
      const btnTheme = btn.dataset.theme;
      if (btnTheme === theme) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // Update theme label
    const themeLabel = document.querySelector(".current-theme-label");
    if (themeLabel) {
      themeLabel.textContent = this.themes[theme].label;
    }
  },

  updateAnimationsUI(enabled) {
    // Update animation toggle switches
    document.querySelectorAll(".animation-toggle-switch").forEach((toggle) => {
      if (enabled) {
        toggle.classList.add("active");
      } else {
        toggle.classList.remove("active");
      }
    });

    // Update animation toggle checkboxes
    document
      .querySelectorAll('input[type="checkbox"][data-control="animations"]')
      .forEach((checkbox) => {
        checkbox.checked = enabled;
      });

    // Update animation status label
    const animLabel = document.querySelector(".animation-status-label");
    if (animLabel) {
      animLabel.textContent = enabled ? "On" : "Off";
    }
  },

  setupControls() {
    // Legacy theme toggle button (cycles through themes)
    const legacyToggle = document.getElementById("themeToggle");
    if (legacyToggle) {
      legacyToggle.onclick = () => this.cycleTheme();
    }

    // Modern theme selector buttons
    document.querySelectorAll(".theme-selector-btn").forEach((btn) => {
      btn.onclick = () => {
        const theme = btn.dataset.theme;
        if (theme) {
          this.applyTheme(theme);
        }
      };
    });

    // Animation toggle switches/buttons
    document.querySelectorAll(".animation-toggle-btn").forEach((btn) => {
      btn.onclick = () => this.toggleAnimations();
    });

    document.querySelectorAll(".animation-toggle-switch").forEach((toggle) => {
      toggle.onclick = () => this.toggleAnimations();
    });

    // Animation toggle checkboxes
    document
      .querySelectorAll('input[type="checkbox"][data-control="animations"]')
      .forEach((checkbox) => {
        checkbox.onchange = (e) => this.applyAnimations(e.target.checked);
      });

    // High Performance Mode toggle switches/buttons
    document
      .querySelectorAll(".high-performance-toggle-btn")
      .forEach((btn) => {
        btn.onclick = () => this.toggleHighPerformance();
      });

    document
      .querySelectorAll(".high-performance-toggle-switch")
      .forEach((toggle) => {
        toggle.onclick = () => this.toggleHighPerformance();
      });

    document
      .querySelectorAll(
        'input[type="checkbox"][data-control="high-performance"]',
      )
      .forEach((checkbox) => {
        checkbox.onchange = (e) =>
          this.applyHighPerformance(e.target.checked);
      });

    // Initialize UI state
    this.updateThemeUI(this.getCurrentTheme());
    this.updateAnimationsUI(this.getAnimationsEnabled());
    this.updateHighPerformanceUI(this.getHighPerformanceEnabled());
    this.updateHighPerformanceToggleVisibility();

    // FIXED: Ensure body background is correct on initialization
    this.restoreBodyBackground();
  },
};

// Auto-initialize when script loads
themeManager.init();
window.themeManager = themeManager;
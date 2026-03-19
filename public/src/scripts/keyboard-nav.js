/**
 * src/scripts/keyboard-nav.js
 *
 * Keyboard Navigation System — Basmagi Quiz PWA, Feature 1-A
 *
 * Pure ES Module.  The only global side-effect is the single `keydown`
 * listener registered inside `initKeyboardNav()`.  No top-level code runs
 * on import.
 */

// ---------------------------------------------------------------------------
// SHORTCUT_MAP  key → logical action
// ---------------------------------------------------------------------------
/** @type {Readonly<Record<string, string>>} */
export const SHORTCUT_MAP = Object.freeze({
  ArrowRight: "next",
  ArrowLeft: "prev",
  1: "select-0",
  2: "select-1",
  3: "select-2",
  4: "select-3",
  5: "select-4",
  6: "select-5",
  7: "select-6",
  8: "select-7",
  9: "select-8",
  Enter: "check",
  b: "bookmark",
  f: "flag",
  "?": "help",
});
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when keyboard shortcuts should be suppressed:
 *   • The focused element is an INPUT or TEXTAREA (the user is typing).
 *   • A `.confirmation-overlay.show` element is present in the DOM
 *     (a blocking confirmation dialog is open).
 *
 * @returns {boolean}
 */
function isSuppressed() {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (document.querySelector(".confirmation-overlay.show")) return true;
  return false;
}

/**
 * Shows or hides `#shortcutModal` by toggling its `hidden` attribute.
 * Also keeps `style.display` in sync so inline flex styles render correctly
 * regardless of UA-stylesheet specificity for `[hidden]`.
 */
function toggleShortcutModal() {
  const modal = document.getElementById("shortcutModal");
  if (!modal) return;

  const isHidden = modal.hasAttribute("hidden");
  if (isHidden) {
    modal.removeAttribute("hidden");
    modal.style.display = "flex";
  } else {
    modal.setAttribute("hidden", "");
    modal.style.display = "none";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers the keyboard navigation listener.
 * Call once after the page DOM is ready.
 *
 * @param {{
 *   onSelect:   (optionIndex: number) => void,
 *   onCheck:    () => void,
 *   onNext:     () => void,
 *   onPrev:     () => void,
 *   onBookmark: () => void,
 *   onFlag:     () => void,
 * }} handlers  Callbacks wired up to quiz.js actions.
 */
export function initKeyboardNav({
  onSelect,
  onCheck,
  onNext,
  onPrev,
  onBookmark,
  onFlag,
} = {}) {
  document.addEventListener("keydown", (e) => {
    // ── Suppression guard ────────────────────────────────────────────────────
    if (isSuppressed()) return;

    const action = SHORTCUT_MAP[e.key];

    // Bail early (no preventDefault) for keys not in the map.
    if (!action) return;

    // Only prevent default for keys that have a registered handler so that
    // native browser behaviour (tab, scroll, etc.) is never silently eaten.
    e.preventDefault();

    // ── Dispatch ─────────────────────────────────────────────────────────────
    switch (action) {
      case "next":
        onNext?.();
        break;

      case "prev":
        onPrev?.();
        break;

      // Replace the select cases in the switch
      case "select-0":
      case "select-1":
      case "select-2":
      case "select-3":
      case "select-4":
      case "select-5":
      case "select-6":
      case "select-7":
      case "select-8":
        onSelect?.(Number(action.split("-")[1]));
        break;

      case "check":
        onCheck?.();
        break;

      case "bookmark":
        onBookmark?.();
        break;

      case "flag":
        onFlag?.();
        break;

      case "help":
        toggleShortcutModal();
        break;
    }
  });
}

/**
 * Returns the complete HTML string for the shortcut-help modal.
 *
 * Inject once at page load time:
 *   document.body.insertAdjacentHTML("beforeend", getShortcutModalHTML());
 *
 * Styling uses only tokens already defined in themes.css
 * (`--glass-bg-light`, `--glass-border`, `--glass-blur`, `--glass-inset`,
 * and other existing design-system variables).  No new CSS rules are required.
 *
 * @returns {string}
 */
export function getShortcutModalHTML() {
  /** @type {Array<[string, string]>} */
  const rows = [
    ["→", "Next question"],
    ["←", "Previous question"],
    ["1 – 9", "Select option by index"],
    ["Enter", "Check / submit answer"],
    ["B", "Bookmark question"],
    ["F", "Flag question"],
    ["?", "Toggle this help"],
  ];

  const tableRows = rows
    .map(
      ([key, desc]) => `
      <tr>
        <td style="
            padding: var(--space-sm, 0.5rem) var(--space-sm, 0.5rem)
                     var(--space-sm, 0.5rem) 0;
            vertical-align: middle;
            white-space: nowrap;
        ">
          <kbd style="
              display: inline-block;
              background: var(--color-background-secondary, #f3f4f6);
              border: 1px solid var(--color-border, #e5e7eb);
              border-radius: var(--radius-sm, 4px);
              padding: 2px 8px;
              font-family: ui-monospace, 'Cascadia Code', monospace;
              font-size: var(--font-size-xs, 0.75rem);
              color: var(--color-text-primary, #111827);
              box-shadow: var(--shadow-sm);
              white-space: nowrap;
          ">${key}</kbd>
        </td>
        <td style="
            padding: var(--space-sm, 0.5rem);
            color: var(--color-text-primary, #111827);
            font-size: var(--font-size-sm, 0.875rem);
            vertical-align: middle;
        ">${desc}</td>
      </tr>`,
    )
    .join("");

  return `
<div
  id="shortcutModal"
  hidden
  role="dialog"
  aria-modal="true"
  aria-labelledby="shortcutModalTitle"
  style="
    position: fixed;
    inset: 0;
    z-index: var(--z-modal-top, 11000);
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: var(--glass-blur, blur(12px));
    -webkit-backdrop-filter: var(--glass-blur, blur(12px));
    padding: var(--space-md, 1rem);
    display: none;
  "
>
  <!-- Scrim: close on outside click -->
  <div
    onclick="
      this.parentElement.setAttribute('hidden', '');
      this.parentElement.style.display = 'none';
    "
    style="position: absolute; inset: 0; cursor: default;"
    aria-hidden="true"
  ></div>

  <!-- Panel -->
  <div
    class="shortcut-modal"
    role="document"
    style="
      position: relative;
      background: var(--glass-bg-light, rgba(255, 255, 255, 0.65));
      border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
      backdrop-filter: var(--glass-blur, blur(12px));
      -webkit-backdrop-filter: var(--glass-blur, blur(12px));
      box-shadow:
        var(--glass-inset, inset 0 1px 0 rgba(255, 255, 255, 0.1)),
        var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.1));
      border-radius: var(--radius-xl, 16px);
      padding: var(--space-xl, 2rem);
      min-width: 300px;
      max-width: 460px;
      width: 100%;
    "
  >
    <!-- Header -->
    <div style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-lg, 1.5rem);
        gap: var(--space-md, 1rem);
    ">
      <h2
        id="shortcutModalTitle"
        style="
          margin: 0;
          font-size: var(--font-size-xl, 1.25rem);
          font-weight: 700;
          color: var(--color-text-primary, #111827);
          display: flex;
          align-items: center;
          gap: var(--space-sm, 0.5rem);
        "
      >
        <span aria-hidden="true">⌨️</span> Keyboard Shortcuts
      </h2>
      <button
        type="button"
        aria-label="Close keyboard shortcuts help"
        onclick="
          this.closest('#shortcutModal').setAttribute('hidden', '');
          this.closest('#shortcutModal').style.display = 'none';
        "
        style="
          flex-shrink: 0;
          background: none;
          border: 1px solid var(--color-border, #e5e7eb);
          cursor: pointer;
          color: var(--color-text-secondary, #6b7280);
          font-size: var(--font-size-base, 1rem);
          line-height: 1;
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-md, 8px);
          transition: background var(--transition-fast, 0.15s ease),
                      color var(--transition-fast, 0.15s ease);
        "
        onmouseover="this.style.background='var(--color-hover-overlay, rgba(99,102,241,0.06))'; this.style.color='var(--color-text-primary, #111827)';"
        onmouseout="this.style.background='none'; this.style.color='var(--color-text-secondary, #6b7280)';"
      >✕</button>
    </div>

    <!-- Shortcut table -->
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="
              text-align: left;
              padding: var(--space-xs, 0.25rem) var(--space-sm, 0.5rem)
                       var(--space-xs, 0.25rem) 0;
              color: var(--color-text-secondary, #6b7280);
              font-size: var(--font-size-xs, 0.75rem);
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              border-bottom: 1px solid var(--color-border, #e5e7eb);
          ">Key</th>
          <th style="
              text-align: left;
              padding: var(--space-xs, 0.25rem) var(--space-sm, 0.5rem);
              color: var(--color-text-secondary, #6b7280);
              font-size: var(--font-size-xs, 0.75rem);
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              border-bottom: 1px solid var(--color-border, #e5e7eb);
          ">Action</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    <!-- Footer note -->
    <p style="
        margin: var(--space-lg, 1.5rem) 0 0;
        font-size: var(--font-size-xs, 0.75rem);
        color: var(--color-text-tertiary, #9ca3af);
        text-align: center;
        line-height: var(--line-height-base, 1.6);
    ">
      Shortcuts are disabled while typing in text fields or during confirmation dialogs.
    </p>
  </div>
</div>`.trim();
}

// ============================================================================
// public/src/features/home/shortcuts-overlay.js
// SHORTCUTS OVERLAY — the "?" keyboard-shortcuts help modal.
// ============================================================================
// No listener-cleanup fix needed here — this modal's Escape handler already
// uses { once: true }, so it self-removes after firing without ever leaking,
// unlike the two modals fixed in modal-utils.js/create-quiz-modal.js.
// ============================================================================

/**
 * Shows a modal listing all keyboard shortcuts available on the index page.
 * Pressing Escape or clicking outside dismisses it.
 */
export function showShortcutsOverlay() {
  if (document.getElementById("shortcutsOverlay")) return; // already open

  const overlay = document.createElement("div");
  overlay.id = "shortcutsOverlay";
  overlay.className = "shortcuts-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "shortcutsTitle");

  overlay.innerHTML = `
    <div class="shortcuts-card">
      <h2 id="shortcutsTitle" class="shortcuts-title">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 6h16M4 10h16M4 14h8M4 18h4"/>
        </svg>
        اختصارات لوحة المفاتيح
      </h2>
      <table class="shortcuts-table" aria-label="قائمة الاختصارات">
        <tbody>
          <tr>
            <td><kbd>/</kbd> أو <kbd>Ctrl</kbd>+<kbd>K</kbd></td>
            <td>فتح البحث</td>
          </tr>
          <tr>
            <td><kbd>Esc</kbd></td>
            <td>إغلاق البحث أو هذه النافذة</td>
          </tr>
          <tr>
            <td><kbd>?</kbd></td>
            <td>عرض الاختصارات</td>
          </tr>
        </tbody>
      </table>
      <button class="shortcuts-close" aria-label="إغلاق نافذة الاختصارات" type="button">
        إغلاق
      </button>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".shortcuts-close").addEventListener("click", close);
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") close();
    },
    { once: true },
  );

  document.body.appendChild(overlay);
  overlay.querySelector(".shortcuts-close").focus();
}

/* =========================================
   public/src/components/notifications/notifications.js
   Unified Notification System
   Look: Glassmorphism (Gamified)
   Logic: Stackable Toasts with Auto-Dismiss
   ========================================= */

export function showNotification(
  title,
  message = "",
  type = "info",
  time_in_secconds = 5,
) {
  // 1. Get or Create Container (Logic from Function 2)
  let container = document.getElementById("notification-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "notification-container";
    document.body.appendChild(container);
  }

  // 2. Determine Icon and Class (Hybrid Logic)
  let icon = type; // Default to passing string directly
  let typeClass = "info";

  switch (type) {
    case "success":
      icon = "✅";
      typeClass = "success";
      break;
    case "error":
      icon = "❌";
      typeClass = "error";
      break;
    case "warning":
      icon = "⚠️";
      typeClass = "warning";
      break;
    case "info":
    default:
      icon = "ℹ️";
      typeClass = "info";
      break;
  }

  // Check if the 'type' passed was actually a custom URL or Icon string override
  // If the user passed a specific string instead of a type keyword, usage adaptation:
  if (!["success", "error", "warning", "info"].includes(type)) {
    icon = type; // The type argument is treated as the icon
    typeClass = "default";
  }

  // 3. Create Notification Element
  const toast = document.createElement("div");
  // We apply 'toast-enter' animation immediately via CSS
  toast.className = `notification glass-toast ${typeClass}`;

  // 4. Construct HTML (Visual Structure from Function 1, Safety from Function 2)
  const iconHTML = isURL_orPath(icon)
    ? `<img src="${icon}" alt="Icon" class="notification-image">`
    : `<span class="notification-icon">${icon}</span>`;

  toast.innerHTML = `
      <div class="notification-content" title="${escapeHtml(title)}">
        ${iconHTML}
        <div>
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(message)}</p>
        </div>
        <button class="close-btn-notification">×</button>
      </div>
    `;

  // 5. Append to Container
  // Prepend makes new ones appear at the top, Append at the bottom.
  // Based on your CSS (bottom-right), 'prepend' usually looks better so the stack pushes up.
  container.prepend(toast);

  // 6. Lifecycle Management

  // A. Auto Dismiss Timer
  const autoDismissTimeout = setTimeout(() => {
    removeToast(toast);
  }, time_in_secconds * 1000);

  // B. Manual Close Button
  const closeBtn = toast.querySelector(".close-btn-notification");
  closeBtn.addEventListener("click", () => {
    clearTimeout(autoDismissTimeout); // Stop the auto-timer
    removeToast(toast); // Remove immediately
  });
}

// Helper: Remove with Animation
function removeToast(toast) {
  toast.style.animation =
    "toastSlideOut 0.4s forwards cubic-bezier(0.68, -0.55, 0.27, 1.55)";
  toast.addEventListener("animationend", () => {
    toast.remove();
  });
}

// Helper: Security (From Logic Source)
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Helper: URL or relative path Check (From Visual Source)
function isURL_orPath(string) {
  // 1. Check if it is a valid Absolute URL (HTTP/HTTPS)
  try {
    const url = new URL(string);
    // Only return true for http/https, excluding ftp, mailto, etc.
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    // 2. If Absolute check failed, check if it is a Relative Path
    try {
      // We use a dummy base to validate that the string is a syntactically valid path
      const base = "http://example.com";
      const url = new URL(string, base);

      // Verification logic:
      // A. The origin must match the base (ensures the string didn't switch to a different protocol/domain)
      // B. The string must contain a slash '/' or start with '.' (distinguishes paths from plain words like "hello")
      const isRelative = url.origin === base;
      const isPathLike = string.includes("/") || string.startsWith(".");

      return isRelative && isPathLike;
    } catch (_) {
      return false;
    }
  }
}

/* ============================
      Confirmation Modal
     ============================ */

export function _confirm(message) {
  return new Promise((resolve) => {
    // 1. Create Overlay
    const overlay = document.createElement("div");
    overlay.className = "confirmation-overlay";

    // 2. Create Modal
    const modal = document.createElement("div");
    modal.className = "confirmation-modal";
    // role="alertdialog" (rather than plain "dialog") + aria-modal tells
    // assistive tech both that background content is inert AND that this
    // is an interruption requiring an immediate yes/no response, matching
    // how this component is actually used (delete confirmations etc.).
    // aria-labelledby points at the message paragraph itself so it's
    // announced as the dialog's accessible name the moment focus enters.
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    const messageId = `confirm-message-${Date.now()}`;
    modal.setAttribute("aria-labelledby", messageId);

    // 3. Content
    modal.innerHTML = `
        <div class="confirmation-content">
          <p class="confirmation-message" id="${messageId}">${escapeHtml(message)}</p>
          <div class="confirmation-actions">
            <button class="confirmation-btn confirm">نعم</button>
            <button class="confirmation-btn cancel">لا</button>
          </div>
        </div>
      `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 4. Focus Management
    const confirmBtn = modal.querySelector(".confirm");
    const cancelBtn = modal.querySelector(".cancel");
    const previousActiveElement = document.activeElement;

    // Animation entry
    requestAnimationFrame(() => {
      overlay.classList.add("show");
      modal.classList.add("show");
      confirmBtn.focus();
    });

    // 5. Cleanup function
    const cleanup = () => {
      window.removeEventListener("keydown", handleKeydown);
      overlay.classList.remove("show");
      modal.classList.remove("show");

      // Wait for animation to finish
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (
          previousActiveElement &&
          document.body.contains(previousActiveElement)
        ) {
          previousActiveElement.focus();
        }
      }, 300);
    };

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    // 6. Keyboard support (Escape and Tab trapping)
    const handleKeydown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleCancel();
      } else if (e.key === "Tab") {
        const focusable = modal.querySelectorAll("button");
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    // Event Listeners
    confirmBtn.addEventListener("click", handleConfirm);
    cancelBtn.addEventListener("click", handleCancel);
    window.addEventListener("keydown", handleKeydown);

    // Click outside treats as cancel
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) handleCancel();
    });
  });
}

/* ============================
      Alert Modal
      Drop-in async replacement for window.alert()
      Usage: await _alert("Something happened.");
      Resolves with no value once the user dismisses it
      (matches native alert() semantics: blocks until acknowledged).
     ============================ */

export function _alert(message) {
  return new Promise((resolve) => {
    // 1. Create Overlay
    const overlay = document.createElement("div");
    overlay.className = "confirmation-overlay";

    // 2. Create Modal
    const modal = document.createElement("div");
    modal.className = "confirmation-modal alert-modal";
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    const messageId = `alert-message-${Date.now()}`;
    modal.setAttribute("aria-labelledby", messageId);

    // 3. Content
    modal.innerHTML = `
        <div class="confirmation-content">
          <p class="confirmation-message" id="${messageId}">${escapeHtml(message)}</p>
          <div class="confirmation-actions">
            <button class="confirmation-btn confirm">حسناً</button>
          </div>
        </div>
      `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 4. Focus Management
    const okBtn = modal.querySelector(".confirm");
    const previousActiveElement = document.activeElement;

    // Animation entry
    requestAnimationFrame(() => {
      overlay.classList.add("show");
      modal.classList.add("show");
      okBtn.focus();
    });

    // 5. Cleanup function
    const cleanup = () => {
      window.removeEventListener("keydown", handleKeydown);
      overlay.classList.remove("show");
      modal.classList.remove("show");

      // Wait for animation to finish
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (
          previousActiveElement &&
          document.body.contains(previousActiveElement)
        ) {
          previousActiveElement.focus();
        }
      }, 300);
    };

    const handleDismiss = () => {
      cleanup();
      resolve();
    };

    // 6. Keyboard support (Enter/Escape both dismiss, Tab trapping on the single button)
    const handleKeydown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleDismiss();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleDismiss();
      } else if (e.key === "Tab") {
        // Only one focusable element — keep focus trapped on it
        e.preventDefault();
        okBtn.focus();
      }
    };

    // Event Listeners
    okBtn.addEventListener("click", handleDismiss);
    window.addEventListener("keydown", handleKeydown);

    // Click outside treats as dismiss (alert has no "cancel" concept, just acknowledgement)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) handleDismiss();
    });
  });
}

/* ============================
      Prompt Modal
      Drop-in async replacement for window.prompt()
      Usage: const answer = await _prompt("Your name?", "Guest");
      Resolves with the entered string, or null if cancelled
      (matches native prompt() semantics exactly).

      BUG FIX: the input previously had no `dir` attribute, so it inherited
      a single static direction (LTR, or RTL depending on ambient page/CSS
      direction) for the entire session regardless of what the user actually
      typed — typing Arabic into an LTR-inherited input left the caret and
      text alignment fighting the script the whole time, and vice versa for
      English typed into an RTL-inherited one. `dir="auto"` (native browser
      behavior, no JS needed) makes the browser re-run the Unicode
      bidirectional algorithm on the input's own content as it changes, so
      the field's direction always matches whatever script the user is
      currently typing, live, per keystroke — the same fix already used for
      the AI agent's chat textarea (see ai-agent-chat.js).
     ============================ */

export function _prompt(message, defaultValue = "") {
  return new Promise((resolve) => {
    // 1. Create Overlay
    const overlay = document.createElement("div");
    overlay.className = "confirmation-overlay";

    // 2. Create Modal
    const modal = document.createElement("div");
    modal.className = "confirmation-modal prompt-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const messageId = `prompt-message-${Date.now()}`;
    modal.setAttribute("aria-labelledby", messageId);

    // 3. Content
    // aria-labelledby on the input (rather than a separate <label>) reuses
    // the existing message paragraph as the field's accessible name, so a
    // screen reader announces e.g. "Your name?, edit text" when focus lands
    // on the input instead of just "edit text".
    modal.innerHTML = `
        <div class="confirmation-content">
          <p class="confirmation-message" id="${messageId}">${escapeHtml(message)}</p>
          <input type="text" class="prompt-input" dir="auto" aria-labelledby="${messageId}" value="${escapeHtml(defaultValue)}" />
          <div class="confirmation-actions">
            <button class="confirmation-btn confirm">نعم</button>
            <button class="confirmation-btn cancel">لا</button>
          </div>
        </div>
      `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 4. Focus Management
    const input = modal.querySelector(".prompt-input");
    const confirmBtn = modal.querySelector(".confirm");
    const cancelBtn = modal.querySelector(".cancel");
    const previousActiveElement = document.activeElement;

    // Animation entry
    requestAnimationFrame(() => {
      overlay.classList.add("show");
      modal.classList.add("show");
      input.focus();
      input.select();
    });

    // 5. Cleanup function
    const cleanup = () => {
      window.removeEventListener("keydown", handleKeydown);
      overlay.classList.remove("show");
      modal.classList.remove("show");

      // Wait for animation to finish
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (
          previousActiveElement &&
          document.body.contains(previousActiveElement)
        ) {
          previousActiveElement.focus();
        }
      }, 300);
    };

    const handleConfirm = () => {
      const value = input.value;
      cleanup();
      resolve(value); // native prompt() returns "" on empty OK, never null on confirm
    };

    const handleCancel = () => {
      cleanup();
      resolve(null); // native prompt() returns null on cancel
    };

    // 6. Keyboard support (Enter to confirm, Escape to cancel, Tab trapping)
    const handleKeydown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Tab") {
        const focusable = [input, confirmBtn, cancelBtn];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    // Event Listeners
    confirmBtn.addEventListener("click", handleConfirm);
    cancelBtn.addEventListener("click", handleCancel);
    window.addEventListener("keydown", handleKeydown);

    // Click outside treats as cancel
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) handleCancel();
    });
  });
}

/* ============================
      Typed-Confirmation Modal (double verification)
      For fully destructive, hard-to-undo, collection-wide actions where a
      single button-press confirmation is too easy to click past without
      reading — e.g. "حذف الكل" living in the same context menu as the much
      more common, much less dangerous per-item "حذف". Modeled on GitHub's
      "type the repo name to confirm deletion" pattern: the confirm button
      stays disabled until the typed text exactly matches a phrase the
      caller chooses (case-sensitive, no trimming — an exact match is the
      whole point of this friction).

      Usage:
        const ok = await _confirmTyped({
          message: "سيتم حذف كل امتحاناتك ومجلداتك نهائياً ...",
          confirmPhrase: "حذف الكل",
        });
        if (!ok) return;

      Resolves `true` only if the user completed BOTH steps (pressed
      "نعم" on the initial _confirm-style step, then typed the exact
      phrase and pressed the final destructive button); `false` if they
      backed out at either step. There is no single "cancel" the user can
      mis-click their way past into an accidental delete — every path that
      isn't an exact-match confirm resolves false.
     ============================ */

/**
 * @param {object} options
 * @param {string} options.message - shown on the first (button-only) step;
 *   same semantics/rendering as _confirm()'s message (supports "\n").
 * @param {string} options.confirmPhrase - the exact string the user must
 *   type on the second step to enable the destructive button.
 * @param {string} [options.inputLabel] - short instruction shown above the
 *   typed-confirmation input on the second step. Defaults to a generic
 *   "اكتب ... للتأكيد" built from confirmPhrase if omitted.
 * @param {string} [options.confirmButtonLabel] - label for the final
 *   destructive button (step 2). Defaults to "حذف نهائياً".
 * @returns {Promise<boolean>}
 */
export function _confirmTyped({
  message,
  confirmPhrase,
  inputLabel = null,
  confirmButtonLabel = "حذف نهائياً",
}) {
  return new Promise((resolve) => {
    // Step 1 reuses the exact same button-only confirmation the rest of the
    // app already uses for every other destructive action — so a user who
    // never proceeds past this step sees a UI identical to what they're
    // already used to, and only encounters the extra typed step for this
    // specifically more dangerous action.
    _confirm(message).then((confirmedStep1) => {
      if (!confirmedStep1) {
        resolve(false);
        return;
      }
      openTypedConfirmationStep({
        confirmPhrase,
        inputLabel:
          inputLabel || `اكتب "${confirmPhrase}" للتأكيد النهائي:`,
        confirmButtonLabel,
      }).then(resolve);
    });
  });
}

/**
 * The second, typed step of _confirmTyped() — its own modal so its
 * lifecycle (focus trap, animation, escape-to-cancel) mirrors _confirm()/
 * _prompt() exactly rather than bolting extra states onto one of those.
 * Not exported: only ever reached via _confirmTyped(), never standalone.
 */
function openTypedConfirmationStep({ confirmPhrase, inputLabel, confirmButtonLabel }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirmation-overlay";

    const modal = document.createElement("div");
    modal.className = "confirmation-modal prompt-modal typed-confirmation-modal";
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    const messageId = `typed-confirm-message-${Date.now()}`;
    const phraseId = `typed-confirm-phrase-${Date.now()}`;
    modal.setAttribute("aria-labelledby", messageId);

    modal.innerHTML = `
        <div class="confirmation-content">
          <p class="confirmation-message" id="${messageId}">${escapeHtml(inputLabel)}</p>
          <p class="typed-confirmation-phrase" id="${phraseId}" dir="auto">${escapeHtml(confirmPhrase)}</p>
          <input
            type="text"
            class="prompt-input typed-confirmation-input"
            dir="auto"
            aria-labelledby="${messageId}"
            aria-describedby="${phraseId}"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <div class="confirmation-actions">
            <button class="confirmation-btn confirm typed-confirmation-confirm-btn" disabled>${escapeHtml(confirmButtonLabel)}</button>
            <button class="confirmation-btn cancel">إلغاء</button>
          </div>
        </div>
      `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const input = modal.querySelector(".typed-confirmation-input");
    const confirmBtn = modal.querySelector(".typed-confirmation-confirm-btn");
    const cancelBtn = modal.querySelector(".cancel");
    const previousActiveElement = document.activeElement;

    // The confirm button only ever becomes enabled once the typed text is
    // an EXACT match — no trimming, no case-folding. Matching _confirm's
    // wording so the app has one consistent word for "abort", but this
    // button's disabled-by-default state is what actually prevents the
    // misclick this whole component exists to stop; the label alone
    // (unlike the single-button _confirm step) was never the safeguard.
    const updateConfirmState = () => {
      const isExactMatch = input.value === confirmPhrase;
      confirmBtn.disabled = !isExactMatch;
    };
    input.addEventListener("input", updateConfirmState);

    requestAnimationFrame(() => {
      overlay.classList.add("show");
      modal.classList.add("show");
      input.focus();
    });

    const cleanup = () => {
      window.removeEventListener("keydown", handleKeydown);
      overlay.classList.remove("show");
      modal.classList.remove("show");
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (
          previousActiveElement &&
          document.body.contains(previousActiveElement)
        ) {
          previousActiveElement.focus();
        }
      }, 300);
    };

    const handleConfirm = () => {
      // Re-check on submit too (not just via the disabled attribute) — a
      // form-adjacent Enter keypress firing before the input's own "input"
      // handler settles state should never be able to slip a non-matching
      // value through.
      if (input.value !== confirmPhrase) return;
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const handleKeydown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm(); // no-op if the phrase doesn't match yet
      } else if (e.key === "Tab") {
        const focusable = [input, confirmBtn, cancelBtn];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    confirmBtn.addEventListener("click", handleConfirm);
    cancelBtn.addEventListener("click", handleCancel);
    window.addEventListener("keydown", handleKeydown);

    // Click outside treats as cancel — same semantics as every other modal
    // here, and important precisely because this is the destructive step.
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) handleCancel();
    });
  });
}
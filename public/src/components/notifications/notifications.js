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

    // 3. Content
    modal.innerHTML = `
        <div class="confirmation-content">
          <p class="confirmation-message">${escapeHtml(message)}</p>
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

    // 3. Content
    modal.innerHTML = `
        <div class="confirmation-content">
          <p class="confirmation-message">${escapeHtml(message)}</p>
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
     ============================ */

export function _prompt(message, defaultValue = "") {
  return new Promise((resolve) => {
    // 1. Create Overlay
    const overlay = document.createElement("div");
    overlay.className = "confirmation-overlay";

    // 2. Create Modal
    const modal = document.createElement("div");
    modal.className = "confirmation-modal prompt-modal";

    // 3. Content
    modal.innerHTML = `
        <div class="confirmation-content">
          <p class="confirmation-message">${escapeHtml(message)}</p>
          <input type="text" class="prompt-input" value="${escapeHtml(defaultValue)}" />
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

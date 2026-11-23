// =============================================================================
// public/src/features/home/admin-welcome-toast.js
// One-time toast after an admin's first successful sign-in, linking to the
// upload guide. sign-in.js sets the pending flag right before its reload.
// =============================================================================

import { showNotification } from "../../components/notifications/notifications.js";

const PENDING_KEY = "bq-admin-welcome-pending";
const SHOWN_KEY = "bq-admin-welcome-shown";

export function maybeShowAdminWelcome() {
  try {
    if (localStorage.getItem(PENDING_KEY) !== "1") return;
    localStorage.removeItem(PENDING_KEY);
    if (localStorage.getItem(SHOWN_KEY) === "1") return;
    localStorage.setItem(SHOWN_KEY, "1");
  } catch {
    return;
  }
  showNotification(
    "مرحباً بك مشرفاً",
    "تعرّف على طريقة رفع المحتوى ونشره على المنصة.",
    "success",
    12,
    { action: { label: "افتح دليل رفع المحتوى", href: "/how-to-upload-content" } },
  );
}

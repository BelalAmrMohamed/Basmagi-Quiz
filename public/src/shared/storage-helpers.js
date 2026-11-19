// ============================================================================
// public/src/shared/storage-helpers.js
// UTILITY FUNCTIONS - Enhanced with Security
// ============================================================================
import { showNotification } from "../components/notifications/notifications.js";
import { WARNING_ICON_SVG } from "../features/home/icons.js";

/**
 * Safe localStorage getter with error handling
 */
export function getFromStorage(key, defaultValue = null) {
  try {
    const item = localStorage.getItem(key);
    return item !== null ? item : defaultValue;
  } catch (error) {
    console.error(`Error reading from localStorage: ${key}`, error);
    return defaultValue;
  }
}

/**
 * Safe localStorage setter with error handling
 */
export function setInStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`Error writing to localStorage: ${key}`, error);
    if (error.name === "QuotaExceededError") {
      showNotification(
        "تحذير",
        "مساحة التخزين ممتلئة. قد تفقد بعض البيانات.",
        WARNING_ICON_SVG,
      );
    }
    return false;
  }
}

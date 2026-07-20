// public/src/shared/user-name-validation.js
const MAX_USERNAME_LENGTH = 50;

/**
 * Validate username input
 */
export function validateUsername(username) {
  if (!username || !username.trim()) {
    return { valid: false, message: "الرجاء إدخال اسم صالح" };
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    return {
      valid: false,
      message: `الاسم طويل جداً (الحد الأقصى ${MAX_USERNAME_LENGTH} حرف)`,
    };
  }

  // Check for potentially malicious content
  const dangerousPatterns = /<script|javascript:|onerror=/gi;
  if (dangerousPatterns.test(username)) {
    return { valid: false, message: "اسم غير صالح" };
  }

  return { valid: true, message: "" };
}

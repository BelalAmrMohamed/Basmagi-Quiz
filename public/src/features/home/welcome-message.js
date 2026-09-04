// ============================================================================
// public/src/features/home/welcome-message.js
// USER PERSONALIZATION & GAMIFIED WELCOME SYSTEM
// ============================================================================

import { getFromStorage } from "../../shared/storage-helpers.js";
import { escapeHtml } from "./escape-html.js";

const userNameBadge = document.getElementById("user-name");

// Gamified welcome message pool
const welcomeMessages = [
  (name) => `👑 الأسطورة رجع في ثواني ${name}.. عشان يقفل المادة من تاني!`,
  (name) => `🔥 رجعتك قوية ${name}.. وعينك على الدرجة النهائية!`,
  (name) => `💡 المخ شغال ${name}.. والحل النهاردة عال العال!`,
  (name) => `💪 وحش امتحانات ${name}.. داخل يلم الدرجات!`,
  (name) => `📈 خطوة جديدة ${name}.. لدرجة حلوة وأكيدة!`,
  (name) => `🌟 كبير المجال ${name}.. داخل يحل ويروق البال!`,
  (name) => `🌟 منور الشاشة ${name}.. داخل تقفل المادة يا باشا!`,
];

/**
 * Get random welcome message
 */
function getRandomWelcomeMessage(name) {
  const escapedName = escapeHtml(name);
  const message =
    welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
  return message(escapedName);
}

/**
 * Update welcome badge text
 */
export function updateWelcomeMessage() {
  try {
    const name = getFromStorage("username", "User");
    const messageTemplate = getRandomWelcomeMessage(name);

    // Replace username with styled span
    const styledMessage = messageTemplate.replace(
      escapeHtml(name),
      `<span class="user-name">${escapeHtml(name)}</span>`,
    );

    if (userNameBadge) {
      userNameBadge.innerHTML = styledMessage;
      userNameBadge.setAttribute("aria-label", `تغيير اسم المستخدم: ${name}`);
      userNameBadge.setAttribute(
        "title",
        `اضغط لتغيير اسم المستخدم: [${name}]`,
      );
    }
  } catch (error) {
    console.error("Error updating welcome message:", error);
  }
}

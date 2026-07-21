// ============================================================================
// public/src/features/home/subscribe-button.js
// SUBSCRIBE BUTTON — course subscribe action shown on search-result cards
// ============================================================================

import { userProfile } from "../userProfile.js";

// NOTE: showNotification() is a global provided by src/components/notifications.js,
// loaded as a plain (non-module) <script> in index.html — not imported here,
// matching the original single-file index.js's behavior.

export function addSubscribeButton(card, course) {
  try {
    // Check if already subscribed
    const subscribedIds = userProfile.getSubscribedCourseIds();
    const isSubscribed = subscribedIds.includes(course.id);

    // Create button container
    const btnContainer = document.createElement("div");
    btnContainer.className = "subscribe-btn-container";

    // Create subscribe button
    const subscribeBtn = document.createElement("button");
    subscribeBtn.className = isSubscribed
      ? "subscribe-btn subscribe-btn--subscribed"
      : "subscribe-btn subscribe-btn--add";
    subscribeBtn.textContent = isSubscribed ? "✓ مشترك" : "+ إضافة";
    subscribeBtn.type = "button";
    subscribeBtn.setAttribute(
      "aria-label",
      isSubscribed ? `مشترك في ${course.name}` : `إضافة ${course.name}`,
    );

    if (!isSubscribed) {
      subscribeBtn.onclick = (e) => {
        e.stopPropagation();
        subscribeToCourse(course, subscribeBtn);
      };
    }

    btnContainer.appendChild(subscribeBtn);
    card.appendChild(btnContainer);
  } catch (error) {
    console.error("Error adding subscribe button:", error);
  }
}

/**
 * Subscribe to a course
 */
function subscribeToCourse(course, button) {
  try {
    userProfile.subscribeToCourse(course.id);

    // Update button appearance
    button.textContent = "✓ مشترك";
    button.className = "subscribe-btn subscribe-btn--subscribed";
    button.onclick = null;
    button.setAttribute("aria-label", `مشترك في ${course.name}`);

    // Show notification
    showNotification(
      "تم الإشتراك",
      `تم إضافة ${course.name} إلى موادك`,
      "./favicon.png",
    );
  } catch (error) {
    console.error("Error subscribing to course:", error);
    alert("حدث خطأ أثناء الإشتراك. حاول مرة أخرى.");
  }
}

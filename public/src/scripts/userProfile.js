// src/scripts/userProfile.js - User Profile & Subscription Management
// Centralized user profile management for the Quiz Master PWA

/**
 * User Profile Structure:
 * {
 *   username: string,
 *   faculty: string,
 *   year: string,
 *   term: string,
 *   subscribedCourseIds: string[]
 * }
 */

const STORAGE_KEY = "quiz_user_profile";
const DEFAULT_PROFILE = {
  username: "User",
  faculty: "All",
  year: "All",
  term: "All",
  education_type: null,
  subscribedCourseIds: [],
  quizStyle: "pagination", // "pagination" | "vertical"
  defaultQuizMode: "practice", // "practice" | "timed" | "exam" | "timed_exam"
};

export class UserProfileManager {
  constructor() {
    this.profile = this.loadProfile();
  }

  /**
   * Load user profile from localStorage
   * CRITICAL: Maintains backward compatibility with standalone "username" key
   */
  loadProfile() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      let profile = { ...DEFAULT_PROFILE };

      if (stored) {
        const parsed = JSON.parse(stored);
        profile = {
          ...DEFAULT_PROFILE,
          ...parsed,
          subscribedCourseIds: parsed.subscribedCourseIds || [],
        };
      }

      // BACKWARD COMPATIBILITY: Always prioritize standalone "username" key
      const standaloneUsername = localStorage.getItem("username");
      if (standaloneUsername) {
        profile.username = standaloneUsername;
      }

      return profile;
    } catch (error) {
      console.error("Error loading user profile:", error);
    }

    // Fallback: check for standalone username even if profile load fails
    const standaloneUsername = localStorage.getItem("username");
    return {
      ...DEFAULT_PROFILE,
      username: standaloneUsername || DEFAULT_PROFILE.username,
    };
  }

  /**
   * Save user profile to localStorage
   * CRITICAL: Syncs username to standalone "username" key for backward compatibility
   */
  saveProfile() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));

      // BACKWARD COMPATIBILITY: Always sync username to standalone key
      localStorage.setItem("username", this.profile.username);
    } catch (error) {
      console.error("Error saving user profile:", error);
    }
  }

  /**
   * Get current profile
   */
  getProfile() {
    return { ...this.profile };
  }

  /**
   * Update username
   */
  setUsername(username) {
    if (!username || !username.trim()) return false;
    this.profile.username = username.trim();
    this.saveProfile();
    return true;
  }

  /**
   * Update user's faculty, year, and term
   * @param {Object} updates - { faculty?, year?, term? }
   */
  updateAcademicInfo(updates) {
    const { faculty, year, term, education_type } = updates;

    if (faculty !== undefined) this.profile.faculty = faculty;
    if (year !== undefined) this.profile.year = year;
    if (term !== undefined) this.profile.term = term;
    if (education_type !== undefined) this.profile.education_type = education_type;

    this.saveProfile();
  }

  /**
   * Set education_type for legacy profile migration.
   * @param {string} type - e.g. 'University'
   */
  migrateEducationType(type) {
    if (!type) return false;
    this.profile.education_type = type;
    this.saveProfile();
    return true;
  }

  /**
   * Get/set quiz display style: "pagination" (one per page) or "vertical" (all at once)
   */
  getQuizStyle() {
    return this.profile.quizStyle || DEFAULT_PROFILE.quizStyle;
  }

  setQuizStyle(style) {
    if (style === "pagination" || style === "vertical") {
      this.profile.quizStyle = style;
      this.saveProfile();
      return true;
    }
    return false;
  }

  /**
   * Get/set default quiz mode: "practice" | "timed" | "exam" | "timed_exam"
   */
  getDefaultQuizMode() {
    return this.profile.defaultQuizMode || DEFAULT_PROFILE.defaultQuizMode;
  }

  setDefaultQuizMode(mode) {
    if (
      mode === "practice" ||
      mode === "timed" ||
      mode === "exam" ||
      mode === "timed_exam"
    ) {
      this.profile.defaultQuizMode = mode;
      this.saveProfile();
      return true;
    }
    return false;
  }

  /**
   * Check if a course ID is subscribed
   */
  isSubscribed(courseId) {
    return this.profile.subscribedCourseIds.includes(courseId);
  }

  /**
   * Subscribe to a course
   */
  subscribeToCourse(courseId) {
    if (!courseId) return false;
    if (!this.isSubscribed(courseId)) {
      this.profile.subscribedCourseIds.push(courseId);
      this.saveProfile();
      return true;
    }
    return false;
  }

  /**
   * Unsubscribe from a course
   */
  unsubscribeFromCourse(courseId) {
    const index = this.profile.subscribedCourseIds.indexOf(courseId);
    if (index > -1) {
      this.profile.subscribedCourseIds.splice(index, 1);
      this.saveProfile();
      return true;
    }
    return false;
  }

  /**
   * Toggle subscription for a course
   */
  toggleSubscription(courseId) {
    if (this.isSubscribed(courseId)) {
      return this.unsubscribeFromCourse(courseId);
    } else {
      return this.subscribeToCourse(courseId);
    }
  }

  /**
   * Get all subscribed course IDs
   */
  getSubscribedCourseIds() {
    return [...this.profile.subscribedCourseIds];
  }

  /**
   * Set subscribed courses (replaces entire array)
   */
  setSubscribedCourses(courseIds) {
    this.profile.subscribedCourseIds = Array.isArray(courseIds)
      ? [...courseIds]
      : [];
    this.saveProfile();
  }

  /**
   * Initialize default subscriptions based on academic info
   * This should be called when user first sets their faculty/year/term
   */
  initializeDefaultSubscriptions(categoryTree) {
    const { faculty, year, term, education_type } = this.profile;
    const trackType = education_type || "University";

    if (year === "All" || term === "All") {
      return [];
    }

    if (trackType === "University" && (faculty === "All" || !faculty)) {
      return [];
    }

    const matchingCourses = [];

    Object.values(categoryTree).forEach((category) => {
      if (
        !category.parent &&
        category.education_type !== "Featured" &&
        category.year &&
        category.term &&
        category.id
      ) {
        if (category.education_type !== trackType) return;

        if (
          String(category.year) !== String(year) ||
          String(category.term) !== String(term)
        ) {
          return;
        }

        if (trackType === "University") {
          if (!category.faculty || category.faculty !== faculty) return;
        }

        matchingCourses.push(category.id);
      }
    });

    matchingCourses.forEach((courseId) => {
      if (!this.isSubscribed(courseId)) {
        this.subscribeToCourse(courseId);
      }
    });

    return matchingCourses;
  }

  /**
   * Check if this is the user's first visit (no academic info configured)
   * Used to trigger the onboarding wizard
   * @returns {boolean} true if first visit
   */
  checkFirstVisit() {
    return (
      this.profile.faculty === "All" &&
      this.profile.year === "All" &&
      this.profile.term === "All"
    );
  }

  /**
   * Save initial setup from onboarding wizard
   * @param {Object} data - { faculty, year, term }
   * @param {Object} categoryTree - Category tree for auto-subscription
   * @returns {Array} List of auto-subscribed course IDs
   */
  saveInitialSetup(data, categoryTree) {
    const { faculty, year, term } = data;

    if (faculty) this.profile.faculty = faculty;
    if (year) this.profile.year = year;
    if (term) this.profile.term = term;

    this.saveProfile();

    // Auto-subscribe to matching courses
    return this.initializeDefaultSubscriptions(categoryTree);
  }

  /**
   * Reset profile to defaults
   */
  reset() {
    this.profile = { ...DEFAULT_PROFILE };
    this.saveProfile();
  }
}

// Create singleton instance
export const userProfile = new UserProfileManager();

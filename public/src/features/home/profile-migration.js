// ============================================================================
// LEGACY PROFILE MIGRATION — one-shot upgrade for profiles saved before the
// education_type field existed (inferred from the old college/faculty field).
// Called once from navigation.js's initApp().
// ============================================================================

import { userProfile } from "../userProfile.js";

export function migrateLegacyUserProfile() {
  try {
    const p = userProfile.getProfile();
    const college = p.college || p.faculty;
    if (college && college !== "All" && !p.education_type) {
      userProfile.migrateEducationType("University");
    }
  } catch (e) {
    console.warn("Legacy profile migration skipped:", e);
  }
}

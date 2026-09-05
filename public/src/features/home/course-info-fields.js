// ============================================================================
// public/src/features/home/course-info-fields.js
// COURSE INFO FIELDS — single source of truth for the education-type Arabic
// translation and the "نوع التعليم / الكلية / العام / الترم" row set shared
// by showCourseInfoModal() (course-actions.js), the course "معلومات المادة"
// dropdown submenu (root-view.js), and the course-card (i) tooltip
// (course-info-tooltip.js). Previously each of these three places kept its
// own copy of the education-type map and its own slightly different label
// set/empty-row handling — this consolidates all three so the labels and
// "hide empty Year/Term" behavior can never drift out of sync again.
// ============================================================================

export const EDU_TYPE_AR = {
  University: "جامعي",
  High: "ثانوي",
  Middle: "إعدادي",
  Primary: "إبتدائي",
  Featured: "كورسات مميزة",
};

/** True if this course is in the "كورسات مميزة" (Featured) bucket — used to
 * apply the highlighted label style wherever education type is shown. */
export function isFeaturedCourse(course) {
  return course?.education_type === "Featured";
}

/** Arabic label for a course's education_type, or the raw value/"-" if
 * unrecognized. */
export function getEduTypeLabel(course) {
  return EDU_TYPE_AR[course?.education_type] || course?.education_type || "-";
}

/**
 * Builds the canonical course info rows: نوع التعليم (always present),
 * الكلية (only when set and not "All"), العام and الترم (each only when
 * actually set — no more empty "-" rows for missing Year/Term).
 *
 * @param {object} course - course object with education_type, faculty,
 *   year, term.
 * @returns {{label: string, val: string, highlight?: boolean}[]}
 */
export function buildCourseInfoRows(course) {
  const rows = [
    {
      label: "نوع التعليم",
      val: getEduTypeLabel(course),
      highlight: isFeaturedCourse(course),
    },
  ];

  if (course?.faculty && course.faculty !== "All") {
    rows.push({ label: "الكلية", val: course.faculty });
  }
  if (course?.year) {
    rows.push({ label: "العام", val: course.year });
  }
  if (course?.term) {
    rows.push({ label: "الترم", val: course.term });
  }

  return rows;
}
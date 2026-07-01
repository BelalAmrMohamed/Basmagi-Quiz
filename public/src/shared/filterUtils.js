// src/shared/filterUtils.js - Course Filtering & Metadata Extraction

const SCHOOL_TYPES = new Set(["Primary", "Middle", "High"]);

function sortNumeric(a, b) {
  const numA = parseInt(a, 10);
  const numB = parseInt(b, 10);
  if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
  return String(a).localeCompare(String(b));
}

export function isUniversityTrack(educationType) {
  return educationType === "University";
}

export function isSchoolTrack(educationType) {
  return SCHOOL_TYPES.has(educationType);
}

/**
 * Get available colleges for a university track.
 */
export function getAvailableFaculties(categoryTree, educationType = "University") {
  const faculties = new Set();

  Object.values(categoryTree).forEach((category) => {
    if (
      !category.parent &&
      category.education_type === educationType &&
      category.faculty
    ) {
      faculties.add(category.faculty);
    }
  });

  return Array.from(faculties).sort();
}

/**
 * Extract unique values for faculties, years, and terms from categoryTree
 */
export function extractMetadata(categoryTree) {
  const faculties = new Set();
  const years = new Set();
  const terms = new Set();

  Object.values(categoryTree).forEach((category) => {
    // Only look at top-level categories (courses) with metadata
    if (!category.parent) {
      if (category.faculty) faculties.add(category.faculty);
      if (category.year) years.add(category.year);
      if (category.term) terms.add(category.term);
    }
  });

  return {
    faculties: Array.from(faculties).sort(),
    years: Array.from(years).sort((a, b) => {
      // Sort years numerically
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    }),
    terms: Array.from(terms).sort((a, b) => {
      // Sort terms numerically
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    }),
  };
}

function getAvailableYearsForTrack(categoryTree, { education_type, faculty }) {
  const years = new Set();

  Object.values(categoryTree).forEach((category) => {
    if (category.parent || category.education_type !== education_type || !category.year) {
      return;
    }

    if (
      isUniversityTrack(education_type) &&
      faculty &&
      faculty !== "All" &&
      category.faculty !== faculty
    ) {
      return;
    }

    years.add(String(category.year));
  });

  return Array.from(years).sort(sortNumeric);
}

/**
 * Get available years for a specific faculty (cascading filter)
 * @param {Object} categoryTree - The category tree
 * @param {string|Object} facultyOrFilters - Faculty string or { education_type, faculty }
 * @returns {Array} Array of available years
 */
export function getAvailableYears(categoryTree, facultyOrFilters) {
  if (
    facultyOrFilters &&
    typeof facultyOrFilters === "object" &&
    facultyOrFilters.education_type
  ) {
    return getAvailableYearsForTrack(categoryTree, facultyOrFilters);
  }

  const faculty = facultyOrFilters;
  const years = new Set();

  Object.values(categoryTree).forEach((category) => {
    if (!category.parent && category.year) {
      if (faculty === "All") {
        years.add(category.year);
      } else if (category.faculty === faculty) {
        years.add(category.year);
      }
    }
  });

  return Array.from(years).sort(sortNumeric);
}

function getAvailableTermsForTrack(
  categoryTree,
  { education_type, faculty, year },
) {
  const terms = new Set();

  Object.values(categoryTree).forEach((category) => {
    if (category.parent || category.education_type !== education_type || !category.term) {
      return;
    }

    if (
      isUniversityTrack(education_type) &&
      faculty &&
      faculty !== "All" &&
      category.faculty !== faculty
    ) {
      return;
    }

    if (year && year !== "All" && String(category.year) !== String(year)) {
      return;
    }

    terms.add(String(category.term));
  });

  return Array.from(terms).sort(sortNumeric);
}

/**
 * Get available terms for a specific faculty and year (cascading filter)
 * @param {Object} categoryTree - The category tree
 * @param {string|Object} facultyOrFilters - Faculty string or { education_type, faculty, year }
 * @param {string} [year] - Selected year when first arg is faculty string
 * @returns {Array} Array of available terms
 */
export function getAvailableTerms(categoryTree, facultyOrFilters, year) {
  if (
    facultyOrFilters &&
    typeof facultyOrFilters === "object" &&
    facultyOrFilters.education_type
  ) {
    return getAvailableTermsForTrack(categoryTree, facultyOrFilters);
  }

  const faculty = facultyOrFilters;
  const terms = new Set();

  Object.values(categoryTree).forEach((category) => {
    if (!category.parent && category.term) {
      if (faculty === "All" && year === "All") {
        terms.add(category.term);
      } else if (faculty === "All" && category.year === year) {
        terms.add(category.term);
      } else if (year === "All" && category.faculty === faculty) {
        terms.add(category.term);
      } else if (category.faculty === faculty && category.year === year) {
        terms.add(category.term);
      }
    }
  });

  return Array.from(terms).sort(sortNumeric);
}

/**
 * Filter track courses by education_type (excludes Featured).
 * University requires faculty/year/term; school tracks require year/term only.
 */
export function filterTrackCourses(categoryTree, filters) {
  const { education_type, faculty, year, term } = filters;

  return Object.entries(categoryTree)
    .filter(([key, category]) => {
      if (category.parent) return false;
      if (category.education_type === "Featured") return false;
      if (education_type && category.education_type !== education_type) {
        return false;
      }

      const trackType = education_type || category.education_type;

      if (isUniversityTrack(trackType)) {
        if (!category.faculty || !category.year || !category.term) return false;
        if (faculty && faculty !== "All" && category.faculty !== faculty) {
          return false;
        }
      } else if (isSchoolTrack(trackType)) {
        if (!category.year || !category.term) return false;
      } else if (trackType) {
        return false;
      } else if (!category.faculty || !category.year || !category.term) {
        return false;
      }

      if (year && year !== "All" && String(category.year) !== String(year)) {
        return false;
      }

      if (term && term !== "All" && String(category.term) !== String(term)) {
        return false;
      }

      return true;
    })
    .map(([key, category]) => ({ key, ...category }));
}

/**
 * Filter standalone featured courses.
 */
export function filterFeaturedCourses(categoryTree) {
  return Object.entries(categoryTree)
    .filter(
      ([key, category]) =>
        !category.parent && category.education_type === "Featured",
    )
    .map(([key, category]) => ({ key, ...category }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Filter courses based on faculty, year, and term
 * Supports "All" option for each filter
 */
export function filterCourses(categoryTree, filters) {
  const { faculty, year, term } = filters;

  return Object.entries(categoryTree)
    .filter(([key, category]) => {
      // Only filter top-level categories (courses)
      if (category.parent) return false;

      // If category doesn't have metadata, exclude it from filtered results
      if (!category.faculty || !category.year || !category.term) return false;

      // Apply filters (null or "All" means no filter)
      if (faculty && faculty !== "All" && category.faculty !== faculty) {
        return false;
      }

      if (year && year !== "All" && category.year !== year) {
        return false;
      }

      if (term && term !== "All" && category.term !== term) {
        return false;
      }

      return true;
    })
    .map(([key, category]) => ({ key, ...category }));
}

/**
 * Get courses that match user's subscriptions
 */
export function getSubscribedCourses(categoryTree, subscribedCourseIds) {
  return Object.entries(categoryTree)
    .filter(([key, category]) => {
      // Only consider top-level categories (courses)
      if (category.parent) return false;

      // Check if this course is in the subscription list
      return category.id && subscribedCourseIds.includes(category.id);
    })
    .map(([key, category]) => ({ key, ...category }));
}

/**
 * Get all root courses (with or without metadata)
 */
export function getAllRootCourses(categoryTree) {
  return Object.entries(categoryTree)
    .filter(([key, category]) => !category.parent)
    .map(([key, category]) => ({ key, ...category }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check if a course matches the given filters
 */
export function courseMatchesFilters(course, filters) {
  const { faculty, year, term } = filters;

  if (!course.faculty || !course.year || !course.term) {
    return false;
  }

  if (faculty && faculty !== "All" && course.faculty !== faculty) {
    return false;
  }

  if (year && year !== "All" && course.year !== year) {
    return false;
  }

  if (term && term !== "All" && course.term !== term) {
    return false;
  }

  return true;
}

/**
 * Get count of items in a course (subcategories + exams)
 */
export function getCourseItemCount(course) {
  const subcatCount = course.subcategories ? course.subcategories.length : 0;
  const examCount = course.exams ? course.exams.length : 0;
  return subcatCount + examCount;
}

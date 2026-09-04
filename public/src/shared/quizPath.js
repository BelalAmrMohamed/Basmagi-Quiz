// public/src/shared/quizPath.js
// =============================================================================
// Shared quiz path parsing for manifest generation and API routes.
// =============================================================================

export const ROOT_MAP = {
  University: {
    education_type: "University",
    segments: ["college", "year", "term", "course"],
  },
  "Featured Courses": {
    education_type: "Featured",
    segments: ["course"],
  },
  "Primary-Schools": {
    education_type: "Primary",
    segments: ["year", "term", "course"],
  },
  "Primary School": {
    education_type: "Primary",
    segments: ["year", "term", "course"],
  },
  "Middle-Schools": {
    education_type: "Middle",
    segments: ["year", "term", "course"],
  },
  "Middle School": {
    education_type: "Middle",
    segments: ["year", "term", "course"],
  },
  "Secondary-Schools": {
    education_type: "High",
    segments: ["year", "term", "course"],
  },
  "High School": {
    education_type: "High",
    segments: ["year", "term", "course"],
  },
};

const VALID_EDUCATION_TYPES = new Set([
  "Primary",
  "Middle",
  "High",
  "University",
  "Featured",
]);

export function getRootFolder(education_type) {
  const map = {
    University: "University",
    Primary: "Primary School",
    Middle: "Middle School",
    High: "High School",
    Featured: "Featured Courses",
  };
  return map[education_type] || null;
}

export function buildDbPath({ education_type, college, year, term, subject, subfolder }) {
  const root = getRootFolder(education_type);
  if (!root) return null;
  const parts = [root];
  if (education_type === "University") {
    parts.push(college, String(year), String(term), subject);
  } else if (["Primary", "Middle", "High"].includes(education_type)) {
    parts.push(String(year), String(term), subject);
  } else if (education_type === "Featured") {
    parts.push(subject);
  }
  if (subfolder) parts.push(subfolder);
  return parts.filter(Boolean).map(p => p.trim()).join("/");
}

export function buildDbColumns(parsed) {
  if (!parsed) return null;
  const { education_type, college, year, course: subject, subfolders } = parsed;
  let category = "";
  if (education_type === "University") {
    category = college;
  } else if (["Primary", "Middle", "High"].includes(education_type)) {
    category = year;
  } else if (education_type === "Featured") {
    category = subject;
  }
  return {
    category,
    subject,
    subfolder: subfolders && subfolders.length ? subfolders.join("/") : null,
  };
}

export function validateTrackPath(education_type, fields) {
  const { college, year, term, subject } = fields;
  
  if (!subject || typeof subject !== "string" || !subject.trim()) {
    throw new Error("MISSING_PATH: subject is required");
  }

  if (education_type === "University") {
    if (!college || typeof college !== "string" || !college.trim()) {
      throw new Error("MISSING_PATH: college is required for University track");
    }
    if (year === undefined || year === null || year === "") {
      throw new Error("MISSING_PATH: year is required for University track");
    }
    if (!["1", "2"].includes(String(year))) {
      throw new Error("INVALID_PATH: year must be 1 or 2 for University");
    }
    if (term === undefined || term === null || term === "") {
      throw new Error("MISSING_PATH: term is required for University track");
    }
    if (!["1", "2"].includes(String(term))) {
      throw new Error("INVALID_PATH: term must be 1 or 2");
    }
  } else if (["Primary", "Middle", "High"].includes(education_type)) {
    if (year === undefined || year === null || year === "") {
      throw new Error("MISSING_PATH: year is required for school tracks");
    }
    if (term === undefined || term === null || term === "") {
      throw new Error("MISSING_PATH: term is required for school tracks");
    }
    if (!["1", "2"].includes(String(term))) {
      throw new Error("INVALID_PATH: term must be 1 or 2");
    }
  } else if (education_type === "Featured") {
    // only subject is required
  } else {
    throw new Error("INVALID_PATH: invalid education_type");
  }
}

export function isValidEducationType(type) {
  return VALID_EDUCATION_TYPES.has(type);
}

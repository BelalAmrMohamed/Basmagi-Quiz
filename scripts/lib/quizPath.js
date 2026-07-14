// scripts/lib/quizPath.js
// =============================================================================
// Shared quiz path parsing for manifest generation and API routes.
// =============================================================================

import { generateQuizId } from "./quizId.js";

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
  const { education_type, college, year, term, course: subject, subfolders } = parsed;
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
    college,
    year,
    term,
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

export function normalizeSlashes(p) {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function stripQuizzesPrefix(p) {
  const n = normalizeSlashes(p);
  return n.startsWith("quizzes/") ? n.slice("quizzes/".length) : n;
}

export function parseCanonicalPath(canonicalPath) {
  const withoutPrefix = stripQuizzesPrefix(canonicalPath);
  const lastSlash = withoutPrefix.lastIndexOf("/");
  if (lastSlash === -1) return null;

  const filename = withoutPrefix.slice(lastSlash + 1);
  const dirPart = withoutPrefix.slice(0, lastSlash);
  return parseDbPath(dirPart, filename);
}

export function parseDbPath(dbPath, filename = "") {
  const segments = normalizeSlashes(dbPath).split("/").filter(Boolean);
  if (!segments.length) return null;

  const rootFolder = segments[0];
  const config = ROOT_MAP[rootFolder];
  if (!config) return null;

  const rest = segments.slice(1);
  const { education_type, segments: labels } = config;

  const fields = {};
  for (let i = 0; i < labels.length; i++) {
    fields[labels[i]] = rest[i];
  }

  const course = fields.course;
  if (!course) return null;

  const subfolders = rest.slice(labels.length);

  return {
    education_type,
    rootFolder,
    college: fields.college,
    year: fields.year,
    term: fields.term,
    course,
    subfolders,
    filename: filename || undefined,
    dbPath: filename ? `${dbPath}/${filename}` : dbPath,
  };
}

export function buildCourseKey(parsed) {
  const parts = [parsed.rootFolder];
  if (parsed.college) parts.push(parsed.college);
  if (parsed.year) parts.push(parsed.year);
  if (parsed.term) parts.push(parsed.term);
  parts.push(parsed.course);
  return parts.join("/");
}

export function buildCourseRelDir(parsed) {
  return `quizzes/${buildCourseKey(parsed)}`;
}

export function buildSubjectManifestEntry(parsed, quizzes = []) {
  const courseRelDir = buildCourseRelDir(parsed);
  const entry = {
    id: generateQuizId(courseRelDir),
    name: parsed.course,
    education_type: parsed.education_type,
    quizzes,
  };

  if (parsed.education_type === "University" && parsed.college) {
    entry.faculty = parsed.college;
    if (parsed.year) entry.year = parseInt(parsed.year, 10);
    if (parsed.term) entry.term = parseInt(parsed.term, 10);
  } else if (["Primary", "Middle", "High"].includes(parsed.education_type)) {
    if (parsed.year) entry.year = parseInt(parsed.year, 10);
    if (parsed.term) entry.term = parseInt(parsed.term, 10);
  }

  return entry;
}

export function extractFolderSegmentsFromQuizPath(rawPath) {
  let pathStr = rawPath;

  try {
    const qIdx = pathStr.indexOf("?");
    if (qIdx !== -1) {
      const params = new URLSearchParams(pathStr.slice(qIdx + 1));
      const pathParam = params.get("path");
      if (pathParam) pathStr = decodeURIComponent(pathParam);
    }
  } catch {
    /* ignore */
  }

  pathStr = pathStr.replace(/^\/data\//, "quizzes/");

  const canonical = stripQuizzesPrefix(pathStr);
  const lastSlash = canonical.lastIndexOf("/");
  if (lastSlash === -1) return { education_type: null, folderSegments: [] };

  const dirPart = canonical.slice(0, lastSlash);
  const parsed = parseDbPath(dirPart);
  if (!parsed) return { education_type: null, folderSegments: [] };

  return {
    education_type: parsed.education_type,
    folderSegments: parsed.subfolders,
  };
}

export function isValidEducationType(type) {
  return VALID_EDUCATION_TYPES.has(type);
}

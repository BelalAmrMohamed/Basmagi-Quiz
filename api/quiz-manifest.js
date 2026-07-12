// =============================================================================
// api/quiz-manifest.js
// Public endpoint — returns all DB-hosted quizzes shaped like quiz-manifest.json
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { applyCors } from "./_middleware.js";
// import { generateQuizId } from "../scripts/lib/quizId.js";
// import {
//   parseDbPath,
//   buildCourseKey,
//   buildSubjectManifestEntry,
// } from "../scripts/lib/quizPath.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const { data, error } = await supabase
    .from("quizzes")
    .select(
      "path, filename, title, category, subject, subfolder, data, education_type, password",
    )
    .order("category", { ascending: true });

  if (error) {
    console.error("[quiz-manifest] Supabase error:", error.message);
    return res.status(500).json({ error: "فشل تحميل الاختبارات" });
  }

  const subjectsMap = new Map();

  for (const row of data) {
    let rawPath = row.path;
    let parsed = parseDbPath(rawPath, row.filename);
    
    if (!parsed) {
      if (row.education_type === 'University') {
        console.warn(`[quiz-manifest] Unrecognized path: ${row.path}, attempting legacy University fallback`);
        rawPath = `University/${row.path}`;
        parsed = parseDbPath(rawPath, row.filename);
      }
      
      if (!parsed) {
        console.warn(`[quiz-manifest] Unrecognized path: ${row.path}`);
        continue;
      }
    }

    const education_type = row.education_type || parsed.education_type;
    parsed.education_type = education_type;

    const courseKey = buildCourseKey(parsed);

    if (!subjectsMap.has(courseKey)) {
      subjectsMap.set(
        courseKey,
        buildSubjectManifestEntry(parsed, []),
      );
    }

    const subjectEntry = subjectsMap.get(courseKey);
    const examRelPath = `quizzes/${row.path}/${row.filename}`;
    const examFetchPath = `/api/quiz-data?path=${encodeURIComponent(examRelPath)}`;

    const quizMeta = row.data?.meta || {};
    const quizStats = row.data?.stats || {};

    const quizEntry = {
      id: quizMeta.id || generateQuizId(examRelPath),
      title: quizMeta.title || row.title,
      path: examFetchPath,
      questionCount: quizStats.questionCount ?? 0,
      questionTypes: quizStats.questionTypes ?? [],
      education_type,
      dbSource: "db",
    };

    if (quizMeta.description) quizEntry.description = quizMeta.description;
    if (quizMeta.author) quizEntry.author = quizMeta.author;
    if (quizMeta.author_email) quizEntry.author_email = quizMeta.author_email;
    if (row.password) quizEntry.password = row.password;

    //  This might be wrong, it might be `dbSource`, but I don't know, insure it's correct.
    if (quizMeta.source) quizEntry.source = quizMeta.source;
    if (quizMeta.createdAt) quizEntry.createdAt = quizMeta.createdAt;

    subjectEntry.quizzes.push(quizEntry);
  }

  const subjects = Array.from(subjectsMap.values());

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=300",
  );

  return res.status(200).json({ subjects });
}


// Pasted from scripts/lib/quizId.js
// =============================================================================
// Shared deterministic 8-char Base32 ID generator.
// =============================================================================

function generateQuizId(relativePath) {
  const hash = crypto.createHash("sha256").update(relativePath).digest();
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += CHARSET[hash[i] % CHARSET.length];
  }
  return id;
}

// Pasted from scripts/lib/quizPath.js
// =============================================================================
// Shared quiz path parsing for manifest generation and API routes.
// =============================================================================

const ROOT_MAP = {
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

function getRootFolder(education_type) {
  const map = {
    University: "University",
    Primary: "Primary School",
    Middle: "Middle School",
    High: "High School",
    Featured: "Featured Courses",
  };
  return map[education_type] || null;
}

function buildDbPath({ education_type, college, year, term, subject, subfolder }) {
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

function buildDbColumns(parsed) {
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

function validateTrackPath(education_type, fields) {
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

function normalizeSlashes(p) {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

function stripQuizzesPrefix(p) {
  const n = normalizeSlashes(p);
  return n.startsWith("quizzes/") ? n.slice("quizzes/".length) : n;
}

function parseCanonicalPath(canonicalPath) {
  const withoutPrefix = stripQuizzesPrefix(canonicalPath);
  const lastSlash = withoutPrefix.lastIndexOf("/");
  if (lastSlash === -1) return null;

  const filename = withoutPrefix.slice(lastSlash + 1);
  const dirPart = withoutPrefix.slice(0, lastSlash);
  return parseDbPath(dirPart, filename);
}

function parseDbPath(dbPath, filename = "") {
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

function buildCourseKey(parsed) {
  const parts = [parsed.rootFolder];
  if (parsed.college) parts.push(parsed.college);
  if (parsed.year) parts.push(parsed.year);
  if (parsed.term) parts.push(parsed.term);
  parts.push(parsed.course);
  return parts.join("/");
}

function buildCourseRelDir(parsed) {
  return `quizzes/${buildCourseKey(parsed)}`;
}

function buildSubjectManifestEntry(parsed, quizzes = []) {
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

function extractFolderSegmentsFromQuizPath(rawPath) {
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

function isValidEducationType(type) {
  return VALID_EDUCATION_TYPES.has(type);
}

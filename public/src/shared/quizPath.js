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
    throw new Error("اسم المادة مطلوب. اختر مادة قبل الرفع.");
  }

  if (education_type === "University") {
    if (!college || typeof college !== "string" || !college.trim()) {
      throw new Error("اختر الكلية التي سيتم رفع المادة إليها.");
    }
    if (year === undefined || year === null || year === "") {
      throw new Error("اختر السنة الدراسية التي سيتم رفع المادة إليها.");
    }
    if (!/^\d+$/.test(String(year)) || Number(year) < 1 || Number(year) > 12) {
      throw new Error("السنة الدراسية غير صالحة. اختر رقمًا صحيحًا من 1 إلى 12.");
    }
    if (term === undefined || term === null || term === "") {
      throw new Error("اختر الترم الدراسي الذي سيتم رفع المادة إليه.");
    }
    if (!/^\d+$/.test(String(term)) || Number(term) < 1 || Number(term) > 4) {
      throw new Error("الترم الدراسي غير صالح. اختر رقمًا من 1 إلى 4 حسب إعدادات الكلية.");
    }
  } else if (["Primary", "Middle", "High"].includes(education_type)) {
    if (year === undefined || year === null || year === "") {
      throw new Error("اختر السنة الدراسية التي سيتم رفع المادة إليها.");
    }
    if (term === undefined || term === null || term === "") {
      throw new Error("اختر الترم الدراسي الذي سيتم رفع المادة إليه.");
    }
    if (!["1", "2"].includes(String(term))) {
      throw new Error("الترم الدراسي غير صالح. اختر الترم الأول أو الترم الثاني.");
    }
  } else if (education_type === "Featured") {
    // only subject is required
  } else {
    throw new Error("نوع المسار التعليمي غير صالح. اختر مسارًا تعليميًا من القائمة.");
  }
}

export function isValidEducationType(type) {
  return VALID_EDUCATION_TYPES.has(type);
}

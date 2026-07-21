// ============================================================================
// SUBJECT ICON UTILITY — keyword-based emoji assignment
// ============================================================================

export const SUBJECT_ICON_MAP = [
  {
    keywords: [
      "math",
      "calculus",
      "algebra",
      "statistics",
      "probability",
      "رياضيات",
      "احصاء",
      "احتمالات",
      "جبر",
      "تفاضل",
      "تكامل",
      "إحصاء",
    ],
    icon: "🎲",
  },
  {
    keywords: ["physics", "فيزياء", "ميكانيكا", "كهرباء"],
    icon: "⚛️",
  },
  {
    keywords: ["chemistry", "كيمياء"],
    icon: "🧪",
  },
  {
    keywords: [
      "programming",
      "code",
      "software",
      "python",
      "java",
      "c++",
      "برمجة",
      "خوارزميات",
      "algorithms",
      "object",
      "oop",
    ],
    icon: "💻",
  },
  {
    keywords: ["database", "sql", "قواعد بيانات", "بيانات"],
    icon: "🗄️",
  },
  {
    keywords: ["network", "شبكات", "networking", "tcp", "ip"],
    icon: "🌐",
  },
  {
    keywords: [
      "artificial intelligence",
      "machine learning",
      "deep learning",
      "ذكاء اصطناعي",
      "تعلم آلي",
      "تعلم عميق",
      "ai",
      "ml",
    ],
    icon: "🤖",
  },
  {
    keywords: ["security", "أمن", "cybersecurity", "cryptography", "تشفير"],
    icon: "🔒",
  },
  {
    keywords: [
      "operating system",
      "os",
      "نظم تشغيل",
      "linux",
      "windows",
      "unix",
    ],
    icon: "⚙️",
  },
  {
    keywords: [
      "digital",
      "circuit",
      "hardware",
      "دوائر",
      "رقمي",
      "إلكترونيات",
      "electronics",
      "logic",
    ],
    icon: "🔌",
  },
  {
    keywords: ["english", "language", "انجليزي", "لغة", "grammar"],
    icon: "🗣️",
  },
  {
    keywords: [
      "data structure",
      "هياكل بيانات",
      "linked list",
      "tree",
      "graph",
    ],
    icon: "🌲",
  },
  {
    keywords: ["web", "html", "css", "javascript", "frontend", "backend"],
    icon: "🕸️",
  },
  {
    keywords: ["mobile", "android", "ios", "flutter", "موبايل"],
    icon: "📱",
  },
  {
    keywords: [
      "computer graphics",
      "رسومات",
      "graphics",
      "image processing",
      "معالجة صور",
    ],
    icon: "🎨",
  },
  {
    keywords: ["computer", "حاسبات", "information", "معلومات"],
    icon: "🖥️",
  },
];

/**
 * Returns an emoji icon based on the subject/course name.
 * @param {string} name - The name of the subject or folder
 * @param {boolean} isSubfolder - True if this is a subfolder inside a course
 * @returns {string} emoji
 */
export function getSubjectIcon(name, isSubfolder = false) {
  if (isSubfolder) return "📁"; // Subfolders always get a folder icon

  const lower = (name || "").toLowerCase();
  for (const entry of SUBJECT_ICON_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.icon;
    }
  }
  return "📚"; // Default for root categories with no keyword match
}

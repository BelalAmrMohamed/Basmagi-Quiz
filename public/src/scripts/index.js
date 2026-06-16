// ============================================================================
// src/scripts/index.js - Enhanced with Security, Performance, and Accessibility
// All original functionality preserved + improvements added
// ============================================================================

import { getManifest } from "./quizManifest.js";
import { userProfile } from "./userProfile.js";
import { SearchManager } from "./search-manager.js";
import {
  extractTextFromFile,
  parseImportContent,
  buildJsonQuizExport,
} from "../shared/quiz-processor.js";

let categoryTree = null;
let searchManager = null;

// Download functions
import { exportToQuiz } from "../export/export-to-quiz.js";
import { exportToHtml } from "../export/export-to-html.js";
import { exportToPdf } from "../export/export-to-pdf.js";
import { exportToWord } from "../export/export-to-word.js";
import { exportToPptx } from "../export/export-to-pptx.js";
import { exportToMarkdown } from "../export/export-to-markdown.js";
import { buildQuizText } from "../export/export-to-text.js";
import { createUploadButton } from "./adminUpload.js";
import { isAdminAuthenticated, hasAdminSessionHint } from "./adminAuth.js";

// Helper utilities
import { getSubscribedCourses } from "../shared/filterUtils.js";
import { getFromStorage, setInStorage } from "../shared/storage-helpers.js";

// PWA — SW registration + offline banner.
// initPWA() must run on every page (not just index), so it is called before
// the isIndexPage guard in DOMContentLoaded below.  Because index.js is
// imported by side-menu.js (which loads on every page), placing the call
// here means we don't need a separate <script type="module"> bootstrap in
// each HTML file.
import { initPWA } from "./pwa-manager.js";

// AI Prompt for converting files to JSON quiz format
const General_Purpose_AI_Prompt = `You are an educational content specialist with extensive expertise in converting diverse quiz formats into structured JSON arrays compatible with advanced e-learning platforms. Your task is to accurately transform quizzes provided in PDF, Word, PPTX, or plain text formats into a JSON structure strictly adhering to the platform’s quiz schema, which supports full markdown, tables, code blocks, LaTeX math notation, and both multiple-choice and essay question types.

Please ensure the following:
- Preserve the original wording of all questions without rephrasing to maintain content integrity. But use math notations and tables when needed properly.
- Identify and supply correct answers for any unsolved or incomplete questions using authoritative sources or logical deduction.
- Output only the finalized JSON array without any additional text or commentary.

Output ONLY the JSON in the following format:
\`\`\`json
{
  "questions": [
    {
      "q": "If $A$ and $B$ are independent events, which pairs are also independent?\\n\\n| Pair | Independent? |\\n|---|---|\\n| $A$ and $B^c$ | ? |\\n| $A^c$ and $B^c$ | ? |",
      "options": [
        "First pair only",
        "Second pair only",
        "Neither",
        "Both"
      ],
      "correct": 3,
      "explanation": "Independence is preserved under complements: $P(A \\\\cap B^c) = P(A) \\\\times P(B^c)$ holds, and so does $P(A^c \\\\cap B^c) = P(A^c) \\\\times P(B^c)$."
    },
    {
      "q": "In C++, a \`const\` member function can modify a \`mutable\` data member.",
      "options": ["True", "False"],
      "correct": 0,
      "explanation": "The \`mutable\` keyword opts a member out of the \`const\` contract:\\n\`\`\`cpp\\nmutable int cache_ = 0;\\nvoid update() const { cache_++; } // legal\\n\`\`\`"
    },
    {
      "q": "Using the power rule, find $f'(x)$ for $f(x) = x^n$.",
      "answer": "$$f'(x) = n \\\\times x^{n-1}$$\\n\\n| $f(x)$ | $f'(x)$ |\\n|---|---|\\n| $x^3$ | $3 \\\\times x^2$ |\\n| $x^{1/2}$ | $\\\\frac{1}{2} \\\\times x^{-1/2}$ |",
      "explanation": "Bring the exponent down and reduce it by one: $f'(x) = n $\\\\times$ x^{n-1}$."
    }
  ]
}
\`\`\`


`;

// Specialized English AI Prompt for language-focused quizzes
const English_Specializing_Prompt = `You are an expert English language educator specializing in creating comprehensive assessment quizzes. Your task is to convert English language learning materials into structured JSON quiz arrays compatible with our e-learning platform. The platform supports full Markdown, tables, code blocks, LaTeX notation, audio and video references, paragraph contexts, and the language-specific field 'lang'.
Please ensure the following:
- Preserve exact wording from original materials for language precision
- Add pronunciation guides or phonetic notation for difficult words
- Include contextual usage examples and common collocations
- Output only the finalized JSON array without additional commentary
- The "correct" object can store a 0-based integer for the correct option, or an array of integers if there are multiple correct options. 

Output ONLY the JSON in the following format:
\`\`\`json
{
  "questions": [
    {
      "q": "Choose the correct form: 'She ___ to the gym every Monday.'",
      "options": ["goes", "go", "went", "is going"],
      "correct": 0,
      "audio": "https://example.com/audio/present-simple.mp3",
      "explanation": "Present simple is used for habitual actions. Third person singular takes 'goes'.",
      "lang": "en"
    },
    {
      "passage": "Read the following passage and answer the question below:\\n\\n\\"Despite the heavy rain, the match continued as scheduled. The players were drenched but determined to finish the game. Spectators huddled under umbrellas, cheering loudly.\\"",
      "q": "What is the meaning of the phrasal verb 'put up with'? Select the synonym.",
      "options": ["tolerate", "delay", "construct", "display"],
      "video": "https://example.com/video/present-simple.mp4",
      "correct": 0,
      "explanation": "'Put up with' means to tolerate or endure something unpleasant. Common in British English.",
      "lang": "en"
    },
    {
      "q": "My __ brother's wife is Sara - she is my aunt.",
      "answer": "maternal",
      "explanation": "We need the possessive form of 'dad'. The possessive is formed by adding apostrophe + s: dad's.",
      "lang": "en"
    }
  ]
}
\`\`\`
`;

// Specialized Math AI Prompt for mathematics and problem-solving quizzes
const Math_Specializing_Prompt = `You are an advanced mathematics educator and assessment specialist with deep expertise in creating rigorous mathematical quizzes. Your task is to convert mathematical content into structured JSON quiz arrays for our e-learning platform. The platform fully supports LaTeX math notation (both inline and display), tables, code blocks for algorithms, markdown formatting, and multiple question types.

Please ensure the following:
- Preserve mathematical accuracy and original problem wording
- Use proper LaTeX notation for all mathematical expressions (wrap in \\$ for inline, \\$\\$ for display)
- Include step-by-step explanations using mathematical notation
- Provide derivations and proofs where applicable
- Include relevant formulas in explanation tables
- Distinguish between computational and conceptual questions
- Mark conceptual difficulty appropriately
- Output only the finalized JSON array without additional text

Output ONLY the JSON in the following format:
\`\`\`json
{
  "questions": [
    {
      "q": "Calculate the limit: $$\\\\lim_{x \\\\to 0} \\\\frac{\\\\sin(x)}{x}$$",
      "options": ["0", "1", "∞", "undefined"],
      "correct": 1,
      "explanation": "This is a fundamental limit in calculus. Using L'Hôpital's rule or Taylor series: $$\\\\sin(x) \\\\approx x - \\\\frac{x^3}{6} + ...$$ Thus $$\\\\lim_{x \\\\to 0} \\\\frac{\\\\sin(x)}{x} = 1$$"
    },
    {
      "q": "Solve the differential equation: $\\\\frac{dy}{dx} + 2y = e^{-x}$",
      "answer": "Solution: $y = e^{-x}(x + C)$ where $C$ is an arbitrary constant.\\n\\nMethod: This is a first-order linear ODE. Using integrating factor $\\\\mu(x) = e^{2x}$:\\n$$e^{2x}\\\\frac{dy}{dx} + 2e^{2x}y = e^{x}$$\\n$$\\\\frac{d}{dx}[e^{2x}y] = e^{x}$$\\n$$e^{2x}y = e^{x} + C$$\\n$$y = e^{-x}(e^{x} + C) = e^{-x}(x + C)$$",
      "explanation": "Integrating factor method transforms the ODE into an exact differential form."
    },
    {
      "q": "Compute the eigenvalues of matrix $A = \\\\begin{pmatrix} 4 & 2 \\\\ 1 & 3 \\\\end{pmatrix}$",
      "options": ["λ₁ = 2, λ₂ = 5", "λ₁ = 1, λ₂ = 6", "λ₁ = 3, λ₂ = 4", "λ₁ = 2, λ₂ = 3"],
      "correct": 0,
      "explanation": "The characteristic polynomial is $\\\\det(A - \\\\lambda I) = (4-\\\\lambda)(3-\\\\lambda) - 2 = \\\\lambda^2 - 7\\\\lambda + 10 = (\\\\lambda - 2)(\\\\lambda - 5) = 0$. Thus $\\\\lambda_1 = 2, \\\\lambda_2 = 5$."
    }
  ]
}
\`\`\`
`;

/**
 * Recursively count only the actual quiz/exam leaves under a category node.
 * Subfolders are never counted as quizzes themselves — we recurse into them.
 *
 * Example:
 *   Course (3 exams) + SubA (4 exams) + SubB (4 exams)  →  11  (not 5)
 *
 * NOTE: `categoryTree` is a module-level variable populated by initApp(),
 * so it is always available by the time any card is rendered.
 */
function getCourseItemCount(category) {
  if (!category) return 0;

  // Direct exams on this node
  let count = Array.isArray(category.exams) ? category.exams.length : 0;

  // Recurse into sub-categories — add their quiz counts, NOT +1 per folder
  if (Array.isArray(category.subcategories)) {
    for (const subKey of category.subcategories) {
      const sub = categoryTree?.[subKey];
      if (sub) count += getCourseItemCount(sub);
    }
  }

  return count;
}

function formatArabicQuestionCount(count) {
  if (!count || count === 0) return "لا أسئلة";
  if (count === 1) return "سؤال واحد";
  if (count === 2) return "سؤالين";
  if (count >= 3 && count <= 10) return `${count} أسئلة`;
  return `${count} سؤال`;
}

// ============================================================================
// URL SLUG UTILITIES
// Literal hyphens in names are double-encoded as "--" so they survive a
// round-trip:  "Unit 1-A"  →  "Unit-1--A"  →  "Unit 1-A"
// ============================================================================

/**
 * Convert a display name to a URL slug.
 * Spaces → single "-"; existing literal hyphens → "--"
 */
function toSlug(str) {
  return str.trim().replace(/-/g, "--").replace(/\s+/g, "-");
}

/**
 * Reverse toSlug: single "-" → space; "--" → literal "-"
 */
function fromSlug(slug) {
  // Split on "--" first (literal hyphens), then replace single "-" with space
  return slug
    .split("--")
    .map((part) => part.replace(/-/g, " "))
    .join("-");
}

// ============================================================================
// SUBJECT ICON UTILITY — keyword-based emoji assignment
// ============================================================================

const SUBJECT_ICON_MAP = [
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
function getSubjectIcon(name, isSubfolder = false) {
  if (isSubfolder) return "📁"; // Subfolders always get a folder icon

  const lower = (name || "").toLowerCase();
  for (const entry of SUBJECT_ICON_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.icon;
    }
  }
  return "📚"; // Default for root categories with no keyword match
}

// Notifications
import {
  showNotification,
  confirmationNotification,
} from "../components/notifications.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const container = document.getElementById("contentArea");
const title = document.getElementById("Subjects-text");
const breadcrumb = document.getElementById("breadcrumb");

// ============================================================================
// USER PERSONALIZATION & GAMIFIED WELCOME SYSTEM
// ============================================================================

const userNameBadge = document.getElementById("user-name");

// Gamified welcome message pool
const welcomeMessages = [
  (name) => `👑 الأسطورة رجع في ثواني ${name}.. عشان يقفل المادة من تاني!`,
  (name) => `🔥 رجعتك قوية ${name}.. وعينك على الدرجة النهائية!`,
  (name) => `💡 المخ شغال ${name}.. والحل النهاردة عال العال!`,
  (name) => `💪 وحش إمتحانات ${name}.. داخل يلم الدرجات!`,
  (name) => `📈 خطوة جديدة ${name}.. لدرجة حلوة وأكيدة!`,
  (name) => `🌟 كبير المجال ${name}.. داخل يحل ويروق البال!`,
  (name) => `🌟 منور الشاشة ${name}.. داخل تقفل المادة يا باشا!`,
];

/**
 * Get random welcome message
 */
function getRandomWelcomeMessage(name) {
  const escapedName = escapeHtml(name);
  const message =
    welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
  return message(escapedName);
}

/**
 * Update welcome badge text
 */
export function updateWelcomeMessage() {
  try {
    const name = getFromStorage("username", "User");
    const messageTemplate = getRandomWelcomeMessage(name);

    // Replace username with styled span
    const styledMessage = messageTemplate.replace(
      escapeHtml(name),
      `<span class="user-name">${escapeHtml(name)}</span>`,
    );

    if (userNameBadge) {
      userNameBadge.innerHTML = styledMessage;
      userNameBadge.setAttribute("aria-label", `تغيير اسم المستخدم: ${name}`);
      userNameBadge.setAttribute(
        "title",
        `اضغط لتغيير اسم المستخدم: [${name}]`,
      );
    }
  } catch (error) {
    console.error("Error updating welcome message:", error);
  }
}

// ============================================================================
// NAVIGATION & RENDERING
// ============================================================================

let navigationStack = [];
let categoriesCache = null;
// ── Bug 1 Fix: guard flag — when true, renderCategory / renderUserQuizzesView
// must NOT call history.pushState (we are replaying an existing history entry
// via popstate and must not create a new forward entry).
let _isRestoringState = false;

function getCategoriesLazy() {
  if (categoriesCache) return categoriesCache;

  categoriesCache = Object.values(categoryTree || {})
    .filter((cat) => !cat.parent)
    .sort((a, b) => a.name.localeCompare(b.name));

  return categoriesCache;
}

// Initialize after manifest is loaded (called from DOMContentLoaded)
async function initApp() {
  let hasVisited = true;
  try {
    hasVisited = !!localStorage.getItem("first_visit_complete");
  } catch (e) {
    console.error("Error checking first-visit state:", e);
  }

  // ── 1. Leave skeleton visible; just mark aria state ───────────────────────
  // The skeleton HTML in index.html is shown while we wait for the manifest.
  // Do NOT clear container.innerHTML here — that would hide the skeleton.
  if (container) {
    container.setAttribute("aria-busy", "true");
  }

  // ── 2. Fetch manifest asynchronously, then render all categories ─────────
  try {
    const manifest = await getManifest();
    categoryTree = manifest.categoryTree;
    initializeSearchManager();
  } catch (err) {
    console.error("Failed to load quiz manifest:", err);
    categoryTree = {};
  }

  // ── If first-time visitor, show landing layout instead of default content
  if (!hasVisited) {
    renderLandingScreen();
    return; // Wait for user decision
  }

  finalizeAppRender();
}

function finalizeAppRender() {
  // ── 3. Full render now that manifest is ready ────────────────────────────
  try {
    // ── Bug 1 Fix: Stamp initial history entry ──────────────────────────────
    // Replace the browser's synthetic state-less entry with one that carries a
    // proper state object.  This guarantees that popstate fires (with non-null
    // event.state) if/when the user navigates forward and then returns here.
    history.replaceState({ view: "initial" }, "", window.location.href);

    // ── Restore the view indicated by the current URL ───────────────────────
    // _isRestoringState suppresses pushState inside renderCategory /
    // renderUserQuizzesView so we don't create a phantom forward entry on
    // the very first load.
    _isRestoringState = true;
    try {
      restoreViewFromURL();
    } finally {
      _isRestoringState = false;
    }
  } catch (error) {
    console.error("Error in initApp render phase:", error);
    renderRootCategories(); // retry once
  }
}

function renderLandingScreen() {
  if (!container) return;
  container.setAttribute("aria-busy", "false");
  container.innerHTML = "";

  // ── Inject scoped styles + keyframes ────────────────────────────────────
  const styleId = "landing-screen-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      /* ── Full-viewport overlay ─────────────────────────────────────────── */
      .landing-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--z-overlay, 4000);
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        animation: landingFadeIn 0.5s ease both;
        padding: 20px;
      }

      /* ── Particle canvas behind the card ───────────────────────────────── */
      .landing-particles {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 0;
      }

      /* ── Glassmorphism card ────────────────────────────────────────────── */
      .landing-card {
        position: relative;
        z-index: 1;
        width: 100%;
        max-width: 480px;
        border-radius: var(--radius-2xl, 24px);
        padding: 44px 36px 36px;
        text-align: center;
        direction: rtl;

        background: var(--glass-bg-light, rgba(255,255,255,0.65));
        backdrop-filter: var(--glass-blur, blur(12px));
        -webkit-backdrop-filter: var(--glass-blur, blur(12px));
        border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
        box-shadow:
          var(--shadow-xl),
          0 0 60px rgba(99,102,241,0.12),
          var(--glass-inset, inset 0 1px 0 rgba(255,255,255,0.1));

        animation: landingCardPop 0.6s 0.15s cubic-bezier(0.175,0.885,0.32,1.275) both;
        overflow: hidden;
      }

      /* Gradient border ring via pseudo-element */
      .landing-card::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 2px;
        background: var(--gradient-accent);
        -webkit-mask:
          linear-gradient(#fff 0 0) content-box,
          linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask:
          linear-gradient(#fff 0 0) content-box,
          linear-gradient(#fff 0 0);
        mask-composite: exclude;
        pointer-events: none;
        z-index: 0;
      }

      /* Soft radial glow behind the emoji */
      .landing-card::after {
        content: "";
        position: absolute;
        top: -30px;
        left: 50%;
        transform: translateX(-50%);
        width: 220px;
        height: 140px;
        background: radial-gradient(ellipse at center, rgba(99,102,241,0.12) 0%, transparent 70%);
        pointer-events: none;
        z-index: 0;
      }

      /* ── Animated welcome emoji ────────────────────────────────────────── */
      .landing-emoji {
        position: relative;
        z-index: 1;
        font-size: 3.5rem;
        line-height: 1;
        margin-bottom: 8px;
        display: inline-block;
        animation: landingEmojiBounce 2s ease-in-out infinite;
        filter: drop-shadow(0 4px 12px rgba(99,102,241,0.25));
      }

      /* ── Title ─────────────────────────────────────────────────────────── */
      .landing-title {
        position: relative;
        z-index: 1;
        font-family: "Tajawal", "IBM Plex Sans Arabic", sans-serif;
        font-size: var(--font-size-2xl, 1.5rem);
        font-weight: 800;
        color: var(--color-text-primary);
        margin-bottom: 6px;
        letter-spacing: -0.02em;
        line-height: 1.3;
        animation: landingSlideUp 0.5s 0.3s ease both;
      }

      /* ── Subtitle ──────────────────────────────────────────────────────── */
      .landing-subtitle {
        position: relative;
        z-index: 1;
        font-size: var(--font-size-sm, 0.875rem);
        font-weight: 500;
        color: var(--color-text-secondary);
        margin-bottom: 28px;
        line-height: 1.6;
        animation: landingSlideUp 0.5s 0.4s ease both;
      }

      /* ── Feature pills row ─────────────────────────────────────────────── */
      .landing-features {
        position: relative;
        z-index: 1;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        margin-bottom: 28px;
        animation: landingSlideUp 0.5s 0.5s ease both;
      }
      .landing-feature-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 14px;
        border-radius: var(--radius-full, 9999px);
        font-size: 0.78rem;
        font-weight: 600;
        background: rgba(99,102,241,0.08);
        color: var(--color-accent, #6366f1);
        border: 1px solid rgba(99,102,241,0.15);
        white-space: nowrap;
      }

      /* ── Button area ───────────────────────────────────────────────────── */
      .landing-actions {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 12px;
        animation: landingSlideUp 0.5s 0.55s ease both;
      }

      /* Primary CTA */
      .landing-btn-primary {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 15px 28px;
        border: none;
        border-radius: var(--radius-lg, 12px);
        font-family: inherit;
        font-size: 1rem;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
        background: var(--gradient-accent);
        background-size: 200% 200%;
        box-shadow:
          0 4px 15px rgba(99,102,241,0.35),
          inset 0 1px 0 rgba(255,255,255,0.2);
        transition: transform 0.25s var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)),
                    box-shadow 0.25s ease;
        overflow: hidden;
      }
      .landing-btn-primary:hover {
        transform: translateY(-2px) scale(1.02);
        box-shadow:
          0 8px 25px rgba(99,102,241,0.45),
          inset 0 1px 0 rgba(255,255,255,0.25);
      }
      .landing-btn-primary:active {
        transform: translateY(0) scale(0.98);
      }

      /* Shimmer sweep on the primary button */
      .landing-btn-primary::after {
        content: "";
        position: absolute;
        top: 0;
        left: -100%;
        width: 60%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255,255,255,0.25) 50%,
          transparent 100%
        );
        animation: landingBtnShimmer 3s 1s ease-in-out infinite;
        pointer-events: none;
      }

      /* Secondary / Skip */
      .landing-btn-secondary {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 28px;
        border: 1.5px solid var(--color-border, #e5e7eb);
        border-radius: var(--radius-lg, 12px);
        background: transparent;
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all 0.25s ease;
      }
      .landing-btn-secondary:hover {
        border-color: var(--color-primary, #6366f1);
        color: var(--color-primary, #6366f1);
        background: var(--color-hover-overlay, rgba(99,102,241,0.06));
      }

      /* ── Keyframes ─────────────────────────────────────────────────────── */
      @keyframes landingFadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes landingCardPop {
        from {
          opacity: 0;
          transform: translateY(30px) scale(0.92);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      @keyframes landingSlideUp {
        from {
          opacity: 0;
          transform: translateY(16px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @keyframes landingEmojiBounce {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        25%      { transform: translateY(-8px) rotate(-4deg); }
        50%      { transform: translateY(0) rotate(0deg); }
        75%      { transform: translateY(-4px) rotate(3deg); }
      }
      @keyframes landingBtnShimmer {
        0%   { left: -100%; }
        40%  { left: 120%; }
        100% { left: -100%; }
      }

      /* ── Responsive ────────────────────────────────────────────────────── */
      @media (max-width: 520px) {
        .landing-card {
          padding: 32px 22px 28px;
          max-width: 100%;
          border-radius: var(--radius-xl, 16px);
        }
        .landing-emoji { font-size: 2.8rem; }
        .landing-title { font-size: var(--font-size-xl, 1.25rem); }
        .landing-subtitle { font-size: 0.82rem; }
        .landing-btn-primary { font-size: 0.92rem; padding: 13px 20px; }
        .landing-btn-secondary { font-size: 0.82rem; padding: 10px 18px; }
        .landing-feature-pill { font-size: 0.72rem; padding: 4px 10px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build overlay DOM ──────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.className = "landing-overlay";
  overlay.id = "landingOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "شاشة الترحيب");

  // Particle canvas
  const particleCanvas = document.createElement("canvas");
  particleCanvas.className = "landing-particles";
  overlay.appendChild(particleCanvas);

  // Card
  const card = document.createElement("div");
  card.className = "landing-card";

  // Emoji
  const emoji = document.createElement("div");
  emoji.className = "landing-emoji";
  emoji.setAttribute("aria-hidden", "true");
  emoji.textContent = "🎓";

  // Title
  const titleEl = document.createElement("h2");
  titleEl.className = "landing-title";
  titleEl.textContent = "أهلاً بيك في منصة إمتحانات بصمجي!";

  // Subtitle
  const subtitleEl = document.createElement("p");
  subtitleEl.className = "landing-subtitle";
  subtitleEl.textContent =
    "منصة مجانية بالكامل — إختبر نفسك في مواد الكلية وجهّز نفسك للإمتحان.";

  // Feature pills
  const features = document.createElement("div");
  features.className = "landing-features";
  const featureItems = [
    { icon: "📚", text: "مكتبة إمتحانات شاملة" },
    { icon: "⚡", text: "بدون تسجيل دخول" },
    { icon: "🏆", text: "تتبع تقدمك" },
  ];
  featureItems.forEach(({ icon, text }) => {
    const pill = document.createElement("span");
    pill.className = "landing-feature-pill";
    pill.textContent = `${icon} ${text}`;
    features.appendChild(pill);
  });

  // Buttons
  const actions = document.createElement("div");
  actions.className = "landing-actions";

  const primaryBtn = document.createElement("button");
  primaryBtn.className = "landing-btn-primary";
  primaryBtn.id = "landingStartBtn";
  primaryBtn.innerHTML = `<span>🚀</span><span>مستعد للبدأ؟ قم بإعداد حسابك بدون إيميل</span>`;
  primaryBtn.onclick = () => {
    if (window.location.hash) {
      sessionStorage.setItem("intended_redirect_hash", window.location.hash);
    }
    window.location.href = "onboarding.html";
  };

  const secondaryBtn = document.createElement("button");
  secondaryBtn.className = "landing-btn-secondary";
  secondaryBtn.id = "landingSkipBtn";
  secondaryBtn.innerHTML = `<span>تخطي</span><span style="font-size:1.1em">←</span>`;
  secondaryBtn.onclick = () => {
    localStorage.setItem("first_visit_complete", "true");
    // Animate out
    overlay.style.transition = "opacity 0.35s ease";
    overlay.style.opacity = "0";
    setTimeout(() => {
      overlay.remove();
      finalizeAppRender();
    }, 350);
  };

  actions.appendChild(primaryBtn);
  actions.appendChild(secondaryBtn);

  card.appendChild(emoji);
  card.appendChild(titleEl);
  card.appendChild(subtitleEl);
  card.appendChild(features);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ── Confetti / sparkle particle system ─────────────────────────────────
  requestAnimationFrame(() => {
    initLandingParticles(particleCanvas);
  });

  // Focus trap — focus the primary button
  primaryBtn.focus();
}

/**
 * Lightweight confetti-like particle system for the landing overlay.
 * Draws small shapes (circles, stars, diamonds) that float & drift.
 */
function initLandingParticles(canvas) {
  if (!canvas || !canvas.parentElement) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const resize = () => {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  };
  resize();
  window.addEventListener("resize", resize);

  const PARTICLE_COUNT = 45;
  const COLORS = [
    "rgba(99,102,241,0.55)", // indigo
    "rgba(139,92,246,0.50)", // violet
    "rgba(236,72,153,0.45)", // pink
    "rgba(16,185,129,0.45)", // emerald
    "rgba(245,158,11,0.40)", // amber
    "rgba(59,130,246,0.45)", // blue
  ];

  const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.3 - 0.15, // slight upward bias
    size: Math.random() * 4 + 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    opacity: Math.random() * 0.6 + 0.3,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.02,
    shape: Math.floor(Math.random() * 3), // 0=circle, 1=diamond, 2=star
    pulseOffset: Math.random() * Math.PI * 2,
  }));

  let animFrame;
  const draw = () => {
    if (!canvas.parentElement) {
      cancelAnimationFrame(animFrame);
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const t = Date.now() * 0.001;

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;

      // Wrap around edges
      if (p.x < -10) p.x = canvas.width + 10;
      if (p.x > canvas.width + 10) p.x = -10;
      if (p.y < -10) p.y = canvas.height + 10;
      if (p.y > canvas.height + 10) p.y = -10;

      const pulse = 0.8 + Math.sin(t * 1.5 + p.pulseOffset) * 0.2;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = p.opacity * pulse;
      ctx.fillStyle = p.color;

      const s = p.size * pulse;

      if (p.shape === 0) {
        // Circle
        ctx.beginPath();
        ctx.arc(0, 0, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 1) {
        // Diamond
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.7, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.7, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        // 4-point star
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const r = i % 2 === 0 ? s : s * 0.4;
          const angle = (i * Math.PI) / 4;
          const method = i === 0 ? "moveTo" : "lineTo";
          ctx[method](Math.cos(angle) * r, Math.sin(angle) * r);
        }
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }

    animFrame = requestAnimationFrame(draw);
  };

  draw();

  // Cleanup when overlay is removed
  const observer = new MutationObserver(() => {
    if (!document.getElementById("landingOverlay")) {
      cancelAnimationFrame(animFrame);
      window.removeEventListener("resize", resize);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}
/**
 * Find the chain of ancestor category objects for a given category key.
 * Returns an array ordered from root → direct parent (not including the target itself).
 * Used to reconstruct navigationStack when loading from a deep-link hash.
 *
 * @param {string} targetKey  - The key of the category we navigated to
 * @param {object} tree       - The flat categoryTree object
 * @returns {Array}           - Array of ancestor category objects (may be empty for root categories)
 */
function findCategoryAncestors(targetKey, tree) {
  if (!tree || !targetKey) return [];
  for (const [key, cat] of Object.entries(tree)) {
    if (
      Array.isArray(cat.subcategories) &&
      cat.subcategories.includes(targetKey)
    ) {
      // `cat` is the direct parent — recurse to find grandparents
      const grandAncestors = findCategoryAncestors(key, tree);
      return [...grandAncestors, cat];
    }
  }
  return []; // targetKey is a root-level category
}

// ============================================================================
// Bug 1 Fix — restoreViewFromURL
// Re-renders the correct SPA view from the current window.location.hash.
// Called by:
//   • initApp()            — on initial page load / deep-link / refresh
//   • popstate listener    — on every browser back / forward navigation
//
// IMPORTANT: This function must always be called with _isRestoringState = true
// so that renderCategory / renderUserQuizzesView use history.replaceState
// (stamp the state object) rather than history.pushState (add a new entry).
// ============================================================================
function restoreViewFromURL() {
  const hash = window.location.hash.slice(1); // strip leading #

  // ── Root view ──────────────────────────────────────────────────────────────
  if (!hash) {
    renderRootCategories();
    return;
  }

  // ── User-quizzes folder ────────────────────────────────────────────────────
  if (hash === "my-quizzes") {
    navigationStack = []; // reset so renderUserQuizzesView can push cleanly
    renderUserQuizzesView();
    return;
  }

  // ── Category / subfolder — slug-based routing ─────────────────────────────
  // URL format: #{categorySlug}  or  #{categorySlug}/{subfolderSlug}/...
  // Each segment of a categoryTree key (split by "/") was passed through
  // toSlug() + encodeURIComponent() when the URL was built.
  //
  // IMPORTANT: split BEFORE decoding so a literal encoded "/" (%2F) inside a
  // segment is never mistaken for a path separator.  Then decode each segment
  // individually so both percent-encoded Arabic (%D8%A3…) and already-decoded
  // Arabic (أسئلة-الدكتور) resolve to the same slug string.
  if (categoryTree) {
    const slugParts = hash
      .split("/")
      .filter(Boolean)
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });

    let catKey = null;
    let cat = null;

    for (const [key, node] of Object.entries(categoryTree)) {
      const keyParts = key.split("/");
      if (keyParts.length !== slugParts.length) continue;
      if (keyParts.every((part, i) => toSlug(part) === slugParts[i])) {
        catKey = key;
        cat = node;
        break;
      }
    }

    if (cat) {
      // Reconstruct ancestor chain so breadcrumb "back" works correctly
      const ancestors = findCategoryAncestors(catKey, categoryTree);
      navigationStack = [...ancestors]; // pre-load ancestors without re-rendering
      renderCategory(cat); // pushes cat itself and renders content
      return;
    }
  }

  // ── Fallback: unknown / unresolvable hash → root ───────────────────────────
  renderRootCategories();
}

/**
 * Initialize the search manager with course data
 */
function initializeSearchManager() {
  try {
    // Get all root courses
    const allCourses = Object.entries(categoryTree)
      .filter(([key, category]) => !category.parent)
      .map(([key, category]) => ({ key, ...category }));

    // Create search manager instance with navigation stack getter
    searchManager = new SearchManager(
      "#searchContainer",
      handleSearchResults,
      () => navigationStack,
    );
    searchManager.init(allCourses, categoryTree);
  } catch (error) {
    console.error("Error initializing search manager:", error);
  }
}

/**
 * Handle search results from SearchManager.
 * Called whenever search results change, or when isReset = true to restore the original view.
 */
function handleSearchResults(results, context, isReset = false) {
  try {
    // When the search bar is closed, restore the full root view without filtering
    if (isReset) {
      if (context === "userQuizzes") {
        renderUserQuizzesView();
      } else {
        renderRootCategories();
      }
      return;
    }

    if (context === "courses") {
      handleCourseSearchResults(results);
    } else if (context === "quizzes") {
      handleQuizSearchResults(results);
    } else if (context === "userQuizzes") {
      handleUserQuizSearchResults(results);
    }
  } catch (error) {
    console.error("Error handling search results:", error);
  }
}

/**
 * Handle course search results (in root view)
 */
function handleCourseSearchResults(results) {
  try {
    if (searchManager && searchManager.isSearchActive()) {
      // Active search — show filtered course results
      navigationStack = [];
      updateBreadcrumb();
      if (title) title.textContent = "نتائج البحث";
      renderCourseSearchResults(results);
    } else {
      // Search query cleared inside the bar (not a full close) — restore root view.
      // NOTE: a full close (× button) triggers isReset = true in handleSearchResults,
      // which calls renderRootCategories() directly. This branch handles the case
      // where the user just backspaces the query while keeping the bar open.
      renderRootCategories();
    }
  } catch (error) {
    console.error("Error handling course search results:", error);
  }
}

/**
 * Handle quiz search results (inside a course)
 */
function handleQuizSearchResults(results) {
  try {
    // Keep navigation stack and title as is
    // Just update the quiz display
    renderQuizSearchResults(results);
  } catch (error) {
    console.error("Error handling quiz search results:", error);
  }
}

/**
 * Handle user quiz search results
 */
function handleUserQuizSearchResults(results) {
  try {
    if (!container) return;

    container.innerHTML = "";

    const actionsBar = document.createElement("div");
    actionsBar.className = "user-quiz-search-actions";
    container.appendChild(actionsBar);

    if (!results || results.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.setAttribute("role", "status");
      emptyState.style.cssText = `
        grid-column: 1 / -1;
        text-align: center;
        padding: 60px 20px;
        background: var(--color-surface);
        border-radius: 12px;
        box-shadow: var(--shadow-md);
        color: var(--color-text-primary);
      `;
      emptyState.innerHTML = `
        <div style="font-size: 4rem; margin-bottom: 20px; opacity: 0.5;" aria-hidden="true">📝</div>
        <h3 style="margin-bottom: 10px;">لا توجد نتائج بحث</h3>
      `;
      container.appendChild(emptyState);
    } else {
      const allUserQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
      results.forEach((quiz) => {
        const originalIndex = allUserQuizzes.findIndex((q) => q.id === quiz.id);
        const quizCard = createUserQuizCard(
          quiz,
          originalIndex !== -1 ? originalIndex : 0,
        );
        container.appendChild(quizCard);
      });
    }
  } catch (error) {
    console.error("Error handling user quiz search results:", error);
  }
}

/**
 * Render course search results in the main container
 */
function renderCourseSearchResults(courses) {
  try {
    if (!container) return;

    container.innerHTML = "";
    container.className = "grid-container";
    container.setAttribute("aria-busy", "false");

    const fragment = document.createDocumentFragment();

    if (courses.length === 0) {
      // Empty state for no results
      const emptyState = document.createElement("div");
      emptyState.className = "empty-state";
      emptyState.setAttribute("role", "status");
      emptyState.innerHTML = `
        <div class="empty-state-icon" aria-hidden="true">🔍</div>
        <h3>لا توجد نتائج</h3>
        <p>جرّب البحث بكلمات مختلفة أو تعديل الفلاتر</p>
      `;
      container.appendChild(emptyState);
      return;
    }

    // Render course cards with subscribe button
    courses.forEach((course) => {
      const itemCount = getCourseItemCount(course);
      const card = createCategoryCard(course.name, itemCount, true, course);

      // Add subscribe button if in search results
      if (searchManager && searchManager.isSearchActive()) {
        addSubscribeButton(card, course);
      }

      card.onclick = () => renderCategory(categoryTree[course.key]);
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  } catch (error) {
    console.error("Error rendering course search results:", error);
    if (container) {
      container.innerHTML = `
        <div class="error-state" role="alert">
          <p>حدث خطأ أثناء عرض النتائج. يرجى المحاولة مرة أخرى.</p>
        </div>
      `;
    }
  }
}

/**
 * Render quiz search results
 */
function renderQuizSearchResults(exams) {
  try {
    if (!container) return;

    // Get current category from navigation stack
    const currentCategory = navigationStack[navigationStack.length - 1];
    if (!currentCategory) return;

    container.innerHTML = "";
    container.className = "grid-container";
    container.setAttribute("aria-busy", "false");

    const fragment = document.createDocumentFragment();

    // Render subcategories first (if any)
    if (
      currentCategory.subcategories &&
      currentCategory.subcategories.length > 0
    ) {
      currentCategory.subcategories.forEach((subCatKey) => {
        const subCat = categoryTree[subCatKey];
        if (subCat) {
          const itemCount = getCourseItemCount(subCat);
          const card = createCategoryCard(
            subCat.name,
            itemCount,
            true,
            null,
            true,
          );
          card.onclick = () => renderCategory(subCat);
          fragment.appendChild(card);
        }
      });
    }

    if (
      exams.length === 0 &&
      (!currentCategory.subcategories ||
        currentCategory.subcategories.length === 0)
    ) {
      // Empty state for no results
      const emptyState = document.createElement("div");
      emptyState.className = "empty-state";
      emptyState.setAttribute("role", "status");
      emptyState.innerHTML = `
        <div class="empty-state-icon" aria-hidden="true">🔍</div>
        <h3>لا توجد نتائج</h3>
        <p>جرّب البحث بكلمات مختلفة</p>
      `;
      container.appendChild(emptyState);
      return;
    }

    // Render filtered exams
    exams.forEach((exam) => {
      const card = createExamCard(exam);
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  } catch (error) {
    console.error("Error rendering quiz search results:", error);
  }
}

/**
 * Add subscribe button to a course card
 */
function addSubscribeButton(card, course) {
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

function renderRootCategories() {
  try {
    navigationStack = [];
    updateBreadcrumb();

    // ── Bug 1 Fix: update history entry ──────────────────────────────────────
    // • During popstate restoration (_isRestoringState = true): the URL is
    //   already correct — just stamp the state object via replaceState.
    // • During forward navigation (breadcrumb click, search reset, etc.):
    //   push a new root entry so the back button can return here.
    if (_isRestoringState) {
      history.replaceState({ view: "root" }, "", window.location.pathname);
    } else {
      history.pushState({ view: "root" }, "", window.location.pathname);
    }

    // Update search context when returning to root
    if (searchManager) {
      searchManager.updateContextVisibility();
    }

    if (!title || !container) return;

    const subscribedIds = userProfile.getSubscribedCourseIds();

    // Get subscribed courses
    const subscribedCourses = getSubscribedCourses(categoryTree, subscribedIds);

    // Title based on subscription status
    const profile = userProfile.getProfile();
    if (subscribedCourses.length > 0) {
      title.textContent = "المواد خاصتي";
      title.setAttribute(
        "title",
        `${profile.faculty} faculty · Year ${profile.year} · Term ${profile.term}`,
      );
    } else {
      title.textContent = "جميع المواد";
      title.setAttribute(
        "title",
        `${"All Faculties · All Years · Both Terms"}`,
      );
    }

    container.innerHTML = "";
    container.className = "grid-container";
    container.setAttribute("aria-busy", "false");

    const fragment = document.createDocumentFragment();

    // 1. Add "إمتحاناتك" Folder Card
    try {
      const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
      const quizzesCard = createCategoryCard(
        "إمتحاناتك",
        userQuizzes.length,
        true,
      );
      // Custom icon
      const iconDiv = quizzesCard.querySelector(".icon");
      if (iconDiv) iconDiv.textContent = "✏️";

      quizzesCard.onclick = () => renderUserQuizzesView();
      fragment.appendChild(quizzesCard);
    } catch (e) {
      console.error("Error creating User Quizzes card", e);
    }

    // Show subscribed courses if any
    if (subscribedCourses.length > 0) {
      subscribedCourses.forEach((course) => {
        const itemCount = getCourseItemCount(course);
        const card = createCategoryCard(course.name, itemCount, true, course);
        card.onclick = () => renderCategory(categoryTree[course.key]);
        fragment.appendChild(card);
      });
    } else {
      // Show all courses if no subscriptions
      const rootCategories = getCategoriesLazy();
      rootCategories.forEach((category) => {
        const itemCount = getCourseItemCount(category);
        const card = createCategoryCard(
          category.name,
          itemCount,
          true,
          category,
        );
        card.onclick = () => renderCategory(category);
        fragment.appendChild(card);
      });
    }

    container.appendChild(fragment);

    // Show empty state if no courses at all
    if (subscribedCourses.length === 0 && getCategoriesLazy().length === 0) {
      container.innerHTML += `
        <div class="empty-state" role="status">
          <div class="empty-state-icon" aria-hidden="true">📚</div>
          <h3>لا توجد مواد متاحة حالياً</h3>
          <p>تابعنا قريباً لمزيد من المحتوى!</p>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error rendering root categories:", error);
    if (container) {
      container.innerHTML = `
        <div class="error-state" role="alert">
          <p>حدث خطأ أثناء تحميل المحتوى. يرجى تحديث الصفحة.</p>
          <button onclick="location.reload()" type="button">تحديث</button>
        </div>
      `;
    }
  }
}

/**
 * Render user-created quizzes VIEW (Folder Content)
 */
function renderUserQuizzesView() {
  try {
    // Update Navigation Stack
    navigationStack.push({ name: "إمتحاناتك" });
    updateBreadcrumb();

    // ── Bug 1 Fix: record this navigation in the browser history ─────────────
    // pushState so the back button can return to root after entering this view.
    // During popstate restoration only stamp the state — do not create a new
    // forward entry, which would confuse the back/forward stack.
    if (!_isRestoringState) {
      history.pushState({ view: "my-quizzes" }, "", "#my-quizzes");
    } else {
      history.replaceState({ view: "my-quizzes" }, "", "#my-quizzes");
    }

    // Update Title & Clear Container
    if (title) title.textContent = "إمتحاناتك";
    if (!container) return;

    container.innerHTML = "";
    container.className = "grid-container user-quizzes-drop-zone";

    const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));

    // Update search context for user quizzes
    if (searchManager) {
      searchManager.container.style.display = ""; // Reset inline hide
      searchManager.setUserQuizzesContext(userQuizzes);
    }

    // 1. Create 'Create New Quiz' Button (Always visible at top)
    const actionsBar = document.createElement("div");
    actionsBar.className = "user-quiz-search-actions";

    if (!isAdminAuthenticated()) {
      const adminSignInBtn = document.createElement("a");
      adminSignInBtn.href = "sign-in.html";
      adminSignInBtn.textContent = "🔐 دخول المشرفين";
      adminSignInBtn.className = "btn";
      adminSignInBtn.setAttribute("aria-label", "لوحة دخول المشرفين");
      adminSignInBtn.style.cssText =
        "display: inline-block;       padding: 10px 18px;       background: var(--color-background-secondary);       border: 1.5px solid var(--color-border);       color: var(--color-text-secondary);       text-decoration: none;       border-radius: 8px;       font-weight: 600;       font-size: 0.88rem;       transition: all 0.2s;       margin-left: 10px;";
      adminSignInBtn.onmouseover = () => {
        adminSignInBtn.style.borderColor = "var(--color-primary)";
        adminSignInBtn.style.color = "var(--color-primary)";
      };
      adminSignInBtn.onmouseout = () => {
        adminSignInBtn.style.borderColor = "var(--color-border)";
        adminSignInBtn.style.color = "var(--color-text-secondary)";
      };
      actionsBar.appendChild(adminSignInBtn);
    }

    container.appendChild(actionsBar);

    // Inline create-quiz card (always visible in this view)
    const inlineCreateCard = createInlineCreateQuizCard();
    container.appendChild(inlineCreateCard);

    // Ensure drag-and-drop import is enabled for this section
    setupUserQuizzesDropZone();

    // 2. Grid for Quizzes
    if (userQuizzes.length === 0) {
      // Empty state
      const emptyState = document.createElement("div");
      emptyState.setAttribute("role", "status");
      emptyState.style.cssText = `
        grid-column: 1 / -1;
        text-align: center;
        padding: 60px 20px;
        background: var(--color-surface);
        border-radius: 12px;
        box-shadow: var(--shadow-md);
        color: var(--color-text-primary);
      `;
      emptyState.innerHTML = `
        <div style="font-size: 4rem; margin-bottom: 20px; opacity: 0.5;" aria-hidden="true">📝</div>
        <h3 style="margin-bottom: 10px;">لم تقم بإنشاء أي اختبارات حتى الآن</h3>
        <p style="color: var(--color-text-secondary);">انقر على الزر الذي في الأعلى للبدء</p>
      `;
      container.appendChild(emptyState);
    } else {
      userQuizzes.forEach((quiz, index) => {
        const quizCard = createUserQuizCard(quiz, index);
        container.appendChild(quizCard);
      });
    }
  } catch (error) {
    console.error("Error rendering user quizzes view:", error);
    if (container) {
      container.innerHTML = `
  <div class="error-state" role="alert">
    <p>حدث خطأ أثناء تحميل الإختبارات. يرجى تحديث الصفحة.</p>
    <button onclick="renderRootCategories()" type="button">الرجوع للرئيسية</button>
  </div>
`;
    }
  }
}

function setupUserQuizzesDropZone() {
  const dropContainer = document.getElementById("contentArea");
  if (!dropContainer || dropContainer.dataset.userQuizzesDropReady === "1")
    return;

  dropContainer.dataset.userQuizzesDropReady = "1";

  dropContainer.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropContainer.classList.add("user-quizzes-drag-over");
  });

  dropContainer.addEventListener("dragleave", (e) => {
    if (e.target === dropContainer) {
      dropContainer.classList.remove("user-quizzes-drag-over");
    }
  });

  dropContainer.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropContainer.classList.remove("user-quizzes-drag-over");
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    await handleUserQuizzesDrop(files);
  });
}

async function handleUserQuizzesDrop(files) {
  const allowedExts = [".txt", ".docx", ".pdf", ".pptx", ".json"];
  const validFiles = [];
  const invalidNames = [];

  files.forEach((file) => {
    const lower = file.name.toLowerCase();
    if (allowedExts.some((ext) => lower.endsWith(ext))) {
      validFiles.push(file);
    } else {
      invalidNames.push(file.name);
    }
  });

  if (invalidNames.length) {
    showNotification(
      "ملفات غير مدعومة",
      `بعض الملفات تم تجاهلها:\n${invalidNames.join(", ")}`,
      "warning",
    );
  }

  if (!validFiles.length) return;

  const existingQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
  let importedCount = 0;

  for (const file of validFiles) {
    let text;
    try {
      text = await extractTextFromFile(file);
    } catch (err) {
      console.error("Import extract error:", err);
      showNotification(
        "خطأ في القراءة",
        `تعذّر قراءة ${file.name}: ${err.message}`,
        "error",
      );
      continue;
    }

    const defaultTitle = file.name
      .replace(/\.(json|txt|pdf|docx|pptx)$/i, "")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    let parsed;
    try {
      parsed = parseImportContent(text, defaultTitle);
    } catch (err) {
      console.error("Import parse error:", err);
      showNotification(
        "خطأ في التنسيق",
        `${file.name}: ${err.message}`,
        "error",
      );
      continue;
    }

    if (!parsed.questions || !parsed.questions.length) continue;

    const quizId = `user_quiz_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    existingQuizzes.push(buildUserQuizEntry(quizId, parsed, defaultTitle));
    importedCount++;
  }

  if (importedCount > 0) {
    const quizCountText =
      importedCount === 1
        ? "إمتحان واحد"
        : importedCount === 2
          ? "إمتحانان"
          : importedCount > 2 && importedCount < 11
            ? `${importedCount} إمتحانات`
            : `${importedCount} إمتحان`;

    setInStorage("user_quizzes", JSON.stringify(existingQuizzes));
    showNotification(
      "تم الإنشاء",
      `تم إنشاء ${quizCountText} في "إمتحاناتك"`,
      "success",
    );
    renderRootCategories();
    renderUserQuizzesView();
  }
}

/**
 * Open a prompt selection modal to choose between different AI prompts
 * (General Purpose, English Specializing, Math Specializing)
 */
function openPromptSelectionModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "promptSelectionTitle");
  overlay.style.cssText = `
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    background: rgba(0, 0, 0, 0.6);
  `;

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card prompt-selection-modal";

  // Ensure modal pop-in style exists
  if (!document.getElementById("modal-pop-in-style")) {
    const style = document.createElement("style");
    style.id = "modal-pop-in-style";
    style.textContent = `
      @keyframes modalPopIn {
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  modalCard.innerHTML = `
    <h2 id="promptSelectionTitle" style="margin-bottom: 16px; font-size: 1.3rem; display: flex; align-items: center; gap: 10px; color: var(--color-text-primary);">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wand2" style="color: var(--color-primary);"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M3 21c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2"/><path d="M14.5 4c1.1 0 2 .9 2 2v3c0 1-1 2-2 2"/><circle cx="9" cy="9" r="5"/></svg>
      اختر البرومبت
    </h2>
    <p style="margin-bottom: 20px; color: var(--color-text-secondary); font-size: 0.95rem; line-height: 1.5;">اختر النموذج الأنسب لنوع الامتحان الذي تريد إنشاءه</p>
    
    <div class="prompt-buttons-container" style="display: flex; flex-direction: column; gap: 12px;">
      <button type="button" class="prompt-btn prompt-btn-general" data-prompt="general" style="padding: 14px 16px; border: 1.5px solid var(--color-border); border-radius: 12px; background: var(--color-background-secondary); color: var(--color-text-primary); font-family: inherit; font-size: 0.95rem; font-weight: 500; cursor: pointer; transition: all 0.2s; text-align: right;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lightbulb" style="flex-shrink: 0;"><path d="M15 12c0 1.657-1.343 3-3 3s-3-1.343-3-3"/><path d="M9 17H7a2 2 0 0 0-2 2v2h12v-2a2 2 0 0 0-2-2h-2"/><path d="M12 21v1"/><path d="M9 12h6"/></svg>
          <div style="text-align: right;">
            <div style="font-weight: 600; font-size: 1rem;">الاستخدام العام</div>
            <div style="font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 2px;">تحويل أي نوع امتحان إلى JSON</div>
          </div>
        </div>
      </button>
      
      <button type="button" class="prompt-btn prompt-btn-english" data-prompt="english" style="padding: 14px 16px; border: 1.5px solid var(--color-border); border-radius: 12px; background: var(--color-background-secondary); color: var(--color-text-primary); font-family: inherit; font-size: 0.95rem; font-weight: 500; cursor: pointer; transition: all 0.2s; text-align: right;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-book-open" style="flex-shrink: 0;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          <div style="text-align: right;">
            <div style="font-weight: 600; font-size: 1rem;">اللغة الإنجليزية</div>
            <div style="font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 2px;">تخصص في امتحانات اللغة الإنجليزية</div>
          </div>
        </div>
      </button>
      
      <button type="button" class="prompt-btn prompt-btn-math" data-prompt="math" style="padding: 14px 16px; border: 1.5px solid var(--color-border); border-radius: 12px; background: var(--color-background-secondary); color: var(--color-text-primary); font-family: inherit; font-size: 0.95rem; font-weight: 500; cursor: pointer; transition: all 0.2s; text-align: right;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-function-square" style="flex-shrink: 0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 17c0-1 1-4 3-5m0 0c2-1 3-4 3-5s-1-3-3-3-3 1-3 3m0 0c-1 2-2 3-2 5"/></svg>
          <div style="text-align: right;">
            <div style="font-weight: 600; font-size: 1rem;">الرياضيات والعلوم</div>
            <div style="font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 2px;">تخصص في المعادلات والمسائل الحسابية</div>
          </div>
        </div>
      </button>
    </div>
    
    <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end;">
      <button type="button" id="promptSelectionCancel" style="padding: 10px 16px; background: transparent; border: 1.5px solid var(--color-border); border-radius: 8px; color: var(--color-text-secondary); font-family: inherit; cursor: pointer; transition: all 0.2s;">إغلاق</button>
    </div>
  `;

  overlay.appendChild(modalCard);
  document.body.appendChild(overlay);

  const promptButtons = modalCard.querySelectorAll(".prompt-btn");
  const cancelBtn = modalCard.querySelector("#promptSelectionCancel");

  // Close modal function — MUST be defined before being referenced
  const close = () => {
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.2s";
    modalCard.style.transform = "translateY(10px)";
    modalCard.style.transition = "transform 0.2s";
    setTimeout(() => overlay.remove(), 200);
  };

  // Handle button hover effects and click handlers
  promptButtons.forEach((btn) => {
    btn.onmouseover = () => {
      btn.style.borderColor = "var(--color-primary)";
      btn.style.background = "var(--color-background)";
      btn.style.transform = "translateX(-4px)";
    };
    btn.onmouseout = () => {
      btn.style.borderColor = "var(--color-border)";
      btn.style.background = "var(--color-background-secondary)";
      btn.style.transform = "translateX(0)";
    };

    // Copy prompt on click
    btn.onclick = async (e) => {
      e.stopPropagation();
      let promptText = "";
      const promptType = btn.getAttribute("data-prompt");

      if (promptType === "general") {
        promptText = General_Purpose_AI_Prompt;
      } else if (promptType === "english") {
        promptText = English_Specializing_Prompt;
      } else if (promptType === "math") {
        promptText = Math_Specializing_Prompt;
      }

      try {
        await navigator.clipboard.writeText(promptText);
        close();
        const promptLabel = {
          general: "البرومبت العام",
          english: "برومبت اللغة الإنجليزية",
          math: "برومبت الرياضيات",
        }[promptType];
        showNotification(
          "تم نسخ البرومبت",
          `تم نسخ ${promptLabel}، يمكنك الآن لصقه في أي ذكاء اصطناعي`,
          "success",
        );
      } catch (err) {
        console.error("Clipboard copy error:", err);
        showNotification(
          "خطأ في النسخ",
          "فشل نسخ البرومبت. حاول مرة أخرى.",
          "error",
        );
      }
    };
  });

  // Handle cancel button
  cancelBtn.onmouseover = () => {
    cancelBtn.style.background = "var(--color-background-secondary)";
    cancelBtn.style.color = "var(--color-text-primary)";
  };
  cancelBtn.onmouseout = () => {
    cancelBtn.style.background = "transparent";
    cancelBtn.style.color = "var(--color-text-secondary)";
  };
  cancelBtn.onclick = close;

  // Close on escape key
  const escHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  // Close on overlay click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      close();
      document.removeEventListener("keydown", escHandler);
    }
  });

  // Auto-focus first button
  setTimeout(() => {
    promptButtons[0]?.focus();
  }, 50);
}

function createInlineCreateQuizCard() {
  const card = document.createElement("div");
  card.className = "exam-card user-create-quiz-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("title", "تحويل نص ← امتحان");
  card.setAttribute("aria-label", "إنشاء إمتحان جديد من نص");

  const icon = document.createElement("div");
  icon.className = "icon";
  icon.textContent = "➕";
  icon.setAttribute("aria-hidden", "true");

  const titleEl = document.createElement("h3");
  titleEl.textContent = "إنشاء إمتحان جديد";

  const desc = document.createElement("p");
  desc.textContent =
    "الصق أسئلة الإمتحان كنص وسيتم تحويلها تلقائيًا إلى امتحان.";

  card.appendChild(icon);
  card.appendChild(titleEl);
  card.appendChild(desc);

  const open = () => openInlineCreateQuizModal();
  card.onclick = open;
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });

  return card;
}

function openInlineCreateQuizModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "inlineCreateQuizTitle");
  overlay.style.cssText = `
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    background: rgba(0, 0, 0, 0.6);
  `;

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card create-quiz-inline-modal";

  if (!document.getElementById("modal-pop-in-style")) {
    const style = document.createElement("style");
    style.id = "modal-pop-in-style";
    style.textContent = `
      @keyframes modalPopIn {
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  modalCard.innerHTML = `
    <h2 id="inlineCreateQuizTitle" style="margin-bottom: 12px; font-size: 1.5rem; display: flex; align-items: center; gap: 10px; color: var(--color-text-primary);">
      <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-plus" style="color: var(--color-primary);"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/></svg>
      إنشاء إمتحان جديد
      <button type="button" id="copyAiPromptBtn" style="margin-right: auto; font-size: 0.7rem; padding: 4px 10px; border-radius: 8px; border: 1.5px solid var(--color-border); background: var(--color-background-secondary); color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.2s; font-family: inherit; font-weight: 600;">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
        Prompt
      </button>
    </h2>
    <p style="margin-bottom:24px; color: var(--color-text-secondary); font-size: 0.95rem; line-height: 1.5;">الصق أو اكتب أسئلة الإمتحان في الحقل التالي، أو قم باستيراد ملف، وسنحوّلها تلقائيًا إلى امتحان.</p>
    <div class="form-group" style="margin-bottom: 18px;">
      <label for="inlineQuizTitle" style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--color-text-primary); font-size: 0.9rem;">عنوان الإمتحان</label>
      <input type="text" id="inlineQuizTitle" placeholder="Arrays in C++" style="width: 100%; padding: 14px 16px; direction: ltr; border: 1.5px solid var(--color-border); border-radius: 12px; background: var(--color-background); color: var(--color-text-primary); font-family: inherit; font-size: 1rem; transition: all 0.2s; outline: none; box-sizing: border-box;" onfocus="this.style.borderColor='var(--color-primary)'; this.style.boxShadow='0 0 0 4px var(--color-primary-light)';" onblur="this.style.borderColor='var(--color-border)'; this.style.boxShadow='none';"/>
    </div>
    <div class="form-group" style="margin-bottom: 24px;">
      <label for="inlineQuizContent" style="display: block; margin-bottom: 8px; font-weight: 600; color: var(--color-text-primary); font-size: 0.9rem;">محتوى الإمتحان</label>
<textarea id="inlineQuizContent" class="inline-quiz-textarea" rows="4" style="width: 100%; padding: 16px; direction: ltr; border: 1.5px solid var(--color-border); border-radius: 12px; background: var(--color-background); color: var(--color-text-primary); font-family: inherit; font-size: 0.95rem; line-height: 1.6; transition: all 0.2s; outline: none; resize: vertical; box-sizing: border-box;" onfocus="this.style.borderColor='var(--color-primary)'; this.style.boxShadow='0 0 0 4px var(--color-primary-light)';" placeholder="1. Consider the following time complexity formula for a nested loop algorithm:

$$T(n) = \\sum_{i=1}^{n} sum_{j=i}^{n} 1 = \\\\frac{n(n+1)}{2}$$

Given $n = 8$, which value correctly represents the **total number of iterations**?

A. 64
B. 36
C. 28
D. 72

Correct: B. 36

Explanation: The correct answer is **d. Data Link**.

From Lec1, the PDU hierarchy is:
| Loop Type | Formula | Result for $n=8$ |
|---|---|---|
| **Nested (this)** | $frac{n(n+1)}{2}$ | **36** |
| Full double loop | $n^2$ | 64 |


2. In C++, a \`const\` member function can modify a \`mutable\` data member.

A. True
B. False

Correct: A. True

Explanation: The \`mutable\` keyword explicitly **opts a member out** of the \`const\` contract.
This is intentional and well-defined behaviour, commonly used for internal caches or mutexes:
\`\`\`cpp
   class Counter {
       mutable int cache_ = 0;    // may be written even in const context
   public:
       int value() const {
           cache_++;              // legal because cache_ is mutable
           return cache_;
       }
   };
\`\`\`


3. Write a C++ function template that returns the **larger** of two values.
The function must work for any type that supports \`operator>\`.

Answer: The function uses \`template\`:
\`\`\`cpp
template <typename T>
T maxOf(T a, T b) {
    return (a > b) ? a : b;
}
\`\`\`

Explanation: The \`typename T\` template parameter is deduced at the call site, so \`maxOf(3, 7)\` works for \`int\`, \`maxOf(3.14, 2.71)\` for \`double\`, and \`maxOf(std::string(\&quot;apple\&quot;), std::string(\&quot;banana\&quot;))\` for \`std::string\` — as long as \`operator\&gt;\` is defined for the type." onblur="this.style.borderColor='var(--color-border)'; this.style.boxShadow='none';"></textarea>    </div>
    <div class="create-quiz-actions">
      <div class="main-actions">
        <button type="button" id="inlineQuizImport" class="inline-quiz-btn" style="border: 1.5px solid var(--color-border); background: var(--color-background-secondary); color: var(--color-text-primary);">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-upload"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
          استيراد ملف
        </button>
        <button type="button" id="inlineQuizCreate" class="inline-quiz-btn" style="background: var(--gradient-accent); color: white; box-shadow: 0 4px 14px rgba(220, 38, 38, 0.4); border: none;">إنشاء  ✨</button>
      </div>
      <button type="button" id="inlineQuizCancel">إلغاء</button>
    </div>
    <input type="file" id="inlineQuizFileInput" accept=".txt,.docx,.pdf,.pptx,.json" style="display: none;" />
  `;

  overlay.appendChild(modalCard);
  document.body.appendChild(overlay);

  const titleInput = modalCard.querySelector("#inlineQuizTitle");
  const contentInput = modalCard.querySelector("#inlineQuizContent");
  const cancelBtn = modalCard.querySelector("#inlineQuizCancel");
  const createBtn = modalCard.querySelector("#inlineQuizCreate");
  const importBtn = modalCard.querySelector("#inlineQuizImport");
  const fileInput = modalCard.querySelector("#inlineQuizFileInput");
  const copyPromptBtn = modalCard.querySelector("#copyAiPromptBtn");

  if (copyPromptBtn) {
    copyPromptBtn.onclick = (e) => {
      e.stopPropagation();
      openPromptSelectionModal();
    };
    copyPromptBtn.onmouseover = () => {
      copyPromptBtn.style.borderColor = "var(--color-primary)";
      copyPromptBtn.style.color = "var(--color-primary)";
    };
    copyPromptBtn.onmouseout = () => {
      copyPromptBtn.style.borderColor = "var(--color-border)";
      copyPromptBtn.style.color = "var(--color-text-secondary)";
    };
  }

  importBtn.onmouseover = () => {
    importBtn.style.borderColor = "var(--color-primary)";
    importBtn.style.color = "var(--color-primary)";
  };
  importBtn.onmouseout = () => {
    importBtn.style.borderColor = "var(--color-border)";
    importBtn.style.color = "var(--color-text-primary)";
  };
  cancelBtn.onmouseover = () => {
    cancelBtn.style.background = "var(--color-background-secondary)";
    cancelBtn.style.color = "var(--color-text-primary)";
  };
  cancelBtn.onmouseout = () => {
    cancelBtn.style.background = "transparent";
    cancelBtn.style.color = "var(--color-text-secondary)";
  };
  createBtn.onmouseover = () => {
    createBtn.style.transform = "translateY(-2px)";
    createBtn.style.boxShadow = "0 6px 20px rgba(220, 38, 38, 0.5)";
  };
  createBtn.onmouseout = () => {
    createBtn.style.transform = "translateY(0)";
    createBtn.style.boxShadow = "0 4px 14px rgba(220, 38, 38, 0.4)";
  };

  const close = () => {
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.2s";
    modalCard.style.transform = "translateY(10px)";
    modalCard.style.transition = "transform 0.2s";
    setTimeout(() => overlay.remove(), 200);
  };

  cancelBtn.onclick = close;

  importBtn.onclick = () => fileInput.click();

  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    importBtn.innerHTML =
      '<span class="adm-spinner" style="margin: 0; border-color: var(--color-primary); border-top-color: transparent;"></span> استخراج...';
    importBtn.disabled = true;

    try {
      const text = await extractTextFromFile(file);
      contentInput.value = text;

      const defaultTitle = file.name
        .replace(/\.(json|txt|pdf|docx|pptx)$/i, "")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      if (!titleInput.value) {
        titleInput.value = defaultTitle;
      }

      showNotification(
        "نجاح",
        "تم استخراج النص، يمكنك تعديله أو إنشاء الكويز الآن.",
        "success",
      );
    } catch (err) {
      console.error("Import extract error:", err);
      showNotification(
        "خطأ في القراءة",
        `تعذّر قراءة ${file.name}: ${err.message}`,
        "error",
      );
    } finally {
      importBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-upload"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg> استيراد ملف';
      importBtn.disabled = false;
      fileInput.value = "";
    }
  };

  createBtn.onclick = async () => {
    const title = (titleInput.value || "").trim();
    const content = (contentInput.value || "").trim();
    if (!content) {
      showNotification("بيانات ناقصة", "الرجاء إدخال المحتوى.", "warning", 10);
      return;
    }

    let parsed;
    try {
      parsed = parseImportContent(content, title || "Quiz");
    } catch (err) {
      showNotification("خطأ في التنسيق", err.message, "error", 10);
      return;
    }

    if (!parsed.questions || !parsed.questions.length) {
      showNotification(
        "لا توجد أسئلة",
        "لم يتم العثور على أسئلة صالحة في المحتوى.",
        "error",
      );
      return;
    }

    const quizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
    const quizId = `user_quiz_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    quizzes.push(buildUserQuizEntry(quizId, parsed, title || "Untitled Quiz"));

    setInStorage("user_quizzes", JSON.stringify(quizzes));
    close();
    showNotification(
      "تم الإنشاء",
      'تم إنشاء الإمتحان وإضافته إلى "إمتحاناتك"',
      "success",
    );
    renderRootCategories();
    renderUserQuizzesView();
  };

  const escHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      close();
      document.removeEventListener("keydown", escHandler);
    }
  });

  setTimeout(() => {
    titleInput.focus();
  }, 50);
}

// ── User-quiz schema helpers ─────────────────────────────────────────────────
// Quizzes may be stored in the old flat schema OR the new meta+stats schema.
// These helpers normalise reads so every consumer works with both.

/** Read a field from either old or new schema */
function qz(quiz, field) {
  switch (field) {
    // Always prefer the top-level id (the storage key); fall back to meta.id for
    // legacy payloads that accidentally stored it only inside meta.
    case "id":
      return quiz.id || quiz.meta?.id || "";
    // path is a top-level field on manifest exams, not stored in user quizzes
    case "path":
      return quiz.path || quiz.meta?.path || "";
    case "title":
      return quiz.meta?.title || quiz.title || "";
    case "description":
      return quiz.meta?.description || quiz.description || "";
    case "source":
      return quiz.meta?.source || quiz.source || "";
    case "createdAt":
      return quiz.meta?.createdAt || quiz.createdAt || "";
    case "count":
      return quiz.stats?.questionCount ?? quiz.questions?.length ?? 0;
    // FIX: guard against undefined questionTypes before calling .join()
    case "type":
      return (quiz.stats?.questionTypes || []).join(" · ");
    default:
      return undefined;
  }
}

/** Normalize essay questions from old 1-option format to new answer field */
function normalizeQuestions(questions) {
  return (questions || []).map((q) => {
    if (Array.isArray(q.options) && q.options.length === 1) {
      const { options, correct, ...rest } = q;
      return { ...rest, answer: options[0] ?? "" };
    }
    return q;
  });
}

/** Build a new-schema quiz entry for localStorage */
function buildUserQuizEntry(id, parsed, titleFallback) {
  const questions = normalizeQuestions(parsed.questions || []);
  const types = new Set();
  questions.forEach((q) => {
    if (!Array.isArray(q.options) || q.options.length === 0) types.add("Essay");
    else if (q.options.length === 2) types.add("True/False");
    else types.add("MCQ");
  });

  // Preserve ALL original meta fields (including id, createdAt, source, etc.)
  // Only fill in fields that are genuinely missing.
  const meta = {
    ...(parsed.meta || {}),
    title: parsed.meta?.title || titleFallback || "Untitled",
  };
  if (!meta.createdAt) {
    meta.createdAt = new Date().toLocaleString("en-US");
  }

  // Preserve original stats if present; otherwise compute from questions.
  const stats = parsed.stats || {
    questionCount: questions.length,
    questionTypes: Array.from(types).sort(),
  };

  return {
    id,
    meta,
    stats,
    questions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a card for a user-created quiz
 */
function createUserQuizCard(quiz, index) {
  const card = document.createElement("div");
  card.className = "exam-card user-quiz-card";
  card.setAttribute("role", "article");
  card.setAttribute("aria-label", `اختبار: ${qz(quiz, "title")}`);
  card.setAttribute(
    "title",
    `${qz(quiz, "description") ? `Description: ${qz(quiz, "description")}` : `Type: ${qz(quiz, "type")}`}`,
  );

  // Gradient accent on top
  const accentBar = document.createElement("div");
  accentBar.setAttribute("aria-hidden", "true");
  accentBar.className = "user-quiz-accent-bar";
  card.appendChild(accentBar);

  // User badge
  const badge = document.createElement("div");
  badge.textContent = "👤 اختبارك";
  badge.className = "user-quiz-badge";

  card.appendChild(badge);

  // Quiz title
  const titleEl = document.createElement("h3");
  titleEl.textContent = qz(quiz, "title");
  titleEl.className = "user-quiz-title";
  card.appendChild(titleEl);

  // Description
  if (qz(quiz, "description")) {
    const desc = document.createElement("p");
    desc.textContent = qz(quiz, "description");
    desc.className = "user-quiz-desc";
    card.appendChild(desc);
  }

  // Metadata
  const metadata = document.createElement("div");
  metadata.className = "user-quiz-metadata";

  const questionsCount = document.createElement("span");
  const count = qz(quiz, "count");
  questionsCount.textContent = `📝 ${formatArabicQuestionCount(count)}`;
  questionsCount.className = "user-quiz-count";

  const createdDate = document.createElement("span");
  const rawDate = qz(quiz, "createdAt");
  const dateObj = rawDate ? new Date(rawDate) : null;
  createdDate.textContent =
    dateObj && !isNaN(dateObj) ? dateObj.toLocaleDateString() : rawDate || "";
  createdDate.className = "user-quiz-date";

  metadata.appendChild(questionsCount);
  metadata.appendChild(createdDate);
  card.appendChild(metadata);

  // ── Question type badges ─────────────────────────────────────────────────────
  const typeStr = qz(quiz, "type");
  if (typeStr) {
    const typesRow = document.createElement("div");
    typesRow.className = "user-quiz-types-row";
    typeStr.split(" · ").forEach((t) => {
      const chip = document.createElement("span");
      chip.textContent = t;
      const colorMap = {
        MCQ: "var(--color-primary-light)",
        Essay: "var(--color-success-light)",
        "True/False": "var(--color-warning-light)",
      };
      chip.style.cssText = `
        padding: 2px 10px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
        background: ${colorMap[t] || "var(--color-border)"};
        color: var(--color-text-primary);
      `;
      typesRow.appendChild(chip);
    });
    card.appendChild(typesRow);
  }

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "user-quiz-actions";

  const playBtn = document.createElement("button");
  playBtn.textContent = "إبدأ الإختبار";
  playBtn.className = "btn btn-primary";
  playBtn.type = "button";
  playBtn.setAttribute("aria-label", `بدء اختبار ${qz(quiz, "title")}`);
  playBtn.onclick = (e) => {
    e.stopPropagation();
    playUserQuiz(quiz);
  };

  const deleteBtn = document.createElement("button");
  deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  deleteBtn.type = "button";
  deleteBtn.setAttribute("aria-label", `حذف اختبار ${qz(quiz, "title")}`);
  deleteBtn.className = "user-quiz-delete-btn";
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    deleteUserQuiz(quiz.id);
  };

  const downloadBtn = document.createElement("button");
  downloadBtn.textContent = "تحميل";
  downloadBtn.type = "button";
  downloadBtn.setAttribute("aria-label", `تحميل اختبار ${qz(quiz, "title")}`);
  downloadBtn.className = "btn user-quiz-download-btn";

  downloadBtn.title = "Download Quiz";
  downloadBtn.onclick = (e) => {
    e.stopPropagation();
    showUserQuizDownloadPopup(quiz);
  };

  const editBtn = document.createElement("button");
  editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil-line-icon lucide-pencil-line"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>`;
  editBtn.type = "button";
  editBtn.setAttribute("aria-label", `تعديل اختبار ${qz(quiz, "title")}`);
  editBtn.className = "user-quiz-edit-btn";
  editBtn.onclick = (e) => {
    e.stopPropagation();
    window.location.href = `create-quiz.html?edit=${encodeURIComponent(quiz.id)}`;
  };

  actions.appendChild(playBtn);
  actions.appendChild(downloadBtn);

  card.appendChild(deleteBtn);
  card.appendChild(editBtn);

  // ── Admin Upload Button (visible only to authenticated admins) ──────────
  // isAdminAuthenticated() checks the in-memory token — no server call needed here.
  // hasAdminSessionHint() checks sessionStorage as a fallback for UI hint.
  if (isAdminAuthenticated() || hasAdminSessionHint()) {
    const uploadRow = document.createElement("div");
    uploadRow.style.cssText =
      "margin-top: 10px; display: flex; justify-content: flex-end;";
    const uploadBtn = createUploadButton(quiz);
    uploadRow.appendChild(uploadBtn);
    card.appendChild(uploadRow);
  }

  card.appendChild(actions);

  return card;
}

/**
 * Play a user-created quiz
 */
function playUserQuiz(quiz) {
  try {
    // Store the quiz data temporarily for the quiz page to access
    sessionStorage.setItem("active_user_quiz", JSON.stringify(quiz));

    // Navigate to quiz page with special parameter
    const mode = userProfile.getDefaultQuizMode();
    window.location.href = `quiz.html?id=${encodeURIComponent(quiz.id)}&type=user`;
  } catch (error) {
    console.error("Error playing user quiz:", error);
    alert("حدث خطأ أثناء بدء الاختبار. حاول مرة أخرى.");
  }
}

/**
 * Delete a user-created quiz
 */
async function deleteUserQuiz(quizId) {
  try {
    if (
      !(await confirmationNotification(
        "هل أنت متأكد من مسح الإمتحان؟ لا يمكن إسترداده",
      ))
    ) {
      return;
    }

    const userQuizzes = JSON.parse(getFromStorage("user_quizzes", "[]"));
    const filteredQuizzes = userQuizzes.filter((q) => q.id !== quizId);
    setInStorage("user_quizzes", JSON.stringify(filteredQuizzes));

    // Re-render the folder view
    renderRootCategories();
    renderUserQuizzesView();

    showNotification("تم الحذف", "تم حذف الاختبار بنجاح", "./favicon.png");
  } catch (error) {
    console.error("Error deleting quiz:", error);
    alert("Error deleting quiz. Please try again.");
  }
}

function renderCategory(category) {
  try {
    navigationStack.push(category);
    updateBreadcrumb();

    // ── Obj 4: Update URL hash using clean slug-based scheme ─────────────────
    // URL format:  #{categorySlug}  or  #{categorySlug}/{subfolderSlug}/...
    // Each "/" segment of the categoryTree key is passed through toSlug().
    // Literal hyphens in names are double-encoded ("--") so they survive a
    // round-trip; spaces become single "-".
    const catKey = Object.keys(categoryTree || {}).find(
      (k) => categoryTree[k] === category,
    );
    if (catKey) {
      const slugPath = catKey.split("/").map(toSlug).join("/");
      // Encode each segment individually (encodeURIComponent handles Arabic,
      // Cyrillic, etc.) then rejoin with "/" so the path separator is preserved.
      // "-" and "--" are ASCII and pass through encodeURIComponent unchanged,
      // so the space↔hyphen and literal-hyphen↔"--" round-trip is unaffected.
      const url = `#${slugPath.split("/").map(encodeURIComponent).join("/")}`;

      // ── Bug 1 Fix: record this navigation in the browser history ───────────
      // pushState so back fires popstate → restoreViewFromURL(); during popstate
      // restoration only replaceState so we don't create a phantom entry.
      if (!_isRestoringState) {
        history.pushState({ view: "category", slugPath }, "", url);
      } else {
        history.replaceState({ view: "category", slugPath }, "", url);
      }
    }
    // Update search context when entering a category
    if (searchManager) {
      searchManager.updateContextVisibility();
    }

    title.textContent = category.name;
    container.innerHTML = "";
    container.className = "grid-container";

    const fragment = document.createDocumentFragment();

    // Render subcategories
    category.subcategories.forEach((subCatKey) => {
      const subCat = categoryTree[subCatKey];
      if (subCat) {
        const itemCount = getCourseItemCount(subCat);
        const card = createCategoryCard(
          subCat.name,
          itemCount,
          true,
          null,
          true,
        );
        card.onclick = () => renderCategory(subCat);
        fragment.appendChild(card);
      }
    });

    // Render exams
    category.exams.forEach((exam) => {
      const card = createExamCard(exam);
      fragment.appendChild(card);
    });

    container.appendChild(fragment);

    // Show empty state if no content
    if (category.subcategories.length === 0 && category.exams.length === 0) {
      container.innerHTML = `
        <div class="empty-state" role="status">
          <div class="empty-state-icon" aria-hidden="true">🔭</div>
          <h3>لا يوجد محتوى بعد</h3>
          <p>هذا القسم فارغ حالياً، تابعنا لمزيد من المحتوى قريباً!</p>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error rendering category:", error);
    if (container) {
      container.innerHTML = `
        <div class="error-state" role="alert">
          <p>حدث خطأ أثناء تحميل المحتوى. يرجى تحديث الصفحة.</p>
          <button onclick="renderRootCategories()" type="button">الرجوع للرئيسية</button>
        </div>
      `;
    }
  }
}

/**
 * Returns an Arabic pluralised label for the exam count on a category card.
 * @param {number} count
 * @returns {string}
 */
function getItemText(count) {
  if (count === 0) return "لا يوجد إمتحانات";
  if (count === 1) return "إمتحان واحد";
  if (count === 2) return "إمتحانان";
  if (count <= 10) return "إمتحانات";
  return "إمتحان";
}

/**
 * Returns true if the ISO-8601 / locale date string `dateStr` is within
 * `withinDays` days of today.  Returns false for missing or unparseable dates.
 * @param {string|undefined} dateStr
 * @param {number} [withinDays=14]
 * @returns {boolean}
 */
function isRecentlyAdded(dateStr, withinDays = 14) {
  if (!dateStr) return false;
  // Normalise non-standard separators such as "2026-03-19 - 20:37"
  // by collapsing any " - " (space-dash-space) between date and time into a
  // single space so the string becomes parseable by the Date constructor.
  const normalised = String(dateStr).replace(/\s+-\s+/, " ");
  const d = new Date(normalised);
  if (isNaN(d)) return false;
  const diffMs = Date.now() - d.getTime();
  return diffMs >= 0 && diffMs < withinDays * 24 * 60 * 60 * 1000;
}

function createCategoryCard(
  name,
  itemCount,
  isFolder = false,
  courseData = null,
  isSubfolder = false, // ← new param: true for subcategories inside a course
) {
  const card = document.createElement("div");

  card.className = "card category-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("title", `${name}`);
  card.setAttribute(
    "aria-label",
    `${name}, ${itemCount} ${getItemText(itemCount)}`,
  );

  if (courseData && isRecentlyAdded(courseData.createdAt)) {
    const newBadge = document.createElement("span");
    newBadge.className = "new-badge";
    newBadge.textContent = "جديد";
    newBadge.setAttribute("aria-label", "مضاف حديثاً");
    card.appendChild(newBadge);
  }

  const icon = getSubjectIcon(name, isSubfolder);

  const iconDiv = document.createElement("div");
  iconDiv.className = "icon";
  iconDiv.textContent = icon;
  iconDiv.setAttribute("aria-hidden", "true");

  const h3 = document.createElement("h3");
  h3.textContent = name;

  const p = document.createElement("p");

  p.textContent = `${itemCount > 2 ? itemCount : ""} ${getItemText(itemCount)}`;

  // Wrap text elements — display:contents on desktop (transparent), flex col on mobile
  const textWrap = document.createElement("div");
  textWrap.className = "card-text";
  textWrap.appendChild(h3);

  // Add course metadata if available
  if (courseData && courseData.faculty && courseData.year && courseData.term) {
    const profile = userProfile.getProfile();
    const metaDiv = document.createElement("div");
    metaDiv.className = "course-meta";

    // Create individual badges
    const facultyBadge = document.createElement("span");
    facultyBadge.className = "course-meta-badge faculty";
    facultyBadge.textContent = courseData.faculty;

    const yearBadge = document.createElement("span");
    yearBadge.className = "course-meta-badge year";
    yearBadge.textContent = `العام ${courseData.year}`;

    const termBadge = document.createElement("span");
    termBadge.className = "course-meta-badge term";
    termBadge.textContent = `الترم ${courseData.term}`;

    // Show the faculty if the user didn't set their faculty, or if it's a different faculty than the user's
    if (profile.faculty === "All" || courseData.faculty != profile.faculty)
      metaDiv.appendChild(facultyBadge);

    // Only show year and term if the user didn't set them, or they're different than the user's
    if (
      courseData.year != profile.year ||
      profile.year === "All" ||
      courseData.term != profile.term ||
      profile.term === "All"
    ) {
      metaDiv.appendChild(yearBadge);
      metaDiv.appendChild(termBadge);
    }

    textWrap.appendChild(metaDiv);
  }

  textWrap.appendChild(p);

  card.appendChild(iconDiv);
  card.appendChild(textWrap);

  // Keyboard support
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
    }
  });

  return card;
}

function createExamCard(exam) {
  const card = document.createElement("div");
  card.className = "card exam-card";
  card.setAttribute("role", "article");
  card.setAttribute("title", `${exam.description || exam.title}`);
  card.setAttribute("aria-label", `اختبار: ${exam.title || exam.id}`);

  // ── DB source accent border ───────────────────────────────────────────────
  if (exam.dbSource === "db") card.classList.add("exam-card--db");

  // ──────────────────────────────────────────────────────────────────────────

  const h = document.createElement("h3");
  h.innerHTML = `<span class="phone-only-emoji">📖</span> ${exam.title || exam.id}`;

  if (isRecentlyAdded(exam.createdAt)) {
    const newBadge = document.createElement("span");
    newBadge.className = "new-badge";
    newBadge.textContent = "جديد";
    newBadge.setAttribute("aria-label", "مضاف حديثاً");
    card.appendChild(newBadge);
  }

  const questionCountLine = document.createElement("p");
  questionCountLine.className = "exam-question-count";
  questionCountLine.textContent = "";

  const btn = document.createElement("button");
  btn.className = "start-btn";
  btn.type = "button";
  btn.style.flex = "1";
  btn.style.minWidth = "0";
  btn.textContent = "إبدأ الإختبار";
  btn.setAttribute("aria-label", `بدء اختبار ${exam.title || exam.id}`);
  btn.onclick = (ev) => {
    ev.stopPropagation();
    startQuiz(exam.id);
  };

  const onDownloadOption = async (format) => {
    let mod;
    const config = {
      id: exam.id,
      title: exam.title || exam.id,
      path: exam.path,
    };
    // Load exam data (HANDLES .js vs .json issue)
    let questions = [];
    try {
      const path = config.path;
      if (path.endsWith(".json")) {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        questions = data.questions;
      } else if (path.endsWith(".js")) {
        // Try fetching as JSON first if it might be a mislabeled path
        // But if it's really a JS file with export, we use import
        // The issue reported is 404 on .js because the file is .json
        // Let's try to check: if 404 on .js, try replacing with .json
        try {
          mod = await import(config.path);
          questions = mod.questions;
        } catch (jsErr) {
          console.warn(
            "Failed to load as JS, trying JSON substitute...",
            jsErr,
          );
          const jsonPath = config.path.replace(/\.js$/, ".json");
          const res = await fetch(jsonPath);
          if (!res.ok) throw new Error("Failed to load as JSON as well");
          const data = await res.json();
          questions = data.questions;
        }
      } else {
        // Fallback
        mod = await import(config.path);
        questions = mod.questions;
      }
    } catch (e) {
      console.error("Load failed", e);
      alert("Failed to load exam data.");
      return;
    }
    await executeExport(format, config, questions);
  };

  const showDownloadPopup = () => {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.style.transform = "translateZ(0)";
    modal.style.willChange = "opacity";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "downloadModalTitle");

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    const modalCard = document.createElement("div");
    modalCard.className = "modal-card";
    modalCard.style.contain = "layout style paint";

    const h2 = document.createElement("h2");
    h2.id = "downloadModalTitle";
    h2.textContent = exam.title || exam.id;

    const p = document.createElement("p");
    p.textContent = "اختر طريقة التنزيل";

    const grid = document.createElement("div");
    grid.className = "mode-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "خيارات التنزيل");

    opts.forEach(([icon, label, format]) => {
      const b = document.createElement("button");
      b.className = "mode-btn";
      b.type = "button";
      b.setAttribute("aria-label", `تنزيل كـ ${label}`);
      b.innerHTML = `<img src="${icon}" alt="context icon" class="icon" aria-hidden="true"><strong>${label}</strong>`;
      b.onclick = (ev) => {
        ev.stopPropagation();
        withDownloadLoading(b, () => onDownloadOption(format)).then(() =>
          modal.remove(),
        );
      };
      grid.appendChild(b);
    });

    const copyBtn = buildCopyDownloadButton(async () => {
      const res = await fetch(exam.path);
      const data = await res.json();
      const questions = data.questions || [];
      const config = {
        title: exam.title || exam.id,
        description: exam.description,
        source: exam.source,
      };
      return buildQuizText(config, questions);
    }, exam.title || exam.id);
    grid.appendChild(copyBtn);

    const jsonBtn = document.createElement("button");
    jsonBtn.className = "mode-btn";
    jsonBtn.type = "button";
    jsonBtn.setAttribute("aria-label", `Download JSON (.json)`);
    jsonBtn.innerHTML = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-braces-icon lucide-file-braces"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/></svg><strong>JSON (.json)</strong>`;
    jsonBtn.onclick = (ev) => {
      ev.stopPropagation();
      withDownloadLoading(jsonBtn, async () => {
        try {
          const res = await fetch(exam.path);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          triggerDownload(blob, `${exam.title || exam.id}.json`);
        } catch (e) {
          console.error("JSON Error:", e);
          alert("فشل تنزيل ملف JSON");
        }
      }).then(() => modal.remove());
    };
    grid.appendChild(jsonBtn);

    // Show source button if source URL is available in the manifest
    if (exam.source && typeof exam.source === "string") {
      const sourceBtn = document.createElement("button");
      sourceBtn.className = "mode-btn";
      sourceBtn.type = "button";
      sourceBtn.setAttribute("aria-label", `Download Source`);
      sourceBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-to-line-icon lucide-arrow-down-to-line"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg><strong>Download Source</strong>`;
      sourceBtn.onclick = (ev) => {
        ev.stopPropagation();
        window.open(exam.source, "_blank");
        modal.remove();
      };
      grid.appendChild(sourceBtn);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "close-modal";
    closeBtn.type = "button";
    closeBtn.textContent = "إلغاء";
    closeBtn.setAttribute("aria-label", "إغلاق النافذة");
    closeBtn.onclick = () => modal.remove();

    modalCard.appendChild(h2);
    modalCard.appendChild(p);
    modalCard.appendChild(grid);
    modalCard.appendChild(closeBtn);
    modal.appendChild(modalCard);

    requestAnimationFrame(() => {
      document.body.appendChild(modal);
      // Focus first button
      const firstBtn = grid.querySelector("button");
      if (firstBtn) firstBtn.focus();
    });
  };

  const downloadBtn = document.createElement("button");
  downloadBtn.className = "start-btn desktop-download-btn";
  downloadBtn.type = "button";
  downloadBtn.style.flex = "1";
  downloadBtn.style.minWidth = "0";
  downloadBtn.style.background =
    "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)";
  downloadBtn.style.color = "white";
  downloadBtn.style.boxShadow = "0 4px 14px rgba(220, 38, 38, 0.4)";
  downloadBtn.textContent = "تحميل";
  downloadBtn.setAttribute("aria-label", `تحميل ${exam.title || exam.id}`);
  downloadBtn.onclick = (ev) => {
    ev.stopPropagation();
    showDownloadPopup();
  };

  const moreBtn = document.createElement("button");
  moreBtn.className = "mobile-more-btn";
  moreBtn.type = "button";
  moreBtn.innerHTML = `⋮`;
  moreBtn.setAttribute("aria-label", "خيارات إضافية");
  moreBtn.onclick = (ev) => {
    ev.stopPropagation();
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.style.zIndex = "9999";
    modal.addEventListener("click", () => modal.remove());

    const menu = document.createElement("div");
    menu.style.cssText = `
       background: var(--color-surface);
       border-radius: 20px 20px 0 0;
       position: absolute;
       bottom: 0; left: 0; right: 0;
       padding: 24px;
       box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
       display: flex; flex-direction: column; gap: 12px;
    `;

    const downloadOpt = document.createElement("button");
    downloadOpt.className = "btn btn-primary";
    downloadOpt.textContent = "تحميل ⬇️";
    downloadOpt.style.padding = "14px";
    downloadOpt.style.fontWeight = "bold";
    downloadOpt.onclick = (e) => {
      e.stopPropagation();
      modal.remove();
      showDownloadPopup();
    };

    const shareOpt = document.createElement("button");
    shareOpt.className = "btn";
    shareOpt.textContent = "مشاركة 🔗";
    shareOpt.style.padding = "14px";
    shareOpt.style.background = "var(--color-primary-light)";
    shareOpt.style.color = "var(--color-primary)";
    shareOpt.style.fontWeight = "bold";
    shareOpt.onclick = (e) => {
      e.stopPropagation();
      modal.remove();
      const url =
        window.location.origin +
        window.location.pathname.replace("index.html", "") +
        "quiz.html?id=" +
        exam.id;
      if (navigator.share) {
        navigator
          .share({ title: exam.title || exam.id, url: url })
          .catch(() => {});
      } else {
        navigator.clipboard
          .writeText(url)
          .then(() =>
            showNotification("تم النسخ", "تم نسخ رابط الإمتحان!", "success"),
          );
      }
    };

    const cancelOpt = document.createElement("button");
    cancelOpt.className = "btn";
    cancelOpt.textContent = "إلغاء";
    cancelOpt.style.padding = "14px";
    cancelOpt.style.background = "transparent";
    cancelOpt.style.color = "var(--color-text-secondary)";

    menu.appendChild(downloadOpt);
    menu.appendChild(shareOpt);
    menu.appendChild(cancelOpt);
    modal.appendChild(menu);
    document.body.appendChild(modal);
  };

  const btnWrap = document.createElement("div");
  btnWrap.className = "exam-card-actions-wrap";
  btnWrap.appendChild(btn);
  btnWrap.appendChild(downloadBtn);
  btnWrap.appendChild(moreBtn);

  const shareBtn = document.createElement("button");
  shareBtn.className = "share-quiz-link-button desktop-share-btn";
  shareBtn.type = "button";
  shareBtn.setAttribute("aria-label", `مشاركة ${exam.title || exam.id}`);
  shareBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-share-2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>`;
  shareBtn.onclick = (ev) => {
    ev.stopPropagation();
    const url =
      window.location.origin +
      window.location.pathname.replace("index.html", "") +
      "quiz.html?id=" +
      exam.id;
    navigator.clipboard
      .writeText(url)
      .then(() =>
        showNotification("تم النسخ", "تم نسخ رابط الإمتحان!", "success"),
      );
  };
  card.appendChild(shareBtn);

  card.style.position = "relative";

  // ── Build text wrapper (display:contents on desktop, flex-col on mobile) ──
  const textWrap = document.createElement("div");
  textWrap.className = "card-text";
  textWrap.appendChild(h);

  // Meta wrapper: holds types + count in a flex row on desktop, column on mobile
  const metaWrap = document.createElement("div");
  metaWrap.className = "exam-card-meta";

  // Render question types as a plain subtext line (e.g. "MCQ · Essay")
  if (Array.isArray(exam.questionTypes) && exam.questionTypes.length > 0) {
    const typesLine = document.createElement("p");
    typesLine.className = "exam-question-count exam-types-subtext";
    typesLine.textContent = exam.questionTypes.join(" · ");
    metaWrap.appendChild(typesLine);
  }

  metaWrap.appendChild(questionCountLine);
  textWrap.appendChild(metaWrap);

  // DOM order: [db-badge] [textWrap] [btnWrap]
  // On desktop: textWrap is display:contents (transparent).
  // On mobile: flex row → textWrap fills space.
  card.appendChild(textWrap);
  card.appendChild(btnWrap);

  // Read question count from manifest (no individual file fetch needed)
  if (typeof exam.questionCount === "number" && exam.questionCount > 0) {
    questionCountLine.textContent = formatArabicQuestionCount(
      exam.questionCount,
    );
  }

  return card;
}

function updateBreadcrumb() {
  if (!breadcrumb) return;

  if (navigationStack.length === 0) {
    breadcrumb.classList.remove("show");
    breadcrumb.setAttribute("aria-hidden", "true");
    return;
  }

  breadcrumb.classList.add("show");
  breadcrumb.setAttribute("aria-hidden", "false");
  const breadcrumbText = breadcrumb.querySelector(".breadcrumb-text");

  if (navigationStack.length === 1) {
    breadcrumbText.textContent = "الرجوع إلى المواد ←";
    breadcrumb.onclick = renderRootCategories;
    breadcrumb.setAttribute("aria-label", "الرجوع إلى المواد ←");
  } else {
    const parentName = navigationStack[navigationStack.length - 2].name;
    breadcrumbText.textContent = `الرجوع إلى ${parentName} ←`;
    breadcrumb.onclick = () => {
      navigationStack.pop();
      const parent = navigationStack[navigationStack.length - 1];
      navigationStack.pop();
      renderCategory(parent);
    };
    breadcrumb.setAttribute("aria-label", `الرجوع إلى ${parentName}  ←`);
  }
}

/**
 * Copies text to the clipboard.
 * Prefers the async Clipboard API; falls back to a hidden textarea
 * select-and-copy for non-HTTPS or focus-restricted contexts.
 * @param {string} text
 * @returns {Promise<void>}
 */
async function copyTextWithFallback(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback: temporary textarea
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("execCommand copy returned false");
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * Creates a mode-grid button that copies quiz text on first click,
 * then offers a .txt download on the second click.
 *
 * @param {Function} getTextFn — async () => string  — called on first click to
 *   retrieve the quiz text (load + format). Throw to surface an error notification.
 * @param {string} downloadFilename — base filename for the .txt download (no extension).
 * @returns {HTMLButtonElement}
 */
function buildCopyDownloadButton(getTextFn, downloadFilename) {
  const btn = document.createElement("button");
  btn.className = "mode-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "نسخ كنص");

  const copyIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
  const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;

  btn.innerHTML = `${copyIcon}<strong>نسخ كنص</strong>`;

  let isCopied = false;
  let textBlob = null;

  btn.onclick = (ev) => {
    ev.stopPropagation();
    withDownloadLoading(btn, async () => {
      try {
        if (!isCopied) {
          const text = await getTextFn();
          await copyTextWithFallback(text);
          textBlob = new Blob([text], { type: "text/plain" });
          btn.innerHTML = `${downloadIcon}<strong>تنزيل .txt</strong>`;
          btn.setAttribute("aria-label", "تنزيل .txt");
          isCopied = true;
          showNotification(
            "تم النسخ",
            "تم نسخ نص الإختبار! انقر مرة أخرى لتحميله كملف .txt",
            "success",
          );
        } else {
          triggerDownload(textBlob, `${downloadFilename}.txt`);
          isCopied = false;
        }
      } catch (e) {
        console.error(e);
        showNotification("خطأ", "فشل نسخ أو تحميل الإختبار.", "error");
      }
    }).then(() => {
      if (isCopied) {
        btn.innerHTML = `${downloadIcon}<strong>تنزيل .txt</strong>`;
      } else {
        btn.innerHTML = `${copyIcon}<strong>نسخ كنص</strong>`;
      }
    });
  };

  return btn;
}

/**
 * Dispatches an export operation to the correct export module.
 * @param {string} format — one of: "quiz" | "html" | "md" | "pdf" | "pptx" | "docx"
 * @param {object} config — { id, title, description, path?, source? }
 * @param {Array}  questions
 */
async function executeExport(format, config, questions) {
  switch (format) {
    case "quiz":
      await exportToQuiz(config, questions);
      break;
    case "html":
      await exportToHtml(config, questions);
      break;
    case "pdf":
      await exportToPdf(config, questions);
      break;
    case "docx":
      await exportToWord(config, questions);
      break;
    case "pptx":
      await exportToPptx(config, questions);
      break;
    case "md":
      exportToMarkdown(config, questions);
      break;
  }
}

/**
 * Triggers a file download from a Blob without leaving orphaned object URLs.
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Wrapper for download buttons to show loading state
 */
async function withDownloadLoading(buttonEl, asyncFn) {
  const originalHtml = buttonEl.innerHTML;
  const originalWidth = buttonEl.offsetWidth;

  buttonEl.disabled = true;
  buttonEl.style.width = `${originalWidth > 0 ? originalWidth : buttonEl.getBoundingClientRect().width}px`;
  buttonEl.style.justifyContent = "center";
  buttonEl.innerHTML =
    '<i data-lucide="loader-circle" class="spin"></i> جاري التحميل...';
  try {
    await asyncFn();
  } finally {
    buttonEl.disabled = false;
    buttonEl.innerHTML = originalHtml;
    buttonEl.style.width = "";
    buttonEl.style.justifyContent = "";
  }
}

function startQuiz(id) {
  try {
    localStorage.setItem("quiz_start_time", Date.now().toString());

    // Only the quiz ID travels in the URL → links are shareable
    window.location.href = `quiz.html?id=${encodeURIComponent(id)}`;
  } catch (error) {
    console.error("Error starting quiz:", error);
    alert("حدث خطأ أثناء بدء الاختبار. حاول مرة أخرى.");
  }
}

// Helper function
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Make functions available globally
window.startQuiz = startQuiz;
window.renderRootCategories = renderRootCategories;

/**
 * Shows a modal listing all keyboard shortcuts available on the index page.
 * Pressing Escape or clicking outside dismisses it.
 */
function showShortcutsOverlay() {
  if (document.getElementById("shortcutsOverlay")) return; // already open

  const overlay = document.createElement("div");
  overlay.id = "shortcutsOverlay";
  overlay.className = "shortcuts-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "shortcutsTitle");

  overlay.innerHTML = `
    <div class="shortcuts-card">
      <h2 id="shortcutsTitle" class="shortcuts-title">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 6h16M4 10h16M4 14h8M4 18h4"/>
        </svg>
        اختصارات لوحة المفاتيح
      </h2>
      <table class="shortcuts-table" aria-label="قائمة الاختصارات">
        <tbody>
          <tr>
            <td><kbd>/</kbd> أو <kbd>Ctrl</kbd>+<kbd>K</kbd></td>
            <td>فتح البحث</td>
          </tr>
          <tr>
            <td><kbd>Esc</kbd></td>
            <td>إغلاق البحث أو هذه النافذة</td>
          </tr>
          <tr>
            <td><kbd>?</kbd></td>
            <td>عرض الاختصارات</td>
          </tr>
        </tbody>
      </table>
      <button class="shortcuts-close" aria-label="إغلاق نافذة الاختصارات" type="button">
        إغلاق
      </button>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".shortcuts-close").addEventListener("click", close);
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") close();
    },
    { once: true },
  );

  document.body.appendChild(overlay);
  overlay.querySelector(".shortcuts-close").focus();
}

// ============================================================================
// DOM Content Loaded
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // ── PWA bootstrap (runs on EVERY page) ───────────────────────────────────
  // Must come before the isIndexPage guard so SW registration and the offline
  // banner are active regardless of which page the user is on.
  initPWA();

  // ── Page guard ────────────────────────────────────────────────────────────
  // index.js is imported as an ES module by side-menu.js (for the exported
  // updateWelcomeMessage function).  ES module imports cause the ENTIRE module
  // to execute, including this DOMContentLoaded listener, on EVERY page that
  // loads side-menu.js (quiz.html, result.html, etc.).
  //
  // Without this guard, initApp() would run on quiz.html and call
  // renderRootCategories() → history.replaceState("", "", pathname), stripping
  // the ?id= query parameter from the quiz URL before quiz.js could read it.
  const p = window.location.pathname;
  const isIndexPage =
    p === "/" || p.endsWith("/index.html") || p.endsWith("/index");
  if (!isIndexPage) return;

  // Initial load
  updateWelcomeMessage();

  // Show welcome notification with error handling
  try {
    const username = getFromStorage("username", "User");
    showNotification(
      "منصة إمتحانات بصمجي",
      `السلام عليكم يا ${escapeHtml(username)}`,
      "./assets/images/السلام عليكم.png",
    );
  } catch (error) {
    console.error("Error showing welcome notification:", error);
  }

  // ── Bug 1 Fix: listen for back / forward navigation ───────────────────────
  window.addEventListener("popstate", () => {
    if (!categoryTree) return;
    _isRestoringState = true;
    try {
      restoreViewFromURL();
    } finally {
      _isRestoringState = false;
    }
  });

  initApp().catch((err) => {
    console.error("Init error:", err);
    if (typeof renderRootCategories === "function") renderRootCategories();
  });

  // ── Keyboard shortcut: "/" or Ctrl+K / Cmd+K → open search ──────────────────
  document.addEventListener("keydown", (e) => {
    // Ignore if focus is inside an input, textarea, or contenteditable
    const tag = document.activeElement?.tagName;
    const isEditable =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      document.activeElement?.isContentEditable;
    if (isEditable) return;

    const isSearchShortcut =
      e.key === "/" ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k");

    if (isSearchShortcut) {
      e.preventDefault();

      const headerSearchBtn = document.getElementById("headerSearchBtn");
      if (!headerSearchBtn) return;

      // If the search bar is already open, focus the input directly
      const searchInput = document.getElementById("courseSearch");
      const searchContainer = document.getElementById("searchContainer");
      const isOpen =
        searchContainer &&
        searchContainer.getAttribute("aria-hidden") !== "true";

      if (isOpen && searchInput) {
        searchInput.focus();
        searchInput.select();
      } else {
        headerSearchBtn.click();
        // Wait one frame for the panel to open before focusing
        requestAnimationFrame(() => {
          const input = document.getElementById("courseSearch");
          if (input) {
            input.focus();
            input.select();
          }
        });
      }
    }

    if (e.key === "?" && !isEditable) {
      e.preventDefault();
      showShortcutsOverlay();
    }
  });
});

// ============================================================================
// show UserQuiz Download Popup
// ============================================================================
const opts = [
  ["./favicon.png", "Quiz (.html)", "quiz"],
  ["./assets/images/HTML_Icon.png", "HTML (.html)", "html"],
  ["./assets/images/mardownIcon.png", "Markdown (.md)", "md"],
  ["./assets/images/PDF_Icon.png", "PDF (.pdf)", "pdf"],
  ["./assets/images/pptx_icon.png", "PowerPoint (.pptx)", "pptx"],
  ["./assets/images/word_icon.png", "Word (.docx)", "docx"],
];
function showUserQuizDownloadPopup(quiz) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.style.transform = "translateZ(0)";
  modal.style.willChange = "opacity";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "userQuizDownloadTitle");

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card";
  modalCard.style.contain = "layout style paint";

  const h2 = document.createElement("h2");
  h2.id = "userQuizDownloadTitle";
  h2.textContent = qz(quiz, "title");

  const p = document.createElement("p");
  p.textContent = "اختر طريقة التنزيل";

  const grid = document.createElement("div");
  grid.className = "mode-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "خيارات التنزيل");

  // Config object for export functions (schema-normalised)
  const config = {
    id: quiz.id,
    title: qz(quiz, "title"),
    description: qz(quiz, "description"),
  };

  const questions = quiz.questions;

  const onDownloadOption = async (format) => {
    await executeExport(format, config, questions);
  };

  opts.forEach(([icon, label, format]) => {
    const b = document.createElement("button");
    b.className = "mode-btn";
    b.type = "button";
    b.setAttribute("aria-label", `تنزيل كـ ${label}`);
    b.innerHTML = `<img src="${icon}" alt="" class="icon" aria-hidden="true"><strong>${label}</strong>`;
    b.onclick = (ev) => {
      ev.stopPropagation();
      withDownloadLoading(b, () => onDownloadOption(format)).then(() =>
        modal.remove(),
      );
    };
    grid.appendChild(b);
  });

  const copyBtn = buildCopyDownloadButton(
    async () => {
      const config = {
        title: qz(quiz, "title") || quiz.id,
        description: qz(quiz, "description"),
        source: qz(quiz, "source"),
      };
      return buildQuizText(config, quiz.questions);
    },
    (qz(quiz, "title") || quiz.id).replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "_"),
  );
  grid.appendChild(copyBtn);

  const jsonBtn = document.createElement("button");
  jsonBtn.className = "mode-btn";
  jsonBtn.type = "button";
  jsonBtn.setAttribute("aria-label", `Download JSON (.json)`);
  jsonBtn.innerHTML = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-braces-icon lucide-file-braces"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/></svg><strong>JSON (.json)</strong>`;
  jsonBtn.onclick = (ev) => {
    ev.stopPropagation();
    withDownloadLoading(jsonBtn, async () => {
      try {
        const title = qz(quiz, "title");
        const description = qz(quiz, "description");
        const source = qz(quiz, "source");
        const createdAt = qz(quiz, "createdAt");

        const payload = await buildJsonQuizExport(
          title,
          description,
          source,
          quiz.questions || [],
          createdAt,
        );

        const fileContent = JSON.stringify(payload, null, 2);
        const blob = new Blob([fileContent], { type: "application/json" });
        triggerDownload(blob, `${title || "quiz"}.json`);
      } catch (e) {
        console.error("JSON Error:", e);
        alert("فشل تنزيل ملف JSON");
      }
    }).then(() => modal.remove());
  };
  grid.appendChild(jsonBtn);

  // Show source button if the quiz has a source URL
  const quizSource = qz(quiz, "source");
  if (quizSource && typeof quizSource === "string") {
    const sourceBtn = document.createElement("button");
    sourceBtn.className = "mode-btn";
    sourceBtn.type = "button";
    sourceBtn.setAttribute("aria-label", `Download Source`);
    sourceBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-to-line-icon lucide-arrow-down-to-line"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg><strong>Download Source</strong>`;
    sourceBtn.onclick = (ev) => {
      ev.stopPropagation();
      window.open(quizSource, "_blank");
      modal.remove();
    };
    grid.appendChild(sourceBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "close-modal";
  closeBtn.type = "button";
  closeBtn.textContent = "إلغاء";
  closeBtn.setAttribute("aria-label", "إغلاق النافذة");
  closeBtn.onclick = () => modal.remove();

  modalCard.appendChild(h2);
  modalCard.appendChild(p);
  modalCard.appendChild(grid);
  modalCard.appendChild(closeBtn);
  modal.appendChild(modalCard);

  requestAnimationFrame(() => {
    document.body.appendChild(modal);
    // Focus first button
    const firstBtn = grid.querySelector("button");
    if (firstBtn) firstBtn.focus();
  });
}

// ============================================================================
// ERROR BOUNDARY
// ============================================================================

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  // In production, send to error tracking service
});

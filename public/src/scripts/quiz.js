// src/scripts/quiz.js - Performance Optimized
import { getManifest } from "./quizManifest.js";
import { gameEngine } from "../shared/gameEngine.js";
import {
  showNotification,
  confirmationNotification,
} from "../components/notifications.js";
import { userProfile } from "./userProfile.js";
import { initKeyboardNav } from "./keyboard-nav.js";
import { gradeEssay, isEssayQuestion } from "../shared/rate-essays.js";
showNotification(
  "الإمتحان بدأ",
  "أسأل الله لك التوفيق والسداد",
  "./assets/images/صلى_على_النبي_2.png",
);
import {
  renderMarkdown,
  normalizeLiteralNewlines,
} from "../shared/markdown.js";

// === MEMORY CACHE for exam modules ===
const examModuleCache = new Map();
const MAX_CACHE_SIZE = 10; // Keep last 10 exams in memory

// === State Management ===
let questions = [];
let metaData = {};
let currentIdx = 0;
let userAnswers = {};
let lockedQuestions = {};
let timeElapsed = 0;
let timerInterval = null;
let examId = null;
let quizMode = "exam";
let timeRemaining = 0;
let viewMode = "grid";
let autoSubmitTimeout = null;
let quizStyle = "pagination"; // "pagination" | "vertical"

// === Performance: Debounce helpers ===
let renderNavDebounce = null;
let saveStateDebounce = null;

// === DOM Elements (cached references) ===
const els = {
  title: document.getElementById("quizTitle"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  questionContainer: document.getElementById("questionContainer"),
  timer: document.getElementById("timer"),
  timerBadge: document.getElementById("timerBadge"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  finishBtn: document.getElementById("finishBtn"),
  restartBtn: document.getElementById("restartBtn"),
  exitBtn: document.getElementById("exitBtn"),
  statsBar: document.getElementById("statsBar"),
  statLevel: document.getElementById("statLevel"),
  statPoints: document.getElementById("statPoints"),
  statStreak: document.getElementById("statStreak"),
  viewToggle: document.getElementById("viewToggle"),
  viewIcon: document.getElementById("viewIcon"),
  viewText: document.getElementById("viewText"),
};

// === Global handlers ===
window.finishEarly = () => finish();
window.restartQuiz = () => restart(); // Not implemented
window.exitQuiz = () => exit();
window.prevQuestion = () => nav(-1);
window.nextQuestion = () => nav(1);

// Vertical style: select option for a specific question
window.handleSelectForQuestion = (qIdx, optIdx) => {
  if (lockedQuestions[qIdx]) return;
  userAnswers[qIdx] = optIdx;
  saveStateDebounced();
  renderQuestion();
  renderMenuNavigationDebounced();
  maybeAutoSubmit();
};

// Vertical style: check answer for a specific question
window.checkAnswerForQuestion = (qIdx) => {
  const q = questions[qIdx];
  const isEssay = isEssayQuestion(q);
  if (isEssay) {
    const textarea = document.getElementById(`essayInput-${qIdx}`);
    if (!textarea || !textarea.value.trim()) return;
  } else {
    if (userAnswers[qIdx] === undefined) return;
  }
  lockedQuestions[qIdx] = true;
  saveStateDebounced();
  renderQuestion();
  renderMenuNavigationDebounced();
  updateNav();
};

// Vertical style: essay input for a specific question
window.handleEssayInputForQuestion = (qIdx) => {
  if (lockedQuestions[qIdx]) return;
  const textarea = document.getElementById(`essayInput-${qIdx}`);
  if (textarea) {
    userAnswers[qIdx] = textarea.value;
    saveStateDebounced();
    const checkBtn = textarea
      .closest(".question-card")
      ?.querySelector(".check-answer-btn");
    if (checkBtn) checkBtn.disabled = !textarea.value.trim();
  }
};

// === Helper: HTML Escaping ===
const escapeHtml = (unsafe) => {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// === Helper: Get the model answer for an essay question ===
const getEssayAnswer = (q) => q.answer ?? "";

// === Helper: Render Question Image ===
const renderQuestionImage = (imageUrl) => {
  if (!imageUrl) return "";
  return `
    <div class="question-image-container">
      <img 
        src="${escapeHtml(imageUrl)}" 
        alt="Question context image" 
        class="question-image"
        onerror="this.parentElement.style.display='none'"
      />
    </div>
  `;
};

// === Gamification Stats ===
function updateGamificationStats() {
  const userData = gameEngine.getUserData();
  const levelInfo = gameEngine.calculateLevel(userData.totalPoints);

  if (els.statLevel) els.statLevel.textContent = `Lv ${levelInfo.level || 0}`;
  if (els.statPoints)
    els.statPoints.textContent = `${userData.totalPoints || 0} pts`;
  if (els.statStreak) {
    const streak = userData.streaks?.currentDaily || 0;
    els.statStreak.textContent = `${streak} day${streak !== 1 ? "s" : ""}`;
  }
}

// === View Toggle ===
function toggleView() {
  viewMode = viewMode === "grid" ? "list" : "grid";
  localStorage.setItem("quiz_view_mode", viewMode);

  if (els.viewIcon && els.viewText) {
    if (viewMode === "grid") {
      els.viewIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-icon lucide-list"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg>`;
      els.viewText.textContent = "شكل القائمة";
    } else {
      els.viewIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid-icon lucide-layout-grid"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;
      els.viewText.textContent = "شكل الأيقونات";
    }
  }

  renderMenuNavigation();
}

// === OPTIMIZED: Load exam JSON with caching ===
async function loadExamModule(config) {
  // Check cache first
  if (examModuleCache.has(config.id)) {
    console.log(`[Quiz] Using cached exam: ${config.id}`);
    return examModuleCache.get(config.id);
  }

  // Resolve the fetch URL.
  // Paths starting with "/" are origin-relative (e.g. "/data/quizzes/...")
  // Paths starting with "http" are already absolute (DB quizzes).
  // Legacy relative paths are resolved against import.meta.url.
  console.log(`[Quiz] Loading exam: ${config.id}`);
  let quizUrl;
  if (config.path.startsWith("/") || config.path.startsWith("http")) {
    quizUrl = new URL("" + config.path, window.location.origin);
  } else {
    quizUrl = new URL(config.path, new URL(import.meta.url));
  }
  let module;
  if (config.path.toLowerCase().endsWith(".json")) {
    const res = await fetch(quizUrl.href);
    if (!res.ok) throw new Error(`Failed to load quiz: ${res.status}`);
    const data = await res.json();
    module = { questions: data.questions || [] };
  } else {
    const loaded = await import(quizUrl.href);
    module = { questions: loaded.questions || [] };
  }

  // Cache it
  examModuleCache.set(config.id, module);

  // Limit cache size (LRU-style)
  if (examModuleCache.size > MAX_CACHE_SIZE) {
    const firstKey = examModuleCache.keys().next().value;
    examModuleCache.delete(firstKey);
  }

  return module;
}

async function init() {
  // ── Bug 2 Fix: reset all in-flight state before (re-)initialising ─────────
  // init() may be called a second time via the popstate listener when the user
  // presses the back button from the results page.  Without resetting, the
  // previous timer and answer state would bleed into the new session.
  resetQuizState();

  const params = new URLSearchParams(window.location.search);

  // ── Bug 2 Fix: safe param extraction ─────────────────────────────────────
  // params.get("id") returns null when the parameter is absent.
  // decodeURIComponent(null) produces the string "null", which is truthy and
  // bypasses the !examId guard below — leading to a confusing "Exam not found"
  // error.  Guard against null explicitly before decoding.
  const rawId = params.get("id");
  examId = rawId !== null ? decodeURIComponent(rawId) : null;

  // ── Quiz Mode ────────────────────────────────────────────────────────────
  // Mode is intentionally NOT in the URL (links stay mode-agnostic).
  // Each device/user gets its own mode from their profile / localStorage.
  quizMode = userProfile.getProfile().defaultQuizMode;

  const startTime = localStorage.getItem("quiz_start_time");

  // User-created quizzes still use ?type=user (URL-only, unchanged)
  const quizType = params.get("type");
  const startAt = params.get("startAt");

  // Validate quiz data exists
  if (!examId && !quizType) {
    console.error("No quiz selected");
    alert("لم يتم اختيار اختبار. سيتم توجيهك للصفحة الرئيسية.");
    window.location.href = "/";
    return;
  }

  // Validate start time (prevent stale quiz sessions - max 24 hours)
  if (startTime && examId) {
    const now = Date.now();
    const maxSessionAge = 24 * 60 * 60 * 1000; // 24 hours
    if (now - parseInt(startTime) > maxSessionAge) {
      console.warn("Quiz session expired");
      localStorage.removeItem("quiz_start_time");
      alert("انتهت صلاحية الجلسة. يرجى بدء الاختبار من جديد.");
      window.location.href = "/";
      return;
    }
  }

  // Load saved view mode
  const savedView = localStorage.getItem("quiz_view_mode");
  if (savedView) viewMode = savedView;

  // Load quiz style (vertical = all questions at once, pagination = one per page)
  quizStyle =
    userProfile && userProfile.getQuizStyle
      ? userProfile.getQuizStyle()
      : localStorage.getItem("quiz_style") || "pagination";
  if (quizStyle !== "vertical") quizStyle = "pagination";
  else {
    nextBtn.style.display = "none";
    prevBtn.style.display = "none";
  }

  // Update view toggle button
  if (els.viewIcon && els.viewText) {
    if (viewMode === "grid") {
      els.viewIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-icon lucide-list"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg>`;
      els.viewText.textContent = "شكل القائمة";
    } else {
      els.viewIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid-icon lucide-layout-grid"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;
      els.viewText.textContent = "شكل الأيقونات";
    }
  }

  try {
    // -----------------------------------------------------------
    // BRANCHING LOGIC: Check if this is a User Created Quiz or Standard Exam
    // -----------------------------------------------------------

    if (quizType === "user") {
      // === LOGIC FOR USER QUIZ ===
      let userQuizData = sessionStorage.getItem("active_user_quiz");

      // ── Bug 2 Fix: recover from localStorage when sessionStorage is empty ──
      // sessionStorage is tab-scoped and survives within a session.  However,
      // pressing the browser back button from the results page causes a full
      // page reload of quiz.html?id=…&type=user.  If the session storage item
      // was cleared (e.g. another quiz was opened in the same tab), the quiz
      // would show "Quiz not found!" and redirect to root instead of reloading.
      // As a fallback, scan the localStorage user_quizzes array for a matching
      // entry and restore it into sessionStorage so the quiz can continue.
      if (!userQuizData && examId) {
        try {
          const allUserQuizzes = JSON.parse(
            localStorage.getItem("user_quizzes") || "[]",
          );
          const recovered = allUserQuizzes.find((q) => q.id === examId);
          if (recovered) {
            userQuizData = JSON.stringify(recovered);
            // Restore so subsequent page interactions keep working normally.
            sessionStorage.setItem("active_user_quiz", userQuizData);
          }
        } catch (e) {
          console.warn(
            "[Quiz] Could not recover user quiz from localStorage:",
            e,
          );
        }
      }

      if (!userQuizData) {
        alert("Quiz not found!");
        window.location.href = "/";
        return;
      }

      const userQuiz = JSON.parse(userQuizData);

      // Map user questions to ensure correct format, handling both old and new essay style
      questions = userQuiz.questions.map((q) => {
        const out = { q: q.q };
        if (q.image) out.image = q.image;
        if (q.explanation) out.explanation = q.explanation;
        // Normalize essay: old 1-option → new answer field
        if (Array.isArray(q.options) && q.options.length === 1) {
          out.answer = q.options[0] ?? "";
        } else if (!Array.isArray(q.options) && q.answer !== undefined) {
          out.answer = q.answer;
        } else {
          out.options = q.options;
          if (q.correct !== undefined) out.correct = q.correct;
        }
        return out;
      });

      // Support both old flat schema (title) and new nested schema (meta.title)
      metaData = {
        title: userQuiz.meta?.title || userQuiz.title,
        category: "Your Quiz",
      };
    } else {
      // === LOGIC FOR STANDARD EXAM (Original Code) ===
      const { examList } = await getManifest();
      const config = examList.find((e) => e.id === examId);

      if (!config) {
        alert("Exam not found!");
        window.location.href = "/";
        return;
      }

      // Use optimized loader with caching
      const module = await loadExamModule(config);
      questions = module.questions;

      const parts = config.path.replace(/\\/g, "/").split("/");
      const filename = parts[parts.length - 1] || "";
      const name = filename.replace(/\.(json|js)$/i, "").replace(/[_-]+/g, " ");
      const fallbackTitle = name.replace(/\b\w/g, (c) => c.toUpperCase());
      // Prefer the title from the manifest over the one derived from filename
      metaData = {
        title: config.title || fallbackTitle,
        category: parts[parts.length - 2] || "",
      };
    }

    // -----------------------------------------------------------
    // SHARED LOGIC: UI Updates & Game Initialization
    // -----------------------------------------------------------

    // Update page title
    document.title = `إمتحان ${metaData.title}`;

    // Update Title UI
    if (els.title) {
      els.title.textContent = metaData.title || "Quiz";
    }

    // Setup Timer
    if (quizMode === "timed") {
      timeRemaining = questions.length * 30;
    }

    // Setup State Restoration
    if (startAt !== null) {
      currentIdx = parseInt(startAt);
    } else {
      // Note: We use examId here. For user quizzes, ensure examId is unique or handles collision
      const saved = localStorage.getItem(`quiz_state_${examId}`);
      if (saved && quizMode === "practice") {
        const state = JSON.parse(saved);
        if (await confirmationNotification("استئناف الإمتحان؟")) {
          currentIdx = state.currentIdx || 0;
          userAnswers = state.userAnswers || {};
          lockedQuestions = state.lockedQuestions || {};
          timeElapsed = state.timeElapsed || 0;
        } else {
          localStorage.removeItem(`quiz_state_${examId}`);
        }
      }
    }

    // Initialize Game Engine
    updateGamificationStats();
    renderMenuNavigation();
    renderQuestion();
    startTimer();

    // Global handlers
    window.handleSelect = (i) => handleSelect(i);
    window.handleEssayInput = () => handleEssayInput();
    window.checkAnswer = () => checkAnswer();
    window.toggleView = () => toggleView();
    window.toggleBookmark = () => {
      gameEngine.toggleBookmark(examId, currentIdx);
      renderQuestion();
      renderMenuNavigationDebounced();
    };
    window.toggleFlag = () => {
      gameEngine.toggleFlag(examId, currentIdx);
      renderQuestion();
      renderMenuNavigationDebounced();
    };
    window.toggleQuestionBookmark = (idx) => {
      gameEngine.toggleBookmark(examId, idx);
      renderMenuNavigationDebounced();
      if (idx === currentIdx) {
        renderQuestion();
      }
    };
    window.toggleQuestionFlag = (idx) => {
      gameEngine.toggleFlag(examId, idx);
      renderMenuNavigationDebounced();
      if (idx === currentIdx) {
        renderQuestion();
      }
    };

    window.shareQuestion = async () => {
      // close menu first
      const closeBtn = document.getElementById("closeMenuBtn");
      if (closeBtn) closeBtn.click();

      const questionCard =
        quizStyle === "vertical"
          ? document.getElementById(`q-${currentIdx}`)
          : document.querySelector(".question-card");
      if (!questionCard) return;

      try {
        if (!window.html2canvas) {
          showNotification("جاري التجهيز", "يتم تحضير الصورة للمشاركة", "info");
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src =
              "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }

        // hide buttons temporarily for the screenshot
        const actions = questionCard.querySelector(".question-actions");
        if (actions) actions.style.display = "none";
        const checkBtn = questionCard.querySelector(".check-answer-btn");
        if (checkBtn) checkBtn.style.display = "none";

        const canvas = await html2canvas(questionCard, {
          backgroundColor: getComputedStyle(document.body).backgroundColor,
          scale: 2,
        });

        // restore buttons
        if (actions) actions.style.display = "";
        if (checkBtn) checkBtn.style.display = "";

        canvas.toBlob(async (blob) => {
          const file = new File([blob], "question-share.png", {
            type: "image/png",
          });
          if (
            navigator.share &&
            navigator.canShare &&
            navigator.canShare({ files: [file] })
          ) {
            await navigator.share({
              files: [file],
              title: "سؤال من الإمتحان",
              text: "تحدى نفسك في هذا السؤال!",
            });
          } else {
            // fallback download
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "Basmagi Quiz Question.png";
            a.click();
            URL.revokeObjectURL(url);
            showNotification("تم", "تم تحميل صورة السؤال", "success");
          }
        });
      } catch (e) {
        console.error("Error sharing question", e);
        showNotification("خطأ", "حدث خطأ أثناء محاولة مشاركة السؤال", "error");
      }
    };

    window.copyCodeBlock = (btn) => {
      const wrapper = btn.closest(".code-block-wrapper");
      if (!wrapper) return;
      const codeEl = wrapper.querySelector("code");
      if (!codeEl) return;

      navigator.clipboard.writeText(codeEl.innerText).then(() => {
        const originalContent = btn.innerHTML;
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>`;
        btn.classList.add("copied");
        setTimeout(() => {
          btn.innerHTML = originalContent;
          btn.classList.remove("copied");
        }, 2000);
      });
    };
    window.jumpToQuestion = (idx) => {
      currentIdx = idx;
      saveStateDebounced();
      renderQuestion();
      renderMenuNavigationDebounced();

      const questionCard =
        quizStyle === "vertical"
          ? document.getElementById(`q-${idx}`)
          : document.querySelector(".question-card");
      if (questionCard) {
        questionCard.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    initKeyboardNav({
      onNext: () => nav(1),
      onPrev: () => nav(-1),
      onCheck: () => checkAnswer(),
      onBookmark: () => window.toggleBookmark(), // ← was empty
      onFlag: () => window.toggleFlag(), // ← was empty
      onSelect: (i) => {
        if (lockedQuestions[currentIdx]) return;
        const q = questions[currentIdx];
        if (!q?.options || i >= q.options.length) return; // ← add this line
        userAnswers[currentIdx] = i;
        saveStateDebounced();
        renderQuestion();
        renderMenuNavigationDebounced();
        maybeAutoSubmit();
      },
    });
    if (els.viewToggle) {
      els.viewToggle.addEventListener("click", toggleView);
    }
  } catch (err) {
    console.error("Initialization Error:", err);
    if (els.questionContainer) {
      els.questionContainer.innerHTML = `<p style="color:red">Failed to load quiz data. ${err.message}</p>`;
    }
  }
}

// === OPTIMIZED: Debounced navigation rendering ===
function renderMenuNavigationDebounced() {
  if (renderNavDebounce) clearTimeout(renderNavDebounce);
  renderNavDebounce = setTimeout(() => {
    renderMenuNavigation();
  }, 100); // Wait 100ms before re-rendering
}

// === OPTIMIZED: Menu Navigation with smart updates ===
function renderMenuNavigation() {
  let navContainer = document.getElementById("menuNavContainer");
  if (!navContainer) return;

  const flagCount = gameEngine.getFlaggedCount(examId);
  const flagInfo =
    flagCount > 0
      ? `<span class="menu-flag-count"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg> ذو علامة مرجعية:  ${flagCount}</span>`
      : "";

  if (viewMode === "grid") {
    renderGridView(navContainer, flagInfo);
  } else {
    renderListView(navContainer, flagInfo);
  }

  // Always refresh icons after re-rendering nav (fixes debounced icon stale state)
}

// === OPTIMIZED: Grid view with DocumentFragment ===
function renderGridView(navContainer, flagInfo) {
  // Use DocumentFragment for better performance
  const fragment = document.createDocumentFragment();
  const container = document.createElement("div");
  container.className = "menu-nav-items grid-view";

  // Build all items at once
  questions.forEach((q, idx) => {
    const item = createGridItem(q, idx);
    container.appendChild(item);
  });

  fragment.appendChild(container);

  // Single DOM update
  navContainer.innerHTML = `
    <div class="menu-nav-grid">
      <div class="menu-nav-header">التنقل بين الأسئلة</div>
      <div class="menu-nav-legend">
        <span><span class="legend-dot current"></span> الحالي</span>
        <span><span class="legend-dot answered"></span> سؤالٌ مُجاب</span>
        <span><span class="legend-dot correct"></span> صحيح</span>
        <span><span class="legend-dot wrong"></span> خطأ</span>
        ${flagInfo}
        </div>
    </div>
  `;
  navContainer.querySelector(".menu-nav-grid").appendChild(container);
}

// === Helper: Create grid item element ===
function createGridItem(q, idx) {
  const isAnswered = userAnswers[idx] !== undefined;
  const isLocked = lockedQuestions[idx];
  const isBookmarked = gameEngine.isBookmarked(examId, idx);
  const isFlagged = gameEngine.isFlagged(examId, idx);
  const isCurrent = idx === currentIdx;

  let statusClass = "unanswered";
  let statusIcon = "";

  if (isCurrent) {
    statusClass = "current";
  } else if (isLocked) {
    const correctIdx = q.correct ?? q.answer;
    const isCorrect = userAnswers[idx] === correctIdx;
    statusClass = isCorrect ? "correct" : "wrong";
    statusIcon = isCorrect ? "✓" : "✗";
  } else if (isAnswered) {
    statusClass = "answered";
    statusIcon = "●";
  }

  const button = document.createElement("button");
  button.className = `menu-nav-item grid-item ${statusClass}`;
  button.onclick = () => window.jumpToQuestion(idx);
  button.title = `Question ${idx + 1}${isBookmarked ? " - Bookmarked" : ""}${
    isFlagged ? " - Flagged" : ""
  }`;

  button.innerHTML = `
    <span>${idx + 1}</span>
    ${
      statusIcon
        ? `<span class="menu-nav-status grid-status">${statusIcon}</span>`
        : ""
    }
    ${
      isBookmarked || isFlagged
        ? `
      <div class="menu-nav-badges">
        ${isBookmarked ? '<span class="mini-badge bookmark"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-icon lucide-star"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg></span>' : ""}
        ${isFlagged ? '<span class="mini-badge flag"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg></span>' : ""}
      </div>
    `
        : ""
    }
  `;

  return button;
}

// === List view (similar optimization) ===
function renderListView(navContainer, flagInfo) {
  // 1. Clear the container completely
  navContainer.innerHTML = "";

  // 2. Add Header and Legend as flat elements
  const headerDiv = document.createElement("div");
  headerDiv.innerHTML = `
    <div class="menu-nav-header">التنقل بين الأسئلة</div>
    <div class="menu-nav-legend">
      <span><span class="legend-dot current"></span> الحالي</span>
      <span><span class="legend-dot answered"></span> سؤالٌ مُجاب</span>
      <span><span class="legend-dot correct"></span> صحيح</span>
      <span><span class="legend-dot wrong"></span> خطأ</span>
     ${flagInfo || ""}     
     </div>
   
  `;
  navContainer.appendChild(headerDiv);

  // 3. Create the list container (no height limits)
  const listContainer = document.createElement("div");
  listContainer.className = "menu-nav-items list-view";

  // 4. Append buttons
  questions.forEach((q, idx) => {
    listContainer.appendChild(createListItem(q, idx));
  });

  navContainer.appendChild(listContainer);
}

// === Helper: Create list item element ===
function createListItem(q, idx) {
  const isAnswered = userAnswers[idx] !== undefined;
  const isLocked = lockedQuestions[idx];
  const isBookmarked = gameEngine.isBookmarked(examId, idx);
  const isFlagged = gameEngine.isFlagged(examId, idx);
  const isCurrent = idx === currentIdx;

  let statusClass = "unanswered";
  let statusIcon = "";

  if (isCurrent) {
    statusClass = "current";
  } else if (isLocked) {
    const correctIdx = q.correct ?? q.answer;
    const isCorrect = userAnswers[idx] === correctIdx;
    statusClass = isCorrect ? "correct" : "wrong";
    statusIcon = isCorrect ? "✓" : "✗";
  } else if (isAnswered) {
    statusClass = "answered";
    statusIcon = "●";
  }

  const div = document.createElement("div");
  div.className = `menu-nav-item list-item ${statusClass}`;

  div.innerHTML = `
    <div class="menu-nav-item-left" onclick="window.jumpToQuestion(${idx})">
      <span class="menu-nav-number">Q${idx + 1}</span>
      ${
        statusIcon
          ? `<span class="menu-nav-status list-status">${statusIcon}</span>`
          : ""
      }
    </div>
    <div class="menu-nav-item-right">
      <span class="menu-nav-icon bookmark-icon ${isBookmarked ? "active" : ""}" 
            onclick="event.stopPropagation(); window.toggleQuestionBookmark(${idx})"
            title="${isBookmarked ? "Remove Bookmark" : "Bookmark"}">
        ${isBookmarked ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-off-icon lucide-star-off"><path d="m10.344 4.688 1.181-2.393a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.237 3.152"/><path d="m17.945 17.945.43 2.505a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a8 8 0 0 0 .4-.099"/><path d="m2 2 20 20"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-icon lucide-star"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>'}
      </span>
      <span class="menu-nav-icon flag-icon ${isFlagged ? "active" : ""}" 
            onclick="event.stopPropagation(); window.toggleQuestionFlag(${idx})"
            title="${isFlagged ? "إزالة العلامة" : "إضافة علامة للمراجعة"}">
        ${isFlagged ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-icon lucide-flag"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>'}
      </span>
    </div>
  `;

  return div;
}

// === Vertical style: build one question card HTML for index idx ===
function buildVerticalQuestionCard(q, idx) {
  const isEssay = isEssayQuestion(q);
  const correctIdx = q.correct ?? q.answer;
  const isLocked = !!lockedQuestions[idx];
  const userSelected = userAnswers[idx];
  const isBookmarked = gameEngine.isBookmarked(examId, idx);
  const isFlagged = gameEngine.isFlagged(examId, idx);
  const showCheckButton = quizMode !== "exam";
  let feedbackClass = "feedback";
  let feedbackText = "";
  const explanationText =
    q.explanation || q.desc || q.info || "No explanation provided.";

  if (isLocked) {
    let isCorrect;
    if (isEssay) {
      const essayScore = gradeEssay(userSelected, getEssayAnswer(q));
      isCorrect = essayScore >= 3;
      feedbackClass += " essay-feedback show";
      const stars = "★".repeat(essayScore) + "☆".repeat(5 - essayScore);
      feedbackText = `<strong>Score: ${essayScore}/5: ${stars}</strong><strong>Explanation:</strong> <div class="feedback-body">${renderMarkdown(normalizeLiteralNewlines(explanationText))}</div>`;
    } else {
      isCorrect = userSelected === correctIdx;
      feedbackClass += isCorrect ? " correct show" : " wrong show";
      feedbackText = `<div class="feedback-body"><strong>Explanation: </strong>${renderMarkdown(normalizeLiteralNewlines(explanationText))}</div>`;
    }
  }

  const actionBtns = `
    <div class="question-actions">
      <button class="bookmark-btn ${isBookmarked ? "active" : ""}" onclick="window.toggleQuestionBookmark(${idx})" title="${isBookmarked ? "Remove Bookmark" : "Bookmark"}">${isBookmarked ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-off-icon lucide-star-off"><path d="m10.344 4.688 1.181-2.393a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.237 3.152"/><path d="m17.945 17.945.43 2.505a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a8 8 0 0 0 .4-.099"/><path d="m2 2 20 20"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-icon lucide-star"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>`}</button>
      <button class="flag-btn ${isFlagged ? "active" : ""}" onclick="window.toggleQuestionFlag(${idx})" title="${isFlagged ? "إزالة العلامة" : "إضافة علامة للمراجعة"}">${isFlagged ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-icon lucide-flag"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>`}</button>
    </div>
  `;

  const header = `
    <div class="question-header">
      <div class="question-number">سؤال ${idx + 1} من ${questions.length}</div>
      ${actionBtns}
    </div>
    ${renderQuestionImage(q.image)}
    <h2 class="question-text">${renderMarkdown(normalizeLiteralNewlines(q.q))}</h2>
  `;

  if (isEssay) {
    return `
      <div class="question-card vertical-question-card" data-question-index="${idx}" id="q-${idx}">
        ${header}
        <div class="essay-container">
          <label for="essayInput-${idx}" class="essay-label">Your Answer:</label>
          <textarea id="essayInput-${idx}" class="essay-textarea ${isLocked ? "locked" : ""}" placeholder="Type your answer here..." ${isLocked ? "disabled" : ""} oninput="window.handleEssayInputForQuestion(${idx})">${escapeHtml(userSelected || "")}</textarea>
        </div>
        <button class="check-answer-btn ${isLocked || !showCheckButton ? "hidden" : ""}" onclick="window.checkAnswerForQuestion(${idx})" ${!userSelected || String(userSelected).trim() === "" ? "disabled" : ""}>Check Answer</button>
        ${isLocked ? `<div class="formal-answer"><strong>Formal Answer:</strong><div class="formal-answer-text">${renderMarkdown(normalizeLiteralNewlines(getEssayAnswer(q)))}</div></div>` : ""}
        <div class="${feedbackClass}">${feedbackText}</div>
      </div>
    `;
  }

  // === MCQ card ===
  const optionsHtml = q.options
    .map((opt, i) => {
      const isSelected = userSelected === i;
      let optionClass = "option-row";
      if (isSelected) optionClass += " selected";
      if (isLocked) {
        optionClass += " locked";
        if (i === correctIdx) optionClass += " correct";
        if (isSelected && i !== correctIdx) optionClass += " wrong";
      }
      return `
        <div class="${optionClass}" ${isLocked ? "" : `onclick="window.handleSelectForQuestion(${idx}, ${i})"`}>
          <input type="radio" name="answer-${idx}" ${isSelected ? "checked" : ""} ${isLocked ? "disabled" : ""} aria-label="Option ${i + 1}">
          <span class="option-label">${renderMarkdown(normalizeLiteralNewlines(opt))}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="question-card vertical-question-card" data-question-index="${idx}" id="q-${idx}">
      ${header}
      <div class="options-grid">${optionsHtml}</div>
      <button class="check-answer-btn ${isLocked || !showCheckButton ? "hidden" : ""}" onclick="window.checkAnswerForQuestion(${idx})" ${userSelected === undefined ? "disabled" : ""}>Check Answer</button>
      <div class="${feedbackClass}">${feedbackText}</div>
    </div>
  `;
}

function renderAllQuestionsVertical() {
  if (!els.questionContainer || !questions.length) return;

  const answeredCount = Object.keys(userAnswers).length;
  const progressPercent = (answeredCount / questions.length) * 100;
  if (els.progressFill) {
    els.progressFill.style.width = `${progressPercent}%`;
    els.progressFill.classList.toggle(
      "progress-near-complete",
      progressPercent >= 80,
    );
  }
  if (els.progressText)
    els.progressText.textContent = `${Math.round(progressPercent)}% (${answeredCount}/${questions.length})`;

  els.questionContainer.innerHTML = questions
    .map((q, idx) => buildVerticalQuestionCard(q, idx))
    .join("");
  els.questionContainer.classList.remove("loading");
  els.questionContainer.classList.add("vertical-style");
}

// === Core: Render Question ===
function renderQuestion() {
  if (!questions.length) return;

  if (quizStyle === "vertical") {
    renderAllQuestionsVertical();
    updateNav();
    return;
  }

  const q = questions[currentIdx];
  const isEssay = isEssayQuestion(q);
  const correctIdx = q.correct ?? q.answer;

  // Update Progress (only if changed)
  const answeredCount = Object.keys(userAnswers).length;
  const progressPercent = (answeredCount / questions.length) * 100;

  if (els.progressFill) {
    els.progressFill.style.width = `${progressPercent}%`;
    els.progressFill.classList.toggle(
      "progress-near-complete",
      progressPercent >= 80,
    );
  }
  if (els.progressText)
    els.progressText.textContent = `${Math.round(
      progressPercent,
    )}% (${answeredCount}/${questions.length})`;

  const isLocked = !!lockedQuestions[currentIdx];
  const userSelected = userAnswers[currentIdx];
  const isBookmarked = gameEngine.isBookmarked(examId, currentIdx);
  const isFlagged = gameEngine.isFlagged(examId, currentIdx);
  const showCheckButton = quizMode !== "exam";

  let feedbackClass = "feedback";
  let feedbackText = "";
  const explanationText =
    q.explanation || q.desc || q.info || "No explanation provided.";

  if (isLocked) {
    let isCorrect = false;

    if (isEssay) {
      const essayScore = gradeEssay(userSelected, getEssayAnswer(q));
      isCorrect = essayScore >= 3;
      feedbackClass += " essay-feedback show";
      const stars = "★".repeat(essayScore) + "☆".repeat(5 - essayScore);
      feedbackText = `<strong>Score: ${essayScore}/5: ${stars}</strong><strong>Explanation:</strong> <div class="feedback-body">${renderMarkdown(normalizeLiteralNewlines(explanationText))}</div>`;
    } else {
      isCorrect = userSelected === correctIdx;
      feedbackClass += isCorrect ? " correct show" : " wrong show";
      feedbackText = `<div class="feedback-body"><strong>Explanation: </strong>${renderMarkdown(
        normalizeLiteralNewlines(explanationText),
      )}</div>`;
    }
  }

  const actionButtons = `
    <div class="question-actions">
      <button class="bookmark-btn ${isBookmarked ? "active" : ""}" 
              onclick="window.toggleBookmark()" 
              title="${isBookmarked ? "Remove Bookmark" : "Bookmark"}">
        ${isBookmarked ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-off-icon lucide-star-off"><path d="m10.344 4.688 1.181-2.393a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.237 3.152"/><path d="m17.945 17.945.43 2.505a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a8 8 0 0 0 .4-.099"/><path d="m2 2 20 20"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-icon lucide-star"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>`}
      </button>
      <button class="flag-btn ${isFlagged ? "active" : ""}" 
              onclick="window.toggleFlag()" 
              title="${isFlagged ? "إزالة العلامة" : "إضافة علامة للمراجعة"}">
        ${isFlagged ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-icon lucide-flag"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>`}
      </button>
    </div>
  `;

  const questionHeaderHTML = `
    <div class="question-header">
      <div class="question-number">سؤال ${currentIdx + 1} من ${questions.length}</div>
      ${actionButtons}
    </div>
    ${renderQuestionImage(q.image)}
    <h2 class="question-text">${renderMarkdown(normalizeLiteralNewlines(q.q))}</h2>
  `;

  if (isEssay) {
    els.questionContainer.innerHTML = `
      <div class="question-card">
        ${questionHeaderHTML}
        <div class="essay-container">
          <label for="essayInput" class="essay-label">Your Answer:</label>
          <textarea 
            id="essayInput" 
            class="essay-textarea ${isLocked ? "locked" : ""}" 
            placeholder="Type your answer here..."
            ${isLocked ? "disabled" : ""}
            oninput="window.handleEssayInput()"
          >${escapeHtml(userSelected || "")}</textarea>
        </div>
        <button class="check-answer-btn ${
          isLocked || !showCheckButton ? "hidden" : ""
        }"
                id="checkBtn" onclick="window.checkAnswer()"
                ${
                  !userSelected || String(userSelected).trim() === ""
                    ? "disabled"
                    : ""
                }>
          Check Answer
        </button>
        ${
          isLocked
            ? `
          <div class="formal-answer">
            <strong>Formal Answer:</strong>
            <div class="formal-answer-text">${renderMarkdown(normalizeLiteralNewlines(getEssayAnswer(q)))}</div>
          </div>
        `
            : ""
        }
        <div class="${feedbackClass}">${feedbackText}</div>
      </div>
    `;
  } else {
    els.questionContainer.innerHTML = `
      <div class="question-card">
        ${questionHeaderHTML}
        <div class="options-grid">
          ${q.options
            .map((opt, i) => {
              const isSelected = userSelected === i;
              let optionClass = "option-row";
              if (isSelected) optionClass += " selected";
              if (isLocked) {
                optionClass += " locked";
                if (i === correctIdx) optionClass += " correct";
                if (isSelected && i !== correctIdx) optionClass += " wrong";
              }

              return `
              <div class="${optionClass}" ${
                isLocked ? "" : `onclick="window.handleSelect(${i})"`
              }>
                <input type="radio" name="answer" ${
                  isSelected ? "checked" : ""
                } 
                       ${isLocked ? "disabled" : ""} aria-label="Option ${
                         i + 1
                       }">
                <span class="option-label">${renderMarkdown(normalizeLiteralNewlines(opt))}</span>
              </div>`;
            })
            .join("")}
        </div>
        <button class="check-answer-btn ${
          isLocked || !showCheckButton ? "hidden" : ""
        }"
                id="checkBtn" onclick="window.checkAnswer()"
                ${userSelected === undefined ? "disabled" : ""}>
          Check Answer
        </button>
        <div class="${feedbackClass}">${feedbackText}</div>
      </div>
    `;
  }

  updateNav();
}

// === Event Handlers ===
function handleSelect(index) {
  if (lockedQuestions[currentIdx]) return;
  userAnswers[currentIdx] = index;
  saveStateDebounced();
  renderQuestion();
  renderMenuNavigationDebounced();
  maybeAutoSubmit();
}

function handleEssayInput() {
  if (lockedQuestions[currentIdx]) return;
  const textarea = document.getElementById("essayInput");
  if (textarea) {
    userAnswers[currentIdx] = textarea.value;
    saveStateDebounced();
    const checkBtn = document.getElementById("checkBtn");
    if (checkBtn) {
      checkBtn.disabled = !textarea.value.trim();
    }
  }
}

const maybeAutoSubmit = () => {
  if (autoSubmitTimeout) {
    clearTimeout(autoSubmitTimeout);
    autoSubmitTimeout = null;
  }

  const answered = Object.keys(userAnswers).length;
  if (answered === questions.length && questions.length > 0) {
    autoSubmitTimeout = setTimeout(async () => {
      try {
        if (
          await confirmationNotification(
            "لقد أجبت على جميع الأسئلة. هل تريد تسليم الإمتحان الآن؟",
          )
        ) {
          finish(true);
        }
      } catch (e) {
        console.error("Auto-submit error:", e);
      }
      autoSubmitTimeout = null;
    }, 5000);
  }
};

function nav(dir) {
  const newIdx = currentIdx + dir;
  if (newIdx < 0 || newIdx >= questions.length) return;
  currentIdx = newIdx;
  saveStateDebounced();
  renderQuestion();
  renderMenuNavigationDebounced();
  if (quizStyle === "vertical") {
    const el = document.getElementById(`q-${currentIdx}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function finish(skipconfirmationNotification) {
  if (autoSubmitTimeout) {
    clearTimeout(autoSubmitTimeout);
    autoSubmitTimeout = null;
  }

  if (
    !skipconfirmationNotification &&
    !(await confirmationNotification("هل تريد أن تسلم؟"))
  )
    return;

  stopTimer();

  let correctCount = 0; // MCQ points
  let essayScore = 0; // Essay points earned
  let essayMaxScore = 0; // Essay points possible
  let essayQuestions = [];

  questions.forEach((q, i) => {
    if (isEssayQuestion(q)) {
      essayQuestions.push(i);
      const score = gradeEssay(userAnswers[i], getEssayAnswer(q));
      essayScore += score;
      essayMaxScore += 5;
    } else {
      const correctIdx = q.correct ?? q.answer;
      if (userAnswers[i] === correctIdx) correctCount++;
    }
  });

  const mcqCount = questions.length - essayQuestions.length;
  const totalScore = correctCount + essayScore;
  const totalPossible = mcqCount + essayMaxScore;

  const rawResult = {
    examId,
    examTitle: metaData.title,
    questions: questions,
    score: totalScore,
    total: totalPossible,
    mcqScore: correctCount,
    mcqTotal: mcqCount,
    essayScore: essayScore,
    essayMaxScore: essayMaxScore,
    totalQuestions: questions.length,
    essayQuestions: essayQuestions,
    userAnswers,
    timeElapsed:
      quizMode === "timed"
        ? questions.length * 30 - timeRemaining
        : timeElapsed,
    mode: quizMode,
  };

  const gamifiedResult = gameEngine.processResult(rawResult);

  const finalOutput = {
    ...rawResult,
    gamification: gamifiedResult,
  };

  localStorage.setItem("last_quiz_result", JSON.stringify(finalOutput));
  localStorage.removeItem(`quiz_state_${examId}`);
  gameEngine.clearFlags(examId);

  // Clear quiz session data
  localStorage.removeItem("quiz_start_time");

  window.location.href = "result.html";
}

async function restart(skipconfirmationNotification) {
  // 1. confirmationNotification Intent
  if (
    !skipconfirmationNotification &&
    !(await confirmationNotification(
      "هل تريد إعادة الإمتحان؟ سيتم فقدان التقدم الحالي",
    ))
  )
    return;

  // 2. SAFETY: Kill the pending save timer immediately.
  // This prevents the previous state from overwriting our "clean slate"
  // 300ms after this function runs.
  if (saveStateDebounce) {
    clearTimeout(saveStateDebounce);
    saveStateDebounce = null;
  }

  // 3. Clear Intervals
  if (timerInterval) clearInterval(timerInterval);
  if (autoSubmitTimeout) {
    clearTimeout(autoSubmitTimeout);
    autoSubmitTimeout = null;
  }

  // 4. Wipe Storage
  localStorage.removeItem(`quiz_state_${examId}`);

  // 5. Reset Memory State
  currentIdx = 0;
  userAnswers = {};
  lockedQuestions = {};
  timeElapsed = 0;

  // 6. Reset Timed Mode Logic
  if (quizMode === "timed") {
    timeRemaining = questions.length * 30;
  }

  // 7. Reset UI
  if (els.timer) {
    els.timer.style.color = "";
    if (quizMode === "timed") {
      const mins = Math.floor(timeRemaining / 60)
        .toString()
        .padStart(2, "0");
      const secs = (timeRemaining % 60).toString().padStart(2, "0");
      els.timer.textContent = `${mins}:${secs}`;
    } else {
      els.timer.textContent = `00:00`;
    }
  }

  // 8. Re-render
  renderQuestion();
  renderMenuNavigation();
  startTimer();

  // 9. Scroll to top
  window.scrollTo(0, 0);
}

async function exit(skipconfirmationNotification) {
  if (
    !skipconfirmationNotification &&
    !(await confirmationNotification("هل أنت متأكد من الخروج؟"))
  )
    return;

  localStorage.removeItem(`quiz_state_${examId}`);

  localStorage.removeItem("quiz_start_time");

  window.location.href = "/";
}

function checkAnswer() {
  const q = questions[currentIdx];
  const isEssay = isEssayQuestion(q);

  if (isEssay) {
    const textarea = document.getElementById("essayInput");
    if (!textarea || !textarea.value.trim()) return;
  } else {
    if (userAnswers[currentIdx] === undefined) return;
  }

  lockedQuestions[currentIdx] = true;
  saveStateDebounced();
  renderQuestion();
  renderMenuNavigationDebounced();
  updateNav();
}

// === Utilities ===
function updateNav() {
  if (quizStyle === "vertical") {
    // In vertical mode, prev/next scroll to previous/next question card
    if (els.prevBtn) {
      els.prevBtn.disabled = currentIdx === 0;
      els.prevBtn.textContent = "السابق ←";
    }
    if (els.nextBtn) {
      els.nextBtn.disabled = currentIdx === questions.length - 1;
      els.nextBtn.textContent = "→ التالي";
    }
  } else {
    if (els.prevBtn) els.prevBtn.disabled = currentIdx === 0;
    if (els.nextBtn) {
      els.nextBtn.style.display = "inline-block";
      els.nextBtn.disabled = currentIdx === questions.length - 1;
    }
  }
  if (els.finishBtn) {
    els.finishBtn.style.display = "flex";
    const totalLocked = Object.keys(lockedQuestions).length;
  }
}

// === OPTIMIZED: Debounced save state ===
function saveStateDebounced() {
  if (quizMode === "timed") return;

  if (saveStateDebounce) clearTimeout(saveStateDebounce);
  saveStateDebounce = setTimeout(() => {
    const state = { currentIdx, userAnswers, timeElapsed, lockedQuestions };
    localStorage.setItem(`quiz_state_${examId}`, JSON.stringify(state));
    // NOTE: Do NOT call history.replaceState here (neither directly nor via
    // safeReplaceState).  This function only persists quiz progress to
    // localStorage.  Touching the browser history from a periodic debounce
    // timer is the root cause of the URL-stripping bug — if window.location
    // has been altered by another module, replaceState would stamp the
    // already-wrong URL into history and make it permanent.
  }, 300); // Wait 300ms before saving
}

// ── Bug 2 Fix: popstate listener ─────────────────────────────────────────────
// If future development adds history.pushState calls inside quiz.js (e.g. to
// give each question its own URL so the user can share a direct link), the back
// button will fire popstate *within* the quiz rather than causing a full page
// reload.  This listener handles that case by re-running init() so the quiz
// re-reads the (still-intact) URL parameters and restores to the correct state.
//
// For the current navigation model (finish() → window.location.href →
// result.html), pressing back causes a full reload and popstate never fires —
// init() is simply called fresh by the script loader, which is equally correct.
window.addEventListener("popstate", async () => {
  const params = new URLSearchParams(window.location.search);
  const hasQuizParams =
    params.get("id") !== null || params.get("type") !== null;
  if (hasQuizParams) {
    await init();
  }
});

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (quizMode === "timed") {
      timeRemaining--;
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        alert("Time's up! Submitting quiz...");
        finish(true);
        return;
      }

      const mins = Math.floor(timeRemaining / 60)
        .toString()
        .padStart(2, "0");
      const secs = (timeRemaining % 60).toString().padStart(2, "0");
      if (els.timer) {
        els.timer.textContent = `${mins}:${secs}`;
        if (timeRemaining < 30) els.timer.style.color = "var(--color-error)";
      }
    } else {
      timeElapsed++;
      const mins = Math.floor(timeElapsed / 60)
        .toString()
        .padStart(2, "0");
      const secs = (timeElapsed % 60).toString().padStart(2, "0");
      if (els.timer) els.timer.textContent = `${mins}:${secs}`;

      // Save less frequently during timer (every 10 seconds)
      if (timeElapsed % 10 === 0) {
        saveStateDebounced();
      }
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

// ============================================================================
// Bug 2 Fix — safeReplaceState
// Any history.replaceState call inside quiz.js MUST go through this helper.
// It updates the state object only and NEVER touches the URL string, so query
// parameters (?id=…&type=…) are preserved at all times.  If we were to pass a
// bare pathname such as "quiz.html" the params would be stripped and pressing
// the back button from the results page would return to a param-less URL that
// shows the "Exam not found" error.
// ============================================================================
function safeReplaceState(stateObj) {
  // Preserve the full URL (pathname + search + hash) — only update state.
  history.replaceState(stateObj, "", window.location.href);
}

// ============================================================================
// Bug 2 Fix — resetQuizState
// Cleans up all in-flight timers and resets every module-level variable to its
// initial value so that init() can be safely called again (e.g. when the user
// presses the back button and the browser re-fires the popstate event on a
// quiz.html?id=… history entry).
// ============================================================================
function resetQuizState() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (autoSubmitTimeout) {
    clearTimeout(autoSubmitTimeout);
    autoSubmitTimeout = null;
  }
  if (saveStateDebounce) {
    clearTimeout(saveStateDebounce);
    saveStateDebounce = null;
  }
  questions = [];
  metaData = {};
  currentIdx = 0;
  userAnswers = {};
  lockedQuestions = {};
  timeElapsed = 0;
  timeRemaining = 0;
}

init();

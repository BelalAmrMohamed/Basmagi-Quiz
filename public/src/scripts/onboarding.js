import { userProfile } from "./userProfile.js";
import { getManifest } from "./quizManifest.js";
import {
  extractMetadata,
  getAvailableYears,
  getAvailableTerms,
  filterCourses,
} from "../shared/filterUtils.js";

import {
  showNotification,
  // confirmationNotification,
} from "../components/notifications.js";

let categoryTree = null;
let currentStep = 0;
const totalSteps = 6;
const DRAFT_KEY = "onboarding_draft";

const state = {
  username: "",
  faculty: null,
  year: null,
  term: null,
  quizStyle: "pagination",
  defaultMode: "practice",
  subscribedCourses: [],
};

// ── Draft Persistence ─────────────────────────────────────────────────────────
// Saves progress to localStorage so a page reload resumes where the user left off.

function saveDraft() {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: currentStep,
        savedState: {
          ...state,
          subscribedCourses: [...state.subscribedCourses],
        },
      }),
    );
  } catch (e) {
    console.error("Failed to save onboarding draft", e);
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const { step, savedState } = JSON.parse(raw);
    if (savedState) Object.assign(state, savedState);
    if (typeof step === "number" && step >= 0 && step <= totalSteps) {
      currentStep = step;
    }
    // If resuming at the courses step with courses already in the draft,
    // skip the auto-subscription pass so the user's manual changes are kept.
    if (currentStep >= 5 && state.subscribedCourses.length > 0) {
      hasAutoSelected = true;
    }
  } catch (e) {
    console.error("Failed to load onboarding draft", e);
  }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

const facultyIcons = {
  Medicine: "🩺",
  Pharmacy: "💊",
  Dentistry: "🦷",
  Engineering: "⚙️",
  Science: "🔬",
  Arts: "🎨",
  Law: "⚖️",
  Commerce: "📊",
  "Computer Science": "💻",
  Nursing: "🏥",
  Agriculture: "🌾",
  Veterinary: "🐾",
  Education: "📚",
  default: "📖",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const manifest = await getManifest();
    categoryTree = manifest.categoryTree || {};
    loadDraft(); // restore step + state before first render
    setupEventListeners();
    renderStep();
  } catch (e) {
    console.error("Failed to load manifest", e);
    alert("Failed to load application data. Please refresh.");
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────────

function setupEventListeners() {
  document.getElementById("nextBtn").addEventListener("click", nextStep);
  document.getElementById("prevBtn").addEventListener("click", prevStep);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
      e.preventDefault();
      nextStep();
    }
  });

  document.getElementById("skipBtn")?.addEventListener("click", skipOnboarding);
}

// ── Progress ──────────────────────────────────────────────────────────────────

function updateProgress() {
  document.querySelectorAll(".progress-step").forEach((dot, idx) => {
    dot.classList.toggle("active", idx === currentStep);
    dot.classList.toggle("completed", idx < currentStep);
  });

  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const skipBtn = document.getElementById("skipBtn");

  prevBtn.style.visibility = currentStep === 0 ? "hidden" : "visible";
  nextBtn.textContent = currentStep === totalSteps ? "ابدأ رحلتك 🚀" : "التالي";
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateStep() {
  switch (currentStep) {
    case 0:
      state.username = document.getElementById("nameInput").value.trim();
      return state.username.length > 0;
    case 1:
      return !!state.faculty;
    case 2:
      return !!state.year;
    case 3:
      return !!state.term;
    case 4:
    case 5:
    default:
      return true;
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

async function nextStep() {
  if (!validateStep()) {
    showNotification("الرجاء إكمال البيانات المطلوبة");
    return;
  }
  if (currentStep < totalSteps) {
    currentStep++;
    saveDraft();
    renderStep();
  } else {
    await saveAndRedirect();
  }
}

function prevStep() {
  if (currentStep > 0) {
    currentStep--;
    saveDraft();
    renderStep();
  }
}

// ── Step Router ───────────────────────────────────────────────────────────────

function renderStep() {
  document
    .querySelectorAll(".step-panel")
    .forEach((el) => el.classList.remove("active"));

  const panel = document.getElementById(`step-${currentStep}`);
  if (panel) panel.classList.add("active");

  if (currentStep === 0) {
    // Restore the name field from draft so a reload doesn't blank it
    const nameInput = document.getElementById("nameInput");
    if (nameInput && state.username) nameInput.value = state.username;
  }
  if (currentStep === 1) renderFacultyStep();
  if (currentStep === 2) renderYearStep();
  if (currentStep === 3) renderTermStep();
  if (currentStep === 4) renderCoursesStep();
  if (currentStep === 6) renderWelcomeStep();

  updateProgress();
}

// ── Step Renderers ────────────────────────────────────────────────────────────

function renderFacultyStep() {
  const container = document.getElementById("facultyGrid");
  const metadata = extractMetadata(categoryTree);
  container.innerHTML = metadata.faculties
    .map(
      (f) => `
      <div class="selection-card ${state.faculty === f ? "selected" : ""}"
           onclick="selectFaculty('${escapeHtml(f)}')">
        <div class="card-icon">${facultyIcons[f] || facultyIcons.default}</div>
        <div class="card-label">${escapeHtml(f)}</div>
      </div>`,
    )
    .join("");
}

window.selectFaculty = (f) => {
  state.faculty = f;
  state.year = null;
  state.term = null;
  saveDraft();
  renderFacultyStep();
};

function renderYearStep() {
  const container = document.getElementById("yearGrid");
  const years = getAvailableYears(categoryTree, state.faculty);
  if (years.length === 0) {
    container.innerHTML =
      "<p>لا توجد سنوات دراسية متاحة لهذه الكلية حالياً.</p>";
    return;
  }
  container.innerHTML = years
    .map(
      (y) => `
      <div class="selection-card ${state.year === y ? "selected" : ""}"
           onclick="selectYear('${escapeHtml(y)}')">
        <div class="card-icon">📅</div>
        <div class="card-label">العام ${escapeHtml(y)}</div>
      </div>`,
    )
    .join("");
}

window.selectYear = (y) => {
  state.year = y;
  state.term = null;
  saveDraft();
  renderYearStep();
};

function renderTermStep() {
  const container = document.getElementById("termGrid");
  const terms = getAvailableTerms(categoryTree, state.faculty, state.year);
  if (terms.length === 0) {
    container.innerHTML = "<p>لا توجد فصول دراسية متاحة حالياً.</p>";
    return;
  }
  container.innerHTML = terms
    .map(
      (t) => `
      <div class="selection-card ${state.term === t ? "selected" : ""}"
           onclick="selectTerm('${escapeHtml(t)}')">
        <div class="card-icon">${t === "1" ? "🍂" : "🌸"}</div>
        <div class="card-label">الترم ${escapeHtml(t)}</div>
      </div>`,
    )
    .join("");
}

window.selectTerm = (t) => {
  state.term = t;
  saveDraft();
  renderTermStep();
};

window.updatePreference = (key, value) => {
  state[key] = value;
  document.querySelectorAll(`[name="${key}"]`).forEach((inp) => {
    const card = inp.closest(".selection-card");
    if (card) card.classList.toggle("selected", inp.value === value);
  });
  saveDraft();
};

// ── Courses Step ──────────────────────────────────────────────────────────────
//
//  Mirrors settings.js renderCourseManagerList() exactly:
//  • NO dropdown filters in this step — removed entirely.
//  • Filter profile uses only `faculty` (year + term omitted on purpose),
//    matching the commented-out lines in settings.js:
//      const tempProfile = {
//        faculty: faculty === "All" ? null : faculty,
//        // year: year === "All" ? null : year,   ← intentionally omitted
//        // term: term === "All" ? null : term,   ← intentionally omitted
//      };
//  • Result: every course for the user's college is shown, all years & terms.
// ─────────────────────────────────────────────────────────────────────────────

let hasAutoSelected = false;

function renderCoursesStep() {
  // Auto-subscribe courses that match the user's full profile (faculty+year+term)
  // once on first entry to this step — mirrors initializeDefaultSubscriptions.
  if (!hasAutoSelected) {
    filterCourses(categoryTree, {
      faculty: state.faculty,
      year: state.year,
      term: state.term,
    }).forEach((c) => {
      if (!state.subscribedCourses.includes(c.id)) {
        state.subscribedCourses.push(c.id);
      }
    });
    hasAutoSelected = true;
  }

  renderCourseList();
}

function renderCourseList() {
  const container = document.getElementById("coursesList");
  if (!container) return;

  // Faculty-only filter — mirrors settings.js tempProfile (year/term omitted)
  const tempProfile = {
    faculty: state.faculty, // null means show all
    // year intentionally omitted
    // term intentionally omitted
  };

  const allCourses = filterCourses(categoryTree, tempProfile);

  if (allCourses.length === 0) {
    container.innerHTML =
      '<p style="grid-column:1/-1;text-align:center;padding:20px;color:var(--color-text-secondary);">لا توجد مواد متاحة لكليتك حالياً</p>';
    return;
  }

  // HTML template is identical to settings.js renderCourseManagerList
  container.innerHTML = allCourses
    .map((course) => {
      const isSubscribed = state.subscribedCourses.includes(course.id);
      return `
        <div class="course-item">
          <div class="course-info">
            <h4>${escapeHtml(course.name)}</h4>
            <p class="course-details">
              ${escapeHtml(course.faculty)} | ${course.year} | ${course.term}
            </p>
          </div>
          <label class="toggle-container">
            <input type="checkbox"
              onchange="toggleCourse('${escapeHtml(course.id)}', this.checked)"
              ${isSubscribed ? "checked" : ""}>
            <span class="toggle-switch"></span>
          </label>
        </div>`;
    })
    .join("");
}

window.toggleCourse = (id, checked) => {
  if (checked) {
    if (!state.subscribedCourses.includes(id)) state.subscribedCourses.push(id);
  } else {
    state.subscribedCourses = state.subscribedCourses.filter(
      (cid) => cid !== id,
    );
  }
  saveDraft();
};

// ── Welcome Step ──────────────────────────────────────────────────────────────

function renderWelcomeStep() {
  const msg = document.getElementById("welcomeMsg");
  if (msg) msg.textContent = `أهلاً بك يا ${state.username}!`;
}

// ── Save & Redirect ───────────────────────────────────────────────────────────

async function saveAndRedirect() {
  try {
    userProfile.setUsername(state.username);
    userProfile.updateAcademicInfo({
      faculty: state.faculty,
      year: state.year,
      term: state.term,
    });
    userProfile.setQuizStyle(state.quizStyle);
    userProfile.setDefaultQuizMode(state.defaultMode);
    userProfile.setSubscribedCourses(state.subscribedCourses);

    clearDraft();
    localStorage.setItem("first_visit_complete", "true");

    // Restore preserved redirect
    const preservedHash = sessionStorage.getItem("intended_redirect_hash");
    if (preservedHash) {
      sessionStorage.removeItem("intended_redirect_hash");
      window.location.href = `index.html${preservedHash}`;
    } else {
      window.location.href = "/";
    }
  } catch (e) {
    console.error("Error saving", e);
    alert("حدث خطأ أثناء الحفظ");
  }
}

function skipOnboarding() {
  // Default any fields the user hasn't filled in yet to "All"
  if (!state.faculty) state.faculty = "All";
  if (!state.year) state.year = "All";
  if (!state.term) state.term = "All";

  // Auto-subscribe courses that match the profile the user DID set.
  // If any field is "All" this produces no matches, which is correct —
  // the user can always manage subscriptions later from settings.
  if (state.faculty !== "All" && state.year !== "All" && state.term !== "All") {
    filterCourses(categoryTree, {
      faculty: state.faculty,
      year: state.year,
      term: state.term,
    }).forEach((c) => {
      if (!state.subscribedCourses.includes(c.id)) {
        state.subscribedCourses.push(c.id);
      }
    });
  }

  userProfile.setUsername(state.username);
  userProfile.updateAcademicInfo({
    faculty: state.faculty,
    year: state.year,
    term: state.term,
  });
  userProfile.setQuizStyle(state.quizStyle);
  userProfile.setDefaultQuizMode(state.defaultMode);
  userProfile.setSubscribedCourses(state.subscribedCourses);

  clearDraft();
  localStorage.setItem("first_visit_complete", "true");

  // Restore preserved redirect
  const preservedHash = sessionStorage.getItem("intended_redirect_hash");
  if (preservedHash) {
    sessionStorage.removeItem("intended_redirect_hash");
    window.location.href = `index.html${preservedHash}`;
  } else {
    window.location.href = "/";
  }
}

// Start
init();

import { userProfile } from "./userProfile.js";
import { getManifest } from "./quizManifest.js";
import {
  getAvailableFaculties,
  getAvailableYears,
  getAvailableTerms,
  filterTrackCourses,
  filterFeaturedCourses,
  isUniversityTrack,
} from "../shared/filterUtils.js";

import {
  showNotification,
} from "../components/notifications.js";

let categoryTree = null;
let currentStepIndex = 0;
const DRAFT_KEY = "onboarding_draft";

const state = {
  username: "",
  education_type: null,
  faculty: null,
  year: null,
  term: null,
  quizStyle: "pagination",
  defaultMode: "practice",
  subscribedCourses: [],
};

const EDUCATION_TYPES = [
  { value: "Primary", label: "المدرسة الابتدائية", icon: "🎒" },
  { value: "Middle", label: "المدرسة الإعدادية", icon: "📘" },
  { value: "High", label: "المدرسة الثانوية", icon: "🎓" },
  { value: "University", label: "الجامعة", icon: "🏛️" },
];

const STEPS = [
  {
    id: "name",
    panel: "step-0",
    validate: () => state.username.length > 0,
  },
  {
    id: "educationType",
    panel: "step-1",
    validate: () => !!state.education_type,
    render: renderEducationTypeStep,
  },
  {
    id: "college",
    panel: "step-2",
    skip: () => !isUniversityTrack(state.education_type),
    validate: () => !!state.faculty,
    render: renderFacultyStep,
  },
  {
    id: "year",
    panel: "step-3",
    validate: () => !!state.year,
    render: renderYearStep,
  },
  {
    id: "term",
    panel: "step-4",
    validate: () => !!state.term,
    render: renderTermStep,
  },
  {
    id: "courses",
    panel: "step-5",
    validate: () => true,
    render: renderCoursesStep,
  },
  {
    id: "featured",
    panel: "step-6",
    validate: () => true,
    render: renderFeaturedStep,
  },
  {
    id: "preferences",
    panel: "step-7",
    validate: () => true,
  },
  {
    id: "welcome",
    panel: "step-8",
    validate: () => true,
    render: renderWelcomeStep,
  },
];

// ── Draft Persistence ─────────────────────────────────────────────────────────

function saveDraft() {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        stepIndex: currentStepIndex,
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
    const { stepIndex, step, savedState } = JSON.parse(raw);
    if (savedState) Object.assign(state, savedState);
    const resolvedIndex =
      typeof stepIndex === "number"
        ? stepIndex
        : typeof step === "number"
          ? step
          : 0;
    if (resolvedIndex >= 0 && resolvedIndex < STEPS.length) {
      currentStepIndex = resolvedIndex;
    }
    if (
      STEPS[currentStepIndex]?.id === "courses" &&
      state.subscribedCourses.length > 0
    ) {
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

function getActiveSteps() {
  return STEPS.filter((step) => !(step.skip && step.skip()));
}

function getCurrentStep() {
  return STEPS[currentStepIndex];
}

function findNextStepIndex(fromIndex) {
  for (let i = fromIndex + 1; i < STEPS.length; i++) {
    const step = STEPS[i];
    if (step.skip && step.skip()) continue;
    return i;
  }
  return -1;
}

function findPrevStepIndex(fromIndex) {
  for (let i = fromIndex - 1; i >= 0; i--) {
    const step = STEPS[i];
    if (step.skip && step.skip()) continue;
    return i;
  }
  return -1;
}

function getTrackFilters(overrides = {}) {
  const filters = {
    education_type: state.education_type,
    ...overrides,
  };

  if (isUniversityTrack(state.education_type)) {
    filters.faculty = state.faculty;
  }

  return filters;
}

function formatCourseDetails(course) {
  if (course.education_type === "Featured") return "";
  if (isUniversityTrack(course.education_type)) {
    return `${escapeHtml(course.faculty)} | ${course.year} | ${course.term}`;
  }
  return `${course.year} | ${course.term}`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const manifest = await getManifest();
    categoryTree = manifest.categoryTree || {};
    loadDraft();
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
  const activeSteps = getActiveSteps();
  const currentStep = getCurrentStep();
  const activeIndex = activeSteps.findIndex((s) => s.id === currentStep.id);
  const container = document.getElementById("progressContainer");

  if (container) {
    container.innerHTML = activeSteps
      .map((_, idx) => {
        let cls = "progress-step";
        if (idx === activeIndex) cls += " active";
        else if (idx < activeIndex) cls += " completed";
        return `<div class="${cls}"></div>`;
      })
      .join("");
  }

  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");

  prevBtn.style.visibility = findPrevStepIndex(currentStepIndex) < 0 ? "hidden" : "visible";
  nextBtn.textContent =
    currentStep.id === "welcome" ? "ابدأ رحلتك 🚀" : "التالي";
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateStep() {
  const step = getCurrentStep();
  if (step.id === "name") {
    state.username = document.getElementById("nameInput").value.trim();
  }
  return step.validate ? step.validate() : true;
}

// ── Navigation ────────────────────────────────────────────────────────────────

async function nextStep() {
  if (!validateStep()) {
    showNotification("الرجاء إكمال البيانات المطلوبة");
    return;
  }

  const step = getCurrentStep();
  if (step.id === "welcome") {
    await saveAndRedirect();
    return;
  }

  const nextIndex = findNextStepIndex(currentStepIndex);
  if (nextIndex >= 0) {
    currentStepIndex = nextIndex;
    saveDraft();
    renderStep();
  }
}

function prevStep() {
  const prevIndex = findPrevStepIndex(currentStepIndex);
  if (prevIndex >= 0) {
    currentStepIndex = prevIndex;
    saveDraft();
    renderStep();
  }
}

// ── Step Router ───────────────────────────────────────────────────────────────

function renderStep() {
  document
    .querySelectorAll(".step-panel")
    .forEach((el) => el.classList.remove("active"));

  const step = getCurrentStep();
  const panel = document.getElementById(step.panel);
  if (panel) panel.classList.add("active");

  if (step.id === "name") {
    const nameInput = document.getElementById("nameInput");
    if (nameInput && state.username) nameInput.value = state.username;
  }

  if (step.render) step.render();

  updateProgress();
}

// ── Step Renderers ────────────────────────────────────────────────────────────

function renderEducationTypeStep() {
  const container = document.getElementById("educationTypeGrid");
  if (!container) return;

  container.innerHTML = EDUCATION_TYPES.map(
    (type) => `
      <div class="selection-card ${state.education_type === type.value ? "selected" : ""}"
           onclick="selectEducationType('${type.value}')">
        <div class="card-icon">${type.icon}</div>
        <div class="card-label">${escapeHtml(type.label)}</div>
      </div>`,
  ).join("");
}

window.selectEducationType = (type) => {
  state.education_type = type;
  state.faculty = isUniversityTrack(type) ? null : "All";
  state.year = null;
  state.term = null;
  hasAutoSelected = false;
  state.subscribedCourses = [];
  saveDraft();
  renderEducationTypeStep();
};

function renderFacultyStep() {
  const container = document.getElementById("facultyGrid");
  if (!container) return;

  const faculties = getAvailableFaculties(categoryTree, "University");
  if (faculties.length === 0) {
    container.innerHTML =
      "<p>لا توجد كليات متاحة حالياً.</p>";
    return;
  }

  container.innerHTML = faculties
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
  hasAutoSelected = false;
  state.subscribedCourses = [];
  saveDraft();
  renderFacultyStep();
};

function renderYearStep() {
  const container = document.getElementById("yearGrid");
  if (!container) return;

  const years = getAvailableYears(categoryTree, getTrackFilters());
  if (years.length === 0) {
    container.innerHTML =
      "<p>لا توجد سنوات دراسية متاحة لهذا المسار حالياً.</p>";
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
  hasAutoSelected = false;
  state.subscribedCourses = [];
  saveDraft();
  renderYearStep();
};

function renderTermStep() {
  const container = document.getElementById("termGrid");
  if (!container) return;

  const terms = getAvailableTerms(
    categoryTree,
    getTrackFilters({ year: state.year }),
  );
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
  hasAutoSelected = false;
  state.subscribedCourses = [];
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

let hasAutoSelected = false;

function renderCoursesStep() {
  if (!hasAutoSelected) {
    const autoFilters = getTrackFilters({
      year: state.year,
      term: state.term,
    });
    
    state.subscribedCourses = [];

    filterTrackCourses(categoryTree, autoFilters).forEach((c) => {
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

  const displayFilters = getTrackFilters();
  const allCourses = filterTrackCourses(categoryTree, displayFilters);

  if (allCourses.length === 0) {
    container.innerHTML =
      '<p style="grid-column:1/-1;text-align:center;padding:20px;color:var(--color-text-secondary);">لا توجد مواد متاحة لمسارك الدراسي حالياً</p>';
    return;
  }

  container.innerHTML = allCourses
    .map((course) => {
      const isSubscribed = state.subscribedCourses.includes(course.id);
      const details = formatCourseDetails(course);
      return `
        <div class="course-item">
          <div class="course-info">
            <h4>${escapeHtml(course.name)}</h4>
            ${details ? `<p class="course-details">${details}</p>` : ""}
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

// ── Featured Step ─────────────────────────────────────────────────────────────

function renderFeaturedStep() {
  const container = document.getElementById("featuredCoursesList");
  if (!container) return;

  const featuredCourses = filterFeaturedCourses(categoryTree);

  if (featuredCourses.length === 0) {
    container.innerHTML =
      '<p style="grid-column:1/-1;text-align:center;padding:20px;color:var(--color-text-secondary);">لا توجد مواد مميزة متاحة حالياً</p>';
    return;
  }

  container.innerHTML = featuredCourses
    .map((course) => {
      const isSubscribed = state.subscribedCourses.includes(course.id);
      return `
        <div class="course-item">
          <div class="course-info">
            <h4>${escapeHtml(course.name)}</h4>
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

// ── Welcome Step ──────────────────────────────────────────────────────────────

function renderWelcomeStep() {
  const msg = document.getElementById("welcomeMsg");
  if (msg) msg.textContent = `أهلاً بك يا ${state.username}!`;
}

// ── Save & Redirect ───────────────────────────────────────────────────────────

function persistAcademicProfile() {
  userProfile.updateAcademicInfo({
    education_type: state.education_type,
    faculty: isUniversityTrack(state.education_type) ? state.faculty : "All",
    year: state.year,
    term: state.term,
  });
}

async function saveAndRedirect() {
  try {
    userProfile.setUsername(state.username);
    persistAcademicProfile();
    userProfile.setQuizStyle(state.quizStyle);
    userProfile.setDefaultQuizMode(state.defaultMode);
    userProfile.setSubscribedCourses(state.subscribedCourses);

    clearDraft();
    localStorage.setItem("first_visit_complete", "true");

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
  if (!state.education_type) state.education_type = "University";
  if (!state.faculty) {
    state.faculty = isUniversityTrack(state.education_type) ? "All" : "All";
  }
  if (!state.year) state.year = "All";
  if (!state.term) state.term = "All";

  if (
    state.education_type &&
    state.year !== "All" &&
    state.term !== "All" &&
    (isUniversityTrack(state.education_type)
      ? state.faculty && state.faculty !== "All"
      : true)
  ) {
    state.subscribedCourses = [];
    filterTrackCourses(
      categoryTree,
      getTrackFilters({ year: state.year, term: state.term }),
    ).forEach((c) => {
      if (!state.subscribedCourses.includes(c.id)) {
        state.subscribedCourses.push(c.id);
      }
    });
  }

  userProfile.setUsername(state.username || "User");
  persistAcademicProfile();
  userProfile.setQuizStyle(state.quizStyle);
  userProfile.setDefaultQuizMode(state.defaultMode);
  userProfile.setSubscribedCourses(state.subscribedCourses);

  clearDraft();
  localStorage.setItem("first_visit_complete", "true");

  const preservedHash = sessionStorage.getItem("intended_redirect_hash");
  if (preservedHash) {
    sessionStorage.removeItem("intended_redirect_hash");
    window.location.href = `index.html${preservedHash}`;
  } else {
    window.location.href = "/";
  }
}

init();

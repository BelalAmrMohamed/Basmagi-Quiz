// public/src/features/settings/settings.js - Settings page: education type, faculty, year, term, quiz style, default mode

// Temporary | For performance debugging
console.log("settings.js loaded successfully")


import { getManifest } from "../../shared/quizManifest.js";
import { userProfile } from "../../shared/userProfile.js";
import {
  getAvailableFaculties,
  getAvailableYears,
  getAvailableTerms,
  filterTrackCourses,
  filterFeaturedCourses,
  isUniversityTrack,
} from "../../shared/filterUtils.js";

const AUTOSAVE_DELAY = 800;

let categoryTree = null;
let autoSaveTimeout = null;
let isSaving = false;

function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getEducationType() {
  return document.getElementById("settingsEducationType")?.value || "University";
}

function getTrackFilters(overrides = {}) {
  const education_type = getEducationType();
  const faculty = document.getElementById("settingsFaculty")?.value;
  const year = document.getElementById("settingsYear")?.value;
  const term = document.getElementById("settingsTerm")?.value;

  const filters = {
    education_type,
    ...overrides,
  };

  if (isUniversityTrack(education_type) && faculty) {
    filters.faculty = faculty;
  }
  if (year) filters.year = year;
  if (term) filters.term = term;

  return filters;
}

function formatCourseDetails(course) {
  if (course.education_type === "Featured") return "";
  if (isUniversityTrack(course.education_type)) {
    return `${escapeHtml(course.faculty)} | ${course.year} | ${course.term}`;
  }
  return `${course.year} | ${course.term}`;
}

function toggleFacultyVisibility() {
  const row = document.getElementById("settingsFacultyRow");
  if (!row) return;
  row.style.display = isUniversityTrack(getEducationType()) ? "" : "none";
}

function setOptionCardsSelection(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((radio) => {
    const wrap = radio.closest(".option-card");
    if (wrap) {
      if (radio.value === value) {
        wrap.classList.add("selected");
        radio.checked = true;
      } else {
        wrap.classList.remove("selected");
        radio.checked = false;
      }
    }
  });
}

function bindOptionCards(name) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((radio) => {
    const wrap = radio.closest(".option-card");
    if (!wrap) return;
    wrap.addEventListener("click", () => {
      document
        .querySelectorAll(`.option-cards input[name="${name}"]`)
        .forEach((r) => {
          r.closest(".option-card")?.classList.remove("selected");
        });
      wrap.classList.add("selected");
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));
    });
  });
}

function setupCascade() {
  const educationTypeSelect = document.getElementById("settingsEducationType");
  const facultySelect = document.getElementById("settingsFaculty");
  const yearSelect = document.getElementById("settingsYear");
  const termSelect = document.getElementById("settingsTerm");

  if (!educationTypeSelect || !facultySelect || !yearSelect || !termSelect || !categoryTree) {
    return;
  }

  educationTypeSelect.addEventListener("change", () => {
    if (!isUniversityTrack(getEducationType())) {
      facultySelect.value = "All";
    }
    populateAcademic(
      getEducationType(),
      facultySelect.value,
      "All",
      "All",
    );
    toggleFacultyVisibility();
    renderCourseManagerList();
    renderFeaturedCourseManagerList();
  });

  facultySelect.addEventListener("change", () => {
    const education_type = getEducationType();
    const faculty = facultySelect.value;
    const years = isUniversityTrack(education_type)
      ? faculty === "All"
        ? getAvailableYears(categoryTree, { education_type, faculty: "All" })
        : getAvailableYears(categoryTree, { education_type, faculty })
      : getAvailableYears(categoryTree, { education_type });

    yearSelect.innerHTML =
      '<option value="All">All Years</option>' +
      years
        .map(
          (y) =>
            `<option value="${escapeHtml(y)}">العام ${escapeHtml(y)}</option>`,
        )
        .join("");
    yearSelect.value = "All";

    const terms = getAvailableTerms(categoryTree, {
      education_type,
      faculty: isUniversityTrack(education_type) ? faculty : undefined,
      year: "All",
    });
    termSelect.innerHTML =
      '<option value="All">All Terms</option>' +
      terms
        .map(
          (t) =>
            `<option value="${escapeHtml(t)}">الترم ${escapeHtml(t)}</option>`,
        )
        .join("");
    termSelect.value = "All";
  });

  yearSelect.addEventListener("change", () => {
    const education_type = getEducationType();
    const faculty = facultySelect.value;
    const year = yearSelect.value;
    const terms = getAvailableTerms(categoryTree, {
      education_type,
      faculty: isUniversityTrack(education_type) ? faculty : undefined,
      year,
    });
    const current = termSelect.value;
    termSelect.innerHTML =
      '<option value="All">All Terms</option>' +
      terms
        .map(
          (t) =>
            `<option value="${escapeHtml(t)}">الترم ${escapeHtml(t)}</option>`,
        )
        .join("");
    if (terms.includes(current)) termSelect.value = current;
    else termSelect.value = "All";
  });
}

function populateAcademic(education_type, faculty, year, term) {
  const educationTypeSelect = document.getElementById("settingsEducationType");
  const facultySelect = document.getElementById("settingsFaculty");
  const yearSelect = document.getElementById("settingsYear");
  const termSelect = document.getElementById("settingsTerm");
  if (!educationTypeSelect || !facultySelect || !yearSelect || !termSelect) {
    return;
  }

  educationTypeSelect.value = education_type || "University";

  if (isUniversityTrack(education_type)) {
    const faculties = getAvailableFaculties(categoryTree, "University");
    facultySelect.innerHTML =
      '<option value="All">All Faculties</option>' +
      faculties
        .map(
          (f) =>
            `<option value="${escapeHtml(f)}" ${f === faculty ? "selected" : ""}>${escapeHtml(f)}</option>`,
        )
        .join("");
  } else {
    facultySelect.innerHTML = '<option value="All">All Faculties</option>';
    facultySelect.value = "All";
  }

  const years = getAvailableYears(categoryTree, {
    education_type,
    faculty: isUniversityTrack(education_type) ? faculty : undefined,
  });
  yearSelect.innerHTML =
    '<option value="All">All Years</option>' +
    years
      .map(
        (y) =>
          `<option value="${escapeHtml(y)}" ${String(y) === String(year) ? "selected" : ""}>العام ${escapeHtml(y)}</option>`,
      )
      .join("");

  const terms = getAvailableTerms(categoryTree, {
    education_type,
    faculty: isUniversityTrack(education_type) ? faculty : undefined,
    year,
  });
  termSelect.innerHTML =
    '<option value="All">All Terms</option>' +
    terms
      .map(
        (t) =>
          `<option value="${escapeHtml(t)}" ${String(t) === String(term) ? "selected" : ""}>الترم ${escapeHtml(t)}</option>`,
      )
      .join("");

  toggleFacultyVisibility();
}

function showFeedback(message, isError = false) {
  const el = document.getElementById("saveFeedback");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError
    ? "var(--color-error, red)"
    : "var(--color-success, green)";
  if (message) {
    setTimeout(() => {
      el.textContent = "";
    }, 3000);
  }
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimeout);
  showSavingIndicator();

  autoSaveTimeout = setTimeout(async () => {
    await saveSettingsAuto();
  }, AUTOSAVE_DELAY);
}

function showSavingIndicator() {
  const feedback = document.getElementById("saveFeedback");
  if (feedback) {
    feedback.textContent = "💾 جاري الحفظ...";
    feedback.style.color = "var(--color-primary, #6366f1)";
    feedback.classList.add("saving");
  }
}

function showSavedIndicator() {
  const feedback = document.getElementById("saveFeedback");
  if (feedback) {
    feedback.textContent = "✓ تم الحفظ تلقائياً";
    feedback.style.color = "var(--color-success, #10b981)";
    feedback.classList.remove("saving");

    setTimeout(() => {
      feedback.textContent = "";
      feedback.classList.remove("saving");
    }, 2000);
  }
}

function unsubscribeTrackCourses(profile) {
  const oldMatchingCourses = filterTrackCourses(categoryTree, {
    education_type: profile.education_type || "University",
    faculty: profile.faculty,
    year: profile.year,
    term: profile.term,
  });
  const subscribedIds = userProfile.getSubscribedCourseIds();
  oldMatchingCourses.forEach((course) => {
    if (subscribedIds.includes(course.id)) {
      userProfile.unsubscribeFromCourse(course.id);
    }
  });
}

async function saveSettingsAuto() {
  if (isSaving) return;
  isSaving = true;

  try {
    const education_type = getEducationType();
    const faculty = document.getElementById("settingsFaculty")?.value;
    const year = document.getElementById("settingsYear")?.value;
    const term = document.getElementById("settingsTerm")?.value;

    const oldProfile = userProfile.getProfile();
    userProfile.updateAcademicInfo({
      education_type,
      faculty: isUniversityTrack(education_type) ? faculty : "All",
      year,
      term,
    });

    const academicInfoChanged =
      oldProfile.education_type !== education_type ||
      oldProfile.faculty !== (isUniversityTrack(education_type) ? faculty : "All") ||
      oldProfile.year !== year ||
      oldProfile.term !== term;

    if (academicInfoChanged) {
      const hadSpecificTrack =
        oldProfile.year !== "All" &&
        oldProfile.term !== "All" &&
        (isUniversityTrack(oldProfile.education_type || "University")
          ? oldProfile.faculty && oldProfile.faculty !== "All"
          : true);

      if (hadSpecificTrack) {
        unsubscribeTrackCourses(oldProfile);
      }

      userProfile.initializeDefaultSubscriptions(categoryTree);
      renderCourseManagerList();
      renderFeaturedCourseManagerList();
    }

    showSavedIndicator();
  } catch (error) {
    console.error("Auto-save failed:", error);
    showFeedback("فشل الحفظ التلقائي", true);
  } finally {
    isSaving = false;
  }
}

function setupAutoSave() {
  [
    "settingsEducationType",
    "settingsFaculty",
    "settingsYear",
    "settingsTerm",
  ].forEach((id) => {
    const select = document.getElementById(id);
    if (select) {
      select.addEventListener("change", () => {
        scheduleAutoSave();
        renderCourseManagerList();
        renderFeaturedCourseManagerList();
      });
    }
  });

  document.querySelectorAll('input[name="quizStyle"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      userProfile.setQuizStyle(radio.value);
      showFeedback("✓ تم تحديث نمط العرض", false);
    });
  });

  document.querySelectorAll('input[name="defaultMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      userProfile.setDefaultQuizMode(radio.value);
      showFeedback("✓ تم تحديث الوضع الافتراضي", false);
    });
  });
}

function renderCourseManagerList() {
  const listContainer = document.getElementById("courseManagerList");
  if (!listContainer) return;

  const displayFilters = getTrackFilters();
  delete displayFilters.year;
  delete displayFilters.term;

  const allCourses = filterTrackCourses(categoryTree, displayFilters);
  const subscribedIds = userProfile.getSubscribedCourseIds();

  if (allCourses.length === 0) {
    listContainer.innerHTML =
      '<p style="grid-column: 1/-1; text-align:center; padding:20px; color:var(--color-text-secondary);">لا توجد مواد تطابق خيارات العرض الحالية</p>';
    return;
  }

  listContainer.innerHTML = allCourses
    .map((course) => {
      const isSubscribed = subscribedIds.includes(course.id);
      const details = formatCourseDetails(course);
      return `
      <div class="course-item">
        <div class="course-info">
          <h4>${escapeHtml(course.name)}</h4>
          ${details ? `<p class="course-details">${details}</p>` : ""}
        </div>
        <label class="toggle-container">
            <input type="checkbox" onchange="toggleCourseSubscription('${escapeHtml(course.id)}')" ${isSubscribed ? "checked" : ""}>
            <span class="toggle-switch"></span>
        </label>
      </div>
    `;
    })
    .join("");
}

function renderFeaturedCourseManagerList() {
  const listContainer = document.getElementById("featuredCourseManagerList");
  if (!listContainer) return;

  const featuredCourses = filterFeaturedCourses(categoryTree);
  const subscribedIds = userProfile.getSubscribedCourseIds();

  if (featuredCourses.length === 0) {
    listContainer.innerHTML =
      '<p style="grid-column: 1/-1; text-align:center; padding:20px; color:var(--color-text-secondary);">لا توجد مواد مميزة متاحة حالياً</p>';
    return;
  }

  listContainer.innerHTML = featuredCourses
    .map((course) => {
      const isSubscribed = subscribedIds.includes(course.id);
      return `
      <div class="course-item">
        <div class="course-info">
          <h4>${escapeHtml(course.name)}</h4>
        </div>
        <label class="toggle-container">
            <input type="checkbox" onchange="toggleCourseSubscription('${escapeHtml(course.id)}')" ${isSubscribed ? "checked" : ""}>
            <span class="toggle-switch"></span>
        </label>
      </div>
    `;
    })
    .join("");
}

window.toggleCourseSubscription = function (courseId) {
  try {
    userProfile.toggleSubscription(courseId);
  } catch (error) {
    console.error("Error toggling subscription:", error);
  }
};

async function init() {
  try {
    const manifest = await getManifest();
    categoryTree = manifest.categoryTree || {};
  } catch (err) {
    console.error("Failed to load manifest:", err);
    categoryTree = {};
  }

  const profile = userProfile.getProfile();
  const education_type = profile.education_type || "University";

  populateAcademic(
    education_type,
    profile.faculty || "All",
    profile.year || "All",
    profile.term || "All",
  );
  setupCascade();

  renderCourseManagerList();
  renderFeaturedCourseManagerList();

  setOptionCardsSelection("quizStyle", profile.quizStyle || "pagination");
  setOptionCardsSelection("defaultMode", profile.defaultQuizMode || "practice");
  bindOptionCards("quizStyle");
  bindOptionCards("defaultMode");

  setupAutoSave();
}

init();

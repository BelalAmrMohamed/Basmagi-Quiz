// ============================================================================
// public/src/features/home/search-manager.js - Context-Aware Advanced Search System
// ============================================================================

import { userProfile } from "../../shared/userProfile.js";

export class SearchManager {
  constructor(containerSelector, onSearchCallback, getNavigationStack) {
    this.container = document.querySelector(containerSelector);
    this.onSearchCallback = onSearchCallback; // Callback when search results change
    this.getNavigationStack = getNavigationStack; // Function to get current navigation stack
    this.allCourses = [];
    this.filteredCourses = [];
    this.categoryTree = null;
    this.userQuizzes = [];
    this.currentContext = null; // 'courses' or 'quizzes' or 'userQuizzes'

    this.searchConfig = {
      debounceDelay: 300,
      minSearchLength: 1,
      maxHistoryItems: 10,
    };

    this.filters = {
      searchQuery: "",
      scope: "all", // 'all' | 'subscribed'
      contentType: "all", // 'all' | 'courses' | 'exams'
      educationType: "all", // 'all' | 'University' | 'High-School' | 'Middle-School' | 'Primary'
      faculty: "all",
      sortBy: "relevance", // 'relevance' | 'name' | 'recent' | 'progress'
    };

    // Persisted search preferences (separate from one-off search history).
    // educationType defaults to the user's own profile so results are relevant
    // out of the box, but the user's explicit choice (once made) always wins
    // and is remembered across sessions/pages.
    this.settings = this.loadSearchSettings();
    if (this.settings.educationType) {
      this.filters.educationType = this.settings.educationType;
    } else {
      const profile = userProfile.getProfile();
      if (profile && profile.education_type) {
        this.filters.educationType = profile.education_type;
      }
    }

    this.searchHistory = this.loadSearchHistory();
    this.debounceTimer = null;
    this.isFiltersPanelOpen = false;
    this.isBarOpen = false; // NEW: tracks whether the search bar is expanded

    // Store references to DOM elements
    this.elements = {};
  }

  /**
   * Initialize the search manager with course data
   */
  init(coursesData, categoryTree) {
    this.allCourses = coursesData;
    this.filteredCourses = coursesData;
    this.categoryTree = categoryTree;
    this.cacheElements();
    this.syncEducationTypeUI();
    this.bindSearchInput();
    this.bindFilterControls();
    this.bindFilterToggle();
    this.bindHeaderSearchBtn(); // NEW
    this.bindSearchClose(); // NEW — also handles clearing (merged button)
    this.populateFacultyFilter();
    this.bindResetFilters();
    this.setupKeyboardShortcuts();
    this.updateContextVisibility();
  }

  /**
   * Reflects the resolved initial education-type (from saved settings or the
   * user's profile) onto the filter-chip radios before the user touches them.
   */
  syncEducationTypeUI() {
    document
      .querySelectorAll('input[name="educationType"]')
      .forEach((radio) => {
        radio.checked = radio.value === this.filters.educationType;
      });
  }

  /**
   * Cache DOM element references for better performance
   */
  cacheElements() {
    this.elements = {
      searchInput: document.getElementById("courseSearch"),
      searchClose: document.getElementById("searchClose"), // merged clear+close button
      headerSearchBtn: document.getElementById("headerSearchBtn"), // NEW: header icon trigger
      filterToggle: document.getElementById("filterToggle"),
      searchFilters: document.getElementById("searchFilters"),
      searchSummary: document.getElementById("searchSummary"),
      resultCount: document.getElementById("resultCount"),
      activeFilterTags: document.getElementById("activeFilterTags"),
      facultyFilterGroup: document.getElementById("facultyFilterGroup"),
      facultyFilter: document.getElementById("facultyFilter"),
      sortBy: document.getElementById("sortBy"),
      applyFilters: document.getElementById("applyFilters"),
      resetFilters: document.getElementById("resetFilters"),
    };
  }

  /**
   * Update search context based on navigation.
   * Shows/hides the header trigger button. Does NOT open/close the bar itself.
   */
  updateContextVisibility() {
    const navStack = this.getNavigationStack ? this.getNavigationStack() : [];

    if (navStack.length === 0) {
      // Course categories view — search for courses
      this.currentContext = "courses";
      if (this.elements.searchInput) {
        this.elements.searchInput.placeholder = "ابحث عن مادة...";
      }
      // Show header trigger button
      if (this.elements.headerSearchBtn) {
        this.elements.headerSearchBtn.style.display = "flex";
      }
    } else {
      // Inside a course — search for quizzes
      const currentCategory = navStack[navStack.length - 1];

      if (currentCategory.name === "إمتحاناتك") {
        this.currentContext = "userQuizzes";
        if (this.elements.searchInput) {
          this.elements.searchInput.placeholder = "ابحث في اختباراتك...";
        }
        if (this.elements.headerSearchBtn) {
          this.elements.headerSearchBtn.style.display = "flex";
        }
      } else {
        const hasExams =
          currentCategory &&
          ((currentCategory.exams && currentCategory.exams.length > 0) ||
            (currentCategory.quizzes && currentCategory.quizzes.length > 0));

        this.currentContext = "quizzes";

        if (hasExams) {
          if (this.elements.searchInput) {
            this.elements.searchInput.placeholder = "ابحث عن اختبار...";
          }
          if (this.elements.headerSearchBtn) {
            this.elements.headerSearchBtn.style.display = "flex";
          }
        } else {
          // No exams — hide the trigger button and close the bar if open.
          // silent=true: this is a UI-visibility sync, not a user closing
          // search, so it must NOT cascade into onSearchCallback(isReset)
          // -> renderRootCategories(), which would wipe the URL/view we're
          // in the middle of navigating to (see index.js renderCategory()).
          if (this.elements.headerSearchBtn) {
            this.elements.headerSearchBtn.style.display = "none";
          }
          this.closeSearchBar(true);
        }
      }
    }

    // Show/hide filters toggle (only relevant in course context)
    if (this.elements.filterToggle) {
      this.elements.filterToggle.style.display =
        this.currentContext === "courses" ? "flex" : "none";
    }

    // When context changes (e.g. navigated to a different view), close the bar cleanly
    // but DON'T call clearSearch() to avoid the render loop — just reset internal state
    this._resetSearchState();
  }

  /**
   * Reset search state without triggering a render callback.
   * Used internally when context changes.
   */
  _resetSearchState() {
    this.filters.searchQuery = "";
    if (this.elements.searchInput) {
      this.elements.searchInput.value = "";
    }
    this.updateCloseButtonMode("");
    if (this.elements.searchSummary) {
      this.elements.searchSummary.style.display = "none";
    }
  }

  // ===========================
  // SEARCH INPUT HANDLING
  // ===========================

  bindSearchInput() {
    if (!this.elements.searchInput) return;

    this.elements.searchInput.addEventListener("input", (e) => {
      this.handleSearchInput(e.target.value);
    });

    this.elements.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.performSearch();
      } else if (e.key === "Escape") {
        // Close bar entirely on Escape
        this.closeSearchBar();
      }
    });
  }

  handleSearchInput(query) {
    // The single close/clear button's behavior depends on whether there's text
    this.updateCloseButtonMode(query);

    // Clear previous debounce timer
    clearTimeout(this.debounceTimer);

    // Debounce the search
    this.debounceTimer = setTimeout(() => {
      this.filters.searchQuery = query;
      this.performSearch();
    }, this.searchConfig.debounceDelay);
  }

  /**
   * The merged close/clear button (#searchClose) does double duty:
   *  - text present  → clears the text, keeps the bar open
   *  - text empty     → closes the whole search bar
   * This just updates its label/title so it's accessible; the click handler
   * itself checks the input value at click-time (see bindSearchClose).
   */
  updateCloseButtonMode(query) {
    if (!this.elements.searchClose) return;
    const hasText = Boolean(query);
    this.elements.searchClose.setAttribute(
      "aria-label",
      hasText ? "مسح البحث" : "إغلاق البحث",
    );
    this.elements.searchClose.title = hasText ? "مسح البحث" : "إغلاق البحث";
    this.elements.searchClose.classList.toggle("mode-clear", hasText);
  }

  // ===========================
  // SEARCH LOGIC
  // ===========================

  performSearch() {
    if (this.currentContext === "courses") {
      this.searchCourses();
    } else if (this.currentContext === "quizzes") {
      this.searchQuizzes();
    } else if (this.currentContext === "userQuizzes") {
      this.searchUserQuizzes();
    }
  }

  /**
   * Search for courses (in course categories view)
   */
  searchCourses() {
    let results = [...this.allCourses];

    // Apply scope filter (subscribed only)
    let scopedCourses = this.filterByTrackScope(results);

    // Apply education-type filter
    if (this.filters.educationType !== "all") {
      scopedCourses = this.filterByEducationType(scopedCourses);
    }

    // Apply faculty filter (only meaningful within University results)
    if (this.filters.faculty !== "all") {
      scopedCourses = this.filterByFaculty(scopedCourses);
    }

    // DEEP SEARCH LOGIC
    if (
      this.filters.contentType === "exams" &&
      this.filters.searchQuery &&
      this.filters.searchQuery.length >= this.searchConfig.minSearchLength
    ) {
      const allExams = [];
      const visited = new Set();
      scopedCourses.forEach((course) => {
        allExams.push(...this.collectAllExams(course, visited));
      });
      
      const quizResults = this.filterQuizzesBySearchQuery(allExams);
      this.addToSearchHistory(this.filters.searchQuery);
      
      const sortedQuizzes = this.sortQuizzes(quizResults);
      
      this.filteredCourses = sortedQuizzes;
      this.updateUI(sortedQuizzes);
      
      if (this.onSearchCallback) {
        this.onSearchCallback(sortedQuizzes, "quizzes");
      }
      return;
    }

    // NORMAL COURSE SEARCH
    results = scopedCourses;

    // Apply search query to courses
    if (
      this.filters.searchQuery &&
      this.filters.searchQuery.length >= this.searchConfig.minSearchLength
    ) {
      results = this.filterCoursesBySearchQuery(results);
      this.addToSearchHistory(this.filters.searchQuery);
    }

    // Apply content type filter (for courses)
    if (this.filters.contentType !== "all") {
      results = this.filterByContentType(results);
    }

    // Apply sorting
    results = this.sortResults(results);

    this.filteredCourses = results;
    this.updateUI(results);

    // Trigger callback to update the main view
    if (this.onSearchCallback) {
      this.onSearchCallback(results, "courses");
    }
  }

  /**
   * Search for quizzes/exams inside the current course.
   * Uses collectAllExams() to recursively gather quizzes from all subcategories,
   * so a search for "Lecture 1" inside "Computer Network" will also find quizzes
   * sitting inside "أسئلة الدكتورة", "أسئلة بالذكاء الإصطناعي", and any other
   * nested subfolder — not just the quizzes at the top level.
   */
  searchQuizzes() {
    const navStack = this.getNavigationStack ? this.getNavigationStack() : [];
    if (navStack.length === 0) return;

    const currentCategory = navStack[navStack.length - 1];
    if (!currentCategory) return;

    // Collect every exam in the whole subtree (current node + all subcategories, recursively)
    const allExams = this.collectAllExams(currentCategory);
    if (allExams.length === 0) return;

    let results = allExams;

    // Apply search query filter
    if (
      this.filters.searchQuery &&
      this.filters.searchQuery.length >= this.searchConfig.minSearchLength
    ) {
      results = this.filterQuizzesBySearchQuery(results);
      this.addToSearchHistory(this.filters.searchQuery);
    }

    // Sort
    results = this.sortQuizzes(results);

    this.updateUI(results);

    if (this.onSearchCallback) {
      this.onSearchCallback(results, "quizzes");
    }
  }

  // NEW: Search User Quizzes
  searchUserQuizzes() {
    if (!this.userQuizzes || this.userQuizzes.length === 0) {
      if (this.onSearchCallback) this.onSearchCallback([], "userQuizzes");
      return;
    }

    let results = this.userQuizzes;

    // Apply search query filter
    if (
      this.filters.searchQuery &&
      this.filters.searchQuery.length >= this.searchConfig.minSearchLength
    ) {
      results = this.filterUserQuizzesBySearchQuery(results);
      this.addToSearchHistory(this.filters.searchQuery);
    }

    this.updateUI(results);

    if (this.onSearchCallback) {
      this.onSearchCallback(results, "userQuizzes");
    }
  }

  setUserQuizzesContext(quizzes) {
    this.userQuizzes = quizzes;
    this.currentContext = "userQuizzes";
  }

  /**
   * Recursively collect every exam from a category node AND all its subcategory nodes.
   *
   * The manifest structure is:
   *   category.exams          → array of exam objects at this level
   *   category.subcategories  → array of string keys into this.categoryTree
   *
   * Each collected exam gets a _sourceCategoryName field so the render layer
   * can optionally display which subfolder the quiz came from.
   *
   * @param  {object} category  - a categoryTree node
   * @param  {Set}    visited   - guards against circular refs in malformed data
   * @returns {Array}           - flat, deduplicated list of exam objects
   */
  collectAllExams(category, visited = new Set()) {
    if (!category) return [];

    // Prevent infinite loops
    const nodeKey = category.id || category.name;
    if (nodeKey && visited.has(nodeKey)) return [];
    if (nodeKey) visited.add(nodeKey);

    // Direct exams at this level (support both "exams" and "quizzes" property names)
    const directExams = (category.exams || category.quizzes || []).map(
      (exam) => ({
        ...exam,
        _sourceCategoryName: category.name || "",
      }),
    );

    // Recursively collect from all child subcategories
    const childExams = [];
    if (Array.isArray(category.subcategories) && this.categoryTree) {
      for (const subKey of category.subcategories) {
        const subCat = this.categoryTree[subKey];
        if (subCat) {
          childExams.push(...this.collectAllExams(subCat, visited));
        }
      }
    }

    return [...directExams, ...childExams];
  }

  filterCoursesBySearchQuery(courses) {
    const query = this.filters.searchQuery.toLowerCase().trim();
    const terms = query.split(/\s+/);

    return courses.filter((course) => {
      const searchableText = [
        course.name || "",
        course.id || "",
        course.code || "",
        course.faculty || "",
        course.description || "",
        course.education_type || "",
        (course.tags || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();

      // All terms must match (AND logic)
      return terms.every((term) => searchableText.includes(term));
    });
  }

  filterQuizzesBySearchQuery(quizzes) {
    const query = this.filters.searchQuery.toLowerCase().trim();
    const terms = query.split(/\s+/);

    return quizzes.filter((quiz) => {
      const searchableText = [
        quiz.title || "",
        quiz.name || "", // some datasets use "name" instead of "title"
        quiz.id || "",
        quiz.description || "",
        quiz.education_type || "",
        quiz.category || "", // e.g. "Computer Network/أسئلة الدكتورة"
        quiz._sourceCategoryName || "", // human-readable subfolder name injected by collectAllExams
      ]
        .join(" ")
        .toLowerCase();

      // All terms must match (AND logic)
      return terms.every((term) => searchableText.includes(term));
    });
  }

  filterUserQuizzesBySearchQuery(quizzes) {
    const query = this.filters.searchQuery.toLowerCase().trim();
    const terms = query.split(/\s+/);

    return quizzes.filter((quiz) => {
      const searchableText = [quiz.title || "", quiz.description || ""]
        .join(" ")
        .toLowerCase();

      // All terms must match (AND logic)
      return terms.every((term) => searchableText.includes(term));
    });
  }

  filterByTrackScope(courses) {
    if (this.filters.scope === "all") return courses;
    
    const profile = userProfile.getProfile();
    const education_type = profile ? profile.education_type : null;
    const ids = userProfile.getSubscribedCourseIds();
    
    return courses.filter((c) => {
      if (c.education_type === "Featured") return ids.includes(c.id);
      if (!ids.includes(c.id)) return false;
      if (education_type && c.education_type !== education_type) return false;
      return true;
    });
  }

  filterByContentType(courses) {
    return courses.filter((c) => {
      const hasExams = c.exams && c.exams.length > 0;
      const hasSubcategories = c.subcategories && c.subcategories.length > 0;

      if (this.filters.contentType === "courses") {
        // Show courses that have subcategories
        return hasSubcategories;
      } else if (this.filters.contentType === "exams") {
        // Show courses that have exams
        return hasExams;
      }
      return true;
    });
  }

  filterByEducationType(courses) {
    // Map HTML filter values back to manifest values
    const educationTypeMap = {
      "High-School": "High",
      "Middle-School": "Middle",
    };
    const mappedFilter = educationTypeMap[this.filters.educationType] || this.filters.educationType;

    return courses.filter((c) => {
      // Featured is a course-level tag, not an education level — it isn't one
      // of the choices in the education-type filter, so it's never excluded
      // by it (mirrors how filterByTrackScope treats Featured).
      if (c.education_type === "Featured") return true;
      return c.education_type === mappedFilter;
    });
  }

  filterByFaculty(courses) {
    return courses.filter((c) => c.faculty === this.filters.faculty);
  }

  sortResults(courses) {
    const sortFunctions = {
      relevance: (a, b) => {
        if (!this.filters.searchQuery) return 0;

        const query = this.filters.searchQuery.toLowerCase();
        const aName = (a.name || "").toLowerCase();
        const bName = (b.name || "").toLowerCase();

        // Prioritize exact matches
        const aExact = aName === query ? 2 : 0;
        const bExact = bName === query ? 2 : 0;

        // Prioritize starts with
        const aStarts = aName.startsWith(query) ? 1 : 0;
        const bStarts = bName.startsWith(query) ? 1 : 0;

        const aScore = aExact + aStarts;
        const bScore = bExact + bStarts;

        return bScore - aScore || aName.localeCompare(bName, "ar");
      },

      name: (a, b) => {
        const aName = (a.name || "").toLowerCase();
        const bName = (b.name || "").toLowerCase();
        return aName.localeCompare(bName, "ar");
      },

      recent: (a, b) => {
        const timeA = this.getLastAttemptTime(a.id) || 0;
        const timeB = this.getLastAttemptTime(b.id) || 0;
        return timeB - timeA;
      },

      progress: (a, b) => {
        const progA = this.getProgress(a.id) || 0;
        const progB = this.getProgress(b.id) || 0;
        return progB - progA;
      },
    };

    const sortFn =
      sortFunctions[this.filters.sortBy] || sortFunctions.relevance;
    return [...courses].sort(sortFn);
  }

  sortQuizzes(quizzes) {
    const query = this.filters.searchQuery.toLowerCase();

    return [...quizzes].sort((a, b) => {
      if (!query) return 0;

      const aTitle = (a.title || "").toLowerCase();
      const bTitle = (b.title || "").toLowerCase();

      // Prioritize exact matches
      const aExact = aTitle === query ? 2 : 0;
      const bExact = bTitle === query ? 2 : 0;

      // Prioritize starts with
      const aStarts = aTitle.startsWith(query) ? 1 : 0;
      const bStarts = bTitle.startsWith(query) ? 1 : 0;

      const aScore = aExact + aStarts;
      const bScore = bExact + bStarts;

      return bScore - aScore || aTitle.localeCompare(bTitle, "ar");
    });
  }

  // ===========================
  // FILTER CONTROLS
  // ===========================

  bindFilterControls() {
    // Search scope radio buttons
    document.querySelectorAll('input[name="searchScope"]').forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.filters.scope = e.target.value;
        this.performSearch();
        this.updateActiveFilters();
      });
    });

    // Content type radio buttons
    document.querySelectorAll('input[name="contentType"]').forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.filters.contentType = e.target.value;
        this.performSearch();
        this.updateActiveFilters();
      });
    });

    // Education-type radio buttons
    document
      .querySelectorAll('input[name="educationType"]')
      .forEach((radio) => {
        radio.addEventListener("change", (e) => {
          this.filters.educationType = e.target.value;
          this.setEducationTypeSetting(e.target.value);
          this.updateFacultyVisibility();
          this.performSearch();
          this.updateActiveFilters();
        });
      });

    // Faculty filter
    if (this.elements.facultyFilter) {
      this.elements.facultyFilter.addEventListener("change", (e) => {
        this.filters.faculty = e.target.value;
        this.performSearch();
        this.updateActiveFilters();
      });
    }

    // Sort by
    if (this.elements.sortBy) {
      this.elements.sortBy.addEventListener("change", (e) => {
        this.filters.sortBy = e.target.value;
        this.performSearch();
        this.updateActiveFilters();
      });
    }
  }

  populateFacultyFilter() {
    if (!this.elements.facultyFilter) return;

    // Extract unique faculties from University-track courses only — faculty
    // is a University-only concept, so School/Middle/Primary courses (which
    // never carry a meaningful faculty) shouldn't pollute this list.
    const faculties = new Set();
    this.allCourses.forEach((course) => {
      if (course.faculty && course.education_type === "University") {
        faculties.add(course.faculty);
      }
    });

    // Clear existing options except "All"
    this.elements.facultyFilter.innerHTML =
      '<option value="all">جميع الكليات</option>';

    // Add faculty options
    Array.from(faculties)
      .sort((a, b) => a.localeCompare(b, "ar"))
      .forEach((faculty) => {
        const option = document.createElement("option");
        option.value = faculty;
        option.textContent = faculty;
        this.elements.facultyFilter.appendChild(option);
      });

    this.updateFacultyVisibility();
  }

  /**
   * Faculty only makes sense for University courses (schools don't have
   * faculties), so the whole filter section is hidden unless the education-
   * type filter is explicitly set to "University".
   */
  updateFacultyVisibility() {
    const group = this.elements.facultyFilterGroup;
    if (!group) return;

    const show = this.filters.educationType === "University";
    group.style.display = show ? "" : "none";

    // If the section is hidden, the faculty filter should not silently keep
    // narrowing results the user can no longer see or change.
    if (!show && this.filters.faculty !== "all") {
      this.filters.faculty = "all";
      if (this.elements.facultyFilter) {
        this.elements.facultyFilter.value = "all";
      }
    }
  }

  // ===========================
  // UI CONTROLS
  // ===========================

  /**
   * NEW: Bind the header icon button that opens the search bar
   */
  bindHeaderSearchBtn() {
    if (!this.elements.headerSearchBtn) return;

    this.elements.headerSearchBtn.addEventListener("click", () => {
      if (this.isBarOpen) {
        this.closeSearchBar();
      } else {
        this.openSearchBar();
      }
    });
  }

  /**
   * Bind the single merged close/clear button:
   *  - if there's text in the input, clear it (bar stays open)
   *  - if the input is already empty, close the whole search bar
   */
  bindSearchClose() {
    if (!this.elements.searchClose) return;

    this.elements.searchClose.addEventListener("click", () => {
      const hasText = Boolean(
        this.elements.searchInput && this.elements.searchInput.value,
      );
      if (hasText) {
        this.clearSearch();
      } else {
        this.closeSearchBar();
      }
    });
  }

  /**
   * NEW: Expand the search bar below the header and focus the input
   */
  openSearchBar() {
    if (!this.container) return;
    this.isBarOpen = true;
    this.container.classList.add("is-open");
    this.container.setAttribute("aria-hidden", "false");
    if (this.elements.headerSearchBtn) {
      this.elements.headerSearchBtn.setAttribute("aria-expanded", "true");
    }
    // Auto-focus the input
    setTimeout(() => {
      if (this.elements.searchInput) {
        this.elements.searchInput.focus();
      }
    }, 80);
  }

  /**
   * NEW: Collapse the search bar and reset search state + view
   */
  closeSearchBar(silent = false) {
    if (!this.container) return;
    this.isBarOpen = false;
    this.container.classList.remove("is-open");
    this.container.setAttribute("aria-hidden", "true");
    if (this.elements.headerSearchBtn) {
      this.elements.headerSearchBtn.setAttribute("aria-expanded", "false");
    }
    // Close filters panel too
    if (this.isFiltersPanelOpen) {
      this.isFiltersPanelOpen = false;
      if (this.elements.searchFilters) {
        this.elements.searchFilters.style.display = "none";
      }
      if (this.elements.filterToggle) {
        this.elements.filterToggle.classList.remove("active");
        this.elements.filterToggle.setAttribute("aria-expanded", "false");
      }
    }
    // Trigger a reset (restores original view) — but ONLY for a genuine
    // user-initiated close (× button / Escape). Callers that are merely
    // syncing UI visibility (e.g. updateContextVisibility() when a category
    // has no exams) pass silent=true so we don't cascade into
    // onSearchCallback -> renderRootCategories(), which would wipe out
    // whatever view/URL the app just navigated to.
    if (!silent && (this.filters.searchQuery || this.hasActiveFilters())) {
      this._resetSearchState();
      // Signal a full reset to index.js so it can re-render the proper root view
      if (this.onSearchCallback) {
        this.onSearchCallback(null, this.currentContext, true /* isReset */);
      }
    } else if (silent) {
      // Still clear internal state so a stale query/filter doesn't linger,
      // just without firing the reset callback.
      this._resetSearchState();
    }
  }

  bindFilterToggle() {
    if (!this.elements.filterToggle) return;

    this.elements.filterToggle.addEventListener("click", () => {
      this.toggleFiltersPanel();
    });
  }

  bindResetFilters() {
    if (!this.elements.resetFilters) return;

    this.elements.resetFilters.addEventListener("click", () => {
      this.resetFilters();
    });
  }

  clearSearch() {
    if (this.elements.searchInput) {
      this.elements.searchInput.value = "";
      this.elements.searchInput.focus();
    }
    this.updateCloseButtonMode("");
    this.filters.searchQuery = "";
    // Re-run search with empty query so results show all items again
    this.performSearch();
  }

  toggleFiltersPanel() {
    // Only show filters in course search context
    if (this.currentContext !== "courses") return;

    this.isFiltersPanelOpen = !this.isFiltersPanelOpen;

    if (this.elements.searchFilters) {
      this.elements.searchFilters.style.display = this.isFiltersPanelOpen
        ? "block"
        : "none";
    }

    if (this.elements.filterToggle) {
      this.elements.filterToggle.classList.toggle(
        "active",
        this.isFiltersPanelOpen,
      );
      this.elements.filterToggle.setAttribute(
        "aria-expanded",
        this.isFiltersPanelOpen,
      );
    }
  }

  resetFilters() {
    // Reset filter values
    this.filters = {
      searchQuery: this.filters.searchQuery, // Keep search query
      scope: "all",
      contentType: "all",
      educationType: "all",
      faculty: "all",
      sortBy: "relevance",
    };

    // Reset UI controls
    document.querySelectorAll('input[name="searchScope"]').forEach((radio) => {
      radio.checked = radio.value === "all";
    });

    document.querySelectorAll('input[name="contentType"]').forEach((radio) => {
      radio.checked = radio.value === "all";
    });

    document
      .querySelectorAll('input[name="educationType"]')
      .forEach((radio) => {
        radio.checked = radio.value === "all";
      });

    if (this.elements.facultyFilter) {
      this.elements.facultyFilter.value = "all";
    }

    if (this.elements.sortBy) {
      this.elements.sortBy.value = "relevance";
    }

    this.updateFacultyVisibility();

    // Re-run search with reset filters
    this.performSearch();
    this.updateActiveFilters();
  }

  // ===========================
  // UI UPDATES
  // ===========================

  updateUI(results) {
    // Update results count
    if (this.elements.resultCount) {
      this.elements.resultCount.textContent = results.length;
    }

    // Show/hide summary
    const hasActiveFilters = this.hasActiveFilters();
    if (this.elements.searchSummary) {
      this.elements.searchSummary.style.display = hasActiveFilters
        ? "flex"
        : "none";
    }

    // Update active filter tags (only for course search)
    if (this.currentContext === "courses") {
      this.updateActiveFilters();
    }

    // Hide filter toggle for quiz search
    if (this.elements.filterToggle) {
      this.elements.filterToggle.style.display =
        this.currentContext === "courses" ? "flex" : "none";
    }
  }

  hasActiveFilters() {
    return (
      this.filters.searchQuery.length >= this.searchConfig.minSearchLength ||
      this.filters.scope !== "all" ||
      this.filters.contentType !== "all" ||
      this.filters.educationType !== "all" ||
      this.filters.faculty !== "all" ||
      this.filters.sortBy !== "relevance"
    );
  }

  updateActiveFilters() {
    if (!this.elements.activeFilterTags) return;

    const tags = [];

    // Scope filter tag
    if (this.filters.scope === "subscribed") {
      tags.push({ label: "المواد المشترك بها", key: "scope" });
    }

    // Content type filter tag
    if (this.filters.contentType === "courses") {
      tags.push({ label: "مواد فقط", key: "contentType" });
    } else if (this.filters.contentType === "exams") {
      tags.push({ label: "امتحانات فقط", key: "contentType" });
    }

    // Education-type filter tag
    if (this.filters.educationType !== "all") {
      const educationTypeLabels = {
        University: "جامعي",
        "High-School": "ثانوي",
        "Middle-School": "إعدادي",
        Primary: "ابتدائي",
      };
      tags.push({
        label:
          educationTypeLabels[this.filters.educationType] ||
          this.filters.educationType,
        key: "educationType",
      });
    }

    // Faculty filter tag
    if (this.filters.faculty !== "all") {
      tags.push({ label: this.filters.faculty, key: "faculty" });
    }

    // Sort filter tag (only if not default)
    if (this.filters.sortBy !== "relevance") {
      const sortLabels = {
        name: "الترتيب: الاسم",
        recent: "الترتيب: الأحدث",
        progress: "الترتيب: التقدم",
      };
      tags.push({ label: sortLabels[this.filters.sortBy], key: "sortBy" });
    }

    // Render tags
    this.elements.activeFilterTags.innerHTML = tags
      .map(
        (tag) => `
      <button class="filter-tag" data-filter="${tag.key}" aria-label="إزالة فلتر ${tag.label}">
        ${tag.label}
        <span class="filter-tag-remove" aria-hidden="true">×</span>
      </button>
    `,
      )
      .join("");

    // Add click handlers to remove individual filters
    this.elements.activeFilterTags
      .querySelectorAll(".filter-tag")
      .forEach((tagEl) => {
        tagEl.addEventListener("click", () => {
          this.removeFilter(tagEl.dataset.filter);
        });
      });
  }

  removeFilter(filterKey) {
    switch (filterKey) {
      case "scope":
        this.filters.scope = "all";
        document
          .querySelectorAll('input[name="searchScope"]')
          .forEach((radio) => {
            radio.checked = radio.value === "all";
          });
        break;
      case "contentType":
        this.filters.contentType = "all";
        document
          .querySelectorAll('input[name="contentType"]')
          .forEach((radio) => {
            radio.checked = radio.value === "all";
          });
        break;
      case "educationType":
        this.filters.educationType = "all";
        this.setEducationTypeSetting("all");
        document
          .querySelectorAll('input[name="educationType"]')
          .forEach((radio) => {
            radio.checked = radio.value === "all";
          });
        this.updateFacultyVisibility();
        break;
      case "faculty":
        this.filters.faculty = "all";
        if (this.elements.facultyFilter) {
          this.elements.facultyFilter.value = "all";
        }
        break;
      case "sortBy":
        this.filters.sortBy = "relevance";
        if (this.elements.sortBy) {
          this.elements.sortBy.value = "relevance";
        }
        break;
    }

    this.performSearch();
    this.updateActiveFilters();
  }

  // ===========================
  // SEARCH SETTINGS (persisted preferences)
  // ===========================

  loadSearchSettings() {
    try {
      const raw = localStorage.getItem("quiz_search_settings");
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      console.error("Error loading search settings:", error);
      return {};
    }
  }

  saveSearchSettings() {
    try {
      localStorage.setItem(
        "quiz_search_settings",
        JSON.stringify(this.settings),
      );
    } catch (error) {
      console.error("Error saving search settings:", error);
    }
  }

  /**
   * Persist the user's explicit education-type choice so it's remembered
   * next time they open search, even if their profile changes later.
   */
  setEducationTypeSetting(educationType) {
    this.settings.educationType = educationType;
    this.saveSearchSettings();
  }

  // ===========================
  // SEARCH HISTORY
  // ===========================

  loadSearchHistory() {
    try {
      const history = localStorage.getItem("quiz_search_history");
      return history ? JSON.parse(history) : [];
    } catch (error) {
      console.error("Error loading search history:", error);
      return [];
    }
  }

  saveSearchHistory() {
    try {
      localStorage.setItem(
        "quiz_search_history",
        JSON.stringify(this.searchHistory),
      );
    } catch (error) {
      console.error("Error saving search history:", error);
    }
  }

  addToSearchHistory(query) {
    if (!query || query.length < this.searchConfig.minSearchLength) return;

    // Remove if already exists
    this.searchHistory = this.searchHistory.filter((item) => item !== query);

    // Add to beginning
    this.searchHistory.unshift(query);

    // Limit history size
    if (this.searchHistory.length > this.searchConfig.maxHistoryItems) {
      this.searchHistory = this.searchHistory.slice(
        0,
        this.searchConfig.maxHistoryItems,
      );
    }

    this.saveSearchHistory();
  }

  // ===========================
  // HELPER METHODS
  // ===========================

  getLastAttemptTime(courseId) {
    try {
      const history = userProfile.getQuizHistory();
      const courseHistory = history.filter(
        (item) => item.courseId === courseId,
      );
      if (courseHistory.length === 0) return 0;

      return Math.max(...courseHistory.map((item) => item.timestamp || 0));
    } catch (error) {
      return 0;
    }
  }

  getProgress(courseId) {
    try {
      return userProfile.getCourseProgress(courseId) || 0;
    } catch (error) {
      return 0;
    }
  }

  // ===========================
  // KEYBOARD SHORTCUTS
  // ===========================

  setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // Ctrl+K or Cmd+K to open search bar and focus input
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (
          this.elements.headerSearchBtn &&
          this.elements.headerSearchBtn.style.display !== "none"
        ) {
          if (!this.isBarOpen) {
            this.openSearchBar();
          } else {
            this.elements.searchInput && this.elements.searchInput.focus();
          }
        }
      }

      // Escape closes the bar when search input is focused
      if (e.key === "Escape" && this.isBarOpen) {
        this.closeSearchBar();
      }

      // Ctrl+F or Cmd+F to open filters (only if bar is open and in course context)
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === "f" &&
        this.isBarOpen &&
        this.currentContext === "courses"
      ) {
        e.preventDefault();
        if (!this.isFiltersPanelOpen) {
          this.toggleFiltersPanel();
        }
      }
    });
  }

  // ===========================
  // PUBLIC API
  // ===========================

  /**
   * Get current filtered results
   */
  getResults() {
    return this.filteredCourses;
  }

  /**
   * Check if search is active
   */
  isSearchActive() {
    return this.hasActiveFilters();
  }

  /**
   * Manually trigger search — also used by basmagy.search(query) in the
   * console. Opens the bar if it's closed so the results are actually visible,
   * and keeps the merged close/clear button's mode in sync.
   */
  search(query) {
    if (!this.isBarOpen) {
      this.openSearchBar();
    }
    if (this.elements.searchInput) {
      this.elements.searchInput.value = query;
    }
    this.updateCloseButtonMode(query);
    this.filters.searchQuery = query;
    this.performSearch();
  }
}
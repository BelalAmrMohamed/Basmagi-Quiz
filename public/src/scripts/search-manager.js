// ============================================================================
// search-manager.js - Context-Aware Advanced Search System
// ============================================================================

import { userProfile } from "./userProfile.js";

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
      faculty: "all",
      sortBy: "relevance", // 'relevance' | 'name' | 'recent' | 'progress'
    };

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
    this.bindSearchInput();
    this.bindFilterControls();
    this.bindClearButton();
    this.bindFilterToggle();
    this.bindHeaderSearchBtn(); // NEW
    this.bindSearchClose(); // NEW
    this.populateFacultyFilter();
    this.bindResetFilters();
    this.setupKeyboardShortcuts();
    this.updateContextVisibility();
  }

  /**
   * Cache DOM element references for better performance
   */
  cacheElements() {
    this.elements = {
      searchInput: document.getElementById("courseSearch"),
      searchClear: document.getElementById("searchClear"),
      searchClose: document.getElementById("searchClose"), // NEW: collapses the bar
      headerSearchBtn: document.getElementById("headerSearchBtn"), // NEW: header icon trigger
      filterToggle: document.getElementById("filterToggle"),
      searchFilters: document.getElementById("searchFilters"),
      searchSummary: document.getElementById("searchSummary"),
      resultCount: document.getElementById("resultCount"),
      activeFilterTags: document.getElementById("activeFilterTags"),
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
          // No exams — hide the trigger button and close the bar if open
          if (this.elements.headerSearchBtn) {
            this.elements.headerSearchBtn.style.display = "none";
          }
          this.closeSearchBar();
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
    if (this.elements.searchClear) {
      this.elements.searchClear.style.display = "none";
    }
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
    // Show/hide clear button
    if (this.elements.searchClear) {
      this.elements.searchClear.style.display = query ? "flex" : "none";
    }

    // Clear previous debounce timer
    clearTimeout(this.debounceTimer);

    // Debounce the search
    this.debounceTimer = setTimeout(() => {
      this.filters.searchQuery = query;
      this.performSearch();
    }, this.searchConfig.debounceDelay);
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

    // Apply search query
    if (
      this.filters.searchQuery &&
      this.filters.searchQuery.length >= this.searchConfig.minSearchLength
    ) {
      results = this.filterCoursesBySearchQuery(results);
      this.addToSearchHistory(this.filters.searchQuery);
    }

    // Apply scope filter (subscribed only)
    results = this.filterByTrackScope(results);

    // Apply content type filter
    if (this.filters.contentType !== "all") {
      results = this.filterByContentType(results);
    }

    // Apply faculty filter
    if (this.filters.faculty !== "all") {
      results = this.filterByFaculty(results);
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

    // Extract unique faculties from all courses
    const faculties = new Set();
    this.allCourses.forEach((course) => {
      if (course.faculty) {
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

    const profile = userProfile.getProfile();
    if (profile && profile.education_type && profile.education_type !== "University") {
      const filterGroup = this.elements.facultyFilter.closest('.filter-group');
      if (filterGroup) {
        filterGroup.style.display = 'none';
      }
    }
  }

  // ===========================
  // UI CONTROLS
  // ===========================

  bindClearButton() {
    if (!this.elements.searchClear) return;

    this.elements.searchClear.addEventListener("click", () => {
      this.clearSearch();
    });
  }

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
   * NEW: Bind the × close button inside the search bar (collapses bar + resets view)
   */
  bindSearchClose() {
    if (!this.elements.searchClose) return;

    this.elements.searchClose.addEventListener("click", () => {
      this.closeSearchBar();
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
  closeSearchBar() {
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
    // Trigger a reset (restores original view)
    if (this.filters.searchQuery || this.hasActiveFilters()) {
      this._resetSearchState();
      // Signal a full reset to index.js so it can re-render the proper root view
      if (this.onSearchCallback) {
        this.onSearchCallback(null, this.currentContext, true /* isReset */);
      }
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
    }
    if (this.elements.searchClear) {
      this.elements.searchClear.style.display = "none";
    }
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

    if (this.elements.facultyFilter) {
      this.elements.facultyFilter.value = "all";
    }

    if (this.elements.sortBy) {
      this.elements.sortBy.value = "relevance";
    }

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
   * Manually trigger search
   */
  search(query) {
    if (this.elements.searchInput) {
      this.elements.searchInput.value = query;
    }
    this.filters.searchQuery = query;
    this.performSearch();
  }
}

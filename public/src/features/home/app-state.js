// ============================================================================
// public/src/features/home/app-state.js
// APP STATE — shared mutable state for the home page module graph
// ============================================================================
// The original single-file index.js relied on top-level `let` bindings
// (categoryTree, searchManager, navigationStack, _isRestoringState) that
// every function in the file could close over directly. Now that the file is
// split across modules, that shared, mutable state needs a single owner so
// every module reads/writes the same values instead of each import getting
// its own copy. This module is that single owner — plain getter/setter pairs,
// no framework needed for state this small.
//
// `categoryTree` — the flat manifest tree, populated once by initApp().
// `searchManager` — the SearchManager instance, created by initializeSearchManager().
// `navigationStack` — ordered list of category objects representing the
//   current drill-down path (used for breadcrumbs + back navigation).
// `isRestoringState` — true while a popstate/initial-load replay is in
//   progress, so render functions know to use history.replaceState instead
//   of history.pushState (see navigation.js).

let categoryTree = null;
let searchManager = null;
let navigationStack = [];
let isRestoringState = false;
let indexSupabaseClient = null;
let selectedUserQuizzes = new Set();
let categoriesCache = null;

export function getCategoryTree() {
  return categoryTree;
}
export function setCategoryTree(tree) {
  categoryTree = tree;
}

export function getSearchManager() {
  return searchManager;
}
export function setSearchManager(manager) {
  searchManager = manager;
}

export function getNavigationStack() {
  return navigationStack;
}
export function setNavigationStack(stack) {
  navigationStack = stack;
}

export function isRestoring() {
  return isRestoringState;
}
export function setRestoring(value) {
  isRestoringState = value;
}

export function getIndexSupabaseClient() {
  return indexSupabaseClient;
}
export function setIndexSupabaseClient(client) {
  indexSupabaseClient = client;
}

// selectedUserQuizzes is a Set that's mutated in place (.add()/.delete()) by
// callers rather than reassigned, so only a getter is needed — no setter.
export function getSelectedUserQuizzes() {
  return selectedUserQuizzes;
}

// One-shot lazy cache of root categories, computed once by getCategoriesLazy()
// (navigation.js) and never invalidated for the page's lifetime — same as
// the original (the manifest loads once via initApp() and doesn't change
// afterward in a single session).
export function getCategoriesCache() {
  return categoriesCache;
}
export function setCategoriesCache(cache) {
  categoriesCache = cache;
}
// ============================================================================
// public/src/features/home/navigation.js
// NAVIGATION — app initialisation, URL/history routing, and popstate handling.
// ============================================================================
// Contains:
//   initApp()              — manifest load, first-visit detection, initial render
//   finalizeAppRender()    — stamps history entry + restores view from URL
//   restoreViewFromURL()   — maps window.location.hash → the correct view
//   findCategoryAncestors()— reconstructs breadcrumb ancestor chain from hash
//
// Original source lines (for verification):
//   findCategoryAncestors  ~1321-1343
//   restoreViewFromURL     ~1345-1417
//   initApp                ~748-808
//   finalizeAppRender      ~785-808
// ============================================================================
// NOTE: showNotification and _confirm are NOT ES exports —
// they are runtime globals loaded via a non-module <script> tag from
// src/components/notifications.js. Referenced below as bare globals with
// this comment so future readers don't try to add an import for them.
// ============================================================================

import { getManifest } from "../../shared/quizManifest.js";
import {
  getCategoryTree,
  setCategoryTree,
  getNavigationStack,
  setNavigationStack,
  isRestoring,
  setRestoring,
} from "./app-state.js";
import { migrateLegacyUserProfile } from "./profile-migration.js";
import { initializeSearchManager } from "./search-integration.js";
import { renderRootCategories } from "./root-view.js";
import { renderCategory } from "./category-view.js";
import { renderUserQuizzesView } from "./user-quizzes-view.js";
import { renderLandingScreen } from "./landing-screen.js";
import { toSlug } from "./slug-utils.js";

// ============================================================================
// findCategoryAncestors — original lines 1321-1343
// ============================================================================

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
// restoreViewFromURL — original lines 1345-1417
// ============================================================================

// Bug 1 Fix — restoreViewFromURL
// Re-renders the correct SPA view from the current window.location.hash.
// Called by:
//   • initApp()            - on initial page load / deep-link / refresh
//   • popstate listener    - on every browser back / forward navigation
//
// IMPORTANT: This function must always be called with _isRestoringState = true
// so that renderCategory / renderUserQuizzesView use history.replaceState
// (stamp the state object) rather than history.pushState (add a new entry).

export function restoreViewFromURL() {
  const hash = window.location.hash.slice(1); // strip leading #

  // ── Root view ──────────────────────────────────────────────────────────────
  if (!hash) {
    renderRootCategories();
    return;
  }

  // ── User-quizzes folder ────────────────────────────────────────────────────
  if (hash === "my-quizzes") {
    setNavigationStack([]); // reset so renderUserQuizzesView can push cleanly
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
  const categoryTree = getCategoryTree();
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
      setNavigationStack([...ancestors]); // pre-load ancestors without re-rendering
      renderCategory(cat); // pushes cat itself and renders content
      return;
    }
  }

  // ── Fallback: unknown / unresolvable hash → root ───────────────────────────
  renderRootCategories();
}

// ============================================================================
// finalizeAppRender — original lines 785-808
// Also exported so landing-screen.js can call it after the skip-button
// dismiss animation completes (via a dynamic import to avoid a static cycle).
// ============================================================================

export function finalizeAppRender() {
  // ── Full render now that manifest is ready ────────────────────────────────
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
    setRestoring(true);
    try {
      restoreViewFromURL();
    } finally {
      setRestoring(false);
    }
  } catch (error) {
    console.error("Error in initApp render phase:", error);
    renderRootCategories(); // retry once
  }
}

// ============================================================================
// initApp — original lines 748-783
// ============================================================================

/**
 * Bootstrap the home page: migrate legacy profile, fetch the quiz manifest,
 * then either show the first-visit landing screen or finalise the app render.
 *
 * Called from DOMContentLoaded (see new entrypoint index.js).
 */
export async function initApp() {
  migrateLegacyUserProfile();

  let hasVisited = true;
  try {
    hasVisited = !!localStorage.getItem("first_visit_complete");
  } catch (e) {
    console.error("Error checking first-visit state:", e);
  }

  // ── 1. Leave skeleton visible; just mark aria state ───────────────────────
  // The skeleton HTML in index.html is shown while we wait for the manifest.
  // Do NOT clear container.innerHTML here — that would hide the skeleton.
  const contentArea = document.getElementById("contentArea");
  if (contentArea) {
    contentArea.setAttribute("aria-busy", "true");
  }

  // ── 2. Fetch manifest asynchronously, then render all categories ─────────
  try {
    const manifest = await getManifest();
    setCategoryTree(manifest.categoryTree);
    initializeSearchManager();
  } catch (err) {
    console.error("Failed to load quiz manifest:", err);
    setCategoryTree({});
  }

  // ── If first-time visitor, show landing layout instead of default content
  if (!hasVisited) {
    renderLandingScreen();
    return; // Wait for user decision (skip/onboard button)
  }

  finalizeAppRender();
}

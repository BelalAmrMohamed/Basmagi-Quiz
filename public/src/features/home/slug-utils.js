// ============================================================================
// public/src/features/home/slug-utils.js
// SLUG UTILITIES
// Literal hyphens in names are double-encoded as "--" so they survive a
// round-trip:  "Unit 1-A"  →  "Unit-1--A"  →  "Unit 1-A"
// ============================================================================

/**
 * Convert a display name to a URL slug.
 * Spaces → single "-"; existing literal hyphens → "--"
 */
export function toSlug(str) {
  return str.trim().replace(/-/g, "--").replace(/\s+/g, "-");
}

/**
 * Reverse toSlug: single "-" → space; "--" → literal "-"
 */
export function fromSlug(slug) {
  // Split on "--" first (literal hyphens), then replace single "-" with space
  return slug
    .split("--")
    .map((part) => part.replace(/-/g, " "))
    .join("-");
}

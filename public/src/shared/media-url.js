// public/src/shared/media-url.js
// Shared media URL helpers used by every export path (standalone .html,
// markdown, and JSON). Some question media (images/video/audio) are stored
// as paths *relative to the platform's own origin* — done deliberately to
// save space in the free-tier Supabase DB, since the files themselves live
// alongside the app's own static assets on Vercel rather than in the DB.
// That's fine while viewing the quiz live on the site (relative URLs
// resolve against window.location.origin automatically), but any export
// that can be opened outside that origin (a standalone .html from disk, a
// .md file, a .json file) has no such origin to resolve against — so
// relative paths need to be rewritten to absolute URLs at export time.

export const PLATFORM_ORIGIN = "https://basmagi-quiz.vercel.app";

/**
 * True if `url` is a path relative to the platform's own origin (as opposed
 * to an already-absolute http(s)/data/blob URL).
 * @param {string} url
 * @returns {boolean}
 */
export const isLocalPath = (url) => {
    if (!url) return false;
    // Check for relative paths (./, ../, or no protocol)
    if (url.startsWith("./") || url.startsWith("../") || url.startsWith("/")) {
        return true;
    }
    // Check if it lacks a protocol (http://, https://, data:)
    return !/^(https?:|data:)/i.test(url);
};

/**
 * Resolves a possibly-relative media URL (image/video/audio) to an absolute
 * URL against the platform's origin. Leaves absolute http(s)/data/blob URLs
 * untouched. Safe to call with the live site's own origin too (falls back
 * to window.location.origin there instead of hardcoding basmagi's domain),
 * so this doesn't misbehave on a fork/staging deploy.
 *
 * Returns an empty string (falsy) when `url` is empty/malformed and can't
 * be turned into a usable link at all — callers that need a genuine
 * "not available" fallback (e.g. markdown export) can check for that;
 * callers that just want a best-effort passthrough (e.g. the standalone
 * .html export, which historically returned the original string on
 * failure) can do `resolveMediaUrl(url) || url`.
 * @param {string} url
 * @returns {string}
 */
export const resolveMediaUrl = (url) => {
    if (!url || typeof url !== "string") return "";
    if (/^(https?:|data:|blob:)/i.test(url)) return url;

    // Fix #file-origin: window.location.origin is NOT falsy when the export
    // is opened via file:///... — per spec, a file: URL's origin serializes
    // to the literal string "null" (browser-dependent, but Chrome/Firefox/
    // Edge all do this), which is truthy and would otherwise defeat a naive
    // `|| PLATFORM_ORIGIN` fallback. That made new URL(relativePath, "null")
    // throw, hit the catch below, and return the UNRESOLVED relative path —
    // reproducing the exact "video path breaks when downloaded and opened
    // from file:///D:/Downloads/..." bug this was meant to fix. Explicitly
    // reject file:/null/empty origins so the real platform origin is used
    // instead whenever the page itself has no usable origin.
    const winOrigin =
        typeof window !== "undefined" && window.location && window.location.origin;
    const origin =
        winOrigin && winOrigin !== "null" && !/^file:/i.test(winOrigin)
            ? winOrigin
            : PLATFORM_ORIGIN;

    try {
        return new URL(url, origin).href;
    } catch {
        // Malformed URL — signal failure to the caller rather than silently
        // returning an unresolved relative path that would 404 once opened
        // outside the platform's origin.
        return "";
    }
};
// public/src/shared/media-resolve.js
//
// Shared media URL resolution + rendering helpers, used by quiz.js,
// result.js, markdown.js (inline ![audio]/![video] tags), and the static
// export template in export-to-quiz.js (inlined there, see that file's
// comments — this module isn't importable from a standalone exported HTML
// file, so its logic is duplicated there deliberately).
//
// Extracted from quiz.js, which had the more complete implementation
// (quiz-folder-relative co-location resolution via `baseUrl`). result.js
// previously carried its own, slightly diverged copy that lacked the
// `baseUrl` co-location branch entirely — meaning quiz-folder-relative
// media paths (e.g. "./assets/quiz-media/TEST_1/Part_1.mp4") could fail to
// resolve correctly on the results page. Consolidating onto this module
// fixes that gap as a side effect.

// === HTML Escaping ===
export const escapeHtml = (unsafe) => {
    if (unsafe === null || unsafe === undefined) return "";
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// Build candidate URLs for a media path (site-root assets, then quiz-folder).
// `baseUrl` is the directory URL of the currently loaded quiz/result page
// (e.g. `new URL("./", window.location.href).href`), used to resolve
// quiz-folder-relative co-located media (e.g. "Test 1/Recording.mp3").
export const getMediaUrlCandidates = (url, baseUrl = null) => {
    const trimmed = String(url || "").trim();
    if (!trimmed) return [];
    if (/^(https?:|data:|blob:)/i.test(trimmed)) return [trimmed];

    const candidates = [];
    const add = (candidate) => {
        if (candidate && !candidates.includes(candidate))
            candidates.push(candidate);
    };

    try {
        if (trimmed.startsWith("/")) {
            add(new URL(trimmed, window.location.origin).href);
            return candidates;
        }

        // Convention: ./assets/… lives under public/assets/ (site root)
        if (/^\.\/assets\//i.test(trimmed) || /^assets\//i.test(trimmed)) {
            const sitePath = trimmed.replace(/^\.\//, "/");
            add(new URL(sitePath, window.location.origin).href);
        }

        // Quiz-folder relative: co-located media (e.g. Test 1/Recording.mp3)
        if (baseUrl) {
            add(new URL(trimmed, baseUrl).href);
            const fileName = trimmed.split("/").pop();
            if (fileName && fileName !== trimmed) {
                add(new URL(fileName, baseUrl).href);
            }
        }

        add(new URL(trimmed, window.location.href).href);
    } catch {
        add(trimmed);
    }

    return candidates;
};

export const resolveMediaUrl = (url, baseUrl = null) =>
    getMediaUrlCandidates(url, baseUrl)[0] || "";

export const getMediaMimeType = (url) => {
    const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
    const types = {
        mp3: "audio/mpeg",
        wav: "audio/wav",
        ogg: "audio/ogg",
        m4a: "audio/mp4",
        aac: "audio/aac",
        mp4: "video/mp4",
        webm: "video/webm",
        ogv: "video/ogg",
        mov: "video/quicktime",
    };
    return types[ext] || "";
};

// Bug 4 Fix (originally in quiz.js): detect YouTube URLs and extract the
// video ID, so video URLs pointing at YouTube render as an embed instead
// of a broken <video> tag.
export const YOUTUBE_RE =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

export const isYouTubeUrl = (url) => YOUTUBE_RE.test(String(url || ""));

export const getYouTubeVideoId = (url) => {
    const m = String(url || "").match(YOUTUBE_RE);
    return m ? m[1] : null;
};

// Renders a bare <audio>/<video> element (NOT the YouTube iframe case,
// callers must check isYouTubeUrl() first for video). Includes
// data-media-raw/data-media-candidates so initMediaSkeletons()-style retry
// logic can re-scan and fall back to alternate candidate URLs on error.
export const renderMediaElement = (tag, className, mediaUrl, baseUrl = null) => {
    const src = resolveMediaUrl(mediaUrl, baseUrl);
    // Do NOT add cache-busting to the initial src — it forces a network fetch
    // on every render (even same-question re-renders) and prevents the browser
    // from restoring the cached resource on page reload. Cache-busting is only
    // applied when retrying a failed candidate URL (see quiz.js's
    // applyMediaSrc).
    const mime = getMediaMimeType(src);
    const typeAttr = mime ? ` type="${escapeHtml(mime)}"` : "";
    const candidates = escapeHtml(
        JSON.stringify(getMediaUrlCandidates(mediaUrl, baseUrl)),
    );
    const raw = escapeHtml(mediaUrl);
    const fallback =
        tag === "audio"
            ? "متصفحك لا يدعم تشغيل الصوت."
            : "متصفحك لا يدعم تشغيل الفيديو.";
    const playsinline = tag === "video" ? " playsinline" : "";
    return `<${tag} controls preload="metadata" class="${className}"${playsinline} src="${escapeHtml(src)}" data-media-raw="${raw}" data-media-candidates="${candidates}">
        <source src="${escapeHtml(src)}"${typeAttr} />
        ${fallback}
      </${tag}>`;
};
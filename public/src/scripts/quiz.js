// src/scripts/quiz.js - Performance Optimized
import { getManifest } from "./quizManifest.js";
import { gameEngine } from "../shared/gameEngine.js";
import {
  showNotification,
  confirmationNotification,
} from "../components/notifications.js";
import { userProfile } from "./userProfile.js";
import { initKeyboardNav } from "./keyboard-nav.js";
import {
  gradeEssay,
  isEssayQuestion,
  isAnswerCorrect,
} from "../shared/rate-answers.js";
showNotification(
  "الإمتحان بدأ",
  "أسأل الله لك التوفيق والسداد",
  "./assets/images/صلى_على_النبي_2.png",
);
import {
  renderMarkdown,
  normalizeLiteralNewlines,
} from "../shared/markdown.js";

// === MEMORY CACHE for exam modules ===
const examModuleCache = new Map();
const MAX_CACHE_SIZE = 10; // Keep last 10 exams in memory

// === State Management ===
let questions = [];
let metaData = {};
let currentIdx = 0;
let userAnswers = {};
let lockedQuestions = {};
let timeElapsed = 0;
let timerInterval = null;
let examId = null;
let quizMode = "exam";
let timeRemaining = 0;
let viewMode = "grid";
let autoSubmitTimeout = null;
let quizStyle = "pagination"; // "pagination" | "vertical"
let quizBaseUrl = null; // directory URL of the loaded quiz JSON file

// === Performance: Debounce helpers ===
let renderNavDebounce = null;
let saveStateDebounce = null;

// Bug 2 Fix: track which question card was last interacted with so that
// renderAllQuestionsVertical() only rebuilds that specific card instead of
// replacing every card (which would reset all media playback).
let lastChangedIdx = null;

// Bug 3 Fix: media timestamps loaded from saved state, applied after first render.
let pendingMediaTimestamps = null;

// === DOM Elements (cached references) ===
const els = {
  title: document.getElementById("quizTitle"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  questionContainer: document.getElementById("questionContainer"),
  timer: document.getElementById("timer"),
  timerBadge: document.getElementById("timerBadge"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  finishBtn: document.getElementById("finishBtn"),
  restartBtn: document.getElementById("restartBtn"),
  exitBtn: document.getElementById("exitBtn"),
  statsBar: document.getElementById("statsBar"),
  statLevel: document.getElementById("statLevel"),
  statPoints: document.getElementById("statPoints"),
  statStreak: document.getElementById("statStreak"),
  viewToggle: document.getElementById("viewToggle"),
  viewIcon: document.getElementById("viewIcon"),
  viewText: document.getElementById("viewText"),
  quizSource: document.getElementById("quizSource"),
  quizInfoBtn: document.getElementById("quizInfoBtn"),
  quizInfoDialog: document.getElementById("quizInfoDialog"),
  quizInfoDialogClose: document.getElementById("quizInfoDialogClose"),
  quizInfoTable: document.getElementById("quizInfoTable"),
};

// === Quiz Info Dialog: open / close wiring ===
(function initInfoDialog() {
  const btn = els.quizInfoBtn;
  const dialog = els.quizInfoDialog;
  const closeBtn = els.quizInfoDialogClose;
  if (!btn || !dialog) return;

  btn.addEventListener("click", () => {
    if (typeof dialog.showModal === "function") dialog.showModal();
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", () => dialog.close());
  }

  // Close on backdrop click
  dialog.addEventListener("click", (e) => {
    const rect = dialog.getBoundingClientRect();
    const isBackdrop =
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;
    if (isBackdrop) dialog.close();
  });

  // Close on Escape is handled natively by <dialog>
})();

// === Global handlers ===
window.finishEarly = () => finish();
window.restartQuiz = () => restart(); // Not implemented
window.exitQuiz = () => exit();
window.prevQuestion = () => nav(-1);
window.nextQuestion = () => nav(1);

// Vertical style: select option for a specific question
window.handleSelectForQuestion = (qIdx, optIdx) => {
  if (lockedQuestions[qIdx]) return;
  userAnswers[qIdx] = optIdx;
  lastChangedIdx = qIdx; // Bug 2 Fix: only rebuild this card
  saveStateDebounced();
  renderQuestion();
  renderMenuNavigationDebounced();
  maybeAutoSubmit();
};

// Vertical style: check answer for a specific question
window.checkAnswerForQuestion = (qIdx) => {
  const q = questions[qIdx];
  const isEssay = isEssayQuestion(q);
  if (isEssay) {
    const textarea = document.getElementById(`essayInput-${qIdx}`);
    if (!textarea || !textarea.value.trim()) return;
  } else {
    if (userAnswers[qIdx] === undefined) return;
  }
  lastChangedIdx = qIdx; // Bug 2 Fix: only rebuild this card
  lockedQuestions[qIdx] = true;
  saveStateDebounced();
  renderQuestion();
  renderMenuNavigationDebounced();
  updateNav();
};

// Vertical style: essay input for a specific question
window.handleEssayInputForQuestion = (qIdx) => {
  if (lockedQuestions[qIdx]) return;
  const textarea = document.getElementById(`essayInput-${qIdx}`);
  if (textarea) {
    userAnswers[qIdx] = textarea.value;
    saveStateDebounced();
    const checkBtn = textarea
      .closest(".question-card")
      ?.querySelector(".check-answer-btn");
    if (checkBtn) checkBtn.disabled = !textarea.value.trim();
  }
};

// === Helper: HTML Escaping ===
const escapeHtml = (unsafe) => {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// === Helper: Get the model answer for an essay question ===
const getEssayAnswer = (q) => q.answer ?? "";

// === Text direction / language helpers ===
const ARABIC_CHAR_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const RTL_LANG_CODES = new Set(["ar", "fa", "ur", "he", "ps", "ku"]);

const detectTextDirection = (text, explicitLang) => {
  if (explicitLang) {
    const code = String(explicitLang).toLowerCase().slice(0, 2);
    return RTL_LANG_CODES.has(code) ? "rtl" : "ltr";
  }
  const str = String(text || "");
  const arabicCount = (str.match(ARABIC_CHAR_RE) || []).length;
  const latinCount = (str.match(/[a-zA-Z]/g) || []).length;
  return arabicCount > latinCount ? "rtl" : "ltr";
};

const getAlignClass = (text, explicitLang) => {
  const dir = detectTextDirection(text, explicitLang);
  return dir === "rtl" ? "text-rtl" : "text-ltr";
};

const getQuestionLang = (q) => q?.lang || metaData?.lang || null;

const isLargeFormatQuestion = (q) =>
  !!(q?.passage || q?.audio || q?.video || (q?.q && String(q.q).length > 400));

const MEDIA_SKELETON_HTML = `
  <div class="media-skeleton" aria-hidden="true">
    <div class="skeleton-block skeleton-media"></div>
    <span class="media-skeleton-label">جاري التحميل…</span>
  </div>`;

// Build candidate URLs for a media path (site-root assets, then quiz-folder).
const getMediaUrlCandidates = (url) => {
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
    if (quizBaseUrl) {
      add(new URL(trimmed, quizBaseUrl).href);
      const fileName = trimmed.split("/").pop();
      if (fileName && fileName !== trimmed) {
        add(new URL(fileName, quizBaseUrl).href);
      }
    }

    add(new URL(trimmed, window.location.href).href);
  } catch {
    add(trimmed);
  }

  return candidates;
};

const resolveMediaUrl = (url) => getMediaUrlCandidates(url)[0] || "";

const getMediaMimeType = (url) => {
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

const renderMediaElement = (tag, className, mediaUrl) => {
  const src = resolveMediaUrl(mediaUrl);
  // Add cache-busting parameter to prevent stale service worker cache on initial load
  const srcWithCacheBust = src
    ? `${src}${src.includes("?") ? "&" : "?"}_cb=${Date.now()}`
    : "";
  const mime = getMediaMimeType(src);
  const typeAttr = mime ? ` type="${escapeHtml(mime)}"` : "";
  const candidates = escapeHtml(
    JSON.stringify(getMediaUrlCandidates(mediaUrl)),
  );
  const raw = escapeHtml(mediaUrl);
  const fallback =
    tag === "audio"
      ? "متصفحك لا يدعم تشغيل الصوت."
      : "متصفحك لا يدعم تشغيل الفيديو.";
  const playsinline = tag === "video" ? " playsinline" : "";
  return `<${tag} controls preload="metadata" class="${className}"${playsinline} src="${escapeHtml(srcWithCacheBust)}" data-media-raw="${raw}" data-media-candidates="${candidates}">
        <source src="${escapeHtml(srcWithCacheBust)}"${typeAttr} />
        ${fallback}
      </${tag}>`;
};

// === Helper: Render Question Image ===
const renderQuestionImage = (imageUrl, resizeKey) => {
  if (!imageUrl) return "";
  const src = resolveMediaUrl(imageUrl);
  // Add cache-busting parameter to prevent stale service worker cache on initial load
  const srcWithCacheBust = src
    ? `${src}${src.includes("?") ? "&" : "?"}_cb=${Date.now()}`
    : "";
  const candidates = escapeHtml(
    JSON.stringify(getMediaUrlCandidates(imageUrl)),
  );
  return `
    <div class="media-container question-image-container" data-resize-key="${escapeHtml(resizeKey)}-image">
      ${MEDIA_SKELETON_HTML}
      <img
        src="${escapeHtml(srcWithCacheBust)}"
        alt="Question context image"
        class="question-image"
        data-media-raw="${escapeHtml(imageUrl)}"
        data-media-candidates="${candidates}"
      />
    </div>
  `;
};

const renderQuestionAudio = (audioUrl, resizeKey) => {
  if (!audioUrl) return "";
  return `
    <div class="media-container question-media-container question-audio-container" data-resize-key="${escapeHtml(resizeKey)}-audio">
      ${MEDIA_SKELETON_HTML}
      ${renderMediaElement("audio", "question-audio", audioUrl)}
    </div>
  `;
};

// Bug 4 Fix: detect YouTube URLs and extract the video ID.
const YOUTUBE_RE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

const isYouTubeUrl = (url) => YOUTUBE_RE.test(String(url || ""));

const getYouTubeVideoId = (url) => {
  const m = String(url || "").match(YOUTUBE_RE);
  return m ? m[1] : null;
};

const renderQuestionVideo = (videoUrl, resizeKey) => {
  if (!videoUrl) return "";

  // Bug 4 Fix: render a YouTube iframe instead of a <video> element.
  if (isYouTubeUrl(videoUrl)) {
    const videoId = getYouTubeVideoId(videoUrl);
    const embedSrc = `https://www.youtube.com/embed/${videoId}`;
    return `
      <div class="media-container question-media-container question-video-container" data-resize-key="${escapeHtml(resizeKey)}-youtube">
        <iframe
          class="question-video youtube-embed"
          src="${escapeHtml(embedSrc)}"
          data-media-raw="${escapeHtml(videoUrl)}"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          loading="lazy"
        ></iframe>
      </div>
    `;
  }

  return `
    <div class="media-container question-media-container question-video-container" data-resize-key="${escapeHtml(resizeKey)}-video">
      ${MEDIA_SKELETON_HTML}
      ${renderMediaElement("video", "question-video", videoUrl)}
    </div>
  `;
};

// Fix B: each media element is wrapped in .media-center-wrap (display:flex;
//         justify-content:center) so it is always horizontally centered
//         regardless of LTR/RTL page direction or the current container width.
const wrapMedia = (html) =>
  html ? `<div class="media-center-wrap">${html}</div>` : "";

const renderQuestionMedia = (q, resizeKey) =>
  [
    wrapMedia(renderQuestionImage(q.image, resizeKey)),
    wrapMedia(renderQuestionAudio(q.audio, resizeKey)),
    wrapMedia(renderQuestionVideo(q.video, resizeKey)),
  ].join("");

const renderReadingPassage = (passage, alignClass) => {
  if (!passage) return "";
  return `
    <div class="reading-passage ${alignClass}" role="region" aria-label="Reading passage">
      ${renderMarkdown(normalizeLiteralNewlines(passage))}
    </div>
  `;
};

const applyMediaSrc = (media, url) => {
  // Add cache-busting to each candidate URL to bypass stale service worker cache
  const urlWithCacheBust = url
    ? `${url}${url.includes("?") ? "&" : "?"}_cb=${Date.now()}`
    : url;
  media.src = urlWithCacheBust;
  const source = media.querySelector("source");
  if (source) source.src = urlWithCacheBust;
  if (media.tagName !== "IMG") media.load();
};

const initMediaSkeletons = (root = document) => {
  initMediaResize(root);
  root.querySelectorAll(".media-container").forEach((container) => {
    const media = container.querySelector("img, audio, video");
    const skeleton = container.querySelector(".media-skeleton");
    if (!media || !skeleton) return;

    let candidates = [];
    try {
      candidates = JSON.parse(media.dataset.mediaCandidates || "[]");
    } catch {
      candidates = getMediaUrlCandidates(media.dataset.mediaRaw || media.src);
    }
    if (!candidates.length) candidates = [media.src];

    // Find current candidate index by comparing base URLs (without cache-bust param)
    const currentUrl = media.src;
    const currentBaseUrl = currentUrl ? currentUrl.split("?")[0] : "";
    let candidateIdx = Math.max(
      0,
      candidates.findIndex(
        (url) => url === currentBaseUrl || url === currentUrl,
      ),
    );

    const reveal = () => {
      skeleton.classList.add("media-skeleton--hidden");
      media.classList.add("media-loaded");
    };

    const showError = () => {
      skeleton.classList.remove("media-skeleton--hidden");
      skeleton.classList.add("media-skeleton--error");
      skeleton.innerHTML =
        '<span class="media-error">تعذّر تحميل الوسائط. تحقق من المسار أو الرابط.</span>';
      console.warn(
        `[Media] Failed to load all candidates for: ${media.dataset.mediaRaw}`,
      );
    };

    const tryNextCandidate = () => {
      candidateIdx += 1;
      if (candidateIdx < candidates.length) {
        console.log(
          `[Media] Trying candidate ${candidateIdx}: ${candidates[candidateIdx]}`,
        );
        applyMediaSrc(media, candidates[candidateIdx]);
        return true;
      }
      showError();
      return false;
    };

    if (media.tagName === "IMG") {
      const onLoad = () => reveal();
      const onError = () => {
        if (!tryNextCandidate()) return;
        media.addEventListener("load", onLoad, { once: true });
        media.addEventListener("error", onError, { once: true });
      };
      if (media.complete && media.naturalWidth > 0) {
        reveal();
      } else {
        media.addEventListener("load", onLoad, { once: true });
        media.addEventListener("error", onError, { once: true });
      }
      return;
    }

    // Audio/Video specific handling
    const onMediaReady = () => {
      if (media.readyState >= 1) reveal();
    };
    const onMediaError = () => {
      console.warn(`[Media] Error loading: ${media.src}`);
      if (!tryNextCandidate()) return;
      // Reset listeners for next candidate
      media.addEventListener("loadedmetadata", onMediaReady, { once: true });
      media.addEventListener("canplay", onMediaReady, { once: true });
      media.addEventListener("error", onMediaError, { once: true });
    };

    media.addEventListener("loadedmetadata", onMediaReady, { once: true });
    media.addEventListener("loadeddata", onMediaReady, { once: true });
    media.addEventListener("canplay", onMediaReady, { once: true });
    media.addEventListener("error", onMediaError, { once: true });

    // Initial check
    onMediaReady();

    // Catch late metadata (innerHTML can finish loading before listeners attach)
    requestAnimationFrame(() => {
      if (!skeleton.classList.contains("media-skeleton--hidden"))
        onMediaReady();
    });

    // Increased timeout to handle slow network connections better
    setTimeout(() => {
      if (
        !skeleton.classList.contains("media-skeleton--hidden") &&
        !skeleton.classList.contains("media-skeleton--error") &&
        media.readyState >= 1
      ) {
        reveal();
      }
    }, 500);
  });
};

// === Feature: User-Resizable Media ===
// Lets the user drag-resize images, audio players, videos, and YouTube
// iframes via the native CSS `resize` handle. Sizes are persisted per
// exam+question+media-type so they survive re-renders, navigation, and
// page reloads.
const RESIZE_STORAGE_PREFIX = "quiz_media_size_";

const getMediaSizeStorageKey = (resizeKey) =>
  `${RESIZE_STORAGE_PREFIX}${examId}_${resizeKey}`;

const loadSavedMediaSize = (resizeKey) => {
  try {
    const raw = localStorage.getItem(getMediaSizeStorageKey(resizeKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.width === "number" &&
      typeof parsed.height === "number"
    ) {
      return parsed;
    }
  } catch {
    /* ignore malformed/legacy entries */
  }
  return null;
};

const saveMediaSize = (resizeKey, width, height) => {
  try {
    localStorage.setItem(
      getMediaSizeStorageKey(resizeKey),
      JSON.stringify({ width, height }),
    );
  } catch {
    /* localStorage may be full or unavailable; resizing still works for this session */
  }
};

// Debounce writes so dragging the resize handle doesn't hammer localStorage
const resizeSaveDebounces = new Map();
const saveMediaSizeDebounced = (resizeKey, width, height) => {
  clearTimeout(resizeSaveDebounces.get(resizeKey));
  resizeSaveDebounces.set(
    resizeKey,
    setTimeout(() => saveMediaSize(resizeKey, width, height), 400),
  );
};

// ── initMediaResize ───────────────────────────────────────────────────────────
// Fix A: Aspect-ratio-locked resizing via custom corner drag handles.
//         The original aspect ratio is captured the first time a drag starts
//         (or from the saved size). All four handles produce proportional
//         scaling so the media is never distorted.
//
// Fix B: Media is centered by its .media-center-wrap flex parent. The
//         container does NOT default to 100% width once a saved/dragged size
//         is applied — it becomes exactly <n>px wide and the flex parent
//         keeps it centered.
//
// Fix C: Dragging any handle resizes symmetrically from the center: the
//         container width grows/shrinks by 2× the pointer delta so both sides
//         move equally. Because the flex parent is justify-content:center the
//         visual center never shifts.
const initMediaResize = (root = document) => {
  root
    .querySelectorAll(".media-container[data-resize-key]")
    .forEach((container) => {
      if (container.dataset.resizeInit) return; // avoid double-binding
      container.dataset.resizeInit = "1";
      container.classList.add("resizable-media");

      const resizeKey = container.dataset.resizeKey;
      const isAudio = container.classList.contains("question-audio-container");

      // ── Inject handles appropriate for this media type ─────────────────
      // Audio is 1-D (fixed height) → only E/W side handles make sense.
      // Images/video/iframes get all 8 (4 corners + 4 sides, sides hidden on touch).
      const handlesToInject = isAudio
        ? ["e", "w"]
        : ["nw", "ne", "sw", "se", "n", "s", "e", "w"];

      handlesToInject.forEach((dir) => {
        if (container.querySelector(`.resize-handle--${dir}`)) return;
        const h = document.createElement("div");
        h.className = `resize-handle resize-handle--${dir}`;
        h.setAttribute("aria-hidden", "true");
        container.appendChild(h);
      });

      // ── Restore saved size ─────────────────────────────────────────────
      const saved = loadSavedMediaSize(resizeKey);
      if (saved) {
        container.style.width = `${saved.width}px`;
        if (!isAudio) container.style.height = `${saved.height}px`;
      }

      // ── Drag-resize logic ──────────────────────────────────────────────
      container.querySelectorAll(".resize-handle").forEach((handle) => {
        handle.addEventListener("pointerdown", (eDown) => {
          eDown.preventDefault();
          eDown.stopPropagation();
          handle.setPointerCapture(eDown.pointerId);
          handle.classList.add("is-active");
          document.body.classList.add("is-resizing-media");

          const startW = container.offsetWidth;
          const startH = container.offsetHeight;
          const startX = eDown.clientX;
          const startY = eDown.clientY;

          // ── Aspect ratio ───────────────────────────────────────────────
          // Priority: natural media dimensions > explicit 16:9 for iframes
          // (YouTube). Never fall back to the rendered box size — that bakes
          // in any previous distortion as the new "correct" ratio.
          const mediaEl = container.querySelector("img, video, iframe, audio");
          const isIframe = mediaEl instanceof HTMLIFrameElement;
          const aspectRatio =
            mediaEl instanceof HTMLImageElement && mediaEl.naturalWidth > 0
              ? mediaEl.naturalWidth / mediaEl.naturalHeight
              : mediaEl instanceof HTMLVideoElement && mediaEl.videoWidth > 0
                ? mediaEl.videoWidth / mediaEl.videoHeight
                : isIframe
                  ? 16 / 9 // YouTube and other embeds are always 16:9
                  : startH > 0
                    ? startW / startH
                    : 16 / 9;

          const minW = isAudio ? 200 : 120;
          const minH = isAudio ? 52 : 80;
          const maxW = container.parentElement
            ? container.parentElement.clientWidth
            : window.innerWidth;

          const onMove = (eMove) => {
            const dxRaw = eMove.clientX - startX;
            const dyRaw = eMove.clientY - startY;

            const cl = handle.classList;
            const isCorner =
              cl.contains("resize-handle--nw") ||
              cl.contains("resize-handle--ne") ||
              cl.contains("resize-handle--sw") ||
              cl.contains("resize-handle--se");
            const isSideE = cl.contains("resize-handle--e");
            const isSideW = cl.contains("resize-handle--w");
            const isSideN = cl.contains("resize-handle--n");
            const isSideS = cl.contains("resize-handle--s");

            // Positive dx/dy = growing
            const isRight =
              cl.contains("resize-handle--ne") ||
              cl.contains("resize-handle--se") ||
              isSideE;
            const isBottom =
              cl.contains("resize-handle--sw") ||
              cl.contains("resize-handle--se") ||
              isSideS;

            const dx = isRight ? dxRaw : -dxRaw;
            const dy = isBottom ? dyRaw : -dyRaw;

            if (isAudio) {
              // Audio: width-only, height is always fixed by the browser.
              const newW = Math.max(minW, Math.min(maxW, startW + dx * 2));
              container.style.width = `${newW}px`;
              saveMediaSizeDebounced(resizeKey, Math.round(newW), startH);
              return;
            }

            let newW, newH;

            if (isCorner) {
              // Use the dominant axis to drive scale; other follows ratio.
              const scaleByX = (startW + dx * 2) / startW;
              const scaleByY = (startH + dy * 2) / startH;
              const scale = Math.abs(dx) >= Math.abs(dy) ? scaleByX : scaleByY;
              newW = Math.max(minW, Math.min(maxW, startW * scale));
              newH = newW / aspectRatio;
            } else if (isSideE || isSideW) {
              // Horizontal drag → width drives, height follows ratio.
              newW = Math.max(minW, Math.min(maxW, startW + dx * 2));
              newH = newW / aspectRatio;
            } else {
              // Vertical drag (N/S) → height drives, width follows ratio.
              newH = Math.max(minH, startH + dy * 2);
              newW = Math.min(maxW, newH * aspectRatio);
              if (newW < minW) {
                newW = minW;
                newH = newW / aspectRatio;
              }
            }

            // Floor clamp on height.
            if (newH < minH) {
              newH = minH;
              newW = newH * aspectRatio;
            }

            container.style.width = `${newW}px`;
            container.style.height = `${newH}px`;
            saveMediaSizeDebounced(
              resizeKey,
              Math.round(newW),
              Math.round(newH),
            );
          };

          const onUp = () => {
            handle.classList.remove("is-active");
            document.body.classList.remove("is-resizing-media");
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup", onUp);
            handle.removeEventListener("pointercancel", onUp);
          };

          handle.addEventListener("pointermove", onMove);
          handle.addEventListener("pointerup", onUp);
          handle.addEventListener("pointercancel", onUp);
        });
      });
    });
};

function updateGamificationStats() {
  const userData = gameEngine.getUserData();
  const levelInfo = gameEngine.calculateLevel(userData.totalPoints);

  if (els.statLevel) els.statLevel.textContent = `Lv ${levelInfo.level || 0}`;
  if (els.statPoints)
    els.statPoints.textContent = `${userData.totalPoints || 0} pts`;
  if (els.statStreak) {
    const streak = userData.streaks?.currentDaily || 0;
    els.statStreak.textContent = `${streak} day${streak !== 1 ? "s" : ""}`;
  }
}

// === View Toggle ===
function toggleView() {
  viewMode = viewMode === "grid" ? "list" : "grid";
  localStorage.setItem("quiz_view_mode", viewMode);

  if (els.viewIcon && els.viewText) {
    if (viewMode === "grid") {
      els.viewIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-icon lucide-list"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg>`;
      els.viewText.textContent = "شكل القائمة";
    } else {
      els.viewIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid-icon lucide-layout-grid"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;
      els.viewText.textContent = "شكل الأيقونات";
    }
  }

  renderMenuNavigation();
}

// === Breadcrumb Logic ===
function updateBreadcrumb(meta) {
  if (!meta.path) return { courseName: "", fullBreadcrumb: "" };

  const parts = meta.path.split("/");
  let courseName = "";
  let intermediate = [];

  const quizzesIdx = parts.indexOf("quizzes");
  if (quizzesIdx !== -1 && quizzesIdx + 4 < parts.length) {
    courseName = parts[quizzesIdx + 4];
    if (quizzesIdx + 5 < parts.length - 1) {
      intermediate = parts.slice(quizzesIdx + 5, parts.length - 1);
    }
  } else if (parts.length >= 3) {
    courseName = parts[parts.length - 2];
  }

  if (!courseName) courseName = meta.category || "";

  // The full, untruncated trail — e.g. "IELTS Exams → Cambridge IELTS 2020 → Test 2"
  const fullBreadcrumb =
    intermediate.length > 0
      ? `${courseName} → ${intermediate.join(" → ")}`
      : courseName;

  if (els.breadcrumb) {
    const isMobile = window.innerWidth <= 768;
    const limit = isMobile ? 40 : 60;

    let breadcrumbText = "";

    if (intermediate.length > 0) {
      const fullString = `${courseName} → ${intermediate.join(" → ")}`;
      if (fullString.length > limit) {
        breadcrumbText = `${courseName} → ... `;
      } else {
        breadcrumbText = fullString;
      }
    } else {
      breadcrumbText = `${courseName} `;
    }

    els.breadcrumb.textContent = `Course: ${breadcrumbText}`;
  }

  return { courseName, fullBreadcrumb };
}

// === OPTIMIZED: Load exam JSON with caching ===
async function loadExamModule(config) {
  // Check cache first
  if (examModuleCache.has(config.id)) {
    console.log(`[Quiz] Using cached exam: ${config.id}`);
    return examModuleCache.get(config.id);
  }

  // Resolve the fetch URL.
  // Paths starting with "/" are origin-relative (e.g. "/data/quizzes/...")
  // Paths starting with "http" are already absolute (DB quizzes).
  // Legacy relative paths are resolved against import.meta.url.
  console.log(`[Quiz] Loading exam: ${config.id}`);
  let quizUrl;
  if (config.path.startsWith("/") || config.path.startsWith("http")) {
    quizUrl = new URL("" + config.path, window.location.origin);
  } else {
    quizUrl = new URL(config.path, new URL(import.meta.url));
  }
  let module;
  if (config.path.toLowerCase().endsWith(".json")) {
    const res = await fetch(quizUrl.href);
    if (!res.ok) throw new Error(`Failed to load quiz: ${res.status}`);
    const data = await res.json();
    module = { questions: data.questions || [], meta: data.meta || {} };
  } else {
    const loaded = await import(quizUrl.href);
    module = {
      questions: loaded.questions || [],
      meta: loaded.meta || {},
    };
  }

  // Cache it
  examModuleCache.set(config.id, module);

  // Limit cache size (LRU-style)
  if (examModuleCache.size > MAX_CACHE_SIZE) {
    const firstKey = examModuleCache.keys().next().value;
    examModuleCache.delete(firstKey);
  }

  return module;
}

async function init() {
  // ── Bug 2 Fix: reset all in-flight state before (re-)initialising ─────────
  // init() may be called a second time via the popstate listener when the user
  // presses the back button from the results page.  Without resetting, the
  // previous timer and answer state would bleed into the new session.
  resetQuizState();

  const params = new URLSearchParams(window.location.search);

  // ── Bug 2 Fix: safe param extraction ─────────────────────────────────────
  // params.get("id") returns null when the parameter is absent.
  // decodeURIComponent(null) produces the string "null", which is truthy and
  // bypasses the !examId guard below — leading to a confusing "Exam not found"
  // error.  Guard against null explicitly before decoding.
  const rawId = params.get("id");
  examId = rawId !== null ? decodeURIComponent(rawId) : null;

  // ── Quiz Mode ────────────────────────────────────────────────────────────
  // Mode is intentionally NOT in the URL (links stay mode-agnostic).
  // Each device/user gets its own mode from their profile / localStorage.
  quizMode = userProfile.getProfile().defaultQuizMode;

  const startTime = localStorage.getItem("quiz_start_time");

  // User-created quizzes still use ?type=user (URL-only, unchanged)
  const quizType = params.get("type");
  const startAt = params.get("startAt");

  // Validate quiz data exists
  if (!examId && !quizType) {
    console.error("No quiz selected");
    alert("لم يتم اختيار اختبار. سيتم توجيهك للصفحة الرئيسية.");
    window.location.href = "/";
    return;
  }

  // Validate start time (prevent stale quiz sessions - max 24 hours)
  if (startTime && examId) {
    const now = Date.now();
    const maxSessionAge = 24 * 60 * 60 * 1000; // 24 hours
    if (now - parseInt(startTime) > maxSessionAge) {
      console.warn("Quiz session expired");
      localStorage.removeItem("quiz_start_time");
      alert("انتهت صلاحية الجلسة. يرجى بدء الاختبار من جديد.");
      window.location.href = "/";
      return;
    }
  }

  // Load saved view mode
  const savedView = localStorage.getItem("quiz_view_mode");
  if (savedView) viewMode = savedView;

  // Load quiz style (vertical = all questions at once, pagination = one per page)
  quizStyle =
    userProfile && userProfile.getQuizStyle
      ? userProfile.getQuizStyle()
      : localStorage.getItem("quiz_style") || "pagination";
  if (quizStyle !== "vertical") quizStyle = "pagination";
  else {
    nextBtn.style.display = "none";
    prevBtn.style.display = "none";
  }

  // Update view toggle button
  if (els.viewIcon && els.viewText) {
    if (viewMode === "grid") {
      els.viewIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-icon lucide-list"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg>`;
      els.viewText.textContent = "شكل القائمة";
    } else {
      els.viewIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid-icon lucide-layout-grid"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;
      els.viewText.textContent = "شكل الأيقونات";
    }
  }

  try {
    // -----------------------------------------------------------
    // BRANCHING LOGIC: Check if this is a User Created Quiz or Standard Exam
    // -----------------------------------------------------------

    if (quizType === "user") {
      // === LOGIC FOR USER QUIZ ===
      let userQuizData = sessionStorage.getItem("active_user_quiz");

      // ── Bug 2 Fix: recover from localStorage when sessionStorage is empty ──
      // sessionStorage is tab-scoped and survives within a session.  However,
      // pressing the browser back button from the results page causes a full
      // page reload of quiz.html?id=…&type=user.  If the session storage item
      // was cleared (e.g. another quiz was opened in the same tab), the quiz
      // would show "Quiz not found!" and redirect to root instead of reloading.
      // As a fallback, scan the localStorage user_quizzes array for a matching
      // entry and restore it into sessionStorage so the quiz can continue.
      if (!userQuizData && examId) {
        try {
          const allUserQuizzes = JSON.parse(
            localStorage.getItem("user_quizzes") || "[]",
          );
          const recovered = allUserQuizzes.find((q) => q.id === examId);
          if (recovered) {
            userQuizData = JSON.stringify(recovered);
            // Restore so subsequent page interactions keep working normally.
            sessionStorage.setItem("active_user_quiz", userQuizData);
          }
        } catch (e) {
          console.warn(
            "[Quiz] Could not recover user quiz from localStorage:",
            e,
          );
        }
      }

      if (!userQuizData) {
        alert("Quiz not found!");
        window.location.href = "/";
        return;
      }

      const userQuiz = JSON.parse(userQuizData);

      // Map user questions to ensure correct format, handling both old and new essay style
      questions = userQuiz.questions.map((q) => {
        const out = { q: q.q };
        if (q.image) out.image = q.image;
        if (q.audio) out.audio = q.audio;
        if (q.video) out.video = q.video;
        if (q.passage) out.passage = q.passage;
        if (q.lang) out.lang = q.lang;
        if (q.explanation) out.explanation = q.explanation;
        // Normalize essay: old 1-option → new answer field
        if (Array.isArray(q.options) && q.options.length === 1) {
          out.answer = q.options[0] ?? "";
        } else if (!Array.isArray(q.options) && q.answer !== undefined) {
          out.answer = q.answer;
        } else {
          out.options = q.options;
          if (q.correct !== undefined) out.correct = q.correct;
        }
        return out;
      });

      // Support both old flat schema (title) and new nested schema (meta.title)
      metaData = {
        title: userQuiz.meta?.title || userQuiz.title,
        category: "Your Quiz",
        lang: userQuiz.meta?.lang || null,
        createdAt: userQuiz.meta?.createdAt || null,
        path: userQuiz.meta?.path || null,
        description: userQuiz.meta?.description || null,
        source: userQuiz.meta?.source || null,
      };
    } else {
      // === LOGIC FOR STANDARD EXAM (Original Code) ===
      const { examList } = await getManifest();
      const config = examList.find((e) => e.id === examId);

      if (!config) {
        alert("Exam not found!");
        window.location.href = "/";
        return;
      }

      // Use optimized loader with caching
      const module = await loadExamModule(config);
      questions = module.questions;
      quizBaseUrl = new URL("./", new URL(config.path, window.location.origin))
        .href;

      const parts = config.path.replace(/\\/g, "/").split("/");
      const filename = parts[parts.length - 1] || "";
      const name = filename.replace(/\.(json|js)$/i, "").replace(/[_-]+/g, " ");
      const fallbackTitle = name.replace(/\b\w/g, (c) => c.toUpperCase());
      // Prefer the title from the manifest over the one derived from filename
      metaData = {
        title: config.title || fallbackTitle,
        category: parts[parts.length - 2] || "",
        lang: module.meta?.lang || null,
        createdAt: module.meta?.createdAt || null,
        path: module.meta?.path || null,
        description: module.meta?.description || null,
        source: module.meta?.source || null,
      };
    }

    // -----------------------------------------------------------
    // SHARED LOGIC: UI Updates & Game Initialization
    // -----------------------------------------------------------

    // Update page title
    document.title = `إمتحان ${metaData.title}`;

    // === Populate Quiz Info Dialog ===
    (function populateInfoDialog() {
      const tbody = els.quizInfoTable?.querySelector("tbody");
      if (!tbody) return;

      // Reuse updateBreadcrumb() itself — it already computes the full
      // course trail (e.g. "IELTS Exams → Cambridge IELTS 2020 → Test 2").
      // No separate/duplicate logic here.
      const { fullBreadcrumb } = updateBreadcrumb(metaData);

      // Normalise the date display
      const formatDate = (raw) => {
        if (!raw) return null;
        let d = String(raw);
        if (d.includes(",")) d = d.split(",")[0];
        else if (d.includes(" - ")) d = d.split(" - ")[0];
        else if (d.includes(" ")) d = d.split(" ")[0];
        return d || null;
      };

      // Explicit ordered list of allowed fields — nothing else is ever shown
      const ROWS = [
        { label: "العنوان", val: metaData.title },
        { label: "الوصف", val: metaData.description },
        { label: "المادة", val: fullBreadcrumb || null },
        { label: "التاريخ", val: formatDate(metaData.createdAt) },
        { label: "المصدر", val: metaData.source },
        { label: "صاحب الإمتحان", val: metaData.author },
      ].filter((r) => r.val);

      if (!ROWS.length) {
        tbody.innerHTML = `<tr><td colspan="2" style="padding:12px 8px;opacity:0.6;">لا توجد معلومات إضافية</td></tr>`;
        return;
      }

      const isUrl = (s) => /^https?:\/\//i.test(s);

      tbody.innerHTML = ROWS.map(({ label, val }) => {
        const v = String(val);
        const displayVal = isUrl(v)
          ? `<a href="${escapeHtml(v)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v)}</a>`
          : escapeHtml(v);
        return `<tr>
          <th scope="row">${escapeHtml(label)}</th>
          <td>${displayVal}</td>
        </tr>`;
      }).join("");
    })();

    // Update Title UI
    if (els.title) {
      els.title.textContent = metaData.title || "Quiz";

      //  The styling was applied successfully, but the title still wasn't aligned
      //  to the right when it was arabic. Probably a styling issue not a logic issue.
      // const titleDir = detectTextDirection(metaData.title);
      // els.title.setAttribute("dir", titleDir);
      // els.title.style.textAlign = titleDir === "rtl" ? "right" : "left";
    }

    // Setup Timer
    if (quizMode === "timed" || quizMode === "timed_exam") {
      timeRemaining = questions.length * 30;
    }

    // Setup State Restoration
    if (startAt !== null) {
      currentIdx = parseInt(startAt);
    } else {
      // Note: We use examId here. For user quizzes, ensure examId is unique or handles collision
      const saved = localStorage.getItem(`quiz_state_${examId}`);
      if (saved && quizMode === "practice") {
        const state = JSON.parse(saved);
        if (await confirmationNotification("استئناف الإمتحان؟")) {
          currentIdx = state.currentIdx || 0;
          userAnswers = state.userAnswers || {};
          lockedQuestions = state.lockedQuestions || {};
          timeElapsed = state.timeElapsed || 0;
          // Bug 3 Fix: store media timestamps to be applied after the first render
          pendingMediaTimestamps = state.mediaTimestamps || null;
        } else {
          localStorage.removeItem(`quiz_state_${examId}`);
        }
      }
    }

    // Initialize Game Engine
    updateGamificationStats();
    renderMenuNavigation();
    renderQuestion();
    // Bug 3 Fix: apply any saved media timestamps after the first render
    applyPendingMediaTimestamps();
    startTimer();

    // Global handlers
    window.handleSelect = (i) => handleSelect(i);
    window.handleEssayInput = () => handleEssayInput();
    window.checkAnswer = () => checkAnswer();
    window.toggleView = () => toggleView();
    window.toggleBookmark = () => {
      gameEngine.toggleBookmark(examId, currentIdx);
      renderQuestion();
      renderMenuNavigationDebounced();
    };
    window.toggleFlag = () => {
      gameEngine.toggleFlag(examId, currentIdx);
      renderQuestion();
      renderMenuNavigationDebounced();
    };
    window.toggleQuestionBookmark = (idx) => {
      gameEngine.toggleBookmark(examId, idx);
      renderMenuNavigationDebounced();
      if (idx === currentIdx) {
        renderQuestion();
      }
    };
    window.toggleQuestionFlag = (idx) => {
      gameEngine.toggleFlag(examId, idx);
      renderMenuNavigationDebounced();
      if (idx === currentIdx) {
        renderQuestion();
      }
    };

    window.shareQuestion = async () => {
      // close menu first
      const closeBtn = document.getElementById("closeMenuBtn");
      if (closeBtn) closeBtn.click();

      const questionCard =
        quizStyle === "vertical"
          ? document.getElementById(`q-${currentIdx}`)
          : document.querySelector(".question-card");
      if (!questionCard) return;

      try {
        if (!window.html2canvas) {
          showNotification("جاري التجهيز", "يتم تحضير الصورة للمشاركة", "info");
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src =
              "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }

        // hide buttons temporarily for the screenshot
        const actions = questionCard.querySelector(".question-actions");
        if (actions) actions.style.display = "none";
        const checkBtn = questionCard.querySelector(".check-answer-btn");
        if (checkBtn) checkBtn.style.display = "none";

        const canvas = await html2canvas(questionCard, {
          backgroundColor: getComputedStyle(document.body).backgroundColor,
          scale: 2,
        });

        // restore buttons
        if (actions) actions.style.display = "";
        if (checkBtn) checkBtn.style.display = "";

        canvas.toBlob(async (blob) => {
          const file = new File([blob], "question-share.png", {
            type: "image/png",
          });
          if (
            navigator.share &&
            navigator.canShare &&
            navigator.canShare({ files: [file] })
          ) {
            await navigator.share({
              files: [file],
              title: "سؤال من الإمتحان",
            });
          } else {
            // fallback download
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "Basmagi Quiz Question.png";
            a.click();
            URL.revokeObjectURL(url);
            showNotification("تم", "تم تحميل صورة السؤال", "success");
          }
        });
      } catch (e) {
        console.error("Error sharing question", e);
        showNotification("خطأ", "حدث خطأ أثناء محاولة مشاركة السؤال", "error");
      }
    };

    window.copyCodeBlock = (btn) => {
      const wrapper = btn.closest(".code-block-wrapper");
      if (!wrapper) return;
      const codeEl = wrapper.querySelector("code");
      if (!codeEl) return;

      navigator.clipboard.writeText(codeEl.innerText).then(() => {
        const originalContent = btn.innerHTML;
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>`;
        btn.classList.add("copied");
        setTimeout(() => {
          btn.innerHTML = originalContent;
          btn.classList.remove("copied");
        }, 2000);
      });
    };
    window.jumpToQuestion = (idx) => {
      currentIdx = idx;
      saveStateDebounced();
      renderQuestion();
      renderMenuNavigationDebounced();

      const questionCard =
        quizStyle === "vertical"
          ? document.getElementById(`q-${idx}`)
          : document.querySelector(".question-card");
      if (questionCard) {
        questionCard.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    initKeyboardNav({
      onNext: () => nav(1),
      onPrev: () => nav(-1),
      onCheck: () => {
        if (quizMode === "exam" || quizMode === "timed_exam") return;
        checkAnswer();
      },
      onBookmark: () => window.toggleBookmark(),
      onFlag: () => window.toggleFlag(),
      onSelect: (i) => {
        if (lockedQuestions[currentIdx]) return;
        const q = questions[currentIdx];
        if (!q?.options || i >= q.options.length) return;
        userAnswers[currentIdx] = i;
        saveStateDebounced();
        renderQuestion();
        renderMenuNavigationDebounced();
        maybeAutoSubmit();
      },
    });
    if (els.viewToggle) {
      els.viewToggle.addEventListener("click", toggleView);
    }
  } catch (err) {
    console.error("Initialization Error:", err);
    if (els.questionContainer) {
      els.questionContainer.innerHTML = `<p style="color:red">Failed to load quiz data. ${err.message}</p>`;
    }
  }
}

// === OPTIMIZED: Debounced navigation rendering ===
function renderMenuNavigationDebounced() {
  if (renderNavDebounce) clearTimeout(renderNavDebounce);
  renderNavDebounce = setTimeout(() => {
    renderMenuNavigation();
  }, 100); // Wait 100ms before re-rendering
}

// === OPTIMIZED: Menu Navigation with smart updates ===
function renderMenuNavigation() {
  let navContainer = document.getElementById("menuNavContainer");
  if (!navContainer) return;

  const flagCount = gameEngine.getFlaggedCount(examId);
  const flagInfo =
    flagCount > 0
      ? `<span class="menu-flag-count"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg> ذو علامة مرجعية:  ${flagCount}</span>`
      : "";

  if (viewMode === "grid") {
    renderGridView(navContainer, flagInfo);
  } else {
    renderListView(navContainer, flagInfo);
  }

  // Always refresh icons after re-rendering nav (fixes debounced icon stale state)
}

// === OPTIMIZED: Grid view with DocumentFragment ===
function renderGridView(navContainer, flagInfo) {
  // Use DocumentFragment for better performance
  const fragment = document.createDocumentFragment();
  const container = document.createElement("div");
  container.className = "menu-nav-items grid-view";

  // Build all items at once
  questions.forEach((q, idx) => {
    const item = createGridItem(q, idx);
    container.appendChild(item);
  });

  fragment.appendChild(container);

  // Single DOM update
  navContainer.innerHTML = `
    <div class="menu-nav-grid">
      <div class="menu-nav-header">التنقل بين الأسئلة</div>
      <div class="menu-nav-legend">
        <span><span class="legend-dot current"></span> الحالي</span>
        <span><span class="legend-dot answered"></span> سؤالٌ مُجاب</span>
        <span><span class="legend-dot correct"></span> صحيح</span>
        <span><span class="legend-dot wrong"></span> خطأ</span>
        ${flagInfo}
        </div>
    </div>
  `;
  navContainer.querySelector(".menu-nav-grid").appendChild(container);
}

// === Helper: Create grid item element ===
function createGridItem(q, idx) {
  const isAnswered = userAnswers[idx] !== undefined;
  const isLocked = lockedQuestions[idx];
  const isBookmarked = gameEngine.isBookmarked(examId, idx);
  const isFlagged = gameEngine.isFlagged(examId, idx);
  const isCurrent = idx === currentIdx;

  let statusClass = "unanswered";
  let statusIcon = "";

  if (isCurrent) {
    statusClass = "current";
  } else if (isLocked) {
    let isCorrect;
    if (isEssayQuestion(q)) {
      // Bug 1 Fix: grade essay by score (≥3/5), not by exact string match
      const essayScore = gradeEssay(userAnswers[idx], getEssayAnswer(q));
      isCorrect = essayScore >= 3;
    } else {
      const correctIdx = q.correct ?? q.answer;
      isCorrect = isAnswerCorrect(userAnswers[idx], correctIdx);
    }
    statusClass = isCorrect ? "correct" : "wrong";
    statusIcon = isCorrect ? "✓" : "✗";
  } else if (isAnswered) {
    statusClass = "answered";
    statusIcon = "●";
  }

  const button = document.createElement("button");
  button.className = `menu-nav-item grid-item ${statusClass}`;
  button.onclick = () => window.jumpToQuestion(idx);
  button.title = `Question ${idx + 1}${isBookmarked ? " - Bookmarked" : ""}${
    isFlagged ? " - Flagged" : ""
  }`;

  button.innerHTML = `
    <span>${idx + 1}</span>
    ${
      statusIcon
        ? `<span class="menu-nav-status grid-status">${statusIcon}</span>`
        : ""
    }
    ${
      isBookmarked || isFlagged
        ? `
      <div class="menu-nav-badges">
        ${isBookmarked ? '<span class="mini-badge bookmark"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-icon lucide-star"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg></span>' : ""}
        ${isFlagged ? '<span class="mini-badge flag"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg></span>' : ""}
      </div>
    `
        : ""
    }
  `;

  return button;
}

// === List view (similar optimization) ===
function renderListView(navContainer, flagInfo) {
  // 1. Clear the container completely
  navContainer.innerHTML = "";

  // 2. Add Header and Legend as flat elements
  const headerDiv = document.createElement("div");
  headerDiv.innerHTML = `
    <div class="menu-nav-header">التنقل بين الأسئلة</div>
    <div class="menu-nav-legend">
      <span><span class="legend-dot current"></span> الحالي</span>
      <span><span class="legend-dot answered"></span> سؤالٌ مُجاب</span>
      <span><span class="legend-dot correct"></span> صحيح</span>
      <span><span class="legend-dot wrong"></span> خطأ</span>
     ${flagInfo || ""}     
     </div>
   
  `;
  navContainer.appendChild(headerDiv);

  // 3. Create the list container (no height limits)
  const listContainer = document.createElement("div");
  listContainer.className = "menu-nav-items list-view";

  // 4. Append buttons
  questions.forEach((q, idx) => {
    listContainer.appendChild(createListItem(q, idx));
  });

  navContainer.appendChild(listContainer);
}

// === Helper: Create list item element ===
function createListItem(q, idx) {
  const isAnswered = userAnswers[idx] !== undefined;
  const isLocked = lockedQuestions[idx];
  const isBookmarked = gameEngine.isBookmarked(examId, idx);
  const isFlagged = gameEngine.isFlagged(examId, idx);
  const isCurrent = idx === currentIdx;

  let statusClass = "unanswered";
  let statusIcon = "";

  if (isCurrent) {
    statusClass = "current";
  } else if (isLocked) {
    let isCorrect;
    if (isEssayQuestion(q)) {
      // Bug 1 Fix: grade essay by score (≥3/5), not by exact string match
      const essayScore = gradeEssay(userAnswers[idx], getEssayAnswer(q));
      isCorrect = essayScore >= 3;
    } else {
      const correctIdx = q.correct ?? q.answer;
      isCorrect = isAnswerCorrect(userAnswers[idx], correctIdx);
    }
    statusClass = isCorrect ? "correct" : "wrong";
    statusIcon = isCorrect ? "✓" : "✗";
  } else if (isAnswered) {
    statusClass = "answered";
    statusIcon = "●";
  }

  const div = document.createElement("div");
  div.className = `menu-nav-item list-item ${statusClass}`;

  div.innerHTML = `
    <div class="menu-nav-item-left" onclick="window.jumpToQuestion(${idx})">
      <span class="menu-nav-number">Q${idx + 1}</span>
      ${
        statusIcon
          ? `<span class="menu-nav-status list-status">${statusIcon}</span>`
          : ""
      }
    </div>
    <div class="menu-nav-item-right">
      <span class="menu-nav-icon bookmark-icon ${isBookmarked ? "active" : ""}" 
            onclick="event.stopPropagation(); window.toggleQuestionBookmark(${idx})"
            title="${isBookmarked ? "Remove Bookmark" : "Bookmark"}">
        ${isBookmarked ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-off-icon lucide-star-off"><path d="m10.344 4.688 1.181-2.393a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.237 3.152"/><path d="m17.945 17.945.43 2.505a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a8 8 0 0 0 .4-.099"/><path d="m2 2 20 20"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-icon lucide-star"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>'}
      </span>
      <span class="menu-nav-icon flag-icon ${isFlagged ? "active" : ""}" 
            onclick="event.stopPropagation(); window.toggleQuestionFlag(${idx})"
            title="${isFlagged ? "إزالة العلامة" : "إضافة علامة للمراجعة"}">
        ${isFlagged ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-icon lucide-flag"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>'}
      </span>
    </div>
  `;

  return div;
}

// === Vertical style: build one question card HTML for index idx ===
function buildVerticalQuestionCard(q, idx) {
  const isEssay = isEssayQuestion(q);
  const correctIdx = q.correct ?? q.answer;
  const isLocked = !!lockedQuestions[idx];
  const userSelected = userAnswers[idx];
  const isBookmarked = gameEngine.isBookmarked(examId, idx);
  const isFlagged = gameEngine.isFlagged(examId, idx);
  const showCheckButton = quizMode !== "exam" && quizMode !== "timed_exam";
  let feedbackClass = "feedback";
  let feedbackText = "";
  const explanationText =
    q.explanation || q.desc || q.info || "No explanation provided.";

  if (isLocked) {
    let isCorrect;
    if (isEssay) {
      const essayScore = gradeEssay(userSelected, getEssayAnswer(q));
      isCorrect = essayScore >= 3;
      feedbackClass += " essay-feedback show";
      const stars = "★".repeat(essayScore) + "☆".repeat(5 - essayScore);
      feedbackText = `<strong>Score: ${essayScore}/5: ${stars}</strong><strong>Explanation:</strong> <div class="feedback-body">${renderMarkdown(normalizeLiteralNewlines(explanationText))}</div>`;
    } else {
      isCorrect = userSelected === correctIdx;
      feedbackClass += isCorrect ? " correct show" : " wrong show";
      feedbackText = `<div class="feedback-body"><strong>Explanation: </strong>${renderMarkdown(normalizeLiteralNewlines(explanationText))}</div>`;
    }
  }

  const actionBtns = `
    <div class="question-actions">
      <button class="bookmark-btn ${isBookmarked ? "active" : ""}" onclick="window.toggleQuestionBookmark(${idx})" title="${isBookmarked ? "Remove Bookmark" : "Bookmark"}">${isBookmarked ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-off-icon lucide-star-off"><path d="m10.344 4.688 1.181-2.393a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.237 3.152"/><path d="m17.945 17.945.43 2.505a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a8 8 0 0 0 .4-.099"/><path d="m2 2 20 20"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-icon lucide-star"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>`}</button>
      <button class="flag-btn ${isFlagged ? "active" : ""}" onclick="window.toggleQuestionFlag(${idx})" title="${isFlagged ? "إزالة العلامة" : "إضافة علامة للمراجعة"}">${isFlagged ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-icon lucide-flag"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>`}</button>
    </div>
  `;

  const qLang = getQuestionLang(q);
  const alignClass = getAlignClass(q.q, qLang);
  const passageAlignClass = getAlignClass(q.passage || q.q, qLang);
  const largeClass = isLargeFormatQuestion(q) ? " question-card--large" : "";
  const passageClass =
    !q.passage && String(q.q).length > 400 ? " question-text--passage" : "";

  const header = `
    <div class="question-header">
      <div class="question-number">سؤال ${idx + 1} من ${questions.length}</div>
      ${actionBtns}
    </div>
    ${renderQuestionMedia(q, `q${idx}`)}
    ${renderReadingPassage(q.passage, passageAlignClass)}
    <h2 class="question-text ${alignClass}${passageClass}">${renderMarkdown(normalizeLiteralNewlines(q.q))}</h2>
  `;

  if (isEssay) {
    return `
      <div class="question-card vertical-question-card${largeClass}" data-question-index="${idx}" id="q-${idx}">
        ${header}
        <div class="essay-container">
          <textarea id="essayInput-${idx}" class="essay-textarea ${isLocked ? "locked" : ""}" placeholder="Type your answer here..." ${isLocked ? "disabled" : ""} oninput="window.handleEssayInputForQuestion(${idx})">${escapeHtml(userSelected || "")}</textarea>
        </div>
        <button class="check-answer-btn ${isLocked || !showCheckButton ? "hidden" : ""}" onclick="window.checkAnswerForQuestion(${idx})" ${!userSelected || String(userSelected).trim() === "" ? "disabled" : ""}>Check Answer</button>
        ${isLocked ? `<div class="formal-answer"><strong>Formal Answer:</strong><div class="formal-answer-text">${renderMarkdown(normalizeLiteralNewlines(getEssayAnswer(q)))}</div></div>` : ""}
        <div class="${feedbackClass}">${feedbackText}</div>
      </div>
    `;
  }

  // === MCQ card ===
  const optionsHtml = q.options
    .map((opt, i) => {
      const isSelected = userSelected === i;
      let optionClass = "option-row";
      if (isSelected) optionClass += " selected";
      if (isLocked) {
        optionClass += " locked";
        if (i === correctIdx) optionClass += " correct";
        if (isSelected && i !== correctIdx) optionClass += " wrong";
      }
      const optAlign = getAlignClass(opt, qLang);
      return `
        <div class="${optionClass} ${optAlign}" ${isLocked ? "" : `onclick="window.handleSelectForQuestion(${idx}, ${i})"`}>
          <input type="radio" name="answer-${idx}" ${isSelected ? "checked" : ""} ${isLocked ? "disabled" : ""} aria-label="Option ${i + 1}">
          <span class="option-label">${renderMarkdown(normalizeLiteralNewlines(opt))}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="question-card vertical-question-card${largeClass}" data-question-index="${idx}" id="q-${idx}">
      ${header}
      <div class="options-grid">${optionsHtml}</div>
      <button class="check-answer-btn ${isLocked || !showCheckButton ? "hidden" : ""}" onclick="window.checkAnswerForQuestion(${idx})" ${userSelected === undefined ? "disabled" : ""}>Check Answer</button>
      <div class="${feedbackClass}">${feedbackText}</div>
    </div>
  `;
}

// Bug 2 Fix: helper that replaces the question container HTML while preserving
// media playback state (currentTime + paused/playing) in pagination mode.
function setQuestionHTML(html) {
  // Snapshot all currently-playing media elements before the DOM is replaced
  const mediaStates = [];
  els.questionContainer.querySelectorAll("audio, video").forEach((el) => {
    mediaStates.push({
      baseUrl: (el.src || "").split("?")[0],
      time: el.currentTime,
      paused: el.paused,
    });
  });

  els.questionContainer.innerHTML = html;

  // Apply text direction classes synchronously — before the MutationObserver
  // fires — so there is no flash-of-wrong-direction on question navigation.
  TextDirectionEngine.scan(els.questionContainer);

  // Restore timestamps on the newly-inserted media elements
  if (mediaStates.length) {
    els.questionContainer.querySelectorAll("audio, video").forEach((el, i) => {
      const state = mediaStates[i];
      if (!state || state.time <= 0) return;
      const restore = () => {
        el.currentTime = state.time;
        if (!state.paused) el.play().catch(() => {});
      };
      if (el.readyState >= 1) restore();
      else el.addEventListener("loadedmetadata", restore, { once: true });
    });
  }
}

function renderAllQuestionsVertical() {
  if (!els.questionContainer || !questions.length) return;

  const answeredCount = Object.keys(userAnswers).length;
  const progressPercent = (answeredCount / questions.length) * 100;
  if (els.progressFill) {
    els.progressFill.style.width = `${progressPercent}%`;
    els.progressFill.classList.toggle(
      "progress-near-complete",
      progressPercent >= 80,
    );
  }
  if (els.progressText)
    els.progressText.textContent = `${Math.round(progressPercent)}% (${answeredCount}/${questions.length})`;

  // Bug 2 Fix: if we know which card changed, only rebuild that card.
  // This leaves all other cards (and their media elements) completely
  // untouched so audio/video playback is never interrupted.
  if (
    lastChangedIdx !== null &&
    document.getElementById(`q-${lastChangedIdx}`)
  ) {
    const targetIdx = lastChangedIdx;
    lastChangedIdx = null;

    const existingCard = document.getElementById(`q-${targetIdx}`);

    // Preserve any media timestamps on the card being replaced
    const mediaStates = [];
    existingCard.querySelectorAll("audio, video").forEach((el) => {
      mediaStates.push({ time: el.currentTime, paused: el.paused });
    });

    const temp = document.createElement("div");
    temp.innerHTML = buildVerticalQuestionCard(questions[targetIdx], targetIdx);
    const newCard = temp.firstElementChild;
    existingCard.replaceWith(newCard);

    // Restore media timestamps on the rebuilt card
    if (mediaStates.length) {
      newCard.querySelectorAll("audio, video").forEach((el, i) => {
        const state = mediaStates[i];
        if (!state || state.time <= 0) return;
        const restore = () => {
          el.currentTime = state.time;
          if (!state.paused) el.play().catch(() => {});
        };
        if (el.readyState >= 1) restore();
        else el.addEventListener("loadedmetadata", restore, { once: true });
      });
    }

    initMediaSkeletons(newCard);
    // Targeted direction scan — only the rebuilt card, not the whole page.
    TextDirectionEngine.scan(newCard);
    return;
  }

  lastChangedIdx = null;

  // Full (first) render
  els.questionContainer.innerHTML = questions
    .map((q, idx) => buildVerticalQuestionCard(q, idx))
    .join("");
  els.questionContainer.classList.remove("loading");
  els.questionContainer.classList.add("vertical-style");
  initMediaSkeletons(els.questionContainer);
  // Scan all cards in one pass after the full render so direction classes
  // are set before the browser paints — no per-card flicker.
  TextDirectionEngine.scan(els.questionContainer);
}

// === Core: Render Question ===
// Bug-fix: builds everything EXCEPT the media block (header text, action
// buttons, reading passage, options/essay input, check button, feedback).
// Splitting this out lets renderQuestion() patch just this part on every
// input interaction without touching the media DOM at all — so audio/video/
// YouTube elements never unmount, reload, or flicker while answering.
function buildQuestionBodyHTML(q, idx, passageAlignClass) {
  const isEssay = isEssayQuestion(q);
  const correctIdx = q.correct ?? q.answer;
  const isLocked = !!lockedQuestions[idx];
  const userSelected = userAnswers[idx];
  const isBookmarked = gameEngine.isBookmarked(examId, idx);
  const isFlagged = gameEngine.isFlagged(examId, idx);
  const showCheckButton = quizMode !== "exam" && quizMode !== "timed_exam";

  let feedbackClass = "feedback";
  let feedbackText = "";
  const explanationText =
    q.explanation || q.desc || q.info || "No explanation provided.";

  if (isLocked) {
    let isCorrect = false;

    if (isEssay) {
      const essayScore = gradeEssay(userSelected, getEssayAnswer(q));
      isCorrect = essayScore >= 3;
      feedbackClass += " essay-feedback show";
      const stars = "★".repeat(essayScore) + "☆".repeat(5 - essayScore);
      feedbackText = `<strong>Score: ${essayScore}/5: ${stars}</strong><strong>Explanation:</strong> <div class="feedback-body">${renderMarkdown(normalizeLiteralNewlines(explanationText))}</div>`;
    } else {
      if (Array.isArray(correctIdx)) {
        isCorrect =
          Array.isArray(userSelected) &&
          userSelected.length === correctIdx.length &&
          correctIdx.every((i) => userSelected.includes(i));
      } else {
        isCorrect = isAnswerCorrect(userSelected, correctIdx);
      }
      feedbackClass += isCorrect ? " correct show" : " wrong show";
      feedbackText = `<div class="feedback-body"><strong>Explanation: </strong>${renderMarkdown(
        normalizeLiteralNewlines(explanationText),
      )}</div>`;
    }
  }

  const actionButtons = `
    <div class="question-actions">
      <button class="bookmark-btn ${isBookmarked ? "active" : ""}" 
              onclick="window.toggleBookmark()" 
              title="${isBookmarked ? "Remove Bookmark" : "Bookmark"}">
        ${isBookmarked ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-off-icon lucide-star-off"><path d="m10.344 4.688 1.181-2.393a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.237 3.152"/><path d="m17.945 17.945.43 2.505a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a8 8 0 0 0 .4-.099"/><path d="m2 2 20 20"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-icon lucide-star"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>`}
      </button>
      <button class="flag-btn ${isFlagged ? "active" : ""}" 
              onclick="window.toggleFlag()" 
              title="${isFlagged ? "إزالة العلامة" : "إضافة علامة للمراجعة"}">
        ${isFlagged ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-off-icon lucide-flag-off"><path d="M16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/><path d="m2 2 20 20"/><path d="M4 22V4"/><path d="M7.656 2H8c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10.347"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-icon lucide-flag"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>`}
      </button>
    </div>
  `;

  const qLang = getQuestionLang(q);
  const alignClass = getAlignClass(q.q, qLang);
  const largeClass = isLargeFormatQuestion(q) ? " question-card--large" : "";
  const passageClass =
    !q.passage && String(q.q).length > 400 ? " question-text--passage" : "";

  const textHeaderHTML = `
    <div class="question-header">
      <div class="question-number">سؤال ${idx + 1} من ${questions.length}</div>
      ${actionButtons}
    </div>
    ${renderReadingPassage(q.passage, passageAlignClass)}
    <h2 class="question-text ${alignClass}${passageClass}">${renderMarkdown(normalizeLiteralNewlines(q.q))}</h2>
  `;

  if (isEssay) {
    return {
      largeClass,
      html: `
        ${textHeaderHTML}
        <div class="essay-container">
          <textarea 
            id="essayInput" 
            class="essay-textarea ${isLocked ? "locked" : ""}" 
            placeholder="Type your answer here..."
            ${isLocked ? "disabled" : ""}
            oninput="window.handleEssayInput()"
          >${escapeHtml(userSelected || "")}</textarea>
        </div>
        <button class="check-answer-btn ${
          isLocked || !showCheckButton ? "hidden" : ""
        }"
                id="checkBtn" onclick="window.checkAnswer()"
                ${
                  !userSelected || String(userSelected).trim() === ""
                    ? "disabled"
                    : ""
                }>
          Check Answer
        </button>
        ${
          isLocked
            ? `
          <div class="formal-answer">
            <strong>Formal Answer:</strong>
            <div class="formal-answer-text">${renderMarkdown(normalizeLiteralNewlines(getEssayAnswer(q)))}</div>
          </div>
        `
            : ""
        }
        <div class="${feedbackClass}">${feedbackText}</div>
      `,
    };
  }

  const isMultiple = Array.isArray(q.correct);

  return {
    largeClass,
    html: `
      ${textHeaderHTML}
      <div class="options-grid">
        ${q.options
          .map((opt, i) => {
            let isSelected = false;
            if (isMultiple) {
              isSelected =
                Array.isArray(userSelected) && userSelected.includes(i);
            } else {
              isSelected = userSelected === i;
            }

            const optAlign = getAlignClass(opt, qLang);
            let optionClass = "option-row";
            if (isSelected) optionClass += " selected";
            if (isLocked) {
              optionClass += " locked";
              const isCorrectOption = isMultiple
                ? Array.isArray(q.correct) && q.correct.includes(i)
                : i === q.correct;
              if (isCorrectOption) optionClass += " correct";
              if (isSelected && !isCorrectOption) optionClass += " wrong";
            }

            const inputType = isMultiple ? "checkbox" : "radio";
            const inputName = isMultiple ? `answer-${i}` : "answer";

            return `
            <div class="${optionClass} ${optAlign}" ${
              isLocked ? "" : `onclick="window.handleSelect(${i})"`
            }>
              <input type="${inputType}" name="${inputName}" ${
                isSelected ? "checked" : ""
              } 
                     ${isLocked ? "disabled" : ""} aria-label="Option ${i + 1}">
              <span class="option-label">${renderMarkdown(normalizeLiteralNewlines(opt))}</span>
            </div>`;
          })
          .join("")}
      </div>
      <button class="check-answer-btn ${
        isLocked || !showCheckButton ? "hidden" : ""
      }"
              id="checkBtn" onclick="window.checkAnswer()"
              ${userSelected === undefined || (isMultiple && (!Array.isArray(userSelected) || userSelected.length === 0)) ? "disabled" : ""}>
        Check Answer
      </button>
      <div class="${feedbackClass}">${feedbackText}</div>
    `,
  };
}

// === Core: Render Question (pagination style) ===
// Bug 5 Fix: media is rendered into its own `.question-media-wrap` once per
// question. Re-renders triggered by answering (handleSelect/checkAnswer/
// essay input) only touch `.question-body`, so the media DOM (audio/video/
// YouTube iframe) is never unmounted or reloaded.
function renderQuestion() {
  if (!questions.length) return;

  if (quizStyle === "vertical") {
    renderAllQuestionsVertical();
    updateNav();
    return;
  }

  const q = questions[currentIdx];

  // Update Progress
  const answeredCount = Object.keys(userAnswers).length;
  const progressPercent = (answeredCount / questions.length) * 100;
  if (els.progressFill) {
    els.progressFill.style.width = `${progressPercent}%`;
    els.progressFill.classList.toggle(
      "progress-near-complete",
      progressPercent >= 80,
    );
  }
  if (els.progressText)
    els.progressText.textContent = `${Math.round(
      progressPercent,
    )}% (${answeredCount}/${questions.length})`;

  const qLang = getQuestionLang(q);
  const passageAlignClass = getAlignClass(q.passage || q.q, qLang);
  const { largeClass, html: bodyHTML } = buildQuestionBodyHTML(
    q,
    currentIdx,
    passageAlignClass,
  );

  els.questionContainer.classList.remove("loading");

  const existingCard = els.questionContainer.querySelector(".question-card");
  const sameQuestion =
    existingCard && Number(existingCard.dataset.questionIndex) === currentIdx;

  if (sameQuestion) {
    // In-place update: only the body changes. Media wrap is left untouched
    // so its audio/video/iframe elements keep playing without interruption.
    const bodyEl = existingCard.querySelector(".question-body");
    if (bodyEl) {
      bodyEl.innerHTML = bodyHTML;
      existingCard.className = `question-card${largeClass}`;
      // Re-scan only the patched body — avoids touching the media wrap and
      // keeps direction classes in sync without a full-container scan.
      TextDirectionEngine.scan(bodyEl);
    } else {
      // Defensive fallback in case the expected structure is missing
      setQuestionHTML(
        renderFullQuestionCard(q, currentIdx, largeClass, bodyHTML),
      );
      initMediaSkeletons(els.questionContainer);
    }
  } else {
    // Navigated to a different question (or first render): full rebuild,
    // including a fresh media block for the new question.
    setQuestionHTML(
      renderFullQuestionCard(q, currentIdx, largeClass, bodyHTML),
    );
    initMediaSkeletons(els.questionContainer);
  }

  updateNav();
}

function renderFullQuestionCard(q, idx, largeClass, bodyHTML) {
  return `
    <div class="question-card${largeClass}" data-question-index="${idx}">
      <div class="question-media-wrap">${renderQuestionMedia(q, `q${idx}`)}</div>
      <div class="question-body">${bodyHTML}</div>
    </div>
  `;
}

// === Event Handlers ===
function handleSelect(index) {
  if (lockedQuestions[currentIdx]) return;

  const q = questions[currentIdx];
  const isMultiple = Array.isArray(q.correct);

  if (isMultiple) {
    // Multiple selection: toggle the checkbox
    if (!Array.isArray(userAnswers[currentIdx])) {
      userAnswers[currentIdx] = [];
    }
    const answerArray = userAnswers[currentIdx];
    const idx = answerArray.indexOf(index);
    if (idx > -1) {
      answerArray.splice(idx, 1);
    } else {
      answerArray.push(index);
    }
  } else {
    // Single selection: replace with new answer
    userAnswers[currentIdx] = index;
  }

  saveStateDebounced();
  lastChangedIdx = currentIdx; // Bug 2 Fix: tag for targeted pagination re-render
  renderQuestion();
  renderMenuNavigationDebounced();
  maybeAutoSubmit();
}

function handleEssayInput() {
  if (lockedQuestions[currentIdx]) return;
  const textarea = document.getElementById("essayInput");
  if (textarea) {
    userAnswers[currentIdx] = textarea.value;
    saveStateDebounced();
    const checkBtn = document.getElementById("checkBtn");
    if (checkBtn) {
      checkBtn.disabled = !textarea.value.trim();
    }
  }
}

/**
 * Dynamic Text Direction Injection Engine
 * Tailored for Mixed-Language Arabic/English
 */
const TextDirectionEngine = (() => {
  // Optimized RegEx matching Arabic character scripts
  const ARABIC_REGEX =
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  // RegEx to capture the very first English or Arabic script alphabetical character
  const FIRST_STRONG_CHAR_REGEX =
    /[A-Za-z\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  // Selectors targeted for direction adjustment
  const TARGET_SELECTORS = [
    ".question-text",
    ".option-label",
    ".feedback",
    ".feedback-body",
    ".formal-answer",
    ".formal-answer-text",
    ".md-content",
    ".essay-textarea",
  ].join(", ");

  // Exception selectors that MUST remain LTR
  const EXCEPTION_SELECTORS = [
    "pre",
    "code",
    ".code-block",
    ".reading-passage",
    ".question-text--passage",
  ].join(", ");

  /**
   * Detects the direction of a given text string based on its first strong alphabetical letter.
   * Seamlessly ignores leading spaces, numbers, bullet punctuation, and emojis.
   * @param {string} text
   * @returns {'rtl' | 'ltr'}
   */
  function detectDirection(text) {
    if (!text || typeof text !== "string") return "ltr";

    // Find the first true alphabetical letter in Arabic or English
    const match = text.match(FIRST_STRONG_CHAR_REGEX);
    if (match) {
      // If that first real character is Arabic, it's RTL
      return ARABIC_REGEX.test(match[0]) ? "rtl" : "ltr";
    }
    return "ltr"; // Fallback default
  }

  /**
   * Evaluates and applies text direction classes to a single DOM element.
   * @param {HTMLElement} element
   */
  function processElement(element) {
    if (!element) return;

    // Fast-path protection for strict LTR exceptions (Passages and Code blocks)
    if (element.closest(EXCEPTION_SELECTORS)) {
      if (!element.classList.contains("text-ltr")) {
        element.classList.remove("text-rtl");
        element.classList.add("text-ltr");
      }
      return;
    }

    // Extract text depending on element type
    const text =
      element.tagName === "INPUT" || element.tagName === "TEXTAREA"
        ? element.value
        : element.textContent;

    const direction = detectDirection(text);

    // Apply classes conditionally to minimize layout/repaint loops
    if (direction === "rtl") {
      if (!element.classList.contains("text-rtl")) {
        element.classList.remove("text-ltr");
        element.classList.add("text-rtl");
      }
    } else {
      if (!element.classList.contains("text-ltr")) {
        element.classList.remove("text-rtl");
        element.classList.add("text-ltr");
      }
    }
  }

  /**
   * Scans a specific container element and updates all matching child nodes.
   * Call this explicitly inside your quiz rendering cycles.
   * @param {HTMLElement} container
   */
  function scan(container = document) {
    const elements = container.querySelectorAll(TARGET_SELECTORS);
    elements.forEach(processElement);
  }

  /**
   * Initializes real-time text-change listeners and fallback MutationObservers.
   */
  function init() {
    // 1. Real-time User Input Tracking (for Essay Workspace inputs)
    document.addEventListener("input", (event) => {
      if (
        event.target &&
        event.target.matches('.essay-textarea, input[type="text"]')
      ) {
        processElement(event.target);
      }
    });

    // 2. Automated Observer Fallback to handle async question content swaps
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // Handle elements added dynamically
        if (mutation.addedNodes.length) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches(TARGET_SELECTORS)) {
                processElement(node);
              }
              scan(node);
            }
          });
        }
        // Handle raw text modifications inside nodes
        if (mutation.type === "characterData") {
          const parent = mutation.target.parentElement;
          if (parent && parent.closest(TARGET_SELECTORS)) {
            processElement(parent.closest(TARGET_SELECTORS));
          }
        }
      });
    });

    // Start observing the main DOM structure defensively
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  return {
    init,
    scan,
    detectDirection,
  };
})();

// Autostart core global interactions when script evaluates
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () =>
    TextDirectionEngine.init(),
  );
} else {
  TextDirectionEngine.init();
}

const maybeAutoSubmit = () => {
  if (autoSubmitTimeout) {
    clearTimeout(autoSubmitTimeout);
    autoSubmitTimeout = null;
  }

  const answered = Object.keys(userAnswers).length;
  if (answered === questions.length && questions.length > 0) {
    autoSubmitTimeout = setTimeout(async () => {
      try {
        if (
          await confirmationNotification(
            "لقد أجبت على جميع الأسئلة. هل تريد تسليم الإمتحان الآن؟",
          )
        ) {
          finish(true);
        }
      } catch (e) {
        console.error("Auto-submit error:", e);
      }
      autoSubmitTimeout = null;
    }, 5000);
  }
};

function nav(dir) {
  const newIdx = currentIdx + dir;
  if (newIdx < 0 || newIdx >= questions.length) return;
  currentIdx = newIdx;
  saveStateDebounced();
  renderQuestion();
  renderMenuNavigationDebounced();
  if (quizStyle === "vertical") {
    const el = document.getElementById(`q-${currentIdx}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function finish(skipconfirmationNotification) {
  if (autoSubmitTimeout) {
    clearTimeout(autoSubmitTimeout);
    autoSubmitTimeout = null;
  }

  if (
    !skipconfirmationNotification &&
    !(await confirmationNotification("هل تريد أن تسلم؟"))
  )
    return;

  stopTimer();

  let correctCount = 0; // MCQ points
  let essayScore = 0; // Essay points earned
  let essayMaxScore = 0; // Essay points possible
  let essayQuestions = [];

  questions.forEach((q, i) => {
    if (isEssayQuestion(q)) {
      essayQuestions.push(i);
      const score = gradeEssay(userAnswers[i], getEssayAnswer(q));
      essayScore += score;
      essayMaxScore += 5;
    } else {
      const correctIdx = q.correct ?? q.answer;
      if (isAnswerCorrect(userAnswers[i], correctIdx)) correctCount++;
    }
  });

  const mcqCount = questions.length - essayQuestions.length;
  const totalScore = correctCount + essayScore;
  const totalPossible = mcqCount + essayMaxScore;

  const rawResult = {
    examId,
    examTitle: metaData.title,
    questions: questions,
    score: totalScore,
    total: totalPossible,
    mcqScore: correctCount,
    mcqTotal: mcqCount,
    essayScore: essayScore,
    essayMaxScore: essayMaxScore,
    totalQuestions: questions.length,
    essayQuestions: essayQuestions,
    userAnswers,
    timeElapsed:
      quizMode === "timed" || quizMode === "timed_exam"
        ? questions.length * 30 - timeRemaining
        : timeElapsed,
    timeRemaining:
      quizMode === "timed" || quizMode === "timed_exam" ? timeRemaining : 0,
    quizMode,
    mode: quizMode,
  };

  const gamifiedResult = gameEngine.processResult(rawResult);

  const finalOutput = {
    ...rawResult,
    gamification: gamifiedResult,
  };

  localStorage.setItem("last_quiz_result", JSON.stringify(finalOutput));
  localStorage.removeItem(`quiz_state_${examId}`);
  gameEngine.clearFlags(examId);

  // Clear quiz session data
  localStorage.removeItem("quiz_start_time");

  window.location.href = "result.html";
}

async function restart(skipconfirmationNotification) {
  // 1. confirmationNotification Intent
  if (
    !skipconfirmationNotification &&
    !(await confirmationNotification(
      "هل تريد إعادة الإمتحان؟ سيتم فقدان التقدم الحالي",
    ))
  )
    return;

  // 2. SAFETY: Kill the pending save timer immediately.
  // This prevents the previous state from overwriting our "clean slate"
  // 300ms after this function runs.
  if (saveStateDebounce) {
    clearTimeout(saveStateDebounce);
    saveStateDebounce = null;
  }

  // 3. Clear Intervals
  if (timerInterval) clearInterval(timerInterval);
  if (autoSubmitTimeout) {
    clearTimeout(autoSubmitTimeout);
    autoSubmitTimeout = null;
  }

  // 4. Wipe Storage
  localStorage.removeItem(`quiz_state_${examId}`);

  // 5. Reset Memory State
  currentIdx = 0;
  userAnswers = {};
  lockedQuestions = {};
  timeElapsed = 0;

  // 6. Reset Timed Mode Logic
  if (quizMode === "timed" || quizMode === "timed_exam") {
    timeRemaining = questions.length * 30;
  }

  // 7. Reset UI
  if (els.timer) {
    els.timer.style.color = "";
    if (quizMode === "timed" || quizMode === "timed_exam") {
      const mins = Math.floor(timeRemaining / 60)
        .toString()
        .padStart(2, "0");
      const secs = (timeRemaining % 60).toString().padStart(2, "0");
      els.timer.textContent = `${mins}:${secs}`;
    } else {
      els.timer.textContent = `00:00`;
    }
  }

  // 8. Re-render
  renderQuestion();
  renderMenuNavigation();
  startTimer();

  // 9. Scroll to top
  window.scrollTo(0, 0);
}

async function exit(skipconfirmationNotification) {
  if (
    !skipconfirmationNotification &&
    !(await confirmationNotification("هل أنت متأكد من الخروج؟"))
  )
    return;

  localStorage.removeItem(`quiz_state_${examId}`);

  localStorage.removeItem("quiz_start_time");

  window.location.href = "/";
}

function checkAnswer() {
  const q = questions[currentIdx];
  const isEssay = isEssayQuestion(q);

  if (isEssay) {
    const textarea = document.getElementById("essayInput");
    if (!textarea || !textarea.value.trim()) return;
  } else {
    const userAnswer = userAnswers[currentIdx];
    if (userAnswer === undefined) return;
    // For multiple choice, ensure answer exists (could be empty array)
    if (Array.isArray(userAnswer) && userAnswer.length === 0) return;
  }

  lockedQuestions[currentIdx] = true;
  saveStateDebounced();
  renderQuestion();
  renderMenuNavigationDebounced();
  updateNav();
}

// === Utilities ===
function updateNav() {
  if (quizStyle === "vertical") {
    // In vertical mode, prev/next scroll to previous/next question card
    if (els.prevBtn) {
      els.prevBtn.disabled = currentIdx === 0;
      els.prevBtn.textContent = "السابق ←";
    }
    if (els.nextBtn) {
      els.nextBtn.disabled = currentIdx === questions.length - 1;
      els.nextBtn.textContent = "→ التالي";
    }
  } else {
    if (els.prevBtn) els.prevBtn.disabled = currentIdx === 0;
    if (els.nextBtn) {
      els.nextBtn.style.display = "inline-block";
      els.nextBtn.disabled = currentIdx === questions.length - 1;
    }
  }
  if (els.finishBtn) {
    els.finishBtn.style.display = "flex";
    const totalLocked = Object.keys(lockedQuestions).length;
  }
}

// === OPTIMIZED: Debounced save state ===
function saveStateDebounced() {
  if (quizMode === "timed" || quizMode === "timed_exam") return;

  if (saveStateDebounce) clearTimeout(saveStateDebounce);
  saveStateDebounce = setTimeout(() => {
    // Bug 3 Fix: capture current media timestamps so they survive a page reload.
    const mediaTimestamps = {};
    if (quizStyle === "vertical") {
      els.questionContainer
        .querySelectorAll(".vertical-question-card")
        .forEach((card) => {
          const idx = parseInt(card.dataset.questionIndex, 10);
          if (isNaN(idx)) return;
          card.querySelectorAll("audio, video").forEach((el, i) => {
            if (el.currentTime > 0) {
              if (!mediaTimestamps[idx]) mediaTimestamps[idx] = [];
              mediaTimestamps[idx][i] = el.currentTime;
            }
          });
        });
    } else {
      els.questionContainer
        .querySelectorAll("audio, video")
        .forEach((el, i) => {
          if (el.currentTime > 0) {
            if (!mediaTimestamps[currentIdx]) mediaTimestamps[currentIdx] = [];
            mediaTimestamps[currentIdx][i] = el.currentTime;
          }
        });
    }

    const state = {
      currentIdx,
      userAnswers,
      timeElapsed,
      lockedQuestions,
      mediaTimestamps,
    };
    localStorage.setItem(`quiz_state_${examId}`, JSON.stringify(state));
    // NOTE: Do NOT call history.replaceState here (neither directly nor via
    // safeReplaceState).  This function only persists quiz progress to
    // localStorage.  Touching the browser history from a periodic debounce
    // timer is the root cause of the URL-stripping bug — if window.location
    // has been altered by another module, replaceState would stamp the
    // already-wrong URL into history and make it permanent.
  }, 300); // Wait 300ms before saving
}

// Bug 3 Fix: apply media timestamps that were saved before a page reload.
// Called once after the very first renderQuestion() in init().
function applyPendingMediaTimestamps() {
  if (!pendingMediaTimestamps || !Object.keys(pendingMediaTimestamps).length)
    return;

  const timestamps = pendingMediaTimestamps;
  pendingMediaTimestamps = null;

  const applyToElement = (el, time) => {
    if (time <= 0) return;
    const restore = () => {
      el.currentTime = time;
    };
    if (el.readyState >= 1) restore();
    else el.addEventListener("loadedmetadata", restore, { once: true });
  };

  if (quizStyle === "vertical") {
    Object.entries(timestamps).forEach(([idxStr, times]) => {
      const card = document.getElementById(`q-${idxStr}`);
      if (!card) return;
      card.querySelectorAll("audio, video").forEach((el, i) => {
        if (Array.isArray(times) && times[i] > 0) applyToElement(el, times[i]);
      });
    });
  } else {
    const times = timestamps[currentIdx];
    if (!times) return;
    els.questionContainer.querySelectorAll("audio, video").forEach((el, i) => {
      if (Array.isArray(times) && times[i] > 0) applyToElement(el, times[i]);
    });
  }
}

// ── Bug 2 Fix: popstate listener ─────────────────────────────────────────────
// If future development adds history.pushState calls inside quiz.js (e.g. to
// give each question its own URL so the user can share a direct link), the back
// button will fire popstate *within* the quiz rather than causing a full page
// reload.  This listener handles that case by re-running init() so the quiz
// re-reads the (still-intact) URL parameters and restores to the correct state.
//
// For the current navigation model (finish() → window.location.href →
// result.html), pressing back causes a full reload and popstate never fires —
// init() is simply called fresh by the script loader, which is equally correct.
window.addEventListener("popstate", async () => {
  const params = new URLSearchParams(window.location.search);
  const hasQuizParams =
    params.get("id") !== null || params.get("type") !== null;
  if (hasQuizParams) {
    await init();
  }
});

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (quizMode === "timed" || quizMode === "timed_exam") {
      timeRemaining--;
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        alert("Time's up! Submitting quiz...");
        finish(true);
        return;
      }

      const mins = Math.floor(timeRemaining / 60)
        .toString()
        .padStart(2, "0");
      const secs = (timeRemaining % 60).toString().padStart(2, "0");
      if (els.timer) {
        els.timer.textContent = `${mins}:${secs}`;
        if (timeRemaining < 30) els.timer.style.color = "var(--color-error)";
      }
    } else {
      timeElapsed++;
      const mins = Math.floor(timeElapsed / 60)
        .toString()
        .padStart(2, "0");
      const secs = (timeElapsed % 60).toString().padStart(2, "0");
      if (els.timer) els.timer.textContent = `${mins}:${secs}`;

      // Save less frequently during timer (every 10 seconds)
      if (timeElapsed % 10 === 0) {
        saveStateDebounced();
      }
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

// ============================================================================
// Bug 2 Fix — resetQuizState
// Cleans up all in-flight timers and resets every module-level variable to its
// initial value so that init() can be safely called again (e.g. when the user
// presses the back button and the browser re-fires the popstate event on a
// quiz.html?id=… history entry).
// ============================================================================
function resetQuizState() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (autoSubmitTimeout) {
    clearTimeout(autoSubmitTimeout);
    autoSubmitTimeout = null;
  }
  if (saveStateDebounce) {
    clearTimeout(saveStateDebounce);
    saveStateDebounce = null;
  }
  resizeSaveDebounces.forEach((timeoutId) => clearTimeout(timeoutId));
  resizeSaveDebounces.clear();
  questions = [];
  metaData = {};
  currentIdx = 0;
  userAnswers = {};
  lockedQuestions = {};
  timeElapsed = 0;
  timeRemaining = 0;
  quizBaseUrl = null;
}

init();

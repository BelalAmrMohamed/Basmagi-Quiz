// src/scripts/result.js
import { getManifest } from "./quizManifest.js";

// Download functions
import { exportToQuiz } from "../export/export-to-quiz.js";
import { exportToHtml } from "../export/export-to-html.js";
import { exportToPdf } from "../export/export-to-pdf.js";
import { exportToWord } from "../export/export-to-word.js";
import { exportToPptx } from "../export/export-to-pptx.js";
import { buildQuizText } from "../export/export-to-text.js";
import { exportToMarkdown } from "../export/export-to-markdown.js";

// Notifications
import { showNotification } from "../components/notifications.js";

// Question helpers
import {
  gradeEssay,
  isEssayQuestion,
  calculateQuizMetrics,
  isAnswerCorrect,
} from "../shared/rate-answers.js";

// ── Shared Markdown engine ─────────
// renderMarkdown:           full GFM renderer with KaTeX, tables, copy buttons
// normalizeLiteralNewlines: fixes double-serialised \n sequences
import {
  renderMarkdown,
  normalizeLiteralNewlines,
} from "../shared/markdown.js";

// Helpers
const userName = localStorage.getItem("username") || "User";
const result = JSON.parse(localStorage.getItem("last_quiz_result"));
if (!result) window.location.href = "/";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getEssayAnswer = (q) => q.answer ?? "";

// ── Language & Text Direction Helpers ─────────────────────────────────────────
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

const getQuestionLang = (q) => q?.lang || null;

// ── Media Helper Functions ────────────────────────────────────────────────────
const getMediaUrlCandidates = (url) => {
  const trimmed = String(url || "").trim();
  if (!trimmed) return [];
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return [trimmed];

  const candidates = [];
  const add = (candidate) => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
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
  const srcWithCacheBust = src ? `${src}${src.includes('?') ? '&' : '?'}_cb=${Date.now()}` : '';
  const mime = getMediaMimeType(src);
  const typeAttr = mime ? ` type="${escapeHTML(mime)}"` : "";
  const fallback =
    tag === "audio"
      ? "Your browser doesn't support audio playback."
      : "Your browser doesn't support video playback.";
  const playsinline = tag === "video" ? " playsinline" : "";
  return `<${tag} controls preload="metadata" class="${className}"${playsinline} src="${escapeHTML(srcWithCacheBust)}">
    <source src="${escapeHTML(srcWithCacheBust)}"${typeAttr} />
    ${fallback}
  </${tag}>`;
};

const renderQuestionImage = (imageUrl) => {
  if (!imageUrl) return "";
  const src = resolveMediaUrl(imageUrl);
  const srcWithCacheBust = src ? `${src}${src.includes('?') ? '&' : '?'}_cb=${Date.now()}` : '';
  return `
    <div class="media-container question-image-container">
      <img src="${escapeHTML(srcWithCacheBust)}" alt="Question image"
           class="question-image" onerror="this.parentElement.style.display='none'"/>
    </div>`;
};

const renderQuestionAudio = (audioUrl) => {
  if (!audioUrl) return "";
  return `
    <div class="media-container question-media-container question-audio-container">
      ${renderMediaElement("audio", "question-audio", audioUrl)}
    </div>
  `;
};

const renderQuestionVideo = (videoUrl) => {
  if (!videoUrl) return "";
  return `
    <div class="media-container question-media-container question-video-container">
      ${renderMediaElement("video", "question-video", videoUrl)}
    </div>
  `;
};

const renderQuestionMedia = (q) =>
  [
    renderQuestionImage(q.image),
    renderQuestionAudio(q.audio),
    renderQuestionVideo(q.video),
  ].join("");

const renderReadingPassage = (passage, alignClass) => {
  if (!passage) return "";
  return `
    <div class="reading-passage ${alignClass}" role="region" aria-label="Reading passage">
      ${renderMarkdown(normalizeLiteralNewlines(passage))}
    </div>
  `;
};

const starRating = (score, max = 5) =>
  `<span class="star-rating" aria-label="Score ${score} of ${max}">` +
  "★".repeat(score) +
  `<span class="star-empty">${"★".repeat(max - score)}</span>` +
  `</span>`;

// ─── Helper: HTML escape for raw user-supplied attribute values ───────────────
// This is used for image src URLs only — NOT for markdown content.
// renderMarkdown() handles its own escaping internally.
function escapeHTML(input) {
  if (input === undefined || input === null) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * extractCategoryFromPath — derives the quiz category from a manifest path.
 *
 * Path structure:
 *   quizzes/[Faculty]/[Year]/[Term]/[Subject]/[...subfolders]/[quiz].json
 *
 * This function handles both local paths and encoded DB paths (/api/quiz-data?path=...).
 * The "Category" is the part of the path that identifies the subject and subfolders,
 * appearing after the Faculty/Year/Term segments.
 *
 * @param  {string|null|undefined} path - The `config.path` value.
 * @returns {string} Category string, or "" if the path is absent / malformed.
 */

// Still broken. Category never shows up.
function extractCategoryFromPath(path) {
  if (!path) return "";

  let rawPath = path;

  // Decode DB paths: /api/quiz-data?path=quizzes%2F...
  // URLSearchParams matches the exact approach used in quizManifest.js.
  try {
    const qIdx = rawPath.indexOf("?");
    if (qIdx !== -1) {
      const params = new URLSearchParams(rawPath.slice(qIdx + 1));
      const p = params.get("path");
      if (p) rawPath = decodeURIComponent(p);
    }
  } catch (_) {
    /* ignore malformed query strings */
  }

  // Match the canonical structure: skip Faculty / Year / Term, then capture
  // everything from Subject onward (including optional subfolders + filename).
  const match = rawPath.match(/quizzes\/[^/]+\/[^/]+\/[^/]+\/(.+)/);
  if (match) {
    const segments = match[1].split("/");
    // Drop the filename (last segment); join the rest as the category.
    // A subject-only path yields ["Subject", "file.json"] → ["Subject"] → "Subject".
    const parts = segments.slice(0, -1);
    if (parts.length > 0) return parts.join(" / ");
  }

  return "";
}

// === Breadcrumb Logic ===
function updateBreadcrumb(meta, els) {
  if (!els.breadcrumb || !meta.path) return;

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

  if (!courseName) courseName = meta.category || extractCategoryFromPath(meta.path) || "";

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

document.addEventListener("DOMContentLoaded", async () => {
  const scoreHeader = document.getElementById("scoreHeader");
  const scoreDisplay = document.getElementById("scoreDisplay");
  const container = document.getElementById("reviewContainer");
  const backBtn = document.getElementById("backHomeBtn");
  const exportMdBtn = document.getElementById("exportMdBtn");
  const exportTxtBtn = document.getElementById("exportTxtBtn");
  const exportPdfBtn = document.getElementById("exportPdfBtn");
  const exportWordBtn = document.getElementById("exportWordBtn");
  const exportPptxBtn = document.getElementById("exportPptxBtn");
  const exportHtmlBtn = document.getElementById("exportHtmlBtn");
  const exportQuizBtn = document.getElementById("exportQuizBtn");
  const exportJsonBtn = document.getElementById("exportJsonBtn");
  const exportSourceBtn = document.getElementById("exportSourceBtn");

  const els = {
    breadcrumb: document.getElementById("quizBreadcrumb"),
    dateBadge: document.getElementById("dateBadge"),
    quizDate: document.getElementById("quizDate"),
    quizDescription: document.getElementById("quizDescription"),
    quizSource: document.getElementById("quizSource"),
  };

  let examList = [];
  try {
    const manifest = await getManifest();
    examList = manifest.examList || [];
  } catch (e) {
    console.error("Failed to load manifest", e);
  }

  const config = examList.find((e) => e.id === result.examId) || {
    id: result.examId,
    title: result.examTitle || "User Quiz",
    description: "Custom user-created quiz",
    source: result.source,
    createdAt: result.createdAt,
    path: null,
  };

  let questions = [];
  if (config.path) {
    try {
      const baseUrl = new URL(import.meta.url);
      const quizUrl = new URL(config.path, baseUrl);
      if (config.path.toLowerCase().endsWith(".json")) {
        const res = await fetch(quizUrl.href);
        if (res.ok) {
          const data = await res.json();
          questions = data.questions || [];
          if (data.meta) {
              if (data.meta.createdAt) config.createdAt = data.meta.createdAt;
              if (data.meta.description) config.description = data.meta.description;
              if (data.meta.source) config.source = data.meta.source;
          }
        }
      } else {
        const loaded = await import(quizUrl.href);
        questions = loaded.questions || [];
      }
    } catch (e) {
      console.error("Failed to load questions", e);
    }
  } else if (result.questions) {
    questions = result.questions;
  } else {
    try {
      const userQuizzes = JSON.parse(
        localStorage.getItem("user_quizzes") || "[]",
      );
      const found = userQuizzes.find((q) => q.id === result.examId);
      if (found) {
        questions = found.questions;
        config.title = found.title;
        config.source = found.source || result.source;
        config.createdAt = found.createdAt;
        config.path = found.path;
      }
    } catch (e) {
      console.error("Error loading user quiz questions", e);
    }
  }

  document.title = `نتائج إمتحان ${config.title}`;

  // ── Score breakdown via centralised metrics calculator ─────────────────────
  const {
    mcqCorrect,
    mcqWrong,
    mcqSkipped,
    mcqTotal,
    essayCount,
    essayScoreTotal,
    essayMaxTotal,
    isEssayOnly,
    percentage,
    actualPercentage,
  } = calculateQuizMetrics(questions, result.userAnswers);

  // displayScore / displayTotal are kept for the legacy scoreDisplay element
  // and the countUp animation — they are NOT used in the score-circle percentage.
  const displayScore =
    result.score !== undefined ? result.score : mcqCorrect + essayScoreTotal;
  const displayTotal =
    result.total !== undefined ? result.total : mcqTotal + essayMaxTotal;

  // Helper for loading state
  async function withDownloadLoading(buttonEl, asyncFn) {
    if (!buttonEl) return;
    const originalHtml = buttonEl.innerHTML;
    const originalWidth = buttonEl.offsetWidth;

    buttonEl.disabled = true;
    buttonEl.style.width = `${originalWidth > 0 ? originalWidth : buttonEl.getBoundingClientRect().width}px`;
    buttonEl.style.justifyContent = "center";
    buttonEl.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" class="spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-circle-icon lucide-loader-circle"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span class="menu-label">جاري التحميل...</span>';

    // Allow DOM to update
    await new Promise((r) => setTimeout(r, 50));

    try {
      await asyncFn();
    } catch (error) {
      console.error("Export error:", error);
      alert("حدث خطأ أثناء التحميل. حاول مرة أخرى.");
    } finally {
      buttonEl.disabled = false;
      buttonEl.innerHTML = originalHtml;
      buttonEl.style.width = "";
      buttonEl.style.justifyContent = "";
    }
  }

  let isCopied = false;
  let quizTextBlob = null;

  backBtn && (backBtn.onclick = goHome);
  exportMdBtn &&
    (exportMdBtn.onclick = () =>
      withDownloadLoading(exportMdBtn, async () =>
        exportToMarkdown(config, questions, result.userAnswers),
      ));
  exportTxtBtn &&
    (exportTxtBtn.onclick = () =>
      withDownloadLoading(exportTxtBtn, async () => {
        try {
          if (!isCopied) {
            const text = buildQuizText(config, questions, result.userAnswers);
            await navigator.clipboard.writeText(text);
            quizTextBlob = new Blob([text], { type: "text/plain" });

            exportTxtBtn.innerHTML = `<span><svg xmlns="http://www.w3.org/2000/svg" class="download-option-image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download-icon lucide-download"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg></span><span class="menu-label">Copy text</span>`;
            isCopied = true;
            showNotification(
              "تم النسخ",
              "تم نسخ نص الإختبار! انقر مرة أخرى لتحميله كملف .txt",
              "success",
            );
          } else {
            const url = URL.createObjectURL(quizTextBlob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${config.title}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            isCopied = false;
          }
        } catch (e) {
          console.error(e);
          showNotification("خطأ", "فشل نسخ أو تحميل الإختبار.", "error");
        }
      }).then(() => {
        if (isCopied) {
          exportTxtBtn.innerHTML = `<span><svg xmlns="http://www.w3.org/2000/svg" class="download-option-image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download-icon lucide-download"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg></span><span class="menu-label">Text (.txt)</span>`;
        } else {
          exportTxtBtn.innerHTML = `<span><svg xmlns="http://www.w3.org/2000/svg" class="download-option-image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy-icon lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></span><span class="menu-label">نسخ</span>`;
        }
      }));

  exportPdfBtn &&
    (exportPdfBtn.onclick = () =>
      withDownloadLoading(
        exportPdfBtn,
        async () =>
          await exportToPdf(config, questions, result.userAnswers, result),
      ));
  exportWordBtn &&
    (exportWordBtn.onclick = () =>
      withDownloadLoading(
        exportWordBtn,
        async () => await exportToWord(config, questions, result.userAnswers),
      ));
  exportPptxBtn &&
    (exportPptxBtn.onclick = () =>
      withDownloadLoading(
        exportPptxBtn,
        async () => await exportToPptx(config, questions, result.userAnswers),
      ));
  exportHtmlBtn &&
    (exportHtmlBtn.onclick = () =>
      withDownloadLoading(exportHtmlBtn, async () =>
        exportToHtml(config, questions, result.userAnswers),
      ));
  exportQuizBtn &&
    (exportQuizBtn.onclick = () =>
      withDownloadLoading(exportQuizBtn, async () =>
        exportToQuiz(config, questions),
      ));

  exportJsonBtn &&
    (exportJsonBtn.onclick = () => {
      withDownloadLoading(exportJsonBtn, async () => {
        if (config.path && config.path.endsWith(".json")) {
          const res = await fetch(config.path);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${config.title || config.id}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          const exportQuestions = questions.map((q) => {
            const question = { q: q.q, options: q.options, correct: q.correct };
            if (q.image && q.image.trim()) question.image = q.image;
            if (q.explanation && q.explanation.trim())
              question.explanation = q.explanation;
            return question;
          });
          const statsTypes = new Set();
          exportQuestions.forEach((q) => {
            if (!q.options || q.options.length === 0) statsTypes.add("Essay");
            else if (q.options.length === 2) statsTypes.add("True/False");
            else statsTypes.add("MCQ");
          });

          const payload = {
            stats: {
              questionCount: exportQuestions.length,
              questionTypes: Array.from(statsTypes).sort(),
            },
            questions: exportQuestions,
          };
          const fileContent = JSON.stringify(payload, null, 2);
          const blob = new Blob([fileContent], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${(config.title || "quiz").replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "_")}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      });
    });

  // Show source button if the manifest entry has a source URL
  if (config.source && typeof config.source === "string" && exportSourceBtn) {
    exportSourceBtn.style.display = "flex";
    exportSourceBtn.onclick = () => {
      window.open(config.source, "_blank");
    };
  }

  const limit = 30;
  const title = result.examTitle;

  /* Since the page is RTL and the welcome title is in Arabic,
     but most exam Titles are in English, I reversed the placement
     of the `...` so they actually get displayed correctly */
  document.getElementById("quiz-title").textContent =
    title.length > limit ? `${title.substring(0, limit)}...` : title;

  // A. Date Formatting
  if (config.createdAt && els.quizDate && els.dateBadge) {
    let dateStr = config.createdAt;
    if (dateStr.includes(",")) {
      dateStr = dateStr.split(",")[0];
    } else if (dateStr.includes(" - ")) {
      dateStr = dateStr.split(" - ")[0];
    } else if (dateStr.includes(" ")) {
      dateStr = dateStr.split(" ")[0];
    }

    els.quizDate.textContent = dateStr;
    els.dateBadge.style.display = "flex";
    els.dateBadge.style.alignItems = "center";
  } else if (els.dateBadge) {
    els.dateBadge.style.display = "none";
  }

  // B & C. Dynamic Breadcrumb Title
  if (config.path && els.breadcrumb) {
    updateBreadcrumb(config, els);
    window.addEventListener("resize", () => updateBreadcrumb(config, els));
  }

  // D. Description
  if (config.description && els.quizDescription) {
    els.quizDescription.textContent = config.description;
    els.quizDescription.style.display = "block";
  }

  // E. Source
  if (config.source && els.quizSource) {
    els.quizSource.textContent = `Source: ${config.source}`;
    els.quizSource.style.display = "block";
  }

  renderHeader(
    scoreHeader,
    scoreDisplay,
    result,
    percentage,
    actualPercentage,
    isEssayOnly,
    mcqCorrect,
    mcqWrong,
    mcqSkipped,
    mcqTotal,
    essayCount,
    essayScoreTotal,
    essayMaxTotal,
  );

  // Kick off the count-up animation on #scoreDisplay.
  // Fade out the static fraction text that renderHeader just wrote, then let
  // countUp rewrite textContent from 0→displayScore while fading back in.
  if (scoreDisplay) {
    scoreDisplay.style.opacity = "0";
    requestAnimationFrame(() => {
      scoreDisplay.style.opacity = "1"; // CSS transition: opacity 300ms ease
      countUp(scoreDisplay, displayScore);
    });
  }

  renderReview(container, questions, result.userAnswers);

  // Remove loading skeletons now that real content is rendered
  document.getElementById("scoreHeaderSkeleton")?.remove();
  document.getElementById("reviewSkeleton")?.remove();

  // ── Perfect-Score Certificate ──────────────────────────────────────────────
  if (questions.length > 10 && actualPercentage === 100) {
    // Short delay so the page renders first
    setTimeout(() => {
      launchConfetti();
      showCertificate(
        userName,
        config.title,
        config.category || extractCategoryFromPath(config.path),
      );
    }, 800);

    // Inject a persistent button so the user can reopen the certificate
    // at any time after closing the modal.
    const certReopenBtn = document.createElement("button");
    certReopenBtn.id = "reopenCertBtn";
    certReopenBtn.className = "nav-btn primary cert-reopen-btn";
    certReopenBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/></svg>' +
      "<span>عرض الشهادة — View Certificate</span>";
    certReopenBtn.addEventListener("click", () => {
      showCertificate(
        userName,
        config.title,
        config.category || extractCategoryFromPath(config.path),
      );
    });
    scoreHeader && scoreHeader.appendChild(certReopenBtn);
  }

  // ── UX 2.5: Review Card Stagger Animation ─────────────────────────────────
  // Set --stagger on each rendered card so the CSS animation-delay kicks in.
  // Capped at index 8: cards beyond the initial fold share the same max delay
  // and don't make the user wait an increasingly long time to see them appear.
  document
    .querySelectorAll("#reviewContainer .review-card")
    .forEach((el, i) => {
      el.style.setProperty("--stagger", Math.min(i, 8));
    });

  // ── Result Cards Filtering ─────────────────────────────────────────────────
  const filterBar = document.getElementById("filterBar");
  if (filterBar) {
    filterBar.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;

      // Update the active pill highlight
      filterBar
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const filter = btn.dataset.filter;

      document
        .querySelectorAll("#reviewContainer .review-card")
        .forEach((card) => {
          let visible = true;

          switch (filter) {
            case "all":
              visible = true;
              break;
            case "correct":
              visible = card.classList.contains("correct");
              break;
            case "wrong":
              visible = card.classList.contains("wrong");
              break;
            case "skipped":
              visible = card.classList.contains("skipped");
              break;
            case "essay":
              visible = card.classList.contains("essay-card");
              break;
            case "mcq":
              // MCQ & T/F = any card that is NOT an essay card
              visible = !card.classList.contains("essay-card");
              break;
          }

          card.style.display = visible ? "" : "none";
        });
    });
  }

  const newBadges = result.gamification ? result.gamification.newBadges : [];
  newBadges.forEach((badge, index) => {
    setTimeout(
      () =>
        showNotification(
          `Congratulations, ${userName}`,
          `You've earned the ${badge.title} badge`,
          `${badge.icon}`,
        ),
      index * 500,
    );
  });
});

function goHome() {
  window.location.href = "/";
}

/**
 * countUp — animates el.textContent from 0 to target over `duration` ms.
 * Pure: the only DOM side-effect is writing el.textContent.
 * Uses a cubic ease-out curve: eased = 1 − (1 − t)³
 *
 * @param {HTMLElement} el       - Target element whose textContent will be updated.
 * @param {number}      target   - Final numeric value to count up to.
 * @param {number}      duration - Animation length in milliseconds (default 1200).
 */
function countUp(el, target, duration = 1200) {
  const start = performance.now();
  function tick(now) {
    const elapsed = now - start;
    const t = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
    el.textContent = Math.round(eased * target);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * renderHeader — builds the score-circle + stats panel inside #scoreHeader.
 *
 * `actualPercentage` is the holistic combined score (MCQ + essay) from
 * calculateQuizMetrics. `percentage` is preserved for the legacy scoreDisplay
 * count-up animation (MCQ-only view).
 *
 * Layout:
 *   .score-header-inner
 *     ├── .score-circle  (hero percentage ring)
 *     └── .score-header-body
 *           ├── h2 greeting + .points-pill
 *           ├── .score-detail-table  ← new results-detail style table
 *           ├── .time-line
 *           └── .new-badges-section  (if any badges earned)
 */
function renderHeader(
  scoreHeader,
  scoreDisplay,
  data,
  percentage,
  actualPercentage,
  isEssayOnly,
  mcqCorrect,
  mcqWrong,
  mcqSkipped,
  mcqTotal,
  essayCount,
  essayScoreTotal,
  essayMaxTotal,
) {
  const timeStr = `${Math.floor(data.timeElapsed / 60)}m ${data.timeElapsed % 60}s`;
  const points = data.gamification ? data.gamification.pointsEarned : 0;
  const newBadges = data.gamification ? data.gamification.newBadges : [];

  // Use actualPercentage for the hero circle (holistic); fall back to
  // percentage for safety in case the metric isn't available yet.
  const displayPct =
    actualPercentage !== undefined ? actualPercentage : percentage;
  const passed = displayPct >= 70;

  const hasMcq = mcqTotal > 0;
  const hasEssay = essayCount > 0;

  // ── Badges section ─────────────────────────────────────────────────────────
  let badgeHTML = "";
  if (newBadges.length > 0) {
    badgeHTML = `
      <div class="new-badges-section">
        <h3><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-award-icon lucide-award"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg> شارات تم إكتسابها</h3>
        <div class="badge-grid">
          ${newBadges
            .map(
              (b) => `
            <div class="badge-item">
              <span class="badge-icon">${b.icon}</span>
              <span class="badge-name">${b.title}</span>
            </div>`,
            )
            .join("")}
        </div>
      </div>`;
  }

  // ── Score detail table rows (adaptive per quiz type) ───────────────────────
  const userNameHtml = `<span id="result-page-username">${userName}</span>`;
  let tableRows = "";

  if (hasMcq && hasEssay) {
    // Mixed quiz — show all breakdowns
    const mcqPct = mcqTotal > 0 ? Math.round((mcqCorrect / mcqTotal) * 100) : 0;
    const essayPct =
      essayMaxTotal > 0
        ? Math.round((essayScoreTotal / essayMaxTotal) * 100)
        : 0;
    const essayStars =
      "★".repeat(Math.round((essayScoreTotal / essayMaxTotal) * 5)) +
      `<span class="sdt-star-empty">${"★".repeat(5 - Math.round((essayScoreTotal / essayMaxTotal) * 5))}</span>`;
    const totalScore = mcqCorrect + essayScoreTotal;
    const totalPossible = mcqTotal + essayMaxTotal;

    tableRows = `
      <div class="sdt-row sdt-highlight">
        <span class="sdt-label">النتيجة الكلية</span>
        <span class="sdt-value">${displayPct}%</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">المجموع</span>
        <span class="sdt-value">${totalScore} / ${totalPossible} نقطة</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">الأسئلة الموضوعية</span>
        <span class="sdt-value">${mcqCorrect} / ${mcqTotal} &nbsp;<span class="sdt-pct">${mcqPct}%</span></span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">خطأ</span>
        <span class="sdt-value sdt-wrong">${mcqWrong}</span>
      </div>
      ${
        mcqSkipped > 0
          ? `
      <div class="sdt-row">
        <span class="sdt-label">متخطى</span>
        <span class="sdt-value sdt-skipped">${mcqSkipped}</span>
      </div>`
          : ""
      }
      <div class="sdt-row">
        <span class="sdt-label">المقالي</span>
        <span class="sdt-value">${essayScoreTotal} / ${essayMaxTotal} &nbsp;<span class="sdt-stars">${essayStars}</span></span>
      </div>
      <div class="sdt-row sdt-last">
        <span class="sdt-label">الحالة</span>
        <span class="sdt-value ${passed ? "sdt-pass" : "sdt-fail"}">${passed ? "✓ ناجح" : "✗ راسب"}</span>
      </div>`;
  } else if (hasEssay) {
    // Essay-only quiz
    const essayStars =
      "★".repeat(Math.round((essayScoreTotal / essayMaxTotal) * 5)) +
      `<span class="sdt-star-empty">${"★".repeat(5 - Math.round((essayScoreTotal / essayMaxTotal) * 5))}</span>`;
    tableRows = `
      <div class="sdt-row sdt-highlight">
        <span class="sdt-label">النتيجة الكلية</span>
        <span class="sdt-value">${displayPct}%</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">درجة المقالي</span>
        <span class="sdt-value">${essayScoreTotal} / ${essayMaxTotal} نقطة</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">التقييم</span>
        <span class="sdt-value sdt-stars">${essayStars}</span>
      </div>
      <div class="sdt-row sdt-last">
        <span class="sdt-label">الحالة</span>
        <span class="sdt-value ${passed ? "sdt-pass" : "sdt-fail"}">${passed ? "✓ ناجح" : "✗ راسب"}</span>
      </div>`;
  } else {
    // MCQ-only quiz
    tableRows = `
      <div class="sdt-row sdt-highlight">
        <span class="sdt-label">النتيجة</span>
        <span class="sdt-value">${displayPct}%</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">الإجابات الصحيحة</span>
        <span class="sdt-value sdt-correct">${mcqCorrect} / ${mcqTotal}</span>
      </div>
      <div class="sdt-row">
        <span class="sdt-label">الإجابات الخاطئة</span>
        <span class="sdt-value sdt-wrong">${mcqWrong}</span>
      </div>
      ${
        mcqSkipped > 0
          ? `
      <div class="sdt-row">
        <span class="sdt-label">متخطى</span>
        <span class="sdt-value sdt-skipped">${mcqSkipped}</span>
      </div>`
          : ""
      }
      <div class="sdt-row sdt-last">
        <span class="sdt-label">الحالة</span>
        <span class="sdt-value ${passed ? "sdt-pass" : "sdt-fail"}">${passed ? "✓ ناجح" : "✗ راسب"}</span>
      </div>`;
  }

  // ── Assemble the header ────────────────────────────────────────────────────
  if (scoreHeader)
    scoreHeader.innerHTML = `
    <div class="score-header-inner">
      <div class="score-circle ${passed ? "pass" : "fail"}">
        <span>${displayPct}%</span>
      </div>

      <div class="score-header-body">
        <h2 class="score-greeting">
          ${
            passed
              ? `🎉 أحسنت يا ${userNameHtml}!`
              : `📚 استمر في المذاكرة يا ${userNameHtml}`
          }
        </h2>

        <div class="points-pill">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-gem"><path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/></svg>
          +${points} نقطة
        </div>

        <div class="score-detail-table">
          ${tableRows}
        </div>

        <p class="time-line">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          الوقت: ${timeStr}
        </p>

        ${badgeHTML}
      </div>
    </div>

  `;

  if (scoreDisplay) scoreDisplay.textContent = `${mcqCorrect} / ${mcqTotal}`;
}

function renderReview(container, questions, userAnswers) {
  if (!container) return;
  let html = "";

  questions.forEach((q, index) => {
    const isEssay = isEssayQuestion(q);
    const userAns = userAnswers[index];

    if (isEssay) {
      const score = gradeEssay(userAns, getEssayAnswer(q));
      const stars = starRating(score);
      const scoreLabel =
        score >= 4
          ? "ممتاز"
          : score === 3
            ? "جيد"
            : score === 2
              ? "مقبول"
              : score === 1
                ? "ضعيف"
                : userAns?.trim()
                  ? "صفر"
                  : "لم يُجَب";

      const scoreLabelClass =
        score >= 4
          ? "essay-score-excellent"
          : score >= 3
            ? "essay-score-good"
            : score >= 1
              ? "essay-score-poor"
              : "essay-score-none";

      const userText = userAns
        ? renderMarkdown(normalizeLiteralNewlines(String(userAns)))
        : "<em>Not answered</em>";
      const formalText = renderMarkdown(
        normalizeLiteralNewlines(getEssayAnswer(q)),
      );
      const explanationText = q.explanation
        ? renderMarkdown(normalizeLiteralNewlines(q.explanation))
        : "";

      const alignClass = getAlignClass(q.q, getQuestionLang(q));
      html += `
        <div class="review-card essay-card">
          <div class="review-header">
            <span class="q-num">#${index + 1}</span>
            <div class="review-header-right">
              <span class="essay-badge"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-scroll-text-icon lucide-scroll-text"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg> Essay</span>
              <span class="essay-score-badge ${scoreLabelClass}">${stars} ${scoreLabel} (${score}/5)</span>
            </div>
          </div>
          ${renderReadingPassage(q.passage, alignClass)}
          <p class="q-text ${alignClass}">${renderMarkdown(normalizeLiteralNewlines(q.q))}</p>
          ${renderQuestionMedia(q)}
          <div class="essay-comparison">
            <div class="essay-answer-box user-essay">
              <small><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil-line-icon lucide-pencil-line"><path d="M13 21h8"/><path d="m15 5 4 4"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg> Your Answer:</small>
              <div class="essay-text">${userText}</div>
            </div>
            <div class="essay-answer-box formal-essay">
              <small><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-book-open-icon lucide-book-open"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg> Formal Answer:</small>
              <div class="essay-text">${formalText}</div>
            </div>
          </div>
          ${
            explanationText
              ? `
          <div class="explanation">
            <strong><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lightbulb-icon lucide-lightbulb"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> Explanation:</strong>
            <div class="explanation-body">${explanationText}</div>
          </div>`
              : ""
          }
        </div>`;
    } else {
      const correctIdx = q.correct ?? q.answer;
      const isMultiple = Array.isArray(correctIdx);
      const isSkipped = userAns === undefined || userAns === null || (isMultiple && Array.isArray(userAns) && userAns.length === 0);
      
      // For multi-select: user must have selected exactly the correct set
      let isCorrect;
      if (isSkipped) {
        isCorrect = false;
      } else if (isMultiple) {
        isCorrect = Array.isArray(userAns)
          && userAns.length === correctIdx.length
          && correctIdx.every(idx => userAns.includes(idx));
      } else {
        isCorrect = isAnswerCorrect(userAns, correctIdx);
      }
      

      const statusClass = isCorrect
        ? "correct"
        : isSkipped
          ? "skipped"
          : "wrong";
      const statusIcon = isCorrect
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check-icon lucide-circle-check"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`
        : isSkipped
          ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-minus-icon lucide-circle-minus"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>`
          : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-x-icon lucide-circle-x"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;

      let userText;
      if (isSkipped) {
        userText = "<em>Skipped</em>";
      } else if (isMultiple && Array.isArray(userAns)) {
        userText = userAns
          .map(i => renderMarkdown(normalizeLiteralNewlines(q.options[i])))
          .map(html => `<div class="ans-multi-item">${html}</div>`)
          .join("");
      } else {
        userText = renderMarkdown(normalizeLiteralNewlines(q.options[userAns]));
      }
      
      // Correct answer text — render each correct option as a separate item
      let correctText;
      if (isMultiple) {
        correctText = correctIdx
          .map(i => renderMarkdown(normalizeLiteralNewlines(q.options[i])))
          .map(html => `<div class="ans-multi-item">${html}</div>`)
          .join("");
      } else {
        correctText = renderMarkdown(normalizeLiteralNewlines(q.options[correctIdx]));
      }
      const explanationText = q.explanation
        ? renderMarkdown(normalizeLiteralNewlines(q.explanation))
        : "";

      const alignClass = getAlignClass(q.q, getQuestionLang(q));
      html += `
        <div class="review-card ${statusClass}">
          <div class="review-header">
            <span class="q-num">#${index + 1}</span>
            <span class="status-icon status-${statusClass}">${statusIcon}</span>
          </div>
          ${renderReadingPassage(q.passage, alignClass)}
          <p class="q-text ${alignClass}">${renderMarkdown(normalizeLiteralNewlines(q.q))}</p>
          ${renderQuestionMedia(q)}
          <div class="ans-comparison">
            <div class="ans-box ${isCorrect ? "ans-correct" : isSkipped ? "ans-skipped" : "ans-wrong"}">
              <small><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil-line-icon lucide-pencil-line"><path d="M13 21h8"/><path d="m15 5 4 4"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg> Your Answer:</small>
              <div class="ans-text">${userText}</div>
            </div>
            ${
              !isCorrect
                ? `
            <div class="ans-box ans-correct-answer">
              <small><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check-icon lucide-circle-check"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg> Correct Answer:</small>
              <div class="ans-text">${correctText}</div>
            </div>`
                : ""
            }
          </div>
          ${
            explanationText
              ? `
          <div class="explanation">
            <strong><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lightbulb-icon lucide-lightbulb"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> Explanation:</strong>
            <div class="explanation-body">${explanationText}</div>
          </div>`
              : ""
          }
        </div>`;
    }
  });

  container.innerHTML = html;
}

// ─── Confetti Burst ────────────────────────────────────────────────────────────
function launchConfetti() {
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "9998",
  });
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  const COUNT = 80;
  const COLORS = [
    "#6366f1",
    "#8b5cf6",
    "#f59e0b",
    "#10b981",
    "#ef4444",
    "#3b82f6",
    "#fbbf24",
    "#a78bfa",
  ];

  const particles = Array.from({ length: COUNT }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * 60,
    vx: (Math.random() - 0.5) * 6,
    vy: 2 + Math.random() * 5,
    rot: Math.random() * 360,
    vrot: (Math.random() - 0.5) * 8,
    w: 6 + Math.random() * 8,
    h: 3 + Math.random() * 5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    opacity: 1,
  }));

  let start = null;
  const DURATION = 3500;

  function draw(ts) {
    if (!start) start = ts;
    const elapsed = ts - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let allGone = true;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12; // gravity
      p.rot += p.vrot;
      p.opacity = Math.max(0, 1 - elapsed / DURATION);
      if (p.y < canvas.height + 20) allGone = false;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    if (elapsed < DURATION && !allGone) {
      requestAnimationFrame(draw);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(draw);
}

// ─── Certificate ───────────────────────────────────────────────────────────────
// Fully canvas-drawn: avoids html2canvas RTL/Arabic rendering bugs.

async function showCertificate(name, quizTitle, quizCategory) {
  const overlay = document.getElementById("certificateOverlay");
  if (!overlay) return;

  // Build the canvas once; reuse it for preview + download
  const certCanvas = await drawCertificateCanvas(name, quizTitle, quizCategory);

  // Inject as <img> into the preview wrapper
  const previewWrap = document.getElementById("certPreviewWrap");
  if (previewWrap) {
    previewWrap.innerHTML = "";
    const img = document.createElement("img");
    img.src = certCanvas.toDataURL("image/png");
    img.alt = "Certificate preview";
    img.style.cssText =
      "width:100%;height:auto;display:block;border-radius:8px;";
    previewWrap.appendChild(img);
  }

  overlay.style.display = "flex";

  // ── Download PNG ────────────────────────────────────────────────────────────
  document.getElementById("certDownloadBtn")?.addEventListener(
    "click",
    () => {
      const link = document.createElement("a");
      link.href = certCanvas.toDataURL("image/png");
      link.download = `certificate-${(name || "student").replace(/\s+/g, "_")}.png`;
      link.click();
    },
    { once: true },
  );

  // ── Close ───────────────────────────────────────────────────────────────────
  document
    .getElementById("certCloseBtn")
    ?.addEventListener("click", closeCertificate);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeCertificate();
  });
}

function closeCertificate() {
  const overlay = document.getElementById("certificateOverlay");
  if (!overlay) return;
  overlay.classList.add("closing");
  overlay.addEventListener(
    "animationend",
    () => {
      overlay.style.display = "none";
      overlay.classList.remove("closing");
    },
    { once: true },
  );
}

// ── Canvas certificate renderer ─────────────────────────────────────────────
// All drawing is done via the Canvas 2D API so Arabic text is natively shaped
// and joined by the browser's text renderer — no html2canvas quirks.
async function drawCertificateCanvas(name, quizTitle, quizCategory) {
  await document.fonts.ready;

  const W = 1200,
    H = 820;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = "#fffdf5";
  ctx.fillRect(0, 0, W, H);

  // ── Outer border ────────────────────────────────────────────────────────────
  ctx.strokeStyle = "#b8860b";
  ctx.lineWidth = 7;
  ctx.strokeRect(6, 6, W - 12, H - 12);

  ctx.strokeStyle = "#d4a017";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(22, 22, W - 44, H - 44);
  ctx.strokeRect(28, 28, W - 56, H - 56);

  // ── Corner diamonds ─────────────────────────────────────────────────────────
  const corners = [
    [40, 40],
    [W - 40, 40],
    [40, H - 40],
    [W - 40, H - 40],
  ];
  ctx.fillStyle = "#b8860b";
  for (const [cx, cy] of corners) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }

  // ── Watermark logo ───────────────────────────────────────────────────────────
  await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.globalAlpha = 0.07;
      const s = 260;
      ctx.drawImage(img, (W - s) / 2, (H - s) / 2, s, s);
      ctx.restore();
      resolve();
    };
    img.onerror = resolve;
    img.crossOrigin = "anonymous";
    img.src = "favicon.png";
  });

  // ── Gold seal ───────────────────────────────────────────────────────────────
  const sx = W / 2,
    sy = 118,
    sr = 52;

  // Rays
  ctx.strokeStyle = "#b8860b";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(a) * (sr + 3), sy + Math.sin(a) * (sr + 3));
    ctx.lineTo(sx + Math.cos(a) * (sr + 12), sy + Math.sin(a) * (sr + 12));
    ctx.stroke();
  }

  // Circle fill + outline
  ctx.fillStyle = "#fdf6e3";
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#b8860b";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 5-point star
  _drawStar(ctx, sx, sy - 8, 5, 30, 13, "#d4a017");

  // Platform Arabic label inside seal
  ctx.fillStyle = "#7c3f00";
  ctx.font = 'bold 14px "Amiri", serif';
  ctx.textAlign = "center";
  ctx.direction = "ltr"; // canvas text direction
  ctx.fillText("شهادة تقدير", sx, sy + 36);

  // ── Horizontal divider (top) ─────────────────────────────────────────────────
  _gradLine(ctx, W, 195, 2);

  // ── Main title ───────────────────────────────────────────────────────────────
  ctx.fillStyle = "#7c3f00";
  ctx.font = 'bold 58px "Playfair Display", "Amiri", Georgia, serif';
  ctx.textAlign = "center";
  ctx.fillText("Certificate of Excellence", W / 2, 270);

  // ── Divider (under title) ────────────────────────────────────────────────────
  _gradLine(ctx, W, 295, 1.5);

  // ── Body ────────────────────────────────────────────────────────────────────
  ctx.fillStyle = "#8a5a30";
  ctx.font = '22px "Amiri", Georgia, serif';
  ctx.fillText("This certifies that", W / 2, 348);

  // Name
  ctx.fillStyle = "#1a0a00";
  ctx.font = 'bold italic 52px "Amiri", Georgia, serif';
  ctx.fillText(name, W / 2, 420);

  // Underline for name
  const nm = ctx.measureText(name);
  const nw = Math.min(nm.width + 60, W - 200);
  ctx.strokeStyle = "rgba(184,134,11,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - nw / 2, 432);
  ctx.lineTo(W / 2 + nw / 2, 432);
  ctx.stroke();

  ctx.fillStyle = "#8a5a30";
  ctx.font = '22px "Amiri", Georgia, serif';
  ctx.fillText("has successfully completed", W / 2, 476);

  // Quiz title (with wrapping)
  ctx.fillStyle = "#1a0a00";
  ctx.font = 'bold 34px "Amiri", Georgia, serif';
  let titleBottom = _wrapText(ctx, quizTitle, W / 2, 530, W - 220, 44);

  // Category
  if (quizCategory) {
    ctx.fillStyle = "#8a5a30";
    ctx.font = '18px "Amiri", Georgia, serif';
    titleBottom = Math.max(titleBottom, 540);
    ctx.fillText(`Subject: ${quizCategory}`, W / 2, titleBottom + 38);
    titleBottom += 38;
  }

  // Score line
  ctx.fillStyle = "#7c3f00";
  ctx.font = '20px "Amiri", Georgia, serif';
  ctx.fillText("with a perfect score of 100%", W / 2, titleBottom + 54);

  // ── Divider (footer) ─────────────────────────────────────────────────────────
  _gradLine(ctx, W, H - 115, 1);

  // ── Footer ───────────────────────────────────────────────────────────────────
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Left: date
  ctx.textAlign = "left";
  ctx.fillStyle = "#4a2810";
  ctx.font = 'bold 17px "Amiri", Georgia, serif';
  ctx.fillText(dateStr, 90, H - 80);
  ctx.fillStyle = "#b8860b";
  ctx.font = '13px "Amiri", Georgia, serif';
  ctx.fillText("Issue Date", 90, H - 60);

  // Right: platform name (Arabic) + author
  ctx.textAlign = "right";
  ctx.direction = "ltr";
  ctx.fillStyle = "#4a2810";
  ctx.font = 'bold 22px "Amiri", serif';
  ctx.fillText("إمتحانات بصمجي", W - 90, H - 77);
  ctx.fillStyle = "#8a5a30";
  ctx.font = '14px "Amiri", Georgia, serif';

  return canvas;
}

// ── Private helpers ────────────────────────────────────────────────────────────
function _drawStar(ctx, cx, cy, spikes, outer, inner, color) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outer);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
    rot += step;
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function _gradLine(ctx, W, y, lw) {
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, "transparent");
  g.addColorStop(0.2, "#b8860b");
  g.addColorStop(0.8, "#b8860b");
  g.addColorStop(1, "transparent");
  ctx.strokeStyle = g;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(80, y);
  ctx.lineTo(W - 80, y);
  ctx.stroke();
}

// Wraps text at maxWidth, returns Y of the last line drawn.
function _wrapText(ctx, text, x, y, maxWidth, lineH) {
  const words = text.split(" ");
  let line = "",
    curY = y;
  for (const word of words) {
    const test = line + (line ? " " : "") + word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = word;
      curY += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, curY);
  return curY;
}

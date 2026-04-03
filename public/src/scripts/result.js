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

const renderQuestionImage = (imageUrl) => {
  if (!imageUrl) return "";
  return `
    <div class="question-image-container">
      <img src="${escapeHTML(imageUrl)}" alt="Question image"
           class="question-image" onerror="this.parentElement.style.display='none'"/>
    </div>`;
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

    <style>
      /* ── Score Header Layout ────────────────────────────────────── */
      .score-header-inner {
        display: flex;
        align-items: flex-start;
        gap: 28px;
        flex-wrap: wrap;
      }

      /* ── Greeting ───────────────────────────────────────────────── */
      .score-greeting {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 12px;
        line-height: 1.4;
      }

      /* ── Score Detail Table ─────────────────────────────────────── */
      /*   Mirrors the results-detail pattern used in export-to-quiz  */
      /*   and export-to-html for consistent look across the app.      */
      .score-detail-table {
        border-radius: 10px;
        border: 1px solid var(--border-color, rgba(255,255,255,0.1));
        overflow: hidden;
        margin: 14px 0;
        min-width: 240px;
        max-width: 360px;
        background: var(--card-bg, rgba(255,255,255,0.03));
      }

      .sdt-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 9px 16px;
        font-size: 13.5px;
        border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.07));
      }

      .sdt-last  { border-bottom: none; }

      .sdt-highlight {
        background: var(--card-answered, rgba(102,126,234,0.12));
      }

      .sdt-label {
        color: var(--text-muted, #94a3b8);
        font-weight: 500;
        white-space: nowrap;
      }

      .sdt-value {
        color: var(--text-primary, #f1f5f9);
        font-weight: 600;
        text-align: left;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .sdt-highlight .sdt-label  { color: var(--info-text,   #93c5fd); }
      .sdt-highlight .sdt-value  { color: var(--text-primary, #e2e8f0); font-size: 14.5px; }

      .sdt-pass    { color: var(--success, #10b981) !important; }
      .sdt-fail    { color: var(--error,   #ef4444) !important; }
      .sdt-correct { color: var(--success, #10b981) !important; }
      .sdt-wrong   { color: var(--error,   #ef4444) !important; }
      .sdt-skipped { color: var(--text-muted, #94a3b8) !important; }
      .sdt-pct     { color: var(--text-muted, #94a3b8); font-size: 12px; font-weight: 500; }

      .sdt-stars       { color: #f59e0b; font-size: 1.05em; letter-spacing: 1px; }
      .sdt-star-empty  { opacity: 0.3; }

      /* ── Responsive: stack on narrow screens ────────────────────── */
      @media (max-width: 480px) {
        .score-header-inner { flex-direction: column; align-items: center; text-align: center; }
        .score-detail-table { max-width: 100%; min-width: 0; width: 100%; }
        .sdt-value          { text-align: right; }
      }
    </style>
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

      html += `
        <div class="review-card essay-card">
          <div class="review-header">
            <span class="q-num">#${index + 1}</span>
            <div class="review-header-right">
              <span class="essay-badge"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-scroll-text-icon lucide-scroll-text"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg> Essay</span>
              <span class="essay-score-badge ${scoreLabelClass}">${stars} ${scoreLabel} (${score}/5)</span>
            </div>
          </div>
          <p class="q-text">${renderMarkdown(normalizeLiteralNewlines(q.q))}</p>
          ${renderQuestionImage(q.image)}
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
      const isSkipped = userAns === undefined || userAns === null;
      const isCorrect = !isSkipped && userAns === correctIdx;
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

      const userText = isSkipped
        ? "<em>Skipped</em>"
        : renderMarkdown(normalizeLiteralNewlines(q.options[userAns]));
      const correctText = renderMarkdown(
        normalizeLiteralNewlines(q.options[correctIdx]),
      );
      const explanationText = q.explanation
        ? renderMarkdown(normalizeLiteralNewlines(q.explanation))
        : "";

      html += `
        <div class="review-card ${statusClass}">
          <div class="review-header">
            <span class="q-num">#${index + 1}</span>
            <span class="status-icon status-${statusClass}">${statusIcon}</span>
          </div>
          <p class="q-text">${renderMarkdown(normalizeLiteralNewlines(q.q))}</p>
          ${renderQuestionImage(q.image)}
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

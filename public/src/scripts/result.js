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

// Essay questinos' helpers
import { gradeEssay, isEssayQuestion } from "../shared/rate-essays.js";

// Helpers
const userName = localStorage.getItem("username") || "User";
const result = JSON.parse(localStorage.getItem("last_quiz_result"));
if (!result) window.location.href = "/";

// ── Fix: normalize literal \n sequences to real newlines ──────────────────
// JSON.parse converts \n → real newline, but a double-serialization path
// (e.g. localStorage read as raw string, or JSON.stringify called twice)
// produces the literal two-char sequence \n. The Markdown renderer splits
// on real newlines only — so this normalizes before anything else runs.
const normalizeLiteralNewlines = (text) => {
  if (!text || !text.includes("\\n")) return text; // fast-exit: nothing to do
  return text.replace(/\\n/g, "\n");
};

// ─── Helper: HTML escape (raw user-supplied strings only) ────────────────────
function escapeHTML(input) {
  if (input === undefined || input === null) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Helper: Markdown-lite renderer (matches quiz.js) ────────────────────────
// ── Markdown + KaTeX integration (mirrored from create-quiz) ──

// ── Escape HTML for safe insertion ───────────────────────────────────────────
function escHtml(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Apply inline Markdown formatting to a pre-escaped string ─────────────────
function applyInline(s) {
  // Inline math $...$ (protect from other replacements with a temp stash)
  const iMathStash = [];
  s = s.replace(/\$([^\$\n]+)\$/g, (_, m) => {
    const idx = iMathStash.length;
    // ── Fix: decode HTML entities before KaTeX renders ──────────────────────
    // applyInline() always receives an already-escHtml()-encoded string.
    // Characters like < become &lt; BEFORE this regex runs, so KaTeX would
    // receive "&lt;" instead of "<" and render the expression in red (error).
    // Decoding here restores the original LaTeX source that KaTeX expects.
    const decoded = m
      .trim()
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    if (typeof window.katex !== "undefined") {
      try {
        iMathStash.push(
          window.katex.renderToString(decoded, {
            displayMode: false,
            throwOnError: false,
          }),
        );
      } catch {
        iMathStash.push(
          `<span class="math-inline math-raw">$${escHtml(m)}$</span>`,
        );
      }
    } else {
      iMathStash.push(
        `<span class="math-inline math-raw">$${escHtml(m)}$</span>`,
      );
    }
    return `\x01IM${idx}\x01`;
  });

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  // Bold + italic combined
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold: **...** or __...__
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  // Italic: *...* or _..._
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  // Strikethrough: ~~...~~
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  // Links: [text](url)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>',
  );
  // Images: ![alt](url)
  s = s.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g,
    '<img src="$2" alt="$1" class="md-img" loading="lazy">',
  );

  // Restore inline math
  s = s.replace(/\x01IM(\d+)\x01/g, (_, i) => iMathStash[parseInt(i)]);
  return s;
}

/**
 * Full-featured Markdown renderer with:
 *  • KaTeX LaTeX math:  $inline$  and  $$block$$
 *  • Fenced code blocks: ```lang ... ```
 *  • Headings H1–H6
 *  • Horizontal rules  ---  ***  ___
 *  • Blockquotes  > text
 *  • Unordered lists  - / * / +
 *  • Ordered lists  1.
 *  • Bold, italic, bold-italic, strikethrough
 *  • Inline code
 *  • Links and images
 *  • Falls back gracefully if KaTeX is not loaded
 */
function renderMarkdown(str) {
  if (!str) return "";
  try {
    return _renderMarkdownCore(str);
  } catch (err) {
    console.error("renderMarkdown error:", err);
    return escHtml(str).replace(/\n/g, "<br>");
  }
}

function _renderMarkdownCore(str) {
  const stash = [];
  const stashPush = (html) => {
    const idx = stash.length;
    stash.push(html);
    return `\x00ST${idx}\x00`;
  };

  // ── Fix 0: Auto-wrap bare LaTeX lines ──────────────────────────────────────
  // Some quiz data stores LaTeX without $ delimiters (e.g. "x = \frac{...}").
  // Detect lines that contain LaTeX commands but no $ or ` (not already
  // math/code), and wrap them in $...$ so step 1 can render them with KaTeX.
  const BARE_LATEX_CMD_RE =
    /\\(?:frac|sqrt|sum|int|prod|lim|pm|mp|cdot|times|div|leq|geq|neq|approx|equiv|infty|partial|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|sigma|phi|psi|omega|vec|hat|bar|tilde|dot|binom|mathbb|mathbf|mathrm|mathit)\b/;
  if (BARE_LATEX_CMD_RE.test(str)) {
    str = str.replace(/^(?![^\n]*[$`])([^\n]+)$/gm, (line) =>
      BARE_LATEX_CMD_RE.test(line) ? `$${line.trim()}$` : line,
    );
  }

  // ── 1. Block math  $$...$$ ────────────────────────────────────────────────
  str = str.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => {
    let rendered;
    if (typeof window.katex !== "undefined") {
      try {
        rendered = window.katex.renderToString(m.trim(), {
          displayMode: true,
          throwOnError: false,
        });
      } catch {
        rendered = `<span class="math-raw">$$${escHtml(m)}$$</span>`;
      }
    } else {
      rendered = `<span class="math-raw">$$${escHtml(m)}$$</span>`;
    }
    return stashPush(`<div class="math-block">${rendered}</div>`);
  });

  // ── 2. Fenced code blocks  ```lang\n...\n``` ──────────────────────────────
  str = str.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const safe = escHtml(code.trim());
    const cls = `code-block ltr${lang ? " language-" + lang : ""}`;
    return stashPush(`<pre class="${cls}"><code>${safe}</code></pre>`);
  });

  // ── 3. Process line-by-line for block elements ────────────────────────────
  const rawLines = str.split("\n");
  const outParts = [];
  let listBuf = [];
  let listTag = null;

  const flushList = () => {
    if (listBuf.length) {
      outParts.push(
        `<${listTag} class="md-list">${listBuf.join("")}</${listTag}>`,
      );
      listBuf = [];
      listTag = null;
    }
  };

  // Split a line that may contain stash tokens into safe HTML,
  // escaping the non-token segments and preserving the tokens verbatim.
  const escapeAroundTokens = (line) => {
    const TOKEN_RE = /(\x00ST\d+\x00)/g;
    const parts = line.split(TOKEN_RE);
    return parts
      .map((part, i) => (i % 2 === 1 ? part : escHtml(part)))
      .join("");
  };

  for (const rawLine of rawLines) {
    // Pass-through stash placeholders (may be on their own line)
    if (/\x00ST\d+\x00/.test(rawLine)) {
      flushList();
      outParts.push(escapeAroundTokens(rawLine));
      continue;
    }

    // Horizontal rule  ---  ***  ___
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(rawLine)) {
      flushList();
      outParts.push('<hr class="md-hr">');
      continue;
    }

    // Headings  # … ######
    const hMatch = rawLine.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      flushList();
      const lvl = hMatch[1].length;
      outParts.push(
        `<h${lvl} class="md-h${lvl}">${applyInline(escHtml(hMatch[2]))}</h${lvl}>`,
      );
      continue;
    }

    // Blockquote  >
    const bqMatch = rawLine.match(/^>\s*(.*)$/);
    if (bqMatch) {
      flushList();
      outParts.push(
        `<blockquote class="md-blockquote">${applyInline(escHtml(bqMatch[1]))}</blockquote>`,
      );
      continue;
    }

    // Unordered list  - / * / +
    const ulMatch = rawLine.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (listTag === "ol") flushList();
      listTag = "ul";
      listBuf.push(`<li>${applyInline(escHtml(ulMatch[1]))}</li>`);
      continue;
    }

    // Ordered list  1.
    const olMatch = rawLine.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (listTag === "ul") flushList();
      listTag = "ol";
      listBuf.push(`<li>${applyInline(escHtml(olMatch[1]))}</li>`);
      continue;
    }

    // Empty line → paragraph break
    // ── Fix: push "<br>" instead of "" so blank lines produce visible output ──
    // "" was silently swallowed: isBlock("") = true → join step added no <br>
    // around it → the two surrounding content pieces were concatenated with
    // nothing between them. "<br>" produces an actual line break and is also
    // treated as a block-separator (see isBlock below) so no extra <br> is
    // added around it.
    if (rawLine.trim() === "") {
      flushList();
      outParts.push("<br>");
      continue;
    }

    // Regular text line
    flushList();
    outParts.push(applyInline(escHtml(rawLine)));
  }

  flushList();

  // ── 4. Join lines, inserting <br> only between consecutive inline segments ──
  const BLOCK_START = /^<(h[1-6]|ul|ol|blockquote|hr|div|pre|p)[\s>\/]/;
  const BLOCK_END = /^<\/(h[1-6]|ul|ol|blockquote|div|pre|p)>/;
  const isBlock = (s) =>
    s === undefined ||
    s === "" ||
    s === "<br>" ||
    BLOCK_START.test(s) ||
    BLOCK_END.test(s);

  let result = "";
  for (let i = 0; i < outParts.length; i++) {
    result += outParts[i];
    if (!isBlock(outParts[i]) && !isBlock(outParts[i + 1])) {
      result += "<br>";
    }
  }

  // ── 5. Restore stashed blocks ─────────────────────────────────────────────
  result = result.replace(/\x00ST(\d+)\x00/g, (_, i) => stash[parseInt(i)]);

  return result;
}

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
      }
    } catch (e) {
      console.error("Error loading user quiz questions", e);
    }
  }

  document.title = `نتائج إمتحان ${config.title}`;

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
          const payload = { questions: exportQuestions };
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

  // ── Score breakdown ────────────────────────────────────────────────────────
  const totalQuestions = questions.length;
  let mcqCorrect = 0,
    mcqWrong = 0,
    mcqSkipped = 0,
    mcqTotal = 0;
  let essayCount = 0,
    essayScoreTotal = 0,
    essayMaxTotal = 0;

  for (let i = 0; i < totalQuestions; i++) {
    const q = questions[i];
    const ua = result.userAnswers[i];
    if (isEssayQuestion(q)) {
      essayCount++;
      essayScoreTotal += gradeEssay(ua, getEssayAnswer(q));
      essayMaxTotal += 5;
    } else {
      mcqTotal++;
      const correctIdx = q.correct ?? q.answer;
      if (ua === undefined || ua === null) mcqSkipped++;
      else if (ua === correctIdx) mcqCorrect++;
      else mcqWrong++;
    }
  }

  const limit = 30;
  const title = result.examTitle;

  /* Since the page is RTL and the welcome title is in Arabic,
     but most exam Titles are in English, I reversed the placement
     of the `...` so they actually get displayed correctly */
  document.getElementById("quiz-title").textContent =
    title.length > limit ? `${title.substring(0, limit)}...` : title;

  // Support both old result format and new (with mcqScore + essayScore fields)
  const displayScore =
    result.score !== undefined ? result.score : mcqCorrect + essayScoreTotal;
  const displayTotal =
    result.total !== undefined ? result.total : mcqTotal + essayMaxTotal;

  renderHeader(
    scoreHeader,
    scoreDisplay,
    result,
    displayScore,
    displayTotal,
    mcqCorrect,
    mcqWrong,
    mcqSkipped,
    mcqTotal,
    essayCount,
    essayScoreTotal,
    essayMaxTotal,
  );
  renderReview(container, questions, result.userAnswers);

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

function renderHeader(
  scoreHeader,
  scoreDisplay,
  data,
  displayScore,
  displayTotal,
  mcqCorrect,
  mcqWrong,
  mcqSkipped,
  mcqTotal,
  essayCount,
  essayScoreTotal,
  essayMaxTotal,
) {
  const percentage =
    displayTotal > 0 ? Math.round((displayScore / displayTotal) * 100) : 0;
  const timeStr = `${Math.floor(data.timeElapsed / 60)}m ${data.timeElapsed % 60}s`;
  const points = data.gamification ? data.gamification.pointsEarned : 0;
  const newBadges = data.gamification ? data.gamification.newBadges : [];

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

  // MCQ row — only show if there are MCQ questions
  const mcqRow =
    mcqTotal > 0
      ? `
    <div class="score-breakdown">
      <span class="breakdown-item breakdown-correct"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> ${mcqCorrect} صحيح</span>
      <span class="breakdown-item breakdown-wrong"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> ${mcqWrong} خطأ</span>
      ${mcqSkipped > 0 ? `<span class="breakdown-item breakdown-skipped"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-minus-icon lucide-minus"><path d="M5 12h14"/></svg> ${mcqSkipped} متخطى</span>` : ""}
    </div>`
      : "";

  // Essay row — only show if there are essay questions
  const essayRow =
    essayCount > 0
      ? `
    <div class="essay-score-row">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-scroll-text-icon lucide-scroll-text"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>
      <span>المقالي: ${essayScoreTotal} / ${essayMaxTotal}</span>
      ${starRating(Math.round(essayScoreTotal / Math.max(essayCount, 1)), 5)}
    </div>`
      : "";

  const userNameHtml = `<span id="result-page-username">${userName}</span>`;
  if (scoreHeader)
    scoreHeader.innerHTML = `
    <div class="score-circle ${percentage >= 70 ? "pass" : "fail"}">
      <span>${percentage}%</span>
    </div>
    <div class="stats-text">
      <h2>${percentage >= 70 ? `أحسنت يا ${userNameHtml}!` : `استمر في المذاكرة يا ${userNameHtml}`}</h2>
      <div class="points-pill"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-gem-icon lucide-gem"><path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/></svg> +${points} نقطة</div>
      <p class="total-score-line">النتيجة: <strong>${displayScore} / ${displayTotal}</strong></p>
      ${mcqRow}
      ${essayRow}
      <p class="time-line"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock-icon lucide-clock"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> الوقت: ${timeStr}</p>
      ${badgeHTML}
    </div>
  `;

  if (scoreDisplay)
    scoreDisplay.textContent = `${displayScore} / ${displayTotal}`;
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

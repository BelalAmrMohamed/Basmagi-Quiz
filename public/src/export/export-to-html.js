// src/scripts/exportToHtml.js
// Downloads the quiz as an html page, showing the results of the quiz only (.html)
// Deals with the export from both main page and result page
// No libraries used

import { showNotification } from "../components/notifications.js";

// Question helpers
import {
  gradeEssay,
  isEssayQuestion,
  calculateQuizMetrics,
} from "../shared/rate-answers.js";

import { MARKDOWN_CSS } from "../shared/markdown-css.js";

export async function exportToHtml(config, questions, userAnswers = []) {
  // Convert local images to base64
  const processedQuestions = await convertImagesToBase64(questions);

  let hasMCQ = false,
    hasTrueFalse = false,
    hasEssay = false;
  processedQuestions.forEach((q) => {
    if (isEssayQuestion(q)) hasEssay = true;
    else if (q.options.length === 2) hasTrueFalse = true;
    else hasMCQ = true;
  });

  let questionType = "Multiple Choice";
  if (hasEssay && !hasMCQ && !hasTrueFalse) questionType = "Essay/Definitions";
  else if (hasEssay) questionType = "Mixed (MCQ, True/False, Essay)";

  const date = new Date().toLocaleDateString();

  let htmlContent = `<!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${config.title || "Quiz Examination"}</title>
      <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg width='512' height='512' viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3CradialGradient id='bulbG' cx='36%25' cy='28%25' r='68%25'%3E%3Cstop offset='0%25' stop-color='%23FFFDE7'/%3E%3Cstop offset='22%25' stop-color='%23FFF59D'/%3E%3Cstop offset='58%25' stop-color='%23FFEB3B'/%3E%3Cstop offset='100%25' stop-color='%23FBC02D'/%3E%3C/radialGradient%3E%3ClinearGradient id='sA' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0%25' stop-color='%23F0F0F0'/%3E%3Cstop offset='100%25' stop-color='%23BDBDBD'/%3E%3C/linearGradient%3E%3ClinearGradient id='sB' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0%25' stop-color='%23DEDEDE'/%3E%3Cstop offset='100%25' stop-color='%239E9E9E'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='256' cy='242' r='180' fill='%23FFEB3B' opacity='0.15'/%3E%3Ccircle cx='256' cy='242' r='130' fill='%23FFEB3B' opacity='0.25'/%3E%3Cline x1='256' y1='140' x2='256' y2='104' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='326' y1='172' x2='351' y2='147' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='358' y1='242' x2='394' y2='242' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='326' y1='312' x2='351' y2='337' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='186' y1='312' x2='161' y2='337' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='154' y1='242' x2='118' y2='242' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cline x1='186' y1='172' x2='161' y2='147' stroke='%23FFEB3B' stroke-width='11' stroke-linecap='round'/%3E%3Cpath d='M 164,285 A 94,94 0 1,1 348,285 Q 345,342 312,350 L 200,350 Q 167,342 164,285 Z' fill='url(%23bulbG)'/%3E%3Cellipse cx='214' cy='192' rx='18' ry='37' fill='white' opacity='0.38' transform='rotate(-22,214,192)'/%3E%3Cellipse cx='206' cy='183' rx='8' ry='15' fill='white' opacity='0.55' transform='rotate(-22,206,183)'/%3E%3Ctext x='256' y='270' text-anchor='middle' dominant-baseline='central' font-family='Georgia, serif' font-size='114' font-weight='700' fill='%231A237E'%3E?%3C/text%3E%3Crect x='198' y='350' width='116' height='15' rx='3' fill='url(%23sA)'/%3E%3Crect x='205' y='365' width='102' height='13' rx='3' fill='url(%23sB)'/%3E%3Crect x='213' y='378' width='86' height='13' rx='3' fill='url(%23sA)'/%3E%3Crect x='224' y='391' width='64' height='13' rx='7' fill='url(%23sB)'/%3E%3C/svg%3E">

<!-- ── Markdown + KaTeX integration (mirrored from create-quiz) ──
           Math is PRE-RENDERED at generation time when window.katex is available
           in the app context (the KaTeX CSS below styles that pre-rendered HTML).
           The auto-render extension acts as a guaranteed client-side fallback:
           if pre-rendering was skipped (katex not yet loaded in the app), the
           $…$ delimiters survive in the HTML and auto-render picks them up here.
           No defer/async on katex.min.js — it must be synchronous so auto-render
           can reference window.katex immediately. Pinned to 0.16.9. No SRI. -->
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
      <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
      <script>
        document.addEventListener("DOMContentLoaded", function () {
          if (typeof renderMathInElement === "function") {
            renderMathInElement(document.body, {
              delimiters: [
                { left: "$$", right: "$$", display: true  },
                { left: "$",  right: "$",  display: false }
              ],
              throwOnError: false,
              // Skip nodes that already contain rendered KaTeX so we don't
              // double-process text that was successfully pre-rendered at
              // export time.
              ignoredClasses: ["katex", "katex-html"]
            });
          }
        });
      </script>

      <script type="module">
        const ICON_COPY = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>\`;
        const ICON_CHECK = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>\`;

        window.copyCodeBlock = (btn) => {
          const wrapper = btn.closest(".code-block-wrapper");
          if (!wrapper) return;
          const codeEl = wrapper.querySelector("code");
          if (!codeEl) return;

          navigator.clipboard
            .writeText(codeEl.innerText)
            .then(() => {
              const original = btn.innerHTML;
              btn.innerHTML = ICON_CHECK;
              btn.classList.add("copied");
              btn.setAttribute("aria-label", "Copied!");
              setTimeout(() => {
                btn.innerHTML = original;
                btn.classList.remove("copied");
                btn.setAttribute("aria-label", "Copy code");
              }, 2000);
            })
            .catch(() => {
              // Fallback: select the text so the user can Ctrl+C manually
              const range = document.createRange();
              range.selectNodeContents(codeEl);
              const sel = window.getSelection();
              if (sel) {
                sel.removeAllRanges();
                sel.addRange(range);
              }
            });
        };
      </script>

      <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; color: #e0e0e0; background: #121212; }
          h1 { color: #ffffff; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 30px; text-align: center; }
          .meta { text-align: center; color: #888; margin-bottom: 40px; font-style: italic; }
          .question-card { background: #1e1e1e; border-radius: 12px; padding: 25px; margin-bottom: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid #333; }
          .q-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; font-size: 0.9rem; color: #aaa; }
          .q-text { font-size: 1.1rem; font-weight: 600; color: #fff; margin-bottom: 20px; }
          .options-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
          .option { padding: 10px 15px; margin-bottom: 8px; border-radius: 6px; background: rgba(255,255,255,0.05); font-size: 0.95rem; }
          .user-answer { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid #3b82f6; font-weight: 600; margin-top: 15px; padding: 12px 15px; border-radius: 8px; }
          .user-answer.wrong { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; }
          .user-answer.skipped { background: rgba(156, 163, 175, 0.2); color: #9ca3af; border: 1px solid #6b7280; }
          .correct-answer { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid #22c55e; font-weight: 600; margin-top: 15px; padding: 12px 15px; border-radius: 8px; }
          .explanation { margin-top: 15px; padding: 15px; background: rgba(59, 130, 246, 0.1); border-left: 3px solid #3b82f6; color: #dbeafe; font-size: 0.95rem; }
          .essay-box { background: #2a2a2a; padding: 15px; border-radius: 8px; border-left: 3px solid #f59e0b; margin-top: 10px; }
          .essay-score { padding: 12px 15px; border-radius: 8px; font-size: 0.9rem; margin-top: 10px; border-left: 3px solid; font-weight: 600; }
          .essay-score.correct { background: rgba(16,185,129,0.15); border-color: #10b981; color: #34d399; }
          .essay-score.partial { background: rgba(245,158,11,0.15); border-color: #f59e0b; color: #fcd34d; }
          .essay-score.wrong   { background: rgba(239,68,68,0.15);  border-color: #ef4444; color: #f87171; }
          .question-image { max-width: 100%; height: auto; display: block; margin: 10px auto; border-radius: 8px; border: 1px solid #333; }
          .footer { text-align: center; margin-top: 50px; color: #888; font-size: 0.8rem; border-top: 1px solid #333; padding-top: 20px; }
          .code-block { background: #0d0d0d; border: 1px solid #444; border-radius: 8px; padding: 12px 16px; margin: 10px 0; overflow-x: auto; font-family: "SF Mono", "Fira Code", Consolas, monospace; font-size: 0.88rem; line-height: 1.6; white-space: pre; text-align: left; direction: ltr; }
          .code-block code { background: none; padding: 0; color: #e2e8f0; font-size: inherit; }
          .inline-code { font-family: "SF Mono", "Fira Code", Consolas, monospace; font-size: 0.88em; background: rgba(99,102,241,0.15); border: 1px solid #555; border-radius: 4px; padding: 1px 6px; color: #a5b4fc; white-space: nowrap; }
          .score-block { text-align: center; margin: 0 0 40px; padding: 32px 24px; background: #1e1e1e; border-radius: 16px; border: 1px solid #333; }
          .score-circle { width: 130px; height: 130px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 800; color: #fff; position: relative; letter-spacing: -1px; }
          .score-circle::after { content: ''; position: absolute; inset: -7px; border-radius: 50%; border: 3px solid currentColor; opacity: 0.28; }
          .score-circle.pass { background: linear-gradient(135deg, #34d399, #059669); box-shadow: 0 8px 32px rgba(16,185,129,0.4); color: #fff; }
          .score-circle.fail { background: linear-gradient(135deg, #f87171, #dc2626); box-shadow: 0 8px 32px rgba(239,68,68,0.4); color: #fff; }
          .score-label { font-size: 22px; font-weight: 700; color: #fff; margin-bottom: 20px; }
          .score-stats { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
          .stat-pill { padding: 8px 18px; border-radius: 20px; font-size: 13px; font-weight: 600; }
          .stat-correct { background: rgba(16,185,129,0.2); color: #34d399; border: 1px solid rgba(16,185,129,0.4); }
          .stat-wrong   { background: rgba(239,68,68,0.2);  color: #f87171; border: 1px solid rgba(239,68,68,0.4);  }
          .stat-skipped { background: rgba(148,163,184,0.15); color: #94a3b8; border: 1px solid rgba(148,163,184,0.3); }
          .stat-essay   { background: rgba(245,158,11,0.15); color: #fcd34d; border: 1px solid rgba(245,158,11,0.3); }
          .ltr { direction: ltr; }
          /* ── Markdown CSS Variables Mapping ── */
          :root {
            --color-primary: #3b82f6;
            --color-primary-light: rgba(59, 130, 246, 0.1);
            --color-border: #333;
            --color-border-light: #444;
            --color-text-primary: #fff;
            --color-text-secondary: #aaa;
            --color-background: #121212;
            --color-background-secondary: #1e1e1e;
            --color-success: #22c55e;
            --color-error: #ef4444;
            --color-code: #e2e8f0;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
            --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
          }
          ${MARKDOWN_CSS}          
          </style>
  </head>
  <body>
      <h1>${config.title || "Quiz Examination"}</h1>
      <div class="meta">Total Questions: ${
        processedQuestions.length
      } • Type: ${questionType} • Date: ${date}</div>
  `;

  // Determine if we are in "Summary Mode" (user answers provided)
  const isResultsMode =
    userAnswers &&
    (Array.isArray(userAnswers)
      ? userAnswers.length > 0
      : Object.keys(userAnswers).length > 0);

  // ── Score summary block (only in results mode) ──────────────────────────────
  if (isResultsMode) {
    let mcqTotal = 0,
      mcqCorrect = 0,
      mcqWrong = 0,
      mcqSkipped = 0;
    let essayTotalScore = 0,
      essayMaxScore = 0;
    processedQuestions.forEach((q, i) => {
      if (isEssayQuestion(q)) {
        const userText = userAnswers[i] || "";
        essayTotalScore += gradeEssay(userText, q.answer);
        essayMaxScore += 5;
      } else {
        mcqTotal++;
        const ans = userAnswers[i];
        if (ans === null || ans === undefined) mcqSkipped++;
        else if (ans === q.correct) mcqCorrect++;
        else mcqWrong++;
      }
    });

    const essayCount = essayMaxScore / 5;
    const totalScore = mcqCorrect + essayTotalScore;
    const totalPoss = mcqTotal + essayMaxScore;
    const percent =
      totalPoss > 0 ? Math.round((totalScore / totalPoss) * 100) : 0;
    const passed = percent >= 70;
    const circleClass = passed ? "pass" : "fail";
    const label = passed ? "🎉 Great Job!" : "📚 Keep Practicing!";

    let statsHtml = `
    <div class="stat-pill stat-skipped"> Number of questions: ${mcqTotal + essayCount}</div>
      <div class="stat-pill stat-correct">✓ Correct: ${mcqCorrect}</div>
      <div class="stat-pill stat-wrong">✗ Wrong: ${mcqWrong}</div>
      <div class="stat-pill stat-skipped">⚪ Skipped: ${mcqSkipped}</div>`;

    let scoreInfo = "";
    if (mcqTotal > 0)
      scoreInfo += `<div class="stat-pill" style="background:rgba(148,163,184,0.1);color:#cbd5e1;border:1px solid rgba(148,163,184,0.2);font-size:13px">MCQ: ${mcqCorrect}/${mcqTotal}${essayCount > 0 ? ` · ✏️ Essays: ${essayTotalScore} / ${essayMaxScore}` : ""}</div>`;
    scoreInfo += `<div class="stat-pill stat-correct" style="font-size:14px">Total score: ${totalScore} / ${totalPoss} pts</div>`;

    htmlContent += `
    <div class="score-block">
      <div class="score-circle ${circleClass}">${percent}%</div>
      <div class="score-label">${label}</div>
      <div class="score-stats">
        ${statsHtml}
      </div>
      <div class="score-stats" style="margin-top:10px">
        ${scoreInfo}
      </div>
    </div>`;
  }

  processedQuestions.forEach((q, index) => {
    const userAns = userAnswers[index];
    const isSkipped = userAns === undefined || userAns === null;
    const isCorrect =
      !isSkipped && userAns === q.correct && !isEssayQuestion(q);

    htmlContent += `
      <div class="question-card">
          <div class="q-header">
              <span>Question ${index + 1}</span>
              <span>${isEssayQuestion(q) ? "Essay" : "MCQ"}</span>
          </div>
          ${q.image ? `<img src="${q.image}" class="question-image" alt="Question Image" onerror="this.alt='[Image not available]'; this.style.border='2px dashed #666';">` : ""}
          <div class="q-text">${renderMarkdown(normalizeLiteralNewlines(q.q))}</div>`;

    if (isEssayQuestion(q)) {
      const userText = userAns || "";
      if (isResultsMode) {
        const score = gradeEssay(userText, q.answer);
        const stars = "★".repeat(score) + "☆".repeat(5 - score);
        const scoreClass =
          score >= 3 ? "correct" : score >= 1 ? "partial" : "wrong";
        htmlContent += `
          <div class="essay-box" style="border-left: 3px solid #3b82f6;">
              <strong style="color: #60a5fa; display:block; margin-bottom:5px;">Your Answer:</strong>
              ${renderMarkdown(normalizeLiteralNewlines(userText || "Not answered"))}
          </div>
          <div class="essay-score ${scoreClass}">
            Score: ${score}/5 &nbsp;<span style="font-size:1.1em;color:#f59e0b">${stars}</span>
          </div>`;
      }

      htmlContent += `<div class="essay-box">
              <strong style="color: #f59e0b; display:block; margin-bottom:5px;">Formal Answer / Key Points:</strong>
              ${renderMarkdown(normalizeLiteralNewlines(q.answer))}
          </div>`;
    } else {
      htmlContent += `<div class="options-list">`;
      q.options.forEach((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        htmlContent += `<div class="option"><strong>${letter}.</strong> ${renderMarkdown(normalizeLiteralNewlines(opt))}</div>`;
      });
      htmlContent += `</div>`;

      const userClass = isSkipped ? "skipped" : isCorrect ? "" : "wrong";
      const userLetter = isSkipped ? "" : String.fromCharCode(65 + userAns);
      const userAnswer = isSkipped
        ? "Skipped"
        : `${userLetter}. ${renderMarkdown(normalizeLiteralNewlines(q.options[userAns]))}`;
      const userIcon = isSkipped ? "⚪" : isCorrect ? "✅" : "❌";

      if (isResultsMode)
        htmlContent += `<div class="user-answer ${userClass}">${userIcon} Your Answer: ${userAnswer}</div>`;

      const correctLetter = String.fromCharCode(65 + q.correct);
      htmlContent += `<div class="correct-answer">✓ Correct Answer: ${correctLetter}. ${renderMarkdown(
        normalizeLiteralNewlines(q.options[q.correct]),
      )}</div>`;
    }

    if (q.explanation) {
      htmlContent += `<div class="explanation"><strong>💡 Explanation:</strong> ${renderMarkdown(normalizeLiteralNewlines(q.explanation))}</div>`;
    }

    htmlContent += `</div>`;
  });

  htmlContent += `<div class="footer">Generated by Quiz App</div></body></html>`;

  const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${config.title || "quiz_export"}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotification(
    "HTML file Downloaded",
    "You have it now",
    "./assets/images/HTML_Icon.png",
  );
}

// Image Helpers
const convertImagesToBase64 = async (questions) => {
  const processedQuestions = [];

  for (const question of questions) {
    const processedQuestion = { ...question };

    if (question.image) {
      // If it's a local path or needs conversion
      if (isLocalPath(question.image)) {
        console.log(`Converting local image to base64: ${question.image}`);
        const base64 = await getDataUrl(question.image);
        if (base64) {
          processedQuestion.image = base64;
        } else {
          console.warn(`Failed to convert ${question.image}, keeping original`);
          // Keep original - will show alt text if broken
        }
      }
      // Remote URLs or already base64 - keep as is
    }

    processedQuestions.push(processedQuestion);
  }

  return processedQuestions;
};

const isLocalPath = (url) => {
  if (!url) return false;
  // Check for relative paths (./, ../, or no protocol)
  if (url.startsWith("./") || url.startsWith("../") || url.startsWith("/")) {
    return true;
  }
  // Check if it lacks a protocol (http://, https://, data:)
  return !/^(https?:|data:)/i.test(url);
};

const getDataUrl = (url) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      try {
        resolve(canvas.toDataURL("image/jpeg"));
      } catch (e) {
        console.warn("Failed to convert image to data URL", e);
        resolve(null);
      }
    };
    img.onerror = () => {
      console.warn("Failed to load image for PDF export", url);
      resolve(null);
    };
    img.src = url;
  });
};

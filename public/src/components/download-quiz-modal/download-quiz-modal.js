// ============================================================================
// public/src/components/download-quiz-modal/download-quiz-modal.js
// DOWNLOAD QUIZ MODAL — the shared Download Quiz format-picker popup.
// ============================================================================
// can be used from more than the two original call sites (create-quiz page, and
// the home page's "My Quizzes" / manifest-exam download buttons) without
// duplicating markup/styling. See quiz-info-modal/ for the sibling
// component this mirrors the structure of.
//
// Call sites:
//   - features/home/download-modal.js       (home: user-made quiz cards)
//   - features/home/exam-card.js             (home: manifest-exam cards)
//   - features/create/create-quiz.js         (create-quiz page)
// ============================================================================

import { exportToQuiz } from "../../features/export/export-to-quiz.js";
import { exportToPdf } from "../../features/export/export-to-pdf.js";
import { exportToWord } from "../../features/export/export-to-word.js";
import { exportToPptx } from "../../features/export/export-to-pptx.js";
import { exportToMarkdown } from "../../features/export/export-to-markdown.js";
import {
  JSON_FILE_ICON_SVG,
  DOWNLOAD_SOURCE_ICON_SVG,
} from "../../features/home/icons.js";
import { showNotification } from "../notifications/notifications.js";
import { buildStandaloneQuizHtml } from "../../features/export/export-to-quiz.js";
import { buildQuizMarkdown } from "../../features/export/export-to-markdown.js";
import { buildJsonQuizExport } from "../../shared/quiz-json.js";

/**
 * Copies text to the clipboard.
 * Prefers the async Clipboard API; falls back to a hidden textarea
 * select-and-copy for non-HTTPS or focus-restricted contexts.
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function copyTextWithFallback(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback: temporary textarea
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("execCommand copy returned false");
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * Creates an export card with an optional top-left copy button.
 *
 * @param {object} options
 * @param {string} options.format — The format identifier.
 * @param {string} options.label — The text label on the card.
 * @param {string} [options.extension] — File extension (e.g. ".json"),
 *   rendered as smaller subtext under the label instead of being folded
 *   into it.
 * @param {string} options.icon — The SVG icon for the card.
 * @param {boolean} options.canCopy — Whether this format can be copied to clipboard.
 * @param {Function} options.onDownload — Async function triggered on card click.
 * @param {Function} options.onCopy — Async function triggered on copy button click (if canCopy=true). Returns the text to copy.
 * @returns {HTMLDivElement}
 */
export function buildExportCard({
  format,
  label,
  extension,
  icon,
  canCopy,
  onDownload,
  onCopy,
}) {
  const card = document.createElement("div");
  card.className = "export-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute(
    "aria-label",
    `Download as ${label}${extension ? ` (${extension})` : ""}`,
  );
  card.dataset.format = format;

  const content = document.createElement("div");
  content.className = "export-card-content";
  content.innerHTML = `
    <div class="export-icon">${icon}</div>
    <div class="export-label">${label}</div>
    ${extension ? `<div class="export-extension">${extension}</div>` : ""}
  `;
  card.appendChild(content);

  // Click on card -> download
  card.onclick = (e) => {
    // If clicked on the copy button, ignore
    if (e.target.closest(".mode-copy-btn")) return;

    withDownloadLoading(card, async () => {
      try {
        await onDownload();
      } catch (err) {
        console.error(err);
        showNotification("خطأ", "فشل التنزيل.", "error");
      }
    });
  };

  // Keyboard support for card
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
    }
  });

  if (canCopy) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "mode-copy-btn";
    copyBtn.setAttribute("aria-label", `Copy ${label} to clipboard`);
    copyBtn.title = `نسخ كنص`;

    const copyIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
    const checkIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

    copyBtn.innerHTML = copyIconSvg;

    copyBtn.onclick = async (e) => {
      e.stopPropagation();
      const originalHtml = copyBtn.innerHTML;
      try {
        // Fix #loading-spinner: same issue as withDownloadLoading() —
        // <i data-lucide> never renders without the Lucide JS library.
        copyBtn.innerHTML =
          '<span class="dl-btn-spinner" style="width:14px;height:14px;" aria-hidden="true"></span>';
        const textToCopy = await onCopy();
        await copyTextWithFallback(textToCopy);

        copyBtn.innerHTML = checkIconSvg;
        copyBtn.classList.add("copied");

        showNotification("تم النسخ", "تم نسخ المحتوى بنجاح!", "success");

        setTimeout(() => {
          copyBtn.innerHTML = copyIconSvg;
          copyBtn.classList.remove("copied");
        }, 2000);
      } catch (err) {
        console.error(err);
        copyBtn.innerHTML = copyIconSvg;
        showNotification("خطأ", "فشل النسخ.", "error");
      }
    };

    card.appendChild(copyBtn);
  }

  return card;
}

/**
 * Dispatches an export operation to the correct export module.
 * @param {string} format — one of: "quiz" | "md" | "pdf" | "pptx" | "docx"
 * @param {object} config — { id, title, description, path?, source? }
 * @param {Array}  questions
 * @param {object} [userAnswers] — optional answer map. When provided (e.g.
 *   from the result page), the exported file includes the user's answers
 *   alongside each question instead of a blank/answer-key-only copy.
 * @param {object} [resultMeta] — optional full result/score object, passed
 *   through only to exportToPdf (score summary in the PDF). Only the result
 *   page has this; other callers omit it.
 * @param {Function} [onProgress] — optional (pct: 0–100) => void. Only
 *   consumed by the chunked generators (pptx/docx) and pdf — ignored by
 *   formats that already resolve near-instantly.
 * @param {AbortSignal} [signal] — optional cancellation signal. Same
 *   pptx/docx-only scope as onProgress (pdf's native-print pipeline has
 *   no meaningful mid-flight cancellation point).
 * @param {object} [exportOptions] — settings collected from the
 *   Settings Panel (see buildSettingsPanel below) for pdf/pptx/docx/md:
 *   { includeAnswers, includeUserAnswers, includeExplanations,
 *     answerPlacement: "inline" | "final-page", pdfBackground: "light" | "dark" }.
 *   Formats/exporters that don't yet consume a given field simply ignore it.
 */
export async function executeExport(
  format,
  config,
  questions,
  userAnswers,
  resultMeta,
  onProgress,
  signal,
  exportOptions = {},
) {
  switch (format) {
    case "quiz":
      await exportToQuiz(config, questions);
      break;
    case "pdf":
      await exportToPdf(config, questions, userAnswers, resultMeta, onProgress, {
        backgroundColor: exportOptions.pdfBackground,
      });
      break;
    case "docx":
      return await exportToWord(
        config,
        questions,
        userAnswers,
        onProgress,
        signal,
      );
    case "pptx":
      return await exportToPptx(
        config,
        questions,
        userAnswers,
        onProgress,
        signal,
        {
          includeAnswers: exportOptions.includeAnswers,
          includeUserAnswers: exportOptions.includeUserAnswers,
          includeExplanations: exportOptions.includeExplanations,
          answerPlacement: exportOptions.answerPlacement,
        },
      );
    case "md":
      exportToMarkdown(config, questions, userAnswers, {
        includeAnswers: exportOptions.includeAnswers,
        includeUserAnswers: exportOptions.includeUserAnswers,
        includeExplanations: exportOptions.includeExplanations,
        answerPlacement: exportOptions.answerPlacement,
      });
      break;
  }
}

/**
 * Triggers a file download from a Blob without leaving orphaned object URLs.
 * @param {Blob} blob
 * @param {string} filename
 */
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Wrapper for download buttons to show loading state
 */
export async function withDownloadLoading(buttonEl, asyncFn) {
  const originalHtml = buttonEl.innerHTML;
  const originalWidth = buttonEl.offsetWidth;

  buttonEl.disabled = true;
  buttonEl.style.width = `${originalWidth > 0 ? originalWidth : buttonEl.getBoundingClientRect().width}px`;
  buttonEl.style.justifyContent = "center";
  // Fix #loading-spinner: previously this inserted a
  // `<i data-lucide="loader-circle" class="spin">` PLUS the text "جاري
  // التحميل...". Lucide's JS (which turns [data-lucide] into real SVG
  // icons) isn't loaded on every page that uses this helper — index.html
  // in particular uses plain inline <svg> everywhere and never calls
  // lucide.createIcons() — so the <i> tag rendered as nothing at all,
  // and the extra text alone was enough to overflow/reflow the button's
  // fixed width. Replaced with a small pure-CSS spinner (a bordered
  // circle animated via @keyframes, defined below) and no text at all,
  // so the button never needs to be wider than its normal content.
  buttonEl.innerHTML = '<span class="dl-btn-spinner" aria-hidden="true"></span>';
  try {
    await asyncFn();
  } finally {
    buttonEl.disabled = false;
    buttonEl.innerHTML = originalHtml;
    buttonEl.style.width = "";
    buttonEl.style.justifyContent = "";
  }
}

// ============================================================================
// SETTINGS PANEL — shown before generation for pdf/pptx/docx/md
// ============================================================================
// Bakes "what state should this static file be generated in" choices in
// at export time (decided by the person exporting), as opposed to
// export-to-quiz.js's in-file "Show All Answers" toggle, which the
// eventual *reader* of the exported standalone .html/quiz flips
// themselves after the fact. Those are two separate, deliberately
// independent features — see plan doc for the full reasoning.
//
// Formats that stay instant/unchanged (quiz, json) never see this panel.

const FORMATS_WITH_SETTINGS = new Set(["pdf", "pptx", "docx", "md"]);

/**
 * Builds the settings step shown before generation. Resolves to `null`
 * if the user closes/cancels the panel (caller should abort the export),
 * or an options object otherwise:
 *   { includeAnswers, includeUserAnswers, includeExplanations,
 *     answerPlacement: "inline" | "final-page", pdfBackground: "light" | "dark" }
 *
 * @param {object} params
 * @param {string} params.format — "pdf" | "pptx" | "docx" | "md"
 * @param {string} params.label — display label (e.g. "PDF") for the header.
 * @param {boolean} params.hasUserAnswers — whether userAnswers was passed
 *   into showDownloadModal() (only true from the Results page flow) — the
 *   "include user's answers" row only renders when this is true.
 * @param {(panelEl: HTMLElement) => void} params.onPanelReady — called
 *   synchronously with the built panel element so the caller can mount it
 *   before the promise resolves (the promise only resolves on user action).
 * @returns {Promise<object|null>}
 */
function buildSettingsPanel({ format, label, hasUserAnswers, onPanelReady }) {
  return new Promise((resolve) => {
    const state = {
      includeAnswers: false,
      includeUserAnswers: false,
      includeExplanations: false,
      answerPlacement: "inline",
      pdfBackground: "light",
    };

    const panel = document.createElement("div");
    panel.className = "dl-settings-panel";

    const heading = document.createElement("div");
    heading.className = "dl-settings-heading";
    heading.textContent = `إعدادات تصدير ${label}`;
    panel.appendChild(heading);

    const rows = document.createElement("div");
    rows.className = "dl-settings-rows";

    // ── Row: Include correct answers (plain toggle, per feedback — no
    // confirmation dialog, consistent with the other rows). ──
    const answersRow = document.createElement("div");
    answersRow.className = "dl-settings-row";
    answersRow.innerHTML = `
      <div class="dl-settings-row-text">
        <div class="dl-settings-row-title">تضمين الإجابات الصحيحة</div>
        <div class="dl-settings-row-sub">يكشف الإجابة الصحيحة لكل سؤال في الملف المُصدَّر</div>
      </div>
    `;
    const answersToggle = buildSwitch(false);
    answersRow.appendChild(answersToggle.el);

    // ── Row: Include user's answers (only when hasUserAnswers) ──
    let userAnswersToggle = null;
    let userAnswersRow = null;
    if (hasUserAnswers) {
      userAnswersRow = document.createElement("div");
      userAnswersRow.className = "dl-settings-row";
      userAnswersRow.innerHTML = `
        <div class="dl-settings-row-text">
          <div class="dl-settings-row-title">تضمين إجاباتك</div>
          <div class="dl-settings-row-sub">يُظهر إجاباتك الفعلية بجانب كل سؤال</div>
        </div>
      `;
      const toggle = buildSwitch(false);
      userAnswersRow.appendChild(toggle.el);
      userAnswersToggle = toggle;
    }

    // ── Row: Include explanations/feedback ──
    const explanationsRow = document.createElement("div");
    explanationsRow.className = "dl-settings-row";
    explanationsRow.innerHTML = `
      <div class="dl-settings-row-text">
        <div class="dl-settings-row-title">تضمين الشروحات</div>
        <div class="dl-settings-row-sub">يعرض شرح كل سؤال (إن وُجد)</div>
      </div>
    `;
    const explanationsToggle = buildSwitch(false);
    explanationsRow.appendChild(explanationsToggle.el);

    // ── Row: Answer key placement (only meaningful once answers included) ──
    const placementRow = document.createElement("div");
    placementRow.className = "dl-settings-row dl-settings-row-stack dl-settings-placement";
    placementRow.style.display = "none";
    placementRow.innerHTML = `
      <div class="dl-settings-row-text">
        <div class="dl-settings-row-title">مكان الإجابات</div>
      </div>
      <div class="dl-settings-segmented" role="radiogroup" aria-label="مكان الإجابات">
        <button type="button" class="dl-segmented-btn active" data-value="inline" role="radio" aria-checked="true">أسفل كل سؤال</button>
        <button type="button" class="dl-segmented-btn" data-value="final-page" role="radio" aria-checked="false">مجمّعة في صفحة أخيرة</button>
      </div>
    `;
    const placementBtns = placementRow.querySelectorAll(".dl-segmented-btn");
    placementBtns.forEach((btn) => {
      btn.onclick = () => {
        state.answerPlacement = btn.dataset.value;
        placementBtns.forEach((b) => {
          b.classList.toggle("active", b === btn);
          b.setAttribute("aria-checked", String(b === btn));
        });
      };
    });

    const updatePlacementVisibility = () => {
      placementRow.style.display = state.includeAnswers ? "flex" : "none";
    };

    // Toggling answers on/off no longer needs a confirmation dialog —
    // it behaves exactly like the other toggle rows now.
    answersToggle.el.addEventListener("click", () => {
      // buildSwitch already flipped its own internal state by the time
      // this listener runs (its own onclick fires first since it was
      // attached first) — read it back via .get() rather than guessing.
      state.includeAnswers = answersToggle.get();
      updatePlacementVisibility();
    });

    rows.appendChild(answersRow);
    if (userAnswersRow) rows.appendChild(userAnswersRow);
    rows.appendChild(explanationsRow);
    rows.appendChild(placementRow);

    // ── PDF-only: background color ──
    let bgBtns = null;
    if (format === "pdf") {
      const bgRow = document.createElement("div");
      bgRow.className = "dl-settings-row dl-settings-row-stack";
      bgRow.innerHTML = `
        <div class="dl-settings-row-text">
          <div class="dl-settings-row-title">لون الخلفية</div>
        </div>
        <div class="dl-settings-segmented" role="radiogroup" aria-label="لون الخلفية">
          <button type="button" class="dl-segmented-btn active" data-value="light" role="radio" aria-checked="true">أبيض</button>
          <button type="button" class="dl-segmented-btn" data-value="dark" role="radio" aria-checked="false">داكن</button>
        </div>
      `;
      bgBtns = bgRow.querySelectorAll(".dl-segmented-btn");
      bgBtns.forEach((btn) => {
        btn.onclick = () => {
          state.pdfBackground = btn.dataset.value;
          bgBtns.forEach((b) => {
            b.classList.toggle("active", b === btn);
            b.setAttribute("aria-checked", String(b === btn));
          });
        };
      });
      rows.appendChild(bgRow);
    }

    const actions = document.createElement("div");
    actions.className = "dl-settings-actions";
    actions.innerHTML = `
      <button type="button" class="dl-settings-back">رجوع</button>
      <button type="button" class="dl-settings-continue">متابعة</button>
    `;

    panel.appendChild(rows);
    panel.appendChild(actions);

    actions.querySelector(".dl-settings-back").onclick = () => resolve(null);
    actions.querySelector(".dl-settings-continue").onclick = () => {
      state.includeAnswers = answersToggle.get();
      state.includeUserAnswers = userAnswersToggle
        ? userAnswersToggle.get()
        : false;
      state.includeExplanations = explanationsToggle.get();
      resolve({ ...state });
    };

    onPanelReady(panel);
  });
}

/**
 * Small on/off switch control (used for settings rows that ARE meant to
 * be simple toggles — unlike "include answers", which per explicit user
 * feedback must be a confirmation button instead).
 * @param {boolean} initial
 * @returns {{ el: HTMLElement, get: () => boolean }}
 */
function buildSwitch(initial) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dl-switch" + (initial ? " on" : "");
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-checked", String(initial));
  btn.innerHTML = `<span class="dl-switch-knob"></span>`;
  let value = initial;
  btn.onclick = () => {
    value = !value;
    btn.classList.toggle("on", value);
    btn.setAttribute("aria-checked", String(value));
  };
  return { el: btn, get: () => value };
}

// ============================================================================
// SHARED DOWNLOAD MODAL — the format-picker popup.
// ============================================================================

const DOWNLOAD_FORMAT_OPTIONS = [
  {
    format: "quiz",
    label: "Quiz",
    extension: ".html",
    iconUrl: "./favicon.png",
    canCopy: true,
  },
  {
    format: "md",
    label: "Markdown",
    extension: ".md",
    iconUrl: "./assets/images/mardownIcon.png",
    canCopy: true,
  },
  {
    format: "json",
    label: "JSON",
    extension: ".json",
    iconSvg: JSON_FILE_ICON_SVG,
    canCopy: true,
  },
  {
    format: "pdf",
    label: "PDF",
    extension: ".pdf",
    iconUrl: "./assets/images/PDF_Icon.png",
    canCopy: false,
  },
  {
    format: "pptx",
    label: "PowerPoint",
    extension: ".pptx",
    iconUrl: "./assets/images/pptx_icon.png",
    canCopy: false,
  },
  {
    format: "docx",
    label: "Word",
    extension: ".docx",
    iconUrl: "./assets/images/word_icon.png",
    canCopy: false,
  },
];

/**
 * Builds and shows the shared download-format modal (the "دي.إل" popup
 * used across the create-quiz page and the home page). Handles its own
 * overlay, close button, and click-outside/removal — the caller doesn't
 * need to manage the DOM node afterwards.
 *
 * @param {object} options
 * @param {object} options.config — export config: { id, title, description,
 *   source, createdAt, author, author_email, password, view, mode,
 *   questionTypes, questionCount }. Only `title`/`description`/`source` are
 *   required by the exporters; the rest are passed through when present.
 * @param {Array}  options.questions — quiz questions array.
 * @param {object} [options.userAnswers] — optional answer map (keyed the
 *   same way as questions). When provided, every "with answers" export
 *   format (html/md/pdf/docx/pptx) includes it — used by the result
 *   page so downloads reflect the user's own answers. Callers that don't
 *   pass this (home page, create-quiz page) get plain answer-free exports,
 *   exactly as before.
 * @param {object} [options.resultMeta] — optional full result/score object
 *   (e.g. { score, total, percentage, ... }), passed through only to the
 *   PDF exporter for its score summary. Only the result page has this.
 * @param {Function} [options.buildJsonPayloadString] — async () => string.
 *   Optional override for building the JSON export payload (lets callers
 *   fold in extra export-time metadata, e.g. create-quiz.js's password/view/
 *   mode fields). Defaults to a plain buildJsonQuizExport() call.
 * @param {string} [options.filenameBase] — base filename (without
 *   extension) for text/json downloads. Defaults to config.title/"quiz".
 * @param {Function} [options.resolveExportData] — async ({config, questions})
 *   => {config, questions}. Optional hook run lazily, once, right before the
 *   first download/copy action fires. Lets a caller open the modal
 *   immediately from a lightweight/summary config (e.g. a manifest exam
 *   entry) while deferring a slower async fetch — for the raw quiz file,
 *   fields like view/mode/questions — until the user actually picks a
 *   format. The result is cached and reused for subsequent clicks in the
 *   same modal. Defaults to a no-op that returns {config, questions} as-is.
 */
export function showDownloadModal({
  config,
  questions,
  userAnswers,
  resultMeta,
  buildJsonPayloadString,
  filenameBase,
  resolveExportData,
}) {
  const safeBase = filenameBase || config.title || "quiz";

  // Lazily resolves (and caches) the real {config, questions} to export.
  // Every onDownload/onCopy handler below should read through this instead
  // of closing over `config`/`questions` directly, so a resolveExportData
  // hook — if provided — only ever runs once no matter which/how many
  // format cards get clicked. userAnswers is never touched by
  // resolveExportData (it's a runtime/session value, not fetched data) —
  // it's carried straight through from the caller.
  let resolvedPromise = null;
  const getExportData = () => {
    if (!resolvedPromise) {
      resolvedPromise = resolveExportData
        ? Promise.resolve(resolveExportData({ config, questions }))
        : Promise.resolve({ config, questions });
    }
    return resolvedPromise;
  };

  const buildJsonString =
    buildJsonPayloadString ||
    (async () => {
      const { config: c, questions: q } = await getExportData();
      const payload = await buildJsonQuizExport(
        c.title,
        c.description,
        c.source,
        q || [],
        config.createdAt,
      );
      return JSON.stringify(payload, null, 2);
    });

  const modal = document.createElement("div");
  modal.className = "modal-overlay download-modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "downloadModalTitle");

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const modalCard = document.createElement("div");
  modalCard.className = "modal-card dl-modal-card";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <h2 id="downloadModalTitle"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg> تحميل الامتحان</h2>
    <button type="button" class="close-btn dl-close" aria-label="إغلاق"><svg xmlns="http://www.w3.org/2000/svg" class="page-data-lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
  `;

  const grid = document.createElement("div");
  grid.className = "mode-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "خيارات التنزيل");

  // ── Generation progress panel (Step 4: PPTX/Word) ──────────────────────
  // Swapped in for the format grid while a chunked, cancellable export is
  // in flight. Built once and toggled via display, rather than
  // torn down/rebuilt, so its AbortController survives across renders.
  const progressPanel = document.createElement("div");
  progressPanel.className = "dl-progress-panel";
  progressPanel.style.display = "none";
  progressPanel.innerHTML = `
    <img class="dl-progress-icon" src="" alt="" aria-hidden="true">
    <div class="dl-progress-label"></div>
    <div class="dl-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="dl-progress-fill"></div>
    </div>
    <div class="dl-progress-pct">0%</div>
    <button type="button" class="dl-progress-cancel">إلغاء</button>
  `;
  const progressIcon = progressPanel.querySelector(".dl-progress-icon");
  const progressLabel = progressPanel.querySelector(".dl-progress-label");
  const progressTrack = progressPanel.querySelector(".dl-progress-track");
  const progressFill = progressPanel.querySelector(".dl-progress-fill");
  const progressPct = progressPanel.querySelector(".dl-progress-pct");
  const progressCancelBtn = progressPanel.querySelector(".dl-progress-cancel");

  let activeController = null;

  const setProgress = (pct) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    progressFill.style.width = `${clamped}%`;
    progressPct.textContent = `${clamped}%`;
    progressTrack.setAttribute("aria-valuenow", String(clamped));
  };

  // ── Settings panel host ── swapped in for the grid, same pattern as
  // progressPanel below, while the user picks answers/explanations/
  // placement/background options for pdf/pptx/docx/md.
  const settingsPanelHost = document.createElement("div");
  settingsPanelHost.className = "dl-settings-host";
  settingsPanelHost.style.display = "none";

  /**
   * Shows the settings step for a format, swapping the grid out and
   * settingsPanelHost in. Resolves to the collected options object, or
   * null if the user clicked "back".
   */
  const showSettingsStep = (opt) =>
    new Promise((resolve) => {
      settingsPanelHost.innerHTML = "";
      grid.style.display = "none";
      settingsPanelHost.style.display = "flex";
      buildSettingsPanel({
        format: opt.format,
        label: opt.label,
        hasUserAnswers: Boolean(
          userAnswers &&
          (Array.isArray(userAnswers)
            ? userAnswers.length > 0
            : Object.keys(userAnswers).length > 0),
        ),
        onPanelReady: (panelEl) => settingsPanelHost.appendChild(panelEl),
      }).then((result) => {
        settingsPanelHost.style.display = "none";
        grid.style.display = "";
        resolve(result);
      });
    });

  /**
   * Runs a chunked export (pptx/docx/pdf) with the grid replaced by the
   * progress panel. Resolves once the export settles (success, failure,
   * or user cancellation) and always restores the grid afterwards.
   */
  const runWithProgressPanel = async (opt, iconUrl, label, exportOptions) => {
    const controller = new AbortController();
    activeController = controller;

    grid.style.display = "none";
    progressPanel.style.display = "flex";
    progressIcon.src = iconUrl;
    progressLabel.textContent = label;
    progressCancelBtn.disabled = false;
    progressCancelBtn.textContent = "إلغاء";
    progressCancelBtn.classList.remove("dl-progress-cancelling");
    setProgress(0);

    const onCancelClick = () => {
      controller.abort();
      progressCancelBtn.disabled = true;
      progressCancelBtn.textContent = "جاري الإلغاء...";
      progressCancelBtn.classList.add("dl-progress-cancelling");
    };
    progressCancelBtn.addEventListener("click", onCancelClick, { once: true });

    try {
      const { config: c, questions: q } = await getExportData();
      const result = await executeExport(
        opt.format,
        c,
        q,
        userAnswers,
        resultMeta,
        setProgress,
        controller.signal,
        exportOptions,
      );
      if (result && result.cancelled) {
        showNotification("تم الإلغاء", "تم إلغاء عملية التصدير.", "info");
      } else if (!result || result.success !== false) {
        modal.remove();
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        showNotification("تم الإلغاء", "تم إلغاء عملية التصدير.", "info");
      } else {
        console.error(err);
        showNotification("خطأ", "فشل التنزيل.", "error");
      }
    } finally {
      progressCancelBtn.removeEventListener("click", onCancelClick);
      activeController = null;
      progressPanel.style.display = "none";
      grid.style.display = "";
    }
  };

  DOWNLOAD_FORMAT_OPTIONS.forEach((opt) => {
    const iconHtml = opt.iconSvg
      ? opt.iconSvg
      : `<img src="${opt.iconUrl}" alt="" class="icon" aria-hidden="true">`;
    const usesProgressPanel =
      opt.format === "pptx" || opt.format === "docx" || opt.format === "pdf";
    const usesSettingsPanel = FORMATS_WITH_SETTINGS.has(opt.format);
    const card = buildExportCard({
      format: opt.format,
      label: opt.label,
      extension: opt.extension,
      icon: iconHtml,
      canCopy: opt.canCopy,
      onDownload: async () => {
        let exportOptions;
        if (usesSettingsPanel) {
          exportOptions = await showSettingsStep(opt);
          if (!exportOptions) return; // user hit "back" — stay on the grid
        }

        if (usesProgressPanel) {
          await runWithProgressPanel(opt, opt.iconUrl, opt.label, exportOptions);
        } else if (opt.format === "json") {
          const fileContent = await buildJsonString();
          const blob = new Blob([fileContent], { type: "application/json" });
          triggerDownload(blob, `${safeBase}.json`);
          modal.remove();
        } else {
          const { config: c, questions: q } = await getExportData();
          await executeExport(
            opt.format,
            c,
            q,
            userAnswers,
            resultMeta,
            undefined,
            undefined,
            exportOptions,
          );
          modal.remove();
        }
      },
      onCopy: async () => {
        const { config: c, questions: q } = await getExportData();
        if (opt.format === "quiz") return await buildStandaloneQuizHtml(c, q);
        if (opt.format === "md") return buildQuizMarkdown(c, q, userAnswers);
        if (opt.format === "json") return await buildJsonString();
      },
    });
    grid.appendChild(card);
  });

  // Show source button if the quiz has a source URL
  const quizSource = config.source;
  if (quizSource && typeof quizSource === "string" && quizSource.trim()) {
    const sourceBtn = document.createElement("button");
    sourceBtn.className = "mode-btn";
    sourceBtn.type = "button";
    sourceBtn.setAttribute("aria-label", "Download Source");
    sourceBtn.innerHTML = `${DOWNLOAD_SOURCE_ICON_SVG}<strong>Download Source</strong>`;
    sourceBtn.onclick = (ev) => {
      ev.stopPropagation();
      window.open(quizSource, "_blank");
      modal.remove();
    };
    grid.appendChild(sourceBtn);
  }

  modalCard.appendChild(header);
  modalCard.appendChild(grid);
  modalCard.appendChild(settingsPanelHost);
  modalCard.appendChild(progressPanel);
  modal.appendChild(modalCard);

  // Closing the modal (✕ button, backdrop click, or the click-outside
  // handler registered above) while a chunked export is still running
  // should abort it — otherwise its setTimeout-chunked loop keeps
  // running invisibly in the background after the UI is gone.
  const closeModal = () => {
    if (activeController) activeController.abort();
    modal.remove();
  };

  modal.querySelector(".dl-close").onclick = closeModal;

  document.body.appendChild(modal);

  return modal;
}
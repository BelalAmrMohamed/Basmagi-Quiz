// Shared notebook card actions for BOTH local (محتواي) and platform notebooks:
//   • «معلومات الدفتر»  info dialog (same shell as the lesson info dialog)
//   • downloads: .ipynb (Jupyter), .m / .cpp (script, by runtime), .json (everything), HTML, print / save as PDF
//   • «اسأل الباشـمبصمج»  attaches the whole notebook (as reading material) to the AI agent
// The info/download logic lives in shared/notebook-export.js (pure, unit-tested).
import { escapeHtml } from "./escape-html.js";
import { createExamInfoSubmenu } from "./item-dropdown-menu.js";
import { SPARKLE_ICON_SVG, DOWNLOAD_ICON_SVG, JSON_FILE_ICON_SVG } from "./icons.js";
import { formatDateForInfo } from "../../components/quiz-info-modal/quiz-info-html.js";
import { renderMarkdown } from "../../shared/markdown.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { exportNotebookZip } from "../../shared/notebook-bundle.js";
import { bindInfoCopyButtons, infoItemLinkHtml, infoSourceHtml } from "../../shared/info-link.js";
import { buildInfoSkeletonHtml, buildCreatorSectionHtml, fetchCreatorById, fetchCreatorName } from "./info-details.js";
import { buildExportCard, buildSourceActions } from "../../components/download-quiz-modal/export-card.js";
import {
  rowToNotebook, collectNotebookInfo, notebookToIpynb, notebookToMScript, notebookToCppScript, notebookToJson, notebookToHtml, safeFileName,
} from "../../shared/notebook-export.js";

const LANG_LABEL = { en: "الإنجليزية (من اليسار لليمين)", ar: "العربية (من اليمين لليسار)" };
const RUNTIME_LABEL = { matlab: "MATLAB", cpp: "C++" };

function infoBodyHtml(info, url) {
  const rows = [];
  const add = (label, valueHtml) => rows.push(`<div class="quiz-meta-label">${escapeHtml(label)}</div><div class="quiz-meta-value">${valueHtml}</div>`);
  add("نص (Markdown)", escapeHtml(String(info.markdownCount)));
  add("كود", escapeHtml(`${info.codeCount} (${info.codeLines} سطر)`));
  add("بيئة التشغيل", escapeHtml(RUNTIME_LABEL[info.runtime] || info.runtime));
  add("لغة الدفتر", escapeHtml(LANG_LABEL[info.language] || info.language));
  if (info.description) add("الوصف", escapeHtml(info.description));
  if (info.source) add("المصدر", infoSourceHtml(info.source));
  if (url) add("رابط الدفتر", infoItemLinkHtml(url, info.title, "رابط الدفتر"));
  add("مكان الحفظ", info.local ? "على جهازك فقط (محتواي)" : "منصة بصمجي (مشترك)");
  const created = formatDateForInfo(info.createdAt);
  if (created) add("تاريخ الإنشاء", `<span dir="ltr">${escapeHtml(created)}</span>`);
  const updated = formatDateForInfo(info.updatedAt && !Number.isNaN(Date.parse(info.updatedAt)) ? new Date(info.updatedAt).toLocaleString("en-US") : info.updatedAt);
  if (updated && updated !== created) add("آخر تعديل", `<span dir="ltr">${escapeHtml(updated)}</span>`);
  if (info.id) add("ID", `<span class="quiz-id-badge">${escapeHtml(info.id)}</span>`);
  return `
    <div class="quiz-info-hero">
      <h3 dir="auto">${escapeHtml(info.title)}</h3>
      <div class="quiz-metrics-row"><span class="quiz-metric-pill">${escapeHtml(`${info.cellCount} خلية`)}</span></div>
    </div>
    <div class="quiz-info-section">
      <div class="quiz-info-section-title">تفاصيل الدفتر</div>
      <div class="quiz-meta-grid">${rows.join("")}</div>
    </div>
    ${info.createdBy ? `<div data-notebook-creator-slot>${buildInfoSkeletonHtml({ title: false, pills: 0, rows: 0, card: true })}</div>` : ""}`;
}

export function showNotebookInfoModal(row) {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const info = collectNotebookInfo(row);
  const url = info.local ? "" : `${window.location.origin}/notebook/${encodeURIComponent(info.slug || info.id)}`;
  const dialog = document.createElement("dialog");
  dialog.className = "quiz-info-dialog lesson-info-dialog";
  dialog.setAttribute("aria-labelledby", "notebookInfoDialogTitle");
  dialog.innerHTML = `
    <div class="quiz-info-dialog-inner">
      <div class="quiz-info-dialog-header">
        <h2 id="notebookInfoDialogTitle">معلومات الدفتر</h2>
        <button class="quiz-info-dialog-close" type="button" aria-label="إغلاق">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div class="quiz-info-dialog-body">${infoBodyHtml(info, url)}</div>
    </div>`;
  bindInfoCopyButtons(dialog);
  document.body.appendChild(dialog);
  const close = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
    if (previousFocus && document.body.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
  };
  dialog.querySelector(".quiz-info-dialog-close").onclick = close;
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  // Uploader card («إعداد»), same as the quiz / lesson dialogs — platform notebooks only
  // (local notebooks have no uploader).
  const slot = dialog.querySelector("[data-notebook-creator-slot]");
  if (slot && info.createdBy) {
    fetchCreatorById(info.createdBy).then((creator) => {
      if (!slot.isConnected) return;
      slot.innerHTML = creator ? buildCreatorSectionHtml(creator) : "";
    }).catch(() => { slot.remove(); });
  }
  return dialog;
}

function saveBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const htmlOf = (nb) => notebookToHtml(nb, { renderMarkdown: (s) => renderMarkdown(s) }); // nb: flat notebook (rowToNotebook)

/** kind: "ipynb" | "m" | "html" | "pdf" (opens the print dialog; choose “Save as PDF”). */
export function downloadNotebook(row, kind) {
  const nb = rowToNotebook(row);
  const base = safeFileName(nb.title);
  if (kind === "zip") {
    // Async: workspace files come from IndexedDB (local) or the published manifest (platform).
    return exportNotebookZip({ ...nb, keys: [nb.local ? nb.id : `pub_${nb.id}`] }).then(() => true).catch((error) => {
      console.error("[notebook-actions] zip failed:", error);
      showNotification("تعذّر التنزيل", "حدث خطأ أثناء تجهيز الملف. حاول مرة أخرى.", "error");
      return false;
    });
  }
  try {
    if (kind === "ipynb") saveBlob(`${base}.ipynb`, new Blob([JSON.stringify(notebookToIpynb(nb), null, 1)], { type: "application/x-ipynb+json" }));
    else if (kind === "m") saveBlob(`${base}.m`, new Blob([notebookToMScript(nb).replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" }));
    else if (kind === "cpp") saveBlob(`${base}.cpp`, new Blob([notebookToCppScript(nb).replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" }));
    else if (kind === "json") saveBlob(`${base}.json`, new Blob([JSON.stringify(notebookToJson(nb), null, 2)], { type: "application/json;charset=utf-8" }));
    else if (kind === "html") saveBlob(`${base}.html`, new Blob([htmlOf(nb)], { type: "text/html;charset=utf-8" }));
    else if (kind === "pdf") printNotebook(nb);
    else throw new Error(`unknown format ${kind}`);
    return true;
  } catch (error) {
    console.error("[notebook-actions] download failed:", error);
    showNotification("تعذّر التنزيل", "حدث خطأ أثناء تجهيز الملف. حاول مرة أخرى.", "error");
    return false;
  }
}

export function showNotebookDownloadModal(row, triggerBtn = null) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay download-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "notebookDownloadTitle");

  const modal = document.createElement("div");
  modal.className = "modal-card dl-modal-card lesson-dl-modal-card";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
    <h2 id="notebookDownloadTitle">${DOWNLOAD_ICON_SVG}<span>تنزيل الدفتر</span></h2>
    <button type="button" class="close-btn dl-close" aria-label="إغلاق">×</button>`;

  const grid = document.createElement("div");
  grid.className = "mode-grid lesson-dl-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "خيارات تنزيل الدفتر");

  const isCpp = rowToNotebook(row).runtime === "cpp";
  const CPP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 15l-2 -2 2-2M15 11l2 2-2 2"/></svg>';
  const allFormats = [
    { kind: "ipynb", label: "Jupyter Notebook", extension: ".ipynb", icon: JSON_FILE_ICON_SVG },
    { kind: "m", label: "MATLAB", extension: ".m", icon: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 17-5-5 5-5"/><path d="m16 7 5 5-5 5"/><path d="m14 4-4 16"/></svg>' },
    { kind: "cpp", label: "C++", extension: ".cpp", icon: CPP_ICON },
    { kind: "json", label: "JSON (كل المحتوى)", extension: ".json", icon: JSON_FILE_ICON_SVG },
    { kind: "html", label: "HTML", extension: ".html", icon: '<img src="/assets/images/HTML_Icon.png" alt="" aria-hidden="true">' },
    { kind: "zip", label: "Notebook + Files", extension: ".zip", icon: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>' },
    { kind: "pdf", label: "PDF", extension: "طباعة / حفظ كـ PDF", icon: '<img src="/assets/images/PDF_Icon.png" alt="" aria-hidden="true">' },
  ];
  // The script format follows the notebook's runtime: .cpp for C++ notebooks, .m for MATLAB ones.
  const formats = allFormats.filter((f) => (f.kind === "m" ? !isCpp : f.kind === "cpp" ? isCpp : true));

  const close = () => {
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
    if (triggerBtn?.isConnected) triggerBtn.focus({ preventScroll: true });
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") close();
  };

  for (const option of formats) {
    const copyable = ["ipynb", "m", "cpp", "json", "html"].includes(option.kind);
    grid.appendChild(buildExportCard({
      format: option.kind,
      label: option.label,
      extension: option.extension,
      icon: option.icon,
      canCopy: copyable,
      onCopy: async () => {
        const nb = rowToNotebook(row);
        if (option.kind === "ipynb") return JSON.stringify(notebookToIpynb(nb), null, 1);
        if (option.kind === "m") return notebookToMScript(nb).replace(/\n/g, "\r\n");
        if (option.kind === "cpp") return notebookToCppScript(nb).replace(/\n/g, "\r\n");
        if (option.kind === "json") return JSON.stringify(notebookToJson(nb), null, 2);
        return htmlOf(nb);
      },
      onDownload: () => {
        const r = downloadNotebook(row, option.kind);
        if (r && typeof r.then === "function") r.then((ok) => { if (ok) close(); });
        else if (r) close();
      },
    }));
  }

  const sourceActions = buildSourceActions(row?.source || row?.meta?.source);
  if (sourceActions) grid.appendChild(sourceActions);

  modal.append(header, grid);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKeyDown);
  header.querySelector(".dl-close").addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  header.querySelector(".dl-close").focus();
  return overlay;
}

function printNotebook(nb) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.append(frame);
  const cleanup = () => setTimeout(() => frame.remove(), 1500);
  frame.addEventListener("load", () => {
    const win = frame.contentWindow;
    if (!win) return cleanup();
    win.addEventListener("afterprint", cleanup);
    setTimeout(() => { try { win.focus(); win.print(); } catch { cleanup(); } }, 400); // let KaTeX CSS load
  }, { once: true });
  frame.srcdoc = htmlOf(nb);
  showNotification("PDF", "اختر «حفظ كملف PDF» من نافذة الطباعة.", "info");
}

/** Opens the AI agent with the notebook attached (local row or platform notebook). */
export async function askAboutNotebook(row, { platform = false } = {}) {
  const launcher = await import("../../components/ai-agent/ai-agent-attach-launcher.js");
  let attachment;
  if (platform) {
    const nb = rowToNotebook(row);
    attachment = launcher.buildPlatformNotebookAttachment({ id: nb.id, title: nb.title, description: nb.description, source: nb.source, runtime: nb.runtime, content: { schemaVersion: 1, language: nb.language, cells: nb.cells } });
  } else {
    attachment = launcher.resolveUserItemAttachment(row.id || row.meta?.id);
  }
  if (!attachment) { showNotification("تعذّر فتح المساعد", "لم يتم العثور على الدفتر.", "error"); return; }
  const { HOME_PAGE_SYSTEM_PROMPT } = await import("../../components/ai-agent/ai-agent-default-prompts.js");
  launcher.openAIAgentWithAttachment(attachment, { defaultSystemPrompt: HOME_PAGE_SYSTEM_PROMPT });
}

/** Loads the full published row (cells included) for a platform notebook summary. */
export async function fetchPlatformNotebookRow(summary) {
  if (summary?.content?.cells) return summary;
  const { ensureSharedSupabaseClient } = await import("../../shared/supabaseClientRegistry.js");
  const sb = await ensureSharedSupabaseClient();
  if (!sb) throw new Error("no client");
  const { data, error } = await sb.from("notebook_public").select("*").eq("id", summary.id).maybeSingle();
  if (error || !data) throw new Error("not found");
  return data;
}

/**
 * Appends «معلومات الدفتر» and «اسأل الباشـمبصمج» to a card's ⋮ menu.
 * Local rows carry their content; platform summaries (home manifest) are fetched on demand.
 */
export function appendNotebookMenuEntries(menu, closeMenu, reposition, row, { platform = false } = {}) {
  const loadRow = async () => {
    if (!platform) return row;
    try { return await fetchPlatformNotebookRow(row); } catch {
      showNotification("تعذّر تحميل الدفتر", "تحقق من اتصالك ثم حاول مرة أخرى.", "error");
      return null;
    }
  };
  const info = collectNotebookInfo(row);
  const cellCount = info.cellCount || Number(row?.cellCount) || 0;
  const basicRows = [
    { label: "ID", val: info.id, multiline: true, copyable: true, ltr: true },
    { label: "الخلايا", val: cellCount },
    ...(platform && info.createdBy ? [{ label: "إعداد", val: "…", loadVal: () => fetchCreatorName(info.createdBy) }] : []),
    ...(platform ? [] : [{ label: "كود / نص", val: `${info.codeCount} / ${info.markdownCount}` }, { label: "اللغة", val: info.language === "ar" ? "العربية" : "English" }]),
  ].filter((r) => r.val || r.val === 0);
  menu.appendChild(createExamInfoSubmenu(basicRows, async () => { const full = await loadRow(); if (full) showNotebookInfoModal(full); }, closeMenu, reposition, "معلومات الدفتر"));

  // Phones: the card has no download button (same as quizzes / lessons) — it lives in this menu.
  // Hidden on desktop via .mobile-only, where the card's own button is shown.
  const download = document.createElement("button");
  download.type = "button";
  download.className = "exam-action-btn mobile-only exam-action-btn--primary";
  download.innerHTML = `${DOWNLOAD_ICON_SVG}<span>تحميل</span>`;
  download.onclick = async (e) => { e.stopPropagation(); closeMenu(); const full = await loadRow(); if (full) showNotebookDownloadModal(full); };
  menu.appendChild(download);

  const ask = document.createElement("button");
  ask.type = "button";
  ask.className = "exam-action-btn";
  ask.innerHTML = `${SPARKLE_ICON_SVG}<span>اسأل الباشـمبصمج</span>`;
  ask.onclick = async (e) => { e.stopPropagation(); closeMenu(); const full = await loadRow(); if (full) void askAboutNotebook(full, { platform }); };
  menu.appendChild(ask);
}

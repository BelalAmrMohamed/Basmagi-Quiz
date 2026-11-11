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
import { bindInfoCopyButtons } from "../../shared/info-link.js";
import { buildCreatorSectionHtml, fetchCreatorById, fetchCreatorName, fetchNotebookDetails, fetchNotebookViewCount, fetchItemLocation } from "./info-details.js";
import { buildInfoBodyHtml, buildInfoDialogHtml, infoPill, INFO_ICONS } from "../../components/quiz-info-modal/quiz-info-html.js";
import { buildInfoModel } from "../../components/quiz-info-modal/info-model.js";
import { buildExportCard, buildSourceActions } from "../../components/download-quiz-modal/export-card.js";
import {
  rowToNotebook, collectNotebookInfo, notebookToIpynb, notebookToMScript, notebookToCppScript, notebookToJson, notebookToHtml, safeFileName,
} from "../../shared/notebook-export.js";

const LANG_LABEL = { en: "الإنجليزية (من اليسار لليمين)", ar: "العربية (من اليمين لليسار)" };
const RUNTIME_LABEL = { matlab: "MATLAB", cpp: "C++" };

function notebookCoreHtml(info, url) {
  const pills = [infoPill(INFO_ICONS.cells, `${info.cellCount} خلية`, "عدد الخلايا")];
  const model = buildInfoModel("notebook", {
    id: info.id,
    title: info.title,
    description: info.description,
    eduType: info.eduType,
    college: info.college,
    year: info.year,
    term: info.term,
    course: info.courseName,
    folders: info.folderNames,
    local: info.local,
    createdAt: info.createdAt,
    updatedAt: info.updatedAt,
    source: info.source,
    link: url || null,
    linkLabel: "رابط الدفتر",
    engagementCount: typeof info.viewCount === "number" ? info.viewCount : (info.local ? undefined : null),
    engagementLabel: "مشاهدة لهذا الدفتر",
    pills,
    specificTitle: "محتوى الدفتر",
    specific: [
      ["نص (Markdown)", String(info.markdownCount)],
      ["كود", `${info.codeCount} (${info.codeLines} سطر)`],
      ["بيئة التشغيل", RUNTIME_LABEL[info.runtime] || info.runtime],
      ["لغة الدفتر", LANG_LABEL[info.language] || info.language],
    ],
  });
  const creatorHtml = info.creator ? buildCreatorSectionHtml(info.creator) : "";
  return buildInfoBodyHtml(model, { creatorHtml, creatorSlot: Boolean(info.createdBy) && !info.creator && !info.creatorDone });
}

/** Loads the async facts (classification, course/folder, views, creator) and re-renders the core. */
function hydrateNotebookInfo(core, info, url) {
  const rerender = () => {
    if (!core.isConnected) return;
    core.innerHTML = notebookCoreHtml(info, url);
    bindInfoCopyButtons(core);
  };
  const tasks = [];
  if (!info.local && info.id) {
    tasks.push(fetchNotebookDetails(info.id).then(async (d) => {
      if (!d) return;
      info.eduType = info.eduType || d.education_type || null;
      info.college = info.college || d.college || null;
      info.year = info.year ?? d.year ?? null;
      info.term = info.term ?? d.term ?? null;
      info.createdAt = info.createdAt || d.created_at || null;
      info.updatedAt = info.updatedAt || d.updated_at || null;
      info.createdBy = info.createdBy || d.created_by || null;
      info.courseId = info.courseId || d.course_id || null;
      info.folderId = info.folderId || d.folder_id || null;
      if (info.courseId || info.folderId) {
        const loc = await fetchItemLocation(info.courseId, info.folderId);
        info.courseName = loc.course;
        info.folderNames = loc.folders;
      }
    }));
    tasks.push(fetchNotebookViewCount(info.id).then((count) => { if (typeof count === "number") info.viewCount = count; }));
  }
  Promise.allSettled(tasks)
    .then(() => (info.createdBy
      ? fetchCreatorById(info.createdBy).then((creator) => { info.creator = creator; }).catch(() => {})
      : null))
    .finally(() => { info.creatorDone = true; rerender(); });
}

export function showNotebookInfoModal(row) {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const info = collectNotebookInfo(row);
  const url = info.local ? "" : `${window.location.origin}/notebook/${encodeURIComponent(info.slug || info.id)}`;
  const dialog = document.createElement("dialog");
  dialog.className = "quiz-info-dialog lesson-info-dialog";
  dialog.setAttribute("aria-labelledby", "notebookInfoDialogTitle");
  dialog.innerHTML = buildInfoDialogHtml("معلومات الدفتر", `<div data-info-core>${notebookCoreHtml(info, url)}</div>`, { titleId: "notebookInfoDialogTitle" });
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
  hydrateNotebookInfo(dialog.querySelector("[data-info-core]"), info, url);
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

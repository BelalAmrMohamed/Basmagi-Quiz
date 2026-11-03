// Shared notebook card actions for BOTH local (امتحاناتك) and platform notebooks:
//   • «معلومات الدفتر»  info dialog (same shell as the lesson info dialog)
//   • downloads: .ipynb (Jupyter), .m (MATLAB script), HTML, print / save as PDF
//   • «اسأل الباشـمبصمج»  attaches the whole notebook (as reading material) to the AI agent
// The info/download logic lives in shared/notebook-export.js (pure, unit-tested).
import { escapeHtml } from "./escape-html.js";
import { createExamInfoSubmenu, createActionGroupSubmenu } from "./exam-dropdown-menu.js";
import { SPARKLE_ICON_SVG, DOWNLOAD_ICON_SVG } from "./icons.js";
import { formatDateForInfo } from "../../components/quiz-info-modal/quiz-info-html.js";
import { renderMarkdown } from "../../shared/markdown.js";
import { showNotification } from "../../components/notifications/notifications.js";
import {
  rowToNotebook, collectNotebookInfo, notebookToIpynb, notebookToMScript, notebookToHtml, safeFileName,
} from "../../shared/notebook-export.js";

const LANG_LABEL = { en: "الإنجليزية (من اليسار لليمين)", ar: "العربية (من اليمين لليسار)" };
const RUNTIME_LABEL = { matlab: "MATLAB (مفسّر تعليمي داخل المتصفح)" };

function infoBodyHtml(info, url) {
  const rows = [];
  const add = (label, valueHtml) => rows.push(`<div class="quiz-meta-label">${escapeHtml(label)}</div><div class="quiz-meta-value">${valueHtml}</div>`);
  const link = (u) => (/^https?:\/\//i.test(u) ? `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" dir="ltr">${escapeHtml(u)}</a>` : `<span dir="ltr">${escapeHtml(u)}</span>`);
  add("نص (Markdown)", escapeHtml(String(info.markdownCount)));
  add("كود", escapeHtml(`${info.codeCount} (${info.codeLines} سطر)`));
  add("بيئة التشغيل", escapeHtml(RUNTIME_LABEL[info.runtime] || info.runtime));
  add("لغة الدفتر", escapeHtml(LANG_LABEL[info.language] || info.language));
  if (info.description) add("الوصف", escapeHtml(info.description));
  if (info.source) add("المصدر", link(info.source));
  if (url) add("رابط الدفتر", link(url));
  add("مكان الحفظ", info.local ? "على جهازك فقط (امتحاناتك)" : "منصة بصمجي (مشترك)");
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
    </div>`;
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
  try {
    if (kind === "ipynb") saveBlob(`${base}.ipynb`, new Blob([JSON.stringify(notebookToIpynb(nb), null, 1)], { type: "application/x-ipynb+json" }));
    else if (kind === "m") saveBlob(`${base}.m`, new Blob([notebookToMScript(nb).replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" }));
    else if (kind === "html") saveBlob(`${base}.html`, new Blob([htmlOf(nb)], { type: "text/html;charset=utf-8" }));
    else if (kind === "pdf") printNotebook(nb);
    else throw new Error(`unknown format ${kind}`);
  } catch (error) {
    console.error("[notebook-actions] download failed:", error);
    showNotification("تعذّر التنزيل", "حدث خطأ أثناء تجهيز الملف. حاول مرة أخرى.", "error");
  }
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

export const DOWNLOAD_FORMATS = [
  { kind: "ipynb", label: "Jupyter Notebook (.ipynb)" },
  { kind: "m", label: "سكريبت MATLAB (.m)" },
  { kind: "html", label: "صفحة HTML (.html)" },
  { kind: "pdf", label: "PDF (طباعة / حفظ كـ PDF)" },
];

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
 * Appends «معلومات الدفتر», «تنزيل» (formats submenu) and «اسأل الباشـمبصمج» to a card's ⋮ menu.
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
    ...(platform ? [] : [{ label: "كود / نص", val: `${info.codeCount} / ${info.markdownCount}` }, { label: "اللغة", val: info.language === "ar" ? "العربية" : "English" }]),
  ].filter((r) => r.val || r.val === 0);
  menu.appendChild(createExamInfoSubmenu(basicRows, async () => { const full = await loadRow(); if (full) showNotebookInfoModal(full); }, closeMenu, reposition, "معلومات الدفتر"));

  menu.appendChild(createActionGroupSubmenu(
    DOWNLOAD_FORMATS.map(({ kind, label }) => ({ label, icon: DOWNLOAD_ICON_SVG, onClick: async () => { const full = await loadRow(); if (full) downloadNotebook(full, kind); } })),
    closeMenu, reposition, "تنزيل",
  ));

  const ask = document.createElement("button");
  ask.type = "button";
  ask.className = "exam-action-btn";
  ask.innerHTML = `${SPARKLE_ICON_SVG}<span>اسأل الباشـمبصمج</span>`;
  ask.onclick = async (e) => { e.stopPropagation(); closeMenu(); const full = await loadRow(); if (full) void askAboutNotebook(full, { platform }); };
  menu.appendChild(ask);
}

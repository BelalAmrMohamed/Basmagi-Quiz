// =============================================================================
// public/src/features/home/adminUpload.js
// Admin quiz upload workflow - 4-step modal.
//
// Steps:
//   1. Track & Position  - Education Type -> College (conditional) -> Year/Term
//   2. Course & Placement - Subject (filtered by step 1) -> Subfolder
//   3. Admin Info         - Editable display name + full review of the upload
//   4. Confirmation       - Upload progress, then success links to the quiz(zes)
//
// Placement (course + subfolder) applies once per batch, not per-quiz — see
// docs/other/admin-upload-wizard-overhaul.md §Step 2 for rationale.
//
// Tracks supported:
//   University    - College -> Year -> Term -> Subject
//   High          - Year -> Term -> Subject
//   Middle        - Year -> Term -> Subject
//   Primary       - Year -> Term -> Subject
//   Featured      - Subject only (no College, no Year/Term)
//
// Modes:
//   Single quiz   - opened via createUploadButton(quiz) or openUploadModal(quiz)
//   Batch quizzes - opened via openAdminUploadModal(quizzes[]) from bulk action bar
// =============================================================================

import { getToken, isAdminAuthenticated, signOut } from "../../shared/adminAuth.js";
import { showNotification } from "../../components/notifications/notifications.js";
import { userProfile } from "../../shared/userProfile.js";
import { generateQuizId } from "../../shared/quizId.js";
import { getManifest } from "../../shared/quizManifest.js";
import { extractFolderSegmentsFromQuizPath } from "../../shared/quizPath.js";
import { UPLOAD_ICON_SVG } from "./icons.js";

// ─── Track definitions ────────────────────────────────────────────────────────
const TRACK_LABELS = {
  University: "جامعي",
  High:       "ثانوي",
  Middle:     "إعدادي",
  Primary:    "ابتدائي",
  Featured:   "كورسات مميزة",
};

// University requires a College; school tracks do not.
const TRACKS_WITH_COLLEGE  = new Set(["University"]);
// Featured Courses have no Year/Term; all others do.
const TRACKS_WITH_YEARTERM = new Set(["University", "High", "Middle", "Primary"]);

// ─── Manifest tree ────────────────────────────────────────────────────────────
// University: { University: { [college]: { [subject]: { yearterm, subfolders } } } }
// School:     { High|Middle|Primary: { [subject]: { yearterm, subfolders } } }
// Featured:   { Featured: { [subject]: { subfolders } } }
let MANIFEST_TREE = {};

function buildManifestTree(subjects) {
  const tree = {};
  for (const subject of subjects) {
    const type    = subject.education_type;
    const college = subject.faculty;
    const name    = subject.name;
    const year    = subject.year  != null ? String(subject.year)  : null;
    const term    = subject.term  != null ? String(subject.term)  : null;
    if (!type || !name) continue;
    if (!tree[type]) tree[type] = {};

    if (type === "University") {
      if (!college) continue;
      if (!tree[type][college]) tree[type][college] = {};
      const entry = tree[type][college][name] || { yearterm: [], subfolders: [] };
      if (year && term && !entry.yearterm.some(([y, t]) => y === year && t === term))
        entry.yearterm.push([year, term]);
      tree[type][college][name] = entry;
      _extractSubfolders(subject.quizzes ?? [], entry);
    } else {
      const entry = tree[type][name] || { yearterm: [], subfolders: [] };
      if (year && term && !entry.yearterm.some(([y, t]) => y === year && t === term))
        entry.yearterm.push([year, term]);
      tree[type][name] = entry;
      _extractSubfolders(subject.quizzes ?? [], entry);
    }
  }
  return tree;
}

function _extractSubfolders(quizzes, entry) {
  const seen = new Set(entry.subfolders);
  for (const quiz of quizzes) {
    try {
      const { folderSegments } = extractFolderSegmentsFromQuizPath(quiz.path);
      if (folderSegments && folderSegments.length > 0) {
        const sf = folderSegments.join("/");
        if (!seen.has(sf)) { seen.add(sf); entry.subfolders.push(sf); }
      }
    } catch (_) {}
  }
}

// ─── Labels ───────────────────────────────────────────────────────────────────
const YEAR_LABELS = {
  1: "السنة الأولى",
  2: "السنة الثانية",
  3: "السنة الثالثة",
  4: "السنة الرابعة",
  5: "السنة الخامسة",
  6: "السنة السادسة",
};
const TERM_LABELS = {
  1: "الترم الأول",
  2: "الترم الثاني",
  3: "الترم الثالث",
};

function yearLabel(y) { return YEAR_LABELS[y] || (y ? `سنة ${y}` : ""); }
function termLabel(t) { return TERM_LABELS[t] || (t ? `ترم ${t}` : ""); }

// ─── Persist last-used selections ─────────────────────────────────────────────
const LS_KEY = "admin_upload_last";
function getSaved()      { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; } }
function persistSaved(v) { try { localStorage.setItem(LS_KEY, JSON.stringify({ ...getSaved(), ...v })); } catch {} }

// ─── Styles ───────────────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById("adm-upload-styles")) return;
  const s = document.createElement("style");
  s.id = "adm-upload-styles";
  s.textContent = `
    .adm-overlay {
      position:fixed; inset:0; background:rgba(0,0,0,.65); backdrop-filter:blur(4px);
      display:flex; justify-content:center; align-items:center; z-index:2000; padding:20px;
      animation:admFadeIn .2s ease;
    }
    @keyframes admFadeIn  { from{opacity:0} to{opacity:1} }
    @keyframes admSlideUp { from{transform:translateY(26px);opacity:0} to{transform:translateY(0);opacity:1} }
    .adm-card {
      background:var(--color-surface); border:1px solid var(--color-border);
      border-radius:18px; width:100%; max-width:540px; max-height:92vh;
      overflow-y:auto; box-shadow:var(--shadow-xl);
      animation:admSlideUp .3s ease; scrollbar-width:thin;
    }
    .adm-header {
      display:flex; align-items:center; justify-content:space-between; padding:18px 22px 12px;
      border-bottom:1px solid var(--color-border);
      position:sticky; top:0; background:var(--color-surface); z-index:1;
      border-radius:18px 18px 0 0;
    }
    .adm-header h2 { margin:0; font-size:1.05rem; font-weight:700; color:var(--color-text-primary); display:flex; align-items:center; gap:7px; }
    .adm-close {
      width:30px; height:30px; border-radius:50%;
      border:1px solid var(--color-border); background:var(--color-background-secondary);
      color:var(--color-text); font-size:1rem; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      transition:transform .2s,background .2s;
    }
    .adm-close:hover { transform:rotate(90deg); background:var(--color-error-light); color:var(--color-error); }

    .adm-steps { display:flex; align-items:center; padding:12px 22px 0; }
    .adm-step  { display:flex; flex-direction:column; align-items:center; gap:3px; flex:1; }
    .adm-step-circle {
      width:28px; height:28px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font-size:.8rem; font-weight:700; border:2px solid transparent;
      background:var(--color-border); color:var(--color-text-tertiary); transition:all .25s;
    }
    .adm-step.active .adm-step-circle { background:var(--color-primary); color:#fff; border-color:var(--color-primary); box-shadow:0 0 0 4px var(--color-primary-light); }
    .adm-step.done   .adm-step-circle { background:var(--color-success); color:#fff; border-color:var(--color-success); }
    .adm-step-lbl { font-size:.66rem; font-weight:600; color:var(--color-text-tertiary); }
    .adm-step.active .adm-step-lbl { color:var(--color-primary); }
    .adm-step-line { flex:1; height:2px; background:var(--color-border); align-self:center; margin-bottom:16px; transition:background .25s; }
    .adm-step-line.done { background:var(--color-success); }

    .adm-body { padding:16px 22px 22px; }
    .adm-hint { font-size:.85rem; color:var(--color-text-secondary); text-align:center; margin:0 0 16px; }
    .adm-hint-warn { font-size:.78rem; color:var(--color-error); text-align:center; margin:-8px 0 14px; }

    .adm-field { margin-bottom:13px; }
    .adm-field label { display:flex; align-items:center; gap:6px; font-size:.8rem; font-weight:700; color:var(--color-text-secondary); margin-bottom:5px; }
    .adm-field label .adm-badge { font-size:.65rem; padding:1px 6px; border-radius:8px; font-weight:700; }
    .adm-badge-fixed   { background:#fef3c7; color:#92400e; }
    .adm-badge-auto    { background:#dbeafe; color:#1e40af; }
    .adm-badge-choose  { background:#f0fdf4; color:#166534; }
    .adm-badge-opt     { background:var(--color-border); color:var(--color-text-tertiary); }

    .adm-field select, .adm-field input[type="text"] {
      width:100%; padding:9px 12px; border:1.5px solid var(--color-border); border-radius:9px;
      font-size:.92rem; background:var(--color-background); color:var(--color-text-primary);
      font-family:inherit; transition:border-color .2s; box-sizing:border-box;
    }
    .adm-field select:focus, .adm-field input[type="text"]:focus {
      border-color:var(--color-primary); outline:none; box-shadow:0 0 0 3px var(--color-primary-light);
    }
    .adm-field select:disabled { opacity:.5; cursor:not-allowed; background:var(--color-background-secondary); }

    .adm-row2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .adm-path-chip {
      background:var(--color-primary-light); color:var(--color-primary);
      padding:5px 12px; border-radius:8px; font-size:.78rem; font-weight:700;
      direction:ltr; word-break:break-all; display:block; margin-bottom:13px; text-align:center;
    }

    .adm-preview { background:var(--color-background-secondary); border:1.5px solid var(--color-border); border-radius:11px; padding:12px; margin-bottom:13px; }
    .adm-preview-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--color-border); font-size:.86rem; }
    .adm-preview-row:last-child { border-bottom:none; }
    .adm-preview-lbl { color:var(--color-text-secondary); font-weight:600; }
    .adm-preview-val { color:var(--color-text-primary); font-weight:700; direction:ltr; text-align:left; max-width:58%; word-break:break-all; }

    .adm-batch-list { list-style:none; margin:0 0 13px; padding:0; }
    .adm-batch-item {
      display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:8px;
      font-size:.84rem; background:var(--color-background-secondary);
      margin-bottom:6px; border:1px solid var(--color-border);
    }
    .adm-batch-item-title { font-weight:600; color:var(--color-text-primary); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .adm-batch-item-count { font-size:.75rem; color:var(--color-text-tertiary); white-space:nowrap; }

    .adm-progress-list { list-style:none; margin:0 0 16px; padding:0; }
    .adm-progress-item {
      display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:8px;
      font-size:.85rem; margin-bottom:6px; border:1px solid var(--color-border);
      background:var(--color-background-secondary); transition:background .3s, border-color .3s;
    }
    .adm-progress-item.uploading { border-color:var(--color-primary); background:var(--color-primary-light); }
    .adm-progress-item.done      { border-color:var(--color-success); background:var(--color-success-light); color: var(--color-text-primary); }
    .adm-progress-item.error     { border-color:var(--color-error); background:var(--color-error-light); }
    .adm-progress-item.skipped   { border-color:var(--color-border); background:var(--color-background-secondary); opacity:.6; }
    .adm-progress-icon { font-size:1rem; flex-shrink:0; min-width:20px; text-align:center; }
    .adm-progress-name { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; }
    .adm-progress-msg  { font-size:.75rem; color:var(--color-text-tertiary); }

    .adm-btns { display:flex; gap:9px; margin-top:16px; }
    .adm-btn { flex:1; padding:10px 14px; border:none; border-radius:9px; font-size:.92rem; font-weight:700; cursor:pointer; transition:transform .2s,box-shadow .2s; font-family:inherit; }
    .adm-btn:hover:not(:disabled) { transform:translateY(-2px); box-shadow:var(--shadow-md); }
    .adm-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }
    .adm-btn-primary { background:var(--gradient-accent); color:#fff; }
    .adm-btn-ghost   { background:var(--color-background-secondary); border:1.5px solid var(--color-border); color:var(--color-text); }

    .adm-spinner { display:inline-block; width:15px; height:15px; border:2px solid rgba(255,255,255,.35); border-top-color:#fff; border-radius:50%; animation:admSpin .7s linear infinite; margin-left:6px; }
    @keyframes admSpin { to{transform:rotate(360deg)} }

    .adm-success { text-align:center; padding:18px 0 8px; }
    .adm-success-icon { font-size:3rem; margin-bottom:9px; }
    .adm-success h3 { font-size:1.1rem; color:var(--color-text-primary); margin:0 0 5px; }
    .adm-success p  { color:var(--color-text-secondary); font-size:.86rem; margin:3px 0; }
    .adm-success code { background:var(--color-background-secondary); padding:1px 6px; border-radius:4px; font-size:.78rem; }

    .adm-loading { text-align:center; padding:40px 22px; color:var(--color-text-secondary); font-size:.92rem; }
    .adm-loading .adm-spinner { border-top-color:var(--color-primary); border-color:var(--color-border); margin:0 auto 12px; display:block; width:24px; height:24px; }
  `;
  document.head.appendChild(s);
}

// ─── Module state ─────────────────────────────────────────────────────────────
let _quiz    = null;  // compat ref - always _quizzes[0]
let _quizzes = [];    // quizzes being uploaded in this session
let _overlay = null;
// "single" (default): one quiz or a same-placement batch, via the existing
// 4-step wizard (Track -> Course & Placement -> Admin Info -> Upload).
// "folder": an entire local folder/course tree, via openFolderUploadModal
// below — reuses Step 1 (Track) unchanged, then skips the per-quiz
// Course & Placement step (the tree itself already carries course/folder
// names) in favor of a tree-review step, then uploads via
// POST /api/upload-quiz with { mode: "folder", items: [...] }.
let _mode = "single";
let _folderTree = null; // { rootName, items: [...] } set by openFolderUploadModal

// ─── Small DOM helpers ─────────────────────────────────────────────────────────
function mkOption(value, text, selected = false) {
  return Object.assign(document.createElement("option"), { value, textContent: text, selected });
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function authHeaders() {
  const token = getToken();
  if (!token) { signOut(); throw new Error("انتهت الجلسة. يرجى تسجيل الدخول مجددًا."); }
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function isSessionError(err) {
  return !!(err?.message && (err.message.includes("جلسة") || err.message.includes("مصرح")));
}

async function postUpload(payload) {
  const res = await fetch("/api/upload-quiz", {
    method: "POST", headers: authHeaders(), body: JSON.stringify(payload),
  });
  let body = {};
  try { body = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(body.error || "فشل الرفع");
  return body;
}

// ─── Modal scaffold ───────────────────────────────────────────────────────────
function makeOverlay() {
  const el = document.createElement("div");
  el.className = "adm-overlay";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.addEventListener("click", (e) => { if (e.target === el) closeModal(); });
  return el;
}

function stepsHTML(cur) {
  const steps = _mode === "folder" ? ["المسار", "المراجعة", "الرفع"] : ["المسار", "المادة", "المشرف", "رفع"];
  return `<div class="adm-steps">${steps.map((lbl, i) => {
    const n = i + 1, cls = n < cur ? "done" : n === cur ? "active" : "";
    return `${i > 0 ? `<div class="adm-step-line ${n <= cur ? "done" : ""}"></div>` : ""}
      <div class="adm-step ${cls}">
        <div class="adm-step-circle">${n < cur ? "✓" : n}</div>
        <span class="adm-step-lbl">${lbl}</span>
      </div>`;
  }).join("")}</div>`;
}

function hdr(title) {
  return `<div class="adm-header">
    <h2>☁️ ${title}</h2>
    <button class="adm-close" onclick="window.__admClose()">✕</button>
  </div>`;
}

// ─── Step 1: Track & Position ──────────────────────────────────────────────────
function renderStep1(saved = {}) {
  const lastSaved = { ...getSaved(), ...saved };
  const selType   = lastSaved.educationType || "University";
  const hasColl   = TRACKS_WITH_COLLEGE.has(selType);
  const hasYT     = TRACKS_WITH_YEARTERM.has(selType);
  const colleges  = selType === "University" ? Object.keys(MANIFEST_TREE["University"] || {}).sort() : [];
  const collegeOpts = colleges.map(c =>
    `<option value="${c}" ${lastSaved.college === c ? "selected" : ""}>${c}</option>`).join("");

  _overlay.innerHTML = `<div class="adm-card">
    ${hdr("رفع إلى قاعدة البيانات")}
    ${stepsHTML(1)}
    <div class="adm-body">
      <p class="adm-hint">حدّد نوع المسار وموقع الاختبار في مكتبة المنصة</p>

      <div class="adm-field">
        <label for="adm-edu-type">نوع المسار التعليمي <span class="adm-badge adm-badge-fixed">مطلوب</span></label>
        <select id="adm-edu-type">
          ${Object.entries(TRACK_LABELS).map(([k,v]) => `<option value="${k}" ${k === selType ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>

      <div class="adm-field" id="adm-college-wrap" style="${hasColl ? "" : "display:none;"}">
        <label for="adm-college">الكلية / القسم <span class="adm-badge adm-badge-fixed">ثابت</span></label>
        <select id="adm-college"><option value="">— اختر الكلية —</option>${collegeOpts}</select>
      </div>

      <div id="adm-yearterm-wrap" style="${hasYT ? "" : "display:none;"}">
        <div class="adm-row2">
          <div class="adm-field">
            <label for="adm-year">السنة الدراسية <span class="adm-badge adm-badge-choose">اختر</span></label>
            <select id="adm-year" ${hasColl && !lastSaved.college ? "disabled" : ""}><option value="">— اختر السنة —</option></select>
          </div>
          <div class="adm-field">
            <label for="adm-term">الترم <span class="adm-badge adm-badge-choose">اختر</span></label>
            <select id="adm-term" ${hasColl && !lastSaved.college ? "disabled" : ""}><option value="">— اختر الترم —</option></select>
          </div>
        </div>
      </div>

      <div class="adm-btns">
        <button class="adm-btn adm-btn-ghost" onclick="window.__admClose()">إلغاء</button>
        <button class="adm-btn adm-btn-primary" id="adm-s1-next">التالي ←</button>
      </div>
    </div>
  </div>`;

  window.__admClose = closeModal;

  const eduEl  = document.getElementById("adm-edu-type");
  const colEl  = document.getElementById("adm-college");
  const yearEl = document.getElementById("adm-year");
  const termEl = document.getElementById("adm-term");

  const getType    = () => eduEl.value;
  const getCollege = () => colEl.value?.trim() || "";

  // Keeps year/term select disabled state in sync with visibility + college
  // requirement, regardless of how many times the track is switched back
  // and forth. Called on every relevant change so state never goes stale.
  function syncYearTermDisabledState(type, college) {
    const hasYTNow = TRACKS_WITH_YEARTERM.has(type);
    const needsCollegeFirst = TRACKS_WITH_COLLEGE.has(type) && !college;
    const shouldDisable = !hasYTNow || needsCollegeFirst;
    yearEl.disabled = shouldDisable;
    termEl.disabled = shouldDisable;
  }

  function applyTrackVisibility(type) {
    document.getElementById("adm-college-wrap").style.display  = TRACKS_WITH_COLLEGE.has(type) ? "" : "none";
    document.getElementById("adm-yearterm-wrap").style.display = TRACKS_WITH_YEARTERM.has(type) ? "" : "none";
  }

  function triggerYearTermPopulate(type, college, sv) {
    syncYearTermDisabledState(type, college);
    if (!TRACKS_WITH_YEARTERM.has(type)) return;
    if (type !== "University" || college) {
      populateYearOptions(type, college, yearEl, sv.year || "");
      populateTermOptions(type, college, sv.year || "", termEl, sv.term || "");
    } else {
      yearEl.innerHTML = `<option value="">— اختر الكلية أولاً —</option>`;
      termEl.innerHTML = `<option value="">— اختر الكلية أولاً —</option>`;
    }
  }

  // Initial state
  applyTrackVisibility(selType);
  triggerYearTermPopulate(selType, lastSaved.college || "", lastSaved);

  eduEl.addEventListener("change", () => {
    const type = getType();
    applyTrackVisibility(type);
    triggerYearTermPopulate(type, "", {});
  });

  colEl.addEventListener("change", () => {
    triggerYearTermPopulate(getType(), getCollege(), {});
  });

  yearEl.addEventListener("change", () => {
    const previousTerm = termEl.value;
    populateTermOptions(getType(), getCollege(), yearEl.value, termEl, previousTerm);
    // If the previously-selected term is no longer valid for this year,
    // populateTermOptions won't have marked it selected — tell the admin
    // instead of silently discarding their choice.
    if (previousTerm && termEl.value !== previousTerm) {
      showNotification("الترم المحدد سابقًا غير متاح لهذه السنة، الرجاء اختيار ترم جديد", "warning");
    }
  });

  document.getElementById("adm-s1-next").addEventListener("click", step1Validate);
}

// ─── Manifest helpers ─────────────────────────────────────────────────────────
function getSubjectMap(type, college) {
  return type === "University"
    ? (MANIFEST_TREE["University"]?.[college] || {})
    : (MANIFEST_TREE[type] || {});
}

/**
 * Populates the Step 2 subject dropdown with EXISTING subjects/courses
 * only. This wizard no longer offers "➕ إنشاء مادة جديدة" (create a new
 * subject/course) — creating a course here was the legacy path the
 * admin-facing courses/folders feature has since replaced with course
 * creation directly from userQuizzesView (see "المادة / الكورس" in
 * renderStep2's own doc comment below for the full reasoning). A subject
 * with no matching courses at all now shows a clear "no matching course"
 * state (see renderStep2) rather than silently defaulting into course
 * creation.
 */
function populateSubjects(type, college, year, term, subEl, folEl, saved) {
  subEl.disabled = false;
  subEl.innerHTML = `<option value="">— اختر المادة —</option>`;
  folEl.innerHTML = `<option value="">— بدون مجلد فرعي —</option>`;
  folEl.disabled = false;
  document.getElementById("adm-new-subfolder-wrap").style.display = "none";

  const hasYT = TRACKS_WITH_YEARTERM.has(type);
  const subjectMap = getSubjectMap(type, college);
  const subjects = Object.entries(subjectMap)
    .filter(([, data]) => {
      if (!hasYT || (!year && !term)) return true;
      return (data.yearterm || []).some(([y, t]) =>
        (!year || y === year) && (!term || t === term));
    })
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));

  subjects.forEach(s => subEl.appendChild(mkOption(s, s, saved.subject === s)));

  const noSubjectsEl = document.getElementById("adm-no-subjects-hint");
  if (noSubjectsEl) noSubjectsEl.style.display = subjects.length === 0 ? "block" : "none";
  subEl.disabled = subjects.length === 0;

  if (saved.subject && subjects.includes(saved.subject)) {
    populateSubfolders(type, college, saved.subject, folEl, saved);
  }
}

function populateYearOptions(type, college, yearEl, selectedYear = "") {
  const yearsSet = new Set();
  for (const data of Object.values(getSubjectMap(type, college)))
    for (const [y] of data.yearterm || []) yearsSet.add(y);
  if (yearsSet.size === 0) [1,2,3,4,5,6].forEach(n => yearsSet.add(String(n)));
  const years = [...yearsSet].sort();
  yearEl.innerHTML = `<option value="">— اختر السنة —</option>`;
  years.forEach(y => yearEl.appendChild(mkOption(y, yearLabel(y), y === selectedYear)));
}

function populateTermOptions(type, college, year, termEl, selectedTerm = "") {
  const termsSet = new Set();
  for (const data of Object.values(getSubjectMap(type, college)))
    for (const [y, t] of data.yearterm || [])
      if (!year || y === year) termsSet.add(t);
  if (termsSet.size === 0) [1, 2].forEach(n => termsSet.add(String(n)));
  const terms = [...termsSet].sort();
  termEl.innerHTML = `<option value="">— اختر الترم —</option>`;
  terms.forEach(t => termEl.appendChild(mkOption(t, termLabel(t), t === selectedTerm)));
}

function populateSubfolders(type, college, subject, folEl, saved) {
  folEl.innerHTML = `<option value="">— بدون مجلد فرعي —</option>`;
  document.getElementById("adm-new-subfolder-wrap").style.display = "none";
  if (!subject) {
    return;
  }
  const info = getSubjectMap(type, college)[subject];
  const subs = info?.subfolders || [];
  subs.forEach(sf => folEl.appendChild(mkOption(sf, sf, saved.subfolder === sf)));
  folEl.appendChild(mkOption("__new__", "➕ إنشاء مجلد فرعي جديد", saved.subfolder === "__new__"));
  if (saved.subfolder === "__new__")
    document.getElementById("adm-new-subfolder-wrap").style.display = "block";
}

// ─── Read Step 1 values ───────────────────────────────────────────────────────
function getStep1Values() {
  const educationType = document.getElementById("adm-edu-type")?.value || "University";
  const college = document.getElementById("adm-college")?.value?.trim() || "";
  const year    = document.getElementById("adm-year")?.value || "";
  const term    = document.getElementById("adm-term")?.value || "";
  return { educationType, college, year, term };
}

async function step1Validate() {
  const vals = getStep1Values();
  const { educationType, college, year, term } = vals;
  if (!educationType)                                       { showNotification("الرجاء اختيار نوع المسار", "error"); return; }
  if (TRACKS_WITH_COLLEGE.has(educationType) && !college)  { showNotification("الرجاء اختيار الكلية", "error"); return; }
  if (TRACKS_WITH_YEARTERM.has(educationType) && !year)    { showNotification("الرجاء اختيار السنة الدراسية", "error"); return; }
  if (TRACKS_WITH_YEARTERM.has(educationType) && !term)    { showNotification("الرجاء اختيار الترم", "error"); return; }
  persistSaved({ educationType, college, year, term });
  if (_mode === "folder") {
    await renderFolderReviewStep(vals);
    return;
  }
  await renderStep2(vals);
}

// ─── Step 2: Course & Placement ────────────────────────────────────────────────
async function renderStep2({ educationType, college, year, term }) {
  const saved   = getSaved();

  _overlay.innerHTML = `<div class="adm-card">
    ${hdr("رفع إلى قاعدة البيانات")}
    ${stepsHTML(2)}
    <div class="adm-body">
      <p class="adm-hint">اختر المادة ومكان الاختبار داخلها</p>

      <div class="adm-field">
        <label for="adm-subject">المادة / الكورس</label>
        <select id="adm-subject">
          <option value="">— اختر المادة —</option>
        </select>
      </div>
      <p class="adm-hint" id="adm-no-subjects-hint" style="display:none;">
        لا توجد مادة مطابقة هنا بعد. المواد والمجلدات تُنشأ الآن من صفحة
        إمتحاناتك مباشرة — أنشئ المادة هناك أولاً ثم عد لرفع الاختبار داخلها.
      </p>

      <div class="adm-field">
        <label for="adm-subfolder">مجلد فرعي <span class="adm-badge adm-badge-opt">اختياري</span></label>
        <select id="adm-subfolder" disabled><option value="">— بدون مجلد فرعي —</option></select>
      </div>
      <div class="adm-field" id="adm-new-subfolder-wrap" style="display:none;">
        <label for="adm-new-subfolder">اسم المجلد الفرعي الجديد</label>
        <input type="text" id="adm-new-subfolder" placeholder="مثال: أسئلة الدكتور" maxlength="80" value="${saved.newSubfolder || ""}" />
      </div>

      ${_quizzes.length > 1 ? `<p class="adm-hint" style="margin-top:2px;">سيتم رفع ${_quizzes.length} اختبارات إلى نفس المادة/المجلد المحدد هنا.</p>` : ""}

      <div class="adm-btns">
        <button class="adm-btn adm-btn-ghost" id="adm-s2-back">→ رجوع</button>
        <button class="adm-btn adm-btn-primary" id="adm-s2-next">التالي ←</button>
      </div>
    </div>
  </div>`;

  window.__admClose = closeModal;

  const subEl        = document.getElementById("adm-subject");
  const folEl        = document.getElementById("adm-subfolder");
  const newSubfolEl   = document.getElementById("adm-new-subfolder");

  populateSubjects(educationType, college, year, term, subEl, folEl, saved);

  subEl.addEventListener("change", () => {
    // Preserve the previously-saved subfolder choice when re-selecting the
    // same subject the user already had picked; only reset for a genuinely
    // different subject.
    const carrySaved = subEl.value === saved.subject ? saved : {};
    populateSubfolders(educationType, college, subEl.value, folEl, carrySaved);
  });

  folEl.addEventListener("change", () => {
    document.getElementById("adm-new-subfolder-wrap").style.display =
      folEl.value === "__new__" ? "block" : "none";
  });

  // Persist free-text typing live so Back/Next navigation never loses it,
  // even if the user never clicks "Next" from this exact state.
  newSubfolEl?.addEventListener("input", () => persistSaved({ newSubfolder: newSubfolEl.value }));

  document.getElementById("adm-s2-back").addEventListener("click", () => {
    renderStep1({ educationType, college, year, term });
  });
  document.getElementById("adm-s2-next").addEventListener("click", () => step2Validate({ educationType, college, year, term }));
}

// ─── Read Step 2 values ───────────────────────────────────────────────────────
// Strips characters that are unsafe in a storage path segment: forward and
// backward slashes, and leading/trailing whitespace. Returns "" if nothing
// meaningful remains.
function sanitizePathSegment(raw) {
  if (!raw) return "";
  return raw.trim().replace(/[\\/]+/g, "-").replace(/^-+|-+$/g, "").trim();
}

function getStep2Values() {
  // Subject is always picked from the existing-subjects dropdown now — see
  // populateSubjects's own doc comment for why the "➕ إنشاء مادة جديدة"
  // free-text path was removed.
  const subject = (document.getElementById("adm-subject")?.value || "").trim();

  const folRaw   = document.getElementById("adm-subfolder")?.value;
  let subfolder = "";
  let subfolderWasSanitized = false;
  if (folRaw === "__new__") {
    const raw = document.getElementById("adm-new-subfolder")?.value || "";
    subfolder = sanitizePathSegment(raw);
    subfolderWasSanitized = raw.trim() !== "" && raw.trim() !== subfolder;
  } else {
    subfolder = (folRaw || "").trim();
  }

  return { subject, subfolder, subfolderWasSanitized };
}

function step2Validate(step1Vals) {
  const { subject, subfolder, subfolderWasSanitized } = getStep2Values();
  if (!subject) { showNotification("الرجاء اختيار المادة", "error"); return; }
  if (subfolderWasSanitized) {
    showNotification("تم إزالة رموز غير مسموح بها من الاسم المدخل", "warning");
  }
  persistSaved({ subject, subfolder, newSubfolder: "" });
  renderStep3({ ...step1Vals, subject, subfolder });
}

// ─── Step 3: Admin Info & Review ───────────────────────────────────────────────
function renderStep3({ educationType, college, year, term, subject, subfolder }) {
  const saved    = getSaved();
  const isBatch  = _quizzes.length > 1;
  const trackLbl = TRACK_LABELS[educationType] || educationType;
  const yLbl     = yearLabel(year);
  const tLbl     = termLabel(term);

  const pathParts = [];
  if (TRACKS_WITH_COLLEGE.has(educationType) && college) pathParts.push(college);
  if (TRACKS_WITH_YEARTERM.has(educationType) && year)   pathParts.push(yLbl, tLbl);
  pathParts.push(subject);
  if (subfolder) pathParts.push(subfolder);
  const locationLabel = pathParts.join(" / ");

  let listHTML = "";
  if (isBatch) {
    listHTML = `<ul class="adm-batch-list">${_quizzes.map(q => {
      const t = q.meta?.title || q.title || "بدون عنوان";
      const c = q.stats?.questionCount ?? q.questions?.length ?? 0;
      return `<li class="adm-batch-item"><span class="adm-batch-item-count">${c} سؤال</span><span class="adm-batch-item-title">${t}</span></li>`;
    }).join("")}</ul>`;
  } else {
    const q  = _quizzes[0];
    const qT = q?.meta?.title || q?.title || "";
    const qC = q?.stats?.questionCount ?? q?.questions?.length ?? 0;
    listHTML = `
      <div class="adm-preview-row"><span class="adm-preview-lbl">عنوان الاختبار</span><span class="adm-preview-val">${qT}</span></div>
      <div class="adm-preview-row"><span class="adm-preview-lbl">عدد الأسئلة</span><span class="adm-preview-val">${qC} سؤال</span></div>`;
  }

  _overlay.innerHTML = `<div class="adm-card">
    ${hdr("بيانات المشرف")}
    ${stepsHTML(3)}
    <div class="adm-body">
      <p class="adm-hint">راجع بيانات ${isBatch ? "الرفعة" : "الاختبار"} واسم المشرف الذي سيظهر عليه</p>

      <span class="adm-path-chip">${locationLabel}</span>

      <div class="adm-preview">
        <div class="adm-preview-row"><span class="adm-preview-lbl">نوع المسار</span><span class="adm-preview-val">${trackLbl}</span></div>
        ${college ? `<div class="adm-preview-row"><span class="adm-preview-lbl">الكلية</span><span class="adm-preview-val">${college}</span></div>` : ""}
        <div class="adm-preview-row"><span class="adm-preview-lbl">المادة</span><span class="adm-preview-val">${subject}</span></div>
        ${year ? `<div class="adm-preview-row"><span class="adm-preview-lbl">السنة</span><span class="adm-preview-val">${yLbl}</span></div>` : ""}
        ${term ? `<div class="adm-preview-row"><span class="adm-preview-lbl">الترم</span><span class="adm-preview-val">${tLbl}</span></div>` : ""}
        ${subfolder ? `<div class="adm-preview-row"><span class="adm-preview-lbl">المجلد الفرعي</span><span class="adm-preview-val">${subfolder}</span></div>` : ""}
        ${listHTML}
      </div>

      <div class="adm-btns">
        <button class="adm-btn adm-btn-ghost" id="adm-s3-back">→ رجوع</button>
        <button class="adm-btn adm-btn-primary" id="adm-s3-upload">
          ${isBatch ? `رفع ${_quizzes.length} اختبارات ☁️` : "رفع الاختبار ☁️"}
        </button>
      </div>
    </div>
  </div>`;

  window.__admClose = closeModal;
  document.getElementById("adm-s3-back").addEventListener("click", () => {
    renderStep2({ educationType, college, year, term });
  });
  document.getElementById("adm-s3-upload").addEventListener("click", () => {
    doUpload({ educationType, college, subject, year, term, subfolder });
  });
}

// ─── Folder mode: Review step (replaces Step 2 for tree uploads) ────────────
// Shows a flat, indented preview of the parsed folder tree (course →
// folders → quizzes) so the admin can confirm what's about to be created
// before it's written — a bulk, hard-to-undo action, same reasoning as the
// local userQuizzes folder-tree import's confirmation summary.
function renderFolderReviewStep(step1Vals) {
  const { items, rootName } = _folderTree;
  const courseItem = items.find((i) => i.type === "course");
  const folderCount = items.filter((i) => i.type === "folder").length + (courseItem ? 1 : 0);
  const quizCount = items.filter((i) => i.type === "quiz").length;

  function renderNode(depth, folderSegmentsKey) {
    return items
      .filter((i) => (i.type === "folder" || i.type === "quiz") && (i.folderSegments || []).join("/") === folderSegmentsKey)
      .map((i) => {
        const label = i.type === "folder" ? `📁 ${i.name}` : `📝 ${i.quiz?.meta?.title || i.name || "اختبار"}`;
        const childKey = i.type === "folder" ? [...(i.folderSegments || []), i.name].join("/") : null;
        const children = i.type === "folder" ? renderNode(depth + 1, childKey) : "";
        return `<li style="padding-inline-start:${depth * 18}px;">${label}</li>${children}`;
      })
      .join("");
  }

  const treeHtml = `
    <li>${courseItem ? "📚" : "📁"} ${courseItem ? courseItem.name : rootName} ${courseItem ? "" : '<span class="adm-badge adm-badge-opt">مادة موجودة</span>'}</li>
    ${renderNode(1, courseItem ? "" : "")}
  `;

  _overlay.innerHTML = `<div class="adm-card">
    ${hdr("رفع مجلد إلى قاعدة البيانات")}
    ${stepsHTML(2)}
    <div class="adm-body">
      <p class="adm-hint">راجع البنية قبل الرفع — سيتم إنشاء ${folderCount} مجلد/مادة ورفع ${quizCount} اختبار</p>
      <ul class="adm-batch-list" style="max-height:280px;overflow-y:auto;">${treeHtml}</ul>
      <div class="adm-btns">
        <button class="adm-btn adm-btn-ghost" id="adm-folder-back">→ رجوع</button>
        <button class="adm-btn adm-btn-primary" id="adm-folder-next">رفع ☁️</button>
      </div>
    </div>
  </div>`;

  window.__admClose = closeModal;
  document.getElementById("adm-folder-back").addEventListener("click", () => renderStep1(step1Vals));
  document.getElementById("adm-folder-next").addEventListener("click", () => doFolderUpload(step1Vals));
}

// ─── Folder mode: Upload step (replaces Steps 3+4 for tree uploads) ─────────
async function doFolderUpload({ educationType, college, year, term }) {
  const { items } = _folderTree;

  _overlay.innerHTML = `<div class="adm-card">
    ${hdr("رفع مجلد إلى قاعدة البيانات")}
    ${stepsHTML(3)}
    <div class="adm-body">
      <p class="adm-hint" id="adm-folder-hint"><span class="adm-spinner" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-inline-end:6px;"></span>جارٍ رفع المجلد…</p>
      <div id="adm-folder-result"></div>
      <div class="adm-btns" id="adm-folder-btns" style="display:none;">
        <button class="adm-btn adm-btn-primary" onclick="window.__admClose()">إغلاق</button>
      </div>
    </div>
  </div>`;
  window.__admClose = closeModal;

  let result;
  try {
    result = await postUpload({
      mode: "folder",
      education_type: educationType,
      college: TRACKS_WITH_COLLEGE.has(educationType) ? college || undefined : undefined,
      year: TRACKS_WITH_YEARTERM.has(educationType) ? year || undefined : undefined,
      term: TRACKS_WITH_YEARTERM.has(educationType) ? term || undefined : undefined,
      items,
    });
  } catch (err) {
    const hintEl = document.getElementById("adm-folder-hint");
    if (hintEl) { hintEl.textContent = `❌ ${err.message}`; hintEl.style.color = "var(--color-error)"; }
    document.getElementById("adm-folder-btns").style.display = "flex";
    if (isSessionError(err)) {
      setTimeout(() => { signOut(); window.location.href = "/#my-quizzes"; }, 2500);
    }
    return;
  }

  const hintEl = document.getElementById("adm-folder-hint");
  const resultEl = document.getElementById("adm-folder-result");
  const { foldersCreated, quizzesUploaded, failed } = result;

  if (hintEl) {
    if (failed.length === 0) {
      hintEl.textContent = `✅ تم إنشاء ${foldersCreated} مجلد/مادة ورفع ${quizzesUploaded} اختبار بنجاح!`;
      hintEl.style.color = "var(--color-success)";
      showNotification("تم الرفع بنجاح ✅", "success");
    } else {
      hintEl.textContent = `تم رفع ${quizzesUploaded} • فشل ${failed.length}`;
      hintEl.style.color = quizzesUploaded > 0 ? "var(--color-text-secondary)" : "var(--color-error)";
      if (quizzesUploaded > 0) showNotification(`تم رفع ${quizzesUploaded} اختبار (فشل ${failed.length})`, "warning");
    }
  }

  if (resultEl && failed.length > 0) {
    resultEl.innerHTML = `<ul class="adm-batch-list">${failed
      .map((f) => `<li class="adm-batch-item">❌ ${f.name}: ${f.reason}</li>`)
      .join("")}</ul>`;
  }

  document.getElementById("adm-folder-btns").style.display = "flex";
}

// ─── Step 4: Upload with progress checklist + confirmation links ──────────────
// Quiz links point at /q/{quizId} using the routable quiz content id
// (quiz.meta.id) returned by the API — the same id the manifest/router use
// elsewhere (see api/quiz-manifest.js), NOT the Supabase row id.
function quizLinkHref(quizId) {
  return window.location.origin + "/q/" + encodeURIComponent(quizId);
}

async function doUpload({ educationType, college, subject, year, term, subfolder }) {
  const isBatch = _quizzes.length > 1;
  const items   = _quizzes.map((q, i) => ({
    quiz:  q,
    id:    `adm-prog-${i}`,
    title: q.meta?.title || q.title || `اختبار ${i + 1}`,
  }));

  _overlay.innerHTML = `<div class="adm-card">
    ${hdr(isBatch ? `رفع ${_quizzes.length} اختبارات` : "رفع الاختبار")}
    ${stepsHTML(4)}
    <div class="adm-body">
      <p class="adm-hint" id="adm-s4-hint">جارٍ رفع الاختبارات…</p>
      <ul class="adm-progress-list">
        ${items.map(item => `<li class="adm-progress-item" id="${item.id}">
          <span class="adm-progress-icon">⏳</span>
          <span class="adm-progress-name">${item.title}</span>
        </li>`).join("")}
      </ul>
      <div id="adm-s4-links"></div>
      <div class="adm-btns" id="adm-s4-btns" style="display:none;">
        <button class="adm-btn adm-btn-primary" onclick="window.__admClose()">إغلاق</button>
      </div>
    </div>
  </div>`;
  window.__admClose = closeModal;

  function setItemState(item, state, msg) {
    const li = document.getElementById(item.id);
    if (!li) return;
    const iconEl = li.querySelector(".adm-progress-icon");
    let msgEl    = li.querySelector(".adm-progress-msg");
    li.className = `adm-progress-item ${state}`;
    if (state === "uploading") {
      iconEl.innerHTML = `<span class="adm-spinner" style="border-top-color:var(--color-primary);border-color:var(--color-border);width:14px;height:14px;margin:0;"></span>`;
      if (!msgEl) { msgEl = document.createElement("span"); msgEl.className = "adm-progress-msg"; li.appendChild(msgEl); }
      msgEl.textContent = "جارٍ الرفع…";
    } else if (state === "done") {
      iconEl.textContent = "✅";
      if (msgEl) msgEl.remove();
    } else if (state === "error") {
      iconEl.textContent = "❌";
      if (!msgEl) { msgEl = document.createElement("span"); msgEl.className = "adm-progress-msg"; li.appendChild(msgEl); }
      msgEl.textContent = msg || "فشل";
    } else if (state === "skipped") {
      iconEl.textContent = "⏭️";
      if (!msgEl) { msgEl = document.createElement("span"); msgEl.className = "adm-progress-msg"; li.appendChild(msgEl); }
      msgEl.textContent = msg || "لم يتم المحاولة";
    }
  }

  let successCount = 0, errorCount = 0;
  const successLinks = []; // { title, quizId }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    setItemState(item, "uploading");
    try {
      const result = await postUpload({
        education_type: educationType,
        college:   TRACKS_WITH_COLLEGE.has(educationType)  ? college || undefined : undefined,
        year:      TRACKS_WITH_YEARTERM.has(educationType) ? year    || undefined : undefined,
        term:      TRACKS_WITH_YEARTERM.has(educationType) ? term    || undefined : undefined,
        subject,
        subfolder: subfolder || undefined,
        quiz: item.quiz,
      });
      setItemState(item, "done");
      successCount++;
      if (result?.quizId) successLinks.push({ title: item.title, quizId: result.quizId });
    } catch (err) {
      setItemState(item, "error", err.message || "فشل");
      errorCount++;
      if (isSessionError(err)) {
        // Mark every remaining, not-yet-attempted item as skipped so the UI
        // never looks "stuck" at the spinner — the admin can see clearly
        // that the rest of the batch was aborted, not silently lost.
        for (let j = i + 1; j < items.length; j++) {
          setItemState(items[j], "skipped", "تم الإلغاء بسبب انتهاء الجلسة");
        }
        const hintEl = document.getElementById("adm-s4-hint");
        if (hintEl) {
          hintEl.textContent = `⚠️ تم إلغاء الرفع: انتهت الجلسة. تم رفع ${successCount} فقط من أصل ${items.length}.`;
          hintEl.style.color = "var(--color-error)";
        }
        showNotification(err.message, "error");
        setTimeout(() => { signOut(); window.location.href = "/#my-quizzes"; }, 2500);
        return;
      }
    }
  }

  const hintEl = document.getElementById("adm-s4-hint");
  if (hintEl) {
    if (errorCount === 0) {
      hintEl.textContent = `✅ تم رفع ${successCount} اختبار بنجاح!`;
      hintEl.style.color = "var(--color-success)";
      showNotification(`تم الرفع بنجاح ✅ (${successCount} اختبار)`, "success");
    } else {
      hintEl.textContent = `تم رفع ${successCount} • فشل ${errorCount}`;
      hintEl.style.color = successCount > 0 ? "var(--color-text-secondary)" : "var(--color-error)";
      if (successCount > 0) showNotification(`تم ${successCount} اختبار (فشل ${errorCount})`, "warning");
    }
  }

  const linksEl = document.getElementById("adm-s4-links");
  if (linksEl && successLinks.length > 0) {
    renderConfirmationLinks(linksEl, successLinks);
  }

  const btnsEl = document.getElementById("adm-s4-btns");
  if (btnsEl) btnsEl.style.display = "flex";
}

// Copies a link to the clipboard. Prefers the modern clipboard API; when it's
// unavailable or fails (non-secure context, permissions, older browsers),
// shows the URL to the admin instead of relying on the deprecated
// document.execCommand("copy") fallback.
function copyLinkToClipboard(url) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url)
      .then(() => showNotification("تم النسخ بنجاح", "success"))
      .catch(() => showNotification(`تعذّر النسخ تلقائيًا، انسخ الرابط يدويًا: ${url}`, "warning"));
  } else {
    showNotification(`تعذّر النسخ تلقائيًا، انسخ الرابط يدويًا: ${url}`, "warning");
  }
}

// Builds the confirmation-links UI without ever inlining title/url text into
// onclick="" attribute strings — event listeners are wired up via
// addEventListener with values read from dataset, so link titles containing
// quotes or other special characters can't break out of an attribute.
function renderConfirmationLinks(container, links) {
  container.innerHTML = "";

  const note = document.createElement("p");
  note.className = "adm-hint";
  note.style.margin = "10px 0 6px";
  note.textContent = "⏱️ يستغرق ظهور الاختبار على المنصة حوالي 60 ثانية بعد الرفع.";
  container.appendChild(note);

  if (links.length === 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "adm-path-chip adm-copy-btn";
    btn.style.cssText = "border:none;cursor:pointer;width:100%;display:flex;align-items:center;justify-content:center;gap:6px;font-family:inherit;font-size:.85rem;";
    btn.dataset.url = quizLinkHref(links[0].quizId);
    btn.innerHTML = `<span>نسخ رابط الاختبار: ${links[0].title}</span><span style="font-size:1.1rem;" title="نسخ الرابط">📋</span>`;
    btn.addEventListener("click", () => copyLinkToClipboard(btn.dataset.url));
    container.appendChild(btn);
    return;
  }

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "adm-btn adm-btn-ghost";
  toggleBtn.style.cssText = "width:100%;margin-bottom:8px;";
  toggleBtn.textContent = `عرض الروابط (${links.length}) ▼`;
  container.appendChild(toggleBtn);

  const list = document.createElement("ul");
  list.className = "adm-batch-list";
  list.style.display = "none";
  links.forEach(l => {
    const li = document.createElement("li");
    li.className = "adm-batch-item adm-copy-btn";
    li.style.cssText = "cursor:pointer;display:flex;align-items:center;gap:8px;transition:background .2s;";
    li.dataset.url = quizLinkHref(l.quizId);
    li.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;">${l.title}</span><span style="font-size:1.1rem;color:var(--color-primary);" title="نسخ الرابط">📋</span>`;
    li.addEventListener("click", () => copyLinkToClipboard(li.dataset.url));
    li.addEventListener("mouseover", () => { li.style.background = "var(--color-primary-light)"; });
    li.addEventListener("mouseout",  () => { li.style.background = "var(--color-background-secondary)"; });
    list.appendChild(li);
  });
  container.appendChild(list);

  toggleBtn.addEventListener("click", () => {
    const collapsed = list.style.display === "none";
    list.style.display = collapsed ? "block" : "none";
    toggleBtn.textContent = collapsed ? "إخفاء الروابط ▲" : `عرض الروابط (${links.length}) ▼`;
  });
}

// ─── Schema normalizer ────────────────────────────────────────────────────────
function normalizeQuizSchema(quiz) {
  const rawQuestions = quiz.questions || [];
  const questions = rawQuestions.map((q) => {
    if (Array.isArray(q.options) && q.options.length === 1) {
      const { options, correct, ...rest } = q;
      return { ...rest, answer: options[0] ?? "" };
    }
    return q;
  });
  const types = new Set();
  questions.forEach((q) => {
    if (!Array.isArray(q.options) || q.options.length === 0) types.add("Essay");
    else if (q.options.length === 2) types.add("True/False");
    else types.add("MCQ");
  });
  const meta = { title: (quiz.meta?.title || quiz.title || "").trim() };
  const src = quiz.meta?.createdAt || quiz.createdAt;
  if (src) meta.createdAt = src;
  const desc = quiz.meta?.description || quiz.description;
  if (desc?.trim()) meta.description = desc.trim();
  const source = quiz.meta?.source;
  if (source?.trim()) meta.source = source.trim();
  const author =
    quiz.meta?.author ||
    (quiz.author && quiz.author !== "User Created" && quiz.author !== "Imported" ? quiz.author : null);
  if (author?.trim()) meta.author = author.trim();
  const authorEmail = quiz.meta?.author_email;
  if (authorEmail?.trim()) meta.author_email = authorEmail.trim();
  if (quiz.meta?.password?.trim()) meta.password = quiz.meta.password.trim();
  if (quiz.meta?.view) meta.view = quiz.meta.view;
  if (quiz.meta?.mode) meta.mode = quiz.meta.mode;
  return {
    meta,
    stats: { questionCount: questions.length, questionTypes: Array.from(types).sort() },
    questions,
  };
}

// ─── Modal lifecycle ──────────────────────────────────────────────────────────
async function _openWizard(quizzes) {
  if (_overlay) return; // Prevent multiple modal instances
  if (!isAdminAuthenticated()) {
    showNotification("يجب تسجيل الدخول كمشرف أولاً", "error");
    setTimeout(() => { window.location.href = "/#my-quizzes"; }, 1500);
    return;
  }

  // Defense in depth: this wizard is quiz-only (see renderStep3's
  // "عنوان الاختبار"/"رفع الاختبار" labels, and normalizeQuizSchema
  // below) — it has no course/folder concept, so an item with
  // meta.type "course"/"folder" ending up in here always means some
  // caller's selection wasn't filtered (the intended filtering happens
  // once, at the selection boundary — see splitUploadableSelection in
  // user-quizzes-view.js for the bulk-upload button's own filtering).
  // Re-checking here means a future caller that forgets that filtering
  // step fails loudly instead of silently mislabeling a course as
  // "اختبار" in the Admin Info step — the exact bug this was reported
  // as. Courses are created from userQuizzesView directly now (see the
  // "legacy" note on the old create-course-via-upload path), not
  // through this wizard, so there is no in-wizard way to fix this up —
  // the caller must not have included them to begin with.
  const nonQuizItems = quizzes.filter((q) => q?.meta?.type === "course" || q?.meta?.type === "folder");
  if (nonQuizItems.length > 0) {
    showNotification(
      "لا يمكن رفع مادة أو مجلد هنا",
      "هذه النافذة مخصصة لرفع الاختبارات فقط. المواد والمجلدات تُنشأ من صفحة إمتحاناتك مباشرة.",
      "error",
    );
    return;
  }

  injectStyles();

  try {
    _mode = "single";
    _folderTree = null;
    _quizzes = quizzes.map(normalizeQuizSchema);
    _quiz    = _quizzes[0] || null;
    _overlay = makeOverlay();
    document.body.appendChild(_overlay);
    document.body.style.overflow = "hidden";

    _overlay.innerHTML = `<div class="adm-card">
      ${hdr("رفع إلى قاعدة البيانات")}
      <div class="adm-loading"><span class="adm-spinner"></span> جارٍ تحميل بيانات المنصة…</div>
    </div>`;
    window.__admClose = closeModal;

    try {
      const { subjects } = await getManifest();
      MANIFEST_TREE = buildManifestTree(subjects);
    } catch (err) {
      console.error("[adminUpload] Failed to load manifest:", err);
      MANIFEST_TREE = {};
      showNotification("تعذّر تحميل بيانات المنصة، تحقق من اتصالك", "error");
    }

    const saved = getSaved();
    if (!saved.college) {
      try {
        const p = userProfile.getProfile();
        if (p?.faculty && MANIFEST_TREE["University"]?.[p.faculty]) {
          saved.college = p.faculty;
          if (!saved.educationType) saved.educationType = "University";
        }
      } catch (_) {}
    }
    renderStep1(saved);
  } catch (err) {
    // Whatever failed — manifest parsing, a render step throwing on bad
    // data, etc. — never leave the module wedged with a non-null _overlay
    // and no visible modal, since that would silently block every future
    // attempt to open the wizard (the `if (_overlay) return;` guard above).
    console.error("[adminUpload] Failed to open upload wizard:", err);
    showNotification("حدث خطأ أثناء فتح نافذة الرفع، حاول مرة أخرى", "error");
    if (_overlay) { _overlay.remove(); }
    _overlay = null;
    _quiz = null; _quizzes = [];
    document.body.style.overflow = "";
  }
}

async function openModal(quiz)               { await _openWizard([quiz]); }
async function openAdminUploadModal(quizzes) { await _openWizard(Array.isArray(quizzes) ? quizzes : [quizzes]); }

/**
 * Entry point for the "رفع مجلد" admin action — uploads an entire local
 * folder/course tree to the remote DB in one wizard flow, instead of the
 * single-quiz/same-placement-batch flow _openWizard drives.
 *
 * @param {{rootName: string, items: Array}} folderTree - same shape
 *   api/upload-quiz.js's folder mode expects for `items`; see
 *   user-quizzes-folders.js's buildFolderUploadTree() for how it's built
 *   from a directory picker's File list.
 */
export async function openFolderUploadModal(folderTree) {
  if (_overlay) return;
  if (!isAdminAuthenticated()) {
    showNotification("يجب تسجيل الدخول كمشرف أولاً", "error");
    setTimeout(() => { window.location.href = "/#my-quizzes"; }, 1500);
    return;
  }
  if (!folderTree || !Array.isArray(folderTree.items) || folderTree.items.length === 0) {
    showNotification("لا توجد عناصر لرفعها", "warning");
    return;
  }
  injectStyles();

  try {
    _mode = "folder";
    _folderTree = folderTree;
    _quizzes = [];
    _quiz = null;
    _overlay = makeOverlay();
    document.body.appendChild(_overlay);
    document.body.style.overflow = "hidden";

    _overlay.innerHTML = `<div class="adm-card">
      ${hdr("رفع مجلد إلى قاعدة البيانات")}
      <div class="adm-loading"><span class="adm-spinner"></span> جارٍ تحميل بيانات المنصة…</div>
    </div>`;
    window.__admClose = closeModal;

    try {
      const { subjects } = await getManifest();
      MANIFEST_TREE = buildManifestTree(subjects);
    } catch (err) {
      console.error("[adminUpload] Failed to load manifest:", err);
      MANIFEST_TREE = {};
      showNotification("تعذّر تحميل بيانات المنصة، تحقق من اتصالك", "error");
    }

    renderStep1(getSaved());
  } catch (err) {
    console.error("[adminUpload] Failed to open folder upload wizard:", err);
    showNotification("حدث خطأ أثناء فتح نافذة الرفع، حاول مرة أخرى", "error");
    if (_overlay) { _overlay.remove(); }
    _overlay = null;
    _folderTree = null;
    _mode = "single";
    document.body.style.overflow = "";
  }
}

function closeModal() {
  if (_overlay) { _overlay.remove(); _overlay = null; }
  document.body.style.overflow = "";
  _quiz = null; _quizzes = [];
  _folderTree = null;
  _mode = "single";
}

// ─── Public exports ───────────────────────────────────────────────────────────
// Renders as a standard .exam-action-btn — same shape/size/DOM structure as
// the other options in the card's ⋮ dropdown (Edit/Delete/Download), so it
// no longer needs its own bespoke CSS. Lives inside the dropdown menu on
// ALL screen sizes (see showUserQuizActionsOverlay in user-quiz-card.js) —
// there is no separate top-left placement anymore.
export function createUploadButton(quiz) {
  injectStyles();
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "exam-action-btn";
  btn.setAttribute("aria-label", `رفع "${quiz.title}" إلى قاعدة البيانات`);
  btn.innerHTML = `${UPLOAD_ICON_SVG}<span>رفع لقاعدة البيانات</span>`;
  btn.addEventListener("click", (e) => { e.stopPropagation(); openModal(quiz); });
  return btn;
}

export { openModal as openUploadModal, openAdminUploadModal };
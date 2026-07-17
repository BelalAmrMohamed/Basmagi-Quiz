// =============================================================================
// public/src/scripts/adminUpload.js
// Admin quiz upload workflow - 3-step modal.
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

import { getToken, isAdminAuthenticated, signOut } from "./adminAuth.js";
import { showNotification } from "../components/notifications.js";
import { userProfile } from "./userProfile.js";
import { generateQuizId } from "./quizId.js";
import { getManifest } from "./quizManifest.js";
import { extractFolderSegmentsFromQuizPath } from "../shared/quizPath.js";

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

// ─── Persist last-used selections ─────────────────────────────────────────────
const LS_KEY = "admin_upload_last";
function getSaved()      { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; } }
function persistSaved(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch {} }

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
    .adm-step.done   .adm-step-circle { background:#22c55e; color:#fff; border-color:#22c55e; }
    .adm-step-lbl { font-size:.66rem; font-weight:600; color:var(--color-text-tertiary); }
    .adm-step.active .adm-step-lbl { color:var(--color-primary); }
    .adm-step-line { flex:1; height:2px; background:var(--color-border); align-self:center; margin-bottom:16px; transition:background .25s; }
    .adm-step-line.done { background:#22c55e; }

    .adm-body { padding:16px 22px 22px; }
    .adm-hint { font-size:.85rem; color:var(--color-text-secondary); text-align:center; margin:0 0 16px; }

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
    .adm-progress-item.done      { border-color:#22c55e; background:#f0fdf4; color: var(--color-text-primary); }
    .adm-progress-item.error     { border-color:var(--color-error); background:var(--color-error-light); }
    .adm-progress-icon { font-size:1rem; flex-shrink:0; min-width:20px; text-align:center; }
    .adm-progress-name { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; }
    .adm-progress-msg  { font-size:.75rem; color:var(--color-text-tertiary); }

    .adm-btns { display:flex; gap:9px; margin-top:16px; }
    .adm-btn { flex:1; padding:10px 14px; border:none; border-radius:9px; font-size:.92rem; font-weight:700; cursor:pointer; transition:transform .2s,box-shadow .2s; font-family:inherit; }
    .adm-btn:hover:not(:disabled) { transform:translateY(-2px); box-shadow:var(--shadow-md); }
    .adm-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }
    .adm-btn-primary { background:var(--gradient-accent); color:#fff; }
    .adm-btn-ghost   { background:var(--color-background-secondary); border:1.5px solid var(--color-border); color:var(--color-text); }

    .upload-to-db-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 5px 10px;
      background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: .75rem;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(124, 58, 237, .2);
      transition: all .2s cubic-bezier(.4, 0, .2, 1);
      gap: 0;
    }

    .upload-to-db-btn svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    .upload-to-db-btn span {
      max-width: 0;
      overflow: hidden;
      opacity: 0;
      transition: all .2s cubic-bezier(.4, 0, .2, 1);
    }

    .upload-to-db-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(124, 58, 237, .4);
      gap: 5px;
    }

    .upload-to-db-btn:hover span {
      max-width: 200px;
      opacity: 1;
    }

    @media (max-width: 640px) {
      .upload-to-db-btn {
        width: auto;
        margin: 0 auto;
        padding: 5px 10px;
        gap: 5px;
        transition: none;
      }

      .upload-to-db-btn span {
        max-width: none;
        opacity: 1;
      }

      .upload-to-db-btn:hover,
      .upload-to-db-btn:focus-visible {
        transform: none;
        box-shadow: 0 2px 6px rgba(124, 58, 237, .2);
      }
    }
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

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function authHeaders() {
  const token = getToken();
  if (!token) { signOut(); throw new Error("انتهت الجلسة. يرجى تسجيل الدخول مجددًا."); }
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
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
  const steps = ["المسار", "مراجعة", "رفع"];
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

// ─── Step 1 ───────────────────────────────────────────────────────────────────
function renderStep1(saved = {}) {
  const lastSaved = { ...getSaved(), ...saved };
  const selType   = lastSaved.educationType || "University";
  const hasColl   = TRACKS_WITH_COLLEGE.has(selType);
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

      <div class="adm-field">
        <label for="adm-subject">المادة / الكورس <span class="adm-badge adm-badge-choose">اختر أو أنشئ</span></label>
        <select id="adm-subject" ${hasColl && !lastSaved.college ? "disabled" : ""}>
          <option value="">— اختر ${hasColl ? "الكلية" : "المسار"} أولاً —</option>
        </select>
      </div>
      <div class="adm-field" id="adm-new-subject-wrap" style="display:none;">
        <label for="adm-new-subject">اسم المادة الجديدة</label>
        <input type="text" id="adm-new-subject" placeholder="مثال: Software Engineering" maxlength="80" value="${lastSaved.newSubject || ""}" />
      </div>

      <div id="adm-yearterm-wrap" style="display:none;">
        <div class="adm-row2">
          <div class="adm-field">
            <label for="adm-year">السنة الدراسية <span class="adm-badge adm-badge-choose">اختر</span></label>
            <select id="adm-year"><option value="">— اختر السنة —</option></select>
          </div>
          <div class="adm-field">
            <label for="adm-term">الترم <span class="adm-badge adm-badge-choose">اختر</span></label>
            <select id="adm-term"><option value="">— اختر الترم —</option></select>
          </div>
        </div>
      </div>

      <div class="adm-field">
        <label for="adm-subfolder">مجلد فرعي <span class="adm-badge adm-badge-opt">اختياري</span></label>
        <select id="adm-subfolder" disabled><option value="">— بدون مجلد فرعي —</option></select>
      </div>
      <div class="adm-field" id="adm-new-subfolder-wrap" style="display:none;">
        <label for="adm-new-subfolder">اسم المجلد الفرعي الجديد</label>
        <input type="text" id="adm-new-subfolder" placeholder="مثال: أسئلة الدكتور" maxlength="80" value="${lastSaved.newSubfolder || ""}" />
      </div>

      <div class="adm-field">
        <label for="adm-author">اسم المشرف صاحب الإمتحان <span class="adm-badge adm-badge-opt">اختياري</span></label>
        <input type="text" id="adm-author" placeholder="مثال: د. أحمد محمد" maxlength="100" value="${lastSaved.author || ""}" />
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
  const subEl  = document.getElementById("adm-subject");
  const folEl  = document.getElementById("adm-subfolder");
  const yearEl = document.getElementById("adm-year");
  const termEl = document.getElementById("adm-term");

  const getType    = () => eduEl.value;
  const getCollege = () => colEl.value?.trim() || "";

  function applyTrackVisibility(type) {
    document.getElementById("adm-college-wrap").style.display   = TRACKS_WITH_COLLEGE.has(type)  ? "" : "none";
    document.getElementById("adm-yearterm-wrap").style.display  = "none";
    document.getElementById("adm-new-subject-wrap").style.display = "none";
  }

  function triggerSubjectPopulate(type, college, sv) {
    if (type !== "University") {
      populateSubjects(type, "", subEl, folEl, yearEl, termEl, sv);
    } else if (college) {
      populateSubjects(type, college, subEl, folEl, yearEl, termEl, sv);
    } else {
      subEl.innerHTML = `<option value="">— اختر الكلية أولاً —</option>`;
      subEl.disabled = true;
      folEl.innerHTML = `<option value="">— بدون مجلد فرعي —</option>`;
      folEl.disabled = true;
    }
  }

  // Initial state
  applyTrackVisibility(selType);
  triggerSubjectPopulate(selType, lastSaved.college || "", lastSaved);

  eduEl.addEventListener("change", () => {
    const type = getType();
    applyTrackVisibility(type);
    triggerSubjectPopulate(type, "", {});
  });

  colEl.addEventListener("change", () => {
    const college = getCollege();
    if (college) {
      subEl.disabled = false;
      populateSubjects(getType(), college, subEl, folEl, yearEl, termEl, {});
    } else {
      subEl.innerHTML = `<option value="">— اختر الكلية أولاً —</option>`;
      subEl.disabled = true;
      folEl.innerHTML = `<option value="">— بدون مجلد فرعي —</option>`;
      folEl.disabled = true;
    }
  });

  subEl.addEventListener("change", () => {
    const type = getType(), college = getCollege();
    const isNew = subEl.value === "__new__";
    const hasYT = TRACKS_WITH_YEARTERM.has(type);
    const ytWrap = document.getElementById("adm-yearterm-wrap");
    document.getElementById("adm-new-subject-wrap").style.display = isNew ? "block" : "none";
    if (isNew && hasYT) {
      ytWrap.style.display = "block";
      populateYearOptions(type, college, yearEl);
      populateTermOptions(type, college, "", termEl);
      yearEl.value = ""; termEl.value = "";
      yearEl.disabled = false; termEl.disabled = false;
    } else if (!isNew && hasYT && subEl.value) {
      ytWrap.style.display = "none";
      autoFillYearTerm(type, college, subEl.value, yearEl, termEl);
    } else {
      ytWrap.style.display = "none";
    }
    populateSubfolders(type, college, subEl.value, folEl, {});
  });

  yearEl.addEventListener("change", () => {
    if (subEl.value !== "__new__") return;
    populateTermOptions(getType(), getCollege(), yearEl.value, termEl);
    termEl.value = "";
  });

  folEl.addEventListener("change", () => {
    document.getElementById("adm-new-subfolder-wrap").style.display =
      folEl.value === "__new__" ? "block" : "none";
  });

  document.getElementById("adm-s1-next").addEventListener("click", step1Validate);
}

// ─── Manifest helpers ─────────────────────────────────────────────────────────
function getSubjectMap(type, college) {
  return type === "University"
    ? (MANIFEST_TREE["University"]?.[college] || {})
    : (MANIFEST_TREE[type] || {});
}

function populateSubjects(type, college, subEl, folEl, yearEl, termEl, saved) {
  subEl.disabled = false;
  subEl.innerHTML = `<option value="">— اختر المادة —</option>`;
  folEl.innerHTML = `<option value="">— بدون مجلد فرعي —</option>`;
  folEl.disabled = false;
  document.getElementById("adm-new-subject-wrap").style.display = "none";
  document.getElementById("adm-new-subfolder-wrap").style.display = "none";

  const subjects = Object.keys(getSubjectMap(type, college)).sort((a, b) => a.localeCompare(b));
  subjects.forEach(s => subEl.appendChild(Object.assign(document.createElement("option"), {
    value: s, textContent: s, selected: saved.subject === s,
  })));
  subEl.appendChild(Object.assign(document.createElement("option"), {
    value: "__new__", textContent: "➕ إنشاء مادة جديدة",
    selected: saved.subject === "__new__",
  }));

  const hasYT  = TRACKS_WITH_YEARTERM.has(type);
  const ytWrap = document.getElementById("adm-yearterm-wrap");

  if (saved.subject && saved.subject !== "__new__") {
    if (hasYT) { ytWrap.style.display = "none"; autoFillYearTerm(type, college, saved.subject, yearEl, termEl); }
    populateSubfolders(type, college, saved.subject, folEl, saved);
  } else if (saved.subject === "__new__") {
    document.getElementById("adm-new-subject-wrap").style.display = "block";
    if (hasYT) {
      ytWrap.style.display = "block";
      populateYearOptions(type, college, yearEl, saved.year || "");
      populateTermOptions(type, college, saved.year || "", termEl, saved.term || "");
      yearEl.disabled = false; termEl.disabled = false;
    }
  }
}

function populateYearOptions(type, college, yearEl, selectedYear = "") {
  const yearsSet = new Set();
  for (const data of Object.values(getSubjectMap(type, college)))
    for (const [y] of data.yearterm || []) yearsSet.add(y);
  if (yearsSet.size === 0) [1,2,3,4,5,6].forEach(n => yearsSet.add(String(n)));
  const years = [...yearsSet].sort();
  yearEl.innerHTML = `<option value="">— اختر السنة —</option>`;
  years.forEach(y => yearEl.appendChild(Object.assign(document.createElement("option"), {
    value: y, textContent: YEAR_LABELS[y] || `سنة ${y}`, selected: y === selectedYear,
  })));
}

function populateTermOptions(type, college, year, termEl, selectedTerm = "") {
  const termsSet = new Set();
  for (const data of Object.values(getSubjectMap(type, college)))
    for (const [y, t] of data.yearterm || [])
      if (!year || y === year) termsSet.add(t);
  if (termsSet.size === 0) [1, 2].forEach(n => termsSet.add(String(n)));
  const terms = [...termsSet].sort();
  termEl.innerHTML = `<option value="">— اختر الترم —</option>`;
  terms.forEach(t => termEl.appendChild(Object.assign(document.createElement("option"), {
    value: t, textContent: TERM_LABELS[t] || `ترم ${t}`, selected: t === selectedTerm,
  })));
}

function autoFillYearTerm(type, college, subject, yearEl, termEl) {
  const info = getSubjectMap(type, college)[subject];
  if (!info || !info.yearterm || info.yearterm.length === 0) { yearEl.disabled = false; termEl.disabled = false; return; }
  const [year, term] = info.yearterm[0] || [];
  if (year) {
    if (!yearEl.querySelector(`option[value="${year}"]`))
      yearEl.appendChild(new Option(YEAR_LABELS[year] || `سنة ${year}`, year));
    yearEl.value = year; yearEl.disabled = true;
  } else { yearEl.disabled = false; }
  if (term) {
    if (!termEl.querySelector(`option[value="${term}"]`))
      termEl.appendChild(new Option(TERM_LABELS[term] || `ترم ${term}`, term));
    termEl.value = term; termEl.disabled = true;
  } else { termEl.disabled = false; }
}

function populateSubfolders(type, college, subject, folEl, saved) {
  folEl.innerHTML = `<option value="">— بدون مجلد فرعي —</option>`;
  document.getElementById("adm-new-subfolder-wrap").style.display = "none";
  if (!subject || subject === "__new__") {
    folEl.appendChild(Object.assign(document.createElement("option"), {
      value: "__new__", textContent: "➕ إنشاء مجلد فرعي جديد",
    }));
    return;
  }
  const info = getSubjectMap(type, college)[subject];
  const subs = info?.subfolders || [];
  subs.forEach(sf => folEl.appendChild(Object.assign(document.createElement("option"), {
    value: sf, textContent: sf, selected: saved.subfolder === sf,
  })));
  folEl.appendChild(Object.assign(document.createElement("option"), {
    value: "__new__", textContent: "➕ إنشاء مجلد فرعي جديد",
    selected: saved.subfolder === "__new__",
  }));
  if (saved.subfolder === "__new__")
    document.getElementById("adm-new-subfolder-wrap").style.display = "block";
}

// ─── Read Step 1 values ───────────────────────────────────────────────────────
function getStep1Values() {
  const educationType = document.getElementById("adm-edu-type")?.value || "University";
  const college  = document.getElementById("adm-college")?.value?.trim() || "";
  const subRaw   = document.getElementById("adm-subject")?.value;
  const subject  = subRaw === "__new__"
    ? document.getElementById("adm-new-subject")?.value?.trim()
    : subRaw?.trim();
  const year     = document.getElementById("adm-year")?.value || "";
  const term     = document.getElementById("adm-term")?.value || "";
  const folRaw   = document.getElementById("adm-subfolder")?.value;
  const subfolder = folRaw === "__new__"
    ? document.getElementById("adm-new-subfolder")?.value?.trim()
    : folRaw === "" ? "" : folRaw?.trim();
  const author   = document.getElementById("adm-author")?.value?.trim() || "";
  return { educationType, college, subject, year, term, subfolder, author };
}

async function step1Validate() {
  const vals = getStep1Values();
  const { educationType, college, subject, year, term } = vals;
  if (!educationType)                                         { showNotification("الرجاء اختيار نوع المسار", "error"); return; }
  if (TRACKS_WITH_COLLEGE.has(educationType) && !college)   { showNotification("الرجاء اختيار الكلية", "error"); return; }
  if (!subject)                                              { showNotification("الرجاء اختيار أو إدخال المادة", "error"); return; }
  if (TRACKS_WITH_YEARTERM.has(educationType) && !year)     { showNotification("الرجاء اختيار السنة الدراسية", "error"); return; }
  if (TRACKS_WITH_YEARTERM.has(educationType) && !term)     { showNotification("الرجاء اختيار الترم", "error"); return; }
  persistSaved({ educationType, college, subject, year, term, author: vals.author });
  await renderStep2(vals);
}

// ─── Step 2: Preview / Summary ────────────────────────────────────────────────
async function renderStep2({ educationType, college, subject, year, term, subfolder, author }) {
  const isBatch  = _quizzes.length > 1;
  const trackLbl = TRACK_LABELS[educationType] || educationType;
  const yearLbl  = YEAR_LABELS[year] || year;
  const termLbl  = TERM_LABELS[term] || term;

  const pathParts = [];
  if (TRACKS_WITH_COLLEGE.has(educationType) && college) pathParts.push(college);
  if (TRACKS_WITH_YEARTERM.has(educationType) && year)   pathParts.push(YEAR_LABELS[year] || `سنة ${year}`, TERM_LABELS[term] || `ترم ${term}`);
  pathParts.push(subject);
  if (subfolder) pathParts.push(subfolder);
  const locationLabel = pathParts.join(" / ");

  let contentHTML = "";
  if (isBatch) {
    contentHTML = `
      <p class="adm-hint" style="margin-bottom:8px;">سيتم رفع ${_quizzes.length} اختبارات إلى:</p>
      <span class="adm-path-chip">${locationLabel}</span>
      <ul class="adm-batch-list">${_quizzes.map(q => {
        const t = q.meta?.title || q.title || "بدون عنوان";
        const c = q.stats?.questionCount ?? q.questions?.length ?? 0;
        return `<li class="adm-batch-item"><span class="adm-batch-item-count">${c} سؤال</span><span class="adm-batch-item-title">${t}</span></li>`;
      }).join("")}</ul>`;
  } else {
    const q = _quizzes[0];
    const qT = q?.meta?.title || q?.title || "";
    const qC = q?.stats?.questionCount ?? q?.questions?.length ?? 0;
    contentHTML = `
      <span class="adm-path-chip">${locationLabel}</span>
      <div class="adm-preview">
        <div class="adm-preview-row"><span class="adm-preview-lbl">عنوان الاختبار</span><span class="adm-preview-val">${qT}</span></div>
        <div class="adm-preview-row"><span class="adm-preview-lbl">عدد الأسئلة</span><span class="adm-preview-val">${qC} سؤال</span></div>
        <div class="adm-preview-row"><span class="adm-preview-lbl">نوع المسار</span><span class="adm-preview-val">${trackLbl}</span></div>
        ${college ? `<div class="adm-preview-row"><span class="adm-preview-lbl">الكلية</span><span class="adm-preview-val">${college}</span></div>` : ""}
        <div class="adm-preview-row"><span class="adm-preview-lbl">المادة</span><span class="adm-preview-val">${subject}</span></div>
        ${year ? `<div class="adm-preview-row"><span class="adm-preview-lbl">السنة</span><span class="adm-preview-val">${yearLbl}</span></div>` : ""}
        ${term ? `<div class="adm-preview-row"><span class="adm-preview-lbl">الترم</span><span class="adm-preview-val">${termLbl}</span></div>` : ""}
        ${subfolder ? `<div class="adm-preview-row"><span class="adm-preview-lbl">المجلد الفرعي</span><span class="adm-preview-val">${subfolder}</span></div>` : ""}
        ${author ? `<div class="adm-preview-row"><span class="adm-preview-lbl">المشرف</span><span class="adm-preview-val">${author}</span></div>` : ""}
      </div>`;
  }

  _overlay.innerHTML = `<div class="adm-card">
    ${hdr("مراجعة الرفع")}
    ${stepsHTML(2)}
    <div class="adm-body">
      <p class="adm-hint">تحقق من التفاصيل قبل الرفع</p>
      ${contentHTML}
      <div class="adm-btns">
        <button class="adm-btn adm-btn-ghost" id="adm-s2-back">→ تعديل</button>
        <button class="adm-btn adm-btn-primary" id="adm-s2-upload">
          ${isBatch ? `رفع ${_quizzes.length} اختبارات ☁️` : "رفع الاختبار ☁️"}
        </button>
      </div>
    </div>
  </div>`;

  window.__admClose = closeModal;
  document.getElementById("adm-s2-back").addEventListener("click", () => {
    renderStep1({ educationType, college, subject, year, term, subfolder, author });
  });
  document.getElementById("adm-s2-upload").addEventListener("click", () => {
    doUpload({ educationType, college, subject, year, term, subfolder, author });
  });
}

// ─── Step 3: Upload with progress checklist ───────────────────────────────────
async function doUpload({ educationType, college, subject, year, term, subfolder, author }) {
  const isBatch = _quizzes.length > 1;
  const items   = _quizzes.map((q, i) => ({
    quiz:  q,
    id:    `adm-prog-${i}`,
    title: q.meta?.title || q.title || `اختبار ${i + 1}`,
  }));

  _overlay.innerHTML = `<div class="adm-card">
    ${hdr(isBatch ? `رفع ${_quizzes.length} اختبارات` : "رفع الاختبار")}
    ${stepsHTML(3)}
    <div class="adm-body">
      <p class="adm-hint" id="adm-s3-hint">جارٍ رفع الاختبارات…</p>
      <ul class="adm-progress-list">
        ${items.map(item => `<li class="adm-progress-item" id="${item.id}">
          <span class="adm-progress-icon">⏳</span>
          <span class="adm-progress-name">${item.title}</span>
        </li>`).join("")}
      </ul>
      <div class="adm-btns" id="adm-s3-btns" style="display:none;">
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
    }
  }

  let successCount = 0, errorCount = 0;

  for (const item of items) {
    setItemState(item, "uploading");
    try {
      await postUpload({
        education_type: educationType,
        college:   TRACKS_WITH_COLLEGE.has(educationType)  ? college || undefined : undefined,
        year:      TRACKS_WITH_YEARTERM.has(educationType) ? year    || undefined : undefined,
        term:      TRACKS_WITH_YEARTERM.has(educationType) ? term    || undefined : undefined,
        subject,
        subfolder: subfolder || undefined,
        author:    author    || undefined,
        quiz: item.quiz,
      });
      setItemState(item, "done");
      successCount++;
    } catch (err) {
      setItemState(item, "error", err.message || "فشل");
      errorCount++;
      if (err.message?.includes("جلسة") || err.message?.includes("مصرح")) {
        showNotification(err.message, "error");
        setTimeout(() => { signOut(); window.location.href = "/#my-quizzes"; }, 2000);
        return;
      }
    }
  }

  const hintEl = document.getElementById("adm-s3-hint");
  if (hintEl) {
    if (errorCount === 0) {
      hintEl.textContent = `✅ تم رفع ${successCount} اختبار بنجاح!`;
      hintEl.style.color = "#22c55e";
      showNotification(`تم الرفع بنجاح ✅ (${successCount} اختبار)`, "success");
    } else {
      hintEl.textContent = `تم رفع ${successCount} • فشل ${errorCount}`;
      hintEl.style.color = successCount > 0 ? "var(--color-text-secondary)" : "var(--color-error)";
      if (successCount > 0) showNotification(`تم ${successCount} اختبار (فشل ${errorCount})`, "warning");
    }
  }
  const btnsEl = document.getElementById("adm-s3-btns");
  if (btnsEl) btnsEl.style.display = "flex";
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
  if (!isAdminAuthenticated()) {
    showNotification("يجب تسجيل الدخول كمشرف أولاً", "error");
    setTimeout(() => { window.location.href = "/#my-quizzes"; }, 1500);
    return;
  }
  injectStyles();
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
}

async function openModal(quiz)               { await _openWizard([quiz]); }
async function openAdminUploadModal(quizzes) { await _openWizard(Array.isArray(quizzes) ? quizzes : [quizzes]); }

function closeModal() {
  if (_overlay) { _overlay.remove(); _overlay = null; }
  document.body.style.overflow = "";
  _quiz = null; _quizzes = [];
}

// ─── Public exports ───────────────────────────────────────────────────────────
export function createUploadButton(quiz) {
  injectStyles();
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "upload-to-db-btn";
  btn.setAttribute("aria-label", `رفع "${quiz.title}" إلى قاعدة البيانات`);
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
    <span>رفع لقاعدة البيانات</span>`;
  btn.addEventListener("click", (e) => { e.stopPropagation(); openModal(quiz); });
  return btn;
}

export { openModal as openUploadModal, openAdminUploadModal };
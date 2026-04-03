// =============================================================================
// public/src/scripts/adminUpload.js
// Admin quiz upload workflow — 3-step modal.
//
// Step 1 — Path selection:
//   • College    → fixed list from live manifest (read-only, no creation)
//   • Year       → (auto-populated from manifest for chosen college+subject) Shouldn't be changable
//   • Term       → (auto-populated from manifest for chosen college+subject) Shouldn't be changable
//   • Subject    → from manifest for selected college + "➕ إنشاء مادة جديدة"
//   • Subfolder  → existing subfolders from manifest + "➕ إنشاء مجلد فرعي جديد" + none
//
// Step 2 — Preview path + quiz details
// Step 3 — Upload confirmation + success/error
// The `upload-to-db-btn` looks missed up until it gets clicked.
// =============================================================================

import { getToken, isAdminAuthenticated, signOut } from "./adminAuth.js";
import { showNotification } from "../components/notifications.js";
import { userProfile } from "./userProfile.js";
import { generateQuizId } from "./quizId.js";
import { getManifest } from "./quizManifest.js";

// ─── Manifest tree (populated dynamically from getManifest()) ─────────────────
// Structure: { college: { subject: { yearterm: [[year,term],...], subfolders: [...] } } }
// Colleges are derived from the live manifest — admins cannot add new ones.
// Subjects and subfolders CAN be added by admins.

let MANIFEST_TREE = {};

/**
 * Builds the MANIFEST_TREE structure that the Step 1 UI helpers consume.
 * Derives colleges, subjects, year/term pairs, and subfolders from the merged
 * subjects array returned by getManifest().
 *
 * Subfolder extraction uses the same path-decoding logic as quizManifest.js
 * so that DB paths (/api/quiz-data?path=quizzes%2F...) are handled correctly.
 *
 * @param {Subject[]} subjects
 * @returns {object} MANIFEST_TREE
 */
function buildManifestTree(subjects) {
  const tree = {};

  for (const subject of subjects) {
    const college = subject.faculty;
    const subjectName = subject.name;
    const year = String(subject.year);
    const term = String(subject.term);

    if (!college) continue;
    if (!tree[college]) tree[college] = {};

    if (!tree[college][subjectName]) {
      tree[college][subjectName] = {
        yearterm: [[year, term]],
        subfolders: [],
      };
    } else {
      // Accumulate additional year/term pairs (e.g. if subject spans two terms)
      const existing = tree[college][subjectName].yearterm;
      if (!existing.some(([y, t]) => y === year && t === term)) {
        existing.push([year, term]);
      }
    }

    // Extract subfolders from quiz paths.
    // DB paths are encoded query parameters and must be decoded first.
    const seenSubfolders = new Set(tree[college][subjectName].subfolders);

    for (const quiz of subject.quizzes ?? []) {
      try {
        let rawPath = quiz.path;

        // Decode the `path` query-parameter for DB URLs
        // e.g. /api/quiz-data?path=quizzes%2FCollege%2F1%2F2%2FSubject%2FSubfolder%2Ffile.json
        const qIdx = rawPath.indexOf("?");
        if (qIdx !== -1) {
          const params = new URLSearchParams(rawPath.slice(qIdx + 1));
          const pathParam = params.get("path");
          if (pathParam) rawPath = decodeURIComponent(pathParam);
        }

        // Match the canonical segment after the subject name
        const canonicalMatch = rawPath.match(
          /quizzes\/[^/]+\/\d+\/\d+\/[^/]+\/(.+)/,
        );
        if (canonicalMatch) {
          const rest = canonicalMatch[1]; // e.g. "SubfolderName/file.json" or "file.json"
          const segments = rest.split("/");
          if (segments.length > 1) {
            const subfolder = segments.slice(0, -1).join("/");
            if (!seenSubfolders.has(subfolder)) {
              seenSubfolders.add(subfolder);
              tree[college][subjectName].subfolders.push(subfolder);
            }
          }
        }
      } catch (_) {}
    }
  }

  return tree;
}

// Year / Term display labels
const YEAR_LABELS = { 1: "السنة الأولى", 2: "السنة الثانية" };
const TERM_LABELS = { 1: "الترم الأول", 2: "الترم الثاني" };

// ─── Styles ───────────────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById("adm-upload-styles")) return;
  const s = document.createElement("style");
  s.id = "adm-upload-styles";
  s.textContent = `
    .adm-overlay {
      position:fixed; inset:0;
      background:rgba(0,0,0,.65); backdrop-filter:blur(4px);
      display:flex; justify-content:center; align-items:center;
      z-index:2000; padding:20px;
      animation:admFadeIn .2s ease;
    }
    @keyframes admFadeIn  { from{opacity:0}          to{opacity:1} }
    @keyframes admSlideUp { from{transform:translateY(26px);opacity:0} to{transform:translateY(0);opacity:1} }

    .adm-card {
      background:var(--color-surface);
      border:1px solid var(--color-border);
      border-radius:18px;
      width:100%; max-width:540px; max-height:92vh;
      overflow-y:auto; box-shadow:var(--shadow-xl);
      animation:admSlideUp .3s ease; scrollbar-width:thin;
    }
    .adm-header {
      display:flex; align-items:center; justify-content:space-between;
      padding:18px 22px 12px;
      border-bottom:1px solid var(--color-border);
      position:sticky; top:0; background:var(--color-surface);
      z-index:1; border-radius:18px 18px 0 0;
    }
    .adm-header h2 { margin:0; font-size:1.05rem; font-weight:700; color:var(--color-text-primary); display:flex; align-items:center; gap:7px; }
    .adm-close {
      width:30px; height:30px; border-radius:50%;
      border:1px solid var(--color-border);
      background:var(--color-background-secondary);
      color:var(--color-text); font-size:1rem;
      cursor:pointer; display:flex; align-items:center; justify-content:center;
      transition:transform .2s,background .2s;
    }
    .adm-close:hover { transform:rotate(90deg); background:var(--color-error-light); color:var(--color-error); }

    /* Steps bar */
    .adm-steps { display:flex; align-items:center; padding:12px 22px 0; }
    .adm-step  { display:flex; flex-direction:column; align-items:center; gap:3px; flex:1; }
    .adm-step-circle {
      width:28px; height:28px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font-size:.8rem; font-weight:700;
      background:var(--color-border); color:var(--color-text-tertiary);
      transition:all .25s; border:2px solid transparent;
    }
    .adm-step.active .adm-step-circle { background:var(--color-primary); color:#fff; border-color:var(--color-primary); box-shadow:0 0 0 4px var(--color-primary-light); }
    .adm-step.done   .adm-step-circle { background:#22c55e; color:#fff; border-color:#22c55e; }
    .adm-step-lbl { font-size:.66rem; font-weight:600; color:var(--color-text-tertiary); }
    .adm-step.active .adm-step-lbl { color:var(--color-primary); }
    .adm-step-line { flex:1; height:2px; background:var(--color-border); align-self:center; margin-bottom:16px; transition:background .25s; }
    .adm-step-line.done { background:#22c55e; }

    /* Body */
    .adm-body { padding:16px 22px 22px; }
    .adm-hint { font-size:.85rem; color:var(--color-text-secondary); text-align:center; margin:0 0 16px; }

    /* Form fields */
    .adm-field { margin-bottom:13px; }
    .adm-field label {
      display:flex; align-items:center; gap:6px;
      font-size:.8rem; font-weight:700;
      color:var(--color-text-secondary); margin-bottom:5px;
    }
    .adm-field label .adm-badge {
      font-size:.65rem; padding:1px 6px; border-radius:8px; font-weight:700;
    }
    .adm-badge-fixed   { background:#fef3c7; color:#92400e; }
    .adm-badge-auto    { background:#dbeafe; color:#1e40af; }
    .adm-badge-choose  { background:#f0fdf4; color:#166534; }
    .adm-badge-opt     { background:var(--color-border); color:var(--color-text-tertiary); }

    .adm-field select,
    .adm-field input[type="text"] {
      width:100%; padding:9px 12px;
      border:1.5px solid var(--color-border); border-radius:9px;
      font-size:.92rem; background:var(--color-background);
      color:var(--color-text-primary); font-family:inherit;
      transition:border-color .2s; box-sizing:border-box;
    }
    .adm-field select:focus,
    .adm-field input[type="text"]:focus {
      border-color:var(--color-primary); outline:none;
      box-shadow:0 0 0 3px var(--color-primary-light);
    }
    .adm-field select:disabled {
      opacity:.5; cursor:not-allowed;
      background:var(--color-background-secondary);
    }

    /* Two-column row for year + term */
    .adm-row2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }

    /* Path preview chip */
    .adm-path-chip {
      background:var(--color-primary-light); color:var(--color-primary);
      padding:5px 12px; border-radius:8px;
      font-size:.78rem; font-weight:700;
      direction:ltr; word-break:break-all;
      display:block; margin-bottom:13px; text-align:center;
    }

    /* Preview table */
    .adm-preview { background:var(--color-background-secondary); border:1.5px solid var(--color-border); border-radius:11px; padding:12px; margin-bottom:13px; }
    .adm-preview-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--color-border); font-size:.86rem; }
    .adm-preview-row:last-child { border-bottom:none; }
    .adm-preview-lbl { color:var(--color-text-secondary); font-weight:600; }
    .adm-preview-val { color:var(--color-text-primary); font-weight:700; direction:ltr; text-align:left; max-width:58%; word-break:break-all; }

    /* Buttons */
    .adm-btns { display:flex; gap:9px; margin-top:16px; }
    .adm-btn {
      flex:1; padding:10px 14px;
      border:none; border-radius:9px;
      font-size:.92rem; font-weight:700;
      cursor:pointer; transition:transform .2s,box-shadow .2s;
      font-family:inherit;
    }
    .adm-btn:hover:not(:disabled) { transform:translateY(-2px); box-shadow:var(--shadow-md); }
    .adm-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }
    .adm-btn-primary { background:var(--gradient-accent); color:#fff; }
    .adm-btn-ghost   { background:var(--color-background-secondary); border:1.5px solid var(--color-border); color:var(--color-text); }

    /* Upload button on quiz card */
    .upload-to-db-btn {
      padding:7px 11px;
      background:linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%);
      color:#fff; border:none; border-radius:6px;
      font-size:.8rem; font-weight:700; cursor:pointer;
      transition:transform .2s,box-shadow .2s;
      display:flex; align-items:center; gap:5px; white-space:nowrap;
    }
    .upload-to-db-btn:hover { transform:translateY(-2px); box-shadow:0 4px 14px rgba(124,58,237,.4); }
    .upload-to-db-btn svg { width:13px; height:13px; flex-shrink:0; }

    /* Spinner */
    .adm-spinner { display:inline-block; width:15px; height:15px; border:2px solid rgba(255,255,255,.35); border-top-color:#fff; border-radius:50%; animation:admSpin .7s linear infinite; margin-left:6px; }
    @keyframes admSpin { to{transform:rotate(360deg)} }

    /* Success */
    .adm-success { text-align:center; padding:18px 0 8px; }
    .adm-success-icon { font-size:3rem; margin-bottom:9px; }
    .adm-success h3 { font-size:1.1rem; color:var(--color-text-primary); margin:0 0 5px; }
    .adm-success p  { color:var(--color-text-secondary); font-size:.86rem; margin:3px 0; }
    .adm-success code { background:var(--color-background-secondary); padding:1px 6px; border-radius:4px; font-size:.78rem; }

    /* Loading state for modal */
    .adm-loading { text-align:center; padding:40px 22px; color:var(--color-text-secondary); font-size:.92rem; }
    .adm-loading .adm-spinner { border-top-color:var(--color-primary); border-color:var(--color-border); margin:0 auto 12px; display:block; width:24px; height:24px; }
  `;
  document.head.appendChild(s);
}

// ─── State ────────────────────────────────────────────────────────────────────
let _quiz = null;
let _overlay = null;

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function authHeaders() {
  const token = getToken();
  if (!token) {
    signOut();
    throw new Error("انتهت الجلسة. يرجى تسجيل الدخول مجددًا.");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function postUpload(payload) {
  const res = await fetch("/api/upload-quiz", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  let body = {};
  try {
    body = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error(body.error || "فشل الرفع");
  return body;
}

// ─── Modal scaffold ───────────────────────────────────────────────────────────
function makeOverlay() {
  const el = document.createElement("div");
  el.className = "adm-overlay";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.addEventListener("click", (e) => {
    if (e.target === el) closeModal();
  });
  return el;
}

function stepsHTML(cur) {
  const steps = ["المسار", "مراجعة", "رفع"];
  return `<div class="adm-steps">${steps
    .map((lbl, i) => {
      const n = i + 1,
        cls = n < cur ? "done" : n === cur ? "active" : "";
      return `${i > 0 ? `<div class="adm-step-line ${n <= cur ? "done" : ""}"></div>` : ""}
      <div class="adm-step ${cls}">
        <div class="adm-step-circle">${n < cur ? "✓" : n}</div>
        <span class="adm-step-lbl">${lbl}</span>
      </div>`;
    })
    .join("")}</div>`;
}

function hdr(title) {
  return `<div class="adm-header">
    <h2>☁️ ${title}</h2>
    <button class="adm-close" onclick="window.__admClose()">✕</button>
  </div>`;
}

// ─── Step 1: Path Selection ───────────────────────────────────────────────────
function renderStep1(saved = {}) {
  _overlay.innerHTML = `<div class="adm-card">
    ${hdr("رفع إلى قاعدة البيانات")}
    ${stepsHTML(1)}
    <div class="adm-body">
      <p class="adm-hint">حدّد موقع الاختبار في مكتبة المنصة</p>

      <!-- College: fixed list derived from live manifest, no creation -->
      <div class="adm-field">
        <label for="adm-college">
          الكلية / القسم
          <span class="adm-badge adm-badge-fixed">ثابت</span>
        </label>
        <select id="adm-college">
          <option value="">— اختر الكلية —</option>
          ${Object.keys(MANIFEST_TREE)
            .sort()
            .map(
              (c) =>
                `<option value="${c}" ${saved.college === c ? "selected" : ""}>${c}</option>`,
            )
            .join("")}
        </select>
      </div>

      <!-- Subject: from manifest + create new -->
      <div class="adm-field">
        <label for="adm-subject">
          المادة
          <span class="adm-badge adm-badge-choose">اختر أو أنشئ</span>
        </label>
        <select id="adm-subject" ${!saved.college ? "disabled" : ""}>
          <option value="">— اختر الكلية أولاً —</option>
        </select>
      </div>
      <div class="adm-field" id="adm-new-subject-wrap" style="display:none;">
        <label for="adm-new-subject">اسم المادة الجديدة</label>
        <input type="text" id="adm-new-subject" placeholder="مثال: Software Engineering" maxlength="80" value="${saved.newSubject || ""}" />
      </div>

      <!-- Year + Term: shown only when creating a new subject (hidden for existing ones, auto-resolved) -->
      <div id="adm-yearterm-wrap" style="display:none;">
        <div class="adm-row2">
          <div class="adm-field">
            <label for="adm-year">
              السنة الدراسية
              <span class="adm-badge adm-badge-choose">اختر</span>
            </label>
            <select id="adm-year">
              <option value="">— اختر السنة —</option>
            </select>
          </div>
          <div class="adm-field">
            <label for="adm-term">
              الترم
              <span class="adm-badge adm-badge-choose">اختر</span>
            </label>
            <select id="adm-term">
              <option value="">— اختر الترم —</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Subfolder: from manifest + create new + none -->
      <div class="adm-field">
        <label for="adm-subfolder">
          مجلد فرعي
          <span class="adm-badge adm-badge-opt">اختياري</span>
        </label>
        <select id="adm-subfolder" ${!saved.college ? "disabled" : ""}>
          <option value="">— بدون مجلد فرعي —</option>
        </select>
      </div>
      <div class="adm-field" id="adm-new-subfolder-wrap" style="display:none;">
        <label for="adm-new-subfolder">اسم المجلد الفرعي الجديد</label>
        <input type="text" id="adm-new-subfolder" placeholder="مثال: أسئلة الدكتور" maxlength="80" value="${saved.newSubfolder || ""}" />
      </div>

      <!-- Author: optional -->
      <div class="adm-field">
        <label for="adm-author">
          اسم المشرف صاحب الإمتحان
          <span class="adm-badge adm-badge-opt">اختياري</span>
        </label>
        <input type="text" id="adm-author" placeholder="مثال: د. أحمد محمد" maxlength="100" value="${saved.author || ""}" />
      </div>

      <!-- Quiz ID preview: read-only, computed from path -->
      <div class="adm-field" id="adm-id-wrap" style="${saved.college && saved.subject ? "" : "display:none;"}">
        <label>
          معرّف الاختبار (ID)
          <span class="adm-badge adm-badge-auto">تلقائي</span>
        </label>
        <input type="text" id="adm-quiz-id" readonly style="font-family:monospace;letter-spacing:.1em;background:var(--color-background-secondary);cursor:default;" value="" />
      </div>

      <div class="adm-btns">
        <button class="adm-btn adm-btn-ghost" onclick="window.__admClose()">إلغاء</button>
        <button class="adm-btn adm-btn-primary" id="adm-s1-next">التالي ←</button>
      </div>
    </div>
  </div>`;

  window.__admClose = closeModal;

  const colEl = document.getElementById("adm-college");
  const subEl = document.getElementById("adm-subject");
  const folEl = document.getElementById("adm-subfolder");

  // Year/Term are now visible <select> elements rendered in the HTML above.
  // They are exposed only when the admin chooses "➕ إنشاء مادة جديدة";
  // for existing subjects they are filled programmatically and the wrapper stays hidden.
  const yearEl = document.getElementById("adm-year");
  const termEl = document.getElementById("adm-term");

  async function refreshQuizId() {
    const { college, subject, year, term, subfolder } = getStep1Values();
    const idWrap = document.getElementById("adm-id-wrap");
    const idInput = document.getElementById("adm-quiz-id");
    if (!college || !subject || !year || !term || !idInput) {
      if (idWrap) idWrap.style.display = "none";
      return;
    }
    const pathParts = [college, year, term, subject];
    if (subfolder) pathParts.push(subfolder);
    const fullPath = pathParts.join("/");
    const quizTitle =
      (_quiz?.meta?.title || _quiz?.title || "quiz")
        .replace(/[^\u0600-\u06FF\w\s\-]/gu, "")
        .trim()
        .replace(/\s+/g, "_") || "quiz";
    const idPath = `quizzes/${fullPath}/${quizTitle}.json`;
    idInput.value = await generateQuizId(idPath);
    if (idWrap) idWrap.style.display = "";
  }

  // If college was already saved, populate dependents immediately
  if (saved.college) {
    populateSubjects(saved.college, subEl, folEl, yearEl, termEl, saved);
    refreshQuizId();
  }

  colEl.addEventListener("change", () => {
    populateSubjects(colEl.value, subEl, folEl, yearEl, termEl, {});
    refreshQuizId();
  });

  subEl.addEventListener("change", () => {
    const isNew = subEl.value === "__new__";
    const yeartermWrap = document.getElementById("adm-yearterm-wrap");

    document.getElementById("adm-new-subject-wrap").style.display = isNew
      ? "block"
      : "none";

    if (isNew) {
      // Show year/term selects populated from what this college actually has
      yeartermWrap.style.display = "block";
      populateYearsForCollege(colEl.value, yearEl);
      populateTermsForCollegeYear(colEl.value, "", termEl); // all college terms until year is chosen
      yearEl.value = "";
      termEl.value = "";
      yearEl.disabled = false;
      termEl.disabled = false;
    } else {
      // Hide the wrap; auto-fill values silently from the manifest
      yeartermWrap.style.display = "none";
      if (subEl.value)
        autoFillYearTerm(colEl.value, subEl.value, yearEl, termEl);
    }

    populateSubfolders(colEl.value, subEl.value, folEl, {});
    refreshQuizId();
  });

  // When admin picks a year while creating a new subject, narrow terms to that year
  yearEl.addEventListener("change", () => {
    if (subEl.value !== "__new__") return;
    populateTermsForCollegeYear(colEl.value, yearEl.value, termEl);
    termEl.value = "";
    refreshQuizId();
  });

  folEl.addEventListener("change", () => {
    document.getElementById("adm-new-subfolder-wrap").style.display =
      folEl.value === "__new__" ? "block" : "none";
    refreshQuizId();
  });

  document
    .getElementById("adm-s1-next")
    .addEventListener("click", step1Validate);
}

function populateSubjects(college, subEl, folEl, yearEl, termEl, saved) {
  subEl.disabled = false;
  yearEl.disabled = false;
  termEl.disabled = false;
  subEl.innerHTML = '<option value="">— اختر المادة —</option>';
  folEl.innerHTML = '<option value="">— بدون مجلد فرعي —</option>';
  folEl.disabled = false;
  document.getElementById("adm-new-subject-wrap").style.display = "none";
  document.getElementById("adm-new-subfolder-wrap").style.display = "none";

  if (!college || !MANIFEST_TREE[college]) return;

  const subjects = Object.keys(MANIFEST_TREE[college]).sort((a, b) =>
    a.localeCompare(b),
  );
  subjects.forEach((s) => {
    subEl.appendChild(
      Object.assign(document.createElement("option"), {
        value: s,
        textContent: s,
        selected: saved.subject === s,
      }),
    );
  });
  subEl.appendChild(
    Object.assign(document.createElement("option"), {
      value: "__new__",
      textContent: "➕ إنشاء مادة جديدة",
      selected: saved.subject === "__new__",
    }),
  );

  if (saved.subject && saved.subject !== "__new__") {
    autoFillYearTerm(college, saved.subject, yearEl, termEl);
    populateSubfolders(college, saved.subject, folEl, saved);
  }
  if (saved.subject === "__new__") {
    document.getElementById("adm-new-subject-wrap").style.display = "block";
    // Restore the year/term wrap with correctly cascaded options
    document.getElementById("adm-yearterm-wrap").style.display = "block";
    populateYearsForCollege(college, yearEl, saved.year || "");
    populateTermsForCollegeYear(
      college,
      saved.year || "",
      termEl,
      saved.term || "",
    );
    yearEl.disabled = false;
    termEl.disabled = false;
  }
}

/**
 * Fills #adm-year with the unique years that actually exist in the chosen
 * college's manifest (across all its subjects).  Preserves `selectedYear`
 * if it is still a valid option.
 */
function populateYearsForCollege(college, yearEl, selectedYear = "") {
  const yearsSet = new Set();
  for (const subData of Object.values(MANIFEST_TREE[college] || {})) {
    for (const [y] of subData.yearterm || []) yearsSet.add(y);
  }
  const years = [...yearsSet].sort();
  yearEl.innerHTML = '<option value="">— اختر السنة —</option>';
  years.forEach((y) => {
    yearEl.appendChild(
      Object.assign(document.createElement("option"), {
        value: y,
        textContent: YEAR_LABELS[y] || `السنة ${y}`,
        selected: y === selectedYear,
      }),
    );
  });
}

/**
 * Fills #adm-term with the unique terms that exist for the given college and
 * year in the manifest.  When `year` is empty, all terms in the college are
 * shown (so the dropdown is never blank before the admin picks a year).
 * Preserves `selectedTerm` if it is still a valid option.
 */
function populateTermsForCollegeYear(college, year, termEl, selectedTerm = "") {
  const termsSet = new Set();
  for (const subData of Object.values(MANIFEST_TREE[college] || {})) {
    for (const [y, t] of subData.yearterm || []) {
      if (!year || y === year) termsSet.add(t);
    }
  }
  const terms = [...termsSet].sort();
  termEl.innerHTML = '<option value="">— اختر الترم —</option>';
  terms.forEach((t) => {
    termEl.appendChild(
      Object.assign(document.createElement("option"), {
        value: t,
        textContent: TERM_LABELS[t] || `الترم ${t}`,
        selected: t === selectedTerm,
      }),
    );
  });
}

function autoFillYearTerm(college, subject, yearEl, termEl) {
  const info = MANIFEST_TREE[college]?.[subject];
  if (!info || !info.yearterm || info.yearterm.length === 0) {
    yearEl.disabled = false;
    termEl.disabled = false;
    return;
  }
  // Use first known year/term pair for this subject
  const [year, term] = info.yearterm[0] || [];
  if (year) {
    if (!yearEl.querySelector(`option[value="${year}"]`)) {
      yearEl.appendChild(
        new Option(YEAR_LABELS[year] || `السنة ${year}`, year),
      );
    }
    yearEl.value = year;
    yearEl.disabled = true;
  } else {
    yearEl.disabled = false;
  }
  if (term) {
    if (!termEl.querySelector(`option[value="${term}"]`)) {
      termEl.appendChild(
        new Option(TERM_LABELS[term] || `الترم ${term}`, term),
      );
    }
    termEl.value = term;
    termEl.disabled = true;
  } else {
    termEl.disabled = false;
  }
}

function populateSubfolders(college, subject, folEl, saved) {
  folEl.innerHTML = '<option value="">— بدون مجلد فرعي —</option>';
  document.getElementById("adm-new-subfolder-wrap").style.display = "none";

  // For new subjects there are no known subfolders yet
  if (!subject || subject === "__new__") {
    // Still allow creating a new subfolder
    folEl.appendChild(
      Object.assign(document.createElement("option"), {
        value: "__new__",
        textContent: "➕ إنشاء مجلد فرعي جديد",
      }),
    );
    return;
  }

  const info = MANIFEST_TREE[college]?.[subject];
  const subs = info?.subfolders || [];

  subs.forEach((sf) => {
    folEl.appendChild(
      Object.assign(document.createElement("option"), {
        value: sf,
        textContent: sf,
        selected: saved.subfolder === sf,
      }),
    );
  });

  folEl.appendChild(
    Object.assign(document.createElement("option"), {
      value: "__new__",
      textContent: "➕ إنشاء مجلد فرعي جديد",
      selected: saved.subfolder === "__new__",
    }),
  );

  if (saved.subfolder === "__new__") {
    document.getElementById("adm-new-subfolder-wrap").style.display = "block";
  }
}

function getStep1Values() {
  const college = document.getElementById("adm-college")?.value?.trim();
  const subRaw = document.getElementById("adm-subject")?.value;
  const subject =
    subRaw === "__new__"
      ? document.getElementById("adm-new-subject")?.value?.trim()
      : subRaw?.trim();
  const year = document.getElementById("adm-year")?.value;
  const term = document.getElementById("adm-term")?.value;
  const folRaw = document.getElementById("adm-subfolder")?.value;
  const subfolder =
    folRaw === "__new__"
      ? document.getElementById("adm-new-subfolder")?.value?.trim()
      : folRaw === ""
        ? ""
        : folRaw?.trim();
  const author = document.getElementById("adm-author")?.value?.trim() || "";
  return { college, subject, year, term, subfolder, author };
}

async function step1Validate() {
  const { college, subject, year, term } = getStep1Values();
  if (!college) {
    showNotification("الرجاء اختيار الكلية", "error");
    return;
  }
  if (!subject) {
    showNotification("الرجاء اختيار أو إدخال المادة", "error");
    return;
  }
  if (!year) {
    showNotification("الرجاء اختيار السنة الدراسية", "error");
    return;
  }
  if (!term) {
    showNotification("الرجاء اختيار الترم", "error");
    return;
  }
  await renderStep2(getStep1Values());
}

// ─── Step 2: Preview ──────────────────────────────────────────────────────────
async function renderStep2({
  college,
  subject,
  year,
  term,
  subfolder,
  author,
}) {
  const parts = [college, year, term, subject, subfolder].filter(Boolean);
  const fullPath = parts.join("/");
  const yearLbl = YEAR_LABELS[year] || year;
  const termLbl = TERM_LABELS[term] || term;

  // Compute quiz ID for preview
  const quizTitle =
    (_quiz?.meta?.title || _quiz?.title || "quiz")
      .replace(/[^\u0600-\u06FF\w\s\-]/gu, "")
      .trim()
      .replace(/\s+/g, "_") || "quiz";
  const idPath = `quizzes/${fullPath}/${quizTitle}.json`;
  const previewId = await generateQuizId(idPath);

  const quizTitleDisplay = _quiz?.meta?.title || "";
  const questionCount =
    _quiz?.stats?.questionCount ?? _quiz?.questions?.length ?? 0;

  _overlay.innerHTML = `<div class="adm-card">
    ${hdr("مراجعة الرفع")}
    ${stepsHTML(2)}
    <div class="adm-body">
      <p class="adm-hint">تحقق من التفاصيل قبل الرفع</p>
      <span class="adm-path-chip">📁 ${fullPath}</span>
      <div class="adm-preview">
        <div class="adm-preview-row"><span class="adm-preview-lbl">عنوان الاختبار</span><span class="adm-preview-val">${quizTitleDisplay}</span></div>
        <div class="adm-preview-row"><span class="adm-preview-lbl">عدد الأسئلة</span><span class="adm-preview-val">${questionCount} سؤال</span></div>
        <div class="adm-preview-row"><span class="adm-preview-lbl">معرّف الاختبار</span><span class="adm-preview-val" style="font-family:monospace;">${previewId}</span></div>
        <div class="adm-preview-row"><span class="adm-preview-lbl">الكلية</span><span class="adm-preview-val">${college}</span></div>
        <div class="adm-preview-row"><span class="adm-preview-lbl">المادة</span><span class="adm-preview-val">${subject}</span></div>
        <div class="adm-preview-row"><span class="adm-preview-lbl">السنة</span><span class="adm-preview-val">${yearLbl}</span></div>
        <div class="adm-preview-row"><span class="adm-preview-lbl">الترم</span><span class="adm-preview-val">${termLbl}</span></div>
        ${subfolder ? `<div class="adm-preview-row"><span class="adm-preview-lbl">المجلد الفرعي</span><span class="adm-preview-val">${subfolder}</span></div>` : ""}
        ${author ? `<div class="adm-preview-row"><span class="adm-preview-lbl">المشرف</span><span class="adm-preview-val">${author}</span></div>` : ""}
      </div>
      <div class="adm-btns">
        <button class="adm-btn adm-btn-ghost" id="adm-s2-back">← تعديل</button>
        <button class="adm-btn adm-btn-primary" id="adm-s2-upload">رفع الاختبار ☁️</button>
      </div>
    </div>
  </div>`;

  window.__admClose = closeModal;

  // Back: return to step 1 and restore selections
  document.getElementById("adm-s2-back").addEventListener("click", () => {
    renderStep1({ college, subject, year, term, subfolder, author });
  });

  document.getElementById("adm-s2-upload").addEventListener("click", () => {
    doUpload({ college, subject, year, term, subfolder, author });
  });
}

// ─── Step 3: Upload ───────────────────────────────────────────────────────────
async function doUpload({ college, subject, year, term, subfolder, author }) {
  const btn = document.getElementById("adm-s2-upload");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `جارٍ الرفع <span class="adm-spinner"></span>`;
  }

  const parts = [college, year, term, subject, subfolder].filter(Boolean);
  const fullPath = parts.join("/");

  try {
    await postUpload({
      college,
      year,
      term,
      subject,
      subfolder: subfolder || undefined,
      author: author || undefined,
      quiz: _quiz,
    });

    _overlay.querySelector(".adm-card").innerHTML = `
      <div class="adm-header" style="border-bottom:none;">
        <h2>☁️ رفع إلى قاعدة البيانات</h2>
        <button class="adm-close" onclick="window.__admClose()">✕</button>
      </div>
      <div class="adm-body">
        <div class="adm-success">
          <div class="adm-success-icon">✅</div>
          <h3>تم الرفع بنجاح!</h3>
          <p>الاختبار محفوظ في:</p>
          <span class="adm-path-chip">📁 ${fullPath}</span>
          <p style="margin-top:12px;font-size:.78rem;color:var(--color-text-tertiary);">
            لدمجه في الكود، شغّل:<br/>
            <code>npm run sync:quizzes</code>
          </p>
        </div>
        <div class="adm-btns">
          <button class="adm-btn adm-btn-primary" onclick="window.__admClose()">إغلاق</button>
        </div>
      </div>`;
    window.__admClose = closeModal;
    showNotification("تم الرفع بنجاح ✅", "success");
  } catch (err) {
    if (err.message?.includes("جلسة") || err.message?.includes("مصرح")) {
      showNotification(err.message, "error");
      setTimeout(() => {
        signOut();
        window.location.href = "sign-in.html";
      }, 2000);
      return;
    }
    showNotification(err.message || "فشل الرفع", "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "رفع الاختبار ☁️";
    }
  }
}

// ─── Schema normalizer ────────────────────────────────────────────────────────
/**
 * Ensures a quiz object is in the new schema (meta + stats + questions)
 * before upload, regardless of whether it came from the new create-quiz
 * flow or from an old localStorage entry.
 */
function normalizeQuizSchema(quiz) {
  // Normalize questions regardless of where schema starts
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

  // Build meta — never include id (server assigns it based on file path)
  const meta = {
    title: (quiz.meta?.title || quiz.title || "").trim(),
  };
  const src = quiz.meta?.createdAt || quiz.createdAt;
  if (src) meta.createdAt = src;
  const desc = quiz.meta?.description || quiz.description;
  if (desc?.trim()) meta.description = desc.trim();
  const source = quiz.meta?.source;
  if (source?.trim()) meta.source = source.trim();
  const author =
    quiz.meta?.author ||
    (quiz.author && quiz.author !== "User Created" && quiz.author !== "Imported"
      ? quiz.author
      : null);
  if (author?.trim()) meta.author = author.trim();

  return {
    meta,
    stats: {
      questionCount: questions.length,
      questionTypes: Array.from(types).sort(),
    },
    questions,
  };
}

// ─── Modal lifecycle ──────────────────────────────────────────────────────────

/**
 * Opens the upload modal.
 *
 * Now async: fetches the live merged manifest first, builds MANIFEST_TREE
 * dynamically from it, then renders Step 1.  A lightweight loading state is
 * shown in the modal while the manifest is being fetched so the user gets
 * immediate visual feedback.
 */
async function openModal(quiz) {
  if (!isAdminAuthenticated()) {
    showNotification("يجب تسجيل الدخول كمشرف أولاً", "error");
    setTimeout(() => {
      window.location.href = "sign-in.html";
    }, 1500);
    return;
  }

  injectStyles();
  _quiz = normalizeQuizSchema(quiz);
  _overlay = makeOverlay();
  document.body.appendChild(_overlay);
  document.body.style.overflow = "hidden";

  // Show a loading placeholder while the manifest is fetched
  _overlay.innerHTML = `<div class="adm-card">
    ${hdr("رفع إلى قاعدة البيانات")}
    <div class="adm-loading">
      <span class="adm-spinner"></span>
      جارٍ تحميل بيانات المنصة…
    </div>
  </div>`;
  window.__admClose = closeModal;

  // Fetch the live manifest and build the dynamic tree
  try {
    const { subjects } = await getManifest();
    MANIFEST_TREE = buildManifestTree(subjects);
  } catch (err) {
    console.error("[adminUpload] Failed to load manifest:", err);
    // MANIFEST_TREE stays as {} — modal will still open but college list is empty
    showNotification("تعذّر تحميل بيانات المنصة، تحقق من اتصالك", "error");
  }

  // Determine a pre-selected college from the user profile (if it exists in tree)
  let savedCollege = "";
  try {
    const p = userProfile.getProfile();
    if (p && p.faculty && MANIFEST_TREE[p.faculty]) {
      savedCollege = p.faculty;
    }
  } catch (e) {}

  renderStep1({ college: savedCollege });
}

function closeModal() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  document.body.style.overflow = "";
  _quiz = null;
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
         stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
    رفع لقاعدة البيانات`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openModal(quiz);
  });
  return btn;
}

export { openModal as openUploadModal };

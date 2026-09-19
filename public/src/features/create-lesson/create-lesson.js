// =============================================================================
// public/src/features/create-lesson/create-lesson.js
// LESSON AUTHORING — /create-lesson page logic.
// =============================================================================
// See docs/plans/lessons-feature-plan.md's Phase 3. This file is a fresh,
// standalone module — it imports shared pieces (markdown.js, storage
// helpers, adminAuth, the shared Supabase client registry) but does NOT
// extend or import create-quiz.js, per the plan's explicit ⚠️. A few small
// pieces are ported verbatim/near-verbatim from create-quiz.js where the
// plan calls for a port rather than a reuse (renderMathIn, the media-upload
// helper, image compression) — see each function's header comment.
//
// Ground rules this file must keep respecting (see the plan + the handoff
// doc): lessons are never scored (no points/level touch anywhere here);
// content shape must match lesson-schema.js's normalizeLessonContent() and
// api/_validateLesson.js's whitelist exactly; placement (course/folder) is
// only ever changed via move-item, never as a side effect of a content
// save; no drag-and-drop port — reordering uses simple up/down buttons.
// =============================================================================

import {
    isAdminAuthenticated,
    getAdminRoleInfo,
    getToken,
} from "../../shared/adminAuth.js";
import { ensureSharedSupabaseClient } from "../../shared/supabaseClientRegistry.js";
import { getManifest } from "../../shared/quizManifest.js";
import { renderMarkdown } from "../../shared/markdown.js";
import { escapeHtml } from "../home/escape-html.js";
import {
    showNotification,
    _confirm,
} from "../../components/notifications/notifications.js";
import { normalizeLessonContent } from "../lesson/lesson-schema.js";
import { FONT_CHOICES, HIGHLIGHT_CHOICES } from "../lesson/lesson-reader-prefs.js";

// =============================================================================
// STATE
// =============================================================================

/** The lesson currently being authored (working, unsaved-until-Save copy). */
let lessonState = null;
/** Non-null once editing an existing Supabase row (its `lessons.id`). */
let editingLessonId = null;
/** Full-fidelity original row, kept for fields the editor never touches
 * (created_by, created_at, course_id/folder_id — placement is move-item's
 * job, never this form's) so a save can't accidentally clobber them. */
let editingLessonRow = null;

/** `{ courses: Array, folders: Array }` — fetched once per page load for the
 * placement <select>s. Lessons are never placed via drag-and-drop here. */
let destinationTree = { courses: [], folders: [] };

/** `examList` from getManifest(), used by the quiz-ref picker's search. */
let quizExamList = [];

let autosaveTimer = null;
let isDirty = false;
let isSaving = false;

// A short numeric-ish suffix generator for client-side-only ids (section
// ids, question ids) — good enough for this editor's own uniqueness needs;
// api/_validateLesson.js is the actual authority that rejects duplicates.
function newLocalId(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function emptyLesson() {
    return {
        id: null,
        title: "",
        courseId: "",
        folderId: "",
        slug: "",
        fontId: "default",
        highlightId: "yellow",
        sections: [
            {
                id: newLocalId("s"),
                title: "",
                defaultHidden: false,
                blocks: [],
            },
        ],
    };
}

// =============================================================================
// INIT
// =============================================================================

document.addEventListener("DOMContentLoaded", async () => {
    if (!isAdminAuthenticated()) {
        showEntryNotAdmin();
        document.dispatchEvent(new Event("app:ready"));
        return;
    }

    showEntrySkeleton();

    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get("edit");

    await Promise.all([loadDestinationTree(), loadQuizExamList()]);

    if (editId) {
        await openLessonForEditing(editId);
    } else {
        await renderEntryItemsGrid();
        showEntryScreen();
    }

    setupAutosaveWatchers();
    document.dispatchEvent(new Event("app:ready"));
});

// =============================================================================
// ENTRY SCREEN
// =============================================================================

function showEntrySkeleton() {
    document.getElementById("entrySkeleton").style.display = "";
    document.getElementById("entryItemsGrid").style.display = "none";
    document.getElementById("entryNotAdmin").style.display = "none";
}

function showEntryNotAdmin() {
    document.getElementById("entrySkeleton").style.display = "none";
    document.getElementById("entryItemsGrid").style.display = "none";
    document.getElementById("entryNotAdmin").style.display = "";
}

function showEntryScreen() {
    document.body.classList.remove("lesson-form-active");
    document.getElementById("appTitleBar").style.display = "none";
    document.getElementById("entryScreen").style.display = "";
    document.getElementById("lessonCreatorForm").style.display = "none";
    document.getElementById("entrySkeleton").style.display = "none";
    document.getElementById("entryItemsGrid").style.display = "";
}

function showLessonForm() {
    document.body.classList.add("lesson-form-active");
    document.getElementById("appTitleBar").style.display = "";
    document.getElementById("entryScreen").style.display = "none";
    document.getElementById("lessonCreatorForm").style.display = "";
}

/**
 * Fetches the admin's own lessons directly from Supabase (or every lesson,
 * if the admin is the platform owner) and renders them as entry tiles.
 * Lessons aren't part of getManifest()'s catalog yet (see lesson-schema.js's
 * header comment), so this is its own direct read rather than a manifest
 * lookup.
 */
async function renderEntryItemsGrid() {
    const grid = document.getElementById("entryItemsGrid");
    const roleInfo = getAdminRoleInfo();
    const supabase = await ensureSharedSupabaseClient();
    if (!supabase || !roleInfo) {
        grid.innerHTML = `<div class="entry-section"><p class="entry-not-admin-message">تعذّر تحميل دروسك. حاول مرة أخرى.</p></div>`;
        return;
    }

    let query = supabase
        .from("lessons")
        .select("id, title, slug, course_id, folder_id, created_by, updated_at")
        .order("updated_at", { ascending: false });
    if (!roleInfo.isOwner) {
        query = query.eq("created_by", roleInfo.id);
    }

    const { data, error } = await query;
    if (error) {
        console.error("[create-lesson] failed to load lessons:", error.message);
        grid.innerHTML = `<div class="entry-section"><p class="entry-not-admin-message">تعذّر تحميل دروسك. حاول مرة أخرى.</p></div>`;
        return;
    }

    if (!data || data.length === 0) {
        grid.innerHTML = "";
        return;
    }

    const courseNameById = new Map(destinationTree.courses.map((c) => [c.id, c.name]));

    const tilesHtml = data
        .map((lesson) => {
            const courseName = courseNameById.get(lesson.course_id) || "";
            return `
        <div class="entry-item-wrap">
          <button type="button" class="entry-item" data-lesson-id="${escapeHtml(lesson.id)}" onclick="openLessonTile('${escapeHtml(lesson.id)}')">
            <span class="entry-item-thumb">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 7v14" />
                <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
              </svg>
            </span>
            <span class="entry-item-title">${escapeHtml(lesson.title)}</span>
            ${courseName ? `<span class="entry-item-meta">${escapeHtml(courseName)}</span>` : ""}
          </button>
          <div class="entry-item-more-wrap">
            <button type="button" class="entry-item-more-btn" title="خيارات" onclick="toggleEntryItemMenu(event, '${escapeHtml(lesson.id)}')">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
            </button>
            <div class="entry-item-menu" id="entry-item-menu-${escapeHtml(lesson.id)}">
              <button type="button" class="entry-item-menu-option" onclick="openLessonTile('${escapeHtml(lesson.id)}')">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
                تعديل
              </button>
              <button type="button" class="entry-item-menu-option entry-item-menu-option-danger" onclick="deleteLessonTile('${escapeHtml(lesson.id)}')">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                حذف
              </button>
            </div>
          </div>
        </div>`;
        })
        .join("");

    grid.innerHTML = `<div class="entry-section"><h2 class="entry-screen-heading">دروسك</h2><div class="entry-items-grid">${tilesHtml}</div></div>`;
}

window.toggleEntryItemMenu = function (event, lessonId) {
    event.stopPropagation();
    const menu = document.getElementById(`entry-item-menu-${lessonId}`);
    if (!menu) return;
    const wasOpen = menu.classList.contains("open");
    document.querySelectorAll(".entry-item-menu.open").forEach((m) => m.classList.remove("open"));
    if (!wasOpen) menu.classList.add("open");
};

document.addEventListener("click", () => {
    document.querySelectorAll(".entry-item-menu.open").forEach((m) => m.classList.remove("open"));
});

window.openLessonTile = async function (lessonId) {
    await openLessonForEditing(lessonId);
};

window.deleteLessonTile = async function (lessonId) {
    const confirmed = await _confirm("هل تريد نقل هذا الدرس إلى سلة المهملات؟");
    if (!confirmed) return;
    const res = await postAdminActionLocal("delete-lesson", { id: lessonId });
    if (res) {
        showNotification("تم الحذف", "تم نقل الدرس إلى سلة المهملات.", "success");
        await renderEntryItemsGrid();
    }
};

/** Handles clicks on the two entry-screen actions the HTML wires directly. */
window.chooseEntryAction = function (action) {
    if (action === "new") {
        lessonState = emptyLesson();
        editingLessonId = null;
        editingLessonRow = null;
        renderLessonForm();
        showLessonForm();
    } else if (action === "exit") {
        if (isDirty) {
            _confirm("لديك تعديلات غير محفوظة. هل تريد الخروج بدون حفظ؟").then((ok) => {
                if (ok) {
                    isDirty = false;
                    showEntryScreen();
                    renderEntryItemsGrid();
                }
            });
            return;
        }
        showEntryScreen();
        renderEntryItemsGrid();
    }
};

// =============================================================================
// DESTINATION TREE (course/folder placement dropdowns)
// =============================================================================
// Same public (anon) Supabase read admin-item-actions.js's
// fetchSharedDestinationNodes() uses, built fresh here since that function
// is private to that module (see the handoff doc's note on this point).

async function loadDestinationTree() {
    const supabase = await ensureSharedSupabaseClient();
    if (!supabase) return;
    const [{ data: courses }, { data: folders }] = await Promise.all([
        supabase.from("courses").select("id, name").order("name", { ascending: true }),
        supabase
            .from("folders")
            .select("id, course_id, name, parent_folder_id")
            .order("name", { ascending: true }),
    ]);
    destinationTree = {
        courses: Array.isArray(courses) ? courses : [],
        folders: Array.isArray(folders) ? folders : [],
    };
}

async function loadQuizExamList() {
    try {
        const { examList } = await getManifest();
        quizExamList = Array.isArray(examList) ? examList : [];
    } catch (err) {
        console.error("[create-lesson] failed to load quiz manifest:", err);
        quizExamList = [];
    }
}

function populateCourseSelect() {
    const select = document.getElementById("lessonCourseSelect");
    select.innerHTML =
        `<option value="">— اختر مادة —</option>` +
        destinationTree.courses
            .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
            .join("");
    select.value = lessonState.courseId || "";
}

/** Folder options are filtered to the selected course, mirroring the
 * course→folder cascading dropdown pattern used elsewhere on the platform. */
function populateFolderSelect() {
    const select = document.getElementById("lessonFolderSelect");
    const relevant = destinationTree.folders.filter((f) => f.course_id === lessonState.courseId);
    select.innerHTML =
        `<option value="">— مباشرة تحت المادة —</option>` +
        relevant
            .map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(folderDisplayPath(f, relevant))}</option>`)
            .join("");
    select.value = lessonState.folderId || "";
}

/** Builds a "Parent / Child" label for nested folders within the same course. */
function folderDisplayPath(folder, allFoldersInCourse) {
    const byId = new Map(allFoldersInCourse.map((f) => [f.id, f]));
    const parts = [folder.name];
    let cursor = folder;
    const seen = new Set([folder.id]);
    while (cursor.parent_folder_id && byId.has(cursor.parent_folder_id) && !seen.has(cursor.parent_folder_id)) {
        cursor = byId.get(cursor.parent_folder_id);
        seen.add(cursor.id);
        parts.unshift(cursor.name);
    }
    return parts.join(" / ");
}

function populateFontAndHighlightSelects() {
    const fontSelect = document.getElementById("lessonFontSelect");
    fontSelect.innerHTML = FONT_CHOICES.map(
        (f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.label)}</option>`,
    ).join("");
    fontSelect.value = lessonState.fontId || "default";

    const highlightSelect = document.getElementById("lessonHighlightSelect");
    highlightSelect.innerHTML = HIGHLIGHT_CHOICES.map(
        (h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.label)}</option>`,
    ).join("");
    highlightSelect.value = lessonState.highlightId || "yellow";
}

// =============================================================================
// LOADING AN EXISTING LESSON FOR EDITING
// =============================================================================

async function openLessonForEditing(lessonId) {
    const supabase = await ensureSharedSupabaseClient();
    if (!supabase) {
        showNotification("خطأ", "تعذّر الاتصال بـ Supabase.", "error");
        showEntryScreen();
        return;
    }
    const { data, error } = await supabase.from("lessons").select("*").eq("id", lessonId).maybeSingle();
    if (error || !data) {
        console.error("[create-lesson] failed to load lesson:", error?.message);
        showNotification("خطأ", "تعذّر تحميل الدرس المطلوب.", "error");
        showEntryScreen();
        await renderEntryItemsGrid();
        return;
    }

    editingLessonId = data.id;
    editingLessonRow = data;

    const normalized = normalizeLessonContent(data.content);
    const readerDefaults = data.reader_prefs_default || {};

    lessonState = {
        id: data.id,
        title: data.title || "",
        courseId: data.course_id || "",
        folderId: data.folder_id || "",
        slug: data.slug || "",
        fontId: readerDefaults.fontId || "default",
        highlightId: readerDefaults.highlightId || "yellow",
        sections: normalized.sections.length
            ? normalized.sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => ({ ...b })) }))
            : [{ id: newLocalId("s"), title: "", defaultHidden: false, blocks: [] }],
    };

    renderLessonForm();
    showLessonForm();
    isDirty = false;
}

// =============================================================================
// TITLE EDITING (top bar)
// =============================================================================

window.startTitleEdit = function () {
    const el = document.getElementById("appTitleText");
    el.contentEditable = "true";
    el.classList.add("editing");
    el.focus();
    document.execCommand("selectAll", false, null);
};

window.commitTitleEdit = function () {
    const el = document.getElementById("appTitleText");
    el.contentEditable = "false";
    el.classList.remove("editing");
    const value = el.textContent.trim().slice(0, 200) || "درس بدون عنوان";
    el.textContent = value;
    if (lessonState) {
        lessonState.title = value === "درس بدون عنوان" ? "" : value;
        document.getElementById("lessonTitleInput").value = lessonState.title;
        markDirty();
    }
};

window.handleTitleEditKeydown = function (event) {
    if (event.key === "Enter") {
        event.preventDefault();
        document.getElementById("appTitleText").blur();
    } else if (event.key === "Escape") {
        event.preventDefault();
        const el = document.getElementById("appTitleText");
        el.textContent = lessonState.title || "درس بدون عنوان";
        el.blur();
    }
};

function syncTitleBarFromState() {
    document.getElementById("appTitleText").textContent = lessonState.title || "درس بدون عنوان";
}

// =============================================================================
// RENDERING THE LESSON FORM
// =============================================================================

function renderLessonForm() {
    document.getElementById("lessonTitleInput").value = lessonState.title;
    syncTitleBarFromState();
    populateCourseSelect();
    populateFolderSelect();
    populateFontAndHighlightSelects();
    renderSections();
    updateSectionNavigator();
}

function renderSections() {
    const container = document.getElementById("sectionsContainer");
    container.innerHTML = lessonState.sections.map((section, index) => sectionCardHtml(section, index)).join("");

    lessonState.sections.forEach((section) => {
        equipMarkdownFields(section.id);
        equipMediaDropzones(section.id);
    });
}

function sectionCardHtml(section, index) {
    const isFirst = index === 0;
    const isLast = index === lessonState.sections.length - 1;
    return `
    <div class="lesson-section-card" id="section-${escapeHtml(section.id)}" data-section-id="${escapeHtml(section.id)}">
      <div class="lesson-section-card-header">
        <div class="lesson-section-title-group">
          <span class="lesson-section-index">${index + 1}</span>
          <input type="text" class="form-input lesson-section-title-input" placeholder="عنوان القسم (اختياري)"
            value="${escapeHtml(section.title)}" maxlength="200"
            oninput="updateSectionTitle('${escapeHtml(section.id)}', this.value)">
        </div>
        <div class="lesson-section-actions">
          <label class="lesson-section-hidden-toggle" title="إخفاء هذا القسم افتراضياً حتى يُكشف بشرط">
            <input type="checkbox" ${section.defaultHidden ? "checked" : ""}
              onchange="toggleSectionDefaultHidden('${escapeHtml(section.id)}', this.checked)">
            <span>مخفي افتراضياً</span>
          </label>
          <button type="button" class="lesson-icon-btn" title="نقل لأعلى" ${isFirst ? "disabled" : ""}
            onclick="moveSectionUp('${escapeHtml(section.id)}')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
          </button>
          <button type="button" class="lesson-icon-btn" title="نقل لأسفل" ${isLast ? "disabled" : ""}
            onclick="moveSectionDown('${escapeHtml(section.id)}')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <button type="button" class="lesson-icon-btn lesson-icon-btn-danger" title="حذف القسم"
            onclick="removeSection('${escapeHtml(section.id)}')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>

      <div class="lesson-blocks-list">
        ${section.blocks.map((block, bIndex) => blockCardHtml(section.id, block, bIndex, section.blocks.length)).join("")}
      </div>

      <div class="lesson-add-block-row">
        <button type="button" class="btn btn-secondary btn-sm" onclick="addBlock('${escapeHtml(section.id)}', 'markdown')">+ نص</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addBlock('${escapeHtml(section.id)}', 'media')">+ وسائط</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addBlock('${escapeHtml(section.id)}', 'quizRef')">+ امتحان مرتبط</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addBlock('${escapeHtml(section.id)}', 'question')">+ سؤال مدمج</button>
      </div>
    </div>`;
}

// =============================================================================
// SECTION CRUD
// =============================================================================

window.addSection = function () {
    lessonState.sections.push({ id: newLocalId("s"), title: "", defaultHidden: false, blocks: [] });
    renderSections();
    updateSectionNavigator();
    markDirty();
    const newCard = document.getElementById(`section-${lessonState.sections[lessonState.sections.length - 1].id}`);
    newCard?.scrollIntoView({ behavior: "smooth", block: "center" });
};

window.updateSectionTitle = function (sectionId, value) {
    const section = findSection(sectionId);
    if (!section) return;
    section.title = value;
    updateSectionNavigator();
    markDirty();
};

window.toggleSectionDefaultHidden = function (sectionId, checked) {
    const section = findSection(sectionId);
    if (!section) return;
    section.defaultHidden = checked;
    markDirty();
};

window.moveSectionUp = function (sectionId) {
    const idx = lessonState.sections.findIndex((s) => s.id === sectionId);
    if (idx <= 0) return;
    [lessonState.sections[idx - 1], lessonState.sections[idx]] = [lessonState.sections[idx], lessonState.sections[idx - 1]];
    renderSections();
    updateSectionNavigator();
    markDirty();
};

window.moveSectionDown = function (sectionId) {
    const idx = lessonState.sections.findIndex((s) => s.id === sectionId);
    if (idx === -1 || idx >= lessonState.sections.length - 1) return;
    [lessonState.sections[idx + 1], lessonState.sections[idx]] = [lessonState.sections[idx], lessonState.sections[idx + 1]];
    renderSections();
    updateSectionNavigator();
    markDirty();
};

window.removeSection = async function (sectionId) {
    if (lessonState.sections.length <= 1) {
        showNotification("تنبيه", "يجب أن يبقى قسم واحد على الأقل في الدرس.", "warning");
        return;
    }
    const confirmed = await _confirm("هل تريد حذف هذا القسم وكل محتواه؟");
    if (!confirmed) return;
    lessonState.sections = lessonState.sections.filter((s) => s.id !== sectionId);
    // A removed section may have been the target of another question's
    // adaptive-reveal rule elsewhere in the lesson — clear any dangling
    // references so a save never sends a revealSection pointing at nothing
    // (api/_validateLesson.js would reject it anyway, but failing silently
    // here at the source is friendlier than a save-time error).
    for (const section of lessonState.sections) {
        for (const block of section.blocks) {
            if (block.type !== "question") continue;
            if (block.onWrong?.revealSection === sectionId) delete block.onWrong;
            if (block.onCorrect?.revealSection === sectionId) delete block.onCorrect;
        }
    }
    renderSections();
    updateSectionNavigator();
    markDirty();
};

function findSection(sectionId) {
    return lessonState.sections.find((s) => s.id === sectionId) || null;
}

function findBlock(sectionId, blockId) {
    const section = findSection(sectionId);
    if (!section) return null;
    return section.blocks.find((b) => b._localId === blockId) || null;
}

// =============================================================================
// SECTION NAVIGATOR (sidebar widget)
// =============================================================================

function updateSectionNavigator() {
    const panel = document.getElementById("createLessonSectionNavPanel");
    const count = document.getElementById("createLessonSectionNavCount");
    if (!panel || !count) return;
    count.textContent = String(lessonState.sections.length);
    panel.innerHTML = lessonState.sections
        .map(
            (s, i) =>
                `<button type="button" class="create-question-nav-item${s.defaultHidden ? " incomplete" : ""}" title="${escapeHtml(s.title || `قسم ${i + 1}`)}" onclick="scrollToSection('${escapeHtml(s.id)}')">${i + 1}</button>`,
        )
        .join("");
}

window.scrollToSection = function (sectionId) {
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

document.addEventListener("click", (event) => {
    const toggle = event.target.closest("#createLessonSectionNavToggle");
    if (!toggle) return;
    const nav = document.getElementById("createLessonSectionNav");
    const panel = document.getElementById("createLessonSectionNavPanel");
    const isOpen = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    panel.hidden = !isOpen;
});

// =============================================================================
// BLOCK CRUD
// =============================================================================

function makeBlock(type) {
    const localId = newLocalId("b");
    if (type === "markdown") return { type: "markdown", body: "", _localId: localId };
    if (type === "media") return { type: "media", url: "", kind: "image", alt: "", _localId: localId };
    if (type === "quizRef") return { type: "quizRef", quizId: "", title: "", _localId: localId };
    // question
    return {
        type: "question",
        id: newLocalId("q"),
        prompt: "",
        options: ["", ""],
        correctIndex: 0,
        explanation: "",
        _localId: localId,
    };
}

window.addBlock = function (sectionId, type) {
    const section = findSection(sectionId);
    if (!section) return;
    if (section.blocks.length >= 40) {
        showNotification("تنبيه", "الحد الأقصى 40 عنصراً لكل قسم.", "warning");
        return;
    }
    section.blocks.push(makeBlock(type));
    renderSections();
    markDirty();
};

window.removeBlock = async function (sectionId, localBlockId) {
    const confirmed = await _confirm("هل تريد حذف هذا العنصر؟");
    if (!confirmed) return;
    const section = findSection(sectionId);
    if (!section) return;
    section.blocks = section.blocks.filter((b) => b._localId !== localBlockId);
    renderSections();
    markDirty();
};

window.moveBlockUp = function (sectionId, localBlockId) {
    const section = findSection(sectionId);
    if (!section) return;
    const idx = section.blocks.findIndex((b) => b._localId === localBlockId);
    if (idx <= 0) return;
    [section.blocks[idx - 1], section.blocks[idx]] = [section.blocks[idx], section.blocks[idx - 1]];
    renderSections();
    markDirty();
};

window.moveBlockDown = function (sectionId, localBlockId) {
    const section = findSection(sectionId);
    if (!section) return;
    const idx = section.blocks.findIndex((b) => b._localId === localBlockId);
    if (idx === -1 || idx >= section.blocks.length - 1) return;
    [section.blocks[idx + 1], section.blocks[idx]] = [section.blocks[idx], section.blocks[idx + 1]];
    renderSections();
    markDirty();
};

// =============================================================================
// BLOCK CARD RENDERING (dispatches per type)
// =============================================================================

function blockCardHtml(sectionId, block, index, totalInSection) {
    const isFirst = index === 0;
    const isLast = index === totalInSection - 1;
    const chrome = (inner, label) => `
    <div class="lesson-block-card" data-block-type="${block.type}">
      <div class="lesson-block-card-header">
        <span class="lesson-block-type-label">${label}</span>
        <div class="lesson-block-card-actions">
          <button type="button" class="lesson-icon-btn" title="نقل لأعلى" ${isFirst ? "disabled" : ""} onclick="moveBlockUp('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
          </button>
          <button type="button" class="lesson-icon-btn" title="نقل لأسفل" ${isLast ? "disabled" : ""} onclick="moveBlockDown('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <button type="button" class="lesson-icon-btn lesson-icon-btn-danger" title="حذف" onclick="removeBlock('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      ${inner}
    </div>`;

    if (block.type === "markdown") return chrome(markdownBlockInnerHtml(sectionId, block), "نص (Markdown)");
    if (block.type === "media") return chrome(mediaBlockInnerHtml(sectionId, block), "وسائط");
    if (block.type === "quizRef") return chrome(quizRefBlockInnerHtml(sectionId, block), "امتحان مرتبط");
    return chrome(questionBlockInnerHtml(sectionId, block), "سؤال مدمج");
}

// ── Markdown block: self-built write/preview toggle ─────────────────────────
// Deliberately NOT a port of create-quiz.js's global .gmd floating toolbar
// (~300+ lines of focus-tracking/toolbar machinery) — see the handoff doc.
// Just a plain two-tab write/preview switch; renderMathIn() runs after every
// preview render, same KaTeX pattern as create-quiz.js.

function markdownBlockInnerHtml(sectionId, block) {
    const fieldId = `md-${block._localId}`;
    return `
    <div class="lesson-md-editor" data-field-id="${fieldId}">
      <div class="lesson-md-tabs">
        <button type="button" class="lesson-md-tab active" data-mode="write" onclick="setMdMode('${fieldId}', 'write')">كتابة</button>
        <button type="button" class="lesson-md-tab" data-mode="preview" onclick="setMdMode('${fieldId}', 'preview')">معاينة</button>
      </div>
      <textarea class="lesson-md-textarea" id="${fieldId}-textarea" data-section-id="${escapeHtml(sectionId)}" data-local-id="${escapeHtml(block._localId)}"
        placeholder="اكتب محتوى القسم هنا… يدعم Markdown و LaTeX ($...$)">${escapeHtml(block.body)}</textarea>
      <div class="lesson-md-preview md-content" id="${fieldId}-preview" hidden></div>
    </div>`;
}

window.setMdMode = function (fieldId, mode) {
    const root = document.querySelector(`.lesson-md-editor[data-field-id="${fieldId}"]`);
    if (!root) return;
    const textarea = document.getElementById(`${fieldId}-textarea`);
    const preview = document.getElementById(`${fieldId}-preview`);
    root.querySelectorAll(".lesson-md-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
    if (mode === "preview") {
        preview.innerHTML = renderMarkdown(textarea.value || "");
        renderMathIn(preview);
        textarea.hidden = true;
        preview.hidden = false;
    } else {
        textarea.hidden = false;
        preview.hidden = true;
    }
};

function equipMarkdownFields(sectionId) {
    document.querySelectorAll(`.lesson-md-textarea[data-section-id="${sectionId}"]`).forEach((textarea) => {
        textarea.addEventListener("input", () => {
            const section = findSection(sectionId);
            const block = section?.blocks.find((b) => b._localId === textarea.dataset.localId);
            if (block) {
                block.body = textarea.value;
                markDirty();
            }
        });
    });
}

// ── Media block ───────────────────────────────────────────────────────────

function mediaBlockInnerHtml(sectionId, block) {
    const previewHtml = block.url ? mediaPreviewHtml(block) : "";
    return `
    <div class="lesson-media-editor">
      <div class="lesson-media-dropzone" data-section-id="${escapeHtml(sectionId)}" data-local-id="${escapeHtml(block._localId)}">
        <input type="file" class="lesson-media-file-input" accept="image/*,audio/*,video/*" onchange="handleMediaFileInput(event, '${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}')">
        <p>اسحب ملفاً هنا أو اضغط للاختيار، أو الصق رابطاً مباشرة أدناه</p>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>رابط الوسائط</label>
          <input type="text" class="form-input" value="${escapeHtml(block.url)}" placeholder="https://…"
            oninput="updateMediaField('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}', 'url', this.value)">
        </div>
        <div class="form-group">
          <label>النوع</label>
          <select class="form-input" onchange="updateMediaField('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}', 'kind', this.value)">
            <option value="image" ${block.kind === "image" ? "selected" : ""}>صورة</option>
            <option value="audio" ${block.kind === "audio" ? "selected" : ""}>صوت</option>
            <option value="video" ${block.kind === "video" ? "selected" : ""}>فيديو</option>
          </select>
        </div>
      </div>
      ${block.kind === "image" ? `
      <div class="form-group">
        <label>نص بديل (alt)</label>
        <input type="text" class="form-input" value="${escapeHtml(block.alt || "")}" placeholder="وصف الصورة"
          oninput="updateMediaField('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}', 'alt', this.value)">
      </div>` : ""}
      <div class="lesson-media-preview" id="media-preview-${escapeHtml(block._localId)}">${previewHtml}</div>
    </div>`;
}

function mediaPreviewHtml(block) {
    if (block.kind === "image") return `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt || "")}" class="lesson-media-preview-img">`;
    if (block.kind === "audio") return `<audio src="${escapeHtml(block.url)}" controls></audio>`;
    return `<video src="${escapeHtml(block.url)}" controls class="lesson-media-preview-video"></video>`;
}

window.updateMediaField = function (sectionId, localId, field, value) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    block[field] = value;
    markDirty();
    if (field === "url" || field === "kind") {
        const previewEl = document.getElementById(`media-preview-${localId}`);
        if (previewEl) previewEl.innerHTML = block.url ? mediaPreviewHtml(block) : "";
        if (field === "kind") renderSections(); // alt field only shows for images
    }
};

window.handleMediaFileInput = async function (event, sectionId, localId) {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadMediaIntoBlock(file, sectionId, localId);
    event.target.value = "";
};

function equipMediaDropzones(sectionId) {
    document.querySelectorAll(`.lesson-media-dropzone[data-section-id="${sectionId}"]`).forEach((zone) => {
        const localId = zone.dataset.localId;
        zone.addEventListener("dragover", (e) => {
            e.preventDefault();
            zone.classList.add("is-dragover");
        });
        zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
        zone.addEventListener("drop", async (e) => {
            e.preventDefault();
            zone.classList.remove("is-dragover");
            const file = e.dataTransfer?.files?.[0];
            if (file) await uploadMediaIntoBlock(file, sectionId, localId);
        });
    });
}

async function uploadMediaIntoBlock(file, sectionId, localId) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    const mediaType = detectMediaTypeFromFile(file);
    if (!mediaType) {
        showNotification("خطأ", "نوع الملف غير مدعوم.", "error");
        return;
    }
    const previewEl = document.getElementById(`media-preview-${localId}`);
    if (previewEl) previewEl.innerHTML = `<p class="lesson-media-uploading">جاري الرفع…</p>`;
    try {
        const { url } = await uploadMediaFileForLesson(file, mediaType);
        block.url = url;
        block.kind = mediaType;
        markDirty();
        renderSections();
    } catch (err) {
        showNotification("خطأ", err.message || "فشل رفع الملف.", "error");
        if (previewEl) previewEl.innerHTML = block.url ? mediaPreviewHtml(block) : "";
    }
}

// ── Quiz-reference block ─────────────────────────────────────────────────

function quizRefBlockInnerHtml(sectionId, block) {
    const matched = block.quizId ? quizExamList.find((q) => q.id === block.quizId) : null;
    return `
    <div class="lesson-quizref-editor">
      <div class="form-group">
        <label>ابحث عن امتحان بالعنوان</label>
        <input type="text" class="form-input lesson-quizref-search" placeholder="اكتب جزءاً من عنوان الامتحان…"
          data-section-id="${escapeHtml(sectionId)}" data-local-id="${escapeHtml(block._localId)}"
          oninput="handleQuizRefSearch(this)">
        <div class="lesson-quizref-results" id="quizref-results-${escapeHtml(block._localId)}"></div>
      </div>
      <div class="lesson-quizref-selected" id="quizref-selected-${escapeHtml(block._localId)}">
        ${matched ? quizRefSelectedHtml(matched) : block.quizId ? `<p class="lesson-quizref-unresolved">امتحان محدد (${escapeHtml(block.quizId)}) — تعذّر إيجاده في القائمة الحالية.</p>` : `<p class="lesson-quizref-empty">لم يتم اختيار امتحان بعد.</p>`}
      </div>
    </div>`;
}

function quizRefSelectedHtml(exam) {
    return `
    <div class="lesson-quizref-chip">
      <span class="lesson-quizref-chip-title">${escapeHtml(exam.title)}</span>
      ${typeof exam.questionCount === "number" ? `<span class="lesson-quizref-chip-count">${exam.questionCount} سؤال</span>` : ""}
    </div>`;
}

window.handleQuizRefSearch = function (input) {
    const term = input.value.trim().toLowerCase();
    const resultsEl = document.getElementById(`quizref-results-${input.dataset.localId}`);
    if (!term) {
        resultsEl.innerHTML = "";
        return;
    }
    const matches = quizExamList.filter((q) => (q.title || "").toLowerCase().includes(term)).slice(0, 8);
    if (matches.length === 0) {
        resultsEl.innerHTML = `<p class="lesson-quizref-no-results">لا توجد نتائج.</p>`;
        return;
    }
    resultsEl.innerHTML = matches
        .map(
            (q) =>
                `<button type="button" class="lesson-quizref-result" onclick="selectQuizRef('${escapeHtml(input.dataset.sectionId)}', '${escapeHtml(input.dataset.localId)}', '${escapeHtml(q.id)}')">
          <span>${escapeHtml(q.title)}</span>
          ${typeof q.questionCount === "number" ? `<span class="lesson-quizref-result-count">${q.questionCount} سؤال</span>` : ""}
        </button>`,
        )
        .join("");
};

// ⚠️ Stores examList[].id (the 8-char meta id), NEVER dbId — see the
// handoff doc's critical note: lesson-view.js's fetchQuizRefs() and
// _urls.js's quizUrl() both route on the meta id, not the Supabase row uuid.
window.selectQuizRef = function (sectionId, localId, metaId) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    const exam = quizExamList.find((q) => q.id === metaId);
    block.quizId = metaId;
    block.title = exam?.title || "";
    document.getElementById(`quizref-selected-${localId}`).innerHTML = exam
        ? quizRefSelectedHtml(exam)
        : `<p class="lesson-quizref-empty">لم يتم اختيار امتحان بعد.</p>`;
    document.getElementById(`quizref-results-${localId}`).innerHTML = "";
    const searchInput = document.querySelector(`.lesson-quizref-search[data-local-id="${localId}"]`);
    if (searchInput) searchInput.value = "";
    markDirty();
};

// ── Embedded question block ──────────────────────────────────────────────
// Structurally close to a single question in create-quiz.js's editor
// (prompt/options/correctIndex/explanation), but built fresh here — see
// the handoff doc's note that create-quiz.js's question markup is coupled
// to its global toolbar/quiz-wide state and isn't cleanly extractable.

function questionBlockInnerHtml(sectionId, block) {
    const optionsHtml = block.options
        .map(
            (opt, i) => `
      <div class="lesson-question-option-row">
        <input type="radio" name="correct-${escapeHtml(block._localId)}" ${block.correctIndex === i ? "checked" : ""}
          title="الإجابة الصحيحة" onchange="setQuestionCorrectIndex('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}', ${i})">
        <input type="text" class="form-input" value="${escapeHtml(opt)}" placeholder="خيار ${i + 1}"
          oninput="updateQuestionOption('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}', ${i}, this.value)">
        <button type="button" class="lesson-icon-btn lesson-icon-btn-danger" title="حذف الخيار" ${block.options.length <= 2 ? "disabled" : ""}
          onclick="removeQuestionOption('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}', ${i})">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>`,
        )
        .join("");

    const sectionOptionsForRule = lessonState.sections
        .filter((s) => s.id !== sectionId)
        .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title || `قسم ${lessonState.sections.indexOf(s) + 1}`)}</option>`)
        .join("");

    return `
    <div class="form-group">
      <label>نص السؤال</label>
      <textarea class="form-input lesson-question-prompt" rows="2" placeholder="اكتب نص السؤال…"
        oninput="updateQuestionField('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}', 'prompt', this.value)">${escapeHtml(block.prompt)}</textarea>
    </div>
    <div class="lesson-question-options">
      <label>الخيارات (اختر الإجابة الصحيحة)</label>
      ${optionsHtml}
      <button type="button" class="btn btn-secondary btn-sm" ${block.options.length >= 8 ? "disabled" : ""}
        onclick="addQuestionOption('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}')">+ خيار</button>
    </div>
    <div class="form-group">
      <label>الشرح (اختياري)</label>
      <textarea class="form-input" rows="2" placeholder="يظهر بعد الإجابة"
        oninput="updateQuestionField('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}', 'explanation', this.value)">${escapeHtml(block.explanation || "")}</textarea>
    </div>
    <div class="lesson-adaptive-rule">
      <label>إذا أجاب خطأ → اكشف قسم:</label>
      <select class="form-input" onchange="setQuestionRevealRule('${escapeHtml(sectionId)}', '${escapeHtml(block._localId)}', 'onWrong', this.value)">
        <option value="">— بدون —</option>
        ${sectionOptionsForRule}
      </select>
    </div>`;
}

window.updateQuestionField = function (sectionId, localId, field, value) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    block[field] = value;
    markDirty();
};

window.updateQuestionOption = function (sectionId, localId, index, value) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    block.options[index] = value;
    markDirty();
};

window.addQuestionOption = function (sectionId, localId) {
    const block = findBlock(sectionId, localId);
    if (!block || block.options.length >= 8) return;
    block.options.push("");
    renderSections();
    markDirty();
};

window.removeQuestionOption = function (sectionId, localId, index) {
    const block = findBlock(sectionId, localId);
    if (!block || block.options.length <= 2) return;
    block.options.splice(index, 1);
    if (block.correctIndex >= block.options.length) block.correctIndex = block.options.length - 1;
    else if (block.correctIndex > index) block.correctIndex -= 1;
    renderSections();
    markDirty();
};

window.setQuestionCorrectIndex = function (sectionId, localId, index) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    block.correctIndex = index;
    markDirty();
};

/**
 * Kept to a single-step, one-rule-per-question shape (onWrong only) — see
 * the plan's explicit "no chained branching" scoping decision. onCorrect
 * exists in the schema for completeness but this v1 authoring UI only
 * exposes onWrong, matching what api/_validateLesson.js validates and what
 * the plan's Phase 3 "done" criteria actually require.
 */
window.setQuestionRevealRule = function (sectionId, localId, ruleKey, targetSectionId) {
    const block = findBlock(sectionId, localId);
    if (!block) return;
    if (targetSectionId) {
        block[ruleKey] = { revealSection: targetSectionId };
    } else {
        delete block[ruleKey];
    }
    markDirty();
};

// =============================================================================
// MEDIA UPLOAD — ported from create-quiz.js's uploadMediaFileForMarkdown()
// (same "quiz-media" Supabase Storage bucket, per-admin path convention,
// and image-compression step; see the handoff doc — this logic is inline
// in create-quiz.js, not a shared module, so it needs porting rather than
// importing).
// =============================================================================

const MEDIA_MIME_MAP = {
    image: new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]),
    audio: new Set(["audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/aac", "audio/x-m4a", "audio/mp4"]),
    video: new Set(["video/mp4", "video/webm", "video/ogg"]),
};
const MEDIA_MAX_SIZE = { image: 5 * 1024 * 1024, audio: 10 * 1024 * 1024, video: 50 * 1024 * 1024 };
const MEDIA_EXT_MAP = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/aac": "aac",
    "audio/x-m4a": "m4a",
    "audio/mp4": "m4a",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/ogg": "ogv",
};

function detectMediaTypeFromFile(file) {
    if (!file || !file.type) return null;
    for (const type of ["image", "audio", "video"]) {
        if (MEDIA_MIME_MAP[type].has(file.type)) return type;
    }
    return null;
}

/** Ported verbatim in spirit from create-quiz.js's compressImageFile(). */
async function compressImageFile(file, { maxDim = 1600, quality = 0.82, qualityFloor = 0.6 } = {}) {
    if (!file || !file.type) return file;
    if (file.type === "image/svg+xml" || file.type === "image/gif") return file;

    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch (err) {
        console.warn("[create-lesson] image decode failed, using original", err);
        return file;
    }

    try {
        const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, w, h);
        const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", Math.max(quality, qualityFloor)));
        if (!blob || blob.size >= file.size) return file;
        const baseName = file.name ? file.name.replace(/\.[^.]+$/, "") : "image";
        return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    } catch (err) {
        console.warn("[create-lesson] image compression failed, using original", err);
        return file;
    } finally {
        bitmap.close?.();
    }
}

/** Ported from create-quiz.js's uploadMediaFileForMarkdown(). Same bucket,
 * same per-user storage path shape, same throws-with-Arabic-message
 * contract for callers to catch and surface via showNotification. */
async function uploadMediaFileForLesson(file, mediaType) {
    let workingFile = file;
    if (mediaType === "image") {
        workingFile = await compressImageFile(workingFile);
    }

    if (workingFile.size > MEDIA_MAX_SIZE[mediaType]) {
        const maxMb = MEDIA_MAX_SIZE[mediaType] / (1024 * 1024);
        throw new Error(`الحد الأقصى هو ${maxMb} ميجابايت.`);
    }
    if (workingFile.size === 0) throw new Error("الملف المحدد فارغ.");

    const client = await ensureSharedSupabaseClient();
    if (!client) throw new Error("تعذّر الاتصال بـ Supabase. حاول تسجيل الخروج والدخول مجدداً.");
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) throw new Error("جلسة Supabase منتهية. أعد تسجيل الدخول.");

    const uid = sessionData.session.user.id;
    const ext = MEDIA_EXT_MAP[workingFile.type] || "bin";
    const random = Math.random().toString(36).slice(2, 9);
    const storagePath = `${mediaType}s/${uid}/${Date.now()}-${random}.${ext}`;

    const { error: uploadError } = await client.storage
        .from("quiz-media")
        .upload(storagePath, workingFile, { contentType: workingFile.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: urlData } = client.storage.from("quiz-media").getPublicUrl(storagePath);
    if (!urlData?.publicUrl) throw new Error("تم الرفع لكن فشل توليد الرابط.");

    return { url: urlData.publicUrl };
}

// =============================================================================
// KaTeX — ported verbatim from create-quiz.js's renderMathIn()
// =============================================================================

function renderMathIn(container) {
    if (!container) return;
    if (typeof window.renderMathInElement !== "function") return;
    try {
        window.renderMathInElement(container, {
            delimiters: [
                { left: "$$", right: "$$", display: true },
                { left: "$", right: "$", display: false },
                { left: "\\(", right: "\\)", display: false },
                { left: "\\[", right: "\\]", display: true },
            ],
            throwOnError: false,
            ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
        });
    } catch (err) {
        console.error("KaTeX rendering error:", err);
    }
}

// =============================================================================
// PREVIEW
// =============================================================================

window.previewLesson = function () {
    const win = window.open("", "_blank");
    if (!win) {
        showNotification("تنبيه", "يرجى السماح بالنوافذ المنبثقة لمعاينة الدرس.", "warning");
        return;
    }
    const sectionsHtml = lessonState.sections
        .map((section, i) => {
            const blocksHtml = section.blocks
                .map((block) => {
                    if (block.type === "markdown") return `<div class="md-content">${renderMarkdown(block.body || "")}</div>`;
                    if (block.type === "media") return block.url ? mediaPreviewHtml(block) : "";
                    if (block.type === "quizRef") {
                        const exam = quizExamList.find((q) => q.id === block.quizId);
                        return `<div class="lesson-preview-quizref">امتحان مرتبط: ${escapeHtml(exam?.title || block.title || "—")}</div>`;
                    }
                    // question
                    const optionsHtml = block.options
                        .map((o, i2) => `<li${i2 === block.correctIndex ? ' class="is-correct"' : ""}>${escapeHtml(o)}</li>`)
                        .join("");
                    return `<div class="lesson-preview-question"><p class="md-content">${renderMarkdown(block.prompt || "")}</p><ol>${optionsHtml}</ol></div>`;
                })
                .join("");
            return `<section><h2>${escapeHtml(section.title || `قسم ${i + 1}`)}</h2>${blocksHtml}</section>`;
        })
        .join("<hr>");

    win.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
    <title>معاينة: ${escapeHtml(lessonState.title || "درس بدون عنوان")}</title>
    <link rel="stylesheet" href="${window.location.origin}/src/styles/markdown.css">
    <link rel="stylesheet" href="${window.location.origin}/src/features/lesson/lesson.css">
    <style>body{font-family:"IBM Plex Sans Arabic",sans-serif;max-width:760px;margin:0 auto;padding:32px 16px;} .is-correct{color:green;font-weight:700;}</style>
    </head><body><h1>${escapeHtml(lessonState.title || "درس بدون عنوان")}</h1>${sectionsHtml}</body></html>`);
    win.document.close();
};

// =============================================================================
// SAVE / PLACEMENT WIRING
// =============================================================================

function serializeContentForSave() {
    return {
        sections: lessonState.sections.map((section) => ({
            id: section.id,
            title: section.title,
            defaultHidden: section.defaultHidden,
            blocks: section.blocks.map((block) => {
                const { _localId, ...clean } = block;
                return clean;
            }),
        })),
    };
}

function readMetadataIntoState() {
    lessonState.title = document.getElementById("lessonTitleInput").value.trim();
    lessonState.courseId = document.getElementById("lessonCourseSelect").value || "";
    lessonState.folderId = document.getElementById("lessonFolderSelect").value || "";
    lessonState.fontId = document.getElementById("lessonFontSelect").value || "default";
    lessonState.highlightId = document.getElementById("lessonHighlightSelect").value || "yellow";
    syncTitleBarFromState();
}

window.saveLesson = async function () {
    if (isSaving) return;
    readMetadataIntoState();

    if (!lessonState.title) {
        showNotification("تنبيه", "عنوان الدرس مطلوب.", "warning");
        return;
    }
    if (!editingLessonId && !lessonState.courseId) {
        showNotification("تنبيه", "اختر مادة لوضع الدرس بها.", "warning");
        return;
    }

    isSaving = true;
    setAutosaveIndicator("saving");

    const content = serializeContentForSave();
    const readerPrefsDefault = { fontId: lessonState.fontId, highlightId: lessonState.highlightId };

    let result;
    if (editingLessonId) {
        // Placement (courseId/folderId) is changed only via move-item, never as
        // a side effect of this content save — see api/admin.js's
        // handleUpdateLesson header comment and the plan's ground rules.
        result = await postAdminActionLocal("update-lesson", {
            id: editingLessonId,
            title: lessonState.title,
            content,
            slug: lessonState.slug || undefined,
            readerPrefsDefault,
        });
    } else {
        result = await postAdminActionLocal("create-lesson", {
            title: lessonState.title,
            content,
            courseId: lessonState.courseId,
            folderId: lessonState.folderId || null,
            slug: lessonState.slug || undefined,
            readerPrefsDefault,
        });
    }

    isSaving = false;

    if (!result) {
        setAutosaveIndicator("error");
        return;
    }

    if (!editingLessonId && result.id) {
        editingLessonId = result.id;
        // Reflect the new id in the URL without a full reload, mirroring
        // create-quiz.js's deep-link convention (?edit=<id>).
        const url = new URL(window.location.href);
        url.searchParams.set("edit", result.id);
        window.history.replaceState({}, "", url);
    }

    isDirty = false;
    setAutosaveIndicator("saved");
    showNotification("تم الحفظ", "تم حفظ الدرس بنجاح.", "success");
};

// =============================================================================
// AUTOSAVE INDICATOR (visual only — this app's "autosave" is really a
// debounced dirty-flag prompt to hit Save; there's no local-draft concept
// for lessons per the plan's ground rules, so nothing is silently persisted
// without the admin pressing حفظ الدرس).
// =============================================================================

function setAutosaveIndicator(state) {
    const el = document.getElementById("autosaveIndicator");
    const text = document.getElementById("autosaveText");
    el.classList.remove("saving", "error");
    if (state === "saving") {
        el.classList.add("saving");
        text.textContent = "جارٍ الحفظ…";
    } else if (state === "error") {
        el.classList.add("error");
        text.textContent = "فشل الحفظ";
    } else if (state === "dirty") {
        text.textContent = "تعديلات غير محفوظة";
    } else {
        text.textContent = "محفوظ";
    }
}

function markDirty() {
    isDirty = true;
    setAutosaveIndicator("dirty");
}

function setupAutosaveWatchers() {
    // No network autosave — see header comment above. This just keeps the
    // indicator honest as metadata fields change outside the block editors
    // (which call markDirty() directly on their own oninput handlers).
    ["lessonTitleInput", "lessonCourseSelect", "lessonFolderSelect", "lessonFontSelect", "lessonHighlightSelect"].forEach(
        (id) => {
            const el = document.getElementById(id);
            el?.addEventListener("input", () => {
                if (id === "lessonCourseSelect") populateFolderSelect();
                markDirty();
            });
            el?.addEventListener("change", () => {
                if (id === "lessonCourseSelect") populateFolderSelect();
                markDirty();
            });
        },
    );

    window.addEventListener("beforeunload", (event) => {
        if (!isDirty) return;
        event.preventDefault();
        event.returnValue = "";
    });
}

// =============================================================================
// ADMIN ACTION POST (same /api/admin contract as admin-item-actions.js's
// postAdminAction — reimplemented locally since that function isn't
// exported for cross-feature import, matching the "built fresh here" note
// on fetchSharedDestinationNodes in the handoff doc).
// =============================================================================

async function postAdminActionLocal(action, body = {}) {
    const token = getToken();
    if (!token) {
        showNotification("خطأ", "يجب تسجيل الدخول كمشرف أولاً", "error");
        return null;
    }
    let res;
    try {
        res = await fetch("/api/admin", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action, ...body }),
        });
    } catch (networkErr) {
        console.error("[create-lesson] network error:", networkErr);
        showNotification("خطأ", "تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.", "error");
        return null;
    }

    let json = {};
    try {
        json = await res.json();
    } catch (_) { }

    if (!res.ok) {
        showNotification("خطأ", json.error || "حدث خطأ غير متوقع.", "error");
        return null;
    }
    return json;
}
// =============================================================================
// public/src/components/ai-agent/ai-agent-actions.js
// Modular Actions (Slash Commands) system & Registry for AI Helper.
//
// Provides:
//   1. Action Registry: Allows pages or plugins to register their own
//      slash command actions (plugin/registry pattern), with zero hardcoded
//      page knowledge in the agent core.
//   2. Built-in defaults: Sensible page-specific action sets for home,
//      create-quiz, create-lesson, lesson view, and result pages.
//   3. Slash Command Dropdown Menu (createSlashMenu): Renders an anchored
//      popover when user types `/`, supporting keyboard navigation,
//      fuzzy/substring filtering, and auto-insertion into the textarea.
//   4. Direct Execution Directives: Explicit slash commands instruct the AI
//      to execute tools immediately with NO confirmation step.
// =============================================================================

// Standard SVG icons for actions
const ICON_QUIZ = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
const ICON_FOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
const ICON_COURSE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
const ICON_QUESTION = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`;
const ICON_SPARKLE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`;
const ICON_TRASH = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
const ICON_ANALYZE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>`;
const ICON_LESSON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;

// Registry maps
const pageActionsRegistry = new Map();
const patternActionsRegistry = [];

/**
 * Registers an array of actions for a given pageKey or pattern matcher.
 * @param {string|((key: string) => boolean)|RegExp} pageKeyOrMatcher
 * @param {Array<object>} actions
 */
export function registerPageActions(pageKeyOrMatcher, actions) {
    if (typeof pageKeyOrMatcher === "function" || pageKeyOrMatcher instanceof RegExp) {
        patternActionsRegistry.push({ matcher: pageKeyOrMatcher, actions });
    } else {
        pageActionsRegistry.set(pageKeyOrMatcher, actions);
    }
}

/**
 * Unregisters actions for a given pageKey or pattern matcher.
 * @param {string|((key: string) => boolean)|RegExp} pageKeyOrMatcher
 */
export function unregisterPageActions(pageKeyOrMatcher) {
    if (typeof pageKeyOrMatcher === "function" || pageKeyOrMatcher instanceof RegExp) {
        const idx = patternActionsRegistry.findIndex((p) => p.matcher === pageKeyOrMatcher);
        if (idx !== -1) patternActionsRegistry.splice(idx, 1);
    } else {
        pageActionsRegistry.delete(pageKeyOrMatcher);
    }
}

/**
 * Retrieves the registered actions for a given pageKey.
 * Checks instanceActions first, then exact pageKey, then pattern matchers.
 * @param {string} pageKey
 * @param {Array<object>} [instanceActions]
 * @returns {Array<object>}
 */
export function getPageActions(pageKey, instanceActions = null) {
    if (Array.isArray(instanceActions)) {
        return instanceActions;
    }
    const key = pageKey || "default";
    if (pageActionsRegistry.has(key)) {
        return pageActionsRegistry.get(key) || [];
    }
    for (const entry of patternActionsRegistry) {
        if (typeof entry.matcher === "function" && entry.matcher(key)) {
            return entry.actions || [];
        }
        if (entry.matcher instanceof RegExp && entry.matcher.test(key)) {
            return entry.actions || [];
        }
    }
    return [];
}

// ── Built-in Standard Action Sets ─────────────────────────────────────────────

// Home page actions ("امتحاناتك")
const HOME_PAGE_ACTIONS = [
    {
        id: "create-quiz",
        command: "create-quiz",
        label: "إنشاء امتحان",
        description: "إنشاء امتحان جديد وحفظه مباشرة في قسم «امتحاناتك»",
        icon: ICON_QUIZ,
        systemDirective: "المستخدم يطلب إنشاء امتحان جديد بشكل صريح عبر أمر /create-quiz. نفّذ الإجراء مباشرة فوراً واستدعِ أداة create_quiz لحفظه في قسم «امتحاناتك» دون طلب أي تأكيد مسبق.",
        placeholder: "اكتب موضوع الامتحان وعدد الأسئلة...",
    },
    {
        id: "create-folder",
        command: "create-folder",
        label: "إنشاء مجلد",
        description: "إنشاء مجلد جديد لتنظيم وترتيب امتحاناتك",
        icon: ICON_FOLDER,
        systemDirective: "المستخدم يطلب إنشاء مجلد جديد صراحة عبر أمر /create-folder. استدعِ أداة create_folder فوراً دون طلب تأكيد.",
        placeholder: "اسم المجلد ومكانه...",
    },
    {
        id: "create-course",
        command: "create-course",
        label: "إنشاء مادة",
        description: "إنشاء مادة دراسية جديدة (كورس) في المستوى الأعلى",
        icon: ICON_COURSE,
        systemDirective: "المستخدم يطلب إنشاء مادة جديدة صراحة عبر أمر /create-course. استدعِ أداة create_course فوراً دون طلب تأكيد.",
        placeholder: "اسم المادة الدراسية...",
    },
];

// Create Quiz page actions ("إنشاء امتحان")
const CREATE_QUIZ_PAGE_ACTIONS = [
    {
        id: "generate-quiz",
        command: "generate-quiz",
        label: "توليد امتحان",
        description: "توليد محتوى الامتحان وتعبئته مباشرة في النموذج الحالي",
        icon: ICON_SPARKLE,
        systemDirective: "المستخدم يطلب توليد أو استبدال أسئلة الامتحان الحالي صراحة عبر أمر /generate-quiz. استدعِ أداة edit_current_quiz فوراً وضع الأسئلة الجديدة في النموذج دون طلب تأكيد.",
        placeholder: "موضوع الامتحان، عدد الأسئلة، ونوعها...",
    },
    {
        id: "add-questions",
        command: "add-questions",
        label: "إضافة أسئلة",
        description: "إضافة أسئلة جديدة إلى الامتحان الحالي مع الإبقاء على الأسئلة السابقة",
        icon: ICON_QUESTION,
        systemDirective: "المستخدم يطلب إضافة أسئلة جديدة للامتحان الحالي عبر أمر /add-questions. استدعِ أداة edit_current_quiz مع الاحتفاظ بكافة الأسئلة الحالية وإضافة الأسئلة الجديدة دون طلب تأكيد.",
        placeholder: "اكتب الأسئلة المراد إضافتها أو موضوعها...",
    },
    {
        id: "clear-quiz",
        command: "clear-quiz",
        label: "مسح النموذج",
        description: "مسح كافة حقول وأسئلة النموذج الحالي وإعادة ضبط الصفحة",
        icon: ICON_TRASH,
        systemDirective: "المستخدم يطلب مسح الصفحة بالكامل صراحة عبر أمر /clear-quiz. استدعِ أداة reset_quiz_page فوراً دون طلب تأكيد.",
    },
];

// Lesson Reader page actions ("صفحة الدرس")
const LESSON_PAGE_ACTIONS = [
    {
        id: "create-quiz",
        command: "create-quiz",
        label: "إنشاء امتحان من الدرس",
        description: "إنشاء امتحان تفاعلي شامل مبني على هذا الدرس وحفظه في «امتحاناتك»",
        icon: ICON_QUIZ,
        systemDirective: "المستخدم يطلب إنشاء امتحان تفاعلي من محتوى هذا الدرس صراحة عبر أمر /create-quiz. استخرج الأسئلة من الدرس واستدعِ أداة create_quiz فوراً لإنشاء الامتحان في «امتحاناتك» دون طلب تأكيد.",
        placeholder: "عدد الأسئلة أو الأقسام المراد التركيز عليها...",
    },
    {
        id: "explain",
        command: "explain",
        label: "شرح وتبسيط",
        description: "شرح تفصيلي ومبسط لأهم نقاط ومفاهيم هذا الدرس",
        icon: ICON_LESSON,
        systemDirective: "المستخدم يطلب شرحاً وتبسيطاً للدرس عبر أمر /explain. قدّم شرحاً تعليمياً ممتعاً ومبسطاً.",
        placeholder: "أي مفهوم تريد شرحه بالتحديد؟...",
    },
];

// Create Lesson page actions ("محرر الدروس")
const CREATE_LESSON_PAGE_ACTIONS = [
    {
        id: "add-question",
        command: "add-question",
        label: "إضافة سؤال للدرس",
        description: "صياغة وإدراج سؤال تفاعلي جديد في الدرس الحالي",
        icon: ICON_QUESTION,
        systemDirective: "المستخدم يطلب إضافة سؤال تفاعلي للدرس صراحة عبر أمر /add-question. استدعِ أداة add_lesson_question فوراً لإدراج السؤال في الدرس دون طلب تأكيد.",
        placeholder: "اكتب صيغة السؤال أو فكرته وقسمه...",
    },
    {
        id: "summarize-lesson",
        command: "summarize-lesson",
        label: "تلخيص الدرس",
        description: "توليد ملخص مركز وشامل لنقاط وأقسام الدرس",
        icon: ICON_LESSON,
        systemDirective: "المستخدم يطلب تلخيص الدرس عبر أمر /summarize-lesson. قدّم تلخيصاً واضحاً لأقسام الدرس.",
    },
];

// Result page actions ("صفحة النتيجة")
const RESULT_PAGE_ACTIONS = [
    {
        id: "analyze-result",
        command: "analyze-result",
        label: "تحليل النتيجة",
        description: "تحليل تفصيلي لأدائك في الامتحان وتحديد مواطن القوة والضعف",
        icon: ICON_ANALYZE,
        systemDirective: "المستخدم يطلب تحليلاً تفصيلياً لنتيجته عبر أمر /analyze-result. حلل الأداء وقدم تقييماً شاملاً.",
    },
    {
        id: "recommendations",
        command: "recommendations",
        label: "توصيات وخطة مراجعة",
        description: "اقتراح خطة مراجعة مخصصة تركز على الأسئلة الخاطئة والمتروكة",
        icon: ICON_SPARKLE,
        systemDirective: "المستخدم يطلب خطة وتوصيات عبر أمر /recommendations. قدم خطة مراجعة عملية ومباشرة.",
    },
];

// Register the defaults
registerPageActions("home", HOME_PAGE_ACTIONS);
registerPageActions("create", CREATE_QUIZ_PAGE_ACTIONS);
registerPageActions("create-lesson", CREATE_LESSON_PAGE_ACTIONS);
registerPageActions((key) => key && key.startsWith("lesson-"), LESSON_PAGE_ACTIONS);
registerPageActions("result", RESULT_PAGE_ACTIONS);

// ── Slash Dropdown Menu Component ─────────────────────────────────────────────

/**
 * Creates the slash command dropdown menu controller.
 * @param {object} options
 * @param {HTMLTextAreaElement} options.textarea
 * @param {() => Array<object>} options.getActions
 * @param {(action: object) => void} options.onPick
 * @param {(menu: HTMLElement, anchor: HTMLElement) => void} options.positionMenu
 * @returns {{open: (slashIndex: number) => void, close: () => void, isOpen: () => boolean, handleInput: () => boolean, handleKeydown: (e: KeyboardEvent) => boolean, getTriggerStart: () => number}}
 */
export function createSlashMenu(options) {
    const { textarea, getActions, onPick, positionMenu } = options;

    let menuEl = null;
    let triggerStart = -1; // index of the '/' character
    let activeIndex = -1;
    let currentActions = [];

    function close() {
        if (!menuEl) return;
        menuEl.remove();
        menuEl = null;
        triggerStart = -1;
        activeIndex = -1;
        currentActions = [];
        window.removeEventListener("resize", reposition);
        document.removeEventListener("click", onOutsideClick);
    }

    function reposition() {
        if (menuEl) positionMenu(menuEl, textarea);
    }

    function onOutsideClick(e) {
        if (!menuEl) return;
        if (menuEl.contains(e.target) || e.target === textarea) return;
        close();
    }

    function currentRows() {
        return Array.from(menuEl?.querySelectorAll("[data-slash-row]") || []);
    }

    function setActiveIndex(index) {
        const rows = currentRows();
        if (rows.length === 0) return;
        activeIndex = ((index % rows.length) + rows.length) % rows.length;
        rows.forEach((row, i) => {
            row.classList.toggle("is-active", i === activeIndex);
        });
        rows[activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    function buildRow(action, index) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("data-slash-row", "");
        btn.className = "ai-agent-dropdown-item ai-agent-slash-row" + (index === activeIndex ? " is-active" : "");

        btn.innerHTML = `
      <div class="ai-agent-slash-row-icon" aria-hidden="true">${action.icon || ICON_SPARKLE}</div>
      <span class="ai-agent-slash-row-text">
        <span class="ai-agent-slash-row-header">
          <span class="ai-agent-slash-row-title" dir="auto">${action.label}</span>
          <span class="ai-agent-slash-row-cmd" dir="ltr">/${action.command}</span>
        </span>
        ${action.description ? `<span class="ai-agent-slash-row-desc" dir="auto">${action.description}</span>` : ""}
      </span>
    `;

        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            onPick(action);
            close();
        });

        return btn;
    }

    function render(query = "") {
        if (!menuEl) return;
        menuEl.innerHTML = "";

        const allActions = getActions() || [];
        const cleanQuery = (query || "").trim().toLowerCase();

        currentActions = cleanQuery
            ? allActions.filter((a) => {
                const cmd = (a.command || "").toLowerCase();
                const label = (a.label || "").toLowerCase();
                const desc = (a.description || "").toLowerCase();
                return cmd.includes(cleanQuery) || label.includes(cleanQuery) || desc.includes(cleanQuery);
            })
            : allActions;

        if (currentActions.length === 0) {
            const emptyEl = document.createElement("div");
            emptyEl.className = "ai-agent-slash-empty";
            emptyEl.textContent = cleanQuery ? "لا توجد أوامر مطابقة" : "لا توجد أوامر متوفرة لهذه الصفحة";
            menuEl.appendChild(emptyEl);
            activeIndex = -1;
            reposition();
            return;
        }

        const sectionHeader = document.createElement("div");
        sectionHeader.className = "ai-agent-mention-section-header ai-agent-slash-section-header";
        sectionHeader.textContent = "الأوامر المتاحة";
        menuEl.appendChild(sectionHeader);

        activeIndex = 0;
        currentActions.forEach((action, idx) => {
            menuEl.appendChild(buildRow(action, idx));
        });

        reposition();
    }

    function open(slashCharIndex) {
        close();
        const available = getActions();
        if (!available || available.length === 0) {
            return; // No actions for this page, don't open
        }

        triggerStart = slashCharIndex;
        menuEl = document.createElement("div");
        menuEl.className = "ai-agent-dropdown-menu ai-agent-slash-menu";
        menuEl.setAttribute("role", "menu");
        menuEl.style.visibility = "hidden";
        document.body.appendChild(menuEl);

        render("");
        positionMenu(menuEl, textarea);
        menuEl.style.visibility = "visible";

        window.addEventListener("resize", reposition);
        setTimeout(() => document.addEventListener("click", onOutsideClick), 0);
    }

    function handleInput() {
        if (!menuEl) return false;
        const caret = textarea.selectionStart;

        // User erased the '/'
        if (caret <= triggerStart) {
            close();
            return false;
        }

        // Query text between '/' and caret
        const raw = textarea.value.slice(triggerStart + 1, caret);
        if (/\s/.test(raw)) {
            // Whitespace encountered — user moved on to args
            close();
            return false;
        }

        render(raw);
        return true;
    }

    function handleKeydown(e) {
        if (!menuEl) return false;

        if (e.key === "Escape") {
            close();
            return true;
        }
        if (e.key === "ArrowDown") {
            setActiveIndex(activeIndex + 1);
            return true;
        }
        if (e.key === "ArrowUp") {
            setActiveIndex(activeIndex - 1);
            return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
            if (activeIndex >= 0 && currentActions[activeIndex]) {
                onPick(currentActions[activeIndex]);
                close();
                return true;
            }
            if (currentActions.length === 0) {
                close();
                return true;
            }
        }
        return false;
    }

    return {
        open,
        close,
        isOpen: () => Boolean(menuEl),
        handleInput,
        handleKeydown,
        getTriggerStart: () => triggerStart,
    };
}

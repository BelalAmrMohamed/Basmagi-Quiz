// =============================================================================
// public/src/components/ai-agent/ai-agent-mention-menu.js
// Custom `@` mention menu — REPLACES the old shared `/`+`@` trigger menu that
// used to live inline in ai-agent-chat.js (~L2373-2547 in the pre-this-change
// version). Per the update plan: `/` is dropped entirely (nothing in this
// app used `/` for anything else, and keeping it as a second, narrower
// trigger for only the Quick-Access items would just move the "`/` and `@`
// do almost the same thing" redundancy down a level instead of removing
// it); `@` becomes the single, richer entry point covering:
//   - Quick-Access pseudo-items (@Last_Created_Quiz, @Last_Taken_Quiz,
//     @Last_Quiz_Results) — always listed first, never filtered by the
//     typed query since they're commands, not searchable content.
//   - Database items — the user's own library (instant, local) AND the
//     platform's main-page content (async, via ai-agent-library-search.js).
//   - Multi-select: picking an item attaches it and keeps the menu open
//     (marking that item as attached), instead of closing on first pick —
//     needed now that quick-access items and specific database items are
//     both reachable from the same keystroke and a user very plausibly
//     wants both in one prompt (e.g. "@Last_Quiz_Results" + a specific
//     course to ask about it against).
//
// Zero dependency on ai-agent.js (openAIAgentModal/getChatPanelForPageKey) —
// same cycle-avoidance reasoning as ai-agent-item-lookup.js's own header
// comment. This module only needs a host-supplied set of callbacks
// (see createMentionMenu's options), so ai-agent-chat.js (which already has
// pendingAttachments/renderAttachmentChips/updateSendBtnVisibility in its
// own closure) stays the single owner of attachment state; this module only
// ever calls back into it.
// =============================================================================

import { searchMyLibrary, searchPlatformLibrary } from "./ai-agent-library-search.js";
import { resolveUserItemById, listRecentUserItems } from "./ai-agent-item-lookup.js";

const PLATFORM_SEARCH_DEBOUNCE_MS = 250;

// Quick-Access pseudo-items. Each `resolve` returns the same
// {kind, id, title, summary, source, payload} shape as resolveUserItemById
// (or null if there's nothing to attach yet, e.g. no quiz taken this
// session) — the menu shows a disabled row with `emptyReason` when that
// happens, rather than silently doing nothing on click.
function buildQuickAccessItems() {
    return [
        {
            quickAccessId: "Last_Created_Quiz",
            label: "@Last_Created_Quiz",
            description: "آخر امتحان أنشأته",
            resolve: () => {
                const [latest] = listRecentUserItems("", 1);
                if (!latest) return { item: null, emptyReason: "لم تنشئ أي امتحان بعد." };
                return { item: resolveUserItemById(latest.id), emptyReason: null };
            },
        },
        {
            quickAccessId: "Last_Taken_Quiz",
            label: "@Last_Taken_Quiz",
            description: "آخر امتحان قمت بحله",
            // Backed by the same `last_quiz_result` key as @Last_Quiz_Results
            // (see quiz.js's saveResultAndRedirect-equivalent, which writes both
            // this single overwritten key AND removes that quiz's own
            // quiz_state_{id} on completion) — there's no separate taken-log, so
            // "last taken" and "last result" necessarily resolve to the same
            // underlying record today. Exposed as two distinct mentions anyway
            // because they read naturally as different asks ("what quiz did I
            // last take" vs "how did I do"), and nothing prevents a future
            // per-attempt history log from splitting them apart later without
            // changing this menu's surface.
            resolve: () => resolveLastQuizResultAttachment("taken"),
        },
        {
            quickAccessId: "Last_Quiz_Results",
            label: "@Last_Quiz_Results",
            description: "نتيجة آخر امتحان قمت بحله",
            resolve: () => resolveLastQuizResultAttachment("results"),
        },
    ];
}

/**
 * Reads `last_quiz_result` (written by quiz.js on quiz completion — see
 * that file's own comment at the write site) and shapes it into an
 * attachment. `variant` only changes the title/summary phrasing between
 * the two mentions that share this one storage key (see the
 * Last_Taken_Quiz item's own comment above) — the underlying payload is
 * identical either way.
 * @param {"taken"|"results"} variant
 */
function resolveLastQuizResultAttachment(variant) {
    let result = null;
    try {
        result = JSON.parse(localStorage.getItem("last_quiz_result"));
    } catch {
        result = null;
    }
    if (!result) {
        return {
            item: null,
            emptyReason: "لم تقم بحل أي امتحان في هذا الجهاز بعد.",
        };
    }

    const scorePart = `الدرجة: ${result.score ?? "?"}/${result.total ?? "?"}`;
    const title = variant === "results"
        ? `نتيجة: ${result.examTitle || "امتحان"}`
        : (result.examTitle || "آخر امتحان تم حله");
    const summary = variant === "results"
        ? scorePart
        : `${scorePart} — عدد الأسئلة: ${result.totalQuestions ?? result.questions?.length ?? 0}`;

    return {
        item: {
            kind: "quiz",
            id: result.examId || result.quizDbId || `last-quiz-result-${variant}`,
            dbId: result.quizDbId || null,
            title,
            summary,
            source: "local",
            // Full result payload (score/answers/questions), not just the quiz's
            // own questions — @Last_Quiz_Results specifically needs the score
            // and per-question correctness to be useful for "how did I do"-style
            // follow-ups; the quiz's `questions` array alone (present on any
            // other quiz attachment) wouldn't carry that.
            payload: result,
        },
        emptyReason: null,
    };
}

/**
 * @param {object} options
 * @param {HTMLTextAreaElement} options.textarea
 * @param {() => number} options.getPendingCount - current pendingAttachments.length
 * @param {number} options.maxPending
 * @param {(id: string) => boolean} options.isAttached - whether an id (or
 *   quickAccessId) is already in pendingAttachments, so picked rows can
 *   render as checked instead of closing the menu.
 * @param {(attachment: object) => void} options.onPick - called with a
 *   resolved {kind, id, title, ...} attachment when the user picks a row.
 * @param {(startIndex: number, endIndexExclusive: number) => void} options.onConsumeTriggerText -
 *   called to remove the `@`+query text from the textarea after a pick.
 * @param {{quiz: string, course: string, folder: string}} options.icons - the
 *   host's existing ATTACHMENT_*_ICON_SVG constants, reused rather than
 *   duplicated here.
 * @returns {{open: (startIndex: number) => void, close: () => void, isOpen: () => boolean, handleInput: () => void, handleKeydown: (e: KeyboardEvent) => boolean}}
 */
export function createMentionMenu(options) {
    const {
        textarea,
        getPendingCount,
        maxPending,
        isAttached,
        onPick,
        onConsumeTriggerText,
        icons,
        positionMenu, // (menuEl, anchorEl) => void — host's positionExamDropdownMenu
    } = options;

    let menuEl = null;
    let triggerStart = -1;
    // True right after a pick, until the next keystroke — the `@`+query text
    // was just removed from the textarea (see pickAndKeepOpen), so there's
    // momentarily no `@` character at triggerStart for handleInput's normal
    // "did the trigger char survive" check to find. Multi-select needs the
    // menu to stay open and armed at the (now-empty) query position rather
    // than requiring the user to type a fresh `@` for every additional pick.
    let justConsumedByPick = false;
    let platformDebounceTimer = null;
    let platformSearchToken = 0; // guards against a stale slow search overwriting a newer one
    let activeIndex = -1; // keyboard nav

    function iconFor(kind) {
        if (kind === "course") return icons.course;
        if (kind === "folder") return icons.folder;
        return icons.quiz;
    }

    function close() {
        if (!menuEl) return;
        menuEl.remove();
        menuEl = null;
        triggerStart = -1;
        activeIndex = -1;
        clearTimeout(platformDebounceTimer);
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
        return Array.from(menuEl?.querySelectorAll("[data-mention-row]") || []);
    }

    function setActiveIndex(index) {
        const rows = currentRows().filter((row) => !row.hasAttribute("disabled"));
        if (rows.length === 0) return;
        activeIndex = ((index % rows.length) + rows.length) % rows.length;
        rows.forEach((row) => row.classList.remove("is-active"));
        rows[activeIndex]?.classList.add("is-active");
        rows[activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    function buildRow({ id, kind, title, description, disabled, checked }, onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("data-mention-row", "");
        btn.className = "exam-action-btn ai-agent-mention-row" + (checked ? " is-attached" : "");
        if (disabled) btn.setAttribute("disabled", "");
        btn.innerHTML = `
      ${iconFor(kind)}
      <span class="ai-agent-mention-row-text">
        <span class="ai-agent-mention-row-title">${title}</span>
        ${description ? `<span class="ai-agent-mention-row-desc">${description}</span>` : ""}
      </span>
      ${checked ? '<span class="ai-agent-mention-row-check" aria-hidden="true">✓</span>' : ""}
    `;
        if (!disabled) {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                onClick();
            });
        }
        return btn;
    }

    function renderSectionHeader(text) {
        const header = document.createElement("div");
        header.className = "ai-agent-mention-section-header";
        header.textContent = text;
        return header;
    }

    function pickAndKeepOpen(attachment, query) {
        if (!attachment) return;
        if (getPendingCount() >= maxPending) return;
        onPick(attachment);
        // Consume the `@`+query text immediately (same as the old menu did on
        // every pick) — otherwise it lingers in the input alongside the chip
        // that now represents it. triggerStart - 1 is the literal `@` index
        // (see open()'s own comment on the triggerStart convention). Unlike
        // the old menu, DON'T close(): the menu re-renders in place so the
        // picked row flips to "attached" and the user can immediately pick a
        // second item (see this module's own header comment on multi-select).
        onConsumeTriggerText(triggerStart - 1, textarea.selectionStart);
        justConsumedByPick = true;
        render("");
    }

    async function render(query) {
        if (!menuEl) return;
        menuEl.innerHTML = "";
        activeIndex = -1;

        const atCap = getPendingCount() >= maxPending;
        if (atCap) {
            const full = document.createElement("div");
            full.className = "ai-agent-trigger-menu-empty";
            full.textContent = "تم الوصول للحد الأقصى من المرفقات.";
            menuEl.appendChild(full);
            return;
        }

        // ── Quick-Access section — unfiltered by query, always visible ──
        menuEl.appendChild(renderSectionHeader("وصول سريع"));
        buildQuickAccessItems().forEach((qa) => {
            const attachedAlready = isAttached(qa.quickAccessId);
            const { item, emptyReason } = qa.resolve();
            const row = buildRow(
                {
                    id: qa.quickAccessId,
                    kind: item?.kind || "quiz",
                    title: qa.label,
                    description: emptyReason || qa.description,
                    disabled: !item,
                    checked: attachedAlready,
                },
                () => pickAndKeepOpen(item ? { ...item, id: item.id || qa.quickAccessId } : null, query),
            );
            menuEl.appendChild(row);
        });

        // ── Database section — local results instant, platform results async ──
        menuEl.appendChild(renderSectionHeader("مكتبتك والصفحة الرئيسية"));
        const localResultsHost = document.createElement("div");
        menuEl.appendChild(localResultsHost);
        const platformResultsHost = document.createElement("div");
        menuEl.appendChild(platformResultsHost);

        const renderLocal = () => {
            localResultsHost.innerHTML = "";
            const items = searchMyLibrary(query, 6);
            items.forEach((it) => {
                const row = buildRow(
                    { id: it.id, kind: it.kind, title: it.title, checked: isAttached(it.id) },
                    () => pickAndKeepOpen(resolveUserItemById(it.id), query),
                );
                localResultsHost.appendChild(row);
            });
        };
        renderLocal();

        platformResultsHost.innerHTML = '<div class="ai-agent-mention-loading">جارٍ البحث في الصفحة الرئيسية…</div>';
        reposition();

        // Debounced: only the network half. Local results above already
        // re-rendered synchronously on this exact call, so typing quickly
        // never delays what's already resolvable instantly — it only delays
        // (and coalesces) the repeated Supabase-backed manifest reads.
        const myToken = ++platformSearchToken;
        clearTimeout(platformDebounceTimer);
        platformDebounceTimer = setTimeout(async () => {
            if (myToken !== platformSearchToken || !menuEl) return; // superseded before it even started
            try {
                const platformItems = await searchPlatformLibrary(query, 6);
                if (myToken !== platformSearchToken || !menuEl) return; // stale / menu closed meanwhile
                platformResultsHost.innerHTML = "";
                if (platformItems.length === 0 && searchMyLibrary(query, 1).length === 0 && query) {
                    const empty = document.createElement("div");
                    empty.className = "ai-agent-trigger-menu-empty";
                    empty.textContent = "لا توجد نتائج مطابقة.";
                    platformResultsHost.appendChild(empty);
                } else {
                    platformItems.forEach((it) => {
                        const row = buildRow(
                            { id: it.id, kind: it.kind, title: it.title, checked: isAttached(it.id) },
                            () => pickAndKeepOpen({ ...it }, query),
                        );
                        platformResultsHost.appendChild(row);
                    });
                }
            } catch {
                if (myToken !== platformSearchToken || !menuEl) return;
                platformResultsHost.innerHTML = '<div class="ai-agent-trigger-menu-empty">تعذّر البحث في الصفحة الرئيسية حاليًا.</div>';
            }
            reposition();
        }, PLATFORM_SEARCH_DEBOUNCE_MS);
    }

    // `atCharIndex` is the index of the literal `@` character in
    // textarea.value. Internally, triggerStart is normalized to point one
    // past it (the first query character) — the same convention re-arming
    // after a pick uses (see handleInput's justConsumedByPick branch), so
    // both code paths that set triggerStart agree on what it means.
    function open(atCharIndex) {
        close();
        triggerStart = atCharIndex + 1;
        menuEl = document.createElement("div");
        menuEl.className = "exam-dropdown-menu ai-agent-mention-menu";
        menuEl.setAttribute("role", "menu");
        menuEl.style.visibility = "hidden";
        document.body.appendChild(menuEl);
        render("");
        positionMenu(menuEl, textarea);
        menuEl.style.visibility = "visible";
        window.addEventListener("resize", reposition);
        // Deferred one tick — same reasoning as the menu this replaces: the
        // very `@` keydown that opens it is still bubbling, and a click-type
        // outside-click listener registered synchronously could otherwise
        // race it shut immediately on some input paths.
        setTimeout(() => document.addEventListener("click", onOutsideClick), 0);
    }

    function handleInput() {
        if (!menuEl) return false;
        const caret = textarea.selectionStart;

        if (justConsumedByPick) {
            // Right after a pick, the `@`+query text was already removed from
            // the textarea (see pickAndKeepOpen) and the caret sits exactly
            // where it was removed from. Re-anchor triggerStart there — as if a
            // fresh `@` had just been typed at that position — so multi-select
            // keeps working without the user retyping `@`. Only re-arms once per
            // pick: any keystroke (including ones that immediately close the
            // menu below) clears this flag.
            justConsumedByPick = false;
            triggerStart = caret;
        }

        if (caret <= triggerStart) {
            close();
            return false;
        }
        const query = textarea.value.slice(triggerStart, caret);
        if (/\s/.test(query)) {
            close();
            return false;
        }
        clearTimeout(platformDebounceTimer);
        // Local results re-render immediately inside render(); the debounce
        // here only throttles how often the platform network call fires while
        // the user is still actively typing.
        render(query);
        return true;
    }

    function handleKeydown(e) {
        if (!menuEl) return false;
        // Escape backs out WITHOUT consuming the typed `@`+query text — the
        // user is cancelling the mention, not selecting anything, so the text
        // they typed should stay editable exactly as-is (matches the menu this
        // replaces: Escape there was a plain close(), no text removal either).
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
        if (e.key === "Enter" && activeIndex >= 0) {
            const rows = currentRows().filter((row) => !row.hasAttribute("disabled"));
            rows[activeIndex]?.click();
            return true;
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
// public/src/features/home/move-to-dialog.js
// ============================================================================
// SHARED MOVE-TO DIALOG — storage-agnostic folder-tree picker.
// ============================================================================
// Extracted out of user-quizzes-folders.js (see
// docs/plans/Admin actions and deletion flow for quizzes.md, step 5) so the
// same visual tree/breadcrumb/guide-line picker can be reused by BOTH:
//   - the "امتحاناتك" (/#my-quizzes) localStorage area (its own adapter
//     lives in user-quizzes-folders.js, built by
//     createLocalUserQuizzesMoveSource()), and
//   - the shared/admin Supabase-backed courses+folders area (its adapter
//     will be built alongside the dropdown wiring in step 6, once there's a
//     concrete "fetch the admin's course/folder tree" call site to build it
//     from).
//
// This module owns ALL of the dialog's rendering — DOM construction, the
// indented tree with per-row ancestor guide lines, disabled-state styling
// and tooltips, the "current location" badge — and none of the storage
// logic. Every question that depends on where the data actually lives (what
// the destinations are, whether a given destination is valid, how to
// perform the move) is delegated to an injected `MoveSource` object, so
// this file never reads localStorage or calls Supabase/fetch itself.
//
// ── MoveSource interface ────────────────────────────────────────────────────
// An adapter passed to openMoveToDialog() must provide:
//
//   itemLabel: string
//     Dialog subtitle text, e.g. `"عنصرين"` or `"العنصر الفلاني"` — already
//     formatted by the caller (pluralization/quoting is caller-specific).
//
//   rootLabel: string
//     Label for the depth-0 "root" destination row (e.g. "امتحاناتك
//     (الرئيسية)" for the local tree). A MoveSource with no meaningful root
//     destination (nothing can ever move to the top level) can omit this —
//     see includeRoot below.
//
//   includeRoot: boolean
//     Whether the root row should be rendered at all. The shared/admin tree
//     has no "root" (every quiz/folder must belong to a course), so its
//     future adapter will set this false and instead seed the tree directly
//     from courseNodes.
//
//   isCurrentDestination(nodeId): boolean
//     nodeId is null for the root row. True marks the row as the "current
//     location" badge instead of a real destination.
//
//   getNodes(): Array<{ id, parentId, title, icon }>
//     Every candidate destination node (folders, and — for the local
//     tree — courses too, since courses are just another node type there).
//     Flat list; this module does the parent/child grouping itself so a
//     MoveSource never needs to reason about depth or sibling order.
//
//   getDisabledReason(nodeId): string|null
//     null = a valid, clickable destination. Any other string is shown as
//     both the row's disabled state and its title="" tooltip. Centralizes
//     every "why can't I drop here" rule (self/descendant cycles, the
//     course-is-always-top-level rule, same-level name collisions, ...) on
//     the adapter side, where the actual data lives.
//
//   isFullyBlocked(nodeId): boolean
//     True when nothing under this node could ever be a valid destination
//     either (e.g. the whole subtree is a descendant of every item being
//     moved) — lets the dialog skip descending into that branch instead of
//     rendering disabled noise.
//
//   moveTo(nodeId): Promise<{ moved: number, blocked: number }> | { moved, blocked }
//     Performs the actual move (nodeId === null means "to root"). The
//     dialog itself owns the resulting notification/close/re-render
//     sequence so that messaging stays identical no matter which storage
//     backend is behind it.
//
//   onMoved(): void
//     Called once after a successful move (moved > 0), once the dialog has
//     already closed — e.g. renderUserQuizzesView() for the local tree, or
//     whatever refresh the admin tree needs later.
// ============================================================================

/**
 * Opens the folder-tree picker modal against an injected, storage-agnostic
 * MoveSource (see the interface doc above). Callers construct the
 * MoveSource themselves — this function only renders the tree and wires up
 * clicks; it never touches localStorage or the network directly.
 *
 * @param {object} source - a MoveSource, see interface doc above.
 */
export function openMoveToDialogWithSource(source) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay move-to-dialog-overlay";

    const card = document.createElement("div");
    card.className = "modal-card move-to-dialog-card";

    const closeDialog = () => overlay.remove();

    card.innerHTML = `
    <div class="move-to-dialog-header">
      <div class="move-to-dialog-header-text">
        <h3 class="move-to-dialog-title">نقل إلى</h3>
        <p class="move-to-dialog-subtitle">اختر الوجهة لنقل ${source.itemLabel}</p>
      </div>
      <button type="button" class="move-to-dialog-close" aria-label="إغلاق">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
    <div class="move-to-dialog-tree" role="tree" aria-label="اختر وجهة النقل"></div>
  `;

    const treeEl = card.querySelector(".move-to-dialog-tree");
    const allNodes = source.getNodes();

    /**
     * One row = one button styled as a real tree node: an icon, a label, and
     * (for nested rows) a set of vertical guide lines + one elbow, drawn as
     * absolutely-positioned spans anchored to the ROW ITSELF — not to a
     * wrapper div shared by a sibling group.
     *
     * See the CSS block in index.css ("MOVE-TO DIALOG") for the full history
     * of why guides are drawn per-row instead of per-sibling-group: a
     * per-wrapper border-right reads as one continuous line only while every
     * ancestor level happens to have 2+ children, and breaks the instant any
     * ancestor is a lone child. Drawing one guide span per ancestor level on
     * every row independently keeps every level's line pixel-continuous
     * regardless of how many siblings any ancestor has.
     */
    function addNode(container, label, id, icon, depth, { isCurrent = false, disabledReason = null, guides = [] } = {}) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "move-to-dialog-node";
        row.setAttribute("role", "treeitem");
        row.dataset.depth = String(depth);
        row.style.setProperty("--depth", String(depth));
        if (isCurrent) row.classList.add("move-to-dialog-node--current");
        if (disabledReason) {
            row.classList.add("move-to-dialog-node--disabled");
            row.disabled = true;
            row.title = disabledReason;
        }

        // One straight pass-through guide per ANCESTOR level (everything
        // before this row's own level) — always a full-height vertical line,
        // since an ancestor's line only ever continues or doesn't; it never
        // elbows for a row that isn't its own. Then this row's OWN level gets
        // a short elbow into the label, plus (only when a later sibling still
        // follows this row at its own level) a continuation of the vertical
        // line past the elbow so the next sibling's guide has something to
        // join. Depth 0 (root) has no ancestors and is never itself nested, so
        // it renders no guides at all.
        let guidesHtml = "";
        for (let level = 0; level < depth; level += 1) {
            const isOwnLevel = level === depth - 1;
            const continues = guides[level];
            const classes = ["move-to-dialog-guide"];
            if (isOwnLevel) {
                classes.push("move-to-dialog-guide--elbow");
                if (continues) classes.push("move-to-dialog-guide--continues");
            } else if (continues) {
                classes.push("move-to-dialog-guide--pass");
            } else {
                continue; // ancestor's line already terminated above this row
            }
            guidesHtml += `<span class="${classes.join(" ")}" style="--level:${level}" aria-hidden="true"></span>`;
        }

        row.innerHTML =
            guidesHtml +
            `<span class="move-to-dialog-node-icon" aria-hidden="true">${icon}</span>` +
            `<span class="move-to-dialog-node-label">${label}</span>` +
            (isCurrent ? `<span class="move-to-dialog-node-badge">الموقع الحالي</span>` : "");

        if (!disabledReason) {
            row.onclick = async () => {
                const { moved, blocked, saveFailed } = await source.moveTo(id);
                closeDialog();
                if (moved > 0) {
                    source.showNotification(
                        "تم النقل",
                        moved > 1 ? `تم نقل ${moved} عنصر بنجاح.` : "تم نقل العنصر بنجاح.",
                        "success",
                    );
                }
                // saveFailed (moveItemsToFolder couldn't persist the write —
                // see saveUserQuizzes in user-quizzes-folders.js) is checked
                // first: it's mutually exclusive with a real placement-rule
                // block (blocked === 0 in that case), and needs its own
                // message so a storage-quota failure isn't misattributed to
                // a name collision or move restriction the user didn't
                // actually hit.
                if (saveFailed) {
                    // saveUserQuizzes already showed its own storage-specific
                    // notification — nothing further needed here.
                } else if (blocked > 0) {
                    // Worded generically enough to cover either cause a blocked move
                    // can have (self/descendant cycle, course-top-level rule, or a
                    // same-level name collision at the destination) instead of
                    // misattributing it to just one of them.
                    source.showNotification(
                        "تعذر نقل بعض العناصر",
                        "لا يمكن نقل بعض العناصر إلى هذه الوجهة (تعارض في الاسم، أو قيود على نقل المجلدات/المواد).",
                        "warning",
                    );
                }
                if (moved > 0) source.onMoved();
            };
        }
        container.appendChild(row);
    }

    if (source.includeRoot) {
        // Root option. Depth 0, so it draws no ancestor guides.
        addNode(treeEl, source.rootLabel, null, "🏠", 0, {
            isCurrent: source.isCurrentDestination(null),
        });
    }

    // Recursively render the real destination tree — flat DOM (every row
    // appended straight into treeEl, no per-level wrapper divs), with each
    // row independently drawing its own full set of ancestor guide lines
    // (see addNode above). `guides` is this branch's own ancestor chain,
    // extended by one entry per recursive call; a level's entry is `true` for
    // every row up to and including the sibling right before the last one,
    // `false` once that level has no sibling left below it.
    function appendChildren(container, parentId, depth, guides) {
        const siblings = allNodes.filter((n) => (n.parentId || null) === parentId);
        if (!siblings.length) return;

        siblings.forEach((node, index) => {
            const isCurrent = source.isCurrentDestination(node.id);
            const isLastSibling = index === siblings.length - 1;
            const disabledReason = source.getDisabledReason(node.id);

            // This row's own level continues (stays `true`) for every sibling
            // except the last, matching exactly which rows below it still need
            // this level's vertical line.
            const rowGuides = [...guides, !isLastSibling];

            addNode(treeEl, node.title, node.id, node.icon, depth, {
                isCurrent,
                disabledReason,
                guides: rowGuides,
            });

            // Still descend into disabled branches (a disabled ancestor doesn't
            // imply its children are also invalid destinations for a *different*
            // moving item in a multi-select) unless the MoveSource says nothing
            // under this exact subtree could ever be valid either, in which case
            // descending would just be noise.
            if (!source.isFullyBlocked(node.id)) appendChildren(container, node.id, depth + 1, rowGuides);
        });
    }
    appendChildren(treeEl, null, source.includeRoot ? 1 : 0, []);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    card.querySelector(".move-to-dialog-close").onclick = closeDialog;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeDialog();
    };
    document.addEventListener(
        "keydown",
        function onEsc(e) {
            if (e.key === "Escape") {
                closeDialog();
                document.removeEventListener("keydown", onEsc);
            }
        },
    );
}
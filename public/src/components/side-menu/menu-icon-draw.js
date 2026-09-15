// ============================================================================
// public/src/components/side-menu/menu-icon-draw.js
// Normalises side-menu / bottom-nav icon geometry so the CSS line-draw hover
// animation can run on ANY icon without per-icon hand-tuning.
// ============================================================================
//
// WHY THIS EXISTS
// ---------------
// The old `menu-item-draw` keyframe animated `stroke-dashoffset` to a
// hard-coded 60, but nothing ever set `stroke-dasharray` on the icons. With no
// dash pattern there is nothing to offset, so the keyframe was a silent no-op
// on every single menu item — the icons just sat there.
//
// The obvious fix (copy profile.css's `.section-icon` approach: a fixed
// `stroke-dasharray: 60`) does not generalise here. Menu icons are Lucide
// glyphs whose sub-shapes differ in length by two orders of magnitude — the
// keyboard icon alone mixes a ~60-unit rounded rect with `M10 8h.01` dots that
// are 0.01 units long. A single dash length either under-draws the long paths
// (leaving them permanently dashed) or blows straight past the short ones
// (making them blink out of existence). profile.css papered over this by
// hand-tuning two separate values (60 for `.section-icon`, 1 for
// `.empty-state-icon`); that does not scale to ~20 nav icons.
//
// HOW IT WORKS
// ------------
// Every drawable shape gets `pathLength="1"`, which re-maps its intrinsic
// length onto a normalised 0→1 scale. After that a single `stroke-dasharray: 1`
// covers each shape exactly once, and a `stroke-dashoffset` sweep from 0→1
// wipes it end-to-end — identically for the 60-unit rect and the 0.01-unit dot.
// One CSS rule then drives every icon on the page.
//
// This is done in JS rather than by editing the inline SVG markup because the
// same icons are authored in six-plus places (documents-shell.js, side-menu.js,
// quiz.html, and each page's own sidebar copy). Stamping the attribute at
// runtime keeps all of them in sync and means new menu items pick the
// animation up for free.
//
// Prefer this over measuring `getTotalLength()` per shape: that forces layout
// on every icon at startup, and it is unavailable on `<rect>` / `<circle>` /
// `<line>` in several engines — which is most of the Lucide icon set.

/** Shapes that render a stroke and therefore can be "drawn". */
const DRAWABLE_SHAPES = "path, line, polyline, polygon, circle, ellipse, rect";

/**
 * Icon containers that opt into the draw animation. `.menu-item` covers the
 * desktop sidebar rail and the mobile bottom-sheet rows; `.bottom-nav-icon`
 * covers the phone bottom nav, where the same effect fires on tap (`:active`)
 * since there is no hover there.
 */
const ICON_SCOPES = ".menu-item svg, .bottom-nav-icon svg";

/** Class the CSS hooks onto. Mirrors profile.css's `.icon-line` convention. */
const LINE_CLASS = "menu-icon-line";

/**
 * Filled-glyph icons (Material-style solid paths, the Google "G" mark) have no
 * stroke to draw — dashing them would do nothing but cost attribute writes.
 * Lucide icons all carry stroke="currentColor" on the root <svg>, which makes
 * this a reliable discriminator.
 */
function isStrokeIcon(svg) {
    const stroke = svg.getAttribute("stroke");
    return Boolean(stroke) && stroke !== "none";
}

/**
 * Decorative solid dots (e.g. the palette icon's `<circle r=".5"
 * fill="currentColor">`) are fills living inside an otherwise stroked icon.
 * They have no outline, so leave them alone.
 */
function isFilledShape(shape) {
    const fill = shape.getAttribute("fill");
    return Boolean(fill) && fill !== "none";
}

/**
 * Stamps one <svg> so its strokes can be drawn. Idempotent: a `data-icon-draw`
 * flag means repeat calls (re-renders, observer churn) cost a single attribute
 * read instead of a full subtree walk.
 *
 * @param {SVGElement} svg
 */
function prepareIcon(svg) {
    if (svg.dataset.iconDraw === "ready") return;
    if (!isStrokeIcon(svg)) {
        // Mark it anyway so we never re-test this icon.
        svg.dataset.iconDraw = "skip";
        return;
    }

    svg.querySelectorAll(DRAWABLE_SHAPES).forEach((shape) => {
        if (isFilledShape(shape)) return;
        // pathLength normalises this shape's length to 1 — see the header comment.
        if (!shape.hasAttribute("pathLength")) {
            shape.setAttribute("pathLength", "1");
        }
        shape.classList.add(LINE_CLASS);
    });

    svg.dataset.iconDraw = "ready";
}

/**
 * Prepares every menu / bottom-nav icon under `root`. Safe to call repeatedly
 * and safe to call on pages that have no sidebar at all.
 *
 * @param {ParentNode} [root=document]
 */
export function prepareMenuIconDrawing(root = document) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    root.querySelectorAll(ICON_SCOPES).forEach(prepareIcon);
}

/**
 * Keeps late-injected menu items animated. Several menu rows are appended well
 * after first paint — the mobile admin / reports buttons in side-menu.js, the
 * docs links in documents-shell.js, the profile row that gets swapped for a
 * dropdown trigger — and a one-shot pass at DOMContentLoaded would miss any
 * that land afterwards.
 *
 * Batched on rAF so a burst of insertions triggers one pass, not one per node.
 *
 * @returns {() => void} disconnect function
 */
export function observeMenuIcons() {
    if (typeof MutationObserver !== "function") return () => { };

    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            prepareMenuIconDrawing(document);
        });
    });

    const watch = (node) => {
        if (node) observer.observe(node, { childList: true, subtree: true });
    };

    watch(document.getElementById("sidebar"));
    watch(document.getElementById("bottomNav"));

    return () => observer.disconnect();
}

/**
 * Convenience bootstrap: runs an initial pass as soon as the DOM is ready and
 * then watches for injected items.
 */
export function initMenuIconDrawing() {
    const start = () => {
        prepareMenuIconDrawing(document);
        observeMenuIcons();
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
}
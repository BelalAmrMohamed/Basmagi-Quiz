// ============================================================================
// public/src/shared/color-picker.js
// GOOGLE-DOCS-STYLE COLOR PICKER — shared by create-quiz.js and
// create-lesson.js's "تظليل" (highlight) toolbar dropdown.
// ============================================================================
// Why a shared module: the two editors keep their own copy of nearly every
// toolbar behavior (see the header of create-lesson.js), and the old
// six-swatch highlight menu drifted between them. The palette and picker
// behavior live here once; each page only supplies (a) the menu element and
// (b) an `onPick(hex)` callback that applies the color to its active field.
//
// OUTPUT CONTRACT: `onPick` always receives a lowercase `#rrggbb` string.
// That is deliberate — markdown.js's applyInline() only accepts
// `==text==(color)` where color matches /[a-zA-Z0-9#]{1,20}/, so a hex value
// is always safe to place in the style attribute and needs no engine change
// (and therefore no change to export-to-quiz.js's .toString() serialization).
//
// PALETTE SHAPE (10 columns x 8 rows, like Docs):
//   row 0      grayscale, black -> white
//   row 1      the 10 vivid base hues
//   rows 2-4   progressively darker-to-lighter TINTS of each hue
//              (Docs order: lightest first, i.e. "light 3", "light 2", "light 1")
//   rows 5-7   progressively darker SHADES ("dark 1", "dark 2", "dark 3")
// Rows 2-7 are computed from the row-1 hues, so changing a base hue changes
// its whole column consistently.
// ============================================================================

const GRAYS = ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"];

// Base hues, left to right (the same ten Docs uses).
const HUES = [
    { hex: "#980000", label: "أحمر داكن" },
    { hex: "#ff0000", label: "أحمر" },
    { hex: "#ff9900", label: "برتقالي" },
    { hex: "#ffff00", label: "أصفر" },
    { hex: "#00ff00", label: "أخضر" },
    { hex: "#00ffff", label: "سماوي" },
    { hex: "#4a86e8", label: "أزرق فاتح" },
    { hex: "#0000ff", label: "أزرق" },
    { hex: "#9900ff", label: "بنفسجي" },
    { hex: "#ff00ff", label: "أرجواني" },
];

// Mix ratios toward white (tints) / toward black (shades). Values chosen to
// approximate Docs' "light 3/2/1" and "dark 1/2/3" steps.
const TINT_STEPS = [0.8, 0.6, 0.4]; // light 3, light 2, light 1
// Capped well short of black: Docs' darkest row is still clearly its hue, and a
// near-black swatch would be indistinguishable from the grayscale row above.
const SHADE_STEPS = [0.2, 0.4, 0.6]; // dark 1, dark 2, dark 3

const HEX_RE = /^#[0-9a-f]{6}$/i;

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
    const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
}

/** Mix `hex` toward `target` ([r,g,b]) by ratio t in [0,1]. */
function mix(hex, target, t) {
    const c = hexToRgb(hex);
    return rgbToHex(c.map((v, i) => v + (target[i] - v) * t));
}

/** @returns {string[][]} 8 rows x 10 columns of #rrggbb values. */
export function buildPalette() {
    const rows = [GRAYS, HUES.map((h) => h.hex)];
    for (const t of TINT_STEPS) rows.push(HUES.map((h) => mix(h.hex, [255, 255, 255], t)));
    for (const t of SHADE_STEPS) rows.push(HUES.map((h) => mix(h.hex, [0, 0, 0], t)));
    return rows.map((row) => row.map((hex) => hex.toLowerCase()));
}

/** Normalizes "#abc" / "#AABBCC" to "#aabbcc"; returns null if not a valid color. */
export function normalizeHex(value) {
    if (typeof value !== "string") return null;
    let v = value.trim().toLowerCase();
    if (!v.startsWith("#")) v = `#${v}`;
    if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    return HEX_RE.test(v) ? v : null;
}

const RECENT_KEY = "md_highlight_recent_colors";
const RECENT_MAX = 10;

function readRecent() {
    try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
        return Array.isArray(parsed) ? parsed.map(normalizeHex).filter(Boolean).slice(0, RECENT_MAX) : [];
    } catch {
        return [];
    }
}

function rememberColor(hex) {
    try {
        const next = [hex, ...readRecent().filter((c) => c !== hex)].slice(0, RECENT_MAX);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
        /* storage unavailable — recents are a convenience, not a requirement */
    }
}

const PLUS_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>';
const EYEDROPPER_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/></svg>';
const NO_COLOR_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>';

function swatchHtml(hex, label = "") {
    const title = label ? `${label} ${hex}` : hex;
    return `<button type="button" class="cp-swatch" data-cp-color="${hex}" style="--cp-color:${hex}" title="${title}" aria-label="${title}" role="menuitem"></button>`;
}

/**
 * Inner markup for the picker menu. Static markup only — nothing user-derived
 * is interpolated (every value comes from the constants above), so there is no
 * escaping concern here.
 */
export function buildColorPickerHtml() {
    const palette = buildPalette();
    const grid = palette
        .map((row, r) => {
            const cells = row
                .map((hex, c) => swatchHtml(hex, r === 1 ? HUES[c].label : ""))
                .join("");
            return `<div class="cp-row" role="group">${cells}</div>`;
        })
        .join("");

    const eyedropper =
        typeof window !== "undefined" && "EyeDropper" in window
            ? `<button type="button" class="cp-tool" data-cp-eyedropper title="التقاط لون من الشاشة" aria-label="التقاط لون من الشاشة" role="menuitem">${EYEDROPPER_ICON}</button>`
            : "";

    return `
    <button type="button" class="cp-reset" data-cp-color="" role="menuitem">${NO_COLOR_ICON}<span>اللون الافتراضي</span></button>
    <div class="cp-grid">${grid}</div>
    <div class="cp-section-title">ألوان حديثة</div>
    <div class="cp-recent" data-cp-recent></div>
    <div class="cp-section-title">لون مخصص</div>
    <div class="cp-custom">
      <label class="cp-tool cp-tool--plus" title="لون مخصص" aria-label="لون مخصص">
        ${PLUS_ICON}
        <input type="color" class="cp-native" value="#ffff00" aria-label="اختيار لون مخصص">
      </label>
      ${eyedropper}
      <input type="text" class="cp-hex" placeholder="#RRGGBB" maxlength="7" dir="ltr" spellcheck="false" aria-label="قيمة اللون بصيغة HEX">
      <button type="button" class="cp-apply" data-cp-apply>تطبيق</button>
    </div>`;
}

function renderRecent(menu) {
    const host = menu.querySelector("[data-cp-recent]");
    if (!host) return;
    const recent = readRecent();
    const title = host.previousElementSibling;
    host.innerHTML = recent.map((hex) => swatchHtml(hex)).join("");
    // Hide the whole section (title + row) until there is something to show.
    host.style.display = recent.length ? "" : "none";
    if (title) title.style.display = recent.length ? "" : "none";
}

/**
 * Fills `menu` with the picker and wires it up.
 *
 * @param {HTMLElement} menu   the .gmd-dropdown-menu element to populate
 * @param {(hex: string) => void} onPick  called with "#rrggbb" for a color, or
 *   "" when the user picks "default color" (caller emits `==text==` with no
 *   suffix so the reader's own highlight color applies)
 * @param {() => void} [onDone]  called after a pick so the caller can close
 *   the dropdown
 * @param {() => void} [onEscape]  called when Escape is pressed inside the
 *   menu (caller closes it and returns focus to the toolbar toggle)
 * @returns {{ refresh: () => void, focusFirst: () => void }} call `refresh()`
 *   each time the menu opens so the recent-colors row reflects colors picked
 *   since the last open
 */
export function mountColorPicker(menu, onPick, onDone = () => { }, onEscape = onDone) {
    menu.innerHTML = buildColorPickerHtml();
    renderRecent(menu);

    const pick = (hex) => {
        if (hex) rememberColor(hex);
        onPick(hex);
        renderRecent(menu);
        onDone();
    };

    // One delegated listener covers the palette, recents, and "default color".
    menu.addEventListener("click", (e) => {
        const swatch = e.target.closest("[data-cp-color]");
        if (swatch && menu.contains(swatch)) {
            e.preventDefault();
            e.stopPropagation();
            const raw = swatch.dataset.cpColor;
            pick(raw === "" ? "" : normalizeHex(raw) || "");
        }
    });

    const hexInput = menu.querySelector(".cp-hex");
    const nativeInput = menu.querySelector(".cp-native");
    const applyBtn = menu.querySelector("[data-cp-apply]");

    const applyHexField = () => {
        const hex = normalizeHex(hexInput.value);
        if (!hex) {
            hexInput.classList.add("is-invalid");
            return;
        }
        hexInput.classList.remove("is-invalid");
        pick(hex);
    };

    // The native <input type=color> opens the OS picker; `change` fires once the
    // user confirms (unlike `input`, which fires continuously while dragging and
    // would insert a new ==span== on every mouse move).
    nativeInput.addEventListener("change", () => {
        const hex = normalizeHex(nativeInput.value);
        if (hex) pick(hex);
    });

    // Keep the hex field and the native swatch in sync while typing.
    hexInput.addEventListener("input", () => {
        hexInput.classList.remove("is-invalid");
        const hex = normalizeHex(hexInput.value);
        if (hex) nativeInput.value = hex;
    });
    hexInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            applyHexField();
        }
        // Keep arrow-key roving nav (bound on the menu) out of the text field.
        e.stopPropagation();
    });
    applyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyHexField();
    });

    const eyeBtn = menu.querySelector("[data-cp-eyedropper]");
    if (eyeBtn) {
        eyeBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const result = await new window.EyeDropper().open();
                const hex = normalizeHex(result?.sRGBHex);
                if (hex) pick(hex);
            } catch {
                /* user pressed Esc / cancelled the eyedropper — nothing to apply */
            }
        });
    }

    // ── Keyboard: 2D arrow navigation through the palette grid ───────────────
    // The generic toolbar menu nav (a flat, direct-children-only ArrowUp/Down
    // list that also closes on Tab) can't work here: the swatches are nested in
    // rows, and Tab must be free to move on to the hex field / Apply button. So
    // this menu opts out of that helper and handles its own keys.
    const COLS = 10;
    menu.addEventListener("keydown", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;

        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onEscape();
            return;
        }

        if (!target.classList.contains("cp-swatch")) return;
        const grid = target.closest(".cp-grid");
        // Recent swatches are a single row (no vertical neighbours); handle just
        // left/right there via the same flat-list logic below.
        const scope = grid || target.parentElement;
        const cells = Array.from(scope.querySelectorAll(".cp-swatch"));
        const i = cells.indexOf(target);
        if (i === -1) return;

        // RTL: the palette reads right-to-left, so ArrowRight moves to the
        // previous cell and ArrowLeft to the next, matching what the eye expects.
        const rtl = getComputedStyle(menu).direction === "rtl";
        const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
        let next = null;
        if (step !== undefined) next = i + step;
        else if (grid && e.key === "ArrowDown") next = i + COLS;
        else if (grid && e.key === "ArrowUp") next = i - COLS;
        else if (e.key === "Home") next = grid ? i - (i % COLS) : 0;
        else if (e.key === "End") next = grid ? i - (i % COLS) + COLS - 1 : cells.length - 1;
        else return;

        if (next < 0 || next >= cells.length) {
            e.preventDefault(); // stay put at the edges instead of scrolling the bar
            return;
        }
        e.preventDefault();
        cells[next].focus();
    });

    return {
        refresh: () => renderRecent(menu),
        /** Move focus to the first palette swatch (call when opened via keyboard). */
        focusFirst: () => menu.querySelector(".cp-swatch")?.focus(),
    };
}
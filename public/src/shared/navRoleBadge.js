// ============================================================================
// public/src/shared/navRoleBadge.js — Admin / Developer role badge on nav avatars
// ============================================================================
//
// Single owner of the badge's DOM shape. Three separate places used to build
// this element by hand — side-menu.js's refreshNavBadges(), avatarEngine.js's
// syncNavAvatars(), and a pre-paint inline script copy-pasted into five HTML
// pages — which is how they drifted apart in the first place.
//
// THE POSITIONING BUG THIS FIXES
// ------------------------------
// Every one of those callers appended the badge straight into
// `img.parentElement` and set `position: relative` on it. For the bottom nav
// that parent is `.bottom-nav-icon`, a fixed 24px box hugging the avatar — fine.
// For the desktop sidebar it is the `.menu-item` button itself: a full-width
// flex ROW. So `top: 1px; right: 1px` pinned the badge to the corner of the
// row, sitting out in the row's 10px padding several pixels clear of the
// avatar — and drifting much further out whenever the rail collapsed and
// re-centred its icons inside the 64px rail.
//
// The fix is a `.nav-badge-anchor` wrapper that hugs the avatar glyph, giving
// the badge a positioning context that actually corresponds to the thing it is
// supposed to be badging. Visuals live in side-menu.css.

/** Role → badge artwork.
 *
 *  This used to point at the site's favicon (a detailed lightbulb-with-
 *  question-mark illustration) shrunk into an 18px/14px circle. Multi-tone
 *  illustrative art with fine detail — highlights, rays, a thin question
 *  mark — simply doesn't resolve at that size; it reads as a smudge next to
 *  a small profile photo, which is exactly the "not clearly visible" problem
 *  this replaces.
 *
 *  In its place: the exact same two glyphs profile.js already draws for
 *  `.admin-gallery-badge` (the admin gallery cards on the profile page) —
 *  code-chevrons `</>` for owner/developer, a shield outline for admin —
 *  as bare `currentColor` strokes with no fill, inlined as SVG data URIs.
 *  Reusing that art (rather than inventing a third look) means the nav
 *  badge and the profile-page badge read as the same design language. Both
 *  render white via `currentColor` on `color: #fff`; side-menu.css supplies
 *  the surrounding disc colour per role. */
const BADGE_ART = {
    owner:
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23FFFFFF' d='M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18ZM14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18Z'/%3E%3C/svg%3E",
    admin:
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23ffffff' d='M12 4.2l5.4 2v4.3c0 3.9-2.3 7.1-5.4 8-3.1-.9-5.4-4.1-5.4-8V6.2z'/%3E%3Cpath stroke='%234f46e5' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' fill='none' d='M9 12.1l2 2 4-4.2'/%3E%3C/svg%3E",
};

const BADGE_TITLE = {
    owner: "مطوّر المنصة",
    admin: "مشرف",
};

/** Default-icon SVGs that swap with the avatar image. The anchor has to wrap
 *  whichever one is currently visible, otherwise it collapses to a 0×0 box and
 *  drags the badge off into the corner with it whenever the user has no avatar
 *  set (admins without a profile picture still get a badge). */
const DEFAULT_ICON_CLASSES = [
    "menu-item-default-icon",
    "bottom-nav-default-icon",
];

/**
 * Parents that already hug the avatar and need no extra wrapper.
 * `.bottom-nav-icon` is a fixed 24px flex box around the glyph.
 */
function isTightHost(el) {
    return el.classList.contains("bottom-nav-icon");
}

/**
 * Returns the element the badge should be absolutely positioned against,
 * creating the `.nav-badge-anchor` wrapper if one is needed and absent.
 *
 * @param {HTMLImageElement} img the nav avatar image
 * @returns {HTMLElement|null}
 */
export function resolveBadgeHost(img) {
    const parent = img?.parentElement;
    if (!parent) return null;

    if (parent.classList.contains("nav-badge-anchor")) return parent;
    if (isTightHost(parent)) {
        // Position context without the extra element.
        parent.style.position = "relative";
        return parent;
    }

    const anchor = document.createElement("span");
    anchor.className = "nav-badge-anchor";

    // Wrap the avatar together with the default-icon SVG it swaps with, so the
    // anchor keeps its size whichever of the two is currently displayed.
    const defaultIcon = DEFAULT_ICON_CLASSES.map((cls) =>
        parent.querySelector(`:scope > .${cls}`),
    ).find(Boolean);

    // Drop the anchor in at whichever of the two currently comes first, so the
    // glyph keeps its position among the row's other flex children.
    const usesIconFirst =
        defaultIcon &&
        Boolean(
            defaultIcon.compareDocumentPosition(img) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        );

    parent.insertBefore(anchor, usesIconFirst ? defaultIcon : img);
    if (defaultIcon) anchor.appendChild(defaultIcon);
    anchor.appendChild(img);

    return anchor;
}

/**
 * Creates or updates the role badge for a nav avatar. Idempotent — repeat
 * calls reuse the existing element and only refresh what changed, so the
 * pre-paint inline scripts, avatarEngine and side-menu.js can all call this
 * over the same avatar without stacking duplicates.
 *
 * @param {HTMLImageElement} img the nav avatar image
 * @param {{ isOwner?: boolean }} roleInfo
 * @returns {HTMLImageElement|null} the badge element
 */
export function mountNavRoleBadge(img, roleInfo) {
    if (!img || !roleInfo) return null;

    const host = resolveBadgeHost(img);
    if (!host) return null;

    const role = roleInfo.isOwner ? "owner" : "admin";

    let badge = host.querySelector(":scope > .nav-badge-overlay");
    if (!badge) {
        badge = document.createElement("img");
        badge.className = "nav-badge-overlay";
        badge.alt = "";
        host.appendChild(badge);
    }

    // `cursor: help` in the CSS has always implied a tooltip that never existed.
    badge.title = BADGE_TITLE[role];
    // Drives the per-role fill in side-menu.css. Previously the two roles were
    // distinguishable only by artwork, so both sat in the same gold medallion.
    badge.dataset.role = role;

    // Compare against the role we last painted rather than the resolved
    // `src` string: data URIs get percent-decoded and re-serialised by the
    // browser, so a raw `endsWith(art)` check against the original literal
    // can mismatch even when the badge is already showing the right glyph.
    if (badge.dataset.artRole !== role) {
        badge.src = BADGE_ART[role];
        badge.dataset.artRole = role;
    }

    badge.style.display = "block";

    // Cuts the circular notch into the avatar's own corner (see side-menu.css)
    // so the badge sits recessed into the photo, matching .admin-gallery-badge
    // on the profile page. Scoped to the real <img>, not the default-icon SVG
    // that swaps in when there's no avatar set — a mask cut into a small icon
    // glyph (rather than a photo) has nothing to recede into and just clips it.
    if (
        img.tagName === "IMG" &&
        (img.classList.contains("menu-item-avatar") ||
            img.classList.contains("bottom-nav-avatar"))
    ) {
        img.classList.add("nav-avatar-has-badge");
    }

    return badge;
}

/**
 * Removes a stale badge (admin signed out, session cleared). Leaves the
 * `.nav-badge-anchor` in place — it is layout-neutral, and keeping it avoids
 * re-wrapping churn if the user signs back in.
 *
 * @param {HTMLImageElement} img
 */
export function unmountNavRoleBadge(img) {
    const parent = img?.parentElement;
    if (!parent) return;
    // Check the anchor and the original parent: a badge injected by an older
    // pre-paint script may still be sitting on the un-wrapped parent.
    const scope = parent.classList.contains("nav-badge-anchor")
        ? parent.parentElement || parent
        : parent;
    scope
        .querySelectorAll(".nav-badge-overlay")
        .forEach((el) => el.remove());
    img.classList?.remove("nav-avatar-has-badge");
}
// ============================================================================
// public/src/features/home/course-cell.js
// Hexagonal "honeycomb" cell for a course (and the «محتواي» entry) on the home
// screen. Returns an <li class="hx"> meant to live inside <ul class="cells">
// (see root-view.js / search-integration.js and hive.css).
//
// The face is a real <a href> so open-in-new-tab / copy-link work; plain left
// clicks are intercepted and routed to onActivate (SPA navigation).
// ============================================================================

import { isRecentlyAdded } from "./date-utils.js";
import { getSubjectIcon } from "./subject-icons.js";
import { getItemText } from "./item-text.js";
import { toSlug } from "./slug-utils.js";

export function courseHref(course) {
  return `/course/${encodeURIComponent(toSlug(course.name))}`;
}

export function courseSubtext(itemCount) {
  return `${itemCount > 2 ? itemCount : ""} ${getItemText(itemCount)}`.trim();
}

/**
 * @param {object} o
 * @param {string} o.name
 * @param {string} o.subtext        line under the name
 * @param {string} [o.icon]         emoji; defaults to getSubjectIcon(name)
 * @param {string} [o.href]
 * @param {object} [o.courseData]   used for the «جديد» badge
 * @param {() => void} o.onActivate
 */
export function createCourseCell({ name, subtext, icon, href = "#", courseData = null, onActivate }) {
  const li = document.createElement("li");
  li.className = "hx";

  const face = document.createElement("a");
  face.className = "face";
  face.href = href;
  face.title = name;
  face.setAttribute("aria-label", `${name}, ${subtext}`);

  const i = document.createElement("i");
  i.setAttribute("aria-hidden", "true");
  i.textContent = icon || getSubjectIcon(name, false);

  const b = document.createElement("b");
  b.dir = "auto";
  b.textContent = name;

  const s = document.createElement("s");
  s.dir = "auto";
  s.textContent = subtext;

  face.append(i, b, s);
  face.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onActivate?.();
  });
  li.appendChild(face);

  if (courseData && isRecentlyAdded(courseData.createdAt)) {
    const badge = document.createElement("span");
    badge.className = "hx-new";
    badge.textContent = "جديد";
    badge.setAttribute("aria-label", "مضاف حديثاً");
    li.appendChild(badge);
  }
  return li;
}

/** Builds the empty comb scaffold: { comb, cap, cells }. */
export function createComb() {
  const comb = document.createElement("div");
  comb.className = "comb";
  const cap = document.createElement("div");
  cap.className = "cap";
  const cells = document.createElement("ul");
  cells.className = "cells";
  cells.setAttribute("role", "list");
  comb.append(cap, cells);
  return { comb, cap, cells };
}

/** Fills the cap with a message. tone: "info" | "warn" | "ok". */
export function setCapMessage(cap, { icon = "ℹ️", title, text = "", linkHref, linkLabel, tone = "info" }) {
  cap.dataset.tone = tone;
  cap.textContent = "";
  const aside = document.createElement("aside");
  aside.className = "cap-in";
  aside.setAttribute("role", "status");
  const ic = document.createElement("span");
  ic.className = "cap-ic";
  ic.setAttribute("aria-hidden", "true");
  ic.textContent = icon;
  const tx = document.createElement("div");
  tx.className = "cap-tx";
  const strong = document.createElement("strong");
  strong.dir = "rtl";
  strong.textContent = title;
  tx.appendChild(strong);
  if (text) {
    const span = document.createElement("span");
    span.dir = "rtl";
    span.textContent = text;
    tx.appendChild(span);
  }
  aside.append(ic, tx);
  if (linkHref) {
    const a = document.createElement("a");
    a.className = "pill";
    a.href = linkHref;
    a.textContent = linkLabel;
    aside.appendChild(a);
  }
  cap.appendChild(aside);
}

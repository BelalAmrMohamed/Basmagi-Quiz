// =============================================================================
// public/src/components/ai-agent/ai-agent-window.js
// Floating, non-modal window frame for الباشــمبصمج — a standalone copy of the
// image-tool window's frame (features/notebook/image-tool-window.js), NOT
// imported from it. Same behaviour:
//   - draggable title bar, 8-direction resize, remembered size/position
//   - Mac-style controls (close / minimize / maximize), double-click title
//   - Aero Snap: drag to a side (halves) or corner (quarters) with a live
//     preview outline; drag out of a snapped state to restore the old size
//   - maximize = full screen; minimize = a pill in the bottom corner that
//     can show a "working" animation while a prompt is still running
//   - window-width responsiveness: `aiw-compact` (<=900px) / `aiw-narrow`
//     (<=540px) classes are toggled so the chat can switch to its drawer /
//     small-screen layout based on the WINDOW, not the viewport
// The frame knows nothing about the chat: it hosts `content`, and the caller
// reacts through the callbacks (onClose, onResize).
//
// While the window exists (open, maximized or minimized) <body> carries
// `ai-agent-window-open`, which hides every AI FAB (see ai-agent-window.css).
// =============================================================================

const GEO_KEY = "bq-ai-agent-window-geom";
const SNAP = 14;
const AERO_EDGE = 14;
const AERO_CORNER = 110;
const Z_INDEX = 6000; // modal tier: above side-menu (4000)/bottom-nav, below dropdown menus (7000)
const COMPACT_MAX = 900;
const NARROW_MAX = 540;
const PHONE_MAX = 640;
const MIN_W = 320;
const MIN_H = 300;

const T = {
  close: "إغلاق",
  minimize: "تصغير",
  maximize: "تكبير",
  restore: "استعادة",
  openMenu: "فتح القائمة",
  working: "يعمل…",
};

function readGeom() {
  try { return JSON.parse(sessionStorage.getItem(GEO_KEY) || "null"); } catch { return null; }
}
function writeGeom(g) {
  try { sessionStorage.setItem(GEO_KEY, JSON.stringify(g)); } catch { /* storage unavailable */ }
}

/**
 * @param {object} cfg
 * @param {HTMLElement} cfg.content  mounted inside the window body
 * @param {string} cfg.title
 * @param {string} cfg.logoSrc
 * @param {string} [cfg.toggleHtml]   inner HTML of the compact-mode sidebar toggle ("" = none)
 * @param {() => void} [cfg.onClose]
 * @param {(info: {width:number,height:number,compact:boolean,narrow:boolean}) => void} [cfg.onResize]
 * @param {() => void} [cfg.onToggleSidebar]
 */
export function createAgentWindow(cfg) {
  const win = document.createElement("div");
  win.className = "aiw is-focused";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", cfg.title);
  win.tabIndex = -1;
  win.style.zIndex = String(Z_INDEX);

  win.innerHTML = `
    <div class="aiw-titlebar">
      <div class="aiw-titlebar-start">
        ${cfg.toggleHtml ? `<button type="button" class="aiw-sidebar-toggle" aria-label="${T.openMenu}" aria-expanded="false" title="${T.openMenu}">${cfg.toggleHtml}</button>` : ""}
        <div class="aiw-title-wrap">
          <img class="aiw-logo" alt="" aria-hidden="true">
          <span class="aiw-title"></span>
          <span class="aiw-working" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="aiw-working-label">${T.working}</span>
        </div>
      </div>
      <div class="aiw-controls">
        <button type="button" class="aiw-btn btn-min" title="${T.minimize}" aria-label="${T.minimize}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7"/></svg></button>
        <button type="button" class="aiw-btn btn-max" title="${T.maximize}" aria-label="${T.maximize}"><svg class="ic-max" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 9.5v-7h7v7z"/></svg><svg class="ic-restore" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 4V2.5h5.5V8H8M2.5 4H8v5.5H2.5z"/></svg></button>
        <button type="button" class="aiw-btn btn-close" title="${T.close}" aria-label="${T.close}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button>
      </div>
    </div>
    <div class="aiw-body"></div>
    <div class="aiw-resizer r-e" data-dir="e"></div><div class="aiw-resizer r-s" data-dir="s"></div>
    <div class="aiw-resizer r-w" data-dir="w"></div><div class="aiw-resizer r-n" data-dir="n"></div>
    <div class="aiw-resizer r-se" data-dir="se"></div><div class="aiw-resizer r-sw" data-dir="sw"></div>
    <div class="aiw-resizer r-ne" data-dir="ne"></div><div class="aiw-resizer r-nw" data-dir="nw"></div>
    <div class="aiw-grip"></div>
  `;
  win.querySelector(".aiw-title").textContent = cfg.title;
  win.querySelector(".aiw-logo").src = cfg.logoSrc;
  win.querySelector(".aiw-body").appendChild(cfg.content);

  const titlebar = win.querySelector(".aiw-titlebar");
  const maxBtn = win.querySelector(".btn-max");

  const state = {
    maximized: false,
    minimized: false,
    savedRect: null,
    snapRestore: null,
    snapPreview: null,
    aeroZone: null,
    lastMinToggle: 0,
    closed: false,
  };

  // ── Geometry ─────────────────────────────────────────────────────────────
  function applyInitialGeometry() {
    const iw = window.innerWidth, ih = window.innerHeight;
    const saved = readGeom();
    if (saved && saved.w > 0 && saved.h > 0) {
      const w = Math.max(MIN_W, Math.min(saved.w, iw - 8));
      const h = Math.max(MIN_H, Math.min(saved.h, ih - 8));
      const l = Math.max(-w + 100, Math.min(iw - 100, saved.l));
      const t = Math.max(0, Math.min(ih - 40, saved.t));
      Object.assign(win.style, { width: `${w}px`, height: `${h}px`, left: `${l}px`, top: `${t}px` });
      return;
    }
    const w = Math.min(1000, iw - 40);
    const h = Math.min(680, ih - 80);
    Object.assign(win.style, {
      width: `${w}px`, height: `${h}px`,
      left: `${Math.max(20, Math.round((iw - w) / 2))}px`,
      top: `${Math.max(20, Math.round((ih - h) / 2))}px`,
    });
  }

  function saveGeometry() {
    if (state.maximized || state.minimized) return;
    writeGeom({ l: win.offsetLeft, t: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight });
  }

  function aeroZone(x, y) {
    const iw = window.innerWidth, ih = window.innerHeight;
    const left = x <= AERO_EDGE, right = x >= iw - AERO_EDGE;
    if (!left && !right) return null;
    const side = left ? "left" : "right";
    if (y <= AERO_CORNER) return `top-${side}`;
    if (y >= ih - AERO_CORNER) return `bottom-${side}`;
    return side;
  }
  function aeroRect(zone) {
    const iw = window.innerWidth, ih = window.innerHeight;
    const hw = Math.floor(iw / 2), hh = Math.floor(ih / 2);
    const l = zone.endsWith("right") ? iw - hw : 0;
    if (zone === "left" || zone === "right") return { l, t: 0, w: hw, h: ih };
    return { l, t: zone.startsWith("top") ? 0 : ih - hh, w: hw, h: hh };
  }

  /** Live outline of where the window will land; starts at the window's own rect and morphs to the target. */
  function updateSnapPreview(zone) {
    let pv = state.snapPreview;
    if (!zone) {
      if (!pv) return;
      pv.classList.remove("is-visible");
      state.snapPreview = null;
      setTimeout(() => pv.remove(), 220);
      return;
    }
    const r = aeroRect(zone);
    if (!pv) {
      pv = document.createElement("div");
      pv.className = "aiw-snap-preview";
      pv.style.zIndex = String(Z_INDEX + 1);
      const wr = win.getBoundingClientRect();
      Object.assign(pv.style, { left: `${wr.left}px`, top: `${wr.top}px`, width: `${wr.width}px`, height: `${wr.height}px` });
      document.body.appendChild(pv);
      state.snapPreview = pv;
      pv.getBoundingClientRect(); // commit the start rect so the transition runs
    }
    pv.classList.add("is-visible");
    Object.assign(pv.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  function applyAeroSnap(zone) {
    const r = aeroRect(zone);
    if (!state.snapRestore) state.snapRestore = { w: win.offsetWidth, h: win.offsetHeight };
    Object.assign(win.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  function snapRect(l, t, w, h) {
    const iw = window.innerWidth, ih = window.innerHeight;
    if (Math.abs(l) < SNAP) l = 0; else if (Math.abs(l + w - iw) < SNAP) l = iw - w;
    if (Math.abs(t) < SNAP) t = 0; else if (Math.abs(t + h - ih) < SNAP) t = ih - h;
    return { left: l, top: t };
  }

  // ── State changes ────────────────────────────────────────────────────────
  function setMaxButton(restoreLabel) {
    const label = restoreLabel ? T.restore : T.maximize;
    maxBtn.title = label;
    maxBtn.setAttribute("aria-label", label);
  }

  function toggleMaximize() {
    if (state.maximized) {
      state.maximized = false;
      win.classList.remove("is-maximized");
      if (state.savedRect) Object.assign(win.style, state.savedRect);
      setMaxButton(false);
    } else {
      state.maximized = true;
      state.savedRect = { left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height };
      win.classList.add("is-maximized");
      setMaxButton(true);
    }
    requestAnimationFrame(measure);
  }

  function toggleMinimize() {
    if (state.maximized) toggleMaximize();
    state.lastMinToggle = Date.now();
    state.minimized = !state.minimized;
    win.classList.toggle("is-minimized", state.minimized);
    setMaxButton(state.minimized);
    if (!state.minimized) requestAnimationFrame(measure);
    else document.activeElement?.blur?.();
  }

  function close() {
    if (state.closed) return;
    state.closed = true;
    ro.disconnect();
    window.removeEventListener("resize", onWindowResize);
    updateSnapPreview(null);
    state.snapPreview?.remove();
    win.remove();
    document.body.classList.remove("ai-agent-window-open");
    cfg.onClose?.();
  }

  // ── Responsiveness (window width) ────────────────────────────────────────
  let lastInfo = null;
  function measure() {
    if (state.minimized) return;
    const width = win.clientWidth, height = win.clientHeight;
    if (!width) return;
    const compact = width <= COMPACT_MAX;
    const narrow = width <= NARROW_MAX;
    win.classList.toggle("aiw-compact", compact);
    win.classList.toggle("aiw-narrow", narrow);
    const info = { width, height, compact, narrow };
    if (!lastInfo || lastInfo.compact !== compact || lastInfo.narrow !== narrow) cfg.onResize?.(info);
    lastInfo = info;
  }
  const ro = new ResizeObserver(measure);
  ro.observe(win);

  function onWindowResize() {
    if (state.maximized || state.minimized) return;
    const iw = window.innerWidth, ih = window.innerHeight;
    const w = Math.min(win.offsetWidth, iw - 8), h = Math.min(win.offsetHeight, ih - 8);
    win.style.width = `${w}px`;
    win.style.height = `${h}px`;
    win.style.left = `${Math.max(-w + 100, Math.min(iw - 100, win.offsetLeft))}px`;
    win.style.top = `${Math.max(0, Math.min(ih - 40, win.offsetTop))}px`;
  }
  window.addEventListener("resize", onWindowResize);

  // ── Events ───────────────────────────────────────────────────────────────
  win.addEventListener("pointerdown", () => {
    win.classList.add("is-focused");
  });

  titlebar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    if (state.maximized || state.minimized) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    let startLeft = win.offsetLeft;
    const startTop = win.offsetTop;
    const grabRatio = Math.min(0.9, Math.max(0.1, (e.clientX - startLeft) / (win.offsetWidth || 1)));
    titlebar.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      if (state.maximized) return;
      // Dragging a snapped window out restores its previous size (pointer keeps its place on the title bar)
      if (state.snapRestore && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
        const r = state.snapRestore;
        state.snapRestore = null;
        win.style.width = `${r.w}px`;
        win.style.height = `${r.h}px`;
        startLeft = Math.round(startX - r.w * grabRatio);
      }
      let l = startLeft + (ev.clientX - startX);
      let t = startTop + (ev.clientY - startY);
      l = Math.max(-win.offsetWidth + 100, Math.min(window.innerWidth - 100, l));
      t = Math.max(0, Math.min(window.innerHeight - 40, t));
      ({ left: l, top: t } = snapRect(l, t, win.offsetWidth, win.offsetHeight));
      win.style.left = `${l}px`;
      win.style.top = `${t}px`;
      const zone = aeroZone(ev.clientX, ev.clientY);
      if (zone !== state.aeroZone) { state.aeroZone = zone; updateSnapPreview(zone); }
    };
    const onUp = (ev) => {
      const zone = state.aeroZone;
      state.aeroZone = null;
      updateSnapPreview(null);
      if (zone && ev.type === "pointerup") applyAeroSnap(zone);
      try { titlebar.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      titlebar.removeEventListener("pointermove", onMove);
      titlebar.removeEventListener("pointerup", onUp);
      titlebar.removeEventListener("pointercancel", onUp);
      saveGeometry();
    };
    titlebar.addEventListener("pointermove", onMove);
    titlebar.addEventListener("pointerup", onUp);
    titlebar.addEventListener("pointercancel", onUp);
  });

  titlebar.addEventListener("click", (e) => {
    if (state.minimized && !e.target.closest("button")) toggleMinimize();
  });
  titlebar.addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    if (state.minimized || Date.now() - state.lastMinToggle < 600) return;
    toggleMaximize();
  });

  win.querySelector(".btn-close").addEventListener("click", close);
  maxBtn.addEventListener("click", () => (state.minimized ? toggleMinimize() : toggleMaximize()));
  win.querySelector(".btn-min").addEventListener("click", toggleMinimize);
  win.querySelector(".aiw-sidebar-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    cfg.onToggleSidebar?.();
  });

  win.querySelectorAll(".aiw-resizer").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      if (state.maximized || state.minimized) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = handle.dataset.dir;
      state.snapRestore = null;
      const startX = e.clientX, startY = e.clientY;
      const startW = win.offsetWidth, startH = win.offsetHeight;
      const startL = win.offsetLeft, startT = win.offsetTop;
      handle.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        let w = startW, h = startH, l = startL, t = startT;
        if (dir.includes("e")) w = Math.max(MIN_W, startW + dx);
        if (dir.includes("s")) h = Math.max(MIN_H, startH + dy);
        if (dir.includes("w")) { const c = Math.max(MIN_W, startW - dx); l = startL + (startW - c); w = c; }
        if (dir.includes("n")) { const c = Math.max(MIN_H, startH - dy); t = startT + (startH - c); h = c; }
        const iw = window.innerWidth, ih = window.innerHeight;
        if (dir.includes("e") && Math.abs(l + w - iw) < SNAP && iw - l >= MIN_W) w = iw - l;
        if (dir.includes("s") && Math.abs(t + h - ih) < SNAP && ih - t >= MIN_H) h = ih - t;
        if (dir.includes("w") && Math.abs(l) < SNAP && w + l >= MIN_W) { w += l; l = 0; }
        if (dir.includes("n") && Math.abs(t) < SNAP && h + t >= MIN_H) { h += t; t = 0; }
        Object.assign(win.style, { width: `${w}px`, height: `${h}px`, left: `${l}px`, top: `${t}px` });
      };
      const onUp = (ev) => {
        try { handle.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        saveGeometry();
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  });

  // Esc: menus/dropdowns call preventDefault when they consume it; otherwise
  // it restores a maximized window, or closes the window.
  win.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || state.minimized) return;
    if (state.maximized && window.innerWidth > PHONE_MAX) toggleMaximize();
    else close();
  });

  // ── Mount ────────────────────────────────────────────────────────────────
  applyInitialGeometry();
  document.body.appendChild(win);
  document.body.classList.add("ai-agent-window-open");
  if (window.innerWidth <= PHONE_MAX) toggleMaximize(); // phones: full screen, still restorable
  requestAnimationFrame(measure);
  win.focus({ preventScroll: true });

  return {
    el: win,
    close,
    toggleMinimize,
    toggleMaximize,
    isMinimized: () => state.minimized,
    isMaximized: () => state.maximized,
    /** Show/hide the minimized-state "working" animation. */
    setBusy(busy) { win.classList.toggle("is-busy", !!busy); },
    /** Restores from minimized (no-op otherwise) and focuses. */
    reveal() {
      if (state.minimized) toggleMinimize();
      win.focus({ preventScroll: true });
    },
  };
}

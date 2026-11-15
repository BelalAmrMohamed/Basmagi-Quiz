// =============================================================================
// public/src/features/notebook/image-tool-window.js
// MATLAB-Style Floating Image Tool Window (imtool)
// Features:
// - Multi-window manager with staggered cascade (+32px offset)
// - Draggable titlebar & 8-direction resizable frame
// - Maximize (Fullscreen) / Minimize / Restore
// - Cursor-centered mouse wheel zoom (5% to 12800%)
// - Direct drag-to-pan (hand tool with grab / grabbing cursor)
// - In-pixel numerical intensity values & pixel grid at high zoom
// - Dynamic contrast text (white on dark, black on light with crisp outline)
// - 1-based MATLAB coordinate tracking (X: col, Y: row)
// - Image information properties card (min/max/mean, class, size)
// - Export menu: copy image, save PNG/JPG, copy pixels as a MATLAB matrix
// - Overlays: pixel grid, rulers, crosshair (View menu)
// - Aero Snap: drag to a side (halves) or corner (quarters) with a live preview; drag out to restore
// - Opens sized to the image (100%, or the largest whole zoom for tiny images, or shrunk to the screen);
//   titled like MATLAB: "Image Tool 1 - <variable or file name>"
// - Snap to screen edges, double-click title to maximize
// - Click (or tap) a pixel to pin it: its value stays in the status bar and a marker follows pan / zoom; click again to unpin
// - Toolbar: zoom / fit / values / info stay as flat buttons; overlays, export and help live in one "..." More menu
// - Windows snap to screen edges AND to the edges of neighbouring windows (move and resize)
// - Minimized tab: thumbnail + window number + name, readable in a stack of minimized windows
// - Touch: pinch, two-finger pan, double-tap fit/100%; keyboard shortcuts + ? popover
// - Full English & Arabic localization
// =============================================================================

/**
 * @typedef {Object} ImtoolImage
 * @property {'img'} k
 * @property {number} fig
 * @property {number} w
 * @property {number} h
 * @property {Uint8Array} rgb
 * @property {boolean} [tool]
 * @property {string} [name] Variable or file name shown in the title (imtool(I) -> "Image Tool 1 - I")
 */

const I18N = {
  en: {
    title: 'Image Tool',
    untitled: 'image',
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
    zoomIn: 'Zoom in (+)',
    zoomOut: 'Zoom out (−)',
    fit: 'Fit',
    actual: '100%',
    toggleValues: 'Values',
    toggleValuesTitle: 'Toggle numerical pixel values on zoom',
    info: 'Info',
    infoTitle: 'Image properties & statistics',
    download: 'PNG',
    downloadTitle: 'Download full-resolution PNG',
    hint: 'Scroll to zoom · Drag to pan · Click to pin',
    pixelPrompt: 'Pixel info: Move over image',
    pixelFmt: (x, y, val) => `Pixel: (X: ${x}, Y: ${y})  ${val}`,
    pinnedFmt: (x, y, val) => `Pinned: (X: ${x}, Y: ${y})  ${val}`,
    more: 'More',
    moreTitle: 'More: overlays, export, help',
    grayscale: 'Grayscale (1-channel)',
    rgb: 'RGB Truecolor (3-channel)',
    class: 'Class',
    size: 'Dimensions',
    totalPixels: 'Total Pixels',
    colorType: 'Color Type',
    minVal: 'Min Intensity',
    maxVal: 'Max Intensity',
    meanVal: 'Mean Intensity',
    memory: 'Data Size',
    exportLabel: 'Export',
    exportTitle: 'Copy or save the image',
    copyImage: 'Copy image',
    savePng: 'Save as PNG',
    saveJpg: 'Save as JPG',
    copyMatrix: 'Copy pixel values (MATLAB)',
    view: 'View',
    viewTitle: 'Overlays: grid, rulers, crosshair',
    grid: 'Pixel grid',
    rulers: 'Rulers',
    crosshair: 'Crosshair',
    help: 'Keyboard shortcuts (?)',
    shortcuts: 'Keyboard & gestures',
    copied: 'Image copied',
    copyFailed: 'Copy failed in this browser',
    matrixCopied: (r, c, part) => `Copied ${r}×${c} matrix${part ? ' (' + part + ')' : ''}`,
    keys: [
      ['+ / −', 'Zoom in / out'],
      ['0', 'Fit to window'],
      ['1', 'Actual size (100%)'],
      ['← ↑ → ↓', 'Pan (Shift = faster)'],
      ['I', 'Image info'],
      ['G', 'Pixel grid'],
      ['R', 'Rulers'],
      ['C', 'Crosshair'],
      ['Click pixel', 'Pin / unpin its value'],
      ['Ctrl+C', 'Copy image'],
      ['?', 'This help'],
      ['Esc', 'Close menu / restore / close'],
      ['Double-click title', 'Maximize / restore'],
      ['Double-tap', 'Toggle fit / 100%'],
      ['Pinch · two fingers', 'Zoom · pan'],
    ],
  },
  ar: {
    title: 'أداة الصورة',
    untitled: 'image',
    minimize: 'تصغير',
    maximize: 'تكبير',
    restore: 'استعادة',
    close: 'إغلاق',
    zoomIn: 'تكبير (+)',
    zoomOut: 'تصغير (−)',
    fit: 'ملاءمة',
    actual: '100%',
    toggleValues: 'القيم',
    toggleValuesTitle: 'إظهار / إخفاء أرقام البكسل عند التقريب',
    info: 'معلومات',
    infoTitle: 'خصائص وإحصاءات الصورة',
    download: 'PNG',
    downloadTitle: 'تنزيل الصورة بصيغة PNG',
    hint: 'مرر للتكبير · اسحب للتحريك · انقر للتثبيت',
    pixelPrompt: 'معلومات البكسل: حرّك المؤشر فوق الصورة',
    pixelFmt: (x, y, val) => `البكسل: (س: ${x}، ص: ${y})  ${val}`,
    pinnedFmt: (x, y, val) => `مثبّت: (س: ${x}، ص: ${y})  ${val}`,
    more: 'المزيد',
    moreTitle: 'المزيد: الطبقات، التصدير، المساعدة',
    grayscale: 'تدرج رمادي (قناة واحدة)',
    rgb: 'ألوان حقيقية RGB (3 قنوات)',
    class: 'الفئة',
    size: 'الأبعاد',
    totalPixels: 'إجمالي البكسلات',
    colorType: 'نوع الألوان',
    minVal: 'أقل قيمة إضاءة',
    maxVal: 'أعلى قيمة إضاءة',
    meanVal: 'متوسط الإضاءة',
    memory: 'حجم البيانات',
    exportLabel: 'تصدير',
    exportTitle: 'نسخ أو حفظ الصورة',
    copyImage: 'نسخ الصورة',
    savePng: 'حفظ بصيغة PNG',
    saveJpg: 'حفظ بصيغة JPG',
    copyMatrix: 'نسخ قيم البكسل (MATLAB)',
    view: 'عرض',
    viewTitle: 'الطبقات: الشبكة، المساطر، خطوط التقاطع',
    grid: 'شبكة البكسل',
    rulers: 'المساطر',
    crosshair: 'خطا التقاطع',
    help: 'اختصارات لوحة المفاتيح (?)',
    shortcuts: 'الاختصارات والإيماءات',
    copied: 'تم نسخ الصورة',
    copyFailed: 'تعذر النسخ في هذا المتصفح',
    matrixCopied: (r, c, part) => `تم نسخ مصفوفة ${r}×${c}${part ? ' (' + part + ')' : ''}`,
    keys: [
      ['+ / −', 'تكبير / تصغير'],
      ['0', 'ملاءمة النافذة'],
      ['1', 'الحجم الفعلي (100%)'],
      ['← ↑ → ↓', 'تحريك (Shift = أسرع)'],
      ['I', 'معلومات الصورة'],
      ['G', 'شبكة البكسل'],
      ['R', 'المساطر'],
      ['C', 'خطا التقاطع'],
      ['نقر على بكسل', 'تثبيت / إلغاء تثبيت قيمته'],
      ['Ctrl+C', 'نسخ الصورة'],
      ['?', 'هذه المساعدة'],
      ['Esc', 'إغلاق القائمة / استعادة / إغلاق'],
      ['نقر مزدوج على العنوان', 'تكبير / استعادة'],
      ['نقر مزدوج باللمس', 'تبديل الملاءمة / 100%'],
      ['قرص · إصبعان', 'تكبير · تحريك'],
    ],
  }
};

const PREF_KEY = 'mlweb-imtool-prefs';
const SNAP = 14;
const AERO_EDGE = 14;   // pointer distance from a screen edge that arms Aero Snap
const AERO_CORNER = 110; // pointer distance from top/bottom that turns a side zone into a corner
const INIT_TARGET = 320; // tiny images open at the largest whole zoom whose longer side stays <= this (px)
const INIT_MAX_ZOOM = 64;
const RULER_W = 32;
const RULER_H = 18;
const NICE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

function readStore(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || '{}') || {}; } catch { return {}; }
}
function writeStore(key, obj) {
  try { sessionStorage.setItem(key, JSON.stringify(obj)); } catch { /* storage unavailable */ }
}

let cascadeCounter = 0;
let topZIndex = 10000; // Above sidebar (4000) and bottom-nav (4001)
const openWindows = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Lowest window number not used by an open window (MATLAB: Image Tool 1, 2, 3 ...). */
function nextWindowNumber() {
  const used = new Set([...openWindows.values()].map((w) => w.winNo));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

/** The candidate within SNAP px of `cur` (closest wins), else `cur`. */
function nearest(cur, candidates) {
  let best = cur, bestD = SNAP;
  for (const c of candidates) {
    const d = Math.abs(c - cur);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function layoutMinimizedWindows() {
  let index = 0;
  for (const [win] of openWindows) {
    if (!win.classList.contains('is-minimized')) continue;
    win.style.setProperty('--mlweb-minimized-offset', `${index * 58}px`);
    index += 1;
  }
}

/**
 * Creates an offscreen canvas containing the raw RGB image
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} rgb
 */
function createOffscreenCanvas(w, h, rgb) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) return canvas;
  const imgData = ctx.createImageData(w, h);
  const data = imgData.data;
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    data[j] = rgb[i];
    data[j + 1] = rgb[i + 1];
    data[j + 2] = rgb[i + 2];
    data[j + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

class ImageToolWindow {
  /**
   * @param {ImtoolImage} image
   * @param {Object} [options]
   * @param {'ar' | 'en'} [options.lang]
   * @param {HTMLElement} [options.container]
   */
  constructor(image, options = {}) {
    this.image = image;
    this.lang = options.lang === 'ar' ? 'ar' : 'en';
    this.t = I18N[this.lang];
    this.container = options.container || document.body;

    // Analyze grayscale vs RGB and min/max/mean stats
    this.analyzeStats();

    // Zoom & Pan state
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.showPixelValues = true;
    this.isPanning = false;
    this.isDragging = false;
    this.isResizing = false;
    this.isMaximized = false;
    this.isMinimized = false;
    this.savedRect = null;
    this.cursor = null;
    this.snapRestore = null;
    this.snapPreview = null;
    this._aeroZone = null;
    this._tap = null;
    this._lastTap = null;
    this._lastMinToggle = 0;
    this._toastTimer = 0;
    this.pin = null;        // pinned pixel {x, y} (0-based image coords): click / tap sets it, status bar keeps showing it
    this.hover = null;      // pixel under the mouse, or null
    this._click = null;
    this.initZoom = 1;
    this.winNo = nextWindowNumber();
    this.name = typeof image.name === 'string' ? image.name : '';
    const prefs = readStore(PREF_KEY);
    this.showGrid = prefs.grid !== false;
    this.showRulers = !!prefs.rulers;
    this.showCrosshair = !!prefs.crosshair;

    // Create offscreen source
    this.offscreen = createOffscreenCanvas(image.w, image.h, image.rgb);

    // Build DOM
    this.build();

    // Staggered positioning
    this.applyInitialCascade();

    // Show the image at its initial zoom (the window was sized to it)
    this.applyInitialView();
    requestAnimationFrame(() => {
      this.applyInitialView();
      this.render();
    });
  }

  analyzeStats() {
    const { w, h, rgb } = this.image;
    let isGray = true;
    let min = 255;
    let max = 0;
    let sum = 0;
    const len = rgb.length;
    for (let i = 0; i < len; i += 3) {
      const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
      if (isGray && (r !== g || r !== b)) isGray = false;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
      sum += lum;
    }
    this.isGrayscale = isGray;
    this.minVal = Math.round(min);
    this.maxVal = Math.round(max);
    this.meanVal = sum / (w * h);
  }

  build() {
    const { w, h } = this.image;
    const t = this.t;

    const win = document.createElement('div');
    win.className = 'mlweb-imtool-win is-focused';
    win.tabIndex = -1;
    win.style.zIndex = String(++topZIndex);

    // MATLAB style: "Image Tool 1 - I" (variable or file name when known)
    this.titleText = `${t.title} ${this.winNo}${this.name ? ' - ' + this.name : ''}`;
    const titleText = esc(this.titleText);

    win.innerHTML = `
      <div class="mlweb-imtool-titlebar">
        <div class="mlweb-imtool-win-controls">
          <button type="button" class="mlweb-imtool-win-btn btn-close" title="${t.close}" aria-label="${t.close}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button>
          <button type="button" class="mlweb-imtool-win-btn btn-min" title="${t.minimize}" aria-label="${t.minimize}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7"/></svg></button>
          <button type="button" class="mlweb-imtool-win-btn btn-max" title="${t.maximize}" aria-label="${t.maximize}"><svg class="ic-max" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 9.5v-7h7v7z"/></svg><svg class="ic-restore" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 4V2.5h5.5V8H8M2.5 4H8v5.5H2.5z"/></svg></button>
        </div>
        <div class="mlweb-imtool-title-wrap">
          <span class="mlweb-imtool-title" title="${titleText}">${titleText}</span>
          <svg class="mlweb-imtool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
            <circle cx="9" cy="9" r="2"/>
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
          </svg>
        </div>
        <div class="mlweb-imtool-min-chip" title="${titleText}">
          <canvas class="mlweb-imtool-min-thumb" width="56" height="56" aria-hidden="true"></canvas>
          <span class="mlweb-imtool-min-num">${this.winNo}</span>
          <span class="mlweb-imtool-min-name">${esc(this.name || t.title)}</span>
        </div>
        <span class="mlweb-imtool-titlebar-spacer" aria-hidden="true"></span>
      </div>
      <div class="mlweb-imtool-toolbar">
        <div class="mlweb-imtool-tb-group">
          <button type="button" class="mlweb-imtool-tb-btn btn-zoom-out" title="${t.zoomOut}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button type="button" class="mlweb-imtool-tb-btn btn-zoom-in" title="${t.zoomIn}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <span class="mlweb-imtool-zoom-display">100%</span>
        </div>
        <div class="mlweb-imtool-tb-sep"></div>
        <div class="mlweb-imtool-tb-group">
          <button type="button" class="mlweb-imtool-tb-btn btn-fit">${t.fit}</button>
          <button type="button" class="mlweb-imtool-tb-btn btn-actual">${t.actual}</button>
        </div>
        <div class="mlweb-imtool-tb-sep"></div>
        <div class="mlweb-imtool-tb-group">
          <button type="button" class="mlweb-imtool-tb-btn btn-toggle-values is-active" title="${t.toggleValuesTitle}" aria-label="${t.toggleValues}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M4 10h16M4 16h16M10 4v16M16 4v16"/></svg>
            <span class="mlweb-imtool-tb-label">${t.toggleValues}</span>
          </button>
          <button type="button" class="mlweb-imtool-tb-btn btn-info" title="${t.infoTitle}" aria-label="${t.info}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            <span class="mlweb-imtool-tb-label">${t.info}</span>
          </button>
          <button type="button" class="mlweb-imtool-tb-btn btn-more" title="${t.moreTitle}" aria-label="${t.more}" aria-haspopup="menu">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>
        </div>
        <span class="mlweb-imtool-tb-hint">${t.hint}</span>
      </div>
      <div class="mlweb-imtool-body">
        <div class="mlweb-imtool-stage" tabindex="0">
          <canvas class="mlweb-imtool-canvas"></canvas>
          <canvas class="mlweb-imtool-overlay"></canvas>
          <div class="mlweb-imtool-pop pop-more" hidden role="menu">
            <div class="mlweb-imtool-pop-head">${t.view}</div>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitemcheckbox" data-toggle="grid"><span class="chk"></span><span class="lbl">${t.grid}</span><kbd>G</kbd></button>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitemcheckbox" data-toggle="rulers"><span class="chk"></span><span class="lbl">${t.rulers}</span><kbd>R</kbd></button>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitemcheckbox" data-toggle="crosshair"><span class="chk"></span><span class="lbl">${t.crosshair}</span><kbd>C</kbd></button>
            <div class="mlweb-imtool-pop-sep" role="separator"></div>
            <div class="mlweb-imtool-pop-head">${t.exportLabel}</div>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitem" data-act="copy-image"><span class="lbl">${t.copyImage}</span><kbd>Ctrl+C</kbd></button>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitem" data-act="png"><span class="lbl">${t.savePng}</span></button>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitem" data-act="jpg"><span class="lbl">${t.saveJpg}</span></button>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitem" data-act="matrix"><span class="lbl">${t.copyMatrix}</span></button>
            <div class="mlweb-imtool-pop-sep" role="separator"></div>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitem" data-act="help"><span class="lbl">${t.shortcuts}</span><kbd>?</kbd></button>
          </div>
          <div class="mlweb-imtool-pop pop-help" hidden role="dialog" aria-label="${t.shortcuts}">
            <div class="mlweb-imtool-pop-title">${t.shortcuts}</div>
            <div class="mlweb-imtool-keys">${t.keys.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('')}</div>
          </div>
          <div class="mlweb-imtool-toast" role="status" aria-live="polite"></div>
          <div class="mlweb-imtool-info-card" hidden>
            <div class="mlweb-imtool-info-head">
              <h4>${titleText}</h4>
              <button type="button" class="mlweb-imtool-win-btn btn-close-info">×</button>
            </div>
            <div class="mlweb-imtool-info-grid">
              <span class="mlweb-imtool-info-label">${t.size}</span>
              <span class="mlweb-imtool-info-val">${w} × ${h} px</span>
              <span class="mlweb-imtool-info-label">${t.totalPixels}</span>
              <span class="mlweb-imtool-info-val">${(w * h).toLocaleString()}</span>
              <span class="mlweb-imtool-info-label">${t.colorType}</span>
              <span class="mlweb-imtool-info-val">${this.isGrayscale ? t.grayscale : t.rgb}</span>
              <span class="mlweb-imtool-info-label">${t.class}</span>
              <span class="mlweb-imtool-info-val">uint8</span>
              <span class="mlweb-imtool-info-label">${t.minVal}</span>
              <span class="mlweb-imtool-info-val">${this.minVal}</span>
              <span class="mlweb-imtool-info-label">${t.maxVal}</span>
              <span class="mlweb-imtool-info-val">${this.maxVal}</span>
              <span class="mlweb-imtool-info-label">${t.meanVal}</span>
              <span class="mlweb-imtool-info-val">${this.meanVal.toFixed(1)}</span>
              <span class="mlweb-imtool-info-label">${t.memory}</span>
              <span class="mlweb-imtool-info-val">${((w * h * (this.isGrayscale ? 1 : 3)) / 1024).toFixed(1)} KB</span>
            </div>
          </div>
        </div>
      </div>
      <div class="mlweb-imtool-statusbar">
        <div class="mlweb-imtool-status-pixel">${t.pixelPrompt}</div>
        <div class="mlweb-imtool-status-meta">${w}×${h} · uint8 · ${this.isGrayscale ? 'Grayscale' : 'RGB'}</div>
      </div>
      <!-- Resizers -->
      <div class="mlweb-imtool-resizer r-e" data-dir="e"></div>
      <div class="mlweb-imtool-resizer r-s" data-dir="s"></div>
      <div class="mlweb-imtool-resizer r-w" data-dir="w"></div>
      <div class="mlweb-imtool-resizer r-n" data-dir="n"></div>
      <div class="mlweb-imtool-resizer r-se" data-dir="se"></div>
      <div class="mlweb-imtool-resizer r-sw" data-dir="sw"></div>
      <div class="mlweb-imtool-resizer r-ne" data-dir="ne"></div>
      <div class="mlweb-imtool-resizer r-nw" data-dir="nw"></div>
      <div class="mlweb-imtool-grip"></div>
    `;

    this.win = win;
    this.titlebar = win.querySelector('.mlweb-imtool-titlebar');
    this.stage = win.querySelector('.mlweb-imtool-stage');
    this.canvas = win.querySelector('.mlweb-imtool-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.zoomDisplay = win.querySelector('.mlweb-imtool-zoom-display');
    this.pixelStatus = win.querySelector('.mlweb-imtool-status-pixel');
    this.infoCard = win.querySelector('.mlweb-imtool-info-card');
    this.valuesBtn = win.querySelector('.btn-toggle-values');
    this.overlay = win.querySelector('.mlweb-imtool-overlay');
    this.octx = this.overlay.getContext('2d');
    this.toast = win.querySelector('.mlweb-imtool-toast');
    this.pops = {
      more: win.querySelector('.pop-more'),
      help: win.querySelector('.pop-help'),
    };
    this.moreBtn = win.querySelector('.btn-more');
    // the shortcuts popover opens from the same button as the menu
    this.menuBtns = { more: this.moreBtn, help: this.moreBtn };

    this.drawThumb(win.querySelector('.mlweb-imtool-min-thumb'));
    this.hookEvents();
    this.container.appendChild(win);
    openWindows.set(win, this);
    win.focus({ preventScroll: true });
  }

  /** Small preview of the image for the minimized tab (contain-fit, crisp pixels for tiny images). */
  drawThumb(cv) {
    const g = cv && cv.getContext('2d');
    if (!g) return;
    const { w, h } = this.image;
    const k = Math.min(cv.width / w, cv.height / h);
    g.imageSmoothingEnabled = k < 1;
    g.clearRect(0, 0, cv.width, cv.height);
    const dw = Math.max(1, Math.round(w * k)), dh = Math.max(1, Math.round(h * k));
    g.drawImage(this.offscreen, Math.round((cv.width - dw) / 2), Math.round((cv.height - dh) / 2), dw, dh);
  }

  /**
   * Window size that fits the image, like MATLAB's imtool: the image at 100% with no empty margin.
   * Tiny images (a 8x8 matrix is the classic classroom case) open at a whole-number zoom so pixels are readable;
   * images larger than the screen are shrunk to fit it. Also sets this.initZoom.
   */
  fitWindowSize() {
    const { w, h } = this.image;
    const win = this.win;
    // Measure the chrome (title bar + toolbar + status bar + border) around the stage.
    win.style.width = '400px';
    win.style.height = '400px';
    const chromeW = win.offsetWidth - this.stage.clientWidth;
    const chromeH = win.offsetHeight - this.stage.clientHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const maxStageW = Math.max(120, vw - 40 - chromeW);
    const maxStageH = Math.max(120, vh - 60 - chromeH);
    const zFit = Math.min(maxStageW / w, maxStageH / h);
    let z;
    if (zFit >= 1) z = Math.min(zFit, Math.max(1, Math.min(INIT_MAX_ZOOM, Math.floor(INIT_TARGET / Math.max(w, h)))));
    else z = Math.max(0.05, Math.floor(zFit * 100) / 100);
    this.initZoom = z;
    const minW = 300, minH = 240; // same limits as the resize handles
    return {
      w: Math.min(Math.max(minW, Math.ceil(w * z) + chromeW), vw - 8),
      h: Math.min(Math.max(minH, Math.ceil(h * z) + chromeH), vh - 8),
    };
  }

  /** Initial magnification, image centred in the stage (the window was sized to it). */
  applyInitialView() {
    const { w, h } = this.image;
    const stageW = this.stage.clientWidth, stageH = this.stage.clientHeight;
    this.zoom = this.initZoom;
    this.panX = (stageW - w * this.zoom) / 2;
    this.panY = (stageH - h * this.zoom) / 2;
  }

  applyInitialCascade() {
    const idx = cascadeCounter++;
    const { w: defaultW, h: defaultH } = this.fitWindowSize();

    const step = 32;
    const maxOffset = 7;
    const offset = (idx % (maxOffset + 1)) * step;

    const baseLeft = 60;
    const baseTop = 70;

    let left = baseLeft + offset;
    let top = baseTop + offset;

    // Bounds safety
    if (left + defaultW > window.innerWidth - 20) left = Math.max(20, window.innerWidth - defaultW - 20);
    if (top + defaultH > window.innerHeight - 20) top = Math.max(40, window.innerHeight - defaultH - 20);

    this.win.style.width = `${defaultW}px`;
    this.win.style.height = `${defaultH}px`;
    this.win.style.left = `${left}px`;
    this.win.style.top = `${top}px`;

    // The chrome can wrap differently at the final width: close any small gap so the image fits with no scrollbar-like margin.
    const z = this.initZoom;
    const gapW = Math.ceil(this.image.w * z) - this.stage.clientWidth;
    const gapH = Math.ceil(this.image.h * z) - this.stage.clientHeight;
    if (gapW > 0 && gapW < 16 && defaultW + gapW <= window.innerWidth - 8) this.win.style.width = `${defaultW + gapW}px`;
    if (gapH > 0 && gapH < 16 && defaultH + gapH <= window.innerHeight - 8) this.win.style.height = `${defaultH + gapH}px`;
  }

  /** Which of the 6 Aero Snap zones the pointer is in (or null). */
  aeroZone(x, y) {
    const iw = window.innerWidth, ih = window.innerHeight;
    const left = x <= AERO_EDGE, right = x >= iw - AERO_EDGE;
    if (!left && !right) return null;
    const side = left ? 'left' : 'right';
    if (y <= AERO_CORNER) return `top-${side}`;
    if (y >= ih - AERO_CORNER) return `bottom-${side}`;
    return side;
  }

  aeroRect(zone) {
    const iw = window.innerWidth, ih = window.innerHeight;
    const hw = Math.floor(iw / 2), hh = Math.floor(ih / 2);
    const right = zone.endsWith('right');
    const l = right ? iw - hw : 0;
    if (zone === 'left' || zone === 'right') return { l, t: 0, w: hw, h: ih };
    return { l, t: zone.startsWith('top') ? 0 : ih - hh, w: hw, h: hh };
  }

  /** Live outline of where the window will land. Starts at the window's own rect and morphs to the target. */
  updateSnapPreview(zone) {
    let pv = this.snapPreview;
    if (!zone) {
      if (!pv) return;
      pv.classList.remove('is-visible');
      this.snapPreview = null;
      setTimeout(() => pv.remove(), 220);
      return;
    }
    const r = this.aeroRect(zone);
    if (!pv) {
      pv = document.createElement('div');
      pv.className = 'mlweb-imtool-snap-preview';
      pv.style.zIndex = String(topZIndex + 1);
      const wr = this.win.getBoundingClientRect();
      Object.assign(pv.style, { left: `${wr.left}px`, top: `${wr.top}px`, width: `${wr.width}px`, height: `${wr.height}px` });
      document.body.appendChild(pv);
      this.snapPreview = pv;
      pv.getBoundingClientRect(); // commit the start rect so the transition runs
    }
    pv.classList.add('is-visible');
    Object.assign(pv.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  applyAeroSnap(zone) {
    const r = this.aeroRect(zone);
    if (!this.snapRestore) this.snapRestore = { w: this.win.offsetWidth, h: this.win.offsetHeight };
    Object.assign(this.win.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.w}px`, height: `${r.h}px` });
    this.render();
  }

  /** Rectangles of the other visible (not minimized / maximized) image windows. */
  otherRects() {
    const out = [];
    for (const [el, inst] of openWindows) {
      if (inst === this || inst.isMinimized || inst.isMaximized) continue;
      const l = el.offsetLeft, t = el.offsetTop;
      out.push({ l, t, r: l + el.offsetWidth, b: t + el.offsetHeight });
    }
    return out;
  }

  /**
   * Magnetic edges while moving: the window sticks to the screen edges and to the edges of neighbouring windows
   * (butt against them, or line up with them) when within SNAP px. A neighbour only attracts when the two windows
   * overlap along the other axis, so a far-away window never pulls.
   */
  snapRect(l, t, w, h) {
    const iw = window.innerWidth, ih = window.innerHeight;
    const xs = [0, iw - w], ys = [0, ih - h];
    for (const o of this.otherRects()) {
      if (t < o.b + SNAP && t + h > o.t - SNAP) xs.push(o.r, o.l - w, o.l, o.r - w);
      if (l < o.r + SNAP && l + w > o.l - SNAP) ys.push(o.b, o.t - h, o.t, o.b - h);
    }
    return { left: nearest(l, xs), top: nearest(t, ys) };
  }

  bringToFront() {
    if (this.isMaximized) {
      this.win.style.zIndex = '12000';
    } else {
      this.win.style.zIndex = String(++topZIndex);
    }
    for (const [w] of openWindows) w.classList.remove('is-focused');
    this.win.classList.add('is-focused');
    if (document.activeElement !== this.win && !this.win.contains(document.activeElement)) this.win.focus({ preventScroll: true });
  }

  hookEvents() {
    const win = this.win;

    // Focus on click
    win.addEventListener('pointerdown', () => this.bringToFront());

    // Titlebar dragging (disabled when maximized)
    this.titlebar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      if (this.isMaximized || this.isMinimized) return;
      e.preventDefault();
      this.bringToFront();
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      let startWinLeft = this.win.offsetLeft;
      const startWinTop = this.win.offsetTop;
      const grabRatio = Math.min(0.9, Math.max(0.1, (e.clientX - startWinLeft) / (this.win.offsetWidth || 1)));
      this.titlebar.setPointerCapture(e.pointerId);

      const onMove = (moveEv) => {
        if (this.isMaximized) return;
        // Dragging a snapped window out restores its previous size (pointer keeps its place on the title bar)
        if (this.snapRestore && Math.hypot(moveEv.clientX - startMouseX, moveEv.clientY - startMouseY) > 4) {
          const r = this.snapRestore;
          this.snapRestore = null;
          win.style.width = `${r.w}px`;
          win.style.height = `${r.h}px`;
          startWinLeft = Math.round(startMouseX - r.w * grabRatio);
          this.render();
        }
        const dx = moveEv.clientX - startMouseX;
        const dy = moveEv.clientY - startMouseY;
        let newLeft = startWinLeft + dx;
        let newTop = startWinTop + dy;

        // Keep header visible in viewport
        newLeft = Math.max(-win.offsetWidth + 100, Math.min(window.innerWidth - 100, newLeft));
        newTop = Math.max(0, Math.min(window.innerHeight - 40, newTop));
        ({ left: newLeft, top: newTop } = this.snapRect(newLeft, newTop, win.offsetWidth, win.offsetHeight));

        win.style.left = `${newLeft}px`;
        win.style.top = `${newTop}px`;

        const zone = this.aeroZone(moveEv.clientX, moveEv.clientY);
        if (zone !== this._aeroZone) { this._aeroZone = zone; this.updateSnapPreview(zone); }
      };

      const onUp = (upEv) => {
        const zone = this._aeroZone;
        this._aeroZone = null;
        this.updateSnapPreview(null);
        if (zone && upEv.type === 'pointerup') this.applyAeroSnap(zone);
        this.titlebar.releasePointerCapture(upEv.pointerId);
        this.titlebar.removeEventListener('pointermove', onMove);
        this.titlebar.removeEventListener('pointerup', onUp);
        this.titlebar.removeEventListener('pointercancel', onUp);
      };

      this.titlebar.addEventListener('pointermove', onMove);
      this.titlebar.addEventListener('pointerup', onUp);
      this.titlebar.addEventListener('pointercancel', onUp);
    });
    this.titlebar.addEventListener('click', (e) => {
      if (this.isMinimized && !e.target.closest('button')) this.toggleMinimize();
    });

    this.titlebar.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      if (this.isMinimized || Date.now() - this._lastMinToggle < 600) return;
      this.toggleMaximize();
    });

    // Window controls
    win.querySelector('.btn-close').addEventListener('click', () => this.close());
    win.querySelector('.btn-max').addEventListener('click', () => {
      if (this.isMinimized) this.toggleMinimize();
      else this.toggleMaximize();
    });
    win.querySelector('.btn-min').addEventListener('click', () => this.toggleMinimize());

    // Toolbar controls
    win.querySelector('.btn-zoom-in').addEventListener('click', () => this.zoomRelative(1.25));
    win.querySelector('.btn-zoom-out').addEventListener('click', () => this.zoomRelative(1 / 1.25));
    win.querySelector('.btn-fit').addEventListener('click', () => { this.fitToWindow(); this.render(); });
    win.querySelector('.btn-actual').addEventListener('click', () => { this.actualSize(); this.render(); });

    this.valuesBtn.addEventListener('click', () => {
      this.showPixelValues = !this.showPixelValues;
      this.valuesBtn.classList.toggle('is-active', this.showPixelValues);
      this.render();
    });

    const infoBtn = win.querySelector('.btn-info');
    infoBtn.addEventListener('click', () => {
      this.infoCard.hidden = !this.infoCard.hidden;
      infoBtn.classList.toggle('is-active', !this.infoCard.hidden);
    });
    this.infoCard.querySelector('.btn-close-info').addEventListener('click', () => {
      this.infoCard.hidden = true;
      infoBtn.classList.remove('is-active');
    });

    // "..." More menu (overlays, export, help) + the shortcuts popover
    this.moreBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu('more'); });
    for (const pop of Object.values(this.pops)) {
      pop.addEventListener('wheel', (e) => e.stopPropagation());
      pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    this.pops.more.addEventListener('click', (e) => {
      const tog = e.target.closest('[data-toggle]');
      if (tog) { this.toggleSetting(tog.dataset.toggle); return; } // stays open so several overlays can be switched in a row
      const item = e.target.closest('[data-act]');
      if (!item) return;
      this.closeMenus();
      this.win.focus({ preventScroll: true }); // the clicked item is now hidden; keep keyboard shortcuts working
      const act = item.dataset.act;
      if (act === 'copy-image') this.copyImage();
      else if (act === 'png') this.saveImage('png');
      else if (act === 'jpg') this.saveImage('jpg');
      else if (act === 'matrix') this.copyMatrix();
      else if (act === 'help') this.toggleMenu('help');
    });
    this.syncViewMenu();
    // click anywhere else in the window (toolbar gaps, titlebar) closes menus
    win.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.mlweb-imtool-pop, .btn-more')) this.closeMenus();
    });

    // Resize handles (disabled when maximized)
    win.querySelectorAll('.mlweb-imtool-resizer').forEach(handle => {
      handle.addEventListener('pointerdown', (e) => {
        if (this.isMaximized) return;
        e.preventDefault();
        e.stopPropagation();
        this.closeMenus();
        this.bringToFront();
        const dir = handle.dataset.dir;
        this.snapRestore = null;
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = win.offsetWidth;
        const startH = win.offsetHeight;
        const startL = win.offsetLeft;
        const startT = win.offsetTop;
        handle.setPointerCapture(e.pointerId);

        const onResizeMove = (mEv) => {
          if (this.isMaximized) return;
          const dx = mEv.clientX - startX;
          const dy = mEv.clientY - startY;
          let newW = startW, newH = startH, newL = startL, newT = startT;
          const minW = 300, minH = 240;

          if (dir.includes('e')) newW = Math.max(minW, startW + dx);
          if (dir.includes('s')) newH = Math.max(minH, startH + dy);
          if (dir.includes('w')) {
            const wClamped = Math.max(minW, startW - dx);
            newL = startL + (startW - wClamped);
            newW = wClamped;
          }
          if (dir.includes('n')) {
            const hClamped = Math.max(minH, startH - dy);
            newT = startT + (startH - hClamped);
            newH = hClamped;
          }

          // magnetic edges: screen edges + neighbouring windows (only those overlapping along the other axis)
          const iw = window.innerWidth, ih = window.innerHeight;
          const others = this.otherRects();
          const vOver = others.filter((o) => newT < o.b + SNAP && newT + newH > o.t - SNAP).flatMap((o) => [o.l, o.r]);
          const hOver = others.filter((o) => newL < o.r + SNAP && newL + newW > o.l - SNAP).flatMap((o) => [o.t, o.b]);
          if (dir.includes('e')) { const right = nearest(newL + newW, [iw, ...vOver]); if (right - newL >= minW) newW = right - newL; }
          if (dir.includes('s')) { const bottom = nearest(newT + newH, [ih, ...hOver]); if (bottom - newT >= minH) newH = bottom - newT; }
          if (dir.includes('w')) { const left = nearest(newL, [0, ...vOver]); const right = newL + newW; if (right - left >= minW) { newW = right - left; newL = left; } }
          if (dir.includes('n')) { const top = nearest(newT, [0, ...hOver]); const bottom = newT + newH; if (bottom - top >= minH) { newH = bottom - top; newT = top; } }

          win.style.width = `${newW}px`;
          win.style.height = `${newH}px`;
          win.style.left = `${newL}px`;
          win.style.top = `${newT}px`;
          this.render();
        };

        const onResizeUp = (uEv) => {
          handle.releasePointerCapture(uEv.pointerId);
          handle.removeEventListener('pointermove', onResizeMove);
          handle.removeEventListener('pointerup', onResizeUp);
          handle.removeEventListener('pointercancel', onResizeUp);
          this.render();
        };

        handle.addEventListener('pointermove', onResizeMove);
        handle.addEventListener('pointerup', onResizeUp);
        handle.addEventListener('pointercancel', onResizeUp);
      });
    });

    // ResizeObserver on stage to redraw canvas
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.stage);

    // Mouse wheel cursor-centered zoom (supports up to 12800%)
    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.stage.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
      this.zoomAt(mouseX, mouseY, factor);
    }, { passive: false });

    // Stage gestures: one pointer pans, two pointers pinch-zoom (and pan with the midpoint).
    // Pointers are tracked in one map, so a second finger can never start a second, competing pan.
    this.pointers = new Map();
    let pinch = null;
    const stagePt = (e) => { const r = this.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pair = () => { const [a, b] = [...this.pointers.values()]; return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };

    this.stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mlweb-imtool-info-card, .mlweb-imtool-pop')) return;
      e.preventDefault();
      this.bringToFront();
      if (this.pointers.size >= 2) return;
      this.pointers.set(e.pointerId, stagePt(e));
      // tap candidate (touch / pen only): a single finger that barely moves
      this._tap = this.pointers.size === 1 && e.pointerType !== 'mouse'
        ? { t: Date.now(), x: e.clientX, y: e.clientY, moved: false } : null;
      this._click = this.pointers.size === 1 && e.pointerType === 'mouse' && e.button === 0
        ? { x: e.clientX, y: e.clientY, moved: false } : null; // a mouse click that does not turn into a drag pins the pixel
      try { this.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (e.pointerType === 'touch' && this.pointers.size === 1) this.trackCursorPixel(e); // a plain tap reads the pixel too
      this.isPanning = true;
      this.stage.classList.add('is-panning');
      if (this.pointers.size === 2) { pinch = pair(); this._tap = null; this._lastTap = null; }
    });

    this.stage.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) { this.trackCursorPixel(e); return; }
      const cur = stagePt(e);
      if (this._tap && Math.hypot(e.clientX - this._tap.x, e.clientY - this._tap.y) > 10) this._tap.moved = true;
      if (this._click && Math.hypot(e.clientX - this._click.x, e.clientY - this._click.y) > 4) this._click.moved = true;
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 2 && pinch) {
        const now = pair();
        this.panX += now.mid.x - pinch.mid.x;
        this.panY += now.mid.y - pinch.mid.y;
        const before = this.zoom;
        this.zoomAt(now.mid.x, now.mid.y, now.dist / pinch.dist); // renders when the zoom changed
        if (this.zoom === before) this.render(); // zoom limit reached: still follow the fingers
        pinch = now;
      } else {
        this.panX += cur.x - prev.x;
        this.panY += cur.y - prev.y;
        this.render();
        this.trackCursorPixel(e);
      }
    });

    const endPointer = (e) => {
      const wasSingle = this.pointers.size === 1;
      if (!this.pointers.delete(e.pointerId)) return;
      try { this.stage.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const click = this._click;
      this._click = null;
      if (e.type === 'pointerup' && click && !click.moved) this.togglePin(e);
      if (e.type === 'pointerup' && wasSingle && this._tap && !this._tap.moved && Date.now() - this._tap.t < 300) {
        const last = this._lastTap;
        const now = { t: Date.now(), x: e.clientX, y: e.clientY };
        if (last && now.t - last.t < 350 && Math.hypot(now.x - last.x, now.y - last.y) < 30) {
          this._lastTap = null;
          if (Math.abs(this.zoom - 1) < 0.001) this.fitToWindow(); else this.actualSize();
          this.render();
        } else {
          this._lastTap = now;
        }
      }
      this._tap = null;
      pinch = null;
      if (!this.pointers.size) { this.isPanning = false; this.stage.classList.remove('is-panning'); }
    };
    this.stage.addEventListener('pointerup', endPointer);
    this.stage.addEventListener('pointercancel', endPointer);
    this.stage.addEventListener('lostpointercapture', endPointer);

    this.stage.addEventListener('pointerleave', (e) => {
      // Lifting a finger fires pointerleave: the touched pixel must stay on screen (only a mouse/pen leaving clears the hover).
      if (e.pointerType === 'touch') return;
      this.cursor = null;
      this.hover = null;
      this.drawOverlay();
      if (!this.isPanning) this.updateStatus(); // shows the pinned pixel, if any

    });

    // Keyboard shortcuts while window is focused
    win.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      const key = e.key;
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'c') {
        if (String(window.getSelection && window.getSelection()) === '') { e.preventDefault(); this.copyImage(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      const step = e.shiftKey ? 160 : 40;
      let handled = true;
      if (key === 'Escape') {
        if (this.anyMenuOpen()) this.closeMenus();
        else if (this.isMaximized) this.toggleMaximize();
        else this.close();
      } else if (key === '+' || key === '=') this.zoomRelative(1.25);
      else if (key === '-' || key === '_') this.zoomRelative(1 / 1.25);
      else if (key === '0') { this.fitToWindow(); this.render(); }
      else if (key === '1') { this.actualSize(); this.render(); }
      else if (key === 'ArrowLeft') { this.panX += step; this.render(); }
      else if (key === 'ArrowRight') { this.panX -= step; this.render(); }
      else if (key === 'ArrowUp') { this.panY += step; this.render(); }
      else if (key === 'ArrowDown') { this.panY -= step; this.render(); }
      else if (lower === 'i') win.querySelector('.btn-info').click();
      else if (lower === 'g') this.toggleSetting('grid');
      else if (lower === 'r') this.toggleSetting('rulers');
      else if (lower === 'c') this.toggleSetting('crosshair');
      else if (key === '?' || (key === '/' && e.shiftKey)) this.toggleMenu('help');
      else handled = false;
      if (handled) e.preventDefault();
    });
  }

  // ---- popovers, toast, settings ------------------------------------------
  anyMenuOpen() { return Object.values(this.pops).some(p => !p.hidden); }

  closeMenus() {
    if (this._outside) { document.removeEventListener('pointerdown', this._outside, true); this._outside = null; }
    for (const [name, pop] of Object.entries(this.pops)) {
      pop.hidden = true;
      this.menuBtns[name].classList.remove('is-active');
    }
  }

  /**
   * Opens a popover. It floats above the page (appended to <body>, position: fixed) so a long menu is never
   * clipped by a small image window; it closes on any outside click, on minimize / maximize and when the window moves.
   */
  toggleMenu(name) {
    const wasOpen = !this.pops[name].hidden;
    this.closeMenus();
    if (wasOpen || this.isMinimized) return;
    const pop = this.pops[name];
    if (pop.parentElement !== document.body) document.body.appendChild(pop);
    pop.style.zIndex = String((parseInt(this.win.style.zIndex, 10) || topZIndex) + 1);
    pop.hidden = false;
    this.menuBtns[name].classList.add('is-active');
    const br = this.menuBtns[name].getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const h = pop.offsetHeight, w = pop.offsetWidth;
    const left = Math.max(8, Math.min(br.left, vw - w - 8));
    let top = br.bottom + 6;
    if (top + h > vh - 8) top = br.top - h - 6 >= 8 ? br.top - h - 6 : Math.max(8, vh - h - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    this._outside = (ev) => { if (!ev.target.closest('.mlweb-imtool-pop, .btn-more')) this.closeMenus(); };
    document.addEventListener('pointerdown', this._outside, true);
  }

  syncViewMenu() {
    const map = { grid: this.showGrid, rulers: this.showRulers, crosshair: this.showCrosshair };
    this.pops.more.querySelectorAll('[data-toggle]').forEach((el) => {
      const on = !!map[el.dataset.toggle];
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-checked', String(on));
    });
  }

  toggleSetting(name) {
    if (name === 'grid') this.showGrid = !this.showGrid;
    else if (name === 'rulers') this.showRulers = !this.showRulers;
    else if (name === 'crosshair') this.showCrosshair = !this.showCrosshair;
    else return;
    writeStore(PREF_KEY, { grid: this.showGrid, rulers: this.showRulers, crosshair: this.showCrosshair });
    this.syncViewMenu();
    this.render();
  }

  showToast(msg) {
    this.toast.textContent = msg;
    this.toast.classList.add('is-show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toast.classList.remove('is-show'), 2200);
  }

  /** Pixel (0-based image coords) under a pointer event, or null outside the image. */
  pixelAt(e) {
    const rect = this.stage.getBoundingClientRect();
    const px = Math.floor((e.clientX - rect.left - this.panX) / this.zoom);
    const py = Math.floor((e.clientY - rect.top - this.panY) / this.zoom);
    const { w, h } = this.image;
    return px >= 0 && px < w && py >= 0 && py < h ? { x: px, y: py } : null;
  }

  pixelValue(x, y) {
    const { w, rgb } = this.image;
    const i = (y * w + x) * 3;
    return this.isGrayscale ? `Val: ${rgb[i]}` : `RGB: [${rgb[i]}, ${rgb[i + 1]}, ${rgb[i + 2]}]`;
  }

  /** Status bar: the hovered pixel, else the pinned one, else the prompt. Coordinates are 1-based like MATLAB. */
  updateStatus() {
    const show = (p, fmt) => fmt(p.x + 1, p.y + 1, this.pixelValue(p.x, p.y));
    const t = this.t;
    this.pixelStatus.textContent = this.hover ? show(this.hover, t.pixelFmt) : this.pin ? show(this.pin, t.pinnedFmt) : t.pixelPrompt;
    this.pixelStatus.classList.toggle('is-pinned', !this.hover && !!this.pin);
  }

  /** Click on a pixel pins it; clicking the pinned pixel again unpins. */
  togglePin(e) {
    const p = this.pixelAt(e);
    if (!p) return;
    this.pin = this.pin && this.pin.x === p.x && this.pin.y === p.y ? null : p;
    this.updateStatus();
    this.drawOverlay();
  }

  trackCursorPixel(e) {
    const p = this.pixelAt(e);
    if (e.pointerType === 'touch') {
      if (p) this.pin = p; // a finger pins what it touches; stays after it lifts
    } else {
      const rect = this.stage.getBoundingClientRect();
      this.cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.hover = p;
    }
    this.updateStatus();
    this.drawOverlay();
  }

  zoomAt(stageX, stageY, factor) {
    const oldZoom = this.zoom;
    // Extended max zoom to 128.0 (12800%) so pixel values are huge and easily readable
    const newZoom = Math.max(0.05, Math.min(128.0, oldZoom * factor));
    if (Math.abs(newZoom - oldZoom) < 0.0001) return;

    // Image coordinates under the cursor
    const imgX = (stageX - this.panX) / oldZoom;
    const imgY = (stageY - this.panY) / oldZoom;

    // Adjust pan so the image coordinate under the cursor remains fixed
    this.panX = stageX - imgX * newZoom;
    this.panY = stageY - imgY * newZoom;
    this.zoom = newZoom;

    this.render();
  }

  zoomRelative(factor) {
    const stageW = this.stage.clientWidth;
    const stageH = this.stage.clientHeight;
    this.zoomAt(stageW / 2, stageH / 2, factor);
  }

  fitToWindow() {
    const { w, h } = this.image;
    const stageW = this.stage.clientWidth;
    const stageH = this.stage.clientHeight;
    const pad = 36;
    // Scales image up or down to fill available space nicely with padding
    const scale = Math.min((stageW - pad) / w, (stageH - pad) / h);
    this.zoom = Math.max(0.05, Math.min(128.0, scale));
    this.panX = (stageW - w * this.zoom) / 2;
    this.panY = (stageH - h * this.zoom) / 2;
  }

  actualSize() {
    const { w, h } = this.image;
    const stageW = this.stage.clientWidth;
    const stageH = this.stage.clientHeight;
    this.zoom = 1.0; // Strictly 1:1 pixel representation
    this.panX = (stageW - w) / 2;
    this.panY = (stageH - h) / 2;
  }

  toggleMaximize() {
    this.closeMenus();
    const maxBtn = this.win.querySelector('.btn-max');
    if (this.isMaximized) {
      // Restore
      this.isMaximized = false;
      this.win.classList.remove('is-maximized');
      this.win.style.zIndex = String(++topZIndex);
      if (this.savedRect) {
        this.win.style.left = this.savedRect.left;
        this.win.style.top = this.savedRect.top;
        this.win.style.width = this.savedRect.width;
        this.win.style.height = this.savedRect.height;
      }
      maxBtn.title = this.t.maximize;
      maxBtn.setAttribute('aria-label', this.t.maximize);
    } else {
      // Maximize
      this.isMaximized = true;
      this.savedRect = {
        left: this.win.style.left,
        top: this.win.style.top,
        width: this.win.style.width,
        height: this.win.style.height,
      };
      this.win.classList.add('is-maximized');
      this.win.style.zIndex = '12000'; // Sits above all UI, sidebar, and bottom-nav
      this.win.style.left = '0px';
      this.win.style.top = '0px';
      this.win.style.width = '100vw';
      this.win.style.height = '100vh';
      maxBtn.title = this.t.restore;
      maxBtn.setAttribute('aria-label', this.t.restore);
    }
    requestAnimationFrame(() => this.render());
  }

  toggleMinimize() {
    const maxBtn = this.win.querySelector('.btn-max');
    if (this.isMaximized) this.toggleMaximize();

    this.closeMenus();
    this._lastMinToggle = Date.now();
    this.isMinimized = !this.isMinimized;
    this.win.classList.toggle('is-minimized', this.isMinimized);
    maxBtn.title = this.isMinimized ? this.t.restore : this.t.maximize;
    maxBtn.setAttribute('aria-label', maxBtn.title);

    layoutMinimizedWindows();

    if (!this.isMinimized) requestAnimationFrame(() => this.render());
  }

  /** Keeps at least a margin of the image inside the stage (a glitchy gesture can no longer lose it). */
  clampPan(stageW, stageH) {
    const { w, h } = this.image;
    const m = Math.min(48, stageW / 2, stageH / 2);
    this.panX = Math.min(stageW - m, Math.max(m - w * this.zoom, this.panX));
    this.panY = Math.min(stageH - m, Math.max(m - h * this.zoom, this.panY));
  }

  render() {
    if (!this.ctx || this.isMinimized) return;
    const stageW = this.stage.clientWidth;
    const stageH = this.stage.clientHeight;
    if (stageW === 0 || stageH === 0) return;
    this.clampPan(stageW, stageH);

    // High-DPI support
    const dpr = window.devicePixelRatio || 1;
    const canvas = this.canvas;
    if (canvas.width !== stageW * dpr || canvas.height !== stageH * dpr) {
      canvas.width = stageW * dpr;
      canvas.height = stageH * dpr;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, stageW, stageH);

    const { w, h, rgb } = this.image;
    const zoom = this.zoom;
    const panX = this.panX;
    const panY = this.panY;

    // Nearest-neighbor / pixelated when zoomed in
    ctx.imageSmoothingEnabled = zoom < 1.5;

    // Draw main image
    ctx.drawImage(this.offscreen, panX, panY, w * zoom, h * zoom);

    // Update zoom readout badge
    this.zoomDisplay.textContent = `${Math.round(zoom * 100)}%`;

    // High zoom: Pixel Grid and In-Pixel Numeric Values
    if (zoom >= 8.0) {
      // Find visible pixel bounds in stage coords
      const colStart = Math.max(0, Math.floor(-panX / zoom));
      const colEnd = Math.min(w, Math.ceil((stageW - panX) / zoom));
      const rowStart = Math.max(0, Math.floor(-panY / zoom));
      const rowEnd = Math.min(h, Math.ceil((stageH - panY) / zoom));

      // Draw subtle pixel grid
      if (this.showGrid) {
        ctx.strokeStyle = 'rgba(128, 128, 128, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let col = colStart; col <= colEnd; col++) {
          const x = Math.round(panX + col * zoom) + 0.5;
          ctx.moveTo(x, Math.max(0, panY + rowStart * zoom));
          ctx.lineTo(x, Math.min(stageH, panY + rowEnd * zoom));
        }
        for (let row = rowStart; row <= rowEnd; row++) {
          const y = Math.round(panY + row * zoom) + 0.5;
          ctx.moveTo(Math.max(0, panX + colStart * zoom), y);
          ctx.lineTo(Math.min(stageW, panX + colEnd * zoom), y);
        }
        ctx.stroke();
      }

      // Render In-Pixel Numerical Values
      if (this.showPixelValues && zoom >= 10.0) {
        const isGray = this.isGrayscale;

        for (let row = rowStart; row < rowEnd; row++) {
          for (let col = colStart; col < colEnd; col++) {
            const idx = (row * w + col) * 3;
            const r = rgb[idx], g = rgb[idx + 1], b = rgb[idx + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const isLight = lum > 130;
            const textColor = isLight ? '#000000' : '#ffffff';
            const strokeColor = isLight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)';

            const cx = panX + (col + 0.5) * zoom;
            const cy = panY + (row + 0.5) * zoom;

            if (isGray) {
              const fontSize = Math.min(24, Math.max(8, Math.floor(zoom * 0.26)));
              ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              ctx.lineWidth = 2.5;
              ctx.strokeStyle = strokeColor;
              ctx.strokeText(String(r), cx, cy);

              ctx.fillStyle = textColor;
              ctx.fillText(String(r), cx, cy);
            } else {
              if (zoom >= 24.0) {
                // Stacked 3 RGB channel values with contrast and colored tint
                const fontSize = Math.min(16, Math.max(8, Math.floor(zoom * 0.15)));
                const lineH = fontSize * 1.3;
                ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.lineWidth = 2;

                const drawLine = (text, yPos, colorDark, colorLight) => {
                  ctx.strokeStyle = strokeColor;
                  ctx.strokeText(text, cx, yPos);
                  ctx.fillStyle = isLight ? colorDark : colorLight;
                  ctx.fillText(text, cx, yPos);
                };

                drawLine(`R: ${r}`, cy - lineH, '#a80000', '#ff9494');
                drawLine(`G: ${g}`, cy, '#007800', '#88ff88');
                drawLine(`B: ${b}`, cy + lineH, '#0033cc', '#94b8ff');
              } else {
                // Single scalar luminance when cell size is between 10px and 24px
                const fontSize = Math.min(14, Math.max(8, Math.floor(zoom * 0.26)));
                ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                ctx.lineWidth = 2;
                ctx.strokeStyle = strokeColor;
                ctx.strokeText(String(Math.round(lum)), cx, cy);

                ctx.fillStyle = textColor;
                ctx.fillText(String(Math.round(lum)), cx, cy);
              }
            }
          }
        }
      }
    }

    if (this.showRulers) this.drawRulers(ctx, stageW, stageH);

    ctx.restore();
    this.drawOverlay();
  }

  drawRulers(ctx, stageW, stageH) {
    const { w, h } = this.image;
    const zoom = this.zoom;
    const pickStep = (minPx) => NICE_STEPS.find(n => n * zoom >= minPx) || NICE_STEPS[NICE_STEPS.length - 1];
    const stepX = pickStep(46);
    const stepY = pickStep(24);
    const dark = 'rgba(18, 22, 30, 0.88)';
    const line = 'rgba(160, 170, 190, 0.55)';
    const textCol = 'rgba(210, 216, 230, 0.95)';

    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, stageW, RULER_H);
    ctx.fillRect(0, RULER_H, RULER_W, stageH - RULER_H);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RULER_W + 0.5, RULER_H);
    ctx.lineTo(RULER_W + 0.5, stageH);
    ctx.moveTo(0, RULER_H + 0.5);
    ctx.lineTo(stageW, RULER_H + 0.5);
    ctx.stroke();

    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = textCol;
    ctx.strokeStyle = line;

    // top ruler: columns (1-based, at the pixel centre)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.beginPath();
    ctx.rect(RULER_W + 1, 0, stageW, RULER_H);
    ctx.clip();
    ctx.beginPath();
    const k0 = Math.max(1, Math.floor((RULER_W - this.panX) / zoom));
    const k1 = Math.min(w, Math.ceil((stageW - this.panX) / zoom) + 1);
    for (let k = k0; k <= k1; k++) {
      if (k % stepX !== 0 && !(k === 1 && stepX === 1)) continue;
      const x = Math.round(this.panX + (k - 0.5) * zoom) + 0.5;
      ctx.moveTo(x, RULER_H - 5);
      ctx.lineTo(x, RULER_H);
      ctx.fillText(String(k), x, 7);
    }
    ctx.stroke();
    ctx.restore();

    // left ruler: rows
    ctx.textAlign = 'right';
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_H + 1, RULER_W, stageH);
    ctx.clip();
    ctx.beginPath();
    const r0 = Math.max(1, Math.floor((RULER_H - this.panY) / zoom));
    const r1 = Math.min(h, Math.ceil((stageH - this.panY) / zoom) + 1);
    for (let r = r0; r <= r1; r++) {
      if (r % stepY !== 0 && !(r === 1 && stepY === 1)) continue;
      const y = Math.round(this.panY + (r - 0.5) * zoom) + 0.5;
      ctx.moveTo(RULER_W - 5, y);
      ctx.lineTo(RULER_W, y);
      ctx.fillText(String(r), RULER_W - 7, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Marker around the pinned pixel; follows pan / zoom because it is stored in image coordinates. */
  drawPin(g) {
    const z = this.zoom;
    const s = Math.max(z, 12);
    const cx = this.panX + (this.pin.x + 0.5) * z;
    const cy = this.panY + (this.pin.y + 0.5) * z;
    g.setLineDash([]);
    for (const [lw, col] of [[3.5, 'rgba(0,0,0,0.55)'], [1.5, '#ffd24a']]) {
      g.lineWidth = lw;
      g.strokeStyle = col;
      g.strokeRect(Math.round(cx - s / 2) + 0.5, Math.round(cy - s / 2) + 0.5, Math.round(s), Math.round(s));
    }
  }

  /** Cheap overlay layer: crosshair + ruler cursor marks. Redrawn on every mouse move without touching the image canvas. */
  drawOverlay() {
    const c = this.overlay;
    if (!c || this.isMinimized) return;
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const g = this.octx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (this.pin) this.drawPin(g);
    const cur = this.cursor;
    if (!cur || (!this.showCrosshair && !this.showRulers)) return;

    const { w, h } = this.image;
    let x = cur.x, y = cur.y;
    const px = Math.floor((x - this.panX) / this.zoom);
    const py = Math.floor((y - this.panY) / this.zoom);
    if (px >= 0 && px < w && py >= 0 && py < h) {
      x = this.panX + (px + 0.5) * this.zoom;
      y = this.panY + (py + 0.5) * this.zoom;
    }
    x = Math.round(x) + 0.5;
    y = Math.round(y) + 0.5;

    if (this.showCrosshair) {
      g.setLineDash([5, 4]);
      for (const [lw, col] of [[3, 'rgba(0,0,0,0.4)'], [1, 'rgba(255,255,255,0.92)']]) {
        g.lineWidth = lw;
        g.strokeStyle = col;
        g.beginPath();
        g.moveTo(x, 0); g.lineTo(x, H);
        g.moveTo(0, y); g.lineTo(W, y);
        g.stroke();
      }
      g.setLineDash([]);
    }
    if (this.showRulers) {
      g.fillStyle = '#ff7a3d';
      g.fillRect(x - 1, 0, 2, RULER_H);
      g.fillRect(0, y - 1, RULER_W, 2);
    }
  }

  // ---- export ------------------------------------------------------------
  pngBlob() {
    return new Promise(res => this.offscreen.toBlob(res, 'image/png'));
  }

  /** File name (no extension) for exports: the variable / file name, like MATLAB, else image-<window number>. */
  fileBase() {
    const base = (this.name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\w.-]+/g, '_');
    return `imtool-${base || `${this.t.untitled}${this.winNo}`}`;
  }

  saveImage(kind) {
    const isJpg = kind === 'jpg';
    this.offscreen.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.fileBase()}.${isJpg ? 'jpg' : 'png'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, isJpg ? 'image/jpeg' : 'image/png', isJpg ? 0.92 : undefined);
  }

  async copyImage() {
    try {
      const blob = await this.pngBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.showToast(this.t.copied);
    } catch {
      this.showToast(this.t.copyFailed);
    }
  }

  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  /** Copies pixel values as MATLAB code. Whole image when small, otherwise the visible region (capped). */
  async copyMatrix() {
    const { w, h, rgb } = this.image;
    const CAP = 160000; // pixels
    let x0 = 0, y0 = 0, x1 = w, y1 = h;
    let part = '';
    if (w * h > CAP) {
      const sw = this.stage.clientWidth, sh = this.stage.clientHeight;
      x0 = Math.max(0, Math.floor(-this.panX / this.zoom));
      x1 = Math.min(w, Math.ceil((sw - this.panX) / this.zoom));
      y0 = Math.max(0, Math.floor(-this.panY / this.zoom));
      y1 = Math.min(h, Math.ceil((sh - this.panY) / this.zoom));
      let bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
      if (bw * bh > CAP) {
        const k = Math.sqrt(CAP / (bw * bh));
        const nw = Math.max(1, Math.floor(bw * k)), nh = Math.max(1, Math.floor(bh * k));
        x0 += Math.floor((bw - nw) / 2); y0 += Math.floor((bh - nh) / 2);
        bw = nw; bh = nh;
      }
      x1 = x0 + bw; y1 = y0 + bh;
      part = `I(${y0 + 1}:${y1}, ${x0 + 1}:${x1})`;
    }
    const channel = (c) => {
      const rows = [];
      for (let y = y0; y < y1; y++) {
        const row = new Array(x1 - x0);
        for (let x = x0; x < x1; x++) row[x - x0] = rgb[(y * w + x) * 3 + c];
        rows.push(row.join(' '));
      }
      return '[' + rows.join(';\n ') + ']';
    };
    const text = this.isGrayscale
      ? `I = uint8(${channel(0)});`
      : `I = uint8(cat(3, ...\n${channel(0)}, ...\n${channel(1)}, ...\n${channel(2)}));`;
    const ok = await this.copyText(text);
    this.showToast(ok ? this.t.matrixCopied(y1 - y0, x1 - x0, part) : this.t.copyFailed);
  }

  downloadPng() {
    this.offscreen.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.fileBase()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  close() {
    if (this.ro) this.ro.disconnect();
    openWindows.delete(this.win);
    clearTimeout(this._toastTimer);
    if (this.snapPreview) this.snapPreview.remove();
    this.closeMenus();
    for (const pop of Object.values(this.pops)) pop.remove(); // popovers live on <body> while open
    this.win.remove();
    layoutMinimizedWindows();
  }
}

/**
 * Public singleton manager
 */
export const ImageToolManager = {
  /**
   * Opens an image tool window
   * @param {ImtoolImage} image
   * @param {Object} [options]
   */
  open(image, options = {}) {
    if (!image || !image.rgb || !image.w || !image.h) return null;
    return new ImageToolWindow(image, options);
  },

  /**
   * Closes all active image tool windows
   */
  closeAll() {
    for (const [, winInstance] of openWindows) {
      winInstance.close();
    }
    openWindows.clear();
  }
};

// Expose globally for runtime.js
if (typeof window !== 'undefined') {
  window.MLWebImageTool = ImageToolManager;
}

export default ImageToolManager;
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
// - Snap to screen edges, remembered size/position, double-click title to maximize
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
 */

const I18N = {
  en: {
    title: 'Image Tool',
    figure: 'Figure',
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
    hint: 'Scroll to zoom · Drag to pan',
    pixelPrompt: 'Pixel info: Move over image',
    pixelFmt: (x, y, val) => `Pixel: (X: ${x}, Y: ${y})  ${val}`,
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
    figure: 'شكل',
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
    hint: 'مرر للتكبير · اسحب للتحريك',
    pixelPrompt: 'معلومات البكسل: حرّك المؤشر فوق الصورة',
    pixelFmt: (x, y, val) => `البكسل: (س: ${x}، ص: ${y})  ${val}`,
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
      ['Ctrl+C', 'نسخ الصورة'],
      ['?', 'هذه المساعدة'],
      ['Esc', 'إغلاق القائمة / استعادة / إغلاق'],
      ['نقر مزدوج على العنوان', 'تكبير / استعادة'],
      ['نقر مزدوج باللمس', 'تبديل الملاءمة / 100%'],
      ['قرص · إصبعان', 'تكبير · تحريك'],
    ],
  }
};

const GEO_KEY = 'mlweb-imtool-geom';
const PREF_KEY = 'mlweb-imtool-prefs';
const SNAP = 14;
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
    this._tap = null;
    this._lastTap = null;
    this._lastMinToggle = 0;
    this._toastTimer = 0;
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

    // Fit image initially
    requestAnimationFrame(() => {
      this.fitToWindow();
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
    const { w, h, fig } = this.image;
    const t = this.t;

    const win = document.createElement('div');
    win.className = 'mlweb-imtool-win is-focused';
    win.tabIndex = -1;
    win.style.zIndex = String(++topZIndex);

    const figNum = Math.abs(fig || 1);
    const titleText = `${t.title} — ${t.figure} ${figNum}`;

    win.innerHTML = `
      <div class="mlweb-imtool-titlebar">
        <div class="mlweb-imtool-win-controls">
          <button type="button" class="mlweb-imtool-win-btn btn-close" title="${t.close}" aria-label="${t.close}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button>
          <button type="button" class="mlweb-imtool-win-btn btn-min" title="${t.minimize}" aria-label="${t.minimize}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7"/></svg></button>
          <button type="button" class="mlweb-imtool-win-btn btn-max" title="${t.maximize}" aria-label="${t.maximize}"><svg class="ic-max" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 9.5v-7h7v7z"/></svg><svg class="ic-restore" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 4V2.5h5.5V8H8M2.5 4H8v5.5H2.5z"/></svg></button>
        </div>
        <div class="mlweb-imtool-title-wrap">
          <span class="mlweb-imtool-title">${titleText}</span>
          <svg class="mlweb-imtool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
            <circle cx="9" cy="9" r="2"/>
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
          </svg>
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
          <button type="button" class="mlweb-imtool-tb-btn btn-view" title="${t.viewTitle}" aria-label="${t.view}" aria-haspopup="menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></svg>
            <span class="mlweb-imtool-tb-label">${t.view}</span>
          </button>
          <button type="button" class="mlweb-imtool-tb-btn btn-export" title="${t.exportTitle}" aria-label="${t.exportLabel}" aria-haspopup="menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            <span class="mlweb-imtool-tb-label">${t.exportLabel}</span>
          </button>
          <button type="button" class="mlweb-imtool-tb-btn btn-help" title="${t.help}" aria-label="${t.help}" aria-haspopup="dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01"/></svg>
          </button>
        </div>
        <span class="mlweb-imtool-tb-hint">${t.hint}</span>
      </div>
      <div class="mlweb-imtool-body">
        <div class="mlweb-imtool-stage" tabindex="0">
          <canvas class="mlweb-imtool-canvas"></canvas>
          <canvas class="mlweb-imtool-overlay"></canvas>
          <div class="mlweb-imtool-pop pop-view" hidden role="menu">
            <button type="button" class="mlweb-imtool-pop-item" role="menuitemcheckbox" data-toggle="grid"><span class="chk"></span><span class="lbl">${t.grid}</span><kbd>G</kbd></button>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitemcheckbox" data-toggle="rulers"><span class="chk"></span><span class="lbl">${t.rulers}</span><kbd>R</kbd></button>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitemcheckbox" data-toggle="crosshair"><span class="chk"></span><span class="lbl">${t.crosshair}</span><kbd>C</kbd></button>
          </div>
          <div class="mlweb-imtool-pop pop-export" hidden role="menu">
            <button type="button" class="mlweb-imtool-pop-item" role="menuitem" data-act="copy-image"><span class="lbl">${t.copyImage}</span><kbd>Ctrl+C</kbd></button>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitem" data-act="png"><span class="lbl">${t.savePng}</span></button>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitem" data-act="jpg"><span class="lbl">${t.saveJpg}</span></button>
            <button type="button" class="mlweb-imtool-pop-item" role="menuitem" data-act="matrix"><span class="lbl">${t.copyMatrix}</span></button>
          </div>
          <div class="mlweb-imtool-pop pop-help" hidden role="dialog" aria-label="${t.shortcuts}">
            <div class="mlweb-imtool-pop-title">${t.shortcuts}</div>
            <div class="mlweb-imtool-keys">${t.keys.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('')}</div>
          </div>
          <div class="mlweb-imtool-toast" role="status" aria-live="polite"></div>
          <div class="mlweb-imtool-info-card" hidden>
            <div class="mlweb-imtool-info-head">
              <h4>${t.title} · ${t.figure} ${figNum}</h4>
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
      view: win.querySelector('.pop-view'),
      export: win.querySelector('.pop-export'),
      help: win.querySelector('.pop-help'),
    };
    this.menuBtns = {
      view: win.querySelector('.btn-view'),
      export: win.querySelector('.btn-export'),
      help: win.querySelector('.btn-help'),
    };

    this.hookEvents();
    this.container.appendChild(win);
    openWindows.set(win, this);
    win.focus({ preventScroll: true });
  }

  applyInitialCascade() {
    const idx = cascadeCounter++;
    const saved = readStore(GEO_KEY)[String(Math.abs(this.image.fig || 1))];
    if (saved && saved.w > 0 && saved.h > 0) {
      const w = Math.max(300, Math.min(saved.w, window.innerWidth - 8));
      const h = Math.max(240, Math.min(saved.h, window.innerHeight - 8));
      const l = Math.max(-w + 100, Math.min(window.innerWidth - 100, saved.l));
      const t = Math.max(0, Math.min(window.innerHeight - 40, saved.t));
      Object.assign(this.win.style, { width: `${w}px`, height: `${h}px`, left: `${l}px`, top: `${t}px` });
      return;
    }
    const defaultW = Math.min(680, window.innerWidth - 40);
    const defaultH = Math.min(520, window.innerHeight - 80);

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
  }

  saveGeometry() {
    if (this.isMaximized || this.isMinimized) return;
    const all = readStore(GEO_KEY);
    all[String(Math.abs(this.image.fig || 1))] = {
      l: this.win.offsetLeft, t: this.win.offsetTop, w: this.win.offsetWidth, h: this.win.offsetHeight,
    };
    writeStore(GEO_KEY, all);
  }

  snapRect(l, t, w, h) {
    const iw = window.innerWidth, ih = window.innerHeight;
    if (Math.abs(l) < SNAP) l = 0; else if (Math.abs(l + w - iw) < SNAP) l = iw - w;
    if (Math.abs(t) < SNAP) t = 0; else if (Math.abs(t + h - ih) < SNAP) t = ih - h;
    return { left: l, top: t };
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
      const startWinLeft = this.win.offsetLeft;
      const startWinTop = this.win.offsetTop;
      this.titlebar.setPointerCapture(e.pointerId);

      const onMove = (moveEv) => {
        if (this.isMaximized) return;
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
      };

      const onUp = (upEv) => {
        this.titlebar.releasePointerCapture(upEv.pointerId);
        this.titlebar.removeEventListener('pointermove', onMove);
        this.titlebar.removeEventListener('pointerup', onUp);
        this.titlebar.removeEventListener('pointercancel', onUp);
        this.saveGeometry();
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

    // Popover menus (View / Export / Help)
    for (const name of Object.keys(this.menuBtns)) {
      this.menuBtns[name].addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu(name); });
    }
    for (const pop of Object.values(this.pops)) {
      pop.addEventListener('wheel', (e) => e.stopPropagation());
      pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    this.pops.view.addEventListener('click', (e) => {
      const item = e.target.closest('[data-toggle]');
      if (item) this.toggleSetting(item.dataset.toggle);
    });
    this.pops.export.addEventListener('click', (e) => {
      const item = e.target.closest('[data-act]');
      if (!item) return;
      this.closeMenus();
      const act = item.dataset.act;
      if (act === 'copy-image') this.copyImage();
      else if (act === 'png') this.saveImage('png');
      else if (act === 'jpg') this.saveImage('jpg');
      else if (act === 'matrix') this.copyMatrix();
    });
    this.syncViewMenu();
    // click anywhere else in the window (toolbar gaps, titlebar) closes menus
    win.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.mlweb-imtool-pop, .btn-view, .btn-export, .btn-help')) this.closeMenus();
    });

    // Resize handles (disabled when maximized)
    win.querySelectorAll('.mlweb-imtool-resizer').forEach(handle => {
      handle.addEventListener('pointerdown', (e) => {
        if (this.isMaximized) return;
        e.preventDefault();
        e.stopPropagation();
        this.bringToFront();
        const dir = handle.dataset.dir;
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

          const iw = window.innerWidth, ih = window.innerHeight;
          if (dir.includes('e') && Math.abs(newL + newW - iw) < SNAP && iw - newL >= minW) newW = iw - newL;
          if (dir.includes('s') && Math.abs(newT + newH - ih) < SNAP && ih - newT >= minH) newH = ih - newT;
          if (dir.includes('w') && Math.abs(newL) < SNAP && newW + newL >= minW) { newW += newL; newL = 0; }
          if (dir.includes('n') && Math.abs(newT) < SNAP && newH + newT >= minH) { newH += newT; newT = 0; }

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
          this.saveGeometry();
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
      try { this.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.isPanning = true;
      this.stage.classList.add('is-panning');
      if (this.pointers.size === 2) { pinch = pair(); this._tap = null; this._lastTap = null; }
    });

    this.stage.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) { this.trackCursorPixel(e); return; }
      const cur = stagePt(e);
      if (this._tap && Math.hypot(e.clientX - this._tap.x, e.clientY - this._tap.y) > 10) this._tap.moved = true;
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

    this.stage.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.drawOverlay();
      if (!this.isPanning) {
        this.pixelStatus.textContent = this.t.pixelPrompt;
      }
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
    for (const [name, pop] of Object.entries(this.pops)) {
      pop.hidden = true;
      this.menuBtns[name].classList.remove('is-active');
    }
  }

  toggleMenu(name) {
    const wasOpen = !this.pops[name].hidden;
    this.closeMenus();
    if (wasOpen || this.isMinimized) return;
    const pop = this.pops[name];
    pop.hidden = false;
    this.menuBtns[name].classList.add('is-active');
    const sr = this.stage.getBoundingClientRect();
    const br = this.menuBtns[name].getBoundingClientRect();
    const left = Math.max(8, Math.min(br.left - sr.left, sr.width - pop.offsetWidth - 8));
    pop.style.left = `${left}px`;
    pop.style.top = '8px';
  }

  syncViewMenu() {
    const map = { grid: this.showGrid, rulers: this.showRulers, crosshair: this.showCrosshair };
    this.pops.view.querySelectorAll('[data-toggle]').forEach((el) => {
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

  trackCursorPixel(e) {
    const rect = this.stage.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const px = Math.floor((mx - this.panX) / this.zoom);
    const py = Math.floor((my - this.panY) / this.zoom);
    const { w, h, rgb } = this.image;
    if (e.pointerType !== 'touch') { this.cursor = { x: mx, y: my }; this.drawOverlay(); }

    if (px >= 0 && px < w && py >= 0 && py < h) {
      const idx = (py * w + px) * 3;
      const r = rgb[idx], g = rgb[idx + 1], b = rgb[idx + 2];
      const valStr = this.isGrayscale ? `Val: ${r}` : `RGB: [${r}, ${g}, ${b}]`;
      // 1-based indexing for MATLAB
      this.pixelStatus.textContent = this.t.pixelFmt(px + 1, py + 1, valStr);
    } else {
      this.pixelStatus.textContent = this.t.pixelPrompt;
    }
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

  saveImage(kind) {
    const { fig } = this.image;
    const isJpg = kind === 'jpg';
    this.offscreen.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `imtool-figure${Math.abs(fig || 1)}.${isJpg ? 'jpg' : 'png'}`;
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
    const { w, h, fig } = this.image;
    this.offscreen.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `imtool-figure${Math.abs(fig || 1)}.png`;
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
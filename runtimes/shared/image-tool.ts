// =============================================================================
// runtimes/shared/image-tool.ts
// The imtool viewer. When the host page provides window.MLWebImageTool (the floating,
// resizable / minimizable / maximizable window in public/src/features/notebook/image-tool-window.js)
// the figure opens there. Otherwise a modal dialog with zoom/fit/download is used.
// Only created when engine.caps.images is true.
// =============================================================================
import type { Ctx } from './ctx';
import type { Out } from './engine';
import { h, openDialog, closeDialog, download } from './dom';
import { rgbToCanvas, toBlob } from './images';

type ImgOut = Extract<Out, { k: 'img' }>;
declare global { interface Window { MLWebImageTool?: { open?(img: ImgOut, o: { lang: string; container: HTMLElement }): void; closeAll?(): void } } }

export function createImageTool(ctx: Ctx) {
  const { t } = ctx;
  const btn = (id: string, title: string, label: string) => h('button', { type: 'button', id, title, 'aria-label': title }, label);
  const d = h('dialog', { id: 'imageTool', 'aria-labelledby': 'imageToolTitle' },
    h('div', { class: 'dialog-head image-tool-head' },
      h('div', {}, h('h2', { id: 'imageToolTitle' }, t('Image Tool')), h('span', { id: 'imageToolMeta' })),
      h('button', { type: 'button', id: 'closeImageTool', 'aria-label': t('Close Image Tool') }, '×')),
    h('div', { class: 'image-tool-controls' },
      btn('imageZoomOut', t('Zoom out'), '−'), btn('imageZoomIn', t('Zoom in'), '+'),
      h('button', { type: 'button', id: 'imageFit' }, t('Fit')), h('button', { type: 'button', id: 'imageActual' }, '100%'),
      h('button', { type: 'button', id: 'imageDownload' }, t('Download PNG')),
      h('span', { class: 'image-tool-hint' }, t('Move over the image to inspect pixel values'))),
    h('div', { id: 'imageToolStage', tabindex: 0, 'aria-label': t('Interactive image view') }),
    h('div', { id: 'imagePixelInfo', role: 'status', 'aria-live': 'polite' }, ''));
  const stage = d.querySelector<HTMLElement>('#imageToolStage')!, info = d.querySelector<HTMLElement>('#imagePixelInfo')!, meta = d.querySelector<HTMLElement>('#imageToolMeta')!;
  let image: ImgOut | null = null, canvas: HTMLCanvasElement | null = null, zoom = 1;

  const setZoom = (z: number) => {
    if (!image || !canvas) return;
    zoom = Math.max(0.05, Math.min(16, z));
    canvas.style.width = `${image.w * zoom}px`;
    canvas.style.height = `${image.h * zoom}px`;
    canvas.style.imageRendering = zoom > 1 ? 'pixelated' : 'auto';
    meta.textContent = `${image.w} × ${image.h} px · ${Math.round(zoom * 100)}%`;
  };
  const fit = () => {
    if (!image) return;
    const pad = 32;
    setZoom(Math.max(0.05, Math.min(1, (stage.clientWidth - pad) / image.w, (stage.clientHeight - pad) / image.h)));
    stage.scrollTo?.(0, 0);
  };
  const open = (img: ImgOut) => {
    if (window.MLWebImageTool?.open) { window.MLWebImageTool.open(img, { lang: ctx.lang, container: document.body }); return; }
    image = img; canvas = rgbToCanvas(img.w, img.h, img.rgb);
    const cv = canvas;
    cv.setAttribute('aria-label', t('Image {w} by {h} pixels. Move pointer to inspect pixels.', { w: img.w, h: img.h }));
    cv.onmousemove = (e) => {
      const r = cv.getBoundingClientRect();
      const x = Math.min(img.w - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * img.w)));
      const y = Math.min(img.h - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * img.h)));
      const p = (y * img.w + x) * 3;
      info.textContent = `${t('Pixel info')} · X: ${x + 1}, Y: ${y + 1} · RGB: [${img.rgb[p]}, ${img.rgb[p + 1]}, ${img.rgb[p + 2]}]`;
    };
    stage.replaceChildren(cv);
    info.textContent = t('Pixel info: move over the image');
    openDialog(d);
    requestAnimationFrame(fit);
  };

  const cleanups: Array<() => void> = [];
  const on = (el: EventTarget | null, ev: string, fn: (e: any) => void, o?: AddEventListenerOptions) => { el?.addEventListener(ev, fn, o); if (el) cleanups.push(() => el.removeEventListener(ev, fn, o)); };
  on(d.querySelector('#closeImageTool'), 'click', () => closeDialog(d));
  on(d.querySelector('#imageZoomIn'), 'click', () => setZoom(zoom * 1.25));
  on(d.querySelector('#imageZoomOut'), 'click', () => setZoom(zoom / 1.25));
  on(d.querySelector('#imageFit'), 'click', fit);
  on(d.querySelector('#imageActual'), 'click', () => setZoom(1));
  on(d.querySelector('#imageDownload'), 'click', async () => { if (canvas) download('imtool.png', await toBlob(canvas, 'image/png')); });
  on(stage, 'wheel', (e) => { if (!image) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
  on(d, 'click', (e) => { if (e.target === d) closeDialog(d); });

  return {
    element: d, open,
    dispose() {
      cleanups.splice(0).forEach((f) => f());
      try { window.MLWebImageTool?.closeAll?.(); } catch { /* host window already gone */ }
    },
  };
}

// =============================================================================
// runtimes/shared/outputs.ts
// One renderer per `Out` kind: text/err/warn, img (figure), html, diag.
// =============================================================================
import DOMPurify from 'dompurify';
import type { Out } from './engine';
import type { Ctx, UiCell } from './ctx';
import { h, download } from './dom';
import { rgbToCanvas, toBlob } from './images';

type ImgOut = Extract<Out, { k: 'img' }>;

function figure(ctx: Ctx, o: ImgOut): HTMLElement {
  const { t } = ctx;
  const cv = rgbToCanvas(o.w, o.h, o.rgb), px = h('div', { class: 'px' }, ' ');
  let zoom = 1;
  const apply = () => {
    cv.style.width = o.w * zoom + 'px';
    cv.style.height = o.h * zoom + 'px';
    cv.style.imageRendering = zoom > 1 ? 'pixelated' : 'auto';
  };
  if (o.w > 640) zoom = 640 / o.w;
  apply();
  cv.onmousemove = (ev) => {
    const r = cv.getBoundingClientRect();
    const x = Math.floor(((ev.clientX - r.left) / r.width) * o.w), y = Math.floor(((ev.clientY - r.top) / r.height) * o.h);
    if (x < 0 || y < 0 || x >= o.w || y >= o.h) return;
    const i = (y * o.w + x) * 3, d = o.rgb;
    px.textContent = `${t('Pixel info')}: (${t('row')} ${y + 1}, ${t('col')} ${x + 1})  [${d[i]} ${d[i + 1]} ${d[i + 2]}]`;
  };
  cv.onmouseleave = () => { px.textContent = ' '; };
  const cap = h('div', { class: 'cap' }, o.tool ? `${t('Image Tool')} · ${o.w}×${o.h}` : `${t('Figure')} ${o.fig} · ${o.w}×${o.h}`);
  if (o.tool) cap.append(h('button', { title: t('Reopen interactive Image Tool'), onclick: () => ctx.openImage(o) }, t('Open viewer')));
  const zb = (label: string, f: () => void) => h('button', { title: t('Zoom image'), onclick: () => { f(); apply(); } }, label);
  if (!o.tool) cap.append(zb('+', () => { zoom *= 1.5; }), zb('−', () => { zoom /= 1.5; }), zb('100%', () => { zoom = 1; }));
  cap.append(h('button', { onclick: async () => download(`figure${Math.abs(o.fig)}.png`, await toBlob(cv, 'image/png')) }, 'PNG'));
  return h('div', { class: 'fig' }, cap, h('div', { class: 'scroll' }, cv), px);
}

/** Compiler/interpreter diagnostics: a jump button (line:col) and the message. */
function diagnostic(ctx: Ctx, cell: UiCell, o: Extract<Out, { k: 'diag' }>): HTMLElement {
  const where = o.col ? `${o.line}:${o.col}` : String(o.line);
  return h('div', { class: 'o o-diag ' + (o.sev === 'warning' ? 'warn' : 'err') },
    h('button', { type: 'button', class: 'diag-jump', onclick: () => ctx.jumpToLine(cell, o.line, o.col) }, ctx.t('Line {n}', { n: where })),
    h('span', { class: 'diag-msg', dir: 'auto' }, o.msg));
}

export function renderOut(ctx: Ctx, cell: UiCell, o: Out): HTMLElement {
  switch (o.k) {
    case 'img': return figure(ctx, o);
    case 'html': {
      const box = h('div', { class: 'o o-html' });
      box.innerHTML = DOMPurify.sanitize(o.html);
      return box;
    }
    case 'diag': return diagnostic(ctx, cell, o);
    default: return h('pre', { class: 'o' + (o.k === 'text' ? '' : ' ' + o.k) }, o.s.replace(/\n+$/, '\n'));
  }
}

export const hasError = (c: UiCell) => c.outs.some((o) => o.k === 'err' || (o.k === 'diag' && o.sev === 'error'));

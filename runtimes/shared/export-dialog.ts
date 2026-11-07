// =============================================================================
// runtimes/shared/export-dialog.ts
// Export dialog and the four export formats: .ipynb, script (.m/.cpp), .html, notebook zip.
// The zip itself is built by the host page (window.__mlwebExport.zip).
// =============================================================================
import type { Ctx, UiCell } from './ctx';
import { h, openDialog, closeDialog, download, esc } from './dom';
import { renderMarkdown } from './markdown';
import { rgbToDataUrl } from './images';

declare global { interface Window { __mlwebExport?: { zip?: () => void | Promise<void> }; __mlwebImport?: (f: File) => void | Promise<void>; __mlwebFileHook?: { add?(f: File): void; del?(name: string): void } } }

const lines = (s: string) => s.split('\n').map((l, i, a) => (i < a.length - 1 ? l + '\n' : l));
const fileBase = (ctx: Ctx) =>
  (ctx.opts.notebook.title || 'notebook').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'notebook';
const hasOutputs = (ctx: Ctx) => ctx.state.cells.some((c) => c.type === 'code' && c.outs.length > 0);
const outText = (c: UiCell) => c.outs.map((o) => (o.k === 'text' || o.k === 'err' || o.k === 'warn' ? o.s : o.k === 'diag' ? `${o.sev}: line ${o.line}: ${o.msg}\n` : '')).join('');

function exportIpynb(ctx: Ctx, withOutputs: boolean) {
  const { engine } = ctx;
  const nb = {
    nbformat: 4, nbformat_minor: 5,
    metadata: {
      kernelspec: { name: engine.kernel, display_name: engine.kernelDisplay ?? engine.label, language: engine.language ?? engine.id },
      language_info: { name: engine.language ?? engine.id, file_extension: engine.exportExt, ...(engine.mimetype ? { mimetype: engine.mimetype } : {}) },
    },
    cells: ctx.state.cells.map((c) => {
      const source = lines(c.src);
      if (c.type === 'md') return { cell_type: 'markdown', metadata: {}, source };
      const outputs: any[] = [];
      let stdout = '';
      if (withOutputs) {
        for (const o of c.outs) {
          if (o.k === 'img') outputs.push({ output_type: 'display_data', metadata: {}, data: { 'image/png': rgbToDataUrl(o.w, o.h, o.rgb).split(',')[1], 'text/plain': ['<image>'] } });
          else if (o.k === 'text') stdout += o.s;
          else if (o.k === 'err' || o.k === 'warn') outputs.push({ output_type: 'stream', name: 'stderr', text: [o.s] });
          else if (o.k === 'diag') outputs.push({ output_type: 'stream', name: 'stderr', text: [`${o.sev}: line ${o.line}: ${o.msg}\n`] });
        }
      }
      if (stdout) outputs.unshift({ output_type: 'stream', name: 'stdout', text: lines(stdout) });
      const meta = ctx.engine.caps.stdin && c.stdin !== undefined ? { stdin: c.stdin } : {};
      return { cell_type: 'code', metadata: meta, execution_count: withOutputs ? c.count : null, source, outputs };
    }),
  };
  download(fileBase(ctx) + '.ipynb', new Blob([JSON.stringify(nb, null, 1)], { type: 'application/json' }));
}

function exportScript(ctx: Ctx, withOutputs: boolean) {
  const { engine } = ctx;
  const cm = engine.exportExt === '.m' ? '%' : '//';
  const outputBlock = (c: UiCell) => {
    const text = outText(c).replace(/\s+$/, '');
    const figs = c.outs.filter((o) => o.k === 'img').length;
    const rows = text ? text.split('\n').map((l) => `${cm}   ${l}`) : [];
    if (figs) rows.push(`${cm}   [${figs} figure${figs === 1 ? '' : 's'} not included]`);
    return rows.length ? `\n${cm} Output:\n` + rows.join('\n') : '';
  };
  const sep = engine.exportExt === '.m' ? '%%' : '//%%';
  const body = ctx.state.cells.map((c) => (c.type === 'md' ? c.src.split('\n').map((l) => `${cm} ${l}`).join('\n') : c.src + (withOutputs ? outputBlock(c) : ''))).join(`\n\n${sep}\n`);
  const header = `${cm} Exported from ${engine.exportExt === '.m' ? 'MLWeb' : 'Basmagi'} - Belal Amr Mohamed\n\n`;
  download(fileBase(ctx) + engine.exportExt, new Blob([(header + body).replace(/\n/g, '\r\n')], { type: 'text/plain' }));
}

function exportHtml(ctx: Ctx, withOutputs: boolean) {
  let n = 0;
  const sections = ctx.state.cells.map((c) => {
    if (c.type === 'md') return `<section class="md">${renderMarkdown(c.src)}</section>`;
    n += 1;
    const outs = withOutputs ? c.outs.map((o) => {
      if (o.k === 'img') return `<img alt="figure ${o.fig}" src="${rgbToDataUrl(o.w, o.h, o.rgb)}">`;
      if (o.k === 'html') return `<div class="o">${o.html}</div>`;
      if (o.k === 'diag') return `<pre class="o ${o.sev === 'warning' ? 'warn' : 'err'}">${esc(`line ${o.line}: ${o.msg}`)}</pre>`;
      if (o.k === 'stdin') return `<pre class="o">${esc(o.label + ': ' + o.value)}</pre>`;
      return `<pre class="o${o.k === 'text' ? '' : ' ' + o.k}">${esc(o.s.replace(/\n+$/, ''))}</pre>`;
    }).join('') : '';
    return `<section class="code"><span class="prompt">In [${withOutputs && c.count ? c.count : n}]:</span><div><pre class="src" dir="ltr">${esc(c.src)}</pre>${outs}</div></section>`;
  }).join('\n');
  const doc = `<!doctype html>
<html lang="${ctx.lang}" dir="${ctx.lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ctx.opts.notebook.title || 'Notebook')}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
 body{font:16px/1.65 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;color:#1d2433;max-width:900px;margin:0 auto;padding:28px 18px 60px}
 .md img{max-width:100%} .md code{background:#f0f2f7;border-radius:4px;padding:1px 5px} .md pre{background:#f0f2f7;border-radius:4px;padding:10px 12px;overflow:auto;direction:ltr}
 .code{display:grid;grid-template-columns:74px minmax(0,1fr);gap:8px;margin:10px 0;direction:ltr}
 .prompt{color:#307fc1;font:12.5px/1.8 ui-monospace,Menlo,Consolas,monospace;text-align:right;padding-top:8px}
 pre.src{margin:0;padding:10px 12px;background:#f6f7fb;border:1px solid #dce2ed;border-radius:4px;font:13.5px/1.6 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}
 pre.o{margin:6px 0 0;padding:6px 4px;font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap} pre.o.err{background:#fff1f0;color:#b42318;padding:8px 12px}
 .code img{display:block;max-width:100%;margin-top:8px;border:1px solid #dce2ed}
 @media print{body{padding:0} pre.src{break-inside:avoid}}
</style>
</head>
<body>
<h1>${esc(ctx.opts.notebook.title || '')}</h1>
${sections}
</body>
</html>
`;
  download(fileBase(ctx) + '.html', new Blob([doc], { type: 'text/html;charset=utf-8' }));
}

export function createExportDialog(ctx: Ctx) {
  const { t, engine } = ctx;
  const opt = (value: string, label: string, checked = false) =>
    h('label', { class: 'export-opt' }, h('input', { type: 'radio', name: 'exportFormat', value, checked }), h('span', {}, label));
  const scriptLabel = engine.exportExt === '.m' ? t('MATLAB script (.m)') : t('{name} source ({ext})', { name: engine.label, ext: engine.exportExt });
  const d = h('dialog', { id: 'exportDialog', 'aria-labelledby': 'exportTitle' },
    h('div', { class: 'dialog-head' }, h('h2', { id: 'exportTitle' }, t('Export notebook')),
      h('button', { type: 'button', 'data-export-cancel': true, 'aria-label': t('Close dialog') }, '×')),
    h('div', { class: 'dialog-body' },
      h('fieldset', { class: 'export-formats' }, h('legend', {}, t('Format')),
        opt('ipynb', t('Jupyter Notebook (.ipynb)'), true), opt('script', scriptLabel), opt('html', t('Web page (.html)')), opt('zip', t('Notebook + files (.zip)'))),
      h('label', { class: 'export-opt export-outputs' }, h('input', { type: 'checkbox', id: 'exportOutputs' }), h('span', {}, t('Include cell outputs'))),
      h('p', { id: 'exportOutputsNote', class: 'export-note' }),
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', 'data-export-cancel': true }, t('Cancel')),
        h('button', { type: 'button', class: 'primary', 'data-export-accept': true }, t('Export')))));

  const open = () => {
    const box = d.querySelector<HTMLInputElement>('#exportOutputs')!, any = hasOutputs(ctx);
    box.checked = any; box.disabled = !any;
    d.querySelector('#exportOutputsNote')!.textContent = any
      ? t('Text results and figures currently shown under the cells.')
      : t('No outputs yet: run the cells first. Outputs are not saved with the notebook, only what is on screen can be exported.');
    openDialog(d);
  };
  const accept = () => {
    const format = d.querySelector<HTMLInputElement>('input[name="exportFormat"]:checked')?.value || 'ipynb';
    const withOutputs = d.querySelector<HTMLInputElement>('#exportOutputs')!.checked && hasOutputs(ctx);
    closeDialog(d);
    try {
      if (format === 'zip') { void window.__mlwebExport?.zip?.(); return; }
      (format === 'script' ? exportScript : format === 'html' ? exportHtml : exportIpynb)(ctx, withOutputs);
    } catch (e) {
      ctx.notify(t('Export failed: ') + (e instanceof Error ? e.message : String(e)));
    }
  };
  const cleanups: Array<() => void> = [];
  const on = (el: Element | null, ev: string, fn: (e: any) => void) => { el?.addEventListener(ev, fn); if (el) cleanups.push(() => el.removeEventListener(ev, fn)); };
  d.querySelectorAll('[data-export-cancel]').forEach((b) => on(b, 'click', () => closeDialog(d)));
  on(d.querySelector('[data-export-accept]'), 'click', accept);
  on(d, 'click', (e) => { if (e.target === e.currentTarget) closeDialog(d); });
  return { element: d, open, dispose: () => cleanups.splice(0).forEach((f) => f()) };
}

/** Import a .m/.cpp script or .ipynb into cells (used when the host provides no __mlwebImport). */
export async function importFile(ctx: Ctx, f: File): Promise<UiCell[]> {
  const text = await f.text(), { t } = ctx;
  if (/\.ipynb$/i.test(f.name)) {
    const j = JSON.parse(text);
    if (!j || !Array.isArray(j.cells)) throw new Error(t('This .ipynb file has no valid cells array.'));
    const cells = j.cells.map((c: any) => {
      if (!c || !['markdown', 'code', 'raw'].includes(c.cell_type)) throw new Error(t('This notebook contains an unsupported cell type.'));
      return ctx.mkCell(c.cell_type === 'markdown' ? 'md' : 'code', Array.isArray(c.source) ? c.source.join('') : String(c.source ?? ''));
    });
    return cells;
  }
  const marker = ctx.engine.exportExt === '.m' ? /^%%.*$/m : /^\/\/\s*%%.*$/m;
  const parts = text.replace(/\r\n?/g, '\n').split(marker).map((s) => s.replace(/^\n+|\n+$/g, '')).filter((s) => s.trim());
  return (parts.length ? parts : ['']).map((p) => ctx.mkCell('code', p));
}

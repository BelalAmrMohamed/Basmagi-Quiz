// =============================================================================
// runtimes/matlab/src/index.ts
// Entry of public/assets/notebook-runtime/runtime.js. Sets window.MLWebNotebook = { mount }.
// Host contract: mount({root, baseUrl, notebook, lang, mode, onChange, onNotice, onInfo})
//   -> {getCells, setCells, destroy}
// =============================================================================
import '../../shared/styles/index.css';
import { mountShell, type ShellHandle } from '../../shared/shell';
import type { MountOptions } from '../../shared/ctx';
import { createMatlabEngine } from './engine';

export function mount(opts: MountOptions): ShellHandle {
  const engine = createMatlabEngine({
    baseUrl: opts?.baseUrl,
    lang: opts?.lang === 'ar' ? 'ar' : 'en',
    publishedSources: (opts?.notebook?.cells || []).map((c) => String(c.source ?? '')),
  });
  try {
    return mountShell(engine, opts);
  } catch (e) {
    engine.dispose();
    throw e;
  }
}

(window as unknown as { MLWebNotebook?: { mount: typeof mount } }).MLWebNotebook = { mount };

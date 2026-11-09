// =============================================================================
// runtimes/cpp/src/index.ts
// Entry of public/assets/notebook-runtime-cpp/runtime.js. Sets window.BasmagiCppNotebook = { mount }.
// Same host contract as the MATLAB runtime; the UI is the shared one.
// =============================================================================
import '../../shared/styles/index.css';
import { mountShell, type ShellHandle } from '../../shared/shell';
import type { MountOptions } from '../../shared/ctx';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../../public/src/shared/public-config.js';
import { createCppEngine, CPP_AR, type CppExecute } from './engine';

const execute: CppExecute = async ({ cells, target, signal }) => {
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/cpp-run`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ cells, target }), signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    // fetch() rejects with a bare TypeError for offline, DNS failure and blocked CORS alike.
    throw new Error('Could not reach the compile service (network error, or this site is not in the function\'s ALLOWED_ORIGINS).');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Compile service returned HTTP ${response.status}.`);
  return data;
};

export function mount(opts: MountOptions): ShellHandle {
  const engine = createCppEngine({ execute, lang: opts?.lang === 'ar' ? 'ar' : 'en', baseUrl: opts?.baseUrl });
  try { return mountShell(engine, opts, CPP_AR); } catch (e) { engine.dispose(); throw e; }
}

(window as unknown as { BasmagiCppNotebook?: { mount: typeof mount } }).BasmagiCppNotebook = { mount };

// x

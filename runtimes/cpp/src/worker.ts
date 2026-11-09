// =============================================================================
// runtimes/cpp/src/worker.ts
// Background Web Worker for client-side C++ compilation and execution.
// Loads toolchain assets from CacheStorage and runs off the main thread.
// =============================================================================
import { Toolchain, type RunResult } from './wasm-toolchain';
import { getCachedAsset } from './wasm-cache';
import { assemble, splitSections } from './assemble';

const post = (msg: any) => (self as any).postMessage(msg);

let toolchain: Toolchain | null = null;

function getToolchain(): Toolchain {
  if (!toolchain) {
    toolchain = new Toolchain({
      getAssetBuffer: async (name: string) => {
        const buf = await getCachedAsset(name);
        if (!buf) throw new Error(`Missing cached asset: ${name}`);
        return buf;
      },
    });
  }
  return toolchain;
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (!m) return;

  if (m.t === 'run') {
    try {
      const tc = getToolchain();
      const code = assemble(m.cells, m.target);
      const rawResult: RunResult = await tc.execute(code, '', m.files || []);
      const sections = rawResult.ok
        ? splitSections(rawResult.stdout, rawResult.stderr, m.cells.length, m.target)
        : [];

      post({
        t: 'done',
        id: m.id,
        result: {
          ok: rawResult.ok,
          compile: rawResult.compile,
          sections,
          exit: rawResult.exit,
          timeMs: rawResult.timeMs,
          files: rawResult.files,
          provider: 'local',
        },
      });
    } catch (err: any) {
      post({
        t: 'done',
        id: m.id,
        result: {
          ok: false,
          compile: 'Worker execution error: ' + (err?.message || String(err)),
          sections: [],
          exit: 1,
          timeMs: 0,
          files: [],
          provider: 'local',
        },
      });
    }
  }
};

post({ t: 'ready' });

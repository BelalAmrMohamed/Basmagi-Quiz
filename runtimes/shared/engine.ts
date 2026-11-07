// =============================================================================
// runtimes/shared/engine.ts
// The contract between the shared notebook UI (shell.ts and friends) and a language
// engine (MATLAB, C++, ...). An engine runs code and reports outputs; it never creates
// DOM, CSS classes or dialogs. Everything visible comes from runtimes/shared/ui.
// =============================================================================
import type { Extension } from '@codemirror/state';
import type { CompletionSource } from '@codemirror/autocomplete';

/** What the engine sees of a notebook cell. `id` is stable for the life of the cell. */
export type Cell = { id: number; type: 'code' | 'md'; src: string; stdin?: string };

/** Pixel data of a workspace file (MATLAB `imread` source). `data` is channels-interleaved 8-bit. */
export type ImageFile = {
  width: number; height: number; channels: 1 | 3 | number; data: Uint8Array;
  colormap?: number[][]; bitDepth?: number; format?: string; fileSize: number;
  colorType?: string; filename?: string; fileModDate?: string;
};
export type VarInfo = { name: string; size: string; cls: string; bytes: number };

export type Out =
  | { k: 'text' | 'err' | 'warn'; s: string }
  | { k: 'img'; fig: number; w: number; h: number; rgb: Uint8Array; tool: boolean }
  | { k: 'html'; html: string }
  | { k: 'diag'; line: number; col?: number; sev: 'error' | 'warning'; msg: string };

/** Handed to `Engine.run`. All calls refer to the cell being run unless `cell` is given. */
export interface RunSink {
  /** Append an output. `cell` is an index into `req.cells`; omit it for a single-cell run. */
  out(o: Out, cell?: number): void;
  /** Drop every output of the running cell except errors (MATLAB `clc`). */
  clear(cell?: number): void;
  /** Toolbar status text. `'run'` while working, `'error'` for a failure message. */
  status(text: string, kind?: 'run' | 'error'): void;
  /** Replace the workspace variable table (only shown when `caps.workspace`). */
  vars?(v: VarInfo[]): void;
  /** The engine's file list changed (only shown when `caps.files`). */
  files?(): void;
  /** The platform's own prompt (`_prompt` from notifications.js, via the host's `onPrompt`). Resolves null on cancel. */
  prompt(message: string, defaultValue?: string, options?: Record<string, unknown>): Promise<string | null>;
}

export type RunRequest = {
  /** Every notebook cell, code and text, in order. */
  cells: Cell[];
  /** Index into `cells`, or 'all'. */
  target: number | 'all';
  /** Aborted by Stop. The engine must settle `run()` soon after, leaving itself usable. */
  signal: AbortSignal;
};

export interface Engine {
  id: string;
  /** Human name, also used as the Jupyter display name unless `kernelDisplay` is set. */
  label: string;
  kernelDisplay?: string;
  /** Jupyter language name; defaults to `id`. */
  language?: string;
  editor: { extensions(): Extension[]; completions?: CompletionSource | CompletionSource[] };
  /** Help dialog content. The shell adds the generic notebook shortcuts itself. */
  help?: { title?: string; intro?: string; searchPlaceholder?: string; items: Array<[title: string, en: string, ar: string]> };
  caps: { workspace: boolean; files: boolean; images: boolean; stdin: boolean; history: boolean };
  /** Script export extension: `.m` or `.cpp`. */
  exportExt: '.m' | '.cpp';
  /** Jupyter kernelspec name written to exported .ipynb files. */
  kernel: string;
  run(req: RunRequest, sink: RunSink): Promise<void>;
  /** Optional batch run. When absent the shell runs code cells one by one and stops at the first error. */
  runAll?(req: RunRequest, sink: RunSink): Promise<void>;
  /** Forget all state (variables, loaded modules). */
  reset(): void | Promise<void>;
  /** Live list of workspace files (when `caps.files`). Owned by the engine. */
  files?: Map<string, ImageFile>;
  addFile?(f: File): Promise<void>;
  removeFile?(name: string): void;
  /** Called once at mount: lets the engine read notebook state (for autocomplete). */
  attach?(host: { codeSources(): string[] }): void;
  /** Called with the cell sources so the engine can pre-load files they mention. */
  prepare?(sources: string[]): Promise<void>;
  /** Release workers and timers. The shell calls this on destroy. */
  dispose(): void;
}

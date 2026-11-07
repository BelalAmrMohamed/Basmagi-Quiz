// =============================================================================
// runtimes/shared/ctx.ts
// The object the shell passes to every UI module (toolbar, cell view, side panel, dialogs).
// Modules read state from it and call its actions; they never reach into each other.
// =============================================================================
import type { Engine, Out, VarInfo, ImageFile } from './engine';
import type { T, Lang } from './i18n';

export interface UiCell {
  id: number; type: 'code' | 'md'; src: string; stdin?: string;
  outs: Out[]; count: number | null; running: boolean; mdEdit: boolean;
}

/** What the host passes to `mount()`. */
export interface MountOptions {
  root: HTMLElement;
  baseUrl?: string;
  notebook: { id?: string; title?: string; schemaVersion?: number; runtime?: string; cells: Array<{ type?: string; source?: string; stdin?: string }> };
  lang?: string;
  mode?: string;
  onChange?: (cells: HostCell[]) => void;
  onNotice?: (message: string) => void;
  onInfo?: () => void;
  /** The platform's `_prompt(message, defaultValue, options)`; falls back to window.prompt. */
  onPrompt?: (message: string, defaultValue?: string, options?: Record<string, unknown>) => Promise<string | null> | string | null;
  onConfirm?: (title: string, message: string, accept: string) => boolean | Promise<boolean>;
}
export type HostCell = { id: string; type: 'code' | 'markdown'; source: string; stdin?: string };

export interface Ctx {
  engine: Engine; t: T; lang: Lang; root: HTMLElement; opts: MountOptions;
  state: { cells: UiCell[]; sel: number; busy: boolean; vars: VarInfo[]; hist: string[]; };
  /** Look up an element of this notebook by id. */
  q<E extends HTMLElement = HTMLElement>(id: string): E | null;
  isEdit(): boolean;
  mkCell(type: 'code' | 'md', src: string): UiCell;
  save(): void;
  render(): void;
  renderSide(): void;
  renderToolbar(): void;
  notify(message: string): void;
  confirm(title: string, message: string, accept?: string): Promise<boolean>;
  prompt(message: string, defaultValue?: string, options?: Record<string, unknown>): Promise<string | null>;
  /** Re-render and put the caret in a code/text cell's editor. */
  focusEditor(id: number): void;
  /** Re-render and focus the cell card (command mode). */
  focusCard(id: number): void;
  /** Move the caret to a line (1-based) of a code cell's editor. */
  jumpToLine(cell: UiCell, line: number, col?: number): void;
  /** Take the editor out of the cell (Escape). */
  leaveEditor(cell: UiCell): boolean;
  runCell(c: UiCell): Promise<void>;
  /** Shift+Enter / Ctrl+Enter from an editor. */
  runFromEditor(c: UiCell, advance: boolean, command?: boolean): boolean;
  runAll(): Promise<void>;
  stop(): void;
  resetWorkspace(): void;
  /** Discard local edits and show the published cells again. */
  resetToPublished(): void;
  /** Replace all cells (import). */
  replaceCells(cells: UiCell[]): void;
  openHelp(): void;
  openExport(): void;
  openImage(o: Extract<Out, { k: 'img' }>): void;
  addFile(f: File): Promise<void>;
  removeFile(name: string): void;
  files(): Map<string, ImageFile>;
  clearHistory(): void;
  /** Editor view/state bookkeeping owned by the shell. */
  editors: Map<number, import('@codemirror/view').EditorView>;
  editorStates: Map<number, import('@codemirror/state').EditorState>;
}

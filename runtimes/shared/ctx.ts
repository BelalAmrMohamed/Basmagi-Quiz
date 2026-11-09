// =============================================================================
// runtimes/shared/ctx.ts
// The object the shell passes to every UI module (toolbar, cell view, side panel, dialogs).
// Modules read state from it and call its actions; they never reach into each other.
// =============================================================================
import type { Engine, Out, VarInfo, ImageFile } from './engine';
import type { T, Lang } from './i18n';
import type { Challenge, ChallengeResult } from './challenge';

export interface UiCell {
  id: number; type: 'code' | 'md'; src: string; stdin?: string;
  outs: Out[]; count: number | null; running: boolean; mdEdit: boolean;
  /** Open input box (see Engine RunSink.input). */
  pending?: { label: string; value: string };
  /** Challenge cell: graded on its output. `chRef` = index of the published cell it came from (learner mode). */
  challenge?: Challenge; chRef?: number;
  /** Starter code to go back to (the source the cell had when published). */
  starter?: string;
  result?: ChallengeResult;
  /** Learner UI state. */
  hintShown?: boolean; solutionShown?: boolean; targetHidden?: boolean; attempts?: number;
}

/** What the host passes to `mount()`. */
export interface MountOptions {
  root: HTMLElement;
  baseUrl?: string;
  notebook: { id?: string; title?: string; schemaVersion?: number; runtime?: string; cells: Array<{ type?: string; source?: string; stdin?: string; challenge?: Challenge }> };
  lang?: string;
  mode?: string;
  onChange?: (cells: HostCell[]) => void;
  onNotice?: (message: string) => void;
  onInfo?: () => void;
  onConfirm?: (title: string, message: string, accept: string) => boolean | Promise<boolean>;
  /** Single-line text prompt (the platform's _prompt). Resolves to the text, or null when cancelled. */
  onPrompt?: (message: string, value: string) => string | null | Promise<string | null>;
}
export type HostCell = { id: string; type: 'code' | 'markdown'; source: string; stdin?: string; challenge?: Challenge };

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
  prompt(message: string, value?: string): Promise<string | null>;
  /** Submit (string) or cancel (null) the open input box of a cell. */
  answerInput(cell: UiCell, value: string | null): void;
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
  /** Put a challenge cell back to its starter code and clear its result. */
  resetChallenge(cell: UiCell): void;
  /** Replace all cells (import). */
  replaceCells(cells: UiCell[]): void;
  openHelp(): void;
  openExport(): void;
  openImage(o: Extract<Out, { k: 'img' }>): void;
  addFile(f: File): Promise<void>;
  removeFile(name: string): void;
  /** Validates `to`, renames, tells the host. Returns false (after a notice) when the rename was refused. */
  renameFile(from: string, to: string): boolean;
  files(): Map<string, ImageFile>;
  clearHistory(): void;
  /** Editor view/state bookkeeping owned by the shell. */
  editors: Map<number, import('@codemirror/view').EditorView>;
  editorStates: Map<number, import('@codemirror/state').EditorState>;
}

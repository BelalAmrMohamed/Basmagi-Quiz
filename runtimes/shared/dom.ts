// =============================================================================
// runtimes/shared/dom.ts
// Tiny DOM helpers used by every shared UI module.
// =============================================================================
type Kid = Node | string | null | undefined | false;

/** Create an element. `class`, `on*` handlers and attributes; buttons with a title get a styled tooltip. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) (e as any)[k] = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : String(v));
  }
  if (e instanceof HTMLButtonElement && props.title) {
    e.dataset.tooltip = String(props.title);
    e.removeAttribute('title');
    if (!props['aria-label']) e.setAttribute('aria-label', String(props.title));
  }
  for (const c of kids) if (c != null && c !== false) e.append(c);
  return e;
}

export function openDialog(d: HTMLDialogElement) {
  if (d.open) return;
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
}
export function closeDialog(d: HTMLDialogElement) {
  if (typeof d.close === 'function') d.close(); else { d.removeAttribute('open'); d.dispatchEvent(new Event('close')); }
}

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): boolean { try { localStorage.setItem(k, v); return true; } catch { return false; } },
};

export function download(name: string, blob: Blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
export const fmtBytes = (n: number) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');

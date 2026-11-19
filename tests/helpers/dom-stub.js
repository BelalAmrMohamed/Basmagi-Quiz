// Minimal browser globals so UI modules can be imported (and the tool card
// exercised) in plain Node, without jsdom. Import this file FIRST.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};
export const storage = store;

const noop = new Proxy(function () {}, {
  get: (_, p) => (p === Symbol.toPrimitive ? () => "" : noop),
  apply: () => noop,
  set: () => true,
});

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.title = "";
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      toggle: (c, f) => (f === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : f ? set.add(c) : set.delete(c)),
      contains: (c) => set.has(c),
    };
  }
  append(...n) { this.children.push(...n); }
  appendChild(n) { this.children.push(n); return n; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  async click() {
    const ev = { stopPropagation() {}, preventDefault() {} };
    for (const fn of this.listeners.click || []) await fn(ev);
  }
  querySelector() { return null; }
}

globalThis.document = new Proxy({ createElement: (t) => new FakeElement(t) }, { get: (t, p) => (p in t ? t[p] : noop) });
globalThis.window = noop;
Object.defineProperty(globalThis, "navigator", { value: noop, configurable: true });
globalThis.HTMLElement = FakeElement;
globalThis.HTMLTextAreaElement = class {};
globalThis.HTMLInputElement = class {};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

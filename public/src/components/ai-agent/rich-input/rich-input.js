// =============================================================================
// rich-input/rich-input.js
// Vanilla-JS port of the 21st.dev "Rich Markdown AI Input Field" (Tiptap):
// formatting toolbar (headings, bold/italic/underline/strike, inline code,
// lists, quote), fenced code blocks with language menu / copy / collapse,
// per-block RTL/LTR, model menu, send / stop.
//
// Tiptap + lowlight are loaded lazily from /assets/vendor/tiptap/tiptap.js
// (built by runtimes/build.mjs, target "tiptap-vendor"), so pages only pay for
// them when the AI window is actually opened. Everything in this folder is
// plain, editable source.
//
// INTEGRATION CONTRACT
//   const rich = createRichInput({ placeholder, getCommands, getMentions, onSubmit });
//   rich.el          -> mount this
//   rich.startSlot   -> .rmci-bar-start  (append the "+" button etc.)
//   rich.endSlot     -> .rmci-bar-end    (append mic / send etc.)
//   rich.textarea    -> a <textarea>-compatible adapter (see below)
//   rich.getMarkdown(), rich.clear(), rich.focus(), rich.setModels({...})
//
// The adapter is the `.rmci-host` element itself, extended with the textarea
// members the chat panel / @-mention / slash menus use: value, selectionStart,
// selectionEnd, setSelectionRange(), focus(), disabled. `value` is the plain
// text (blocks joined by "\n"); assigning to it performs a minimal text diff
// so formatting elsewhere in the draft survives (e.g. picking an @mention).
// Programmatic changes never fire "input" (like a real textarea); user edits
// fire one synthetic "input" event per document change. "keydown" listeners
// are registered in the capture phase so menus can intercept arrows/Enter/Esc
// before ProseMirror sees them.
// =============================================================================
import { icon } from "./icons.js";
import { toMarkdown } from "./markdown-serializer.js";
import { buildExtensions } from "./extensions.js";
import { formatReset } from "../ai-agent-usage.js";

const VENDOR_URL = globalThis.__RMCI_VENDOR_URL__ || "/assets/vendor/tiptap/tiptap.js"; // override hook: tests
const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
let vendorPromise = null;

function loadVendor() {
  if (!vendorPromise) {
    vendorPromise = import(/* @vite-ignore */ VENDOR_URL).catch((err) => {
      vendorPromise = null;
      throw err;
    });
  }
  return vendorPromise;
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textToHtml = (text) => text.split("\n").map((l) => `<p>${escapeHtml(l)}</p>`).join("");

/** All text blocks of a doc with their start position and length. */
function textBlocks(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      out.push({ start: pos + 1, len: node.content.size, node });
      return false;
    }
    return true;
  });
  return out;
}

function plainTextOf(doc) {
  return textBlocks(doc).map((b) => b.node.textBetween(0, b.node.content.size, "", "\n")).join("\n");
}

function offsetToPos(doc, off) {
  const blocks = textBlocks(doc);
  if (!blocks.length) return 1;
  let base = 0;
  for (const b of blocks) {
    if (off <= base + b.len) return b.start + Math.max(0, off - base);
    base += b.len + 1;
  }
  const last = blocks[blocks.length - 1];
  return last.start + last.len;
}

function posToOffset(doc, pos) {
  let base = 0;
  for (const b of textBlocks(doc)) {
    if (pos <= b.start + b.len) return base + Math.min(b.len, Math.max(0, pos - b.start));
    base += b.len + 1;
  }
  return base > 0 ? base - 1 : 0;
}

/** Opens a fixed-position popup menu next to `trigger`; returns a close fn. */
function openMenu(trigger, build, { align = "start", rtl = false, width } = {}) {
  const menu = document.createElement("div");
  menu.className = "rmci-menu";
  menu.setAttribute("role", "menu");
  menu.dir = rtl ? "rtl" : "ltr";
  if (width) menu.style.width = `${width}px`;
  const close = () => {
    menu.remove();
    trigger.setAttribute("aria-expanded", "false");
    trigger.classList.remove("is-open");
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("aiw:close-popups", close);
    window.removeEventListener("blur", close);
  };
  const onDown = (e) => {
    const isSub = e.target.closest && e.target.closest(".rmci-submenu");
    if (!menu.contains(e.target) && !trigger.contains(e.target) && !isSub) close();
  };
  const onScroll = (e) => {
    if (menu.contains(e.target) || e.target.closest?.(".rmci-submenu")) return;
    close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      const sub = document.querySelector(".rmci-submenu");
      if (sub) {
        sub.remove();
        document.querySelector(".rmci-menu-item--submenu.is-active")?.classList.remove("is-active");
      } else {
        close();
      }
    }
  };
  build(menu, close);
  document.body.appendChild(menu);

  const r = trigger.getBoundingClientRect();
  const mw = menu.offsetWidth;
  menu.style.position = "fixed";
  let left = align === "end" ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  menu.style.left = `${left}px`;
  const mh = menu.offsetHeight;
  const above = r.top;
  if (r.bottom + mh + 8 > window.innerHeight && above > mh + 8) menu.style.top = `${r.top - mh - 6}px`;
  else menu.style.top = `${r.bottom + 6}px`;

  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", close);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("aiw:close-popups", close);
  window.addEventListener("blur", close);
  trigger.setAttribute("aria-expanded", "true");
  trigger.classList.add("is-open");
  return close;
}

/** One provider row of the usage flyout: name + "% left" + reset line + ring. */
function usageRow(g) {
  const pct = Math.max(0, Math.min(100, Number(g.percentLeft) || 0));
  const row = document.createElement("div");
  row.className = `rmci-usage-row${pct <= 10 ? " is-low" : pct <= 30 ? " is-warn" : ""}`;
  row.setAttribute("role", "group");
  const R = 8, C = 2 * Math.PI * R;
  row.innerHTML =
    '<span class="rmci-usage-text"><span class="rmci-usage-top"><span class="rmci-usage-name"></span><span class="rmci-usage-pct"></span></span><span class="rmci-usage-sub"></span></span>' +
    `<svg class="rmci-usage-ring" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="${R}" class="rmci-usage-ring-bg"/><circle cx="11" cy="11" r="${R}" class="rmci-usage-ring-fg" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - pct / 100)).toFixed(2)}" transform="rotate(-90 11 11)"/></svg>`;
  row.querySelector(".rmci-usage-name").textContent = g.label;
  row.querySelector(".rmci-usage-pct").textContent = `المتبقي ${pct}%`;
  row.querySelector(".rmci-usage-sub").textContent = g.resetsAt ? formatReset(g.resetsAt) : "الحد الأسبوعي";
  return row;
}

function menuItem({ iconHtml = "", label, hint = "", selected = false, locked = false, leadingCheck = false, onClick }) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = `rmci-menu-item${locked ? " is-locked" : ""}`;
  item.setAttribute("role", "menuitem");

  let leading = "";
  let trailing = "";

  if (locked) {
    leading = `<span class="rmci-menu-lock">${icon("lock", 15)}</span>`;
  } else if (leadingCheck) {
    if (selected) {
      leading = `<span class="rmci-menu-check">${icon("check", 16)}</span>`;
    } else {
      leading = `<span class="rmci-menu-spacer" aria-hidden="true"></span>`;
    }
  } else if (iconHtml) {
    leading = `<span class="rmci-menu-icon">${iconHtml}</span>`;
    if (selected) {
      trailing = `<span class="rmci-menu-check">${icon("check", 16)}</span>`;
    }
  } else if (selected) {
    trailing = `<span class="rmci-menu-check">${icon("check", 16)}</span>`;
  }

  item.innerHTML =
    leading +
    `<span class="rmci-menu-text"><span class="rmci-menu-label"></span>${hint ? '<span class="rmci-menu-hint"></span>' : ""}</span>` +
    trailing;
  item.querySelector(".rmci-menu-label").textContent = label;
  if (hint) item.querySelector(".rmci-menu-hint").textContent = hint;
  item.addEventListener("mousedown", (e) => e.preventDefault());
  item.addEventListener("click", onClick);
  return item;
}

/**
 * @param {object} [options]
 * @param {string} [options.placeholder]
 * @param {"auto"|"ltr"|"rtl"} [options.direction]
 * @param {number} [options.maxHeight] px before the editor scrolls
 * @param {string} [options.hint] small line under the field ("" hides it)
 * @param {() => Array} [options.getCommands] slash commands to highlight
 * @param {() => Array} [options.getMentions] @mention tokens to highlight
 * @param {() => boolean} [options.onSubmit] Ctrl/Cmd+Enter
 * @param {(markdown: string) => void} [options.onChange]
 */
export function createRichInput(options = {}) {
  const opts = {
    placeholder: "",
    direction: "auto",
    maxHeight: 320,
    hint: "",
    ...options,
  };
  const rtlPlaceholder = opts.direction === "rtl" || (opts.direction === "auto" && RTL_CHARS.test(opts.placeholder));

  // ── DOM shell ────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.className = `rmci-root${rtlPlaceholder ? " rmci-ph-rtl" : ""}`;

  const shell = document.createElement("div");
  shell.className = "rmci-editor";

  const toolbarSlot = document.createElement("div");
  toolbarSlot.className = "rmci-toolbar-slot";
  toolbarSlot.hidden = true;

  const scroller = document.createElement("div");
  scroller.className = "rmci-scroll";
  scroller.style.maxHeight = `${opts.maxHeight}px`;

  const host = document.createElement("div");
  host.className = "rmci-host";
  scroller.appendChild(host);

  const bar = document.createElement("div");
  bar.className = "rmci-bar";
  const startSlot = document.createElement("div");
  startSlot.className = "rmci-bar-start";
  const endSlot = document.createElement("div");
  endSlot.className = "rmci-bar-end";

  const formatBtn = document.createElement("button");
  formatBtn.type = "button";
  formatBtn.className = "rmci-icon-btn";
  formatBtn.title = "إظهار التنسيق";
  formatBtn.setAttribute("aria-label", "إظهار التنسيق");
  formatBtn.setAttribute("aria-pressed", "false");
  formatBtn.innerHTML = icon("type", 16);
  formatBtn.addEventListener("mousedown", (e) => e.preventDefault());
  startSlot.appendChild(formatBtn);

  const modelSlot = document.createElement("div");
  modelSlot.className = "rmci-model-slot";
  endSlot.appendChild(modelSlot);

  bar.append(startSlot, endSlot);
  shell.append(toolbarSlot, scroller, bar);
  root.appendChild(shell);

  if (opts.hint) {
    const hint = document.createElement("p");
    hint.className = "rmci-hint";
    hint.textContent = opts.hint;
    root.appendChild(hint);
  }

  // Only the padding area focuses the editor; never steal focus from controls.
  scroller.addEventListener("mousedown", (e) => {
    if (e.target === scroller) {
      e.preventDefault();
      focus("end");
    }
  });

  // ── State ────────────────────────────────────────────────────────────────
  let editor = null;
  let silent = 0;
  let pendingValue = "";
  let disabled = false;
  let wantFocus = null;
  let destroyed = false;
  let toolbarEl = null;
  let toolbarOpen = false;

  const withSilent = (fn) => {
    silent++;
    try { return fn(); } finally { silent--; }
  };

  const getText = () => (editor ? plainTextOf(editor.state.doc) : pendingValue);
  const isEmpty = () => (editor ? editor.isEmpty : pendingValue.trim() === "");
  const getMarkdown = () => (editor ? toMarkdown(editor.getJSON()) : pendingValue.trim());

  function focus(where) {
    if (!editor) { wantFocus = where || true; return; }
    if (disabled) return;
    editor.commands.focus(where);
  }

  // ── <textarea> adapter (on the host element itself) ──────────────────────
  const nativeAdd = host.addEventListener.bind(host);
  const nativeRemove = host.removeEventListener.bind(host);
  const capOpt = (type, o) => (type === "keydown" ? (typeof o === "object" && o ? { ...o, capture: true } : true) : o);

  // Real (trusted) `input` events come from the contenteditable and don't cover
  // ProseMirror-handled edits; we emit one synthetic event per doc change instead.
  nativeAdd("input", (e) => { if (e.isTrusted) e.stopImmediatePropagation(); });
  host.addEventListener = (type, fn, o) => nativeAdd(type, fn, capOpt(type, o));
  host.removeEventListener = (type, fn, o) => nativeRemove(type, fn, capOpt(type, o));

  Object.defineProperties(host, {
    value: {
      get: getText,
      set(v) {
        v = String(v ?? "");
        if (!editor) { pendingValue = v; return; }
        const cur = getText();
        if (cur === v) return;
        withSilent(() => {
          if (v === "") {
            editor.commands.clearContent(false);
            return;
          }
          let p = 0;
          while (p < cur.length && p < v.length && cur[p] === v[p]) p++;
          let s = 0;
          while (s < cur.length - p && s < v.length - p && cur[cur.length - 1 - s] === v[v.length - 1 - s]) s++;
          const ins = v.slice(p, v.length - s);
          if (ins.includes("\n")) {
            editor.commands.setContent(textToHtml(v), { emitUpdate: false });
            return;
          }
          const doc = editor.state.doc;
          const from = offsetToPos(doc, p);
          const to = offsetToPos(doc, cur.length - s);
          const tr = editor.state.tr;
          if (ins) tr.insertText(ins, from, to);
          else tr.delete(from, to);
          editor.view.dispatch(tr);
        });
      },
    },
    selectionStart: {
      get: () => (editor ? posToOffset(editor.state.doc, editor.state.selection.from) : pendingValue.length),
    },
    selectionEnd: {
      get: () => (editor ? posToOffset(editor.state.doc, editor.state.selection.to) : pendingValue.length),
    },
    disabled: {
      get: () => disabled,
      set(v) {
        disabled = !!v;
        root.classList.toggle("is-disabled", disabled);
        editor?.setEditable(!disabled);
        formatBtn.disabled = disabled;
      },
    },
    setSelectionRange: {
      value(a, b = a) {
        if (!editor) return;
        const doc = editor.state.doc;
        editor.commands.setTextSelection({ from: offsetToPos(doc, a), to: offsetToPos(doc, b) });
      },
    },
    focus: { value: (o) => focus(o && typeof o === "string" ? o : undefined) },
  });

  /** Enter must keep its editor meaning (list item, code fence, code block…) instead of sending. */
  function enterIsStructural() {
    if (!editor) return false;
    const { $from, empty } = editor.state.selection;
    const parent = $from.parent;
    if (editor.isActive("codeBlock") || editor.isActive("bulletList") || editor.isActive("orderedList") || editor.isActive("blockquote")) return true;
    return empty && parent.type.name === "paragraph" && /^```[\w+#.-]*$/.test(parent.textContent);
  }

  // ── Formatting toolbar ───────────────────────────────────────────────────
  const TOOLBAR_BUTTONS = [
    { id: "bold", icon: "bold", label: "عريض (Ctrl+B)", active: (e) => e.isActive("bold"), run: (c) => c.toggleBold() },
    { id: "italic", icon: "italic", label: "مائل (Ctrl+I)", active: (e) => e.isActive("italic"), run: (c) => c.toggleItalic() },
    { id: "underline", icon: "underline", label: "تحته خط (Ctrl+U)", active: (e) => e.isActive("underline"), run: (c) => c.toggleUnderline() },
    { id: "strike", icon: "strike", label: "يتوسطه خط", active: (e) => e.isActive("strike"), run: (c) => c.toggleStrike() },
    { id: "code", icon: "code", label: "كود مضمّن", active: (e) => e.isActive("code"), run: (c) => c.toggleCode() },
    "|",
    { id: "bullet", icon: "list", label: "قائمة نقطية", active: (e) => e.isActive("bulletList"), run: (c) => c.toggleBulletList() },
    { id: "ordered", icon: "listOrdered", label: "قائمة مرقّمة", active: (e) => e.isActive("orderedList"), run: (c) => c.toggleOrderedList() },
    { id: "quote", icon: "quote", label: "اقتباس", active: (e) => e.isActive("blockquote"), run: (c) => c.toggleBlockquote() },
    { id: "codeBlock", icon: "codeBlock", label: "كتلة كود", active: (e) => e.isActive("codeBlock"), run: (c) => c.toggleCodeBlock() },
  ];
  const HEADINGS = [
    { level: 0, icon: "type", label: "فقرة", hint: "" },
    { level: 1, icon: "h1", label: "عنوان 1", hint: "# " },
    { level: 2, icon: "h2", label: "عنوان 2", hint: "## " },
    { level: 3, icon: "h3", label: "عنوان 3", hint: "### " },
  ];

  function buildToolbar() {
    const tb = document.createElement("div");
    tb.className = "rmci-toolbar";
    tb.setAttribute("role", "toolbar");
    tb.setAttribute("aria-label", "التنسيق");
    tb.dir = "ltr";

    const headingBtn = document.createElement("button");
    headingBtn.type = "button";
    headingBtn.className = "rmci-heading-btn";
    headingBtn.title = "نمط النص";
    headingBtn.setAttribute("aria-label", "نمط النص");
    headingBtn.setAttribute("aria-haspopup", "menu");
    headingBtn.setAttribute("aria-expanded", "false");
    headingBtn.addEventListener("mousedown", (e) => e.preventDefault());
    const currentLevel = () => [1, 2, 3].find((l) => editor.isActive("heading", { level: l })) || 0;
    headingBtn.addEventListener("click", () => {
      if (headingBtn.classList.contains("is-open")) return;
      const cur = currentLevel();
      openMenu(headingBtn, (menu, close) => {
        HEADINGS.forEach((h) => {
          menu.appendChild(menuItem({
            iconHtml: icon(h.icon, 16), label: h.label, hint: h.hint, selected: cur === h.level,
            onClick: () => {
              const chain = editor.chain().focus();
              (h.level === 0 ? chain.setParagraph() : chain.setHeading({ level: h.level })).run();
              close();
            },
          }));
        });
      }, { rtl: true, width: 190 });
    });
    tb.appendChild(headingBtn);

    const buttons = [];
    const divider = () => { const d = document.createElement("span"); d.className = "rmci-divider"; d.setAttribute("aria-hidden", "true"); return d; };
    tb.appendChild(divider());
    for (const def of TOOLBAR_BUTTONS) {
      if (def === "|") { tb.appendChild(divider()); continue; }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rmci-icon-btn";
      b.title = def.label;
      b.setAttribute("aria-label", def.label);
      b.setAttribute("aria-pressed", "false");
      b.innerHTML = icon(def.icon, 16);
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => def.run(editor.chain().focus()).run());
      tb.appendChild(b);
      buttons.push([def, b]);
    }

    tb.update = () => {
      if (!editor) return;
      const level = currentLevel();
      const h = HEADINGS.find((x) => x.level === level);
      headingBtn.innerHTML = `${icon(h.icon, 16)}${icon("chevronDown", 12)}`;
      headingBtn.classList.toggle("is-active", level > 0);
      for (const [def, b] of buttons) {
        const on = def.active(editor);
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      }
    };
    return tb;
  }

  function setToolbar(open) {
    toolbarOpen = open;
    formatBtn.classList.toggle("is-active", open);
    formatBtn.setAttribute("aria-pressed", String(open));
    const label = open ? "إخفاء التنسيق" : "إظهار التنسيق";
    formatBtn.title = label;
    formatBtn.setAttribute("aria-label", label);
    if (open && editor && !toolbarEl) {
      toolbarEl = buildToolbar();
      toolbarSlot.appendChild(toolbarEl);
    }
    toolbarSlot.hidden = !open || !editor;
    if (open) toolbarEl?.update();
  }
  formatBtn.addEventListener("click", () => setToolbar(!toolbarOpen));

  // ── Model menu ───────────────────────────────────────────────────────────
  /**
   * @param {{ items: Array<{id:string,label:string,description?:string,locked?:boolean}>, value: string,
   *           effortLevels?: Array<{id:string,label:string,hint?:string}>, selectedEffort?: string,
   *           disabled?: boolean, disabledReason?: string, onChange?: (id:string)=>void,
   *           onLockedClick?: (item:object)=>void,
   *           onEffortChange?: (effortId:string)=>void }} cfg
   */
  function setModels(cfg) {
    modelSlot.innerHTML = "";
    const items = cfg?.items || [];
    if (!items.length) return;
    const active = items.find((m) => m.id === cfg.value) || items[0];
    const wrap = document.createElement("span");
    wrap.className = "rmci-model-wrap";
    if (cfg.disabled && cfg.disabledReason) wrap.title = cfg.disabledReason;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rmci-model-btn";
    btn.disabled = !!cfg.disabled;
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", cfg.disabled && cfg.disabledReason ? cfg.disabledReason : "اختر النموذج");
    btn.innerHTML = `<span class="rmci-model-label"></span>${icon("chevronDown", 12)}`;

    let btnText = active.label;
    if (cfg.effortLevels && cfg.selectedEffort && cfg.selectedEffort !== "auto") {
      const activeEffort = cfg.effortLevels.find((e) => e.id === cfg.selectedEffort);
      if (activeEffort) {
        btnText += ` · ${activeEffort.id.toUpperCase()}`;
      }
    }
    btn.querySelector(".rmci-model-label").textContent = btnText;

    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      if (btn.classList.contains("is-open")) return;
      openMenu(btn, (menu, close) => {
        let submenuEl = null;
        let closeSubmenuTimer = null;
        let activeTrigger = null; // which menu row currently owns the flyout

        const cancelCloseSubmenu = () => {
          if (closeSubmenuTimer) {
            clearTimeout(closeSubmenuTimer);
            closeSubmenuTimer = null;
          }
        };

        const closeSubmenu = () => {
          cancelCloseSubmenu();
          if (submenuEl) {
            submenuEl.remove();
            submenuEl = null;
          }
          if (activeTrigger) {
            activeTrigger.setAttribute("aria-expanded", "false");
            activeTrigger.classList.remove("is-active");
            activeTrigger = null;
          }
        };

        // One flyout at a time, shared by every submenu row ("Thinking level",
        // "View Usage"). `fill(el, reposition)` populates it; it may call
        // reposition() again when its content changes size (async usage load).
        const openSubmenu = (trigger, fill) => {
          cancelCloseSubmenu();
          if (submenuEl && activeTrigger === trigger) return;
          if (submenuEl) closeSubmenu();
          activeTrigger = trigger;
          submenuEl = document.createElement("div");
          submenuEl.className = "rmci-menu rmci-submenu";
          submenuEl.setAttribute("role", "menu");
          submenuEl.dir = "rtl";

          submenuEl.addEventListener("mouseenter", cancelCloseSubmenu);
          submenuEl.addEventListener("mouseleave", scheduleCloseSubmenu);

          submenuEl.style.position = "fixed";
          document.body.appendChild(submenuEl);

          const place = () => {
            if (!submenuEl) return;
            const tr = trigger.getBoundingClientRect();
            const mr = menu.getBoundingClientRect();
            const sw = submenuEl.offsetWidth || 220;
            const sh = submenuEl.offsetHeight || 160;

            // In RTL layout, the flyout opens directly to the left of the main menu
            let left = mr.left - sw - 4;
            if (left < 8) left = mr.right + 4;
            left = Math.max(8, Math.min(left, window.innerWidth - sw - 8));

            // Align the bottom of the submenu with the bottom of its trigger row
            let top = tr.bottom - sh;
            if (top < 8) top = Math.max(8, mr.top);
            if (top + sh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - sh - 8);

            submenuEl.style.left = `${left}px`;
            submenuEl.style.top = `${top}px`;
          };

          fill(submenuEl, place);
          place();

          trigger.setAttribute("aria-expanded", "true");
          trigger.classList.add("is-active");
        };

        const fillEffort = (el) => {
          const curEffort = cfg.selectedEffort || "auto";
          cfg.effortLevels.forEach((eff) => {
            el.appendChild(menuItem({
              label: eff.label,
              hint: eff.hint || "",
              selected: eff.id === curEffort,
              leadingCheck: true,
              onClick: (e) => {
                e.stopPropagation();
                closeSubmenu();
                close();
                cfg.onEffortChange?.(eff.id);
              },
            }));
          });
        };

        // "View Usage" flyout: header + one row per provider pool with a ring
        // gauge, "% left" and the reset countdown.
        const fillUsage = (el, place) => {
          const head = document.createElement("div");
          head.className = "rmci-usage-head";
          head.textContent = "الاستخدام";
          el.appendChild(head);
          const body = document.createElement("div");
          body.className = "rmci-usage-body";
          body.innerHTML = '<div class="rmci-usage-note">جارٍ التحميل…</div>';
          el.appendChild(body);

          Promise.resolve(cfg.usage.load()).then((data) => {
            if (!submenuEl || !el.isConnected) return;
            body.replaceChildren();
            const groups = data?.groups || [];
            if (!groups.length) {
              body.innerHTML = '<div class="rmci-usage-note">لا توجد بيانات استخدام متاحة.</div>';
            }
            groups.forEach((g) => body.appendChild(usageRow(g)));
            place();
          }).catch(() => {
            if (!el.isConnected) return;
            body.innerHTML = '<div class="rmci-usage-note">تعذّر تحميل الاستخدام الآن.</div>';
            place();
          });
        };

        const scheduleCloseSubmenu = () => {
          cancelCloseSubmenu();
          closeSubmenuTimer = setTimeout(() => {
            closeSubmenu();
          }, 240);
        };

        items.forEach((m) => {
          menu.appendChild(menuItem({
            label: m.label,
            hint: m.description || "",
            selected: m.id === active.id,
            locked: !!m.locked,
            leadingCheck: true,
            onClick: () => {
              if (m.locked) {
                closeSubmenu();
                close();
                cfg.onLockedClick?.(m);
              } else {
                closeSubmenu();
                close();
                cfg.onChange?.(m.id);
              }
            },
          }));
        });

        let subTrigger = null;
        if (cfg.effortLevels && cfg.effortLevels.length) {
          const div = document.createElement("div");
          div.className = "rmci-menu-divider";
          menu.appendChild(div);

          subTrigger = document.createElement("button");
          subTrigger.type = "button";
          subTrigger.className = "rmci-menu-item rmci-menu-item--submenu";
          subTrigger.setAttribute("aria-haspopup", "menu");
          subTrigger.setAttribute("aria-expanded", "false");
          subTrigger.innerHTML = `
            <span class="rmci-menu-label">مستوى التفكير (Thinking level)</span>
            <span class="rmci-menu-arrow">${icon("chevronLeft", 14)}</span>
          `;

          subTrigger.addEventListener("mouseenter", () => openSubmenu(subTrigger, fillEffort));
          subTrigger.addEventListener("mouseleave", scheduleCloseSubmenu);
          subTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            cancelCloseSubmenu();
            if (submenuEl && activeTrigger === subTrigger) closeSubmenu();
            else openSubmenu(subTrigger, fillEffort);
          });

          menu.appendChild(subTrigger);
        }

        if (cfg.usage && typeof cfg.usage.load === "function") {
          if (!(cfg.effortLevels && cfg.effortLevels.length)) {
            const div = document.createElement("div");
            div.className = "rmci-menu-divider";
            menu.appendChild(div);
          }
          const usageTrigger = document.createElement("button");
          usageTrigger.type = "button";
          usageTrigger.className = "rmci-menu-item rmci-menu-item--submenu rmci-menu-item--usage";
          usageTrigger.setAttribute("role", "menuitem");
          usageTrigger.setAttribute("aria-haspopup", "menu");
          usageTrigger.setAttribute("aria-expanded", "false");
          usageTrigger.innerHTML = `
            <span class="rmci-menu-usage-lead">${icon("gauge", 16)}<span class="rmci-menu-label">عرض الاستخدام</span></span>
            <span class="rmci-menu-arrow">${icon("chevronLeft", 14)}</span>
          `;
          usageTrigger.addEventListener("mousedown", (e) => e.preventDefault());
          usageTrigger.addEventListener("mouseenter", () => openSubmenu(usageTrigger, fillUsage));
          usageTrigger.addEventListener("mouseleave", scheduleCloseSubmenu);
          usageTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            cancelCloseSubmenu();
            if (submenuEl && activeTrigger === usageTrigger) closeSubmenu();
            else openSubmenu(usageTrigger, fillUsage);
          });
          menu.appendChild(usageTrigger);
        }

        const origRemove = menu.remove.bind(menu);
        menu.remove = () => {
          closeSubmenu();
          origRemove();
        };
      }, { rtl: true, align: "end", width: 260 });
    });
    wrap.appendChild(btn);
    modelSlot.appendChild(wrap);
  }

  // ── Editor boot (lazy) ───────────────────────────────────────────────────
  const ready = (async () => {
    const T = await loadVendor();
    if (destroyed) return null;
    const extensions = buildExtensions(T, {
      placeholder: opts.placeholder,
      direction: opts.direction,
      getCommands: opts.getCommands,
      getMentions: opts.getMentions,
      onSubmit: () => {
        if (disabled) return true;
        host.dispatchEvent(new CustomEvent("rmci-submit"));
        opts.onSubmit?.();
        return true;
      },
    });
    editor = new T.Editor({
      element: host,
      extensions,
      content: pendingValue ? textToHtml(pendingValue) : "",
      autofocus: false,
      editable: !disabled,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          dir: opts.direction,
          "aria-label": opts.placeholder,
        },
      },
      onUpdate: () => {
        if (silent) return;
        host.dispatchEvent(new Event("input", { bubbles: true }));
        opts.onChange?.(getMarkdown());
      },
      onTransaction: () => toolbarEl?.update(),
    });
    pendingValue = "";
    root.classList.add("is-ready");
    if (toolbarOpen) setToolbar(true);
    if (wantFocus && !disabled) editor.commands.focus(wantFocus === true ? undefined : wantFocus);
    wantFocus = null;
    host.dispatchEvent(new CustomEvent("rmci-ready"));
    return editor;
  })().catch((err) => {
    console.error("[rich-input] failed to load the editor:", err);
    root.classList.add("is-error");
    return null;
  });

  function clear() {
    host.value = "";
  }

  function destroy() {
    destroyed = true;
    editor?.destroy();
    editor = null;
    root.remove();
  }

  return {
    el: root,
    host,
    textarea: host,
    startSlot,
    endSlot,
    ready,
    getMarkdown,
    getText,
    isEmpty,
    clear,
    focus,
    destroy,
    setModels,
    enterIsStructural,
    setToolbar,
    get editor() { return editor; },
  };
}

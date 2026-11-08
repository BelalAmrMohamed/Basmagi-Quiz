You are given a task to integrate an existing React component in the codebase

The codebase should support:
- shadcn project structure  
- Tailwind CSS
- Typescript

If it doesn't, provide instructions on how to setup project via shadcn CLI, install Tailwind or Typescript.

Determine the default path for components and styles. 
If default path for components is not /components/ui, provide instructions on why it's important to create this folder
Copy-paste this component to /components/ui folder:
```tsx
ai-chat-input-field.tsx
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  Extension,
  markInputRule,
  type JSONContent,
} from "@tiptap/core";
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type Editor,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Typography from "@tiptap/extension-typography";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import {
  ArrowUp,
  Bold,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Code,
  Code2,
  Copy,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Mic,
  Plus,
  Quote,
  Strikethrough,
  Type,
  Underline as UnderlineIcon,
  Zap,
  Brain,
  Sparkles,
  Square,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Utilities                                                                  */
/* -------------------------------------------------------------------------- */

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

function useDismiss<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

/* -------------------------------------------------------------------------- */
/*  Markdown serializer (ProseMirror JSON -> Markdown)                         */
/* -------------------------------------------------------------------------- */

function wrap(text: string, open: string, close = open) {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return text;
  return `${m[1]}${open}${m[2]}${close}${m[3]}`;
}

function serializeInline(nodes: JSONContent[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  
";
      let t = n.text ?? "";
      const marks = (n.marks ?? []).map((m) => m.type);
      if (marks.includes("code")) t = wrap(t, "`");
      if (marks.includes("bold")) t = wrap(t, "**");
      if (marks.includes("italic")) t = wrap(t, "*");
      if (marks.includes("strike")) t = wrap(t, "~~");
      if (marks.includes("underline")) t = wrap(t, "<u>", "</u>");
      return t;
    })
    .join("");
}

function indentLines(text: string, prefix: string, firstPrefix = prefix) {
  return text
    .split("
")
    .map((l, i) => (i === 0 ? firstPrefix : l ? prefix : "") + l)
    .join("
");
}

function serializeBlock(node: JSONContent): string {
  const children = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return serializeInline(children);
    case "heading":
      return `${"#".repeat(node.attrs?.level ?? 1)} ${serializeInline(children)}`;
    case "bulletList":
      return children
        .map((li) => indentLines(serializeBlocks(li.content ?? [], "
"), "  ", "- "))
        .join("
");
    case "orderedList": {
      const start: number = node.attrs?.start ?? 1;
      return children
        .map((li, i) => {
          const marker = `${start + i}. `;
          return indentLines(
            serializeBlocks(li.content ?? [], "
"),
            " ".repeat(marker.length),
            marker,
          );
        })
        .join("
");
    }
    case "blockquote":
      return indentLines(serializeBlocks(children), "> ");
    case "codeBlock": {
      const code = children.map((c) => c.text ?? "").join("");
      const lang = node.attrs?.language && node.attrs.language !== "plaintext" ? node.attrs.language : "";
      return "```" + lang + "
" + code + "
```";
    }
    case "horizontalRule":
      return "---";
    default:
      return serializeInline(children);
  }
}

function serializeBlocks(nodes: JSONContent[], sep = "

") {
  return nodes.map(serializeBlock).join(sep);
}

export function toMarkdown(doc: JSONContent): string {
  return serializeBlocks(doc.content ?? []).trim();
}

/* -------------------------------------------------------------------------- */
/*  Code block with language select / copy / collapse                          */
/* -------------------------------------------------------------------------- */

const lowlight = createLowlight(common);

export const CODE_LANGUAGES: { label: string; value: string }[] = [
  { label: "Plain text", value: "plaintext" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "HTML", value: "xml" },
  { label: "CSS", value: "css" },
  { label: "JSON", value: "json" },
  { label: "Bash", value: "bash" },
];

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  html: "xml",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  text: "plaintext",
  txt: "plaintext",
};

const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** Custom language dropdown, portaled so no overflow container can clip it. */
function LanguageMenu({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [place, setPlace] = React.useState<{
    host: HTMLElement;
    style: React.CSSProperties;
  } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);

  const toggle = () => {
    if (open) return close();
    const el = triggerRef.current;
    if (!el) return;
    const host = (el.closest(".rmci-root") as HTMLElement | null) ?? document.body;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const style: React.CSSProperties = {
      position: "fixed",
      right: Math.max(8, window.innerWidth - r.right),
    };
    if (below < 290 && r.top > below) style.bottom = window.innerHeight - r.top + 4;
    else style.top = r.bottom + 4;
    setPlace({ host, style });
    setOpen(true);
  };

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);

  const label = CODE_LANGUAGES.find((l) => l.value === value)?.label ?? value;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Code language"
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background/80 pl-2 pr-1.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <ChevronDown className={cn("size-3 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            dir="ltr"
            style={place.style}
            className="z-50 w-40 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-2xl shadow-black/40 animate-in fade-in zoom-in-95 duration-150"
          >
            {CODE_LANGUAGES.map((l) => (
              <button
                key={l.value}
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(l.value);
                  close();
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none"
              >
                {l.label}
                {l.value === value && <Check className="size-3.5 text-muted-foreground" />}
              </button>
            ))}
          </div>,
          place.host,
        )}
    </>
  );
}

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rawLanguage: string = node.attrs.language || "plaintext";
  const language = LANGUAGE_ALIASES[rawLanguage] ?? rawLanguage;
  const collapsed: boolean = !!node.attrs.collapsed;

  React.useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const btn =
    "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground";

  return (
    <NodeViewWrapper dir="ltr" className="rmci-codeblock group/code my-2 overflow-hidden rounded-xl border border-border bg-background/60 text-left">
      <div
        contentEditable={false}
        className="flex items-center justify-between border-b border-border bg-foreground/[0.03] px-2.5 py-1"
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => updateAttributes({ collapsed: !collapsed })}
          className={btn}
          aria-label={collapsed ? "Expand code block" : "Collapse code block"}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronsUpDown className="size-3.5" />
          ) : (
            <ChevronsDownUp className="size-3.5" />
          )}
          {collapsed ? "Expand" : "Collapse"}
        </button>

        <div className="flex items-center gap-1">
          <LanguageMenu value={language} onChange={(v) => updateAttributes({ language: v })} />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={copy}
            className={btn}
            aria-label="Copy code"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-400" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <pre
        className={cn(
          "m-0 overflow-x-auto px-3.5 py-3 font-mono text-[13px] leading-relaxed transition-[max-height] duration-300 ease-out",
          collapsed ? "max-h-[3.25rem] overflow-y-hidden" : "max-h-[32rem] overflow-y-auto",
        )}
        data-collapsed={collapsed}
      >
        <NodeViewContent as={"code" as "div"} className={`hljs language-${language}`} />
      </pre>
      {collapsed && (
        <div
          contentEditable={false}
          className="pointer-events-none -mt-6 h-6 bg-gradient-to-t from-card to-transparent"
        />
      )}
    </NodeViewWrapper>
  );
}

const CodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      collapsed: { default: false, rendered: false, keepOnSplit: false },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight, defaultLanguage: "plaintext" });

/* `<u>text</u>` -> underline */
const UnderlineMd = Underline.extend({
  addInputRules() {
    return [
      markInputRule({
        find: /(?:<u>)([^<]+)(?:<\/u>)$/,
        type: this.type,
      }),
    ];
  },
});

/**
 * Per-block bidi: paragraphs and headings get dir="auto", so Arabic/Hebrew blocks
 * align right on their own while English stays left. Lists and quotes can't use
 * dir="auto" themselves (browsers skip children that carry their own dir), so
 * the stylesheet flips them via :dir() from their first block.
 * Pass direction="ltr" | "rtl" on the component to force one direction instead.
 */
const BidiBlocks = Extension.create<{ direction: "auto" | "ltr" | "rtl" }>({
  name: "bidiBlocks",
  addOptions() {
    return { direction: "auto" };
  },
  addGlobalAttributes() {
    const auto = this.options.direction === "auto";
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          dir: {
            default: auto ? "auto" : null,
            parseHTML: (el) => el.getAttribute("dir") || (auto ? "auto" : null),
            renderHTML: (attrs) => (attrs.dir ? { dir: attrs.dir } : {}),
          },
        },
      },
    ];
  },
});

/**
 * Keys:
 *   Enter            new line / new block (never sends, unless sendOnEnter is set)
 *   Shift+Enter      soft line break (a plain newline inside code blocks)
 *   Ctrl/Cmd+Enter   send
 * Typing ``` + Enter turns the line into a code block; a lone ``` + Enter on the
 * last line of a code block closes it.
 */
const ChatShortcuts = Extension.create<{ onSubmit: () => boolean; sendOnEnter: boolean }>({
  name: "chatShortcuts",
  priority: 1000,
  addOptions() {
    return { onSubmit: () => false, sendOnEnter: false };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.options.onSubmit(),
      "Shift-Enter": ({ editor }) =>
        editor.isActive("codeBlock") ? editor.commands.newlineInCode() : false,
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        const parent = $from.parent;
        const atEnd = empty && $from.parentOffset === parent.content.size;

        if (atEnd && parent.type.name === "codeBlock") {
          const m = /(^|
)```$/.exec(parent.textContent);
          if (m) {
            return editor
              .chain()
              .focus()
              .deleteRange({ from: $from.pos - m[0].length, to: $from.pos })
              .exitCode()
              .run();
          }
        }

        if (atEnd && parent.type.name === "paragraph") {
          const f = /^```([\w+#.-]*)$/.exec(parent.textContent);
          if (f) {
            return editor
              .chain()
              .focus()
              .deleteRange({ from: $from.start(), to: $from.end() })
              .setCodeBlock(f[1] ? { language: f[1] } : undefined)
              .run();
          }
        }

        if (!this.options.sendOnEnter) return false;
        if (
          editor.isActive("codeBlock") ||
          editor.isActive("bulletList") ||
          editor.isActive("orderedList") ||
          editor.isActive("blockquote")
        )
          return false;
        return this.options.onSubmit();
      },
    };
  },
});

/* -------------------------------------------------------------------------- */
/*  Small UI primitives                                                        */
/* -------------------------------------------------------------------------- */

function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
  className,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // keep editor selection when clicking toolbar buttons
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all duration-150",
        "hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        active && "bg-foreground/15 text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function MenuSurface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="menu"
      className={cn(
        "absolute z-50 min-w-48 origin-bottom-left rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-2xl shadow-black/40",
        "animate-in fade-in zoom-in-95 duration-150",
        className,
      )}
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  selected,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none"
    >
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{label}</span>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {selected && <Check className="size-4 text-muted-foreground" />}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Toolbar                                                                    */
/* -------------------------------------------------------------------------- */

function useToolbarState(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            underline: editor.isActive("underline"),
            strike: editor.isActive("strike"),
            code: editor.isActive("code"),
            h1: editor.isActive("heading", { level: 1 }),
            h2: editor.isActive("heading", { level: 2 }),
            h3: editor.isActive("heading", { level: 3 }),
            bullet: editor.isActive("bulletList"),
            ordered: editor.isActive("orderedList"),
            quote: editor.isActive("blockquote"),
            codeBlock: editor.isActive("codeBlock"),
          }
        : null,
  });
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />;
}

function HeadingMenu({ editor, s }: { editor: Editor; s: NonNullable<ReturnType<typeof useToolbarState>> }) {
  const [open, setOpen] = React.useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const level = s.h1 ? 1 : s.h2 ? 2 : s.h3 ? 3 : 0;
  const CurrentIcon = level === 1 ? Heading1 : level === 2 ? Heading2 : level === 3 ? Heading3 : Type;
  const pick = (l: 0 | 1 | 2 | 3) => {
    const chain = editor.chain().focus();
    (l === 0 ? chain.setParagraph() : chain.setHeading({ level: l })).run();
    setOpen(false);
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Text style"
        aria-label="Text style"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 items-center gap-0.5 rounded-lg pl-2 pr-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          level > 0 && "bg-foreground/15 text-foreground",
        )}
      >
        <CurrentIcon className="size-4" />
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <MenuSurface className="left-0 top-full mt-2 origin-top-left">
          <MenuItem icon={<Type className="size-4" />} label="Paragraph" selected={level === 0} onClick={() => pick(0)} />
          <MenuItem icon={<Heading1 className="size-4" />} label="Heading 1" hint="# " selected={level === 1} onClick={() => pick(1)} />
          <MenuItem icon={<Heading2 className="size-4" />} label="Heading 2" hint="## " selected={level === 2} onClick={() => pick(2)} />
          <MenuItem icon={<Heading3 className="size-4" />} label="Heading 3" hint="### " selected={level === 3} onClick={() => pick(3)} />
        </MenuSurface>
      )}
    </div>
  );
}

function FormattingToolbar({ editor }: { editor: Editor }) {
  const s = useToolbarState(editor);
  if (!s) return null;
  const c = () => editor.chain().focus();
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5"
    >
      <HeadingMenu editor={editor} s={s} />
      <Divider />
      <IconButton label="Bold (Ctrl+B)" active={s.bold} onClick={() => c().toggleBold().run()}>
        <Bold className="size-4" />
      </IconButton>
      <IconButton label="Italic (Ctrl+I)" active={s.italic} onClick={() => c().toggleItalic().run()}>
        <Italic className="size-4" />
      </IconButton>
      <IconButton label="Underline (Ctrl+U)" active={s.underline} onClick={() => c().toggleUnderline().run()}>
        <UnderlineIcon className="size-4" />
      </IconButton>
      <IconButton label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()}>
        <Strikethrough className="size-4" />
      </IconButton>
      <IconButton label="Inline code" active={s.code} onClick={() => c().toggleCode().run()}>
        <Code className="size-4" />
      </IconButton>
      <Divider />
      <IconButton label="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <List className="size-4" />
      </IconButton>
      <IconButton label="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered className="size-4" />
      </IconButton>
      <IconButton label="Quote" active={s.quote} onClick={() => c().toggleBlockquote().run()}>
        <Quote className="size-4" />
      </IconButton>
      <IconButton label="Code block" active={s.codeBlock} onClick={() => c().toggleCodeBlock().run()}>
        <Code2 className="size-4" />
      </IconButton>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Styles (scoped, uses shadcn CSS variables)                                 */
/* -------------------------------------------------------------------------- */

const STYLES = `
.rmci-editor{--rmci-comment:#6e7781;--rmci-kw:#cf222e;--rmci-str:#0a3069;--rmci-num:#0550ae;--rmci-fn:#8250df;--rmci-type:#953800;--rmci-attr:#116329;--rmci-del:#82071e}
.dark .rmci-editor{--rmci-comment:#7d8590;--rmci-kw:#ff7b72;--rmci-str:#a5d6ff;--rmci-num:#79c0ff;--rmci-fn:#d2a8ff;--rmci-type:#ffa657;--rmci-attr:#7ee787;--rmci-del:#ffa198}
.rmci-editor .ProseMirror{outline:none;min-height:1.75rem;word-break:break-word;font-size:.9375rem;line-height:1.6}
.rmci-editor .ProseMirror > *:first-child{margin-top:0}
.rmci-editor .ProseMirror > *:last-child{margin-bottom:0}
.rmci-editor .ProseMirror p{margin:.25rem 0}
.rmci-editor .ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);float:inline-start;height:0;pointer-events:none;color:color-mix(in oklab,currentColor 45%,transparent)}
.rmci-editor .ProseMirror h1{font-size:1.5rem;line-height:1.25;font-weight:700;margin:.75rem 0 .25rem;letter-spacing:-.01em}
.rmci-editor .ProseMirror h2{font-size:1.25rem;line-height:1.3;font-weight:650;margin:.65rem 0 .25rem;letter-spacing:-.01em}
.rmci-editor .ProseMirror h3{font-size:1.075rem;line-height:1.35;font-weight:600;margin:.55rem 0 .2rem}
.rmci-editor .ProseMirror ul{list-style:disc;padding-inline-start:1.4rem;padding-inline-end:0;margin:.3rem 0}
.rmci-editor .ProseMirror ol{list-style:decimal;padding-inline-start:1.4rem;padding-inline-end:0;margin:.3rem 0}
.rmci-editor .ProseMirror li{margin:.1rem 0}
.rmci-editor .ProseMirror li > p{margin:0}
.rmci-editor .ProseMirror li::marker{color:color-mix(in oklab,currentColor 55%,transparent)}
.rmci-editor .ProseMirror blockquote{margin:.5rem 0;padding:.35rem .9rem;border-inline-start:3px solid color-mix(in oklab,currentColor 30%,transparent);background:color-mix(in oklab,currentColor 5%,transparent);border-start-end-radius:.6rem;border-end-end-radius:.6rem}
.rmci-editor .ProseMirror :is(ul,ol):has(> li:first-child > :is(p,h1,h2,h3):dir(rtl)),.rmci-editor .ProseMirror blockquote:has(> :is(p,h1,h2,h3):first-child:dir(rtl)){direction:rtl}
.rmci-ph-rtl .ProseMirror p.is-editor-empty:first-child::before{float:right;direction:rtl}
.rmci-editor .ProseMirror code:not(pre code){font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em;padding:.12rem .38rem;border-radius:.4rem;background:color-mix(in oklab,currentColor 10%,transparent);border:1px solid color-mix(in oklab,currentColor 15%,transparent);unicode-bidi:isolate}
.rmci-editor .ProseMirror pre code{background:none;border:0;padding:0;font-size:inherit;color:inherit}
.rmci-editor .ProseMirror hr{border:0;border-top:1px solid color-mix(in oklab,currentColor 15%,transparent);margin:.75rem 0}
.rmci-editor .ProseMirror u{text-underline-offset:3px}
.rmci-editor .ProseMirror ::selection{background:color-mix(in oklab,currentColor 22%,transparent)}
.rmci-editor .hljs-comment,.rmci-editor .hljs-quote{color:var(--rmci-comment);font-style:italic}
.rmci-editor .hljs-keyword,.rmci-editor .hljs-selector-tag,.rmci-editor .hljs-literal,.rmci-editor .hljs-doctag{color:var(--rmci-kw)}
.rmci-editor .hljs-string,.rmci-editor .hljs-regexp,.rmci-editor .hljs-addition{color:var(--rmci-str)}
.rmci-editor .hljs-number,.rmci-editor .hljs-symbol,.rmci-editor .hljs-bullet,.rmci-editor .hljs-meta{color:var(--rmci-num)}
.rmci-editor .hljs-title,.rmci-editor .hljs-section,.rmci-editor .hljs-title.function_{color:var(--rmci-fn)}
.rmci-editor .hljs-built_in,.rmci-editor .hljs-type,.rmci-editor .hljs-class .hljs-title{color:var(--rmci-type)}
.rmci-editor .hljs-attr,.rmci-editor .hljs-attribute,.rmci-editor .hljs-variable,.rmci-editor .hljs-template-variable,.rmci-editor .hljs-property,.rmci-editor .hljs-name,.rmci-editor .hljs-tag{color:var(--rmci-attr)}
.rmci-editor .hljs-deletion{color:var(--rmci-del)}
.rmci-editor .hljs-emphasis{font-style:italic}.rmci-editor .hljs-strong{font-weight:700}
`;

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export interface ChatModel {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

export interface ChatSubmitPayload {
  /** Markdown serialization of the prompt. */
  markdown: string;
  /** Raw HTML from the editor. */
  html: string;
  /** Plain text (no formatting). */
  text: string;
  /** ProseMirror JSON document. */
  json: JSONContent;
  /** Selected model id. */
  model: string;
}

export interface RichMarkdownChatInputProps {
  onSubmit?: (payload: ChatSubmitPayload) => void | Promise<void>;
  /** Called on every change with the current markdown. */
  onChange?: (markdown: string) => void;
  placeholder?: string;
  models?: ChatModel[];
  defaultModel?: string;
  /** Initial content as markdown-ish HTML. */
  defaultValue?: string;
  disabled?: boolean;
  /** Show a stop button instead of send while true. */
  loading?: boolean;
  onStop?: () => void;
  /** Text direction. "auto" (default) detects Arabic/Hebrew per block. */
  direction?: "auto" | "ltr" | "rtl";
  /** Send with plain Enter (Shift+Enter = newline). Default false: send with Ctrl/Cmd+Enter or the button. */
  sendOnEnter?: boolean;
  /** Max editor height in px before scrolling. */
  maxHeight?: number;
  autoFocus?: boolean;
  className?: string;
}

const DEFAULT_MODELS: ChatModel[] = [
  { id: "fast", label: "Fast", description: "Quick answers, low latency", icon: <Zap className="size-4" /> },
  { id: "balanced", label: "Balanced", description: "Great for everyday tasks", icon: <Sparkles className="size-4" /> },
  { id: "deep", label: "Deep think", description: "Slower, more thorough", icon: <Brain className="size-4" /> },
];

export function RichMarkdownChatInput({
  onSubmit,
  onChange,
  placeholder = "Ask anything...",
  models = DEFAULT_MODELS,
  defaultModel,
  defaultValue,
  disabled = false,
  loading = false,
  onStop,
  direction = "auto",
  sendOnEnter = false,
  maxHeight = 320,
  autoFocus = false,
  className,
}: RichMarkdownChatInputProps) {
  const [model, setModel] = React.useState(defaultModel ?? models[0]?.id ?? "");
  const [showToolbar, setShowToolbar] = React.useState(false);
  const [plusOpen, setPlusOpen] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [empty, setEmpty] = React.useState(!defaultValue);
  const [isMac, setIsMac] = React.useState(false);
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  const sendKey = isMac ? "⌘ Enter" : "Ctrl Enter";
  const placeholderRtl = direction === "rtl" || (direction === "auto" && RTL_CHARS.test(placeholder));

  const plusRef = useDismiss<HTMLDivElement>(plusOpen, () => setPlusOpen(false));
  const modelRef = useDismiss<HTMLDivElement>(modelOpen, () => setModelOpen(false));

  const submitRef = React.useRef<() => boolean>(() => false);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const extensions = React.useMemo(
    () => [
      // TipTap v3's StarterKit already bundles Underline; disable it so ours
      // (which adds the <u>text</u> input rule) is the only one.
      StarterKit.configure({
        codeBlock: false,
        underline: false,
        heading: { levels: [1, 2, 3] },
      }),
      UnderlineMd,
      Typography,
      Placeholder.configure({ placeholder }),
      CodeBlock,
      BidiBlocks.configure({ direction }),
      ChatShortcuts.configure({ onSubmit: () => submitRef.current(), sendOnEnter }),
    ],
    [placeholder, direction, sendOnEnter],
  );

  const editor = useEditor({
    extensions,
    content: defaultValue ?? "",
    autofocus: autoFocus ? "end" : false,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        dir: direction,
        "aria-label": placeholder,
      },
    },
    onUpdate: ({ editor }) => {
      setEmpty(editor.isEmpty);
      onChangeRef.current?.(toMarkdown(editor.getJSON()));
    },
  });

  React.useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const submit = React.useCallback((): boolean => {
    if (!editor || editor.isEmpty || disabled || loading) return true;
    const json = editor.getJSON();
    const payload: ChatSubmitPayload = {
      markdown: toMarkdown(json),
      html: editor.getHTML(),
      text: editor.getText({ blockSeparator: "
" }).trim(),
      json,
      model,
    };
    editor.commands.clearContent(true);
    setEmpty(true);
    void onSubmit?.(payload);
    return true;
  }, [editor, disabled, loading, model, onSubmit]);
  submitRef.current = submit;

  const activeModel = models.find((m) => m.id === model) ?? models[0];
  const canSend = !empty && !disabled && !loading;

  return (
    <div className={cn("rmci-root w-full", placeholderRtl && "rmci-ph-rtl", className)}>
      <style>{STYLES}</style>
      <div
        className={cn(
          "rmci-editor group/input relative w-full rounded-3xl border border-border bg-card text-card-foreground shadow-xl shadow-black/20 transition-all duration-200",
          "focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/30",
          disabled && "opacity-60",
        )}
      >
        {/* Toolbar (not clipped, so its menus can open freely) */}
        {editor && showToolbar && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200">
            <FormattingToolbar editor={editor} />
          </div>
        )}

        {/* Editor */}
        <div
          className="overflow-y-auto px-5 pb-1 pt-4 transition-[height] duration-150"
          style={{ maxHeight }}
          onMouseDown={(e) => {
            // only the padding area focuses the editor; never steal focus from controls
            if (e.target === e.currentTarget) {
              e.preventDefault();
              editor?.commands.focus("end");
            }
          }}
        >
          <EditorContent editor={editor} />
        </div>

        {/* Bottom action bar */}
        <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-2">
          <div className="flex items-center gap-1">
            <div ref={plusRef} className="relative">
              <IconButton
                label="Add attachment"
                active={plusOpen}
                disabled={disabled}
                onClick={() => setPlusOpen((o) => !o)}
                className="rounded-full border border-border"
              >
                <Plus className={cn("size-4 transition-transform duration-200", plusOpen && "rotate-45")} />
              </IconButton>
              {plusOpen && (
                <MenuSurface className="bottom-full left-0 mb-2 w-56">
                  <MenuItem icon={<FileText className="size-4" />} label="Upload a file" hint="PDF, DOCX, TXT…" onClick={() => setPlusOpen(false)} />
                  <MenuItem icon={<ImageIcon className="size-4" />} label="Upload an image" hint="PNG, JPG, WEBP" onClick={() => setPlusOpen(false)} />
                  <MenuItem icon={<Code2 className="size-4" />} label="Add code snippet" onClick={() => { setPlusOpen(false); editor?.chain().focus().toggleCodeBlock().run(); }} />
                </MenuSurface>
              )}
            </div>

            <IconButton
              label={showToolbar ? "Hide formatting" : "Show formatting"}
              active={showToolbar}
              disabled={disabled}
              onClick={() => setShowToolbar((v) => !v)}
            >
              <Type className="size-4" />
            </IconButton>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Model selector */}
            {activeModel && (
              <div ref={modelRef} className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={modelOpen}
                  disabled={disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setModelOpen((o) => !o)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-foreground/[0.03] px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  {activeModel.icon}
                  {activeModel.label}
                  <ChevronDown className={cn("size-3 transition-transform duration-200", modelOpen && "rotate-180")} />
                </button>
                {modelOpen && (
                  <MenuSurface className="bottom-full right-0 mb-2 w-64 origin-bottom-right">
                    {models.map((m) => (
                      <MenuItem
                        key={m.id}
                        icon={m.icon}
                        label={m.label}
                        hint={m.description}
                        selected={m.id === model}
                        onClick={() => {
                          setModel(m.id);
                          setModelOpen(false);
                        }}
                      />
                    ))}
                  </MenuSurface>
                )}
              </div>
            )}

            <IconButton
              label={recording ? "Stop voice input" : "Voice input"}
              active={recording}
              disabled={disabled}
              onClick={() => setRecording((r) => !r)}
              className={cn(recording && "bg-red-500/15 text-red-400 animate-pulse")}
            >
              <Mic className="size-4" />
            </IconButton>

            {loading ? (
              <button
                type="button"
                aria-label="Stop generating"
                onClick={onStop}
                className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send message"
                title={`Send (${sendKey})`}
                disabled={!canSend}
                onMouseDown={(e) => e.preventDefault()}
                onClick={submit}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  canSend
                    ? "hover:scale-105 hover:brightness-110 active:scale-95"
                    : "cursor-not-allowed opacity-30",
                )}
              >
                <ArrowUp className="size-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 text-center text-[11px] text-muted-foreground/70" dir="ltr">
        <kbd className="font-sans">{sendKey}</kbd> to send · <kbd className="font-sans">Shift + Enter</kbd> for a line break ·{" "}
        <code className="font-mono">```</code> for code
      </p>
    </div>
  );
}

export default RichMarkdownChatInput;

demo.tsx
"use client";

import * as React from "react";
import {
  RichMarkdownChatInput,
  type ChatSubmitPayload,
} from "@/components/ui/ai-chat-input-field";

export default function DemoOne() {
  const [last, setLast] = React.useState<ChatSubmitPayload | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (p: ChatSubmitPayload) => {
    setLast(p);
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1200)); // fake request
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4 text-foreground">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          What can I help you with?
        </h1>

        <RichMarkdownChatInput
          onSubmit={handleSubmit}
          loading={loading}
          onStop={() => setLoading(false)}
          autoFocus
        />

        {last && (
          <div className="rounded-2xl border border-border bg-card p-4 text-sm">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Markdown output · model: {last.model}
            </p>
            <pre
              dir="auto"
              className="whitespace-pre-wrap break-words font-mono text-[13px]"
            >
              {last.markdown}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
```

Install NPM dependencies:
```bash
clsx, lowlight, @tiptap/core, lucide-react, @tiptap/react, tailwind-merge, @tiptap/starter-kit, @tiptap/extension-underline, @tiptap/extension-typography, @tiptap/extension-placeholder, @tiptap/extension-code-block-lowlight
```

Implementation Guidelines
 1. Analyze the component structure and identify all required dependencies
 2. Review the component's argumens and state
 3. Identify any required context providers or hooks and install them
 4. Questions to Ask
 - What data/props will be passed to this component?
 - Are there any specific state management requirements?
 - Are there any required assets (images, icons, etc.)?
 - What is the expected responsive behavior?
 - What is the best place to use this component in the app?

Steps to integrate
 0. Copy paste all the code above in the correct directories
 1. Install external dependencies
 2. Fill image assets with Unsplash stock images you know exist
 3. Use lucide-react icons for svgs or logos if component requires them

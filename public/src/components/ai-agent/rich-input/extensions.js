// =============================================================================
// rich-input/extensions.js
// Builds the Tiptap extension list. Takes the lazily-loaded vendor module `T`
// (public/assets/vendor/tiptap/tiptap.js) so nothing here imports Tiptap at
// module-evaluation time.
//
// Same behaviour as the 21st.dev component:
//   Enter            new line / block (send is handled by the chat panel)
//   Shift+Enter      soft break (plain newline inside code blocks)
//   Ctrl/Cmd+Enter   send
//   ```lang + Enter  turns the line into a code block; a lone ``` + Enter on
//                    the last line of a code block closes it
// plus per-block bidi (Arabic/English blocks align on their own) and command /
// @mention highlighting (replaces the old textarea mirror).
// =============================================================================
import { createCodeBlockView } from "./code-block-view.js";

const commandName = (c) => String(c?.command ?? "").trim().replace(/^\//, "");
const mentionName = (m) => String(m?.name ?? m?.token ?? "").trim().replace(/^@/, "");

export function buildExtensions(T, options) {
  const { placeholder, direction, onSubmit, getCommands, getMentions } = options;
  const lowlight = T.createLowlight(T.common);

  // `<u>text</u>` -> underline
  const UnderlineMd = T.Underline.extend({
    addInputRules() {
      return [T.markInputRule({ find: /(?:<u>)([^<]+)(?:<\/u>)$/, type: this.type })];
    },
  });

  const CodeBlock = T.CodeBlockLowlight.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        collapsed: { default: false, rendered: false, keepOnSplit: false },
      };
    },
    addNodeView() {
      return (props) => createCodeBlockView(props);
    },
  }).configure({ lowlight, defaultLanguage: "plaintext" });

  // Per-block bidi: paragraphs and headings get dir="auto".
  const BidiBlocks = T.Extension.create({
    name: "bidiBlocks",
    addGlobalAttributes() {
      const auto = direction === "auto";
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

  const ChatShortcuts = T.Extension.create({
    name: "chatShortcuts",
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        "Mod-Enter": () => onSubmit(),
        "Shift-Enter": ({ editor }) => (editor.isActive("codeBlock") ? editor.commands.newlineInCode() : false),
        Enter: ({ editor }) => {
          const { $from, empty } = editor.state.selection;
          const parent = $from.parent;
          const atEnd = empty && $from.parentOffset === parent.content.size;

          if (atEnd && parent.type.name === "codeBlock") {
            const m = /(^|\n)```$/.exec(parent.textContent);
            if (m) {
              return editor.chain().focus()
                .deleteRange({ from: $from.pos - m[0].length, to: $from.pos })
                .exitCode()
                .run();
            }
          }

          if (atEnd && parent.type.name === "paragraph") {
            const f = /^```([\w+#.-]*)$/.exec(parent.textContent);
            if (f) {
              return editor.chain().focus()
                .deleteRange({ from: $from.start(), to: $from.end() })
                .setCodeBlock(f[1] ? { language: f[1] } : undefined)
                .run();
            }
          }
          return false;
        },
      };
    },
  });

  // Highlights `/command` (only as the first word) and known `@mention` tokens.
  const TokenHighlight = T.Extension.create({
    name: "tokenHighlight",
    addProseMirrorPlugins() {
      const key = new T.PluginKey("rmciTokens");
      return [
        new T.Plugin({
          key,
          props: {
            decorations(state) {
              const commands = new Set((getCommands?.() || []).map((c) => commandName(c).toLowerCase()).filter(Boolean));
              const mentions = new Set((getMentions?.() || []).map((m) => mentionName(m).toLowerCase()).filter(Boolean));
              if (!commands.size && !mentions.size) return T.DecorationSet.empty;
              const decos = [];
              let first = true;
              state.doc.descendants((node, pos) => {
                if (node.type.name === "codeBlock") { first = false; return false; }
                if (!node.isTextblock) return true;
                const text = node.textContent;
                const start = pos + 1;
                if (first) {
                  first = false;
                  const m = /^\/([^\s/]+)/.exec(text);
                  if (m && commands.has(m[1].toLowerCase())) {
                    decos.push(T.Decoration.inline(start, start + m[0].length, { class: "rmci-token rmci-token--command" }));
                  }
                }
                const re = /(^|\s)@([^\s@]+)/g;
                let mm;
                while ((mm = re.exec(text))) {
                  if (mentions.has(mm[2].toLowerCase())) {
                    const from = start + mm.index + mm[1].length;
                    decos.push(T.Decoration.inline(from, from + mm[2].length + 1, { class: "rmci-token rmci-token--mention" }));
                  }
                }
                return false;
              });
              return T.DecorationSet.create(state.doc, decos);
            },
          },
        }),
      ];
    },
  });

  return [
    // TipTap v3's StarterKit already bundles Underline; ours (with the <u> input rule) replaces it.
    T.StarterKit.configure({ codeBlock: false, underline: false, heading: { levels: [1, 2, 3] } }),
    UnderlineMd,
    T.Typography,
    T.Placeholder.configure({ placeholder }),
    CodeBlock,
    BidiBlocks,
    ChatShortcuts,
    TokenHighlight,
  ];
}

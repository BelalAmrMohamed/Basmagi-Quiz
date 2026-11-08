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
  //
  // Robustness notes (the chips used to end up half-painted, e.g. "/expla" + "i"
  // + "n" while typing): (1) decorations are computed in one pure function that
  // can never throw into ProseMirror's update cycle — a throw there aborts the
  // view update and leaves stale chip <span>s with natively-typed text next to
  // them; (2) invisible bidi/zero-width marks that RTL keyboards insert next to
  // a word are ignored when matching, so "/ex\u200Fplain" still counts as
  // /explain; (3) a self-heal pass compares the painted chips with the expected
  // ones after every update and, on any drift, rebuilds the DOM once.
  const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
  const WORD_START = "(^|[\\s\\u00A0\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069])";

  function computeTokens(doc) {
    const out = []; // { from, to, kind }
    let commands, mentions;
    try {
      commands = new Set((getCommands?.() || []).map((c) => commandName(c).toLowerCase()).filter(Boolean));
      mentions = new Set((getMentions?.() || []).map((m) => mentionName(m).toLowerCase()).filter(Boolean));
    } catch {
      return out;
    }
    if (!commands.size && !mentions.size) return out;
    doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") return false;
      if (!node.isTextblock) return true;
      const text = node.textContent;
      const start = pos + 1;
      const scan = (re, set, kind) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          const word = m[2].replace(INVISIBLE, "").toLowerCase();
          if (set.has(word)) {
            const from = start + m.index + m[1].length;
            out.push({ from, to: from + m[2].length + 1, kind });
          }
        }
      };
      if (commands.size) scan(new RegExp(`${WORD_START}/([^\\s/]+)`, "g"), commands, "command");
      if (mentions.size) scan(new RegExp(`${WORD_START}@([^\\s@]+)`, "g"), mentions, "mention");
      return false;
    });
    return out;
  }

  const TokenHighlight = T.Extension.create({
    name: "tokenHighlight",
    addProseMirrorPlugins() {
      const key = new T.PluginKey("rmciTokens");
      return [
        new T.Plugin({
          key,
          // `bust` is flipped on for exactly one transaction by the self-heal
          // below: painting nothing for a beat forces ProseMirror to rebuild
          // the paragraph DOM, then the next transaction paints correctly.
          state: {
            init: () => ({ bust: false }),
            apply: (tr, prev) => {
              const meta = tr.getMeta(key);
              return meta ? { bust: !!meta.bust } : prev;
            },
          },
          props: {
            decorations(state) {
              if (key.getState(state)?.bust) return T.DecorationSet.empty;
              try {
                const decos = computeTokens(state.doc).map((t) =>
                  T.Decoration.inline(t.from, t.to, { class: `rmci-token rmci-token--${t.kind}` }, { inclusiveStart: false, inclusiveEnd: false }),
                );
                return decos.length ? T.DecorationSet.create(state.doc, decos) : T.DecorationSet.empty;
              } catch {
                return T.DecorationSet.empty;
              }
            },
          },
          view() {
            let raf = 0;
            let bustedDoc = null;
            return {
              update(view) {
                if (key.getState(view.state)?.bust) {
                  // Paint again on the next frame (outside this update cycle).
                  cancelAnimationFrame(raf);
                  raf = requestAnimationFrame(() => view.dispatch(view.state.tr.setMeta(key, { bust: false })));
                  return;
                }
                cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => {
                  if (view.isDestroyed || view.composing) return;
                  const doc = view.state.doc;
                  if (doc === bustedDoc) return; // already rebuilt for this doc — never loop
                  const want = computeTokens(doc).map((t) => doc.textBetween(t.from, t.to)).join("|");
                  const got = [...view.dom.querySelectorAll(".rmci-token")].map((el) => el.textContent).join("|");
                  if (want !== got) {
                    bustedDoc = doc;
                    view.dispatch(view.state.tr.setMeta(key, { bust: true }));
                  }
                });
              },
              destroy() { cancelAnimationFrame(raf); },
            };
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

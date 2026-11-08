// =============================================================================
// runtimes/tiptap-vendor/index.js
// Re-exports exactly what the AI Agent's rich input (public/src/components/
// ai-agent/rich-input/) needs from Tiptap + lowlight. Built by build.mjs into
// public/assets/vendor/tiptap/tiptap.js (an ES module, loaded lazily by the
// rich input on first use). The component itself is plain readable JS in the
// feature folder; only these third-party packages are bundled.
// =============================================================================
export { Editor, Extension, markInputRule } from '@tiptap/core';
export { default as StarterKit } from '@tiptap/starter-kit';
export { default as Underline } from '@tiptap/extension-underline';
export { default as Typography } from '@tiptap/extension-typography';
export { default as Placeholder } from '@tiptap/extension-placeholder';
export { default as CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
export { Plugin, PluginKey } from '@tiptap/pm/state';
export { Decoration, DecorationSet } from '@tiptap/pm/view';
export { common, createLowlight } from 'lowlight';

// Entry file for src/renderer/vendor/codemirror.js (exposed to the page as window.CM).
// Rebuild with:
//   npm i -D esbuild @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/lang-markdown
//   npx esbuild scripts/codemirror-entry.mjs --bundle --minify --format=iife --global-name=CM --outfile=src/renderer/vendor/codemirror.js
export { Annotation, Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state';
export { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, keymap, placeholder } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
export { syntaxTree } from '@codemirror/language';
export { markdown, markdownLanguage, deleteMarkupBackward } from '@codemirror/lang-markdown';

import { useEffect, useRef } from "react";
import { EditorView, ViewPlugin, Decoration, keymap } from "@codemirror/view";
import type { ViewUpdate, DecorationSet } from "@codemirror/view";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle, syntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// ── Obsidian-style live-preview conceal plugin ───────────────────────────────
//
// Non-cursor lines:
//   • Heading prefix (## ) is replaced (hidden); font-size applied via line deco
//   • EmphasisMark (* / ** / _), StrikethroughMark (~~), CodeMark (`) are replaced
// Cursor line:
//   • Heading ## shown in muted colour; line still gets the heading font-size
//   • Inline markers revealed

const headingRe = /^(#{1,6}) /;

// node names whose syntax markers are hidden on off-cursor lines
const INLINE_CONCEAL = new Set(["EmphasisMark", "StrikethroughMark", "CodeMark"]);

type DR = { from: number; to: number; deco: Decoration };

function buildConceal(view: EditorView): DecorationSet {
  const head        = view.state.selection.main.head;
  const cursorLine  = view.hasFocus ? view.state.doc.lineAt(head).number : -1;
  const ranges: DR[] = [];

  // ── Heading lines ──────────────────────────────────────────────────────────
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line   = view.state.doc.lineAt(pos);
      const m      = headingRe.exec(line.text);
      const onLine = line.number === cursorLine;

      if (m) {
        const level     = m[1].length;
        const prefixLen = m[0].length; // e.g. "## " = 3 chars

        // Line decoration: sets font-size on the .cm-line element (h1–h3)
        if (level <= 3) {
          ranges.push({
            from: line.from, to: line.from,
            deco: Decoration.line({ class: `cm-ob-hl${level}` }),
          });
        }

        if (onLine) {
          // Show ## in muted colour at the heading font-size (line deco handles size)
          ranges.push({
            from: line.from, to: line.from + level,
            deco: Decoration.mark({ class: "cm-ob-mark" }),
          });
        } else {
          // Hide the entire "## " prefix
          ranges.push({
            from: line.from, to: line.from + prefixLen,
            deco: Decoration.replace({}),
          });
        }
      }

      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }

  // ── Inline marker conceal ──────────────────────────────────────────────────
  syntaxTree(view.state).iterate({
    enter(node) {
      if (!INLINE_CONCEAL.has(node.name)) return;
      if (view.state.doc.lineAt(node.from).number !== cursorLine) {
        ranges.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
      }
    },
  });

  // RangeSetBuilder requires non-decreasing (from, to) — sort before building
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of ranges) {
    builder.add(from, to, deco);
  }
  return builder.finish();
}

const concealPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildConceal(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged)
        this.decorations = buildConceal(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Syntax highlighting ──────────────────────────────────────────────────────

const mdHighlight = HighlightStyle.define([
  { tag: tags.heading1,      fontWeight: "700", color: "#fafafa" },
  { tag: tags.heading2,      fontWeight: "700", color: "#fafafa" },
  { tag: tags.heading3,      fontWeight: "600", color: "#f4f4f5" },
  { tag: tags.heading4,      fontWeight: "600", color: "#e4e4e7" },
  { tag: tags.heading5,      fontWeight: "600", color: "#d4d4d8" },
  { tag: tags.heading6,      fontWeight: "500", color: "#a1a1aa" },
  { tag: tags.strong,        fontWeight: "700", color: "#fafafa" },
  { tag: tags.emphasis,      fontStyle:  "italic", color: "#e4e4e7" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "#71717a" },
  { tag: tags.link,          color: "#818cf8" },
  { tag: tags.url,           color: "#6366f1" },
  { tag: tags.monospace,     fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace", color: "#d4d4d4", background: "rgba(255,255,255,0.07)", borderRadius: "3px", padding: "1px 4px" },
  { tag: tags.quote,         color: "#a1a1aa", fontStyle: "italic" },
  { tag: tags.processingInstruction, color: "#6b7280" },
  { tag: tags.meta,          color: "#71717a" },
]);

// ── Editor visual theme ──────────────────────────────────────────────────────

const editorTheme = EditorView.theme({
  "&":            { height: "100%", background: "#161616" },
  ".cm-scroller": { overflow: "auto", height: "100%", scrollbarWidth: "thin" },
  ".cm-content":  {
    padding: "28px 32px",
    lineHeight: "1.8",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: "13.5px",
    color: "#c9c9cc",
    maxWidth: "760px",
    margin: "0 auto",
    caretColor: "#aeafad",
  },
  ".cm-focused":            { outline: "none" },
  ".cm-gutters":            { display: "none" },
  ".cm-activeLine":         { background: "rgba(255,255,255,0.025)" },
  ".cm-selectionBackground":              { background: "rgba(99,102,241,0.22) !important" },
  "&.cm-focused .cm-selectionBackground": { background: "rgba(99,102,241,0.28) !important" },
  ".cm-cursor":   { borderLeftColor: "#aeafad", borderLeftWidth: "1.5px" },
  ".cm-line":     { padding: "0 2px" },
  ".cm-scroller::-webkit-scrollbar":       { width: "4px" },
  ".cm-scroller::-webkit-scrollbar-thumb": { background: "rgba(255,255,255,0.1)", borderRadius: "2px" },

  // Heading font sizes — applied to the .cm-line element via Decoration.line
  ".cm-ob-hl1": { fontSize: "1.5em" },
  ".cm-ob-hl2": { fontSize: "1.3em" },
  ".cm-ob-hl3": { fontSize: "1.15em" },

  // Muted ## marker shown on the cursor line
  ".cm-ob-mark": { color: "#52525b", fontWeight: "400" },
});

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  path: string;
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
}

export function MarkdownEditor({ path, value, onChange, onSave }: Props) {
  const hostRef     = useRef<HTMLDivElement>(null);
  const viewRef     = useRef<EditorView | null>(null);
  const externalVal = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSaveRef   = useRef(onSave);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onSaveRef.current   = onSave;   }, [onSave]);

  useEffect(() => {
    if (!hostRef.current) return;
    externalVal.current = value;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            { key: "Mod-s", run: () => { onSaveRef.current?.(); return true; } },
          ]),
          markdown(),
          syntaxHighlighting(mdHighlight),
          concealPlugin,
          editorTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              const v = u.state.doc.toString();
              externalVal.current = v;
              onChangeRef.current(v);
            }
          }),
        ],
      }),
      parent: hostRef.current,
    });

    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === externalVal.current) return;
    externalVal.current = value;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return (
    <div
      ref={hostRef}
      className="md-editor-host"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    />
  );
}

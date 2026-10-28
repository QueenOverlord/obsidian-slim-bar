/**
 * Markdown Helper — One CodeMirror 6 editor powers both modes:
 * 1. Normal Mode: Obsidian-style live preview (Markdown symbols hidden except on the cursor line)
 * 2. Origin Mode: the same document as raw Markdown (live preview switched off)
 * Both modes share one document, so switching keeps your scroll position, cursor and selection.
 */
(() => {
  const {
    EditorState, EditorSelection, Compartment, Annotation, Transaction, StateField,
    EditorView, keymap, Decoration, ViewPlugin, WidgetType, drawSelection, placeholder,
    history, defaultKeymap, historyKeymap, indentWithTab,
    markdown, markdownLanguage,
    syntaxTree,
  } = window.CM;

  // Marks edits that came from the .md file (not typed), so they don't trigger a save
  const External = Annotation.define();
  // Tells the table / math blocks that the editor gained or lost focus
  const FocusChange = Annotation.define();
  // Folds or unfolds the callout whose title line starts at this position
  const FoldToggle = Annotation.define();

  // ==================== WIDGETS ====================
  class BulletWidget extends WidgetType {
    eq() { return true; }
    toDOM() {
      const dot = document.createElement('span');
      dot.className = 'cm-lp-bullet';
      dot.textContent = '•';
      return dot;
    }
  }

  // Clickable task checkbox: flips "[ ]" <-> "[x]" in the document
  class CheckboxWidget extends WidgetType {
    constructor(checked) {
      super();
      this.checked = checked;
    }
    eq(other) { return other.checked === this.checked; }
    toDOM(view) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'cm-lp-checkbox';
      box.checked = this.checked;
      box.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const pos = view.posAtDOM(box); // start of "[ ]"
        const current = view.state.sliceDoc(pos + 1, pos + 2);
        view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: current === ' ' ? 'x' : ' ' } });
      });
      box.addEventListener('click', (e) => e.preventDefault());
      return box;
    }
    ignoreEvent() { return true; }
  }

  class HrWidget extends WidgetType {
    eq() { return true; }
    toDOM() {
      const hr = document.createElement('span');
      hr.className = 'cm-lp-hr';
      return hr;
    }
  }

  // Stands in for "```lang" while the cursor is outside the block
  class CodeLangWidget extends WidgetType {
    constructor(lang) {
      super();
      this.lang = lang;
    }
    eq(other) { return other.lang === this.lang; }
    toDOM() {
      const label = document.createElement('span');
      label.className = 'cm-lp-codeblock-lang';
      label.textContent = this.lang;
      return label;
    }
  }

  // Top-right button: copies the block's text (no fences, no "> " quote marks)
  class CopyCodeWidget extends WidgetType {
    constructor(text) {
      super();
      this.text = text;
    }
    eq(other) { return other.text === this.text; }
    toDOM() {
      const btn = document.createElement('button');
      btn.className = 'cm-lp-codeblock-copy';
      btn.type = 'button';
      btn.title = 'Copy block';
      btn.textContent = 'Copy';
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the cursor where it is
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await window.slimBarAPI.copyText(this.text);
          btn.textContent = 'Copied ✓';
          btn.classList.add('is-copied');
        } catch {
          btn.textContent = 'Failed';
        }
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('is-copied');
        }, 1400);
      });
      return btn;
    }
    ignoreEvent() { return true; }
  }

  // Math typeset by KaTeX (bundled in vendor/katex); bad LaTeX shows in red instead of breaking
  class MathWidget extends WidgetType {
    constructor(tex, display) {
      super();
      this.tex = tex;
      this.display = display;
    }
    eq(other) { return other.tex === this.tex && other.display === this.display; }
    toDOM() {
      const el = document.createElement(this.display ? 'div' : 'span');
      el.className = this.display ? 'cm-lp-math cm-lp-math-block' : 'cm-lp-math';
      try {
        window.katex.render(this.tex, el, { displayMode: this.display, throwOnError: false, output: 'html' });
      } catch {
        el.textContent = this.tex;
      }
      return el;
    }
    ignoreEvent() { return false; }
  }

  const escapeHtml = (text) =>
    text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Bold, italic, strike, code and links inside a table cell
  function renderInline(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code class="cm-lp-code">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="cm-lp-strong">$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em class="cm-lp-em">$2</em>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<span class="cm-lp-wikilink" data-wikilink="$1">$2</span>')
      .replace(/\[\[([^\]]+)\]\]/g, '<span class="cm-lp-wikilink" data-wikilink="$1">$1</span>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="cm-lp-link" data-href="$2">$1</span>');
  }

  // "| a | b |" -> ["a", "b"] (a "\|" stays inside its cell)
  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
  }

  // A Markdown table drawn as a real table; clicking it puts the cursor inside to edit the Markdown
  class TableWidget extends WidgetType {
    constructor(source) {
      super();
      this.source = source;
    }
    eq(other) { return other.source === this.source; }
    toDOM() {
      const [head, delimiter, ...rows] = this.source.split('\n');
      const aligns = splitRow(delimiter || '').map((d) =>
        /^:-+:$/.test(d) ? 'center' : /^-+:$/.test(d) ? 'right' : /^:-+$/.test(d) ? 'left' : ''
      );
      const cells = (line, tag) =>
        splitRow(line)
          .map((cell, i) => `<${tag}${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${renderInline(cell)}</${tag}>`)
          .join('');
      const wrap = document.createElement('div');
      wrap.className = 'cm-lp-table-wrap';
      wrap.innerHTML =
        `<table class="cm-lp-table"><thead><tr>${cells(head, 'th')}</tr></thead>` +
        `<tbody>${rows.map((row) => `<tr>${cells(row, 'td')}</tr>`).join('')}</tbody></table>`;
      return wrap;
    }
    ignoreEvent() { return false; } // clicks reach the editor: links open, the table opens for editing
  }

  // ==================== CALLOUTS ====================
  // > [!type]± Title — Obsidian's callout types, their aliases, color and icon (Lucide paths)
  const CALLOUT_TYPES = {
    note: { color: 'blue', icon: 'pencil' },
    abstract: { color: 'cyan', icon: 'clipboard' }, summary: 'abstract', tldr: 'abstract',
    info: { color: 'blue', icon: 'info' },
    todo: { color: 'blue', icon: 'circle-check' },
    tip: { color: 'cyan', icon: 'flame' }, hint: 'tip', important: 'tip',
    success: { color: 'green', icon: 'check' }, check: 'success', done: 'success',
    question: { color: 'orange', icon: 'help' }, help: 'question', faq: 'question',
    warning: { color: 'orange', icon: 'alert' }, caution: 'warning', attention: 'warning',
    failure: { color: 'red', icon: 'x' }, fail: 'failure', missing: 'failure',
    danger: { color: 'red', icon: 'zap' }, error: 'danger',
    bug: { color: 'red', icon: 'bug' },
    example: { color: 'purple', icon: 'list' },
    quote: { color: 'gray', icon: 'quote' }, cite: 'quote',
  };
  const CALLOUT_ICONS = {
    pencil: ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'],
    clipboard: ['M9 2h6v4H9z', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M12 11h4', 'M12 16h4', 'M8 11h.01', 'M8 16h.01'],
    info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 16v-4', 'M12 8h.01'],
    'circle-check': ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'm9 12 2 2 4-4'],
    flame: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
    check: ['M20 6 9 17l-5-5'],
    help: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
    alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
    x: ['M18 6 6 18', 'm6 6 12 12'],
    zap: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
    bug: ['M9 7.13v-1a3 3 0 1 1 6 0v1', 'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6', 'M12 20v-9', 'M6 13H2', 'M22 13h-4', 'M6.53 9C4.6 8.8 3 7.1 3 5', 'M20.97 5c0 2.1-1.6 3.8-3.5 4'],
    list: ['M3 6h.01', 'M3 12h.01', 'M3 18h.01', 'M8 6h13', 'M8 12h13', 'M8 18h13'],
    quote: ['M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z', 'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'],
    chevron: ['m6 9 6 6 6-6'],
  };
  const CALLOUT_RE = /^(\s*>\s*)\[!([\w-]+)\]([+-]?)\s*(.*)$/;

  function calloutType(name) {
    let type = name.toLowerCase();
    if (typeof CALLOUT_TYPES[type] === 'string') type = CALLOUT_TYPES[type];
    return CALLOUT_TYPES[type] ? { name: type, ...CALLOUT_TYPES[type] } : { name: type, ...CALLOUT_TYPES.note };
  }

  // The callout starting on this line, or null: { type, fold: '' | '+' | '-', title, prefixLength }
  function parseCallout(lineText) {
    const m = lineText.match(CALLOUT_RE);
    if (!m) return null;
    const prefixLength = lineText.length - m[4].length;
    return { type: calloutType(m[2]), rawType: m[2], fold: m[3], title: m[4], prefixLength };
  }

  function svgIcon(name, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls);
    for (const d of CALLOUT_ICONS[name]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  // Stands in for "> [!type]± ": the icon, plus the type's name when the callout has no title
  class CalloutTitleWidget extends WidgetType {
    constructor(icon, defaultTitle) {
      super();
      this.icon = icon;
      this.defaultTitle = defaultTitle;
    }
    eq(other) { return other.icon === this.icon && other.defaultTitle === this.defaultTitle; }
    toDOM() {
      const wrap = document.createElement('span');
      wrap.className = 'cm-lp-callout-head';
      wrap.appendChild(svgIcon(this.icon, 'cm-lp-callout-icon'));
      if (this.defaultTitle) wrap.appendChild(document.createTextNode(this.defaultTitle));
      return wrap;
    }
  }

  // The fold arrow at the end of a foldable callout's title
  class CalloutFoldWidget extends WidgetType {
    constructor(folded) {
      super();
      this.folded = folded;
    }
    eq(other) { return other.folded === this.folded; }
    toDOM(view) {
      const btn = document.createElement('span');
      btn.className = `cm-lp-callout-fold${this.folded ? ' is-folded' : ''}`;
      btn.title = this.folded ? 'Unfold' : 'Fold';
      btn.appendChild(svgIcon('chevron', 'cm-lp-callout-chevron'));
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const titleLine = view.state.doc.lineAt(view.posAtDOM(btn));
        view.dispatch({ annotations: FoldToggle.of(titleLine.from) });
      });
      return btn;
    }
    ignoreEvent() { return true; }
  }

  // Is this callout folded right now? "-" starts folded, "+" open; a click on the arrow flips it
  function isFolded(state, titleFrom, fold) {
    if (!fold) return false;
    const field = state.field(blockPreview, false);
    const flipped = field ? field.flipped.has(titleFrom) : false;
    return (fold === '-') !== flipped;
  }

  // ==================== LIVE PREVIEW ====================
  const hide = Decoration.replace({});
  const bullet = Decoration.replace({ widget: new BulletWidget() });
  const hr = Decoration.replace({ widget: new HrWidget() });
  const lineClass = (cls) => Decoration.line({ class: cls });
  const markClass = (cls) => Decoration.mark({ class: cls });

  const HEADING_LINES = {
    ATXHeading1: 'cm-lp-h1',
    ATXHeading2: 'cm-lp-h2',
    ATXHeading3: 'cm-lp-h3',
    ATXHeading4: 'cm-lp-h4',
    ATXHeading5: 'cm-lp-h4',
    ATXHeading6: 'cm-lp-h4',
  };

  const INLINE_MARKS = {
    StrongEmphasis: 'cm-lp-strong',
    Emphasis: 'cm-lp-em',
    Strikethrough: 'cm-lp-strike',
    InlineCode: 'cm-lp-code',
  };

  // Lines where the raw Markdown shows: only lines holding a blinking cursor.
  // While you drag a selection nothing is revealed, so the text doesn't jump under the mouse.
  function revealedLines(view) {
    const lines = new Set();
    if (!view.hasFocus) return lines;
    for (const range of view.state.selection.ranges) {
      if (range.empty) lines.add(view.state.doc.lineAt(range.head).number);
    }
    return lines;
  }

  // ```fenced code``` blocks: a panel like Obsidian's, fences hidden unless the cursor is inside
  function decorateCodeBlock(state, node, revealed, decos) {
    const doc = state.doc;
    const first = doc.lineAt(node.from).number;
    const last = doc.lineAt(node.to).number;
    const openMark = node.node.firstChild;
    const closeMark = node.node.lastChild;
    const hasClose = closeMark && closeMark.name === 'CodeMark' && doc.lineAt(closeMark.from).number > first;
    const bodyEnd = hasClose ? last - 1 : last;

    // A block inside "> " quotes: strip one "> " per quote level from what gets copied
    let quoteDepth = 0;
    for (let p = node.node.parent; p; p = p.parent) if (p.name === 'Blockquote') quoteDepth++;
    const quoteRe = new RegExp(`^(\\s*>\\s?){0,${quoteDepth}}`);
    const body = [];
    for (let n = first + 1; n <= bodyEnd; n++) body.push(doc.line(n).text.replace(quoteRe, ''));

    let editing = false;
    for (let n = first; n <= last; n++) if (revealed.has(n)) editing = true;

    for (let n = first; n <= last; n++) {
      const cls = ['cm-lp-codeblock'];
      if (n === first) cls.push('cm-lp-codeblock-begin');
      if (n === last) cls.push('cm-lp-codeblock-end');
      if (n === last && hasClose && !editing) cls.push('cm-lp-codeblock-fence');
      decos.push(lineClass(cls.join(' ')).range(doc.line(n).from));
    }

    const openLine = doc.line(first);
    if (!editing && openMark && openMark.name === 'CodeMark') {
      const info = node.node.getChild('CodeInfo');
      const lang = info ? state.sliceDoc(info.from, info.to) : '';
      decos.push(Decoration.replace({ widget: new CodeLangWidget(lang) }).range(openMark.from, openLine.to));
      if (hasClose) decos.push(hide.range(closeMark.from, closeMark.to));
    }
    decos.push(Decoration.widget({ widget: new CopyCodeWidget(body.join('\n')), side: 1 }).range(openLine.to));
  }

  // Math, tags and comments are not part of Markdown's syntax tree: they are found by pattern,
  // skipping anything inside code or a URL
  const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'URL', 'Autolink', 'HTMLBlock', 'CommentBlock']);
  function inCode(state, pos) {
    for (let n = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
      if (CODE_NODES.has(n.name)) return true;
    }
    return false;
  }

  const DISPLAY_MATH_RE = /^[ \t]*\$\$([\s\S]+?)\$\$[ \t]*$/gm;
  const INLINE_MATH_RE = /(?<![\\$])\$(?=[^\s$])([^$\n]+?)(?<=[^\s$])\$(?![\d$])/g;
  const COMMENT_RE = /%%[\s\S]*?%%/g;
  const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
  const WIKI_RE = /\[\[([^\]\n|#]*)(#[^\]\n|]*)?(?:\|([^\]\n]+))?\]\]/g;

  // Lines the cursor is on, for blocks (state only: no view here)
  function blockRevealed(state, focused, from, to) {
    if (!focused) return false;
    return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  }

  // Tables and $$display math$$ replace whole lines, which only a state field may do
  function buildBlocks(state, focused, flipped) {
    const decos = [];
    const doc = state.doc;
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name === 'Blockquote') {
          // A folded callout shows only its title (the body comes back if the cursor gets into it)
          const title = doc.lineAt(node.from);
          const callout = parseCallout(title.text);
          if (!callout || !callout.fold) return undefined;
          const folded = (callout.fold === '-') !== flipped.has(title.from);
          const last = doc.lineAt(node.to);
          if (folded && last.number > title.number) {
            const bodyFrom = doc.line(title.number + 1).from;
            if (!blockRevealed(state, focused, bodyFrom, last.to)) {
              decos.push(Decoration.replace({ block: true }).range(bodyFrom, last.to));
            }
          }
          return undefined;
        }
        if (node.name === 'Table') {
          const from = doc.lineAt(node.from).from;
          const to = doc.lineAt(node.to).to;
          if (!blockRevealed(state, focused, from, to)) {
            decos.push(Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to)), block: true }).range(from, to));
          }
          return false;
        }
        if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
        return undefined;
      },
    });
    const text = doc.toString();
    for (const m of text.matchAll(DISPLAY_MATH_RE)) {
      const from = m.index;
      const to = m.index + m[0].length;
      if (inCode(state, from) || blockRevealed(state, focused, from, to)) continue;
      decos.push(Decoration.replace({ widget: new MathWidget(m[1].trim(), true), block: true }).range(from, to));
    }
    return Decoration.set(decos, true);
  }

  const blockPreview = StateField.define({
    create: (state) => ({ focused: false, flipped: new Set(), decos: buildBlocks(state, false, new Set()) }),
    update(value, tr) {
      const focus = tr.annotation(FocusChange);
      const toggle = tr.annotation(FoldToggle);
      const focused = focus === undefined ? value.focused : focus;
      if (
        focus === undefined &&
        toggle === undefined &&
        !tr.docChanged &&
        !tr.selection &&
        syntaxTree(tr.startState) === syntaxTree(tr.state)
      ) {
        return value;
      }
      // Fold choices follow their callout when text is added above it
      let flipped = value.flipped;
      if (tr.docChanged) flipped = new Set([...flipped].map((pos) => tr.changes.mapPos(pos)));
      if (toggle !== undefined) {
        flipped = new Set(flipped);
        if (flipped.has(toggle)) flipped.delete(toggle);
        else flipped.add(toggle);
      }
      return { focused, flipped, decos: buildBlocks(tr.state, focused, flipped) };
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decos),
  });

  // Display math ranges, so inline math, tags and comments inside them are left alone
  function displayMathRanges(text) {
    return [...text.matchAll(DISPLAY_MATH_RE)].map((m) => [m.index, m.index + m[0].length]);
  }

  // Links, tags, comments, inline math and wikilinks in the visible part of the note
  function decoratePatterns(view, revealed, decos) {
    const { state } = view;
    const isHidden = (pos) => !revealed.has(state.doc.lineAt(pos).number);
    const text = state.doc.toString();
    const display = displayMathRanges(text);
    const inDisplay = (pos) => display.some(([a, b]) => pos >= a && pos < b);
    const skip = (pos) => inDisplay(pos) || inCode(state, pos);

    // %% comments %% can span lines, so they are searched in the whole note
    for (const m of text.matchAll(COMMENT_RE)) {
      const from = m.index;
      const to = from + m[0].length;
      if (skip(from)) continue;
      decos.push(markClass('cm-lp-comment').range(from, to));
      if (isHidden(from)) decos.push(hide.range(from, from + 2));
      if (isHidden(to - 2)) decos.push(hide.range(to - 2, to));
    }

    for (const { from, to } of view.visibleRanges) {
      const slice = state.sliceDoc(from, to);

      for (const m of slice.matchAll(INLINE_MATH_RE)) {
        const start = from + m.index;
        const end = start + m[0].length;
        if (skip(start)) continue;
        if (isHidden(start)) decos.push(Decoration.replace({ widget: new MathWidget(m[1], false) }).range(start, end));
        else decos.push(markClass('cm-lp-math-src').range(start, end));
      }

      for (const m of slice.matchAll(TAG_RE)) {
        const start = from + m.index + m[1].length;
        const end = start + 1 + m[2].length;
        if (skip(start)) continue;
        decos.push(Decoration.mark({ class: 'cm-lp-tag', attributes: { 'data-tag': m[2] } }).range(start, end));
      }

      // [[Note]], [[Note#Heading]], [[Note|alias]]: brackets (and "Note|") hidden off the cursor line
      for (const m of slice.matchAll(WIKI_RE)) {
        const start = from + m.index;
        const end = start + m[0].length;
        if (skip(start)) continue;
        const target = (m[1] + (m[2] || '')).trim();
        const textFrom = m[3] ? end - 2 - m[3].length : start + 2;
        decos.push(Decoration.mark({ class: 'cm-lp-wikilink', attributes: { 'data-wikilink': target } }).range(textFrom, end - 2));
        if (isHidden(start)) {
          decos.push(hide.range(start, textFrom));
          decos.push(hide.range(end - 2, end));
        }
      }
    }
  }

  // A callout: colored panel lines, the icon in place of "> [!type]± ", a fold arrow if it has + or -
  function decorateCallout(state, node, title, callout, titleHidden, decos) {
    const doc = state.doc;
    const last = doc.lineAt(node.to);
    const folded = isFolded(state, title.from, callout.fold);
    const color = `cm-lp-callout-${callout.type.color}`;
    for (let n = title.number; n <= last.number; n++) {
      const cls = ['cm-lp-callout', color];
      if (n === title.number) cls.push('cm-lp-callout-title');
      if (n === last.number || (n === title.number && folded)) cls.push('cm-lp-callout-end');
      decos.push(lineClass(cls.join(' ')).range(doc.line(n).from));
    }
    if (titleHidden) {
      const name = callout.rawType;
      const defaultTitle = callout.title.trim() ? '' : name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
      decos.push(
        Decoration.replace({ widget: new CalloutTitleWidget(callout.type.icon, defaultTitle) }).range(title.from, title.from + callout.prefixLength)
      );
    }
    if (callout.fold) {
      decos.push(Decoration.widget({ widget: new CalloutFoldWidget(folded), side: 1 }).range(title.to));
    }
  }

  function buildDecorations(view) {
    const { state } = view;
    const decos = [];
    const revealed = revealedLines(view);
    const isHidden = (pos) => !revealed.has(state.doc.lineAt(pos).number);
    const hideRange = (from, to) => {
      if (to > from) decos.push(hide.range(from, to));
    };
    // Include the space after a mark ("# ", "> ")
    const withSpace = (to) => (state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to);
    const codeBlocks = new Set(); // a block crossing two visible ranges is decorated once
    const calloutTitles = new Set();

    for (const { from, to } of view.visibleRanges) {
      syntaxTree(state).iterate({
        from,
        to,
        enter: (node) => {
          const name = node.name;

          if (HEADING_LINES[name]) {
            decos.push(lineClass(HEADING_LINES[name]).range(state.doc.lineAt(node.from).from));
          } else if (INLINE_MARKS[name]) {
            if (node.to > node.from) decos.push(markClass(INLINE_MARKS[name]).range(node.from, node.to));
          } else if (name === 'FencedCode') {
            if (!codeBlocks.has(node.from)) {
              codeBlocks.add(node.from);
              decorateCodeBlock(state, node, revealed, decos);
            }
          } else if (name === 'Blockquote') {
            const title = state.doc.lineAt(node.from);
            const callout = node.node.parent?.name === 'Blockquote' ? null : parseCallout(title.text);
            if (callout) {
              // A folded body splits the visible ranges, so the same callout can come up twice
              if (!calloutTitles.has(title.from)) {
                decorateCallout(state, node, title, callout, isHidden(title.from), decos);
                calloutTitles.add(title.from);
              }
            } else {
              for (let pos = node.from; pos <= node.to; ) {
                const line = state.doc.lineAt(pos);
                decos.push(lineClass('cm-lp-quote').range(line.from));
                pos = line.to + 1;
              }
            }
          } else if (name === 'HeaderMark') {
            if (isHidden(node.from)) hideRange(node.from, withSpace(node.to));
          } else if (name === 'QuoteMark') {
            // On a callout's title line the whole "> [!type] " is already swapped for the icon
            if (isHidden(node.from) && !calloutTitles.has(state.doc.lineAt(node.from).from)) {
              hideRange(node.from, withSpace(node.to));
            }
          } else if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
            if (isHidden(node.from)) hideRange(node.from, node.to);
          } else if (name === 'CodeMark') {
            if (node.node.parent?.name === 'InlineCode' && isHidden(node.from)) hideRange(node.from, node.to);
          } else if (name === 'ListMark') {
            const next = node.node.nextSibling;
            const listType = node.node.parent?.parent?.name;
            if (next && next.name === 'Task') {
              // "- [ ] task": hide the "- " and let the checkbox stand in
              if (isHidden(node.from)) hideRange(node.from, next.from);
            } else if (listType === 'BulletList') {
              if (isHidden(node.from)) decos.push(bullet.range(node.from, node.to));
            } else {
              decos.push(markClass('cm-lp-num').range(node.from, node.to));
            }
          } else if (name === 'TaskMarker') {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to));
            const taskEnd = node.node.parent ? node.node.parent.to : node.to;
            if (checked && taskEnd > node.to) {
              decos.push(markClass('cm-lp-done').range(node.to, taskEnd));
            }
            if (isHidden(node.from)) {
              decos.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to));
            }
          } else if (name === 'HorizontalRule') {
            if (isHidden(node.from)) decos.push(hr.range(node.from, node.to));
          } else if (name === 'Link') {
            // [text](url): only the text shows, in the link color, and a click opens the url
            const marks = node.node.getChildren('LinkMark');
            const url = node.node.getChild('URL');
            if (!url || marks.length < 2) return;
            const href = state.sliceDoc(url.from, url.to);
            const textFrom = marks[0].to;
            const textTo = marks[1].from;
            if (textTo > textFrom) {
              decos.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-href': href } }).range(textFrom, textTo));
            }
            if (isHidden(node.from)) {
              hideRange(node.from, textFrom);
              hideRange(textTo, node.to);
            }
            return false;
          } else if (name === 'Image') {
            return false; // ![image](…) stays as text
          } else if (name === 'Autolink') {
            // <https://…>: hide the angle brackets
            const url = node.node.getChild('URL');
            if (!url) return false;
            decos.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-href': state.sliceDoc(url.from, url.to) } }).range(url.from, url.to));
            if (isHidden(node.from)) {
              hideRange(node.from, url.from);
              hideRange(url.to, node.to);
            }
            return false;
          } else if (name === 'URL') {
            // A bare https://… link in the text
            decos.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-href': state.sliceDoc(node.from, node.to) } }).range(node.from, node.to));
          }
        },
      });

    }

    decoratePatterns(view, revealed, decos);
    return Decoration.set(decos, true);
  }

  const livePreview = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view);
      }
      update(u) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          u.focusChanged ||
          u.transactions.some((tr) => tr.annotation(FoldToggle) !== undefined) ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        ) {
          this.decorations = buildDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );

  // ==================== EDITOR LOOK ====================
  const editorTheme = EditorView.theme(
    {
      '&': { height: '100%', color: 'var(--text-main)', backgroundColor: 'transparent', fontSize: '13.5px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.6' },
      '.cm-content': { padding: '10px 0 28px', caretColor: 'var(--text-main)' },
      '.cm-line': { padding: '0 14px' },
      '.cm-cursor, .cm-dropCursor': { borderLeft: '1.5px solid var(--text-main)' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: 'var(--selection)' },
      '.cm-placeholder': { color: 'var(--text-dim)' },
    },
    { dark: true }
  );

  // ==================== TOOLBAR FORMATTING ====================
  function timeStamp() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  // Line-level toggles (heading, task, bullet)
  function formatLine(text, action) {
    switch (action) {
      case 'h1':
        return text.startsWith('# ') ? text.slice(2) : `# ${text.replace(/^#+\s*/, '')}`;
      case 'h2':
        return text.startsWith('## ') ? text.slice(3) : `## ${text.replace(/^#+\s*/, '')}`;
      case 'task':
        return /^\s*-\s*\[[ xX]\]\s*/.test(text)
          ? text.replace(/^\s*-\s*\[[ xX]\]\s*/, '')
          : `- [ ] ${text.replace(/^\s*[-*]\s+/, '')}`;
      case 'bullet':
        return /^\s*[-*]\s+/.test(text) ? text.replace(/^\s*[-*]\s+/, '') : `- ${text}`;
      default:
        return text;
    }
  }

  function applyFormat(view, action) {
    const { state } = view;

    if (['h1', 'h2', 'task', 'bullet'].includes(action)) {
      const changes = [];
      const seen = new Set();
      for (const range of state.selection.ranges) {
        const first = state.doc.lineAt(range.from).number;
        const last = state.doc.lineAt(range.to).number;
        for (let n = first; n <= last; n++) {
          if (seen.has(n)) continue;
          seen.add(n);
          const line = state.doc.line(n);
          const next = formatLine(line.text, action);
          if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
        }
      }
      if (changes.length) view.dispatch({ changes });
    } else if (action === 'bold' || action === 'italic') {
      const mark = action === 'bold' ? '**' : '*';
      view.dispatch(
        state.changeByRange((range) =>
          range.empty
            ? {
                changes: { from: range.from, insert: mark + mark },
                range: EditorSelection.cursor(range.from + mark.length),
              }
            : {
                changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
                range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
              }
        )
      );
    } else if (action === 'time') {
      view.dispatch(state.replaceSelection(`**${timeStamp()}** — `));
    } else if (action === 'divider') {
      const line = state.doc.lineAt(state.selection.main.head);
      // A blank line before "---" keeps it from turning the text above into a heading
      const insert = line.text.trim() ? '\n\n---\n' : '---\n';
      const from = line.text.trim() ? line.to : line.from;
      view.dispatch({
        changes: { from, to: line.to, insert },
        selection: EditorSelection.cursor(from + insert.length),
      });
    }

    view.focus();
  }

  // ==================== PUBLIC API ====================
  // A click on a link, wikilink or tag opens it (on the cursor line, Ctrl+click: plain clicks edit there).
  // A click on a table or math block puts the cursor in it.
  function linkClicks(onOpenLink) {
    return EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0) return false;
        const el = e.target.closest('[data-href], [data-wikilink], [data-tag]');
        const block = e.target.closest('.cm-lp-table-wrap, .cm-lp-math-block');
        // A click on a table or a math block (not on a link in it) opens its Markdown for editing
        if (block && !el && view.contentDOM.contains(block)) {
          e.preventDefault();
          view.focus();
          view.dispatch({ selection: EditorSelection.cursor(view.posAtDOM(block)), annotations: FocusChange.of(true) });
          return true;
        }
        if (!el || !view.contentDOM.contains(el)) return false;
        const inTable = el.closest('.cm-lp-table-wrap');
        if (!inTable) {
          const line = view.state.doc.lineAt(view.posAtDOM(el)).number;
          if (!e.ctrlKey && revealedLines(view).has(line)) return false;
        }
        e.preventDefault();
        if (el.dataset.href) onOpenLink('url', el.dataset.href);
        else if (el.dataset.wikilink) onOpenLink('note', el.dataset.wikilink);
        else onOpenLink('tag', el.dataset.tag);
        return true;
      },
      focus: (_e, view) => { setTimeout(() => view.dispatch({ annotations: FocusChange.of(true) })); },
      blur: (_e, view) => { setTimeout(() => view.dispatch({ annotations: FocusChange.of(false) })); },
    });
  }

  function createEditor(parent, { onChange, onEscape, onOpenLink = () => {} }) {
    const preview = new Compartment();
    const previewOn = [livePreview, blockPreview];
    const undoHistory = new Compartment();
    let mode = 'normal';

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '',
        extensions: [
          undoHistory.of(history()),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }), // includes smart Enter for lists & tasks
          placeholder('Start writing… it saves to your .md file.'),
          EditorView.contentAttributes.of({ spellcheck: 'true' }),
          editorTheme,
          keymap.of([
            { key: 'Escape', run: () => { onEscape(); return true; } },
            { key: 'Mod-b', run: (v) => { applyFormat(v, 'bold'); return true; } },
            { key: 'Mod-i', run: (v) => { applyFormat(v, 'italic'); return true; } },
            indentWithTab,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          preview.of(previewOn),
          linkClicks(onOpenLink),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) onChange();
          }),
        ],
      }),
    });

    return {
      getContent: () => view.state.doc.toString(),

      // Applies only the part that changed, so the cursor and scroll stay put
      setContent(text) {
        const next = (text || '').replace(/\r\n/g, '\n');
        const cur = view.state.doc.toString();
        if (next === cur) return;
        let start = 0;
        while (start < cur.length && start < next.length && cur[start] === next[start]) start++;
        let endCur = cur.length;
        let endNext = next.length;
        while (endCur > start && endNext > start && cur[endCur - 1] === next[endNext - 1]) {
          endCur--;
          endNext--;
        }
        view.dispatch({
          changes: { from: start, to: endCur, insert: next.slice(start, endNext) },
          annotations: [External.of(true), Transaction.addToHistory.of(false)],
        });
      },

      // A different note: fresh undo history (Ctrl+Z must not bring back the old note), back to the top
      loadDocument(text) {
        this.setContent(text);
        view.dispatch({ effects: undoHistory.reconfigure([]) });
        view.dispatch({ effects: undoHistory.reconfigure(history()), selection: EditorSelection.cursor(0) });
        view.scrollDOM.scrollTop = 0;
      },

      hasFocus: () => view.hasFocus,
      focus: () => view.focus(),

      focusEnd() {
        view.focus();
        view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length), scrollIntoView: true });
      },

      format: (action) => applyFormat(view, action),

      // Normal <-> Origin: same document, preview on/off, the line at the top of the view stays there
      setMode(nextMode) {
        if (nextMode === mode) return;
        mode = nextMode;
        const pad = view.documentPadding.top;
        const scrollTop = view.scrollDOM.scrollTop;
        const anchor = view.lineBlockAtHeight(scrollTop - pad);
        // Where the anchor line sits on screen right now (real pixels, not estimates)
        const screenTop = (pos) => {
          const coords = view.coordsAtPos(pos, 1);
          return coords ? coords.top - view.scrollDOM.getBoundingClientRect().top : null;
        };
        const before = screenTop(anchor.from);
        const offset = before !== null ? -before : scrollTop - pad - anchor.top;

        parent.classList.toggle('is-origin', mode === 'origin');
        view.dispatch({ effects: preview.reconfigure(mode === 'origin' ? [] : previewOn) });

        // Line heights change between modes, so once layout settles, measure where the anchor
        // line really is on screen and nudge the scroll until it sits exactly where it was.
        // (Runs outside CodeMirror's measure cycle, where its own scroll anchoring would undo it.)
        let tries = 0;
        const settle = () => {
          const now = screenTop(anchor.from);
          if (now === null) {
            view.scrollDOM.scrollTop = view.lineBlockAt(anchor.from).top + pad + offset;
          } else {
            const delta = now + offset;
            if (Math.abs(delta) < 1) return;
            view.scrollDOM.scrollTop += delta;
          }
          if (++tries < 6) setTimeout(settle, 16);
        };
        setTimeout(settle, 0);
      },
    };
  }

  window.MarkdownHelper = { createEditor };
})();

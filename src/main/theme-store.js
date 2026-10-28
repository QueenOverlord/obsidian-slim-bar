/**
 * Theme Store — your own themes, one .css file each in <userData>/themes/.
 * A file only needs color variables: the 12 basics (--bg, --text, --accent, --h1 …) or any full
 * token from styles.css (--bg-elevated, --md-quote, --selection …). Everything else in the file
 * (comments, selectors, ":root { }") is ignored, so a snippet copied from elsewhere works too.
 * Only color values are read, so a file can't break the layout.
 */
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

const BASIC_KEYS = ['bg', 'text', 'accent', 'h1', 'h2', 'h3', 'bold', 'italic', 'link', 'code', 'bullet', 'done'];
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([^()]*\)|transparent)$/i;
const VAR_RE = /--([a-z0-9-]+)\s*:\s*([^;{}]+?)\s*(?:;|(?=\}))/gi;
const NAME_RE = /\/\*\s*Theme:\s*(.+?)\s*\*\//i;

const HEADER = `/* Obsidian Slim Bar theme. Change any color and save: the bar updates right away.
   The 12 basics are enough. You can also set any full token, like --bg-elevated or --md-quote. */`;

function slug(name) {
  return (
    String(name || '')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 60) || 'My theme'
  );
}

class ThemeStore {
  constructor(onChange) {
    this.dir = path.join(app.getPath('userData'), 'themes');
    fs.mkdirSync(this.dir, { recursive: true });
    this.onChange = onChange;
    this.watcher = null;
    this.watchTimer = null;
    this._watch();
  }

  // Only a plain "Name.css" inside the themes folder is accepted
  _file(id) {
    if (typeof id !== 'string' || !id.endsWith('.css') || id !== path.basename(id)) return null;
    return path.join(this.dir, id);
  }

  _uniqueId(name) {
    const base = slug(name);
    let id = `${base}.css`;
    for (let n = 2; fs.existsSync(path.join(this.dir, id)); n++) id = `${base} ${n}.css`;
    return id;
  }

  parse(id) {
    const text = fs.readFileSync(this._file(id), 'utf-8');
    const nameMatch = text.match(NAME_RE);
    const vars = {};
    const skipped = [];
    for (const m of text.matchAll(VAR_RE)) {
      if (COLOR_RE.test(m[2])) vars[m[1].toLowerCase()] = m[2];
      else skipped.push(`--${m[1]}`);
    }
    return { id, name: nameMatch ? nameMatch[1] : id.replace(/\.css$/, ''), vars, skipped };
  }

  list() {
    let files = [];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.toLowerCase().endsWith('.css'));
    } catch {
      return [];
    }
    return files
      .map((id) => {
        try {
          return this.parse(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  create(name, colors) {
    const id = this._uniqueId(name);
    const lines = BASIC_KEYS.filter((k) => colors && colors[k]).map((k) => `  --${k}: ${colors[k]};`);
    const text = `/* Theme: ${slug(name)} */\n${HEADER}\n:root {\n${lines.join('\n')}\n}\n`;
    fs.writeFileSync(path.join(this.dir, id), text, 'utf-8');
    return { ok: true, id };
  }

  // Changes colors in place, so your own comments and extra tokens stay as they are
  save(id, colors) {
    const file = this._file(id);
    if (!file || !fs.existsSync(file)) return { ok: false, error: 'Theme file not found' };
    let text = fs.readFileSync(file, 'utf-8');
    const missing = [];
    for (const [key, value] of Object.entries(colors || {})) {
      if (!/^[a-z0-9-]+$/i.test(key) || !COLOR_RE.test(String(value))) continue;
      const re = new RegExp(`(--${key}\\s*:\\s*)[^;{}]+?(\\s*(?:;|(?=\\})))`, 'i');
      if (re.test(text)) text = text.replace(re, `$1${value}$2`);
      else missing.push(`  --${key}: ${value};`);
    }
    if (missing.length) {
      const close = text.lastIndexOf('}');
      text = close === -1
        ? `${text.trimEnd()}\n${missing.join('\n')}\n`
        : `${text.slice(0, close).trimEnd()}\n${missing.join('\n')}\n${text.slice(close)}`;
    }
    fs.writeFileSync(file, text, 'utf-8');
    return { ok: true, id };
  }

  rename(id, name) {
    const file = this._file(id);
    if (!file || !fs.existsSync(file)) return { ok: false, error: 'Theme file not found' };
    const clean = slug(name);
    let text = fs.readFileSync(file, 'utf-8');
    text = NAME_RE.test(text) ? text.replace(NAME_RE, `/* Theme: ${clean} */`) : `/* Theme: ${clean} */\n${text}`;
    const next = `${clean}.css`.toLowerCase() === id.toLowerCase() ? id : this._uniqueId(clean);
    fs.writeFileSync(file, text, 'utf-8');
    if (next !== id) fs.renameSync(file, path.join(this.dir, next));
    return { ok: true, id: next };
  }

  duplicate(id) {
    const file = this._file(id);
    if (!file || !fs.existsSync(file)) return { ok: false, error: 'Theme file not found' };
    const name = `${this.parse(id).name} copy`;
    const next = this._uniqueId(name);
    let text = fs.readFileSync(file, 'utf-8');
    text = NAME_RE.test(text) ? text.replace(NAME_RE, `/* Theme: ${name} */`) : `/* Theme: ${name} */\n${text}`;
    fs.writeFileSync(path.join(this.dir, next), text, 'utf-8');
    return { ok: true, id: next };
  }

  // Goes to the Recycle Bin, so a deleted theme can still be brought back
  async remove(id) {
    const file = this._file(id);
    if (!file || !fs.existsSync(file)) return { ok: false, error: 'Theme file not found' };
    await shell.trashItem(file);
    return { ok: true };
  }

  openFolder() {
    return shell.openPath(this.dir);
  }

  // Saving a file in any editor updates the bar
  _watch() {
    try {
      this.watcher = fs.watch(this.dir, () => {
        clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => this.onChange(), 150);
      });
    } catch (err) {
      console.error('[ThemeStore] Cannot watch the themes folder:', err.message);
    }
  }

  dispose() {
    clearTimeout(this.watchTimer);
    if (this.watcher) this.watcher.close();
  }
}

module.exports = { ThemeStore, BASIC_KEYS };

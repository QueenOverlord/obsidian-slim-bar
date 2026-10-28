/**
 * Theme Manager — picks the active token block in styles.css via <html data-theme="…">.
 * 1. Built-in themes: Dark, Light, Dracula, Solarized Light, DedSec, Cyberpunk 2077, Akira ("system" = Auto, follows Windows)
 * 2. Your own themes ("user:<file>.css"): the file's 12 basic colors become --c-* variables that the
 *    [data-theme="custom"] block mixes the surfaces from; any full token in the file (--bg-elevated …) wins over the mix.
 */
(() => {
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  // The 12 basic colors of a personal theme, and the full token each one stands for
  const CUSTOM_FIELDS = [
    { key: 'bg', label: 'Background', token: '--bg-primary' },
    { key: 'text', label: 'Text', token: '--text-main' },
    { key: 'accent', label: 'Accent', token: '--accent' },
    { key: 'h1', label: 'Heading 1', token: '--md-h1' },
    { key: 'h2', label: 'Heading 2', token: '--md-h2' },
    { key: 'h3', label: 'Heading 3', token: '--md-h3' },
    { key: 'bold', label: 'Bold', token: '--md-bold' },
    { key: 'italic', label: 'Italic', token: '--md-italic' },
    { key: 'link', label: 'Links', token: '--md-link' },
    { key: 'code', label: 'Code', token: '--md-code' },
    { key: 'bullet', label: 'Bullets', token: '--md-bullet' },
    { key: 'done', label: 'Done tasks', token: '--md-done' },
  ];

  const THEMES = ['system', 'dark', 'light', 'dracula', 'solarized-light', 'dedsec', 'cyberpunk', 'akira'];

  let current = { theme: 'system', userThemes: [] };

  // "#abc", "abc", "#aabbcc", "aabbcc" -> "#aabbcc"; anything else -> null
  function normalizeHex(value) {
    const raw = String(value || '').trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.split('').map((c) => c + c).join('')}`;
    if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
    return null;
  }

  function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function resolve(theme) {
    if (theme === 'system' || !THEMES.includes(theme)) return systemDark.matches ? 'dark' : 'light';
    return theme;
  }

  // Any CSS color ("rgb(…)", "hsl(…)", "#abc") -> "#rrggbb", read back through the browser
  const colorProbe = document.createElement('span');
  function toHex(value) {
    const hex = normalizeHex(value);
    if (hex) return hex;
    colorProbe.style.color = '';
    colorProbe.style.color = String(value || '');
    if (!colorProbe.style.color) return null;
    document.body.appendChild(colorProbe);
    const rgb = getComputedStyle(colorProbe).color.match(/\d+(\.\d+)?/g);
    colorProbe.remove();
    return rgb ? `#${rgb.slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, '0')).join('')}` : null;
  }

  // Reads a built-in theme's colors, to start a new personal theme from it
  function readTheme(theme) {
    const probe = document.createElement('div');
    probe.dataset.theme = resolve(theme);
    probe.hidden = true;
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const colors = {};
    CUSTOM_FIELDS.forEach(({ key, token }) => {
      colors[key] = normalizeHex(style.getPropertyValue(token)) || '#888888';
    });
    probe.remove();
    return colors;
  }

  // A personal theme's 12 basic colors as hex: from "--bg", or the full token ("--bg-primary"),
  // or else from Dark / Light (whichever matches its background)
  function colorsOf(userTheme) {
    const vars = (userTheme && userTheme.vars) || {};
    const pick = ({ key, token }) => toHex(vars[key]) || toHex(vars[token.slice(2)]);
    const bg = pick(CUSTOM_FIELDS[0]);
    const base = readTheme(bg && luminance(bg) > 0.4 ? 'light' : 'dark');
    const colors = {};
    CUSTOM_FIELDS.forEach((field) => {
      colors[field.key] = pick(field) || base[field.key];
    });
    return colors;
  }

  // Paints a personal theme on an element: <html> for the whole app, or one swatch preview
  function paint(el, userTheme) {
    (el._themeProps || []).forEach((prop) => el.style.removeProperty(prop));
    const props = [];
    const set = (prop, value) => {
      el.style.setProperty(prop, value);
      props.push(prop);
    };
    const colors = colorsOf(userTheme);
    CUSTOM_FIELDS.forEach(({ key }) => set(`--c-${key}`, colors[key]));
    set('--c-on-accent', luminance(colors.accent) > 0.45 ? '#16161e' : '#ffffff');
    // Full tokens from the file win over the colors mixed from the basics
    const basics = new Set(CUSTOM_FIELDS.map(({ key }) => key));
    Object.entries(userTheme.vars || {}).forEach(([name, value]) => {
      if (!basics.has(name)) set(`--${name}`, value);
    });
    el._themeProps = props;
    el.dataset.theme = 'custom';
    el.dataset.scheme = luminance(colors.bg) > 0.4 ? 'light' : 'dark';
  }

  function findUserTheme(theme, userThemes) {
    if (!String(theme).startsWith('user:')) return null;
    return (userThemes || []).find((t) => `user:${t.id}` === theme) || null;
  }

  function apply(theme, userThemes) {
    current = { theme: theme || 'system', userThemes: userThemes || [] };
    const userTheme = findUserTheme(current.theme, current.userThemes);
    if (userTheme) {
      paint(root, userTheme);
    } else {
      (root._themeProps || []).forEach((prop) => root.style.removeProperty(prop));
      root._themeProps = [];
      delete root.dataset.scheme;
      root.dataset.theme = resolve(current.theme);
    }
    // After the first theme is painted, turn color fades back on
    if (root.classList.contains('theme-loading')) {
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-loading')));
    }
  }

  // Auto: follow Windows when it switches between light and dark
  systemDark.addEventListener('change', () => {
    if (current.theme === 'system') apply(current.theme, current.userThemes);
  });

  /**
   * Builds the Custom editor rows: label + color picker + hex box.
   * onChange(key, hex) fires for every valid color (typed, pasted or picked).
   */
  function buildCustomEditor(container, onChange) {
    const rows = {};
    CUSTOM_FIELDS.forEach(({ key, label }) => {
      const row = document.createElement('div');
      row.className = 'color-field';

      const id = `custom-color-${key}`;
      const name = document.createElement('label');
      name.htmlFor = id;
      name.textContent = label;

      const picker = document.createElement('input');
      picker.type = 'color';
      picker.title = `Pick ${label.toLowerCase()} color`;

      const hexInput = document.createElement('input');
      hexInput.type = 'text';
      hexInput.id = id;
      hexInput.className = 'hex-input';
      hexInput.spellcheck = false;
      hexInput.maxLength = 7;
      hexInput.placeholder = '#rrggbb';

      picker.addEventListener('input', () => {
        hexInput.value = picker.value;
        hexInput.classList.remove('invalid');
        onChange(key, picker.value);
      });

      hexInput.addEventListener('input', () => {
        const hex = normalizeHex(hexInput.value);
        hexInput.classList.toggle('invalid', !hex && hexInput.value.trim() !== '');
        if (!hex) return;
        picker.value = hex;
        onChange(key, hex);
      });

      // Leaving the box tidies it to "#rrggbb", or puts back the last good color
      hexInput.addEventListener('blur', () => {
        hexInput.value = picker.value;
        hexInput.classList.remove('invalid');
      });

      row.append(name, picker, hexInput);
      container.appendChild(row);
      rows[key] = { picker, hexInput };
    });

    return {
      setValues(custom) {
        CUSTOM_FIELDS.forEach(({ key }) => {
          const hex = normalizeHex(custom && custom[key]);
          if (!hex) return;
          rows[key].picker.value = hex;
          if (document.activeElement !== rows[key].hexInput) rows[key].hexInput.value = hex;
        });
      },
    };
  }

  window.ThemeManager = {
    apply,
    paint,
    colorsOf,
    findUserTheme,
    readTheme,
    resolve,
    normalizeHex,
    buildCustomEditor,
    fields: CUSTOM_FIELDS,
    isLightCustom: () => root.dataset.scheme === 'light',
  };
})();

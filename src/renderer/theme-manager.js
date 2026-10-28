/**
 * Theme Manager — picks the active token block in styles.css via <html data-theme="…">.
 * 1. Built-in themes: Dark, Light, Dracula, Solarized Light, Akira × DedSec ("system" = Auto, follows Windows)
 * 2. Custom theme: the user's hex colors become --c-* variables that the [data-theme="custom"] block mixes from
 */
(() => {
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  // Editable colors of the Custom theme, and the token each one is seeded from
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

  const THEMES = ['system', 'dark', 'light', 'dracula', 'solarized-light', 'dedsec', 'custom'];

  let current = { theme: 'system', custom: null };

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
    if (theme === 'system') return systemDark.matches ? 'dark' : 'light';
    return THEMES.includes(theme) ? theme : 'dark';
  }

  // Reads a built-in theme's colors, to seed the Custom theme from it
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

  // Custom colors live on <html> even when another theme is active, so the Custom swatch previews them
  function applyCustomColors(custom) {
    if (!custom) return;
    CUSTOM_FIELDS.forEach(({ key }) => {
      const hex = normalizeHex(custom[key]);
      if (hex) root.style.setProperty(`--c-${key}`, hex);
    });
    const bg = normalizeHex(custom.bg) || '#16161e';
    const accent = normalizeHex(custom.accent) || '#7c3aed';
    root.style.setProperty('--c-on-accent', luminance(accent) > 0.45 ? '#16161e' : '#ffffff');
    root.dataset.scheme = luminance(bg) > 0.4 ? 'light' : 'dark';
  }

  function apply(theme, custom) {
    current = { theme: THEMES.includes(theme) ? theme : 'system', custom: custom || null };
    // Before any custom colors are saved, the Custom swatch previews the Dark theme
    applyCustomColors(current.custom || readTheme('dark'));
    root.dataset.theme = resolve(current.theme);
    // After the first theme is painted, turn color fades back on
    if (root.classList.contains('theme-loading')) {
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-loading')));
    }
  }

  // Auto: follow Windows when it switches between light and dark
  systemDark.addEventListener('change', () => {
    if (current.theme === 'system') apply(current.theme, current.custom);
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
    readTheme,
    resolve,
    normalizeHex,
    buildCustomEditor,
    isLightCustom: () => root.dataset.scheme === 'light',
  };
})();

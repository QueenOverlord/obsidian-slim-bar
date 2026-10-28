(() => {
  const api = window.slimBarAPI;
  const mdHelper = window.MarkdownHelper;
  const themes = window.ThemeManager;

  // DOM Elements — Slim Bar Header
  const body = document.body;
  const appShell = document.getElementById('app-shell');
  const btnNoteBadge = document.getElementById('btn-note-badge');
  const vaultStatusDot = document.getElementById('vault-status-dot');
  const activeNoteNameEl = document.getElementById('active-note-name');
  const quickCaptureInput = document.getElementById('quick-capture-input');

  const btnPin = document.getElementById('btn-pin');
  const btnExpand = document.getElementById('btn-expand');
  const btnOpenObsidian = document.getElementById('btn-open-obsidian');
  const btnSettings = document.getElementById('btn-settings');
  const btnHide = document.getElementById('btn-hide');
  const slimBar = document.getElementById('slim-bar');
  const btnOverflow = document.getElementById('btn-overflow');
  const btnMdMore = document.getElementById('btn-md-more');
  const mdMoreMenu = document.getElementById('md-more-menu');

  // DOM Elements — Note switcher (favorites dropdown under the note pill)
  const noteMenu = document.getElementById('note-menu');
  const noteMenuList = document.getElementById('note-menu-list');
  const noteMenuEmpty = document.getElementById('note-menu-empty');
  const noteMenuError = document.getElementById('note-menu-error');
  const btnFavAddCurrent = document.getElementById('btn-fav-add-current');
  const btnFavBrowse = document.getElementById('btn-fav-browse');

  // DOM Elements — Visual Setup Panel
  const setupPanel = document.getElementById('setup-panel');
  const btnCloseSetup = document.getElementById('btn-close-setup');
  const inputNotePath = document.getElementById('input-note-path');
  const btnBrowseNote = document.getElementById('btn-browse-note');
  const pathErrorMsg = document.getElementById('path-error-msg');

  const hotkeyBoxes = document.querySelectorAll('[data-hotkey]');
  const hotkeyResetButtons = document.querySelectorAll('[data-hotkey-reset]');

  const themeSwatches = document.querySelectorAll('#theme-grid [data-theme-pick]');
  const customThemeEditor = document.getElementById('custom-theme-editor');
  const customThemeFields = document.getElementById('custom-theme-fields');
  const btnCustomFromTheme = document.getElementById('btn-custom-from-theme');
  const checkboxOpenAtLogin = document.getElementById('checkbox-open-at-login');
  const btnSaveSetup = document.getElementById('btn-save-setup');
  const btnQuitApp = document.getElementById('btn-quit-app');

  // DOM Elements — Editor Modes (Normal Live Preview vs </> Origin)
  const btnModeNormal = document.getElementById('btn-mode-normal');
  const btnModeOrigin = document.getElementById('btn-mode-origin');
  const editorHost = document.getElementById('editor');

  const saveIndicator = document.getElementById('save-indicator');
  const wordCounter = document.getElementById('word-counter');
  const opacitySlider = document.getElementById('opacity-slider');

  let currentState = null;
  let loadedNotePath = null;
  let noteMenuOpen = false;

  // One CodeMirror editor for both Normal (live preview) and Origin (raw) modes
  const editor = mdHelper.createEditor(editorHost, {
    onChange: () => scheduleSave(),
    onEscape: () => api.toggleExpand(false),
  });

  let recordingBox = null;
  let saveTimeout = null;
  let customSaveTimeout = null;
  let customTheme = null;

  // Custom theme rows: every valid color applies live and saves shortly after you stop typing
  const customEditor = themes.buildCustomEditor(customThemeFields, (key, hex) => {
    customTheme = { ...customTheme, [key]: hex };
    themes.apply('custom', customTheme);
    if (customSaveTimeout) clearTimeout(customSaveTimeout);
    customSaveTimeout = setTimeout(() => {
      customSaveTimeout = null;
      api.updateSettings({ customTheme });
    }, 300);
  });

  async function init() {
    const state = await api.getState();
    applyState(state, true);

    if (state && state.settings && !state.settings.isConfigured) {
      setupPanel.classList.remove('hidden');
    }

    bindEvents();

    // Theme is painted now, so the window can appear without a flash of the wrong colors
    api.rendererReady();
  }

  function setDocumentContent(rawContent) {
    editor.setContent(rawContent || '');
    updateWordCount();
  }

  function switchEditorMode(mode) {
    const isOrigin = mode === 'origin';
    editor.setMode(isOrigin ? 'origin' : 'normal');
    btnModeOrigin.classList.toggle('active', isOrigin);
    btnModeNormal.classList.toggle('active', !isOrigin);
  }

  function renderHotkeyCaps(box, accelerator) {
    const badges = box.querySelector('.hotkey-badges');
    badges.textContent = '';
    (accelerator || '').split('+').filter(Boolean).forEach((part, i) => {
      if (i > 0) badges.append(' + ');
      const cap = document.createElement('kbd');
      cap.textContent = part === 'Super' ? 'Win' : part;
      badges.appendChild(cap);
    });
  }

  function setRecorderHint(box, text, stateClass) {
    box.title = stateClass === 'is-error' ? `${text}. Pick another shortcut.` : '';
    const wrap = box.querySelector('.recorder-hint-wrap');
    wrap.classList.remove('is-ok', 'is-error');
    if (stateClass) wrap.classList.add(stateClass);
    box.querySelector('.recorder-hint').textContent = text;
  }

  function applyState(state, forceContentReload = false) {
    if (!state) return;
    const wasExpanded = currentState ? currentState.settings.isExpanded : null;
    currentState = state;
    const { settings, note } = state;

    // Expanding or collapsing resizes the window, so an open note menu closes
    if (noteMenuOpen && wasExpanded !== settings.isExpanded) closeNoteMenu();

    // 1. Expand / Slim Bar class
    if (settings.isExpanded) {
      body.classList.remove('mode-slim');
      body.classList.add('mode-expanded');
    } else {
      body.classList.add('mode-slim');
      body.classList.remove('mode-expanded');
      setupPanel.classList.add('hidden');
    }

    // 2. Pin state
    if (settings.isPinned) {
      body.classList.add('pinned');
      btnPin.classList.add('active');
    } else {
      body.classList.remove('pinned');
      btnPin.classList.remove('active');
    }

    // 3. Single .md Note status
    if (note) {
      activeNoteNameEl.textContent = (note.fileName || 'Scratchpad.md').replace(/\.md$/i, '');
      btnNoteBadge.title = `Switch note · ${note.path}`;
      if (note.isConnectedToVault) {
        vaultStatusDot.classList.remove('disconnected');
        vaultStatusDot.classList.add('connected');
      } else {
        vaultStatusDot.classList.add('disconnected');
        vaultStatusDot.classList.remove('connected');
      }

      if (document.activeElement !== inputNotePath) {
        inputNotePath.value = settings.activeNotePath || note.path || '';
      }

      if (note.path !== loadedNotePath) {
        loadedNotePath = note.path;
        editor.loadDocument(note.content || '');
        updateWordCount();
      } else if (forceContentReload || !editor.hasFocus()) {
        setDocumentContent(note.content || '');
      }
    }

    if (noteMenuOpen) {
      renderNoteMenu();
      fitNoteMenu();
    }

    // 4. Global shortcuts: each box shows the saved shortcut, or why it isn't working
    const hotkeyErrors = state.hotkeyErrors || {};
    hotkeyBoxes.forEach((box) => {
      if (box === recordingBox) return;
      const error = hotkeyErrors[box.dataset.hotkey];
      renderHotkeyCaps(box, settings[box.dataset.hotkey]);
      box.classList.toggle('has-error', Boolean(error));
      setRecorderHint(box, error || 'Click to change', error ? 'is-error' : null);
    });
    quickCaptureInput.title = `Type + Enter to add a line (${settings.universalHotkey} to expand)`;
    btnExpand.title = `Expand / collapse (${settings.universalHotkey})`;

    // 5. Theme picker + Custom theme editor
    const theme = settings.theme || 'system';
    // While a color edit is waiting to save, the local colors are newer than the saved ones
    if (!customSaveTimeout) customTheme = settings.customTheme || customTheme;
    themes.apply(theme, customTheme);
    themeSwatches.forEach((btn) => {
      const isActive = btn.dataset.themePick === theme;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', String(isActive));
    });
    customThemeEditor.classList.toggle('hidden', theme !== 'custom');
    if (customTheme) customEditor.setValues(customTheme);

    checkboxOpenAtLogin.checked = Boolean(settings.openAtLogin);
    const savedOpacity =
      settings.opacity === undefined || settings.opacity === 0.96 ? 1 : Number(settings.opacity);
    applyOpacityVisual(savedOpacity);
  }

  function applyOpacityVisual(val) {
    const clamped = Math.max(0.2, Math.min(1, Number(val) || 1));
    opacitySlider.value = String(clamped);
    const pct = ((clamped - 0.2) / (1 - 0.2)) * 100;
    opacitySlider.style.setProperty('--slider-pct', `${pct}%`);
    if (appShell) {
      appShell.style.opacity = String(clamped);
    }
  }

  function scheduleSave() {
    setSaveStatus('Saving…', 'is-saving');
    if (saveTimeout) clearTimeout(saveTimeout);

    saveTimeout = setTimeout(async () => {
      saveTimeout = null;
      const res = await api.writeNote(editor.getContent());
      if (res && res.ok) {
        setSaveStatus('Saved');
      } else {
        setSaveStatus('Save error', 'is-error');
      }
      updateWordCount();
    }, 180);
  }

  // Before switching notes: write what was typed in the last moment to the note it belongs to
  async function flushPendingSave() {
    if (!saveTimeout) return;
    clearTimeout(saveTimeout);
    saveTimeout = null;
    const res = await api.writeNote(editor.getContent());
    if (!res || !res.ok) setSaveStatus('Save error', 'is-error');
  }

  // ==================== NOTE SWITCHER (favorites dropdown) ====================
  function renderNoteMenu() {
    const favorites = (currentState && currentState.favorites) || [];
    noteMenuList.textContent = '';

    favorites.forEach((fav) => {
      const row = document.createElement('div');
      row.className = 'note-menu-row';
      row.classList.toggle('is-active', fav.isActive);
      row.classList.toggle('is-missing', !fav.exists);

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'note-menu-item';
      item.disabled = !fav.exists;
      item.title = fav.exists ? fav.path : `File not found: ${fav.path}`;
      item.innerHTML = '<svg class="icon icon-sm note-menu-check"><use href="#i-check"/></svg>';
      const name = document.createElement('span');
      name.className = 'note-menu-name';
      name.textContent = fav.name;
      item.appendChild(name);
      item.addEventListener('click', () => switchToFavorite(fav));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'note-menu-remove';
      remove.title = 'Remove from favorites (the file is kept)';
      remove.innerHTML = '<svg class="icon icon-sm"><use href="#i-x"/></svg>';
      remove.addEventListener('click', () => removeFavorite(fav));

      row.append(item, remove);
      noteMenuList.appendChild(row);
    });

    noteMenuEmpty.classList.toggle('hidden', favorites.length > 0);
    btnFavAddCurrent.classList.toggle('hidden', favorites.some((fav) => fav.isActive));
  }

  function showNoteMenuError(text) {
    noteMenuError.textContent = text || 'Something went wrong';
    noteMenuError.classList.remove('hidden');
    fitNoteMenu();
  }

  async function openNoteMenu() {
    noteMenuOpen = true;
    slimBar.classList.remove('overflow-open');
    noteMenuError.classList.add('hidden');
    renderNoteMenu();
    const pill = btnNoteBadge.getBoundingClientRect();
    noteMenu.style.top = `${pill.bottom + 4}px`;
    noteMenu.classList.remove('hidden');
    // Under the pill, but never past the right edge on a narrow bar
    noteMenu.style.left = `${Math.max(6, Math.min(pill.left, window.innerWidth - noteMenu.offsetWidth - 6))}px`;
    btnNoteBadge.classList.add('open');
    btnNoteBadge.setAttribute('aria-expanded', 'true');
    await fitNoteMenu();
  }

  // Slim bar: the shell keeps its bar height and the window grows just enough to show the menu
  async function fitNoteMenu() {
    if (!noteMenuOpen || currentState.settings.isExpanded) return;
    appShell.style.height = `${currentState.settings.slimHeight}px`;
    await api.setMenuSpace(noteMenu.offsetTop + noteMenu.offsetHeight + 8);
  }

  async function closeNoteMenu() {
    if (!noteMenuOpen) return;
    noteMenuOpen = false;
    noteMenu.classList.add('hidden');
    btnNoteBadge.classList.remove('open');
    btnNoteBadge.setAttribute('aria-expanded', 'false');
    // Shrink first, then let the shell fill the window again (no tall empty frame)
    if (!currentState.settings.isExpanded) await api.setMenuSpace(0);
    appShell.style.height = '';
  }

  async function switchToFavorite(fav) {
    if (!fav.isActive) {
      await flushPendingSave();
      const res = await api.switchToFavorite(fav.path);
      if (!res.ok) {
        applyState(res.state, false);
        showNoteMenuError(res.error);
        return;
      }
      applyState(res.state, true);
      setSaveStatus('Synced');
    }
    await closeNoteMenu();
    if (currentState.settings.isExpanded) editor.focus();
    else quickCaptureInput.focus();
  }

  async function removeFavorite(fav) {
    const res = await api.removeFavorite(fav.path);
    applyState(res.state, false);
  }

  function setSaveStatus(text, stateClass) {
    saveIndicator.textContent = text;
    saveIndicator.classList.remove('is-saving', 'is-error');
    if (stateClass) saveIndicator.classList.add(stateClass);
  }

  function updateWordCount() {
    const text = editor.getContent().trim();
    const words = text ? text.split(/\s+/).length : 0;
    const lineCount = text ? text.split('\n').length : 0;
    wordCounter.textContent = `${words} words · ${lineCount} lines`;
  }

  // Physical keys (e.code), so the shortcut is the same on any keyboard layout (ABNT2, US, …)
  const CODE_KEYS = {
    Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  };

  function keyFromCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    return CODE_KEYS[code] || null;
  }

  function heldModifiers(e) {
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    return mods;
  }

  // -> { accelerator } when complete, { waiting } while only modifiers are held, or { error }
  function readHotkey(e) {
    const mods = heldModifiers(e);
    if (['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS'].includes(e.key)) return { waiting: mods };

    const key = keyFromCode(e.code);
    if (!key) return { error: "This key can't be used" };
    // Shift alone would block capital letters, so a shortcut needs Ctrl, Alt or Win (F-keys can go alone)
    if (!/^F\d+$/.test(key) && !mods.some((m) => m !== 'Shift')) return { error: 'Add Ctrl, Alt or Win' };
    return { accelerator: [...mods, key].join('+') };
  }

  async function startRecording(box) {
    if (recordingBox === box) return;
    if (recordingBox) await stopRecording(false);
    recordingBox = box;
    box.classList.add('recording');
    box.classList.remove('has-error');
    renderHotkeyCaps(box, '');
    setRecorderHint(box, 'Press keys… (Esc cancels)');
    await api.suspendHotkeys();
  }

  async function stopRecording(resume = true) {
    if (!recordingBox) return;
    recordingBox.classList.remove('recording');
    recordingBox = null;
    if (resume) applyState(await api.resumeHotkeys(), false);
  }

  async function saveRecordedHotkey(box, accelerator) {
    recordingBox = null;
    box.classList.remove('recording');
    renderHotkeyCaps(box, accelerator);
    setRecorderHint(box, 'Checking…');

    const res = await api.setHotkey(box.dataset.hotkey, accelerator);
    if (res && res.ok) {
      applyState(res.state, false);
      setRecorderHint(box, 'Saved', 'is-ok');
      return;
    }
    // Not saved: the old shortcut is still active; show the rejected one with the reason
    applyState(await api.resumeHotkeys(), false);
    renderHotkeyCaps(box, accelerator);
    box.classList.add('has-error');
    setRecorderHint(box, (res && res.error) || 'Not saved', 'is-error');
  }

  async function openVisualSetupPanel() {
    if (!currentState.settings.isExpanded) {
      await api.toggleExpand(true);
    }
    pathErrorMsg.classList.add('hidden');
    setupPanel.classList.toggle('hidden');
  }

  function bindEvents() {
    // 1. Stick / Unstick (Always on Top)
    btnPin.addEventListener('click', async () => {
      await api.togglePin();
    });

    // 2. Expand / Collapse Slim Bar
    btnExpand.addEventListener('click', async () => {
      await api.toggleExpand();
    });

    // 3. Open in Obsidian Desktop App
    btnOpenObsidian.addEventListener('click', async () => {
      await api.openInObsidian();
    });

    // 4. Hide to System Tray
    btnHide.addEventListener('click', async () => {
      await api.minimizeOrHide();
    });

    // 5. Note pill: switch between favorite notes
    btnNoteBadge.addEventListener('click', () => {
      if (noteMenuOpen) closeNoteMenu();
      else openNoteMenu();
    });

    btnFavAddCurrent.addEventListener('click', async () => {
      const res = await api.addFavorite();
      applyState(res.state, false);
      if (!res.ok) showNoteMenuError(res.error);
    });

    btnFavBrowse.addEventListener('click', async () => {
      noteMenuError.classList.add('hidden');
      await flushPendingSave();
      const res = await api.browseAddFavorite();
      applyState(res.state, false);
      if (!res.ok) showNoteMenuError(res.error);
      else closeNoteMenu();
    });

    // Clicking another window closes the menu (and shrinks the slim bar back)
    window.addEventListener('blur', () => closeNoteMenu());

    // 5b. Open Visual Setup Panel
    btnSettings.addEventListener('click', openVisualSetupPanel);

    btnCloseSetup.addEventListener('click', () => {
      stopRecording();
      setupPanel.classList.add('hidden');
    });

    // 6. Browse Single .md File
    btnBrowseNote.addEventListener('click', async () => {
      pathErrorMsg.classList.add('hidden');
      const res = await api.browseNoteFile();
      if (res && !res.canceled) {
        if (res.ok) {
          inputNotePath.value = res.path;
          const fresh = await api.getState();
          applyState(fresh, true);
        } else if (res.error) {
          pathErrorMsg.textContent = res.error;
          pathErrorMsg.classList.remove('hidden');
        }
      }
    });

    // 7. Shortcut recorders: click, press keys, saved right away (or told why not)
    hotkeyBoxes.forEach((box) => {
      box.addEventListener('click', () => startRecording(box));

      box.addEventListener('keydown', (e) => {
        if (box !== recordingBox) return;
        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'Escape' && heldModifiers(e).length === 0) {
          stopRecording();
          return;
        }

        const read = readHotkey(e);
        if (read.waiting) {
          renderHotkeyCaps(box, [...read.waiting, '…'].join('+'));
        } else if (read.error) {
          setRecorderHint(box, read.error, 'is-error');
        } else {
          saveRecordedHotkey(box, read.accelerator);
        }
      });

      // Releasing a modifier updates the live preview
      box.addEventListener('keyup', (e) => {
        if (box !== recordingBox) return;
        const mods = heldModifiers(e);
        renderHotkeyCaps(box, mods.length ? [...mods, '…'].join('+') : '');
      });

      box.addEventListener('blur', () => {
        if (box === recordingBox) stopRecording();
      });
    });

    hotkeyResetButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.hotkeyReset;
        const box = document.querySelector(`[data-hotkey="${key}"]`);
        await stopRecording(false);
        const res = await api.resetHotkey(key);
        if (res && res.ok) {
          applyState(res.state, false);
          setRecorderHint(box, 'Reset to default', 'is-ok');
        } else {
          applyState(await api.resumeHotkeys(), false);
          setRecorderHint(box, (res && res.error) || 'Not saved', 'is-error');
        }
      });
    });

    // 7b. Theme: applies and saves instantly, no need to press Save
    themeSwatches.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const theme = btn.dataset.themePick;
        const partial = { theme };
        // First time on Custom: start from the colors of the theme you were on
        if (theme === 'custom' && !customTheme) {
          partial.customTheme = themes.readTheme(currentState.settings.theme || 'system');
        }
        const updated = await api.updateSettings(partial);
        applyState(updated, false);
      });
    });

    // 7c. Custom theme Reset: back to the Dark or Light colors, whichever is closer
    btnCustomFromTheme.addEventListener('click', async () => {
      const base = themes.isLightCustom() ? 'light' : 'dark';
      const updated = await api.updateSettings({ customTheme: themes.readTheme(base) });
      customTheme = updated.settings.customTheme;
      applyState(updated, false);
    });

    // 8. Save Visual Setup Panel
    btnSaveSetup.addEventListener('click', async () => {
      pathErrorMsg.classList.add('hidden');
      const chosenPath = inputNotePath.value.trim();

      if (chosenPath) {
        const check = await api.setNotePath(chosenPath);
        if (!check.ok) {
          pathErrorMsg.textContent = check.error || 'Invalid file path';
          pathErrorMsg.classList.remove('hidden');
          return;
        }
      }

      const updatedState = await api.completeOnboarding({
        activeNotePath: chosenPath,
        openAtLogin: checkboxOpenAtLogin.checked,
      });

      applyState(updatedState, true);
      setupPanel.classList.add('hidden');
      editor.focusEnd();
    });

    btnQuitApp.addEventListener('click', async () => {
      await api.quitApp();
    });

    // 9. Quick-Capture Input inside Slim Bar (Type + Enter!)
    quickCaptureInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && quickCaptureInput.value.trim()) {
        e.preventDefault();
        const text = quickCaptureInput.value;
        quickCaptureInput.value = '';
        const res = await api.appendQuickLine(text);
        if (res && res.ok) {
          setDocumentContent(res.content);
          quickCaptureInput.classList.add('flash-saved');
          const oldPlaceholder = quickCaptureInput.placeholder;
          quickCaptureInput.placeholder = 'Saved';
          setTimeout(() => {
            quickCaptureInput.classList.remove('flash-saved');
            quickCaptureInput.placeholder = oldPlaceholder;
          }, 1200);
          // Opened with the Quick capture shortcut: show "Saved" for a moment, then put the window back
          setTimeout(() => api.quickCaptureDone(), 350);
        }
      } else if (e.key === 'ArrowDown' && !currentState.settings.isExpanded) {
        await api.toggleExpand(true);
        editor.focusEnd();
      } else if (e.key === 'Escape') {
        quickCaptureInput.blur();
        api.quickCaptureDone();
      }
    });

    // 12. Mode Switcher: Normal (Live Preview) vs Origin (Raw Code)
    btnModeNormal.addEventListener('click', () => switchEditorMode('normal'));
    btnModeOrigin.addEventListener('click', () => switchEditorMode('origin'));

    // 13. Markdown Formatting Toolbar Buttons (work in both modes, on the cursor or selection)
    document.querySelectorAll('.md-btn[data-md]').forEach((btn) => {
      btn.addEventListener('click', () => editor.format(btn.getAttribute('data-md')));
    });

    // Toolbar clicks must not steal focus, so the cursor and selection stay in the editor
    document.querySelectorAll('.md-toolbar button').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
    });

    // 13b. Toolbar ⋯ menu (narrow widths): holds Timestamp & Divider
    btnMdMore.addEventListener('click', (e) => {
      e.stopPropagation();
      mdMoreMenu.classList.toggle('hidden');
    });

    mdMoreMenu.addEventListener('click', () => {
      mdMoreMenu.classList.add('hidden');
    });

    // 13c. Slim bar ⋯ overflow (narrow widths): swaps the input for the hidden buttons
    btnOverflow.addEventListener('click', () => {
      slimBar.classList.toggle('overflow-open');
    });

    slimBar.querySelectorAll('.prio-4, .prio-5, .prio-6').forEach((btn) => {
      btn.addEventListener('click', () => slimBar.classList.remove('overflow-open'));
    });

    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.md-more')) mdMoreMenu.classList.add('hidden');
      if (!e.target.closest('.bar-actions')) slimBar.classList.remove('overflow-open');
      if (!e.target.closest('#note-menu, #btn-note-badge')) closeNoteMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeNoteMenu();
        mdMoreMenu.classList.add('hidden');
        slimBar.classList.remove('overflow-open');
      }
    });

    // 14. Opacity Slider (instant 120fps visual update on input, save to disk on release)
    opacitySlider.addEventListener('input', (e) => {
      applyOpacityVisual(Number(e.target.value));
    });

    opacitySlider.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      applyOpacityVisual(val);
      api.setOpacity(val);
    });

    // 15. Main Process Events
    api.onStateChanged((newState) => {
      applyState(newState, false);
    });

    api.onExternalNoteUpdated((noteData) => {
      if (!editor.hasFocus()) {
        setDocumentContent(noteData.content);
        setSaveStatus('Synced from Obsidian');
      }
    });

    api.onQuickCapture(() => {
      closeNoteMenu();
      setupPanel.classList.add('hidden');
      quickCaptureInput.focus();
      quickCaptureInput.select();
    });

    api.onFocusQuickInput(() => {
      if (!setupPanel.classList.contains('hidden')) {
        inputNotePath.focus();
      } else if (currentState && currentState.settings.isExpanded) {
        editor.focusEnd();
      } else {
        quickCaptureInput.focus();
      }
    });
  }

  init();
})();

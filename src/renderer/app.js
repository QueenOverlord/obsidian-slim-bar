(() => {
  const api = window.slimBarAPI;
  const mdHelper = window.MarkdownHelper;

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

  // DOM Elements — Visual Setup Panel
  const setupPanel = document.getElementById('setup-panel');
  const btnCloseSetup = document.getElementById('btn-close-setup');
  const inputNotePath = document.getElementById('input-note-path');
  const btnBrowseNote = document.getElementById('btn-browse-note');
  const pathErrorMsg = document.getElementById('path-error-msg');

  const btnRecordHotkey = document.getElementById('btn-record-hotkey');
  const hotkeyBadges = document.getElementById('hotkey-badges');
  const recorderHint = document.getElementById('recorder-hint');
  const btnResetHotkey = document.getElementById('btn-reset-hotkey');

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

  // One CodeMirror editor for both Normal (live preview) and Origin (raw) modes
  const editor = mdHelper.createEditor(editorHost, {
    onChange: () => scheduleSave(),
    onEscape: () => api.toggleExpand(false),
  });

  let isRecordingHotkey = false;
  let recordedHotkey = 'Alt+Space';
  let saveTimeout = null;

  async function init() {
    const state = await api.getState();
    applyState(state, true);

    if (state && state.settings && !state.settings.isConfigured) {
      setupPanel.classList.remove('hidden');
    }

    bindEvents();
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

  function renderHotkeyCaps(accelerator) {
    const parts = (accelerator || 'Alt+Space').split('+');
    hotkeyBadges.innerHTML = parts
      .map((p) => `<kbd>${p.replace('CommandOrControl', 'Ctrl')}</kbd>`)
      .join(' + ');
  }

  function applyState(state, forceContentReload = false) {
    if (!state) return;
    currentState = state;
    const { settings, note } = state;

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
      activeNoteNameEl.textContent = note.fileName || 'Scratchpad.md';
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

      if (forceContentReload || !editor.hasFocus()) {
        setDocumentContent(note.content || '');
      }
    }

    // 4. Universal Hotkey & Startup settings
    recordedHotkey = settings.universalHotkey || 'Alt+Space';
    renderHotkeyCaps(recordedHotkey);
    quickCaptureInput.title = `Type + Enter to add a line (${recordedHotkey} to expand)`;
    btnExpand.title = `Expand / collapse (${recordedHotkey})`;

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
      const res = await api.writeNote(editor.getContent());
      if (res && res.ok) {
        setSaveStatus('Saved');
      } else {
        setSaveStatus('Save error', 'is-error');
      }
      updateWordCount();
    }, 180);
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

  function keyEventToAccelerator(e) {
    const modifiers = [];
    if (e.ctrlKey || e.metaKey) modifiers.push('CommandOrControl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');

    const ignoredKeys = ['Control', 'Alt', 'Shift', 'Meta', 'OS'];
    if (ignoredKeys.includes(e.key)) {
      return null;
    }

    let keyName = e.key;
    if (e.code === 'Space' || keyName === ' ') {
      keyName = 'Space';
    } else if (keyName.length === 1) {
      keyName = keyName.toUpperCase();
    } else if (keyName.startsWith('Arrow')) {
      keyName = keyName.replace('Arrow', '');
    }

    if (modifiers.length === 0 && !/^F\d+$/.test(keyName)) {
      modifiers.push('Alt');
    }

    return [...modifiers, keyName].join('+');
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

    // 5. Open Visual Setup Panel
    btnNoteBadge.addEventListener('click', openVisualSetupPanel);
    btnSettings.addEventListener('click', openVisualSetupPanel);

    btnCloseSetup.addEventListener('click', () => {
      stopRecordingHotkey();
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

    // 7. Interactive Universal Hotkey Recorder
    btnRecordHotkey.addEventListener('click', () => {
      isRecordingHotkey = true;
      btnRecordHotkey.classList.add('recording');
      recorderHint.textContent = 'Press keys…';
      btnRecordHotkey.focus();
    });

    btnRecordHotkey.addEventListener('keydown', (e) => {
      if (!isRecordingHotkey) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        stopRecordingHotkey();
        return;
      }

      const accel = keyEventToAccelerator(e);
      if (accel) {
        recordedHotkey = accel;
        renderHotkeyCaps(recordedHotkey);
        stopRecordingHotkey('Captured');
      }
    });

    btnRecordHotkey.addEventListener('blur', () => {
      if (isRecordingHotkey) stopRecordingHotkey();
    });

    btnResetHotkey.addEventListener('click', () => {
      recordedHotkey = 'Alt+Space';
      renderHotkeyCaps(recordedHotkey);
      stopRecordingHotkey('Reset');
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
        universalHotkey: recordedHotkey || 'Alt+Space',
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
        }
      } else if (e.key === 'ArrowDown' && !currentState.settings.isExpanded) {
        await api.toggleExpand(true);
        editor.focusEnd();
      } else if (e.key === 'Escape') {
        quickCaptureInput.blur();
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
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
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

  function stopRecordingHotkey(customHint) {
    isRecordingHotkey = false;
    btnRecordHotkey.classList.remove('recording');
    recorderHint.textContent = customHint || 'Click to change';
  }

  init();
})();

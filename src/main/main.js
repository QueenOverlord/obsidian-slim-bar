const fs = require('fs');
const path = require('path');
const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  Tray,
  Menu,
  nativeImage,
  clipboard,
} = require('electron');
const { SettingsStore, DEFAULT_SETTINGS } = require('./settings-store');
const { VaultBridge, FAVORITES_FULL_ERROR } = require('./vault-bridge');

let mainWindow = null;
let tray = null;
let settingsStore = null;
let vaultBridge = null;
let isSavingBounds = false;
let isQuitting = false;

// Keep settings in %APPDATA%\obsidian-slim-bar for both the installed app and the source folder,
// so installing doesn't lose your note path or hotkey
app.setPath('userData', path.join(app.getPath('appData'), 'obsidian-slim-bar'));

// Started by Windows at login: stay in the tray until the hotkey is pressed
const startHidden = process.argv.includes('--hidden');

// Embedded 32x32 tray icon (same artwork as build/icon.png)
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABqklEQVR42u3X3yuDURzH8f0tS5IkKZkkLUkhSdLM1rJEkh+RCJEwI9e74IqUOleK/MiSn5n8aK2VkPyIlsTEcvvxnLun832yp3mec7VTr8vz2bvtZsdiSR+NM+P8ts04E2zWmYAR+Bbf1PXhfscXU8Ak7M8P9zXEma/hE+aKa0dM1r/bFJCE/hwTdW9MAUnotzBe+wqZSMBYTQwykYDR6meIooc/+O/hG1rbJGCk8glqG/NxGHX4lrhPAoYqHqAW2U8YFsC3xH0SMFh+B7VA14thAXxL3CcBA2W3EPkc91gej/0L39DaJgH99mvIRAL6Sq8gEwnoLYlCJhLQUxyB2uLoI0LrHynhd8U9EQnoKgpDbc57jdDae0oC3XcQ90QkoLPwEjKRgI6CM8hEAtrzT6HWZ7/AyvS9Ln53FOL9ZEhAW94J1BYGbnC8+qrLztILxPvJkIDW3COo9ZSEMNUY1mW46hzi/WRIQEvOAWQiAd7sPaaAJPQvWXPWrk0BSbTfCJ7MIPNk7sBcwb/fBu6MbaaASZiu15HLumVzWTdZk3UTRuBbfDP96NU6v2mHDU3T4o5OAAAAAElFTkSuQmCC';

function createMainWindow() {
  const settings = settingsStore.getAll();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  // On very first launch (!isConfigured), force expanded height so the Visual Setup Panel is front and center
  const startExpanded = !settings.isConfigured ? true : Boolean(settings.isExpanded);
  if (!settings.isConfigured && !settings.isExpanded) {
    settingsStore.update({ isExpanded: true });
  }

  const winWidth = settings.windowWidth || 560;
  const winHeight = startExpanded ? settings.expandedHeight : settings.slimHeight;
  const defaultX = Math.round((screenWidth - winWidth) / 2);

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: settings.windowX !== null ? settings.windowX : defaultX,
    y: settings.windowY !== null ? settings.windowY : 24,
    minWidth: 260,
    minHeight: settings.slimHeight,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: true,
    skipTaskbar: false,
    show: false,
    alwaysOnTop: Boolean(settings.isPinned),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  applyPinState(Boolean(settings.isPinned));

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Show once the page has applied its theme (no empty or wrong-color flash); the setup panel always shows.
  // ready-to-show is a fallback in case the page never reports in.
  let shownOnce = false;
  const showWhenReady = () => {
    if (shownOnce || !mainWindow) return;
    shownOnce = true;
    if (!startHidden || !settings.isConfigured) mainWindow.show();
  };
  ipcMain.once('app:renderer-ready', showWhenReady);
  mainWindow.once('ready-to-show', () => setTimeout(showWhenReady, 1500));

  // Closing (Alt+F4) hides to the tray, so the app stays resident and the hotkey is instant
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
  });

  // Clicking away from a Quick capture puts the window back, like Enter does
  mainWindow.on('blur', () => endQuickCapture());

  mainWindow.on('moved', saveWindowBounds);
  mainWindow.on('resized', () => {
    if (!mainWindow || isSavingBounds) return;
    const bounds = mainWindow.getBounds();
    const isExp = settingsStore.get('isExpanded');
    if (isExp && bounds.height > 100) {
      settingsStore.update({
        windowWidth: bounds.width,
        expandedHeight: bounds.height,
        windowX: bounds.x,
        windowY: bounds.y,
      });
    } else {
      settingsStore.update({
        windowWidth: bounds.width,
        windowX: bounds.x,
        windowY: bounds.y,
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function saveWindowBounds() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  settingsStore.update({
    windowX: bounds.x,
    windowY: bounds.y,
  });
}

function applyPinState(isPinned) {
  if (!mainWindow) return;
  if (isPinned) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);
  }
}

/**
 * Configures "Start Together with Windows" (like LanguageTool).
 * Installed app: Windows' own login item, started hidden in the tray.
 * Source/bat installs: a silent .vbs in the Windows Startup folder.
 */
function applyWindowsAutoStart(enable) {
  const openAtLogin = Boolean(enable);
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin,
        path: process.execPath,
        args: ['--hidden'],
      });
    }
  } catch (err) {
    console.warn('[AutoStart] LoginItemSettings warning:', err.message);
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    const startupFolder = path.join(
      process.env.APPDATA,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup'
    );
    const vbsFile = path.join(startupFolder, 'ObsidianSlimBar-AutoStart.vbs');

    try {
      // The installed app uses the login item above, so it removes the old .vbs launcher
      if (app.isPackaged) {
        if (fs.existsSync(vbsFile)) fs.unlinkSync(vbsFile);
      } else if (openAtLogin && fs.existsSync(startupFolder)) {
        const projectRoot = path.resolve(__dirname, '..', '..');
        const batPath = path.join(projectRoot, 'launch-windows.bat');
        const targetCmd = app.isPackaged ? `"${process.execPath}"` : `"${batPath}"`;
        const vbsContent = [
          'Set WshShell = CreateObject("WScript.Shell")',
          `WshShell.Run ${JSON.stringify(targetCmd)}, 0, False`,
        ].join('\r\n');
        fs.writeFileSync(vbsFile, vbsContent, 'utf-8');
      } else if (!openAtLogin && fs.existsSync(vbsFile)) {
        fs.unlinkSync(vbsFile);
      }
    } catch (err) {
      console.warn('[AutoStart] Startup folder script warning:', err.message);
    }
  }
}

function togglePinState() {
  const nextPinned = !settingsStore.get('isPinned');
  settingsStore.update({ isPinned: nextPinned });
  applyPinState(nextPinned);
  broadcastState();
  updateTrayMenu();
  return nextPinned;
}

function setExpandedState(forceExpanded) {
  if (!mainWindow) return false;
  const currentExpanded = settingsStore.get('isExpanded');
  const nextExpanded = typeof forceExpanded === 'boolean' ? forceExpanded : !currentExpanded;

  settingsStore.update({ isExpanded: nextExpanded });

  const settings = settingsStore.getAll();
  const bounds = mainWindow.getBounds();
  const targetHeight = nextExpanded ? settings.expandedHeight : settings.slimHeight;

  isSavingBounds = true;
  mainWindow.setMinimumSize(360, settings.slimHeight);
  mainWindow.setBounds(
    {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: targetHeight,
    },
    true
  );
  setTimeout(() => {
    isSavingBounds = false;
  }, 150);

  broadcastState();
  updateTrayMenu();
  return nextExpanded;
}

function broadcastState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:state-changed', getFullStatePayload());
}

function getFullStatePayload() {
  return {
    settings: settingsStore.getAll(),
    note: vaultBridge.readNote(),
    favorites: vaultBridge.listFavorites(),
    hotkeyErrors,
  };
}

// What each global shortcut does, and the name shown in messages
const HOTKEY_LABELS = {
  universalHotkey: 'Open bar',
  quickCaptureHotkey: 'Quick capture',
  hotkeyTogglePin: 'Pin on top',
};
let hotkeyErrors = {};

// Set while a Quick capture is open, so Enter / Esc / clicking away can put things back
let quickCapture = null;

/**
 * Open bar hotkey (default Ctrl+Alt+Space): pressing it from ANYWHERE in Windows
 * brings up the bar, expands it and focuses the editor; pressing it again collapses it.
 */
function summonBar() {
  if (!mainWindow) return;
  quickCapture = null;

  const wasVisible = mainWindow.isVisible();
  const wasFocused = mainWindow.isFocused();
  const isExpanded = settingsStore.get('isExpanded');

  // Case 1: Window was hidden or in background -> Summon to front, expand, and focus!
  if (!wasVisible || !wasFocused) {
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    applyPinState(Boolean(settingsStore.get('isPinned')));
    setExpandedState(true);
    mainWindow.focus();
    mainWindow.webContents.send('ui:focus-input');
    return;
  }

  // Case 2: Window is visible & focused, but collapsed -> Expand and focus editor!
  if (!isExpanded) {
    setExpandedState(true);
    mainWindow.focus();
    mainWindow.webContents.send('ui:focus-input');
    return;
  }

  // Case 3: Window is already expanded & focused -> Collapse back into the Slim Bar!
  setExpandedState(false);
}

/**
 * Quick capture hotkey (default Ctrl+Alt+Enter): shows just the slim bar with the cursor in the
 * one-line box. Enter saves and puts the window back the way it was; pressing it again cancels.
 */
function toggleQuickCapture() {
  if (!mainWindow) return;
  if (quickCapture && mainWindow.isVisible() && mainWindow.isFocused()) {
    endQuickCapture();
    return;
  }

  quickCapture = {
    wasHidden: !mainWindow.isVisible(),
    wasExpanded: Boolean(settingsStore.get('isExpanded')),
  };
  if (quickCapture.wasExpanded) setExpandedState(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  applyPinState(Boolean(settingsStore.get('isPinned')));
  mainWindow.focus();
  mainWindow.webContents.send('ui:quick-capture');
}

function endQuickCapture() {
  if (!quickCapture || !mainWindow) return;
  const { wasHidden, wasExpanded } = quickCapture;
  quickCapture = null;
  if (wasHidden) {
    mainWindow.hide();
  } else if (wasExpanded) {
    setExpandedState(true);
  }
}

const HOTKEY_ACTIONS = {
  universalHotkey: () => summonBar(),
  quickCaptureHotkey: () => toggleQuickCapture(),
  hotkeyTogglePin: () => togglePinState(),
};

// Registers every saved shortcut; any that fail are reported to the Setup panel via hotkeyErrors
function registerGlobalHotkeys() {
  globalShortcut.unregisterAll();
  const settings = settingsStore.getAll();
  hotkeyErrors = {};

  Object.keys(HOTKEY_ACTIONS).forEach((key) => {
    const accelerator = settings[key];
    if (!accelerator) return;
    try {
      if (!globalShortcut.register(accelerator, HOTKEY_ACTIONS[key])) {
        hotkeyErrors[key] = 'Taken by another app';
      }
    } catch (err) {
      hotkeyErrors[key] = 'Not a valid shortcut';
    }
  });
}

/**
 * Tests a new shortcut before saving it. If Windows or another app already owns it,
 * nothing is saved and the old shortcut keeps working.
 */
function trySetHotkey(key, accelerator) {
  if (!(key in HOTKEY_ACTIONS) || !accelerator) return { ok: false, error: 'Not a valid shortcut' };

  const settings = settingsStore.getAll();
  const clash = Object.keys(HOTKEY_ACTIONS).find((k) => k !== key && settings[k] === accelerator);
  if (clash) return { ok: false, error: `Already used for ${HOTKEY_LABELS[clash]}` };

  globalShortcut.unregisterAll();
  let isFree = false;
  try {
    isFree = globalShortcut.register(accelerator, () => {});
  } catch (err) {
    registerGlobalHotkeys();
    return { ok: false, error: 'Not a valid shortcut' };
  }
  if (!isFree) {
    registerGlobalHotkeys();
    return { ok: false, error: 'Taken by another app' };
  }

  globalShortcut.unregister(accelerator);
  settingsStore.update({ [key]: accelerator });
  registerGlobalHotkeys();
  updateTrayMenu();
  return { ok: true, state: getFullStatePayload() };
}

function createSystemTray() {
  try {
    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`);
    tray = new Tray(icon);
    tray.setToolTip('Obsidian Slim Bar — Press Universal Hotkey anytime');
    tray.on('click', () => {
      if (!mainWindow) return;
      mainWindow.show();
      mainWindow.focus();
    });
    updateTrayMenu();
  } catch (err) {
    console.warn('[Tray] Could not create system tray:', err.message);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const settings = settingsStore.getAll();
  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Open Bar (${settings.universalHotkey})`,
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        setExpandedState(true);
        mainWindow.focus();
        mainWindow.webContents.send('ui:focus-input');
      },
    },
    {
      label: `Quick Capture (${settings.quickCaptureHotkey})`,
      click: () => toggleQuickCapture(),
    },
    {
      label: settings.isExpanded ? 'Collapse to Slim Bar' : 'Show Slim Bar',
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        setExpandedState(false);
      },
    },
    {
      label: settings.isPinned ? '✓ Pinned Always on Top' : 'Pin Always on Top',
      accelerator: settings.hotkeyTogglePin,
      click: () => togglePinState(),
    },
    {
      label: settings.openAtLogin ? '✓ Starts with Windows' : 'Start with Windows',
      click: () => {
        const next = !settingsStore.get('openAtLogin');
        settingsStore.update({ openAtLogin: next });
        applyWindowsAutoStart(next);
        broadcastState();
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Open Note in Obsidian',
      click: () => vaultBridge.openInObsidian(),
    },
    { type: 'separator' },
    {
      label: 'Quit Completely',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function setupIpcHandlers() {
  ipcMain.handle('app:get-state', () => getFullStatePayload());

  ipcMain.handle('settings:update', (_e, partial) => {
    const updated = settingsStore.update(partial);
    if ('isPinned' in partial) applyPinState(Boolean(updated.isPinned));
    if ('openAtLogin' in partial) applyWindowsAutoStart(Boolean(updated.openAtLogin));
    if (Object.keys(HOTKEY_ACTIONS).some((key) => key in partial)) {
      registerGlobalHotkeys();
    }
    updateTrayMenu();
    return getFullStatePayload();
  });

  ipcMain.handle('settings:complete-onboarding', (_e, payload) => {
    const { activeNotePath, openAtLogin, quickCaptureFormat } = payload || {};
    if (activeNotePath) {
      vaultBridge.setNotePath(activeNotePath);
    }
    const updated = settingsStore.update({
      isConfigured: true,
      openAtLogin: typeof openAtLogin === 'boolean' ? openAtLogin : true,
      quickCaptureFormat: quickCaptureFormat || 'bullet',
    });
    applyWindowsAutoStart(Boolean(updated.openAtLogin));
    registerGlobalHotkeys();
    updateTrayMenu();
    return getFullStatePayload();
  });

  // Hotkey recorder: pause every shortcut while recording, so the keys reach the recorder
  ipcMain.handle('hotkeys:suspend', () => {
    globalShortcut.unregisterAll();
  });

  ipcMain.handle('hotkeys:resume', () => {
    registerGlobalHotkeys();
    return getFullStatePayload();
  });

  ipcMain.handle('hotkeys:set', (_e, key, accelerator) => trySetHotkey(key, accelerator));

  ipcMain.handle('hotkeys:reset', (_e, key) => trySetHotkey(key, DEFAULT_SETTINGS[key]));

  ipcMain.handle('window:quick-capture-done', () => {
    endQuickCapture();
  });

  ipcMain.handle('window:toggle-pin', () => {
    return { isPinned: togglePinState() };
  });

  ipcMain.handle('window:toggle-expand', (_e, forceState) => {
    quickCapture = null;
    return { isExpanded: setExpandedState(forceState) };
  });

  ipcMain.handle('window:set-opacity', (_e, opacity) => {
    const clamped = Math.max(0.2, Math.min(1.0, Number(opacity) || 1.0));
    settingsStore.update({ opacity: clamped });
    return { opacity: clamped };
  });

  ipcMain.handle('window:hide', () => {
    if (mainWindow) mainWindow.hide();
    updateTrayMenu();
    return { ok: true };
  });

  ipcMain.handle('window:quit', () => {
    app.quit();
  });

  // Single .md Note IPC Handlers
  ipcMain.handle('vault:read-note', () => vaultBridge.readNote());

  ipcMain.handle('vault:write-note', (_e, content) => vaultBridge.writeNote(content));

  ipcMain.handle('vault:append-quick-line', (_e, text) => vaultBridge.appendQuickLine(text));

  ipcMain.handle('vault:browse-note', async () => {
    const res = await vaultBridge.browseNoteFile(mainWindow);
    if (!res.canceled) broadcastState();
    return res;
  });

  ipcMain.handle('vault:set-note-path', (_e, rawPath) => {
    const res = vaultBridge.setNotePath(rawPath);
    if (res.ok) broadcastState();
    return res;
  });

  ipcMain.handle('vault:open-in-obsidian', () => vaultBridge.openInObsidian());

  // Copy button on code blocks
  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text ?? '')));

  // Favorite notes (the note pill's dropdown)
  ipcMain.handle('favorites:add', (_e, rawPath) => {
    const res = vaultBridge.addFavorite(rawPath);
    return { ...res, state: getFullStatePayload() };
  });

  ipcMain.handle('favorites:remove', (_e, filePath) => {
    vaultBridge.removeFavorite(filePath);
    return { ok: true, state: getFullStatePayload() };
  });

  ipcMain.handle('favorites:reorder', (_e, orderedPaths) => {
    vaultBridge.reorderFavorites(orderedPaths);
    return { ok: true, state: getFullStatePayload() };
  });

  ipcMain.handle('favorites:switch', (_e, filePath) => {
    const res = vaultBridge.switchToFavorite(filePath);
    return { ok: res.ok, error: res.error, state: getFullStatePayload() };
  });

  // Pick any .md file: it becomes the active note and joins the favorites
  ipcMain.handle('favorites:browse-add', async () => {
    if (vaultBridge.isFavoritesFull()) {
      return { ok: false, error: FAVORITES_FULL_ERROR, state: getFullStatePayload() };
    }
    const res = await vaultBridge.browseNoteFile(mainWindow);
    if (!res.canceled && res.ok) vaultBridge.addFavorite(res.path);
    return { ok: res.canceled || res.ok, error: res.error, state: getFullStatePayload() };
  });

  // The slim window is only 44px tall: grow it while the note dropdown is open, then shrink back
  ipcMain.handle('window:menu-space', (_e, totalHeight) => {
    if (!mainWindow || settingsStore.get('isExpanded')) return;
    const height = Math.max(settingsStore.get('slimHeight'), Math.round(Number(totalHeight) || 0));
    const bounds = mainWindow.getBounds();
    if (bounds.height === height) return;
    isSavingBounds = true;
    mainWindow.setBounds({ ...bounds, height });
    setTimeout(() => {
      isSavingBounds = false;
    }, 150);
  });
}

// Only one copy may run: opening it again just brings up the existing bar
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(onReady);
}

function onReady() {
  if (process.platform === 'win32') app.setAppUserModelId('com.keystone.obsidianslimbar');
  settingsStore = new SettingsStore();
  vaultBridge = new VaultBridge(settingsStore, (updatedNoteData) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vault:external-update', updatedNoteData);
    }
  });

  applyWindowsAutoStart(Boolean(settingsStore.get('openAtLogin')));
  setupIpcHandlers();
  createMainWindow();
  createSystemTray();
  registerGlobalHotkeys();
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  // A second copy quits before it's ready, when globalShortcut can't be used yet
  if (app.isReady()) globalShortcut.unregisterAll();
  if (vaultBridge) vaultBridge.dispose();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

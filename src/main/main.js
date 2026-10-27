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
} = require('electron');
const { SettingsStore } = require('./settings-store');
const { VaultBridge } = require('./vault-bridge');

let mainWindow = null;
let tray = null;
let settingsStore = null;
let vaultBridge = null;
let isSavingBounds = false;

// Embedded 16x16 Obsidian-purple tray icon (base64 PNG)
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABOSURBVDhPY2RgYPgPxFQBjAwMDP8pZRpA8h8fH2ZkZGRgYGBgQBfD5mB0NbiB2AxgxGYAqgF4DWBkZCTsAFwG4HUAqQZQPIBqAAMDAwB1jR8R92b7pAAAAABJRU5ErkJggg==';

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
    alwaysOnTop: Boolean(settings.isPinned),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  applyPinState(Boolean(settings.isPinned));

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

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
 * Works both for packaged .exe builds AND source/bat installs via Windows Startup folder.
 */
function applyWindowsAutoStart(enable) {
  const openAtLogin = Boolean(enable);
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin,
        path: process.execPath,
      });
    }
  } catch (err) {
    console.warn('[AutoStart] LoginItemSettings warning:', err.message);
  }

  // Also manage a silent Windows Startup VBS launcher so dev/folder mode auto-starts on Windows boot too
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
      if (openAtLogin && fs.existsSync(startupFolder)) {
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
  };
}

/**
 * Registers the Universal Hotkey (default Alt+Space) so pressing it from ANYWHERE
 * in Windows immediately brings up the bar and focuses the editor.
 */
function registerGlobalHotkeys() {
  globalShortcut.unregisterAll();
  const settings = settingsStore.getAll();

  const mainAccelerator = settings.universalHotkey || 'Alt+Space';
  try {
    const ok = globalShortcut.register(mainAccelerator, () => {
      if (!mainWindow) return;

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
    });

    if (!ok) {
      console.warn('[GlobalHotkey] Shortcut already in use by another app:', mainAccelerator);
    }
  } catch (err) {
    console.warn('[GlobalHotkey] Invalid universalHotkey:', mainAccelerator, err.message);
  }

  // Secondary Hotkey: Stick / Unstick Always-on-Top
  if (settings.hotkeyTogglePin) {
    try {
      globalShortcut.register(settings.hotkeyTogglePin, () => {
        togglePinState();
      });
    } catch (err) {
      console.warn('[GlobalHotkey] Invalid hotkeyTogglePin:', err.message);
    }
  }
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
      label: `Summon / Expand (${settings.universalHotkey || 'Alt+Space'})`,
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        setExpandedState(true);
        mainWindow.focus();
        mainWindow.webContents.send('ui:focus-input');
      },
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
    if ('universalHotkey' in partial || 'hotkeyTogglePin' in partial) {
      registerGlobalHotkeys();
    }
    updateTrayMenu();
    return getFullStatePayload();
  });

  ipcMain.handle('settings:complete-onboarding', (_e, payload) => {
    const { activeNotePath, universalHotkey, openAtLogin, quickCaptureFormat } = payload || {};
    if (activeNotePath) {
      vaultBridge.setNotePath(activeNotePath);
    }
    const updated = settingsStore.update({
      isConfigured: true,
      universalHotkey: universalHotkey || 'Alt+Space',
      openAtLogin: typeof openAtLogin === 'boolean' ? openAtLogin : true,
      quickCaptureFormat: quickCaptureFormat || 'bullet',
    });
    applyWindowsAutoStart(Boolean(updated.openAtLogin));
    registerGlobalHotkeys();
    updateTrayMenu();
    return getFullStatePayload();
  });

  ipcMain.handle('window:toggle-pin', () => {
    return { isPinned: togglePinState() };
  });

  ipcMain.handle('window:toggle-expand', (_e, forceState) => {
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
}

app.whenReady().then(() => {
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
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (vaultBridge) vaultBridge.dispose();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

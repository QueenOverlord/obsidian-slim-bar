const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slimBarAPI', {
  // Initial State & Settings
  getState: () => ipcRenderer.invoke('app:get-state'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  completeOnboarding: (payload) => ipcRenderer.invoke('settings:complete-onboarding', payload),
  rendererReady: () => ipcRenderer.send('app:renderer-ready'),

  // Window Controls (Stick/Unstick, Collapse/Expand, Opacity, Hide/Quit)
  togglePin: () => ipcRenderer.invoke('window:toggle-pin'),
  toggleExpand: (forceState) => ipcRenderer.invoke('window:toggle-expand', forceState),
  setOpacity: (opacity) => ipcRenderer.invoke('window:set-opacity', opacity),
  minimizeOrHide: () => ipcRenderer.invoke('window:hide'),
  quitApp: () => ipcRenderer.invoke('window:quit'),
  quickCaptureDone: () => ipcRenderer.invoke('window:quick-capture-done'),

  // Global Shortcuts (recorder pauses them, then tests + saves the new one)
  suspendHotkeys: () => ipcRenderer.invoke('hotkeys:suspend'),
  resumeHotkeys: () => ipcRenderer.invoke('hotkeys:resume'),
  setHotkey: (key, accelerator) => ipcRenderer.invoke('hotkeys:set', key, accelerator),
  resetHotkey: (key) => ipcRenderer.invoke('hotkeys:reset', key),

  // Single .md Note Operations
  readNote: () => ipcRenderer.invoke('vault:read-note'),
  writeNote: (content) => ipcRenderer.invoke('vault:write-note', content),
  appendQuickLine: (text) => ipcRenderer.invoke('vault:append-quick-line', text),
  browseNoteFile: () => ipcRenderer.invoke('vault:browse-note'),
  setNotePath: (rawPath) => ipcRenderer.invoke('vault:set-note-path', rawPath),
  openInObsidian: () => ipcRenderer.invoke('vault:open-in-obsidian'),

  // Favorite notes (the note pill's dropdown)
  addFavorite: (rawPath) => ipcRenderer.invoke('favorites:add', rawPath),
  removeFavorite: (filePath) => ipcRenderer.invoke('favorites:remove', filePath),
  reorderFavorites: (orderedPaths) => ipcRenderer.invoke('favorites:reorder', orderedPaths),
  switchToFavorite: (filePath) => ipcRenderer.invoke('favorites:switch', filePath),
  browseAddFavorite: () => ipcRenderer.invoke('favorites:browse-add'),
  setMenuSpace: (totalHeight) => ipcRenderer.invoke('window:menu-space', totalHeight),

  // Events pushed from Main Process
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('window:state-changed', listener);
    return () => ipcRenderer.removeListener('window:state-changed', listener);
  },
  onExternalNoteUpdated: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('vault:external-update', listener);
    return () => ipcRenderer.removeListener('vault:external-update', listener);
  },
  onFocusQuickInput: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ui:focus-input', listener);
    return () => ipcRenderer.removeListener('ui:focus-input', listener);
  },
  onQuickCapture: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ui:quick-capture', listener);
    return () => ipcRenderer.removeListener('ui:quick-capture', listener);
  },
});

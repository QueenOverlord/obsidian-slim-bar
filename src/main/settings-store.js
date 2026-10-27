const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SETTINGS = {
  // First-Run Setup Wizard flag
  isConfigured: false,

  // Single .md Note Connection (inside Obsidian Vault or anywhere on disk)
  activeNotePath: '',

  // System & Startup Behavior (LanguageTool style)
  openAtLogin: true,          // Launch automatically when Windows starts
  universalHotkey: 'Alt+Space', // Universal Hotkey to summon/open/toggle anywhere
  hotkeyTogglePin: 'Alt+Shift+P',

  // Window Behavior & State
  isPinned: true,             // Always on Top
  isExpanded: false,          // Starts as Slim Bar once configured
  opacity: 1,                 // Window opacity (0.2 to 1.0)
  slimHeight: 44,             // Height in px when collapsed into Slim Bar
  expandedHeight: 390,        // Height in px when expanded (or in Setup Wizard)
  windowWidth: 560,           // Width of the bar/pad
  windowX: null,              // Saved X coordinate on screen
  windowY: 24,                // Saved Y coordinate on screen

  // Quick Capture Format
  quickCaptureFormat: 'bullet', // 'bullet' (- text) | 'task' (- [ ] text) | 'timestamp' | 'plain'
};

class SettingsStore {
  constructor() {
    const userDataDir = app.getPath('userData');
    this.settingsFile = path.join(userDataDir, 'obsidian-slim-bar-settings.json');
    this.fallbackNoteFile = path.join(userDataDir, 'Quick-Scratchpad.md');
    this.settings = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.settingsFile)) {
        const raw = fs.readFileSync(this.settingsFile, 'utf-8');
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (err) {
      console.error('[SettingsStore] Failed to load settings, using defaults:', err.message);
    }
    return { ...DEFAULT_SETTINGS };
  }

  getAll() {
    return {
      ...this.settings,
      fallbackNoteFile: this.fallbackNoteFile,
    };
  }

  get(key) {
    return this.settings[key];
  }

  update(partial) {
    this.settings = { ...this.settings, ...partial };
    this._save();
    return this.getAll();
  }

  _save() {
    try {
      const dir = path.dirname(this.settingsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SettingsStore] Failed to save settings:', err.message);
    }
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS };

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SETTINGS = {
  // First-Run Setup Wizard flag
  isConfigured: false,

  // Single .md Note Connection (inside Obsidian Vault or anywhere on disk)
  activeNotePath: '',
  favoriteNotes: [],          // Up to 10 .md paths, shown in the note pill's dropdown

  // System & Startup Behavior (LanguageTool style)
  openAtLogin: true,          // Launch automatically when Windows starts
  universalHotkey: 'Ctrl+Alt+Space',     // Open bar: summon / expand / collapse from anywhere
  quickCaptureHotkey: 'Ctrl+Alt+Enter', // Quick capture: slim bar only, type + Enter, then back
  hotkeyTogglePin: 'Alt+Shift+P',

  // Look: 'system' (Auto, follows Windows) | 'dark' | 'light' | 'dracula' | 'solarized-light' | 'dedsec' | 'cyberpunk' | 'akira'
  //       | 'user:<file>.css' (one of your own themes, in <userData>/themes/)
  theme: 'system',
  customTheme: null,          // Up to v1.4: the single Custom theme, moved to themes/Custom.css on first start
  themesMigrated: false,

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
        // Old default Alt+Space clashes with the Windows window menu and PowerToys Run
        if (parsed.universalHotkey === 'Alt+Space') parsed.universalHotkey = DEFAULT_SETTINGS.universalHotkey;
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

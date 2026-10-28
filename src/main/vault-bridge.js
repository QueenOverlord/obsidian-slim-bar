const fs = require('fs');
const path = require('path');
const { dialog, shell } = require('electron');

const MAX_FAVORITES = 10;
const FAVORITES_FULL_ERROR = `Up to ${MAX_FAVORITES} favorites. Remove one first.`;

class VaultBridge {
  constructor(settingsStore, onExternalFileChange) {
    this.settingsStore = settingsStore;
    this.onExternalFileChange = onExternalFileChange;
    this.watcher = null;
    this.lastWriteTime = 0;
  }

  /**
   * Resolves the single active Markdown (.md) file path.
   */
  resolveTargetNotePath() {
    const settings = this.settingsStore.getAll();
    if (settings.activeNotePath && settings.activeNotePath.trim()) {
      const customPath = settings.activeNotePath.trim();
      const dir = path.dirname(customPath);
      if (fs.existsSync(dir)) {
        return customPath.toLowerCase().endsWith('.md') ? customPath : `${customPath}.md`;
      }
    }
    return settings.fallbackNoteFile;
  }

  /**
   * Validates or sets a manually pasted/selected .md file path.
   */
  setNotePath(rawPath) {
    if (!rawPath || !rawPath.trim()) {
      return { ok: false, error: 'Please select or enter a valid .md file path.' };
    }
    let cleanPath = rawPath.trim().replace(/^["']|["']$/g, '');
    if (!cleanPath.toLowerCase().endsWith('.md')) {
      cleanPath += '.md';
    }

    const dir = path.dirname(cleanPath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(cleanPath)) {
        const title = path.basename(cleanPath, '.md');
        fs.writeFileSync(cleanPath, `# ${title}\n\n- `, 'utf-8');
      }
      this.settingsStore.update({ activeNotePath: cleanPath });
      return { ok: true, path: cleanPath, note: this.readNote() };
    } catch (err) {
      return { ok: false, error: `Cannot access or create file at that path: ${err.message}` };
    }
  }

  /**
   * Reads the single active .md file and watches it for external edits from Obsidian.
   */
  readNote() {
    const targetPath = this.resolveTargetNotePath();
    const configuredPath = this.settingsStore.get('activeNotePath');
    const isCustomNote = Boolean(configuredPath && configuredPath.trim());

    try {
      if (!fs.existsSync(targetPath)) {
        const title = path.basename(targetPath, '.md');
        const initialContent = `# ${title}\n\n- `;
        fs.writeFileSync(targetPath, initialContent, 'utf-8');
      }
      const content = fs.readFileSync(targetPath, 'utf-8');
      this._watchFile(targetPath);
      return {
        path: targetPath,
        fileName: path.basename(targetPath),
        isConnectedToVault: isCustomNote,
        content,
      };
    } catch (err) {
      console.error('[VaultBridge] Error reading note:', err);
      return {
        path: targetPath,
        fileName: path.basename(targetPath),
        isConnectedToVault: false,
        content: '',
        error: err.message,
      };
    }
  }

  /**
   * Writes content directly to the active .md file.
   */
  writeNote(content) {
    const targetPath = this.resolveTargetNotePath();
    try {
      this.lastWriteTime = Date.now();
      fs.writeFileSync(targetPath, content, 'utf-8');
      return { ok: true, path: targetPath, updatedAt: this.lastWriteTime };
    } catch (err) {
      console.error('[VaultBridge] Error writing note:', err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Appends a single quick-capture line directly from Slim Bar mode.
   */
  appendQuickLine(rawText) {
    if (!rawText || !rawText.trim()) return { ok: false };
    const text = rawText.trim();
    const format = this.settingsStore.get('quickCaptureFormat') || 'bullet';

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let formattedLine = text;
    if (format === 'bullet') {
      formattedLine = `- ${text}`;
    } else if (format === 'task') {
      formattedLine = `- [ ] ${text}`;
    } else if (format === 'timestamp') {
      formattedLine = `- **${timeStr}** — ${text}`;
    }

    const noteData = this.readNote();
    const current = noteData.content || '';
    const separator = current.endsWith('\n') || current.length === 0 ? '' : '\n';
    const updatedContent = `${current}${separator}${formattedLine}\n`;

    this.writeNote(updatedContent);
    return {
      ok: true,
      content: updatedContent,
      path: noteData.path,
    };
  }

  /**
   * Opens native Windows Explorer file picker so the user can pick an existing .md note
   * OR type a new .md filename inside their Obsidian Vault folder.
   */
  async browseNoteFile(parentWindow) {
    const currentPath = this.settingsStore.get('activeNotePath');
    const result = await dialog.showOpenDialog(parentWindow, {
      title: 'Select Your Single Obsidian Note (.md)',
      defaultPath: currentPath || undefined,
      buttonLabel: 'Select .md Note',
      filters: [{ name: 'Markdown Note (*.md)', extensions: ['md'] }],
      properties: ['openFile', 'promptToCreate'],
    });

    if (result.canceled || !result.filePaths.length) {
      return { canceled: true };
    }

    let chosenFile = result.filePaths[0];
    if (!chosenFile.toLowerCase().endsWith('.md')) {
      chosenFile += '.md';
    }

    const saveRes = this.setNotePath(chosenFile);
    return {
      canceled: false,
      ...saveRes,
    };
  }

  /**
   * Favorite notes for the note pill's dropdown, with a flag for files that were moved or deleted.
   */
  listFavorites() {
    const activeKey = this._pathKey(this.resolveTargetNotePath());
    return (this.settingsStore.get('favoriteNotes') || []).map((filePath) => ({
      path: filePath,
      name: path.basename(filePath, path.extname(filePath)),
      exists: fs.existsSync(filePath),
      isActive: this._pathKey(filePath) === activeKey,
    }));
  }

  isFavoritesFull() {
    return (this.settingsStore.get('favoriteNotes') || []).length >= MAX_FAVORITES;
  }

  addFavorite(rawPath) {
    const filePath = rawPath || this.resolveTargetNotePath();
    const favorites = this.settingsStore.get('favoriteNotes') || [];
    if (favorites.some((p) => this._pathKey(p) === this._pathKey(filePath))) return { ok: true };
    if (this.isFavoritesFull()) return { ok: false, error: FAVORITES_FULL_ERROR };
    this.settingsStore.update({ favoriteNotes: [...favorites, filePath] });
    return { ok: true };
  }

  // Only takes the note off the list; the file itself is never touched
  removeFavorite(filePath) {
    const favorites = this.settingsStore.get('favoriteNotes') || [];
    const key = this._pathKey(filePath);
    this.settingsStore.update({ favoriteNotes: favorites.filter((p) => this._pathKey(p) !== key) });
    return { ok: true };
  }

  switchToFavorite(filePath) {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found. It may have been moved or renamed.' };
    }
    return this.setNotePath(filePath);
  }

  // Windows paths are case-insensitive, so C:\Vault\a.md and c:\vault\A.md are the same note
  _pathKey(filePath) {
    return path.resolve(filePath).toLowerCase();
  }

  /**
   * Opens the currently active .md note directly inside the Obsidian Desktop app via obsidian:// URI.
   */
  async openInObsidian() {
    const targetPath = this.resolveTargetNotePath();
    const encodedPath = encodeURIComponent(targetPath);
    const uri = `obsidian://open?path=${encodedPath}`;
    await shell.openExternal(uri);
    return { ok: true, uri };
  }

  _watchFile(filePath) {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignore
      }
      this.watcher = null;
    }

    if (!fs.existsSync(filePath)) return;

    try {
      this.watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          if (Date.now() - this.lastWriteTime < 600) return;
          try {
            const freshContent = fs.readFileSync(filePath, 'utf-8');
            if (typeof this.onExternalFileChange === 'function') {
              this.onExternalFileChange({
                path: filePath,
                fileName: path.basename(filePath),
                content: freshContent,
              });
            }
          } catch {
            // ignore transient read lock
          }
        }
      });
    } catch (err) {
      console.warn('[VaultBridge] Could not watch file:', err.message);
    }
  }

  dispose() {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignore
      }
    }
  }
}

module.exports = { VaultBridge, FAVORITES_FULL_ERROR };

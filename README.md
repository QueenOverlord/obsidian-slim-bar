# Obsidian Slim Bar

A thin, always-on-top bar for Windows that writes straight into **one Markdown note** in your Obsidian vault.

Press a hotkey from anywhere, type a thought, press `Enter`. It lands in your note. No window switching, no lost focus.

- **Slim bar (44px):** sits at the top of your screen. Type one line and press `Enter` to add it to your note.
- **Expanded pad:** a full Markdown editor with live preview, like Obsidian's. Switch to **Origin** to see the raw Markdown.
- **Live sync:** saves as you type and picks up edits you make in Obsidian.
- **Pin on top:** keep it above every window, or let it sit behind like a normal app.
- **Opacity slider:** fade the bar so it doesn't cover what you're working on.
- **Starts with Windows** (optional), so the hotkey is always ready.

> [!NOTE]
> **This is a vibe-coded tool.** I built it with AI because I wanted a quick-capture bar for my own Obsidian workflow and couldn't find one I liked. It's small and simple, it does one job, and it's free for anyone to use. Issues and suggestions are welcome.

Windows only for now. It runs from the downloaded folder; there is no installer yet.

---

## Download and run

You don't need Node.js or any developer tools.

1. On this page, click the green **Code** button, then **Download ZIP**.
2. Unzip it somewhere permanent, for example `C:\Tools\obsidian-slim-bar`.
   Keep it outside OneDrive or Dropbox; the app starts faster that way.
3. Double-click **`launch-windows.bat`**.
   - The first time, it downloads the Electron runtime (about 100 MB) into a `runtime` folder next to it. This takes a minute and only happens once.
   - If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. This appears because the script isn't signed.
4. The **Setup** panel opens:
   1. **Note:** click **Browse** and pick the `.md` file in your vault you want to write to.
   2. **Hotkey:** click the box and press the shortcut you want.
   3. **Start with Windows:** leave it on if you want the bar ready after every boot.
   4. Click **Save**.

Prefer git? Run `git clone https://github.com/QueenOverlord/obsidian-slim-bar.git` instead of downloading the ZIP, then do steps 3 and 4.

---

## How to use it

| Action | How |
|---|---|
| Show / expand / collapse the bar | Your hotkey (default `Alt+Space`) |
| Add a line to your note | Type in the bar, press `Enter` |
| Open the full editor | Chevron button, or `↓` in the quick-capture box |
| Collapse back to the slim bar | `Esc` in the editor |
| Pin / unpin on top | Pin button, or `Alt+Shift+P` |
| Open the note in Obsidian | Arrow button in the bar |
| Change note or hotkey | Click the note name, or the settings button |
| Hide to the tray | Minus button (the tray icon brings it back) |
| Quit completely | Tray icon → **Quit Completely**, or **Quit** in Setup |

If you haven't picked a note yet, the bar writes to a scratch file in its settings folder, so nothing gets lost.

---

## Update

Download the new ZIP and replace the files in your folder. Keep the `runtime` folder so it doesn't download again. Your settings are stored separately, so you keep them.

## Uninstall

1. Quit the app from the tray icon.
2. Turn off **Start with Windows** first, or delete
   `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ObsidianSlimBar-AutoStart.vbs`
3. Delete the app folder.
4. Optional: delete your settings in `%APPDATA%\obsidian-slim-bar`.

Your Obsidian note is never deleted.

---

## Known issues

- The default hotkey `Alt+Space` clashes with the Windows window menu and PowerToys Run. Pick a different one in Setup (for example `Ctrl+Alt+Space`).
- If the hotkey you choose is already taken by another app, it silently won't work. Try another combination.
- Light theme is on the way; for now there's only the dark look.

---

## For developers

```bash
npm install
npm start        # run from source
npm run dev      # run with the --dev flag
npm run dist     # build a portable .exe with electron-builder (run on Windows)
```

```text
obsidian-slim-bar/
├── launch-windows.bat         # No-install launcher: downloads Electron once, then starts the app
├── scripts/
│   └── codemirror-entry.mjs   # How the bundled editor is built
└── src/
    ├── main/
    │   ├── main.js            # Window, always-on-top, tray, global hotkeys, start with Windows
    │   ├── vault-bridge.js    # Reads/writes the .md note and watches it for changes
    │   ├── settings-store.js  # Settings saved in %APPDATA%\obsidian-slim-bar
    │   └── preload.js         # Safe bridge between the window and the main process
    └── renderer/
        ├── index.html         # Slim bar, setup panel, editor
        ├── styles.css         # All colors live in tokens at the top
        ├── markdown-helper.js # CodeMirror editor, live preview, toolbar actions
        ├── app.js             # UI state, hotkey recorder, events
        └── vendor/
            └── codemirror.js  # Pre-built CodeMirror 6 bundle
```

---

## License

[MIT](LICENSE) © 2026 Polliana Pavloski. Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Not affiliated with or endorsed by Obsidian.

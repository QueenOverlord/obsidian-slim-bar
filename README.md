# Obsidian Slim Bar

A thin, always-on-top bar for Windows that writes straight into **one Markdown note** in your Obsidian vault.

Press a hotkey from anywhere, type a thought, press `Enter`. It lands in your note. No window switching, no lost focus.

- **Slim bar (44px):** sits at the top of your screen. Type one line and press `Enter` to add it to your note.
- **Expanded pad:** a full Markdown editor with live preview, like Obsidian's. Switch to **Origin** to see the raw Markdown.
- **Tables, math, tags, comments and clickable links**, shown like in Obsidian: tables drawn as real tables, `$math$` and `$$math$$` typeset (KaTeX, works offline), `#tags` as pills, `%% comments %%` dimmed. A click opens web links in your browser, and `[[wikilinks]]` and `#tags` in Obsidian. Click a table or a formula to edit its Markdown.
- **Callouts:** `> [!note] Title` and all of Obsidian's types (tip, warning, danger, example, quote…) show as colored panels with their icon. Callouts with `-` or `+` fold and unfold with the arrow next to the title.
- **Code blocks with a Copy button:** wrap a message or email in ```` ``` ```` fences and it shows as a panel, like in Obsidian. One click on **Copy** puts the text on your clipboard (no fences, no `> ` quote marks).
- **Favorite notes:** keep up to 10 notes (one per project, say) and switch between them from the note name in the bar.
- **Live sync:** saves as you type and picks up edits you make in Obsidian.
- **Pin on top:** keep it above every window, or let it sit behind like a normal app.
- **Opacity slider:** fade the bar so it doesn't cover what you're working on.
- **Themes:** Dark, Light, Dracula, Solarized Light, DedSec, Cyberpunk 2077, Akira, or Auto to follow Windows. Headings, links, code and tasks each get their own color.
- **Your own themes, as many as you want:** make them in the app by picking colors or pasting hex codes, or bring your own snippets as `.css` files. You can also edit the files directly. See [Your own themes](#your-own-themes).
- **Starts with Windows** (optional), so the hotkey is always ready.

> [!NOTE]
> **This is a vibe-coded tool.** I built it with AI because I wanted a quick-capture bar for my own Obsidian workflow and couldn't find one I liked. It's small and simple, it does one job, and it's free for anyone to use. Issues and suggestions are welcome.

Windows 10 and 11 only for now.

---

## Install

1. Go to the **[latest release](https://github.com/QueenOverlord/obsidian-slim-bar/releases/latest)** and download **`ObsidianSlimBar-Setup-x.x.x.exe`**.
2. Double-click it. It installs in a few seconds, with no admin password, and opens the app.
   - If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. This appears because the installer isn't code-signed, as with most free open-source apps.
3. The **Setup** panel opens:
   1. **Note:** click **Browse** and pick the `.md` file in your vault you want to write to.
   2. **Shortcuts:** the defaults are `Ctrl+Alt+Space` (open the bar) and `Ctrl+Alt+Enter` (quick capture). To change one, click its box and press the new keys. It's tested and saved right away. If another app already uses it, you'll see a red message and your old shortcut keeps working.
   3. **Start with Windows:** leave it on. The app then starts quietly in the tray at login, so the hotkey shows the bar instantly.
   4. Click **Save**.

You'll find it in the Start Menu as **Obsidian Slim Bar**.

---

## How to use it

| Action | How |
|---|---|
| Show / expand / collapse the bar | `Ctrl+Alt+Space` (changeable) |
| Quick capture: type one line from anywhere, then it gets out of the way | `Ctrl+Alt+Enter` (changeable), type, `Enter` |
| Add a line to your note | Type in the bar, press `Enter` |
| Open the full editor | Chevron button, or `↓` in the quick-capture box |
| Collapse back to the slim bar | `Esc` in the editor |
| Pin / unpin on top | Pin button, or `Alt+Shift+P` |
| Open the note in Obsidian | Arrow button in the bar |
| Switch to another favorite note | Click the note name, then pick a note |
| Add / remove a favorite | Note name → **Add current note** or **Add another note…**; hover a note and click `×` to remove it (the file is kept) |
| Reorder or clean up favorites | Settings → **Favorites**: `⤒` to the top, `↑` up one, `×` remove, or **Sort A–Z** |
| Change note, shortcuts or theme | Settings button |
| Hide to the tray | Minus button (the tray icon brings it back) |
| Quit completely | Tray icon → **Quit Completely**, or **Quit** in Setup |

If you haven't picked a note yet, the bar writes to a scratch file in its settings folder, so nothing gets lost.

---

## Your own themes

Each theme of your own is one `.css` file in `%APPDATA%\obsidian-slim-bar\themes\`. They show up under **My themes** in Setup.

- **In the app:** Setup → **My themes** → **New**. It starts from the colors you have now. Pick colors or paste hex codes; every change is saved to the theme's file. You can rename, duplicate or delete it (deleted files go to the Recycle Bin).
- **With your own snippets:** click **Open folder** and drop a `.css` file in. It appears right away.
- **In the files:** open any theme file in your editor and change it. The bar updates as soon as you save.

A theme only needs these 12 colors. Any you leave out are taken from Dark or Light, whichever matches your background:

```css
/* Theme: Synthwave */
:root {
  --bg: #1a1033;
  --text: #f0e6ff;
  --accent: #ff2bd6;
  --h1: #ffd319;
  --h2: #ff2bd6;
  --h3: #00e5ff;
  --bold: #ffb86c;
  --italic: #c9b8ff;
  --link: #00e5ff;
  --code: #9dff6b;
  --bullet: #ff2bd6;
  --done: #9dff6b;
}
```

For finer control, you can also set any full token from `src/renderer/styles.css`, like `--bg-elevated`, `--md-quote` or `--selection`. Colors can be hex, `rgb()` or `hsl()`. Lines that aren't colors are skipped, and Setup tells you which ones. Your old Custom theme from v1.4 moves into `Custom.css` automatically.

---

## Update

Quit the app from the tray icon, then run the new `Setup.exe` from the latest release. Your settings are kept.

## Uninstall

1. Quit the app from the tray icon.
2. **Settings → Apps → Installed apps → Obsidian Slim Bar → Uninstall.**
3. Optional: delete your settings in `%APPDATA%\obsidian-slim-bar`.

Your Obsidian note is never deleted.

---

## For developers

```bash
npm install
npm start        # run from source
npm run dev      # run with the --dev flag
npm run dist     # build the Windows installer into dist/ (run on Windows)
```

**Run without installing:** download the ZIP, unzip it and double-click `launch-windows.bat`. It downloads the Electron runtime once into a `runtime` folder, then starts the app from source. It's slower to start than the installed app.

**Releasing:** bump `version` in `package.json`, then push a matching tag (`git tag v1.0.1 && git push origin v1.0.1`). GitHub Actions builds the installer and attaches it to the release.

```text
obsidian-slim-bar/
├── launch-windows.bat         # No-install launcher: downloads Electron once, then starts the app
├── .github/workflows/
│   └── release.yml            # Builds the installer on each version tag
├── build/
│   └── icon.png               # App icon
├── scripts/
│   └── codemirror-entry.mjs   # How the bundled editor is built
└── src/
    ├── main/
    │   ├── main.js            # Window, always-on-top, tray, global hotkeys, start with Windows
    │   ├── vault-bridge.js    # Reads/writes the .md note and watches it for changes
    │   ├── settings-store.js  # Settings saved in %APPDATA%\obsidian-slim-bar
    │   ├── theme-store.js     # Your own themes: one .css file each in the themes folder
    │   └── preload.js         # Safe bridge between the window and the main process
    └── renderer/
        ├── index.html         # Slim bar, setup panel, editor
        ├── styles.css         # All colors live in theme token blocks at the top
        ├── theme-manager.js   # Active theme, Auto (follows Windows), painting your own themes
        ├── markdown-helper.js # CodeMirror editor, live preview (tables, math, links…), toolbar actions
        ├── app.js             # UI state, hotkey recorder, events
        └── vendor/
            ├── codemirror.js  # Pre-built CodeMirror 6 bundle
            └── katex/         # KaTeX, for math
```

---

## License

[MIT](LICENSE) © 2026 Polliana Pavloski. Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Not affiliated with or endorsed by Obsidian.

# Third-Party Notices

Obsidian Slim Bar ships or downloads the following open-source software.

| Component | Where | License |
|---|---|---|
| [CodeMirror 6](https://codemirror.net/) (`@codemirror/*`) and [Lezer](https://lezer.codemirror.net/) (`@lezer/*`) | Bundled in `src/renderer/vendor/codemirror.js` | MIT, Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| [Electron](https://www.electronjs.org/) | Downloaded by `launch-windows.bat` into `runtime/` (not part of this repo) | MIT, Copyright (c) Electron contributors and GitHub Inc. |

The bundle is built from `scripts/codemirror-entry.mjs` (rebuild steps are in that file).

"Obsidian" is a trademark of Dynalist Inc. This project is an independent tool and is not affiliated with or endorsed by Obsidian.

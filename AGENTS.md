# AGENTS.md — instructions for AI agents working in this repo

Sageflight is an offline-first, AI-native FPV flight-controller configurator and
troubleshooter. The product is a **desktop app** (Electron shell over a local
web UI) that ships as installers for **Windows, macOS, and Linux**.

## ⚠️ If you are asked to install, open, run, or demo the app — READ THIS FIRST

**Do NOT "open the app" with a dev command.** Neither of these is the real,
branded product:

- `cd app && npm run dev` → a **Vite dev server in a browser** at <http://localhost:5173> (web development build).
- `cd desktop && npm start` (i.e. `electron .`) → the Electron shell running under the **stock Electron binary**, so the window/taskbar show the **generic Electron icon**, not Sageflight.

Use those only when you are actively developing or debugging.

To give the user the real, branded app:

1. **Preferred — install the prebuilt release** (no build; works on any machine):
   - Latest installers: <https://github.com/nbschultz97/sageflight/releases/latest>
     - Windows: `Sageflight-Setup-<version>.exe` (per-user, no admin)
     - macOS: `Sageflight-<version>.dmg` (unsigned — right-click → Open the first time)
     - Linux: `Sageflight-<version>.AppImage`
   - Non-interactive Windows fetch:
     ```bash
     gh release download --repo nbschultz97/sageflight --pattern "*Setup*.exe" --dir .
     ```
   - Run it. Windows SmartScreen warns on the unsigned installer → *More info → Run anyway*. App data lives in `%APPDATA%/Sageflight/data` and survives updates/uninstalls.
2. **Build from source** (only if a prebuilt release won't do — e.g. an offline build box):
   ```bash
   cd app && npm install && npm run build
   cd ../desktop && npm install && npm run dist   # -> desktop/release/Sageflight-Setup-<version>.exe
   ```
   Then run that installer.

The branded icon is baked in **only at package time** (electron-builder,
`desktop/package.json` `build.icon = build/icon.ico`). A dev launch or a plain
`git clone` never yields a branded, runnable app.

## Project conventions (if you change code)

- **Tests:** `npm test` at the repo root (`node --test`, currently 141 tests). Keep it green before committing.
- **Layout:** React + Vite app in `app/`; shared logic + hardware/CLI code in `lib/`; the Electron desktop shell in `desktop/`; tests in `test/`.
- **Safety architecture:** privileged flight-controller actions (motor spin, ESC interrogation, config/flash writes, blackbox erase) require single-use ~60s **safety tokens** via `/api/safety/confirm`, with human confirmation. Never weaken or bypass that path.
- **Releases are automated:** push a `v*` tag → GitHub Actions builds the Windows/macOS/Linux installers and publishes the release. Don't hand-build or hand-upload release assets.
- **Offline-first:** no always-on network dependencies; the AI assistant runs against a **local Ollama** and a local docs index.
- **Windows/PowerShell:** don't use `Get-Content`/`Set-Content` for read-modify-write on source files (PS 5.1 mangles UTF-8 and BOM breaks Vite's PostCSS); use an editor tool or `[IO.File]` with UTF-8.

See [README.md](README.md) for the human-facing overview.

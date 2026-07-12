# CLAUDE.md

Full agent instructions: **[AGENTS.md](AGENTS.md)**.

## ⚠️ Most important — how to open/run/demo this app

Don't "open the app" with a dev command. Neither is the real product:

- `cd app && npm run dev` → a browser dev server at <http://localhost:5173>.
- `cd desktop && npm start` / `electron .` → the Electron shell under the stock Electron binary (**generic Electron icon**, not Sageflight).

Install the branded app instead:

- **Download a release:** <https://github.com/nbschultz97/sageflight/releases/latest>
  (Windows `Sageflight-Setup-<version>.exe`, macOS `.dmg`, Linux `.AppImage`).
  Non-interactive: `gh release download --repo nbschultz97/sageflight --pattern "*Setup*.exe"`.
- **Or build:** `cd app && npm install && npm run build && cd ../desktop && npm install && npm run dist` → run `desktop/release/Sageflight-Setup-<version>.exe`.

The branded icon is baked in only at package time; a dev launch or plain clone never yields a branded app.

## Conventions (brief)

- `npm test` (repo root) must stay green (141 tests).
- App = React + Vite (`app/`); shared logic in `lib/`; Electron shell in `desktop/`.
- Privileged FC actions require single-use safety tokens (`/api/safety/confirm`) — never bypass.
- Releases: push a `v*` tag; CI builds Win/macOS/Linux installers. Offline-first; AI runs on local Ollama.

See [AGENTS.md](AGENTS.md) for the rest.

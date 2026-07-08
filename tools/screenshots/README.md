# Marketing screenshot tools

Headless captures of the running app for the marketing page — no product code
changes, no hardware required.

## Setup (one-time)

```bash
cd tools/screenshots
npm init -y && npm install playwright
```

Uses the system Edge/Chrome via Playwright's `channel` option — no browser
download needed. The app must be running (`cd app && npm run dev`).

## Scripts

- **`shoot.mjs`** — clicks through sidebar tabs and screenshots each one
  (1440×900, dark). Pass tab labels as args, or run bare for the default set:

  ```bash
  node shoot.mjs "Presets" "Checklists" "AI Assistant"
  ```

- **`sim.mjs`** — simulates a connected flight controller by intercepting the
  frontend's API calls (`page.route`): SSE telemetry stream, `/api/detect`,
  `/api/scan`, case-history lookup. The real UI renders a live bench — tilted
  horizon, arming doctor with decoded MSP + ANGLE blockers, full MATEKF722SE
  scan readout. Edit the JSON constants at the top to stage different states.

  ```bash
  node sim.mjs   # -> setup-live.png, setup-full.png
  ```

Both scripts strip bench artifacts (e.g. a real half-plugged USB device's
`failed enum` pill) before capturing.

## Embedding into the marketing page

The marketing page is a single self-contained HTML file; screenshots go in as
base64 data URIs:

```powershell
$b = [Convert]::ToBase64String([IO.File]::ReadAllBytes("setup-live.png"))
# replace the img src (or a placeholder token) with "data:image/png;base64,$b"
```

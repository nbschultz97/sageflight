<p align="center">
  <img src="assets/sageflight-wordmark.svg" alt="Sageflight — AI-native FPV configurator" width="560" />
</p>

**Betaflight/INAV-style configurator on steroids.** One tool that observes
AND acts: live telemetry the moment you hit Connect, guided troubleshooting,
motor and ESC diagnostics, config management, firmware flashing — with an
offline LLM copilot (Ollama) that inspects the aircraft itself, explains what
it sees, and proposes fixes you approve with one click.

Fully standalone. No cloud, no accounts, no data exfil — everything runs on
your laptop. Cross-platform: Windows, macOS, Linux.

## Built for the gaps

Sageflight targets the pain points the existing toolchain leaves open:

- **"Why won't it arm?"** — the #1 beginner wall. Sageflight decodes every
  arming-disable flag live and tells you the *fix*, not just the flag name.
  The AI can read them too (`get_live_telemetry`).
- **Tune analysis without MATLAB** — PIDtoolbox is abandoned and never told
  you what to change. The Blackbox tab reads the full tuning state embedded
  in your log and the AI reviews it: filters, PIDs, dangerous combinations,
  concrete `set` suggestions.
- **Firmware-version config migration** — pasting an old diff into new
  firmware silently drops renamed parameters (the classic burned-motor
  trap). The AI translates your old diff for the target version; you review
  every line before it runs.
- **ESC visibility without extra tools** — 4-way interrogation built in; no
  BLHeliSuite side-quest just to see what firmware your ESCs run.
- **A knowledgeable bench partner** — every setting, failure mode, and next
  step explainable in plain English, offline.

## Compatibility

| | Betaflight | INAV | EmuFlight | ArduPilot / PX4 | KISS |
|---|---|---|---|---|---|
| Detect / identify | ✅ | ✅ | ✅ | USB detect only | — |
| Live telemetry (MSP) | ✅ | ✅ | ✅ | — (MAVLink, roadmap) | — |
| Arming doctor (decoded fixes) | ✅ | raw flags only | raw flags only | — | — |
| CLI console / backup / restore | ✅ | ✅ | ✅ | — | — |
| Motor tests | ✅ | ✅* | ✅* | — | — |
| ESC 4-way interrogation | ✅ | ✅ | ✅ | — | — |
| Firmware flashing (DFU) | ✅ + release fetch | ✅ + release fetch | local .hex | — | — |
| AI assistant / proposals | ✅ | ✅ (CLI syntax differs — review carefully) | ✅ | advice only | advice only |

*CLI `motor` command compatible; bench-verified on Betaflight only so far.

Hardware: any STM32 / AT32 / APM32 flight controller (native VCP or CP210x /
FTDI / CH340 UART bridges), STM32-style DFU bootloaders for flashing, and
BLHeli_S / BLHeli_32 / AM32 / Bluejay / JESC ESCs for interrogation.

ArduPilot/PX4 support means a MAVLink stack — it's on the roadmap as its own
milestone, not a checkbox.

## Download

Grab the Windows installer from
[**Releases**](https://github.com/nbschultz97/sageflight/releases) —
`Sageflight-Setup-<version>.exe`. Per-user install, no admin required.
Windows SmartScreen will warn on first run (the installer is not
code-signed yet) — click *More info → Run anyway*.

Your data (config backups, test history, staged firmware, docs index) lives
in `%APPDATA%/Sageflight/data`, and survives updates and uninstalls.

macOS (`Sageflight-<version>.dmg`) and Linux (`.AppImage`) builds are on the
same Releases page from v0.6.0 (unsigned — macOS needs right-click → Open
the first time).

## Quick start (from source)

```bash
git clone https://github.com/nbschultz97/sageflight
cd sageflight && npm install
cd app && npm install
npm run dev
# open http://localhost:5173
```

Desktop app (Electron shell):

```bash
cd app && npm run build
cd ../desktop && npm install
npm start          # run the shell against your checkout
npm run dist       # build the Windows installer (desktop/release/)
```

## Tabs

- **Setup** — hit **Connect** for a live link (like Betaflight): artificial
  horizon, battery voltage/current, RSSI, cycle time — plus the **arming
  doctor**: every active arming-disable flag decoded with a plain-English
  fix. One-click FC scan reads board identity, firmware, sensors, health,
  and pulls up this exact board's saved case history by MCU id (if you keep
  a local bench-history database — see Import & export).
- **Receiver** — live RC channel bars. Verify endpoints, centering, channel
  map, and link health before you ever arm.
- **Modes** — aux switch range editor with live switch-position markers:
  flip a switch and watch the range activate before you save.
- **Failsafe** — the setting that decides whether a lost quad falls, lands,
  or flies home. Stage-1 per-channel behavior, stage-2 procedure, and GPS
  Rescue parameters — every field explained in plain English, with warnings
  when a combination is dangerous.
- **Ports** — UART function assignment (MSP, Serial RX, GPS, VTX control,
  ESC sensor, blackbox…) with Serial-RX exclusivity handled for you.
- **Tune** — PID / rates / filters / simplified-tuning editor read straight
  off the FC, with AI review of your current and pending values before a
  backup-gated save.
- **Presets** — the official Betaflight community presets repo: search,
  filter by your firmware version, review the exact CLI lines and option
  checkboxes, apply through the same gated write path.
- **OSD** — element layout editor on the real canvas (analog or HD),
  per-profile visibility toggles, click-to-place.
- **VTX** — video transmitter table editor: bands/channels frequency grid,
  power levels (raw device codes + OSD labels), and the active
  band/channel/power selection with pit-mode and low-power-on-disarm
  settings. Validated client- and firmware-side; writes ride the same
  token-gated, auto-snapshotted batch path as everything else.
- **GPS** — module setup (protocol, SBAS, auto-config, home-point policy)
  with a wiring checklist; the prerequisite for GPS Rescue. Live satellite
  telemetry follows bench validation.
- **Sensors** — rolling gyro/accel traces (dead axis, offset, vibration
  triage), one-click accelerometer calibration, and voltage/current meter
  calibration with live readings to compare against a multimeter.
- **Motors** — live motor output bars while connected, plus safety-gated
  single-motor spin and 4-motor voltage-sag comparison (flags outliers
  consistent with inter-turn shorts). Every test logged to local history.
- **ESC** — BLHeli 4-way interrogation of all four ESCs: chip signature,
  MCU, firmware family (BLHeli_S / BLHeli_32 / AM32 / Bluejay / JESC),
  firmware version and name from the settings EEPROM. Read-only; ESCs are
  reset to run mode and the FC is rebooted afterwards. An unresponsive slot
  is itself a finding.
- **Config / CLI** — one-click config backup (`diff all`), browse/download
  backups, gated CLI console (read commands free; writes need confirmation +
  an existing backup; destructive commands refused), backup **restore**
  (replays a backup line-by-line and saves), and a **config timeline**:
  every write batch auto-snapshots the config first, and any two backups
  diff against each other — "what changed since last session" in one click.
- **Blackbox** — upload a .bbl/.bfl log. Sageflight parses the tuning state
  from the header AND decodes the binary flight frames (experimental):
  gyro noise spectra with peak detection, per-band RMS, motor
  saturation/imbalance stats, **per-axis step response** (setpoint → gyro
  Wiener deconvolution: rise time, overshoot, tracking gain — the
  PIDtoolbox headline plot), and a **noise-vs-throttle heatmap** that
  separates motor/prop noise (climbs with throttle) from frame resonance
  (constant frequency). All charted, and fed to the AI so its tune review
  cites measured numbers, not just settings.
- **Checklists** — guided build → configuration → preflight checklists per
  airframe class (5" freestyle, cinewhoop, 7" long-range, whoop).
- **AI Assistant** — offline LLM via Ollama with streaming, markdown, and a
  tool belt. It auto-selects the strongest tool-capable model you have
  pulled. Two switches:
  - **FC context** — injects your last scan so the model knows your board.
  - **Tools** — agent mode. The LLM can call: `detect_fc`, `scan_fc`,
    `get_config_diff`, `get_motor_history`, `list_config_backups`,
    `get_forensic_record`, `list_forensic_units`, `get_last_esc_scan`, and
    `propose_config_changes`.
  - **Proposals**: when the AI wants to change configuration it drafts exact
    CLI commands. They are validated server-side (destructive commands
    rejected), rendered as a card in the chat, and run **only after you click
    Apply** — which requires a config backup and a fresh safety token.
- **Firmware Flasher** — the firmware-safe flash workflow:
  1. checks for `dfu-util` and shows install instructions if missing
  2. recommends official Betaflight release hexes matched to your scanned
     board target (when online), takes a local `.hex` (validated Intel HEX,
     converted to binary server-side), or runs a **custom cloud build** —
     the same build.betaflight.com service Configurator uses: pick target,
     release, radio/telemetry/motor protocols, features, and expert defines;
     the compiled hex lands in the staged list with its build log linked
  3. requires a config backup before the flash button unlocks
  4. reboots the FC into DFU (`bl`), streams the dfu-util log live, then
     **verifies** — waits for re-enumeration and re-scans the board
  5. config restore afterwards: verbatim replay for same-version flashes, or
     the **AI migration assistant** for version jumps (translates renamed
     parameters, drops dead ones with notes, human-reviewed before apply)

## Safety model

Layers the LLM cannot bypass:

1. **Human confirmation tokens** — every motor actuation, ESC interrogation,
   config write, and firmware flash requires a per-action token issued only
   after explicit checkbox confirmation (props off, restrained, battery
   state / backup taken). Tokens are single-use and expire in 60 s.
2. **Hard caps in the API** — PWM 1000–1300, ≤5 s per spin, motors always
   commanded back to 1000 in a `finally` block; CLI writes re-validated
   server-side; flashing refuses to run without a backup or with multiple
   DFU devices attached.
3. **The LLM has no direct actuation path** — its tools are read-only except
   `propose_config_changes`, which only *drafts* commands. Validation +
   human approval + backup requirement sit between a proposal and the FC.

All serial access is serialized through a mutex — a scan can never collide
with a motor test.

## Import & export

Everything Sageflight produces or consumes is a plain, portable file — the
same philosophy as Betaflight's `diff all`. No lock-in, no required
companions:

- **Config backups** — standard CLI `diff all` text. Download them, diff any
  two against each other, restore them here, or paste them into any other
  configurator. Every write batch auto-snapshots one first.
- **Blackbox logs** — standard `.bbl` / `.bfl` files, straight off your FC's
  flash or SD card.
- **Firmware** — official Betaflight release hexes fetched for your board
  target, or any local Intel HEX file.
- **Build plans** *(optional)* — import a build-plan JSON
  ([documented schema](docs/loadout-schema.md), write it by hand or export
  it from your planning tool of choice) in the Checklists tab: you get a
  kit-check stage, the right checklist set auto-selected, and one-click
  **as-built verification** — planned board target / firmware / motor count
  vs. what the bench actually reports. The AI reads it via `get_loadout`.
- **Hardware spec catalog** *(optional)* — point `COTS_CATALOG_PATH` at a
  local parts-spec JSON catalog (or download a copy once via
  `POST /api/catalog/fetch`) and the AI gains hardware lookups
  (`search_catalog`). Without one, the tool degrades gracefully.
- **Bench case history** *(optional)* — point `STACK_FORENSIC_DIR` at a
  local case-history database directory (or keep one in a sibling folder)
  and the Setup tab shows every board's prior scans, verdicts, and linked
  ESC records the moment you plug it in. Strictly read-only.

## Firmware flashing prerequisites

[dfu-util](https://dfu-util.sourceforge.net/) on PATH:

- Windows: `winget install dfu-util` (or download the zip and add to PATH);
  the DFU device may need the WinUSB driver (ImpulseRC Driver Fixer or Zadig)
- macOS: `brew install dfu-util`
- Linux: `sudo apt install dfu-util` (plus udev rules or sudo)

## The AI stack

Install [Ollama](https://ollama.com/download) and pull models:

```bash
ollama pull qwen2.5:14b        # recommended chat model (32GB-RAM machines) — auto-selected
ollama pull llama3.2:3b        # lightweight fallback for weaker hardware
ollama pull nomic-embed-text   # embeddings for the docs index (below)
```

Connects to `http://127.0.0.1:11434` by default; set `OLLAMA_HOST` to
override. The system prompt lives at `llm/prompts/system.md` and is editable.

**Hallucination policy — assume it, contain it, then shrink it:**

1. **Contained by architecture**: facts come from tools (real scans, real
   telemetry), every AI-proposed command is re-validated server-side, and
   nothing executes without explicit human approval. A wrong sentence is
   possible; a wrong actuation is not.
2. **Shrunk by grounding**: click **Build docs index** in the AI Assistant
   tab. Sageflight fetches the official Betaflight documentation (~200
   files), chunks and embeds it locally, and the agent's `search_docs` tool
   retrieves real documentation before answering settings/procedure
   questions. Internet needed once; fully offline afterwards
   (`data/rag/index.json`).
3. **Shrunk by model**: bigger tool-capable model → fewer fabrications.
   Sageflight auto-selects the strongest one you have pulled.

## MCP server (bench tools for external agents)

Sageflight doubles as an MCP server: any MCP-aware agent (Claude Code, etc.)
can inspect the bench — detection, scans, live telemetry with decoded
arming flags, config diffs, test history, case-history records, the planned
loadout. **Read-only by design**: actuation stays behind the human-confirmed
UI, exactly like the in-app AI.

```bash
# with the app running (cd app && npm start):
npm run mcp
```

Register in Claude Code (`.mcp.json` in any project):

```json
{ "mcpServers": { "sageflight": { "command": "node", "args": ["<path-to>/sageflight/mcp-server.mjs"] } } }
```

It talks to the running app over HTTP (`SAGEFLIGHT_URL` to override), so
there is never serial-port contention.

## CLI scripts (standalone)

```bash
node spin-test.js 3 1070 2     # spin motor 3 at PWM 1070 for 2 seconds
node spin-compare.js 1080 2    # spin all 4 motors, compare voltage sag
node spin-breakin.js 3         # 30s gradual PWM ramp for bearing seating
node ask.js "why might my quad fail arming after a BLHeli update?"
node help.js                   # full command reference
```

Safety is enforced via explicit `yes` prompts, PWM caps (max 1300), and time
caps (max 5 seconds per motor). Do not modify to bypass.

## Development

```bash
npm test                       # protocol/library unit tests (node:test, no hardware needed)
cd app && npm run build        # production frontend build
cd app && npm start            # serve built app + API on :3001
```

Tests cover MSP v1 framing, BLHeli 4-way CRC/framing, ESC EEPROM string
parsing, Intel HEX parsing, dfu-util output parsing, case-history lookups,
CLI command classification, USB port classification, and the backup/history
store. CI runs them plus the frontend build on every push.

Local runtime data (config backups, staged firmware, test history) lives in
`data/` and is git-ignored.

## Roadmap

- [x] BF CLI config assistant (Config tab: backups + gated CLI console)
- [x] Tool-use loop: LLM calls detect/scan/config/history tools
- [x] Guided build checklists per airframe class
- [x] Firmware-safe flash wrapper (backup before flash, verify after, restore)
- [x] Case-history DB integration — per-board bench records as context (read-only)
- [x] ESC interrogation UI via BLHeli 4-way passthrough
- [x] AI config proposals with human approve (propose → review → apply)
- [x] Electron desktop shell
- [x] Persistent connection + live telemetry (attitude, RC, motors, battery)
- [x] Arming doctor — decoded arming-disable flags with fixes, AI-readable
- [x] AI config migration between firmware versions
- [x] Blackbox v1 — header/tune parsing + AI tune review
- [x] Tune / Modes / Sensors editor tabs (parity wave 1) + accel calibration
- [x] Local RAG over official Betaflight docs (search_docs grounding)
- [x] MCP server — read-only bench tools for external agents
- [x] Blackbox v2a — binary frame decoding (I/P/S/E frames, spec-derived,
      experimental), gyro noise spectra + motor stats, AI review grounded
      in measured flight data
- [x] Blackbox v2b — step-response analysis (rise/overshoot/tracking per
      axis) + throttle-vs-frequency heatmap, in the charts and the AI review
- [x] Parity wave 2: Ports editor + Presets browser (official BF repo)
- [x] Hardware spec catalog — parts lookups for the AI (search_catalog)
- [x] Parity wave 3: OSD editor, power & battery calibration, auto pre-write
      snapshots + config timeline diffing
- [x] VTX tables editor — full Betaflight-configurator tab parity reached
- [x] Windows installer (electron-builder NSIS) published on Releases

### Next — v1.0 gate (trust)

- [ ] **Bench validation pass** — first full session against real hardware:
      live telemetry, scan, motor tests, ESC 4-way, DFU flash + restore,
      real blackbox logs through the v2 decoder. Everything above is
      spec-derived until this lands; nothing gets called "stable" before it.
- [ ] Blackbox v2c — validation across a corpus of real logs
- [x] CI release pipeline — Windows / macOS / Linux installers built +
      attached on every tag push (GitHub Actions matrix)
- [ ] Code signing — kill the SmartScreen warning (cert decision/cost)
- [ ] Auto-update — electron-updater against GitHub Releases

### Next — close the remaining Betaflight gaps (capability)

- [x] Cloud build support — Betaflight build API: pick target + release +
      protocols/features/defines, server-side compile, staged for flashing
      (verified live against build.betaflight.com)
- [ ] Blackbox download from the FC — MSP dataflash read + erase, so the
      whole tune loop (fly → download → analyze → fix) happens in one tool
- [x] GPS + Failsafe tabs — stage 1/2 failsafe editor with plain-English
      consequences + GPS Rescue params; GPS module config (live sat status
      pending bench validation)
- [ ] Motor remap wizard — resource remap via the existing safety-gated
      spin flow ("which motor just spun? click it")
- [ ] LED strip + Adjustments tabs; OSD font uploader
- [ ] ESC settings write + flashing (Bluejay/AM32) — esc-configurator parity

### Next — the AI moat (differentiation)

- [ ] Fleet timeline — case history + config timeline across every board
      you've ever plugged in: "what changed since it last flew well?"
- [ ] AI tune coach over time — trend analysis across a craft's logs
      (noise creeping up = bearings; rising sag = battery aging)
- [ ] INAV-calibrated arming flags + INAV-aware AI prompts
- [ ] ArduPilot / PX4 via MAVLink (own milestone: connection, params, arming checks)

## License

MIT

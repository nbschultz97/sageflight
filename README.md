# Sageflight

```
  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ┃                                                        ┃
  ┃   ███████╗ █████╗  ██████╗ ███████╗                    ┃
  ┃   ██╔════╝██╔══██╗██╔════╝ ██╔════╝                    ┃
  ┃   ███████╗███████║██║  ███╗█████╗                      ┃
  ┃   ╚════██║██╔══██║██║   ██║██╔══╝                      ┃
  ┃   ███████║██║  ██║╚██████╔╝███████╗                    ┃
  ┃   ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝ FLIGHT             ┃
  ┃                                                        ┃
  ┃   AI-native FPV configurator & troubleshooter · v0.3   ┃
  ┃                                                        ┃
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

A Betaflight-Configurator-style tool with a brain. Sageflight detects,
diagnoses, configures, and flashes Betaflight stacks — with an offline LLM
copilot (Ollama) that can inspect the aircraft itself and propose fixes you
approve with one click.

No cloud, no data exfil. Everything runs on your laptop. Cross-platform:
Windows, macOS, Linux.

Active-mode companion to [stack-forensic](https://github.com/nbschultz97/fc-forensic):
where the forensic tool **observes**, Sageflight **acts** — and it reads the
forensic database, so the moment you plug a board in it knows that unit's
entire case history.

## Why a separate tool from stack-forensic?

| | stack-forensic | sageflight |
|---|---|---|
| Purpose | Diagnose | Act |
| Writes to FC? | No | Yes |
| Spins motors? | No | Yes |
| Flashes firmware? | No | Yes |
| Runs LLM? | No | Yes (Ollama, local) |
| Ships with CI safety claim | "Read-only" | "Hardware-actuating" |

Mixing the two weakens the forensic tool's defensibility. They share protocol
libraries but stay separate at the product level.

## Quick start

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
npm start
```

## Tabs

- **Setup** — live USB polling, one-click FC scan (board identity, firmware,
  sensors, health). If the board exists in your fc-forensic database, its
  forensic history (unit status, prior scans, linked ESC records) appears
  automatically, matched by MCU id.
- **Motors** — safety-gated single-motor spin and 4-motor voltage-sag
  comparison (flags outliers consistent with inter-turn shorts). Every test
  logged to local history.
- **ESC** — BLHeli 4-way interrogation of all four ESCs: chip signature,
  MCU, firmware family (BLHeli_S / BLHeli_32 / AM32 / Bluejay / JESC),
  firmware version and name from the settings EEPROM. Read-only; ESCs are
  reset to run mode and the FC is rebooted afterwards. An unresponsive slot
  is itself a finding.
- **Config / CLI** — one-click config backup (`diff all`), browse/download
  backups, gated CLI console (read commands free; writes need confirmation +
  an existing backup; destructive commands refused), and backup **restore**
  (replays a backup line-by-line and saves).
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
     board target (when online) or takes a local `.hex` (validated Intel HEX,
     converted to binary server-side)
  3. requires a config backup before the flash button unlocks
  4. reboots the FC into DFU (`bl`), streams the dfu-util log live, then
     **verifies** — waits for re-enumeration and re-scans the board
  5. one-click config restore from your backup afterwards

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

## stack-forensic integration

Sageflight looks for your fc-forensic checkout automatically (a sibling
directory named `fc-forensic` or `stack-forensic`) or via the
`STACK_FORENSIC_DIR` environment variable. Read-only: it never writes to the
forensic database. Surfaced in the Setup tab and through the AI's
`get_forensic_record` / `list_forensic_units` tools.

## Firmware flashing prerequisites

[dfu-util](https://dfu-util.sourceforge.net/) on PATH:

- Windows: `winget install dfu-util` (or download the zip and add to PATH);
  the DFU device may need the WinUSB driver (ImpulseRC Driver Fixer or Zadig)
- macOS: `brew install dfu-util`
- Linux: `sudo apt install dfu-util` (plus udev rules or sudo)

## LLM setup (optional, for the AI Assistant / ask.js)

Install [Ollama](https://ollama.com/download) and pull a tool-capable model:

```bash
ollama pull qwen2.5:14b       # good balance — Sageflight auto-selects the best you have
ollama pull llama3.1:8b       # lighter fallback
```

Connects to `http://127.0.0.1:11434` by default; set `OLLAMA_HOST` to
override. The system prompt lives at `llm/prompts/system.md` and is editable.

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
parsing, Intel HEX parsing, dfu-util output parsing, forensic-DB lookups,
CLI command classification, USB port classification, and the backup/history
store. CI runs them plus the frontend build on every push.

Local runtime data (config backups, staged firmware, test history) lives in
`data/` and is git-ignored.

## Roadmap

- [x] BF CLI config assistant (Config tab: backups + gated CLI console)
- [x] Tool-use loop: LLM calls detect/scan/config/history tools
- [x] Guided build checklists per airframe class
- [x] Firmware-safe flash wrapper (backup before flash, verify after, restore)
- [x] Integration with `stack-forensic` DB — forensic records as context
- [x] ESC interrogation UI via BLHeli 4-way passthrough
- [x] AI config proposals with human approve (propose → review → apply)
- [x] Electron desktop shell
- [ ] Blackbox log analysis (AI-assisted tune review)
- [ ] Packaged installers (electron-builder)
- [ ] INAV / ArduPilot support

## License

MIT

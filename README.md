# Stack Troubleshooter

```
  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ┃                                                                ┃
  ┃    ██████╗████████╗ █████╗  ██████╗██╗  ██╗                   ┃
  ┃   ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝                   ┃
  ┃   ╚█████╗    ██║   ███████║██║     █████╔╝                    ┃
  ┃    ╚═══██╗   ██║   ██╔══██║██║     ██╔═██╗                    ┃
  ┃   ██████╔╝   ██║   ██║  ██║╚██████╗██║  ██╗                   ┃
  ┃   ╚═════╝    ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝   TOOLKIT         ┃
  ┃                                                                ┃
  ┃   Drone Stack Troubleshooter · v0.2 · offline LLM ready        ┃
  ┃                                                                ┃
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

Active-mode companion to [stack-forensic](https://github.com/nbschultz97/fc-forensic).
Where the forensic tool **observes**, this tool **acts** — spins motors, writes
Betaflight configs, guides builds via a local offline LLM (Ollama).

No cloud, no Claude at runtime, no data exfil. Everything runs on your laptop.
Cross-platform: Windows, macOS, Linux (USB detection via `serialport`, with
OS-specific fallbacks for DFU / failed-enumeration states).

## Why a separate tool?

| | stack-forensic | stack-troubleshooter |
|---|---|---|
| Purpose | Diagnose | Act |
| Writes to FC? | No | Yes |
| Spins motors? | No | Yes |
| Runs LLM? | No | Yes (Ollama, local) |
| Ships with CI safety claim | "Read-only" | "Hardware-actuating" |

Mixing the two weakens the forensic tool's defensibility. They share protocol
libraries but stay separate at the product level.

## Web app (primary interface — "AI Betaflight")

A localhost web app with a real UI. React + Tailwind frontend, Node/Express
backend wrapping the protocol libraries. All serial access is serialized
through a mutex — a scan can never collide with a motor test.

```bash
git clone https://github.com/nbschultz97/stack-troubleshooter
cd stack-troubleshooter && npm install
cd app && npm install
npm run dev
# open http://localhost:5173
```

### Tabs

- **Detect** — live USB polling, one-click FC scan (board identity, firmware,
  sensors, health metrics via Betaflight CLI). The last scan feeds the Chat
  tab as context.
- **Motors** — safety-gated single-motor spin and 4-motor voltage-sag
  comparison (flags outliers consistent with inter-turn shorts). Every test is
  logged to a local history you can review later.
- **Config** — one-click config backup (`diff all` saved to `data/backups/`),
  browse/download past backups, and a CLI console. Read commands run freely;
  write commands (`set x = y`, `save`, …) require an explicit confirmation and
  an existing backup; destructive commands (`defaults`, `flash_erase`,
  `motor`, …) are refused outright.
- **Checklists** — guided build → configuration → preflight checklists per
  airframe class (5" freestyle, cinewhoop, 7" long-range, whoop). Progress is
  saved locally.
- **Chat** — offline LLM via Ollama with streaming and markdown rendering.
  Two switches:
  - **FC context** — injects your last scan so the model knows your actual board.
  - **Tools** — agent mode: the LLM can call read-only tools itself
    (`detect_fc`, `scan_fc`, `get_config_diff`, `get_motor_history`,
    `list_config_backups`) to inspect the aircraft before answering.
    Needs a tool-capable model (`llama3.1:8b`, `qwen2.5:7b`).
- **Flash** — coming later.

### Safety model

Three layers, none of which the LLM can bypass:

1. **Human confirmation tokens** — every motor actuation and config write
   requires a per-action token issued only after explicit checkbox
   confirmation (props off, quad restrained, battery state). Tokens are
   single-use and expire in 60 s.
2. **Hard caps in the API** — PWM 1000–1300, ≤5 s per spin, motors always
   commanded back to 1000 in a `finally` block even on errors.
3. **The LLM has no actuation path** — agent tools are read-only by design.
   It can look at the aircraft; only you can make it move.

## CLI scripts (standalone)

The motor-test scripts and Ollama chat client also run without the web app:

```bash
cd stack-troubleshooter
npm install
node spin-test.js 3 1070 2     # spin motor 3 at PWM 1070 for 2 seconds
node spin-compare.js 1080 2    # spin all 4 motors, compare voltage sag
node spin-breakin.js 3         # 30s gradual PWM ramp for bearing seating
node ask.js "why might my quad fail arming after a BLHeli update?"
node help.js                   # full command reference
```

Safety is enforced via explicit `yes` prompts, PWM caps (max 1300), and time
caps (max 5 seconds per motor). Do not modify to bypass.

## LLM setup (optional, for Chat / ask.js)

Install [Ollama](https://ollama.com/download) and pull a model:

```bash
ollama pull llama3.1:8b        # good default, supports tool calling
```

Connects to `http://127.0.0.1:11434` by default; set `OLLAMA_HOST` to
override. The system prompt lives at `llm/prompts/system.md` and is editable.

## Development

```bash
npm test                       # protocol/library unit tests (node:test, no hardware needed)
cd app && npm run build        # production frontend build
cd app && npm start            # serve built app + API on :3001
```

Tests cover the MSP v1 framing, BLHeli 4-way CRC/framing, CLI command
classification, USB port classification, and the backup/history store — all
the logic that can be verified without a bench. CI runs them plus the frontend
build on every push.

Local runtime data (config backups, test history) lives in `data/` and is
git-ignored.

## Roadmap

- [x] BF CLI config assistant (Config tab: backups + gated CLI console)
- [x] Tool-use loop: LLM calls detect/scan/config/history tools (read-only)
- [x] Guided build checklists per airframe class
- [ ] Firmware-safe flash wrapper (backup before flash, verify after)
- [ ] Integration with `stack-forensic` DB — read forensic records as context
- [ ] ESC interrogation UI via BLHeli 4-way passthrough (lib is ready)
- [ ] Electron wrap for a proper desktop app

## License

MIT

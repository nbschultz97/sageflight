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
  ┃   Drone Stack Troubleshooter · v0.1 · offline LLM ready        ┃
  ┃                                                                ┃
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

Active-mode companion to [stack-forensic](https://github.com/nbschultz97/fc-forensic).
Where the forensic tool **observes**, this tool **acts** — spins motors, writes
Betaflight configs, guides builds via a local offline LLM (Ollama).

No cloud, no Claude at runtime, no data exfil. Everything runs on your laptop.

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

## Install

```bash
git clone https://github.com/nbschultz97/stack-troubleshooter
cd stack-troubleshooter
npm install
```

For LLM features, install Ollama locally and pull a small model:

```bash
# https://ollama.com/download
ollama pull llama3.1:8b      # or qwen2.5:7b, or any instruction-tuned model
```

## Commands

### Motor tests (props OFF, battery on, quad restrained)

```bash
node spin-test.js 3 1070 2     # spin motor 3 at PWM 1070 for 2 seconds
node spin-compare.js 1080 2    # spin all 4 motors, compare voltage sag
node spin-breakin.js 3         # 30s gradual PWM ramp for bearing seating
```

Safety is enforced via explicit `yes` prompts, PWM caps (max 1300), and time
caps (max 5 seconds per motor). Do not modify to bypass.

### LLM-assisted troubleshooting

```bash
node ask.js "my quad won't arm, what do I check?"
node ask.js --model qwen2.5:7b "how do I configure ELRS on betaflight 4.5?"
```

Connects to Ollama at `http://127.0.0.1:11434` by default. Set `OLLAMA_HOST` to
override. System prompt lives at `llm/prompts/system.md` and is editable.

### Help

```bash
node help.js
```

## Roadmap

- [ ] BF CLI config assistant with LLM guidance (receiver setup, failsafe, motor direction)
- [ ] Firmware-safe flash wrapper (backup before flash, verify after)
- [ ] Integration with `stack-forensic` DB — read forensic records as context
- [ ] Tool-use loop: LLM can call spin-test / cli commands as tools in an agent loop
- [ ] Guided build checklists per airframe class (5" freestyle, cinewhoop, long-range)

## License

MIT

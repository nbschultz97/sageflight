const { printBanner, VERSION } = require('./lib/banner');

printBanner();

const sections = [
  {
    title: 'WEB APP (primary interface)',
    body: [
      '  cd app && npm install && npm run dev    then open http://localhost:5173',
      '',
      '  Betaflight-style UI. Tabs: Setup (USB + FC scan + case history),',
      '  Motors (safety-gated spin tests, voltage-sag comparison), ESC (BLHeli',
      '  4-way interrogation), Config/CLI (backups, console, restore), Checklists,',
      '  AI Assistant (offline LLM with tools + human-approved config proposals),',
      '  Firmware Flasher (backup-first dfu-util flashing with verify + restore).',
      '',
      '  Desktop app: cd app && npm run build, then cd desktop && npm install && npm start',
    ],
  },
  {
    title: 'MOTOR TESTING (props must be off)',
    body: [
      '  node spin-test.js <motor 1-4> [pwm=1070] [seconds=2]',
      '                             Spin one motor briefly. Safety-gated with explicit',
      '                             props-off confirmation. Max PWM 1300, max 5 seconds.',
      '  node spin-compare.js [pwm=1080] [seconds=2]',
      '                             Spin all 4 motors in sequence, capture battery voltage',
      '                             sag per motor. Identifies inter-turn shorts (motor',
      '                             with abnormally high sag at same PWM).',
      '  node spin-breakin.js <motor 1-4>',
      '                             30-second gradual PWM ramp for new-motor bearing',
      '                             seating. Captures voltage curve across 6 stages.',
    ],
  },
  {
    title: 'LLM-ASSISTED TROUBLESHOOTING (offline, via Ollama)',
    body: [
      '  node ask.js "<question>"  One-shot question to local LLM.',
      '  node ask.js --model qwen2.5:7b "<question>"',
      '                             Specify a specific Ollama model.',
      '',
      '  Requires Ollama running locally. Install: https://ollama.com/download',
      '  Pull a model first: ollama pull llama3.1:8b',
    ],
  },
  {
    title: 'IMPORT & EXPORT',
    body: [
      '  Everything is plain, portable files - no lock-in, no required companions:',
      '  - Config backups: standard CLI `diff all` text (download / diff / restore)',
      '  - Blackbox logs: standard .bbl / .bfl files',
      '  - Firmware: official release hexes or any local Intel HEX',
      '  - Optional: build-plan JSON (docs/loadout-schema.md), hardware spec',
      '    catalog (COTS_CATALOG_PATH), and a local case-history database',
      '    (STACK_FORENSIC_DIR, read-only) for per-board bench records',
    ],
  },
  {
    title: 'SAFETY',
    body: [
      '  PROPS OFF every time motors spin. No exceptions.',
      '  QUAD RESTRAINED so it cannot flip off the bench during a test.',
      '  NOTHING LOOSE near the motors (wires, fingers, debris).',
      '  Scripts enforce these with explicit prompts — do not modify to bypass.',
    ],
  },
];

for (const s of sections) {
  console.log('\n  ' + s.title);
  console.log('  ' + '-'.repeat(s.title.length));
  for (const line of s.body) console.log(line);
}

console.log('\n  Tool version: v' + VERSION);
console.log('  Repo: https://github.com/nbschultz97/sageflight\n');

const { printBanner, VERSION } = require('./lib/banner');

printBanner();

const sections = [
  {
    title: 'WEB APP (primary interface)',
    body: [
      '  cd app && npm install && npm run dev    then open http://localhost:5173',
      '',
      '  Betaflight-style UI. Tabs: Setup (USB + FC scan + forensic history),',
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
    title: 'RELATION TO STACK-FORENSIC',
    body: [
      '  Sageflight is the ACTIVE companion to the READ-ONLY stack-forensic tool.',
      '  - stack-forensic: scans, fingerprints, diagnoses (no actuation)',
      '  - sageflight (this): spins motors, writes configs, flashes firmware,',
      '    guided build assist — and reads the forensic DB for board history',
      '',
      '  Shared protocol libraries (lib/msp.js, lib/blheli-4way.js, lib/betaflight-cli.js)',
      '  are duplicated across both tools for now. May factor into a shared npm package later.',
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

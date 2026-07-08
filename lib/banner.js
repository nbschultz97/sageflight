// ASCII banner printed by each CLI entry point.

const VERSION = '0.4';
const TAGLINE = `Sageflight · v${VERSION} · AI-native FPV configurator & troubleshooter`;
const SUBLINE = 'Companion to fc-forensic (stack-forensic)';

const ART = [
  '███████╗ █████╗  ██████╗ ███████╗',
  '██╔════╝██╔══██╗██╔════╝ ██╔════╝',
  '███████╗███████║██║  ███╗█████╗',
  '╚════██║██╔══██║██║   ██║██╔══╝',
  '███████║██║  ██║╚██████╔╝███████╗',
  '╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝',
  '███████╗██╗     ██╗ ██████╗ ██╗  ██╗████████╗',
  '██╔════╝██║     ██║██╔════╝ ██║  ██║╚══██╔══╝',
  '█████╗  ██║     ██║██║  ███╗███████║   ██║',
  '██╔══╝  ██║     ██║██║   ██║██╔══██║   ██║',
  '██║     ███████╗██║╚██████╔╝██║  ██║   ██║',
  '╚═╝     ╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝',
];

const INNER = 56; // box inner width

function boxed(lines) {
  const top = '  ┏' + '━'.repeat(INNER) + '┓';
  const bottom = '  ┗' + '━'.repeat(INNER) + '┛';
  const blank = '  ┃' + ' '.repeat(INNER) + '┃';
  const rows = lines.map(l => '  ┃   ' + l.padEnd(INNER - 3) + '┃');
  return ['', top, blank, ...rows, blank, bottom, ''].join('\n');
}

const BANNER_UNICODE = boxed([...ART, '', TAGLINE, SUBLINE]);

const BANNER_PLAIN = [
  '',
  '  +----------------------------------------------------------------+',
  '  |                                                                |',
  '  |   SAGEFLIGHT  v' + VERSION + '                                            |',
  '  |   AI-native FPV configurator & troubleshooter                  |',
  '  |   Companion to fc-forensic (stack-forensic)                    |',
  '  |                                                                |',
  '  +----------------------------------------------------------------+',
  '',
].join('\n');

function colorize(s) {
  return s
    .replace(/(┏|┓|┗|┛|━|┃)/g, '\x1b[33m$1\x1b[0m')
    .replace(/(═|║|╔|╗|╚|╝)/g, (m) => '\x1b[93m' + m + '\x1b[0m');
}

function supportsColor() {
  if (!process.stdout.isTTY) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  if (process.platform !== 'win32') return true;
  return !!(process.env.WT_SESSION || process.env.TERM_PROGRAM || (process.env.TERM && /color|xterm|ansi/i.test(process.env.TERM)));
}

function supportsUnicode() {
  if (process.env.FORCE_PLAIN_BANNER) return false;
  if (process.platform !== 'win32') return true;
  return !!(process.env.WT_SESSION || process.env.TERM_PROGRAM);
}

function printBanner() {
  const uni = supportsUnicode();
  const color = supportsColor();
  if (uni) {
    console.log(color ? colorize(BANNER_UNICODE) : BANNER_UNICODE);
  } else {
    console.log(BANNER_PLAIN);
  }
}

module.exports = { printBanner, VERSION };

// ASCII banner printed by each CLI entry point.

const VERSION = '0.2';

const BANNER_UNICODE = [
  '',
  '  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
  '  ┃                                                                ┃',
  '  ┃    ██████╗████████╗ █████╗  ██████╗██╗  ██╗                   ┃',
  '  ┃   ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝                   ┃',
  '  ┃   ╚█████╗    ██║   ███████║██║     █████╔╝                    ┃',
  '  ┃    ╚═══██╗   ██║   ██╔══██║██║     ██╔═██╗                    ┃',
  '  ┃   ██████╔╝   ██║   ██║  ██║╚██████╗██║  ██╗                   ┃',
  '  ┃   ╚═════╝    ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝   TOOLKIT         ┃',
  '  ┃                                                                ┃',
  '  ┃   Drone Stack Troubleshooter · v' + VERSION + ' · offline LLM ready     ┃',
  '  ┃   Companion to stack-forensic                                  ┃',
  '  ┃                                                                ┃',
  '  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
  '',
].join('\n');

const BANNER_PLAIN = [
  '',
  '  +----------------------------------------------------------------+',
  '  |                                                                |',
  '  |   STACK TROUBLESHOOTER  v' + VERSION + '                                 |',
  '  |   Drone Stack Troubleshooting Toolkit — offline-LLM ready      |',
  '  |   Companion to stack-forensic                                  |',
  '  |                                                                |',
  '  +----------------------------------------------------------------+',
  '',
].join('\n');

function colorize(s) {
  return s
    .replace(/(┏|┓|┗|┛|━|┃)/g, '[33m$1[0m')
    .replace(/(═|║|╔|╗|╚|╝)/g, (m) => '[94m' + m + '[0m');
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

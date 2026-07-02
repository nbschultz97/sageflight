// Shared Betaflight CLI session helpers.
//
// withCli() opens the port, enters CLI mode, hands the caller a send()
// function, and — no matter what happens — stops all motors and exits CLI
// before closing the port.

const { SerialPort } = require('serialport');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withCli(comPort, asyncFn) {
  const port = new SerialPort({ path: comPort, baudRate: 115200 });
  await new Promise((r, e) => { port.on('open', r); port.on('error', e); });
  let buf = '';
  const handler = (d) => { buf += d.toString(); };
  port.on('data', handler);
  await sleep(500);
  port.write('#');
  await sleep(1500);
  try {
    return await asyncFn({
      port,
      async send(cmd, waitMs = 300) {
        buf = '';
        port.write(cmd + '\r\n');
        await sleep(waitMs);
        return buf;
      },
    });
  } finally {
    // Always stop all motors + exit CLI cleanly
    try {
      for (let i = 0; i < 4; i++) {
        port.write(`motor ${i} 1000\r\n`);
        await sleep(50);
      }
      port.write('exit\r\n');
      await sleep(400);
    } catch {}
    port.removeListener('data', handler);
    await new Promise(r => port.close(() => r()));
  }
}

// Parse battery voltage out of a BF `status` response.
// New format:  "Voltage: 2451 * 0.01V (6S battery - OK)"
// Old format:  "Voltage: 24.51V"
function parseVoltage(buf) {
  const mult = buf.match(/Voltage:\s*(\d+)\s*\*\s*([\d.]+)V/);
  if (mult) return +(parseFloat(mult[1]) * parseFloat(mult[2])).toFixed(2);
  const plain = buf.match(/Voltage:\s*([\d.]+)V/);
  return plain ? parseFloat(plain[1]) : null;
}

// ---------- CLI console command gating ----------
// Read-only commands are always allowed from the web CLI console.
// Write commands mutate FC state and require an explicit confirmation token.
// Anything not on either list is refused outright (flash erase, defaults,
// bootloader jumps, motor — motors have their own gated endpoints).

// Always read-only, regardless of arguments.
const READ_COMMANDS = new Set([
  'status', 'version', 'get', 'dump', 'diff', 'tasks', 'timer', 'dma',
  'sd_info', 'board_name', 'manufacturer_id', 'mcu_id', 'vtxtable',
  'rxrange', 'batch', 'gyroregisters', 'flash_info',
]);

// Read when bare (or with list/show), write when given arguments.
const DUAL_COMMANDS = new Set([
  'aux', 'feature', 'serial', 'beeper', 'map', 'mixer', 'resource',
  'rateprofile', 'profile', 'vtx', 'rxfail', 'adjrange', 'servo', 'smix',
  'led', 'color', 'mode_color',
]);

// Always writes.
const WRITE_COMMANDS = new Set(['save']);

// Never allowed from the web console, even with a write token.
const FORBIDDEN_COMMANDS = new Set([
  'defaults', 'flash_erase', 'flash_write', 'bl', 'dfu', 'exit', 'motor',
  'escprog', 'serialpassthrough', 'msc', 'reboot',
]);

function classifyCliCommand(line) {
  const trimmed = String(line || '').trim();
  const parts = trimmed.split(/\s+/);
  const word = (parts[0] || '').toLowerCase();
  if (!word) return { verb: '', kind: 'invalid' };
  if (FORBIDDEN_COMMANDS.has(word)) return { verb: word, kind: 'forbidden' };
  // "set x = y" is a write; bare "set" / "set name" (query) is a read.
  if (word === 'set') return { verb: word, kind: /=/.test(trimmed) ? 'write' : 'read' };
  if (READ_COMMANDS.has(word)) return { verb: word, kind: 'read' };
  if (WRITE_COMMANDS.has(word)) return { verb: word, kind: 'write' };
  if (DUAL_COMMANDS.has(word)) {
    const arg = (parts[1] || '').toLowerCase();
    const isQuery = parts.length === 1 || arg === 'list' || arg === 'show';
    return { verb: word, kind: isQuery ? 'read' : 'write' };
  }
  return { verb: word, kind: 'unknown' };
}

module.exports = { withCli, parseVoltage, classifyCliCommand, READ_COMMANDS, DUAL_COMMANDS, WRITE_COMMANDS, FORBIDDEN_COMMANDS };

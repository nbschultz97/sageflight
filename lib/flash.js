// Firmware-safe flash wrapper around dfu-util.
//
// This module NEVER flashes on its own initiative. The server-side workflow
// (POST /api/flash/run) enforces the safety contract:
//   1. a config backup must exist before flashing is allowed
//   2. FC is rebooted into DFU via the CLI `bl` command (or is already in DFU)
//   3. dfu-util writes the image (converted from Intel HEX) and reboots (:leave)
//   4. the FC is re-detected and re-scanned to verify it came back alive
//   5. config restore is a separate, human-confirmed step
//
// dfu-util is an external prerequisite (https://dfu-util.sourceforge.net):
//   Windows: winget/choco or zip on PATH · macOS: brew install dfu-util
//   Linux: apt install dfu-util (plus udev rules or sudo)

const { execFileSync, spawn } = require('child_process');
const { SerialPort } = require('serialport');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Locate dfu-util: DFU_UTIL env override first, then PATH.
function findDfuUtil() {
  const candidates = [process.env.DFU_UTIL, 'dfu-util'].filter(Boolean);
  for (const cand of candidates) {
    try {
      const out = execFileSync(cand, ['--version'], { encoding: 'utf8', timeout: 5000 });
      const version = out.split('\n')[0].trim();
      return { found: true, path: cand, version };
    } catch {}
  }
  return { found: false, path: null, version: null };
}

// Pure — parse `dfu-util -l` output into device entries. Unit-testable.
function parseDfuList(output) {
  const devices = [];
  const re = /Found DFU: \[([0-9a-fA-F]{4}):([0-9a-fA-F]{4})\][^\n]*?alt=(\d+)[^\n]*?name="([^"]*)"/g;
  let m;
  while ((m = re.exec(String(output || ''))) !== null) {
    devices.push({ vid: m[1].toLowerCase(), pid: m[2].toLowerCase(), alt: parseInt(m[3], 10), name: m[4] });
  }
  return devices;
}

function listDfuDevices(dfuPath) {
  try {
    const out = execFileSync(dfuPath, ['-l'], { encoding: 'utf8', timeout: 10000 });
    return parseDfuList(out);
  } catch (e) {
    // dfu-util exits non-zero when no device is present; stdout still matters.
    return parseDfuList((e.stdout || '') + (e.stderr || ''));
  }
}

// Reboot a live Betaflight FC into the ROM DFU bootloader via CLI `bl`.
// The port disappears as the MCU reboots, so every step tolerates failure.
async function enterDfu(comPort) {
  const port = new SerialPort({ path: comPort, baudRate: 115200 });
  port.on('error', () => {}); // port vanishes mid-write by design
  await new Promise((r, e) => { port.on('open', r); port.on('error', e); });
  await sleep(500);
  try {
    port.write('#');
    await sleep(1200);
    port.write('bl\r\n');
    await sleep(800);
  } catch {}
  await new Promise(r => port.close(() => r()));
}

// Run dfu-util, streaming each output line to onLine. Resolves { code }.
// No -d filter: with exactly one DFU device attached, dfu-util finds it; the
// caller pre-checks the device list and refuses ambiguous setups.
function flashWithDfuUtil(dfuPath, binPath, baseAddress, onLine = () => {}, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const addrHex = '0x' + baseAddress.toString(16);
    const args = ['-a', '0', '-s', `${addrHex}:leave`, '-D', binPath];
    onLine(`$ dfu-util ${args.join(' ')}`);

    const child = spawn(dfuPath, args, { windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`dfu-util timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    let residual = '';
    const feed = (chunk) => {
      residual += chunk.toString();
      // dfu-util uses \r for progress updates — treat both as line breaks
      let idx;
      while ((idx = residual.search(/[\r\n]/)) !== -1) {
        const line = residual.slice(0, idx).trim();
        residual = residual.slice(idx + 1);
        if (line) onLine(line);
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (residual.trim()) onLine(residual.trim());
      resolve({ code });
    });
  });
}

module.exports = { findDfuUtil, parseDfuList, listDfuDevices, enterDfu, flashWithDfuUtil };

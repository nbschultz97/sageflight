// High-level ESC interrogation over BLHeli 4-way passthrough.
//
// Flow (same as betaflight-configurator's ESC tab, read-only subset):
//   MSP handshake → MSP_SET_4WAY_IF → per slot: DEVICE_INIT_FLASH (signature)
//   → DEVICE_READ of the settings/EEPROM area (firmware fingerprint + strings)
//   → DEVICE_RESET back to run mode → INTERFACE_EXIT → MSP reboot the FC so
//   DShot output resumes cleanly and the ESCs stop beeping about lost signal.
//
// Read-only by design: no DEVICE_WRITE / ERASE commands are ever issued here.
// 4-way mode disables motor output, but battery must be connected (ESCs are
// powered from VBAT) and props must be off — ESC reset can twitch a motor.

const { SerialPort } = require('serialport');
const msp = require('./msp');
const blh = require('./blheli-4way');
const sigs = require('./esc-signatures');

const SETTINGS_ADDR = 0x1a00; // BLHeli_S / Bluejay settings page on SiLabs EEPROM
const SETTINGS_LEN = 128;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Fixed 16-byte ASCII fields inside the BLHeli_S settings page:
//   0x00 fw main rev, 0x01 fw sub rev, 0x02 layout revision
//   0x40 layout string, 0x50 MCU string, 0x60 name string
// Bluejay keeps the same layout, so its name/version show up here too.
// Pure function — unit-testable.
function parseSettingsStrings(buf) {
  if (!buf || buf.length < 0x70) return null;
  const str = (off) =>
    buf.slice(off, off + 16).toString('latin1').replace(/[^\x20-\x7e]/g, '').trim() || null;
  return {
    fwRevision: `${buf[0]}.${buf[1]}`,
    layoutRevision: buf[2],
    layout: str(0x40),
    mcu: str(0x50),
    name: str(0x60),
  };
}

// If the EEPROM strings identify the firmware more precisely than the chip
// signature does (e.g. Bluejay on a stock-signature BB21), prefer them.
function refineFamily(family, settings) {
  const text = [settings?.layout, settings?.name].filter(Boolean).join(' ');
  if (/bluejay/i.test(text)) return 'Bluejay';
  if (/jesc/i.test(text)) return 'JESC';
  if (/am32/i.test(text)) return 'AM32';
  return family;
}

async function openInterface(comPort) {
  const port = new SerialPort({ path: comPort, baudRate: 115200 });
  await new Promise((r, e) => { port.on('open', r); port.on('error', e); });
  await sleep(500);

  let mspWaiter = null, wayWaiter = null;
  const mspParser = msp.createParser(f => { if (mspWaiter) { const w = mspWaiter; mspWaiter = null; w(f); } });
  const wayParser = blh.createParser(f => { if (wayWaiter) { const w = wayWaiter; wayWaiter = null; w(f); } });
  let mode = 'msp';
  port.on('data', buf => { if (mode === 'msp') mspParser(buf); else wayParser(buf); });

  function waitFrame(timeoutMs = 3000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { mspWaiter = wayWaiter = null; rej(new Error('timeout waiting for response')); }, timeoutMs);
      const settle = f => { clearTimeout(t); res(f); };
      if (mode === 'msp') mspWaiter = settle;
      else wayWaiter = settle;
    });
  }

  return {
    port,
    setMode: (m) => { mode = m; },
    waitFrame,
    close: async () => { await sleep(300); await new Promise(r => port.close(() => r())); },
  };
}

async function interrogateSlot(ctx, motor, retries = 3) {
  let lastAck = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      ctx.port.write(blh.buildFrame(blh.CMD.DEVICE_INIT_FLASH, 0, Buffer.from([motor])));
      const r = await ctx.waitFrame(3000);
      lastAck = r.ack;
      if (r.ack === blh.ACK.OK) {
        const sig = (r.param[0] << 8) | r.param[1];
        const info = sigs.lookup(sig);
        const result = {
          motor,
          responsive: true,
          signature: `0x${sig.toString(16).padStart(4, '0')}`,
          bootPages: r.param[2],
          escTypeByte: r.param[3],
          mcu: info.mcu,
          family: info.family,
          arch: info.arch,
          flashKb: info.flash_kb,
          signatureKnown: info.signatureKnown,
          attempts: attempt,
        };
        try {
          ctx.port.write(blh.buildFrame(blh.CMD.DEVICE_READ, SETTINGS_ADDR, Buffer.from([SETTINGS_LEN])));
          const rd = await ctx.waitFrame(4000);
          if (rd.ack === blh.ACK.OK) {
            result.fingerprintHex = rd.param.toString('hex');
            if (info.arch === 'SiLabs 8051') {
              result.settings = parseSettingsStrings(rd.param);
              result.family = refineFamily(result.family, result.settings);
            }
          }
        } catch (e) {
          result.fingerprintError = e.message;
        }
        return result;
      }
    } catch (e) { lastAck = `err:${e.message}`; }
    await sleep(400);
  }
  return {
    motor,
    responsive: false,
    attempts: retries,
    lastAck: lastAck != null ? (typeof lastAck === 'number' ? `0x${lastAck.toString(16)}` : lastAck) : 'no response',
    reason: 'ESC did not respond to DEVICE_INIT_FLASH — no battery, broken signal wire, dead ESC MCU, or unsupported firmware',
  };
}

// Interrogate every motor slot. Returns { slotCount, results, stackStatus }.
// Caller must hold the serial mutex.
async function interrogateAll(comPort, { maxSlots = 4 } = {}) {
  const ctx = await openInterface(comPort);
  const results = [];
  let slotCount = 0;

  try {
    ctx.port.write(msp.encode(msp.MSP.API_VERSION));
    await ctx.waitFrame();

    ctx.port.write(msp.encode(msp.MSP.SET_4WAY_IF));
    const enter = await ctx.waitFrame();
    slotCount = enter.payload[0] || 0;
    ctx.setMode('4way');

    for (let motor = 0; motor < Math.min(maxSlots, slotCount || maxSlots); motor++) {
      results.push(await interrogateSlot(ctx, motor));
    }
  } finally {
    // Reset every initialized ESC back to run mode, exit 4-way, reboot the FC.
    try {
      for (const r of results) {
        if (r.responsive) {
          try {
            ctx.port.write(blh.buildFrame(blh.CMD.DEVICE_RESET, 0, Buffer.from([r.motor])));
            await ctx.waitFrame(2000);
          } catch {}
        }
      }
      ctx.port.write(blh.buildFrame(blh.CMD.INTERFACE_EXIT));
      await ctx.waitFrame(2000).catch(() => {});
    } catch {}
    try {
      ctx.setMode('msp');
      ctx.port.write(msp.encode(msp.MSP.REBOOT));
      await sleep(800);
    } catch {}
    await ctx.close();
  }

  const responsive = results.filter(r => r.responsive).length;
  const stackStatus = responsive === results.length && responsive > 0 ? 'HEALTHY'
    : responsive > 0 ? 'PARTIAL'
    : 'NO_ESC_RESPONSE';

  return { slotCount, results, stackStatus };
}

module.exports = { interrogateAll, parseSettingsStrings, refineFamily, SETTINGS_ADDR, SETTINGS_LEN };

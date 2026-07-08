// Persistent flight-controller connection with live MSP telemetry.
//
// This is what makes Sageflight behave like Betaflight Configurator instead
// of a scan-then-act utility: Connect holds the serial port open and polls
// MSP for attitude, battery, RC channels, and motor outputs several times a
// second. Exclusive operations (CLI sessions, motor tests, 4-way, flashing)
// suspend the connection — the port is released, the op runs, and telemetry
// resumes automatically afterwards.

const { SerialPort } = require('serialport');
const msp = require('./msp');
const { decodeArmingFlags } = require('./arming-flags');

const CMD = {
  FC_VARIANT: 2,
  STATUS: 101,
  RAW_IMU: 102,
  MOTOR: 104,
  RC: 105,
  ATTITUDE: 108,
  ANALOG: 110,
  STATUS_EX: 150,
  ACC_CALIBRATION: 205,
};

// MSP_FC_VARIANT: 4-char firmware identifier (BTFL, INAV, EMUF, ...)
function parseVariant(p) {
  if (!p || p.length < 4) return null;
  const id = p.slice(0, 4).toString('latin1').replace(/[^A-Z]/g, '');
  return id.length === 4 ? id : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- Pure MSP payload parsers (unit-testable) ----------

// MSP_ATTITUDE: int16 roll*10, int16 pitch*10, int16 yaw (deg)
function parseAttitude(p) {
  if (!p || p.length < 6) return null;
  return {
    roll: p.readInt16LE(0) / 10,
    pitch: p.readInt16LE(2) / 10,
    yaw: p.readInt16LE(4),
  };
}

// MSP_ANALOG: u8 vbat(0.1V), u16 mAh drawn, u16 rssi(0-1023), i16 amps(0.01A),
// optionally u16 vbat(0.01V) appended by newer firmware.
function parseAnalog(p) {
  if (!p || p.length < 7) return null;
  const legacyVbat = p[0] / 10;
  const out = {
    voltage: p.length >= 9 ? p.readUInt16LE(7) / 100 : legacyVbat,
    mahDrawn: p.readUInt16LE(1),
    rssi: Math.round((p.readUInt16LE(3) / 1023) * 100),
    amperage: p.readInt16LE(5) / 100,
  };
  return out;
}

// MSP_RC: n × u16 channel values (1000-2000)
function parseRc(p) {
  if (!p || p.length < 8) return null;
  const channels = [];
  for (let i = 0; i + 1 < p.length && channels.length < 18; i += 2) {
    channels.push(p.readUInt16LE(i));
  }
  return { channels };
}

// MSP_MOTOR: 8 × u16 motor outputs
function parseMotor(p) {
  if (!p || p.length < 8) return null;
  const motors = [];
  for (let i = 0; i + 1 < p.length && motors.length < 8; i += 2) {
    motors.push(p.readUInt16LE(i));
  }
  return { motors };
}

// MSP_RAW_IMU: 9 × int16 — acc xyz, gyro xyz, mag xyz (raw sensor units)
function parseRawImu(p) {
  if (!p || p.length < 18) return null;
  const v = (i) => p.readInt16LE(i * 2);
  return {
    acc: [v(0), v(1), v(2)],
    gyro: [v(3), v(4), v(5)],
    mag: [v(6), v(7), v(8)],
  };
}

// MSP_STATUS: u16 cycleTime(µs), u16 i2cErrors, u16 sensors, u32 flightModeFlags, u8 profile
function parseStatus(p) {
  if (!p || p.length < 11) return null;
  return {
    cycleTime: p.readUInt16LE(0),
    i2cErrors: p.readUInt16LE(2),
    sensors: p.readUInt16LE(4),
    flightModeFlags: p.readUInt32LE(6),
    armed: (p.readUInt32LE(6) & 1) === 1, // box 0 is ARM in Betaflight
    profile: p[10],
  };
}

// MSP_STATUS_EX adds system load, profile counts, a variable-length flight
// mode extension, and — the part we care most about — the u32 arming-disable
// bitmask. Layout (Betaflight msp.c):
//   [0]  u16 cycleTime   [2] u16 i2cErrors   [4] u16 sensors
//   [6]  u32 flightModeFlags                 [10] u8 pidProfile
//   [11] u16 systemLoad  [13] u8 profileCount [14] u8 rateProfile
//   [15] u8 n, n bytes of extra flight-mode flags
//   [16+n] u8 armingDisableCount, [17+n] u32 armingDisableFlags
function parseStatusEx(p) {
  const base = parseStatus(p);
  if (!base) return null;
  const out = { ...base };
  if (p.length >= 13) out.systemLoad = p.readUInt16LE(11);
  if (p.length >= 16) {
    const n = p[15];
    const at = 17 + n;
    if (p.length >= at + 4) {
      const bits = p.readUInt32LE(at);
      out.armingDisableBits = bits;
      out.armingDisable = decodeArmingFlags(bits);
    }
  }
  return out;
}

// ---------- Connection manager ----------

const POLL_MS = 200;
const MAX_CONSECUTIVE_ERRORS = 6;

function createConnection() {
  let port = null;
  let comPort = null;
  let wanted = false;      // the user asked for a connection
  let suspendDepth = 0;
  let telemetry = null;    // latest merged snapshot
  let lastError = null;
  let polling = false;
  let pollTimer = null;
  let errorStreak = 0;
  let pending = null;      // single in-flight MSP request
  let statusTick = 0;
  let variant = null;      // BTFL / INAV / EMUF — read once per connect

  const feed = msp.createParser((frame) => {
    if (pending && frame.cmd === pending.cmd) {
      clearTimeout(pending.timer);
      const p = pending;
      pending = null;
      p.resolve(frame.payload);
    }
  });

  function request(cmd, timeoutMs = 600) {
    return new Promise((resolve, reject) => {
      if (!port || !port.isOpen) return reject(new Error('not connected'));
      if (pending) return reject(new Error('request already in flight'));
      pending = {
        cmd,
        resolve,
        timer: setTimeout(() => { pending = null; reject(new Error(`MSP ${cmd} timeout`)); }, timeoutMs),
      };
      port.write(msp.encode(cmd));
    });
  }

  async function openPort(path) {
    const p = new SerialPort({ path, baudRate: 115200 });
    await new Promise((res, rej) => { p.on('open', res); p.on('error', rej); });
    p.on('error', () => {});           // late errors handled via poll failures
    p.on('data', (d) => feed(d));
    return p;
  }

  async function pollOnce() {
    const next = { at: new Date().toISOString() };
    next.attitude = parseAttitude(await request(CMD.ATTITUDE));
    next.analog = parseAnalog(await request(CMD.ANALOG));
    next.rc = parseRc(await request(CMD.RC));
    next.motor = parseMotor(await request(CMD.MOTOR));
    next.imu = parseRawImu(await request(CMD.RAW_IMU));
    // Status changes slowly — poll it once a second.
    if (statusTick++ % 5 === 0 || !telemetry?.status) {
      next.status = parseStatusEx(await request(CMD.STATUS_EX));
    } else {
      next.status = telemetry.status;
    }
    telemetry = next;
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (!wanted || suspendDepth > 0 || !port || !port.isOpen) { polling = false; return; }
      try {
        await pollOnce();
        errorStreak = 0;
        lastError = null;
      } catch (e) {
        errorStreak++;
        lastError = e.message;
        if (errorStreak >= MAX_CONSECUTIVE_ERRORS) {
          // FC unplugged or wedged — drop the connection cleanly.
          await hardClose();
          wanted = false;
          polling = false;
          return;
        }
      }
      schedulePoll();
    }, POLL_MS);
    polling = true;
  }

  async function hardClose() {
    if (pending) { clearTimeout(pending.timer); pending = null; }
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (port) {
      const p = port;
      port = null;
      try { await new Promise(r => p.close(() => r())); } catch {}
    }
    telemetry = null;
  }

  return {
    async connect(path) {
      if (port && port.isOpen && comPort === path) return { comPort, variant };
      await hardClose();
      port = await openPort(path);
      comPort = path;
      wanted = true;
      errorStreak = 0;
      lastError = null;
      try { variant = parseVariant(await request(CMD.FC_VARIANT, 1500)); }
      catch { variant = null; }
      schedulePoll();
      return { comPort, variant };
    },

    async disconnect() {
      wanted = false;
      await hardClose();
      comPort = null;
    },

    // Release the port so an exclusive op (CLI / 4-way / DFU) can use it.
    async suspend() {
      suspendDepth++;
      if (suspendDepth === 1 && port) {
        await hardClose();
        await sleep(150); // let the OS actually release the handle
      }
    },

    // Reopen after the op. The FC may be rebooting (post-save, post-flash) —
    // retry for a few seconds, then give up and report disconnected.
    async resume() {
      suspendDepth = Math.max(0, suspendDepth - 1);
      if (suspendDepth > 0 || !wanted || !comPort) return;
      for (let attempt = 0; attempt < 6; attempt++) {
        await sleep(attempt === 0 ? 400 : 1000);
        try {
          port = await openPort(comPort);
          errorStreak = 0;
          schedulePoll();
          return;
        } catch (e) {
          lastError = e.message;
        }
      }
      wanted = false;
      comPort = null;
    },

    isConnected() {
      return wanted && !!port && port.isOpen;
    },

    getState() {
      return {
        connected: this.isConnected(),
        suspended: suspendDepth > 0 && wanted,
        comPort: wanted ? comPort : null,
        variant: wanted ? variant : null,
        lastError,
        telemetry: this.isConnected() ? telemetry : null,
      };
    },
  };
}

// One-shot MSP command over a fresh port session — for actions like
// accelerometer calibration that don't need the persistent connection.
// Caller must hold the serial mutex (use serialOp in the server).
async function mspOneShot(comPort, cmd, { timeoutMs = 3000 } = {}) {
  const port = new SerialPort({ path: comPort, baudRate: 115200 });
  await new Promise((r, e) => { port.on('open', r); port.on('error', e); });
  port.on('error', () => {});
  try {
    await sleep(300);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MSP ${cmd} timed out`)), timeoutMs);
      const feed = msp.createParser((frame) => {
        if (frame.cmd === cmd) { clearTimeout(timer); resolve(frame.payload); }
      });
      port.on('data', feed);
      port.write(msp.encode(cmd));
    });
  } finally {
    await new Promise(r => port.close(() => r()));
  }
}

module.exports = { createConnection, mspOneShot, parseAttitude, parseAnalog, parseRc, parseMotor, parseStatus, parseStatusEx, parseVariant, parseRawImu, CMD };

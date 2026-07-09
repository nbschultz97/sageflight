// Onboard blackbox flash (dataflash) access over MSP: summary, full download,
// and chip erase. This closes the fly → download → analyze loop that used to
// require Betaflight Configurator.
//
// Protocol (Betaflight msp.c):
//   MSP_DATAFLASH_SUMMARY → u8 flags (bit0 ready, bit1 supported),
//                           u32 sectors, u32 totalSize, u32 usedSize
//   MSP_DATAFLASH_READ    → request u32 addr + u16 size + u8 allowCompression;
//                           reply u32 addr [+ u16 len + u8 format] + bytes.
//                           The 3-byte header is present when the request had
//                           the size field (API ≥1.31); we always send it and
//                           always request format 0 (no compression).
//   MSP_DATAFLASH_ERASE   → no payload; the FC erases the chip in the
//                           background — poll SUMMARY until ready + empty.
//
// EXPERIMENTAL like the frame decoder: spec-derived, synthetic-tested,
// not yet run against real hardware.

const { SerialPort } = require('serialport');
const msp = require('./msp');

const CHUNK_SIZE = 4096;          // jumbo-frame reads, same as Configurator
const MAX_FLASH_BYTES = 512 * 1024 * 1024; // sanity ceiling

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- pure payload parsers (unit-testable) ----------

function parseSummary(p) {
  if (!p || p.length < 13) return null;
  return {
    ready: (p[0] & 1) !== 0,
    supported: (p[0] & 2) !== 0,
    sectors: p.readUInt32LE(1),
    totalSize: p.readUInt32LE(5),
    usedSize: p.readUInt32LE(9),
  };
}

// Returns { address, data } or throws on compressed replies (we never ask
// for compression). Falls back to the legacy header (address only) if the
// reply is shorter than the modern 7-byte header.
function parseReadReply(p) {
  if (!p || p.length < 4) throw new Error('dataflash read reply too short');
  const address = p.readUInt32LE(0);
  if (p.length >= 7) {
    const len = p.readUInt16LE(4);
    const format = p[6];
    if (format !== 0) throw new Error(`compressed dataflash reply (format ${format}) not supported`);
    const data = p.slice(7, 7 + len);
    if (data.length !== len) throw new Error(`dataflash chunk truncated: header says ${len}, got ${data.length}`);
    return { address, data };
  }
  return { address, data: p.slice(4) };
}

function buildReadRequest(address, size) {
  const b = Buffer.alloc(7);
  b.writeUInt32LE(address, 0);
  b.writeUInt16LE(size, 4);
  b[6] = 0; // no compression
  return b;
}

// ---------- MSP session ----------

async function openMspSession(comPort) {
  const port = new SerialPort({ path: comPort, baudRate: 115200 });
  await new Promise((r, e) => { port.on('open', r); port.on('error', e); });
  port.on('error', () => {});
  await sleep(300);

  let pending = null;
  const feed = msp.createParser((frame) => {
    if (pending && frame.cmd === pending.cmd) {
      clearTimeout(pending.timer);
      const p = pending;
      pending = null;
      p.resolve(frame.payload);
    }
  });
  port.on('data', feed);

  function request(cmd, payload = Buffer.alloc(0), timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      if (pending) return reject(new Error('MSP request already in flight'));
      pending = {
        cmd, resolve,
        timer: setTimeout(() => { pending = null; reject(new Error(`MSP ${cmd} timed out`)); }, timeoutMs),
      };
      port.write(msp.encode(cmd, payload));
    });
  }

  return {
    request,
    close: () => new Promise(r => port.close(() => r())),
  };
}

async function readSummary(comPort) {
  const s = await openMspSession(comPort);
  try {
    return parseSummary(await s.request(msp.MSP.DATAFLASH_SUMMARY));
  } finally {
    await s.close();
  }
}

// Download the used portion of the flash. onProgress({ read, total }) fires
// per chunk. Returns a Buffer. Caller must hold the serial mutex.
async function downloadAll(comPort, onProgress = () => {}) {
  const s = await openMspSession(comPort);
  try {
    const summary = parseSummary(await s.request(msp.MSP.DATAFLASH_SUMMARY));
    if (!summary) throw new Error('no dataflash summary — firmware without onboard-flash support?');
    if (!summary.supported) throw new Error('this FC has no onboard blackbox flash (SD-card or serial logging board?)');
    if (!summary.ready) throw new Error('dataflash not ready (erase in progress?)');
    if (summary.usedSize === 0) return { summary, data: Buffer.alloc(0) };
    if (summary.usedSize > MAX_FLASH_BYTES) throw new Error(`implausible used size ${summary.usedSize}`);

    const chunks = [];
    let address = 0;
    let stall = 0;
    while (address < summary.usedSize) {
      const want = Math.min(CHUNK_SIZE, summary.usedSize - address);
      const reply = parseReadReply(await s.request(msp.MSP.DATAFLASH_READ, buildReadRequest(address, want), 6000));
      if (reply.address !== address) throw new Error(`dataflash address mismatch: asked ${address}, got ${reply.address}`);
      if (reply.data.length === 0) {
        // FC can briefly return empty chunks while busy — retry a few times.
        if (++stall > 5) throw new Error(`dataflash read stalled at ${address}`);
        await sleep(100);
        continue;
      }
      stall = 0;
      chunks.push(reply.data);
      address += reply.data.length;
      onProgress({ read: address, total: summary.usedSize });
    }
    return { summary, data: Buffer.concat(chunks) };
  } finally {
    await s.close();
  }
}

// Full chip erase. Destructive — the server gates this behind a safety token.
// Polls the summary until the chip reports ready+empty. Caller holds the mutex.
async function eraseAll(comPort, onProgress = () => {}, { timeoutMs = 300000 } = {}) {
  const s = await openMspSession(comPort);
  try {
    const before = parseSummary(await s.request(msp.MSP.DATAFLASH_SUMMARY));
    if (!before?.supported) throw new Error('this FC has no onboard blackbox flash');
    await s.request(msp.MSP.DATAFLASH_ERASE, Buffer.alloc(0), 10000);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(2000);
      let now = null;
      try { now = parseSummary(await s.request(msp.MSP.DATAFLASH_SUMMARY)); } catch {}
      if (now) onProgress({ ready: now.ready, usedSize: now.usedSize });
      if (now && now.ready && now.usedSize === 0) return { erased: true, totalSize: now.totalSize };
    }
    throw new Error('erase did not complete within the timeout');
  } finally {
    await s.close();
  }
}

module.exports = {
  parseSummary, parseReadReply, buildReadRequest, CHUNK_SIZE,
  openMspSession, readSummary, downloadAll, eraseAll,
};

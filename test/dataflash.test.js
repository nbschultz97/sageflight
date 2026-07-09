const { test } = require('node:test');
const assert = require('node:assert/strict');
const msp = require('../lib/msp');
const { parseSummary, parseReadReply, buildReadRequest, CHUNK_SIZE } = require('../lib/dataflash');

// Build an MSP v1 response frame ('>' direction), using jumbo framing when
// the payload exceeds 254 bytes — mirrors Betaflight's serializer.
function buildResponse(cmd, payload) {
  const jumbo = payload.length >= 255;
  const head = jumbo
    ? Buffer.from([0x24, 0x4d, 0x3e, 255, cmd, payload.length & 0xff, (payload.length >> 8) & 0xff])
    : Buffer.from([0x24, 0x4d, 0x3e, payload.length, cmd]);
  const frame = Buffer.concat([head, payload, Buffer.alloc(1)]);
  let crc = 0;
  for (let i = 3; i < frame.length - 1; i++) crc ^= frame[i];
  frame[frame.length - 1] = crc;
  return frame;
}

test('parser decodes a jumbo frame (4KB payload) split across chunks', () => {
  const payload = Buffer.alloc(4103); // 7-byte read header + 4096 data
  for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
  const frame = buildResponse(msp.MSP.DATAFLASH_READ, payload);

  const frames = [];
  const feed = msp.createParser(f => frames.push(f));
  // feed in awkward chunk sizes to exercise the state machine
  for (let i = 0; i < frame.length; i += 97) feed(frame.slice(i, i + 97));

  assert.equal(frames.length, 1);
  assert.equal(frames[0].cmd, msp.MSP.DATAFLASH_READ);
  assert.equal(frames[0].payload.length, 4103);
  assert.deepEqual([...frames[0].payload.slice(0, 4)], [0, 1, 2, 3]);
});

test('parser still decodes ordinary small frames after the jumbo change', () => {
  const payload = Buffer.from([1, 2, 3]);
  const frames = [];
  const feed = msp.createParser(f => frames.push(f));
  feed(buildResponse(101, payload));
  assert.equal(frames.length, 1);
  assert.deepEqual([...frames[0].payload], [1, 2, 3]);
});

test('parser drops a jumbo frame with corrupt crc and recovers', () => {
  const good = buildResponse(70, Buffer.alloc(13, 7));
  const bad = buildResponse(msp.MSP.DATAFLASH_READ, Buffer.alloc(300, 1));
  bad[bad.length - 1] ^= 0xff;
  const frames = [];
  const feed = msp.createParser(f => frames.push(f));
  feed(Buffer.concat([bad, good]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].cmd, 70);
});

test('parseSummary decodes flags and sizes', () => {
  const p = Buffer.alloc(13);
  p[0] = 0b11; // ready + supported
  p.writeUInt32LE(64, 1);        // sectors
  p.writeUInt32LE(16777216, 5);  // 16MB total
  p.writeUInt32LE(1048576, 9);   // 1MB used
  assert.deepEqual(parseSummary(p), {
    ready: true, supported: true, sectors: 64, totalSize: 16777216, usedSize: 1048576,
  });
  const empty = Buffer.alloc(13);
  assert.equal(parseSummary(empty).supported, false);
  assert.equal(parseSummary(Buffer.alloc(3)), null);
});

test('parseReadReply handles the modern 7-byte header', () => {
  const data = Buffer.from('LOGDATA!');
  const p = Buffer.alloc(7 + data.length);
  p.writeUInt32LE(8192, 0);
  p.writeUInt16LE(data.length, 4);
  p[6] = 0;
  data.copy(p, 7);
  const r = parseReadReply(p);
  assert.equal(r.address, 8192);
  assert.equal(r.data.toString(), 'LOGDATA!');
});

test('parseReadReply rejects compressed replies and truncated chunks', () => {
  const p = Buffer.alloc(17);
  p.writeUInt32LE(0, 0);
  p.writeUInt16LE(10, 4);
  p[6] = 1; // huffman
  assert.throws(() => parseReadReply(p), /compressed/);

  const t = Buffer.alloc(12); // header says 10 bytes, only 5 present
  t.writeUInt16LE(10, 4);
  assert.throws(() => parseReadReply(t), /truncated/);
});

test('buildReadRequest packs address, size, and no-compression flag', () => {
  const b = buildReadRequest(0x12345678, CHUNK_SIZE);
  assert.equal(b.readUInt32LE(0), 0x12345678);
  assert.equal(b.readUInt16LE(4), 4096);
  assert.equal(b[6], 0);
});

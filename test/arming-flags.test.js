const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeArmingFlags, FLAGS } = require('../lib/arming-flags');
const { parseStatusEx } = require('../lib/fc-connection');

test('decodeArmingFlags returns empty for zero', () => {
  assert.deepEqual(decodeArmingFlags(0), []);
});

test('decodeArmingFlags decodes known bits with fixes attached', () => {
  const mspBit = FLAGS.findIndex(f => f.name === 'MSP');
  const throttleBit = FLAGS.findIndex(f => f.name === 'THROTTLE');
  const active = decodeArmingFlags((1 << mspBit) | (1 << throttleBit));
  assert.equal(active.length, 2);
  const names = active.map(f => f.name);
  assert.ok(names.includes('MSP'));
  assert.ok(names.includes('THROTTLE'));
  for (const f of active) {
    assert.ok(f.meaning.length > 0);
    assert.ok(f.fix.length > 10);
  }
});

test('decodeArmingFlags surfaces unknown future bits', () => {
  const active = decodeArmingFlags(1 << 30);
  assert.equal(active.length, 1);
  assert.equal(active[0].name, 'UNKNOWN_30');
});

// Build a synthetic MSP_STATUS_EX payload per the Betaflight serializer.
function buildStatusEx({ cycleTime = 250, i2c = 0, flightMode = 0, extraBytes = 0, armingBits = 0 } = {}) {
  const b = Buffer.alloc(17 + extraBytes + 4 + 1);
  b.writeUInt16LE(cycleTime, 0);
  b.writeUInt16LE(i2c, 2);
  b.writeUInt16LE(0x1f, 4);          // sensors
  b.writeUInt32LE(flightMode, 6);
  b[10] = 0;                         // pid profile
  b.writeUInt16LE(12, 11);           // system load
  b[13] = 4;                         // profile count
  b[14] = 0;                         // rate profile
  b[15] = extraBytes;                // flight-mode extension length
  b[16 + extraBytes] = 26;           // arming disable flag count
  b.writeUInt32LE(armingBits, 17 + extraBytes);
  return b;
}

test('parseStatusEx extracts arming-disable flags after the variable extension', () => {
  const mspBit = FLAGS.findIndex(f => f.name === 'MSP');
  const s = parseStatusEx(buildStatusEx({ armingBits: 1 << mspBit, extraBytes: 1 }));
  assert.equal(s.cycleTime, 250);
  assert.equal(s.systemLoad, 12);
  assert.equal(s.armingDisableBits, 1 << mspBit);
  assert.equal(s.armingDisable.length, 1);
  assert.equal(s.armingDisable[0].name, 'MSP');
});

test('parseStatusEx degrades gracefully on short payloads', () => {
  const s = parseStatusEx(buildStatusEx().slice(0, 11));
  assert.equal(s.cycleTime, 250);
  assert.equal(s.armingDisable, undefined);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAttitude, parseAnalog, parseRc, parseMotor, parseStatus, parseVariant } = require('../lib/fc-connection');

function i16(...vals) {
  const b = Buffer.alloc(vals.length * 2);
  vals.forEach((v, i) => b.writeInt16LE(v, i * 2));
  return b;
}

test('parseAttitude decodes deci-degree roll/pitch and degree yaw', () => {
  const a = parseAttitude(i16(-123, 456, 270));
  assert.equal(a.roll, -12.3);
  assert.equal(a.pitch, 45.6);
  assert.equal(a.yaw, 270);
  assert.equal(parseAttitude(Buffer.alloc(3)), null);
});

test('parseAnalog prefers the precise appended voltage field', () => {
  // legacy vbat 16.8V (168), 1200 mAh, rssi 512/1023, 25.50A, precise 16.79V
  const b = Buffer.alloc(9);
  b[0] = 168;
  b.writeUInt16LE(1200, 1);
  b.writeUInt16LE(512, 3);
  b.writeInt16LE(2550, 5);
  b.writeUInt16LE(1679, 7);
  const a = parseAnalog(b);
  assert.equal(a.voltage, 16.79);
  assert.equal(a.mahDrawn, 1200);
  assert.equal(a.rssi, 50);
  assert.equal(a.amperage, 25.5);
});

test('parseAnalog falls back to the legacy 0.1V field on short payloads', () => {
  const b = Buffer.alloc(7);
  b[0] = 168;
  const a = parseAnalog(b);
  assert.equal(a.voltage, 16.8);
});

test('parseRc reads channel pairs', () => {
  const rc = parseRc(i16(1500, 1500, 1000, 1500, 2000, 1000));
  assert.deepEqual(rc.channels, [1500, 1500, 1000, 1500, 2000, 1000]);
  assert.equal(parseRc(Buffer.alloc(4)), null);
});

test('parseMotor reads up to 8 outputs', () => {
  const m = parseMotor(i16(1000, 1100, 1200, 1300, 0, 0, 0, 0));
  assert.equal(m.motors.length, 8);
  assert.equal(m.motors[3], 1300);
});

test('parseVariant decodes the 4-char firmware id', () => {
  assert.equal(parseVariant(Buffer.from('BTFL')), 'BTFL');
  assert.equal(parseVariant(Buffer.from('INAV')), 'INAV');
  assert.equal(parseVariant(Buffer.from('ab')), null);
  assert.equal(parseVariant(null), null);
});

test('parseStatus decodes cycle time, i2c errors, and armed flag', () => {
  const b = Buffer.alloc(11);
  b.writeUInt16LE(312, 0);   // cycleTime
  b.writeUInt16LE(2, 2);     // i2cErrors
  b.writeUInt16LE(0x1f, 4);  // sensors
  b.writeUInt32LE(1, 6);     // flightModeFlags — ARM box set
  b[10] = 1;                 // profile
  const s = parseStatus(b);
  assert.equal(s.cycleTime, 312);
  assert.equal(s.i2cErrors, 2);
  assert.equal(s.armed, true);
  assert.equal(s.profile, 1);
  const disarmed = parseStatus(Buffer.alloc(11));
  assert.equal(disarmed.armed, false);
});

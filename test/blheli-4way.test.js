const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CMD, ACK, crc16, buildFrame, createParser } = require('../lib/blheli-4way');

test('crc16 matches the CRC-16/XMODEM check value', () => {
  // Standard check input "123456789" -> 0x31C3
  assert.equal(crc16(Buffer.from('123456789')), 0x31c3);
});

test('buildFrame layout: start byte, cmd, addr, paramLen, param, crc', () => {
  const frame = buildFrame(CMD.DEVICE_READ, 0x1234, Buffer.from([0x10]));
  assert.equal(frame[0], 0x2f);
  assert.equal(frame[1], CMD.DEVICE_READ);
  assert.equal(frame[2], 0x12);
  assert.equal(frame[3], 0x34);
  assert.equal(frame[4], 1);
  assert.equal(frame[5], 0x10);
  const crc = crc16(frame.slice(0, 6));
  assert.equal(frame[6], (crc >> 8) & 0xff);
  assert.equal(frame[7], crc & 0xff);
});

test('buildFrame encodes a 256-byte param as paramLen=0', () => {
  const frame = buildFrame(CMD.DEVICE_WRITE, 0, Buffer.alloc(256, 0xab));
  assert.equal(frame[4], 0);
  assert.equal(frame.length, 5 + 256 + 2);
});

test('buildFrame rejects params over 256 bytes', () => {
  assert.throws(() => buildFrame(CMD.DEVICE_WRITE, 0, Buffer.alloc(257)), /param too large/);
});

// Build a response frame (interface -> host) for parser tests.
function buildResponse(cmd, addr, param, ack) {
  const body = Buffer.alloc(5 + param.length + 1);
  body[0] = 0x2e;
  body[1] = cmd;
  body[2] = (addr >> 8) & 0xff;
  body[3] = addr & 0xff;
  body[4] = param.length === 256 ? 0 : param.length;
  param.copy(body, 5);
  body[5 + param.length] = ack;
  const crc = crc16(body);
  return Buffer.concat([body, Buffer.from([(crc >> 8) & 0xff, crc & 0xff])]);
}

test('parser decodes a valid response', () => {
  const resp = buildResponse(CMD.INTERFACE_TEST_ALIVE, 0, Buffer.from([0]), ACK.OK);
  const frames = [];
  const feed = createParser(f => frames.push(f));
  feed(resp);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].cmd, CMD.INTERFACE_TEST_ALIVE);
  assert.equal(frames[0].ack, ACK.OK);
});

test('parser handles responses split across chunks', () => {
  const resp = buildResponse(CMD.DEVICE_READ, 0x0100, Buffer.from([1, 2, 3, 4]), ACK.OK);
  const frames = [];
  const feed = createParser(f => frames.push(f));
  feed(resp.slice(0, 3));
  feed(resp.slice(3, 7));
  feed(resp.slice(7));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].addr, 0x0100);
  assert.deepEqual([...frames[0].param], [1, 2, 3, 4]);
});

test('parser reports CRC mismatch via onError and keeps hunting', () => {
  const bad = buildResponse(CMD.DEVICE_READ, 0, Buffer.from([1]), ACK.OK);
  bad[bad.length - 1] ^= 0xff;
  const good = buildResponse(CMD.PROTOCOL_GET_VERSION, 0, Buffer.from([108]), ACK.OK);

  const frames = [];
  const errors = [];
  const feed = createParser(f => frames.push(f), e => errors.push(e));
  feed(Buffer.concat([bad, good]));

  assert.equal(errors.length >= 1, true);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].cmd, CMD.PROTOCOL_GET_VERSION);
});

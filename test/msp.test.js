const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encode, createParser, MSP } = require('../lib/msp');

test('encode builds a correct MSP v1 frame', () => {
  const frame = encode(MSP.API_VERSION);
  // $ M < size=0 cmd=1 crc=(0^1)
  assert.deepEqual([...frame], [0x24, 0x4d, 0x3c, 0x00, 0x01, 0x01]);
});

test('encode with payload computes XOR crc over size, cmd, payload', () => {
  const payload = Buffer.from([0xaa, 0x55]);
  const frame = encode(0x42, payload);
  assert.equal(frame[3], 2);          // size
  assert.equal(frame[4], 0x42);       // cmd
  assert.equal(frame[7], 2 ^ 0x42 ^ 0xaa ^ 0x55); // crc
});

test('encode rejects payloads over 255 bytes', () => {
  assert.throws(() => encode(1, Buffer.alloc(256)), /payload too large/);
});

test('parser decodes a frame the encoder produced (direction flipped)', () => {
  const payload = Buffer.from([1, 2, 3]);
  const frame = encode(101, payload);
  frame[2] = 0x3e; // '>' — as if from FC

  const frames = [];
  const feed = createParser(f => frames.push(f));
  feed(frame);

  assert.equal(frames.length, 1);
  assert.equal(frames[0].cmd, 101);
  assert.deepEqual([...frames[0].payload], [1, 2, 3]);
});

test('parser handles frames split across chunks', () => {
  const frame = encode(3, Buffer.from([9, 9]));
  const frames = [];
  const feed = createParser(f => frames.push(f));
  feed(frame.slice(0, 4));
  feed(frame.slice(4));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].cmd, 3);
});

test('parser silently drops corrupt frames and recovers on the next one', () => {
  const bad = encode(3, Buffer.from([9]));
  bad[bad.length - 1] ^= 0xff; // corrupt crc
  const good = encode(4, Buffer.from([7]));

  const frames = [];
  const feed = createParser(f => frames.push(f));
  feed(Buffer.concat([bad, good]));

  assert.equal(frames.length, 1);
  assert.equal(frames[0].cmd, 4);
});

test('parser ignores garbage between frames', () => {
  const frame = encode(1);
  const frames = [];
  const feed = createParser(f => frames.push(f));
  feed(Buffer.concat([Buffer.from('noise!!'), frame, Buffer.from([0x00, 0xff])]));
  assert.equal(frames.length, 1);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseIntelHex } = require('../lib/intel-hex');

// Classic Intel HEX example (64 data bytes at 0x0100).
const WIKI = [
  ':10010000214601360121470136007EFE09D2190140',
  ':100110002146017E17C20001FF5F16002148011928',
  ':10012000194E79234623965778239EDA3F01B2CAA7',
  ':100130003F0156702B5E712B722B732146013421C7',
  ':00000001FF',
].join('\n');

test('parses a classic 16-bit hex file', () => {
  const r = parseIntelHex(WIKI);
  assert.equal(r.baseAddress, 0x0100);
  assert.equal(r.totalBytes, 64);
  assert.equal(r.dataBytes, 64);
  assert.equal(r.image.length, 64);
  assert.equal(r.image[0], 0x21);
  assert.equal(r.image[63], 0x21);
});

test('extended linear address puts data at the STM32 flash base', () => {
  const hex = [
    ':020000040800F2',        // upper 16 bits = 0x0800
    ':04000000AABBCCDDEE',    // 4 bytes at 0x08000000
    ':00000001FF',
  ].join('\n');
  const r = parseIntelHex(hex);
  assert.equal(r.baseAddressHex, '0x08000000');
  assert.equal(r.totalBytes, 4);
  assert.deepEqual([...r.image], [0xaa, 0xbb, 0xcc, 0xdd]);
});

test('gaps between records are filled with 0xff (erased flash)', () => {
  const hex = [
    ':02000000AABB99',
    ':02001000CCDD45',
    ':00000001FF',
  ].join('\n');
  const r = parseIntelHex(hex);
  assert.equal(r.totalBytes, 18);
  assert.equal(r.dataBytes, 4);
  assert.equal(r.image[0], 0xaa);
  assert.equal(r.image[2], 0xff);
  assert.equal(r.image[15], 0xff);
  assert.equal(r.image[16], 0xcc);
});

test('rejects a corrupted checksum', () => {
  const bad = WIKI.replace('40\n', '41\n'); // flip first record's checksum
  assert.throws(() => parseIntelHex(bad), /checksum/);
});

test('rejects a file with no EOF record', () => {
  assert.throws(() => parseIntelHex(':02000000AABB99\n'), /EOF/);
});

test('rejects garbage input', () => {
  assert.throws(() => parseIntelHex('not a hex file'));
  assert.throws(() => parseIntelHex(''));
});

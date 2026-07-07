const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSettingsStrings, refineFamily } = require('../lib/esc-4way');
const sigs = require('../lib/esc-signatures');

function makeSettingsBuffer({ main = 16, sub = 7, layoutRev = 33, layout = '#BLHELI$EFM8B21#', mcu = '#BLHELI#EFM8B21#', name = 'Bluejay (BETA)' } = {}) {
  const buf = Buffer.alloc(128, 0xff);
  buf[0] = main; buf[1] = sub; buf[2] = layoutRev;
  buf.write(layout.padEnd(16, ' '), 0x40, 'latin1');
  buf.write(mcu.padEnd(16, ' '), 0x50, 'latin1');
  buf.write(name.padEnd(16, ' '), 0x60, 'latin1');
  return buf;
}

test('parseSettingsStrings extracts revision and the three 16-byte strings', () => {
  const s = parseSettingsStrings(makeSettingsBuffer());
  assert.equal(s.fwRevision, '16.7');
  assert.equal(s.layoutRevision, 33);
  assert.equal(s.layout, '#BLHELI$EFM8B21#');
  assert.equal(s.mcu, '#BLHELI#EFM8B21#');
  assert.equal(s.name, 'Bluejay (BETA)');
});

test('parseSettingsStrings tolerates non-printable padding', () => {
  const buf = makeSettingsBuffer({ name: 'JESC' });
  buf[0x64] = 0x00; // stray NUL inside the name field
  const s = parseSettingsStrings(buf);
  assert.equal(s.name, 'JESC');
});

test('parseSettingsStrings returns null for short buffers', () => {
  assert.equal(parseSettingsStrings(Buffer.alloc(16)), null);
  assert.equal(parseSettingsStrings(null), null);
});

test('refineFamily prefers EEPROM firmware strings over chip signature', () => {
  assert.equal(refineFamily('BLHeli_S', { name: 'Bluejay (BETA)' }), 'Bluejay');
  assert.equal(refineFamily('BLHeli_S', { layout: '#JESC$EFM8B21#' }), 'JESC');
  assert.equal(refineFamily('BLHeli_S', { name: '16.7' }), 'BLHeli_S');
  assert.equal(refineFamily('BLHeli_S', null), 'BLHeli_S');
});

test('signature lookup identifies known chips and guesses unknown ones', () => {
  assert.equal(sigs.lookup(0xE8B2).mcu, 'EFM8BB21F16');
  assert.equal(sigs.lookup(0xE8B2).signatureKnown, true);
  assert.equal(sigs.lookup(0xB2E8).family, 'Bluejay');
  assert.match(sigs.lookup(0x2F99).family, /unknown/i);
  assert.equal(sigs.lookup(0x2F99).signatureKnown, false);
});

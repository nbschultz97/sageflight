const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHeaders, selectTuningSettings } = require('../lib/blackbox-header');

const HEADER = [
  'H Product:Blackbox flight data recorder by Nicholas Sherlock',
  'H Data version:2',
  'H Firmware revision:Betaflight 4.5.1 (77d01ba3b) STM32F7X2',
  'H Board information:SPBE SPEEDYBEEF7V3',
  'H Craft name:sage-test',
  'H Field I name:loopIteration,time,axisP[0],axisP[1]',
  'H looptime:125',
  'H gyro_lowpass_hz:250',
  'H dyn_notch_count:3',
  'H rates:73,73,73',
  'H rollPID:45,80,40',
  'H motorOutput:48,2047',
  'H vbatref:420',
  'H deadband:0',
].join('\n');

test('parseHeaders extracts identity and settings', () => {
  const binaryTail = Buffer.concat([Buffer.from(HEADER + '\n', 'latin1'), Buffer.from([0x00, 0xff, 0x45, 0x12])]);
  const p = parseHeaders(binaryTail);
  assert.equal(p.logCount, 1);
  assert.match(p.firmware, /Betaflight 4\.5\.1/);
  assert.equal(p.craft, 'sage-test');
  assert.equal(p.settings['looptime'], '125');
  assert.equal(p.settings['rollPID'], '45,80,40');
});

test('parseHeaders counts multiple flights and keeps the last values', () => {
  const two = HEADER + '\nH gyro_lowpass_hz:250\n' + HEADER.replace('250', '300');
  const p = parseHeaders(Buffer.from(two, 'latin1'));
  assert.equal(p.logCount, 2);
  assert.equal(p.settings['gyro_lowpass_hz'], '300');
});

test('parseHeaders returns null for non-blackbox data', () => {
  assert.equal(parseHeaders(Buffer.from('not a log')), null);
  assert.equal(parseHeaders(Buffer.alloc(0)), null);
});

test('selectTuningSettings keeps tuning keys and drops field definitions', () => {
  const p = parseHeaders(Buffer.from(HEADER, 'latin1'));
  const t = selectTuningSettings(p.settings);
  assert.ok('gyro_lowpass_hz' in t);
  assert.ok('rollPID' in t);
  assert.ok('rates' in t);
  assert.ok(!('Field I name' in t));
  assert.ok(!('Craft name' in t));
});

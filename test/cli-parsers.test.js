const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSetLines, extractTune, parseAuxLines, buildAuxCommand, BOX_NAMES } = require('../lib/cli-parsers');
const { parseRawImu } = require('../lib/fc-connection');

const DUMP = [
  '# dump',
  'board_name SPEEDYBEEF405V3',
  'set gyro_lpf1_static_hz = 250',
  'set dyn_notch_count = 3',
  'set p_roll = 45',
  'set i_roll = 80',
  'set d_roll = 40',
  'set f_roll = 120',
  'set roll_rc_rate = 7',
  'set roll_srate = 67',
  'set some_unrelated_thing = ON',
  'set osd_vbat_pos = 2433',
].join('\r\n');

test('parseSetLines builds a flat settings map', () => {
  const s = parseSetLines(DUMP);
  assert.equal(s.p_roll, '45');
  assert.equal(s.gyro_lpf1_static_hz, '250');
  assert.equal(s.some_unrelated_thing, 'ON');
  assert.equal('board_name' in s, false);
});

test('extractTune groups only the tuning surface, only present keys', () => {
  const groups = extractTune(parseSetLines(DUMP));
  const byGroup = Object.fromEntries(groups.map(g => [g.group, g.values]));
  assert.equal(byGroup.pids.p_roll, '45');
  assert.equal(byGroup.rates.roll_srate, '67');
  assert.equal(byGroup.filters.dyn_notch_count, '3');
  assert.equal('some_unrelated_thing' in (byGroup.pids || {}), false);
  assert.equal('simplified' in byGroup, false); // none present in this dump
});

const AUX = [
  'aux 0 0 0 1700 2100 0 0',
  'aux 1 1 1 900 1300 0 0',
  'aux 2 0 0 900 900 0 0',
].join('\n');

test('parseAuxLines decodes slots with box names and active flag', () => {
  const slots = parseAuxLines(AUX);
  assert.equal(slots.length, 3);
  assert.equal(slots[0].boxName, 'ARM');
  assert.equal(slots[0].active, true);
  assert.equal(slots[1].boxName, 'ANGLE');
  assert.equal(slots[1].start, 900);
  assert.equal(slots[2].active, false);
});

test('buildAuxCommand round-trips a slot', () => {
  const [slot] = parseAuxLines('aux 3 27 2 1400 1600 0 0');
  assert.equal(buildAuxCommand(slot), 'aux 3 27 2 1400 1600 0 0');
  assert.equal(BOX_NAMES[27], 'FAILSAFE');
});

test('parseRawImu decodes 9 int16 sensor values', () => {
  const b = Buffer.alloc(18);
  [10, -20, 512, 1, -2, 3, 0, 0, 0].forEach((v, i) => b.writeInt16LE(v, i * 2));
  const imu = parseRawImu(b);
  assert.deepEqual(imu.acc, [10, -20, 512]);
  assert.deepEqual(imu.gyro, [1, -2, 3]);
  assert.equal(parseRawImu(Buffer.alloc(10)), null);
});

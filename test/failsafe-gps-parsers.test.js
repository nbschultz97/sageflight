const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRxfailLines, buildRxfailCommand, FAILSAFE_GROUPS, GPS_KEYS, extractKeys, parseSetLines,
} = require('../lib/cli-parsers');

const RXFAIL_OUTPUT = `
# rxfail
rxfail 0 a
rxfail 1 a
rxfail 2 a
rxfail 3 a
rxfail 4 s 1800
rxfail 5 h
rxfail 6 s 1000
rxfail 7 h
`;

test('parseRxfailLines reads channel, mode, and set values', () => {
  const ch = parseRxfailLines(RXFAIL_OUTPUT);
  assert.equal(ch.length, 8);
  assert.deepEqual(ch[0], { channel: 0, mode: 'a', value: null });
  assert.deepEqual(ch[4], { channel: 4, mode: 's', value: 1800 });
  assert.deepEqual(ch[5], { channel: 5, mode: 'h', value: null });
});

test('buildRxfailCommand round-trips through parseRxfailLines', () => {
  const ch = parseRxfailLines(RXFAIL_OUTPUT);
  const rebuilt = parseRxfailLines(ch.map(buildRxfailCommand).join('\n'));
  assert.deepEqual(rebuilt, ch);
});

test('buildRxfailCommand defaults a missing set value to 1500', () => {
  assert.equal(buildRxfailCommand({ channel: 4, mode: 's', value: null }), 'rxfail 4 s 1500');
  assert.equal(buildRxfailCommand({ channel: 2, mode: 'a', value: 1700 }), 'rxfail 2 a');
});

test('failsafe groups extract only present keys from a dump', () => {
  const dump = `
set failsafe_delay = 15
set failsafe_off_delay = 10
set failsafe_throttle = 1150
set failsafe_procedure = GPS-RESCUE
set gps_rescue_min_sats = 8
set gps_rescue_return_alt = 30
set some_unrelated_thing = 42
`;
  const settings = parseSetLines(dump);
  const stage2 = extractKeys(settings, FAILSAFE_GROUPS.find(g => g.group === 'stage2').keys);
  const rescue = extractKeys(settings, FAILSAFE_GROUPS.find(g => g.group === 'gpsRescue').keys);
  assert.deepEqual(stage2, {
    failsafe_procedure: 'GPS-RESCUE', failsafe_delay: '15',
    failsafe_off_delay: '10', failsafe_throttle: '1150',
  });
  assert.deepEqual(rescue, { gps_rescue_min_sats: '8', gps_rescue_return_alt: '30' });
  assert.ok(!('some_unrelated_thing' in stage2));
});

test('GPS keys extract from a dump', () => {
  const settings = parseSetLines('set gps_provider = UBLOX\nset gps_sbas_mode = AUTO\nset gps_auto_config = ON\n');
  assert.deepEqual(extractKeys(settings, GPS_KEYS), {
    gps_provider: 'UBLOX', gps_sbas_mode: 'AUTO', gps_auto_config: 'ON',
  });
});

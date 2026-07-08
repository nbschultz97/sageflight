const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseVtxTable, parseGetLines, extractVtxSettings,
  validateVtxTable, buildVtxTableCommands,
} = require('../lib/vtx');

const SAMPLE_TABLE = `
# vtxtable
vtxtable bands 5
vtxtable channels 8
vtxtable band 1 BOSCAM_A A FACTORY 5865 5845 5825 5805 5785 5765 5745 5725
vtxtable band 2 BOSCAM_B B FACTORY 5733 5752 5771 5790 5809 5828 5847 5866
vtxtable band 3 BOSCAM_E E FACTORY    0    0    0    0 5885 5905    0    0
vtxtable band 4 FATSHARK F FACTORY 5740 5760 5780 5800 5820 5840 5860 5880
vtxtable band 5 RACEBAND R FACTORY 5658 5695 5732 5769 5806 5843 5880 5917
vtxtable powerlevels 3
vtxtable powervalues 14 23 27
vtxtable powerlabels 25 200 500
`;

test('parseVtxTable reads counts, bands, and power rows', () => {
  const t = parseVtxTable(SAMPLE_TABLE);
  assert.equal(t.supported, true);
  assert.equal(t.bands, 5);
  assert.equal(t.channels, 8);
  assert.equal(t.bandRows.length, 5);
  assert.equal(t.bandRows[0].name, 'BOSCAM_A');
  assert.equal(t.bandRows[0].letter, 'A');
  assert.equal(t.bandRows[0].factory, true);
  assert.deepEqual(t.bandRows[4].frequencies, [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917]);
  assert.deepEqual(t.bandRows[2].frequencies, [0, 0, 0, 0, 5885, 5905, 0, 0]);
  assert.equal(t.powerLevels, 3);
  assert.deepEqual(t.powerValues, [14, 23, 27]);
  assert.deepEqual(t.powerLabels, ['25', '200', '500']);
});

test('parseVtxTable flags unsupported firmware output', () => {
  const t = parseVtxTable('unknown command, try help');
  assert.equal(t.supported, false);
  const empty = parseVtxTable('');
  assert.equal(empty.supported, false);
  assert.equal(empty.bands, 0);
});

test('buildVtxTableCommands round-trips through parseVtxTable', () => {
  const t = parseVtxTable(SAMPLE_TABLE);
  const cmds = buildVtxTableCommands(t);
  assert.equal(cmds[0], 'vtxtable bands 5');
  assert.equal(cmds[1], 'vtxtable channels 8');
  assert.equal(cmds.length, 2 + 5 + 3);
  const reparsed = parseVtxTable(cmds.join('\n'));
  assert.deepEqual(reparsed.bandRows, t.bandRows);
  assert.deepEqual(reparsed.powerValues, t.powerValues);
  assert.deepEqual(reparsed.powerLabels, t.powerLabels);
});

test('validateVtxTable accepts the sample and catches bad values', () => {
  const good = parseVtxTable(SAMPLE_TABLE);
  assert.deepEqual(validateVtxTable(good), []);

  const bad = parseVtxTable(SAMPLE_TABLE);
  bad.bandRows[0].frequencies[0] = 4200;       // below legal range
  bad.bandRows[1].name = 'WAY_TOO_LONG_NAME';  // > 8 chars
  bad.powerLabels[0] = 'FOUR';                 // > 3 chars
  bad.powerValues[1] = -5;                     // negative
  const errors = validateVtxTable(bad);
  assert.ok(errors.some(e => e.includes('4200')));
  assert.ok(errors.some(e => e.includes('band 2')));
  assert.ok(errors.some(e => e.includes('powerlabel') || e.includes('labels')));
  assert.ok(errors.some(e => e.includes('-5') || e.includes('powervalue')));
});

test('validateVtxTable catches count mismatches', () => {
  const t = parseVtxTable(SAMPLE_TABLE);
  t.bandRows[0].frequencies.pop();
  t.powerLabels.pop();
  const errors = validateVtxTable(t);
  assert.ok(errors.some(e => e.includes('exactly 8 frequencies')));
  assert.ok(errors.some(e => e.includes('powerlabels')));
});

test('parseGetLines + extractVtxSettings pull vtx_* values from `get vtx` output', () => {
  const out = `
vtx_band = 5
Allowed range: 0 - 8
Default value: 0

vtx_channel = 1
Allowed range: 0 - 8

vtx_power = 2
Allowed range: 0 - 8

vtx_low_power_disarm = UNTIL_FIRST_ARM
Allowed values: OFF, ON, UNTIL_FIRST_ARM

vtx_freq = 5658
Allowed range: 0 - 5999

vtx_pit_mode_freq = 0
Allowed range: 0 - 5999
`;
  const settings = extractVtxSettings(parseGetLines(out));
  assert.equal(settings.vtx_band, '5');
  assert.equal(settings.vtx_channel, '1');
  assert.equal(settings.vtx_power, '2');
  assert.equal(settings.vtx_low_power_disarm, 'UNTIL_FIRST_ARM');
  assert.equal(settings.vtx_freq, '5658');
  assert.equal(settings.vtx_pit_mode_freq, '0');
});

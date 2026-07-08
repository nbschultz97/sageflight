const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePreset, buildPresetCommands, filterIndex } = require('../lib/presets');
const { searchParts, flattenParts } = require('../lib/catalog');
const { parseSerialLines, buildSerialCommand } = require('../lib/cli-parsers');

// ---------- presets ----------

const PRESET = [
  '#$ TITLE: Test tune',
  '#$ FIRMWARE_VERSION: 4.5',
  '# a human comment',
  'set p_roll = 50',
  'set i_roll = 90',
  '#$ OPTION BEGIN (UNCHECKED): Stronger filtering',
  'set gyro_lpf1_static_hz = 200',
  '#$ OPTION END',
  '#$ OPTION BEGIN (CHECKED): Feedforward boost',
  'set f_roll = 150',
  '#$ OPTION END',
].join('\n');

test('parsePreset separates base lines from option blocks', () => {
  const p = parsePreset(PRESET);
  assert.deepEqual(p.base, ['set p_roll = 50', 'set i_roll = 90']);
  assert.equal(p.options.length, 2);
  assert.equal(p.options[0].name, 'Stronger filtering');
  assert.equal(p.options[0].checkedByDefault, false);
  assert.equal(p.options[1].checkedByDefault, true);
  assert.deepEqual(p.options[1].lines, ['set f_roll = 150']);
});

test('buildPresetCommands includes only checked options and appends save', () => {
  const p = parsePreset(PRESET);
  const cmds = buildPresetCommands(p, ['Feedforward boost']);
  assert.deepEqual(cmds, ['set p_roll = 50', 'set i_roll = 90', 'set f_roll = 150', 'save']);
});

test('filterIndex matches query/category/firmware and hides hidden presets', () => {
  const index = {
    presets: {
      a: { title: 'Freestyle tune', category: 'TUNE', keywords: ['5inch'], firmware_version: ['4.5'], path: 'a.txt' },
      b: { title: 'ELRS setup', category: 'RC_LINK', keywords: ['elrs'], firmware_version: ['4.3'], path: 'b.txt' },
      c: { title: 'Hidden thing', category: 'TUNE', hidden: true, path: 'c.txt' },
    },
  };
  assert.equal(filterIndex(index, {}).length, 2);
  assert.equal(filterIndex(index, { query: 'freestyle' })[0].title, 'Freestyle tune');
  assert.equal(filterIndex(index, { category: 'RC_LINK' }).length, 1);
  assert.equal(filterIndex(index, { firmware: '4.5.1' }).length, 1);
  assert.equal(filterIndex(index, { firmware: '4.5.1' })[0].title, 'Freestyle tune');
});

// ---------- catalog ----------

const CATALOG = {
  meta: { name: 'test' },
  motors: [
    { id: 'm1', name: 'T-Motor F60 Pro V', kv: 1950, tags: ['5-inch'], max_current_a: 40 },
    { id: 'm2', name: 'Happymodel EX0802', kv: 19000, tags: ['whoop'] },
  ],
  escs: [
    { id: 'e1', name: 'SpeedyBee BLS 50A 4-in-1', current_a: 50, tags: ['blheli_s'] },
  ],
};

test('flattenParts tags each part with its category', () => {
  const parts = flattenParts(CATALOG);
  assert.equal(parts.length, 3);
  assert.equal(parts.find(p => p.id === 'e1').category, 'escs');
});

test('searchParts finds by name/tags and ranks name matches first', () => {
  const r = searchParts(CATALOG, '50A esc');
  assert.ok(r.length >= 1);
  assert.equal(r[0].id, 'e1');
  const whoop = searchParts(CATALOG, 'whoop');
  assert.equal(whoop[0].id, 'm2');
  const byName = searchParts(CATALOG, 'EX0802');
  assert.equal(byName[0].id, 'm2');
  assert.deepEqual(searchParts(CATALOG, ''), []);
});

// ---------- serial ports ----------

test('parseSerialLines decodes function bitmasks and port labels', () => {
  const ports = parseSerialLines([
    'serial 20 1 115200 57600 0 115200',
    'serial 0 64 115200 57600 0 115200',
    'serial 1 2048 115200 57600 0 115200',
    'serial 30 0 115200 57600 0 115200',
  ].join('\n'));
  assert.equal(ports.length, 4);
  assert.equal(ports[0].label, 'USB VCP');
  assert.deepEqual(ports[0].functions, ['MSP']);
  assert.equal(ports[1].label, 'UART1');
  assert.deepEqual(ports[1].functions, ['SERIAL RX']);
  assert.deepEqual(ports[2].functions, ['VTX SMARTAUDIO']);
  assert.equal(ports[3].label, 'SOFTSERIAL1');
  assert.equal(buildSerialCommand(ports[1]), 'serial 0 64 115200 57600 0 115200');
});

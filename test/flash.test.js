const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDfuList } = require('../lib/flash');

const SAMPLE = `dfu-util 0.11

Found DFU: [0483:df11] ver=2200, devnum=6, cfg=1, intf=0, path="1-2", alt=1, name="@Option Bytes  /0x1FFFC000/01*016 e", serial="356A35593339"
Found DFU: [0483:df11] ver=2200, devnum=6, cfg=1, intf=0, path="1-2", alt=0, name="@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg", serial="356A35593339"
`;

test('parseDfuList extracts DFU device entries', () => {
  const devices = parseDfuList(SAMPLE);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].vid, '0483');
  assert.equal(devices[0].pid, 'df11');
  assert.equal(devices[1].alt, 0);
  assert.match(devices[1].name, /Internal Flash/);
});

test('parseDfuList returns empty for no-device output', () => {
  assert.deepEqual(parseDfuList('dfu-util 0.11\n\n'), []);
  assert.deepEqual(parseDfuList(''), []);
  assert.deepEqual(parseDfuList(null), []);
});

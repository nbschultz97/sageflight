const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeOsdPos, encodeOsdPos, extractOsdElements, canvasFromSettings, friendlyName } = require('../lib/osd');

test('decodeOsdPos matches known Betaflight values', () => {
  // 2433 = 0x981: x=1, y=12, profile1 visible — the classic osd_vbat_pos.
  const d = decodeOsdPos(2433);
  assert.equal(d.x, 1);
  assert.equal(d.y, 12);
  assert.deepEqual(d.profiles, [true, false, false]);
});

test('encode/decode round-trips including the HD extension bit', () => {
  for (const pos of [
    { x: 0, y: 0, profiles: [false, false, false] },
    { x: 31, y: 15, profiles: [true, false, true] },
    { x: 45, y: 10, profiles: [true, true, true] },   // x > 31 needs bit 10
    { x: 63, y: 31, profiles: [false, true, false] },
  ]) {
    const d = decodeOsdPos(encodeOsdPos(pos));
    assert.equal(d.x, pos.x, `x for ${JSON.stringify(pos)}`);
    assert.equal(d.y, pos.y);
    assert.deepEqual(d.profiles, pos.profiles);
  }
});

test('extractOsdElements pulls osd_*_pos keys with names', () => {
  const els = extractOsdElements({
    osd_vbat_pos: '2433',
    osd_rssi_pos: '2113',
    osd_units: 'METRIC',       // not a _pos key
    some_other: '1',
  });
  assert.equal(els.length, 2);
  const vbat = els.find(e => e.key === 'osd_vbat_pos');
  assert.equal(vbat.name, 'Battery voltage');
  assert.equal(vbat.x, 1);
});

test('canvasFromSettings prefers HD canvas, falls back to analog', () => {
  assert.deepEqual(canvasFromSettings({ osd_canvas_width: '53', osd_canvas_height: '20' }), { cols: 53, rows: 20, hd: true });
  assert.deepEqual(canvasFromSettings({ video_system: 'NTSC' }), { cols: 30, rows: 13, hd: false });
  assert.deepEqual(canvasFromSettings({}), { cols: 30, rows: 16, hd: false });
});

test('friendlyName prettifies unknown keys', () => {
  assert.equal(friendlyName('osd_fancy_new_thing_pos'), 'fancy new thing');
});

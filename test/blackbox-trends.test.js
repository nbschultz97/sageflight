const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trendPoint, groupLogsForTrends } = require('../lib/blackbox-analyze');

const METRICS = {
  durationSec: 122.5,
  gyro: [
    { axis: 'roll', available: true, rmsDegS: 14.2, peaks: [{ hz: 142.5, mag: 0.9, ratioToFloor: 8.1 }] },
    { axis: 'pitch', available: true, rmsDegS: 11.8, peaks: [] },
    { axis: 'yaw', available: true, rmsDegS: 7.3, peaks: [] },
  ],
  stepResponse: [
    { axis: 'roll', riseMs: 38.5, overshootPct: 12.2 },
    { axis: 'pitch', riseMs: 41.0, overshootPct: 8.7 },
  ],
  motorImbalance: 43,
};

test('trendPoint compacts cached metrics into one comparable point', () => {
  const p = trendPoint(METRICS);
  assert.equal(p.durationSec, 122.5);
  assert.deepEqual(p.rms, { roll: 14.2, pitch: 11.8, yaw: 7.3 });
  assert.equal(p.peakHz, 142.5);
  assert.equal(p.peakRatio, 8.1);
  assert.deepEqual(p.riseMs, { roll: 38.5, pitch: 41.0 });
  assert.deepEqual(p.overshootPct, { roll: 12.2, pitch: 8.7 });
  assert.equal(p.motorImbalance, 43);
});

test('trendPoint tolerates missing sections', () => {
  const p = trendPoint({ durationSec: 10 });
  assert.equal(p.rms.roll, null);
  assert.equal(p.peakHz, null);
  assert.equal(p.riseMs.roll, null);
  assert.equal(trendPoint(null), null);
});

test('groupLogsForTrends groups by craft with board fallback, oldest first', () => {
  const groups = groupLogsForTrends([
    { name: 'c', uploadedAt: '2026-07-03', craft: 'Quinn' },
    { name: 'a', uploadedAt: '2026-07-01', craft: 'Quinn' },
    { name: 'b', uploadedAt: '2026-07-02', board: 'ACROSKYF405' },
    { name: 'd', uploadedAt: '2026-07-04' },
  ]);
  assert.deepEqual([...groups.keys()].sort(), ['ACROSKYF405', 'Quinn', 'unnamed craft']);
  assert.deepEqual(groups.get('Quinn').map(l => l.name), ['a', 'c']);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFleet, normBoard } = require('../lib/fleet');

test('normBoard uppercases and rejects unknown placeholders', () => {
  assert.equal(normBoard(' acroskyF405 '), 'ACROSKYF405');
  assert.equal(normBoard('unknown-board'), null);
  assert.equal(normBoard(''), null);
});

test('buildFleet groups backups and logs by board with merged timelines', () => {
  const fleet = buildFleet({
    backups: [
      { id: 'b1', createdAt: '2026-07-01T10:00:00Z', boardName: 'ACROSKYF405' },
      { id: 'b2', createdAt: '2026-07-03T10:00:00Z', boardName: 'acroskyf405', auto: true, reason: 'pre-write snapshot' },
      { id: 'b3', createdAt: '2026-07-02T10:00:00Z', boardName: 'SPEEDYBEEF7' },
    ],
    logs: [
      { name: 'l1', uploadedAt: '2026-07-04T10:00:00Z', board: 'ACROSKYF405', craft: 'FiveInchFreestyle', bytes: 1024 },
      { name: 'l2', uploadedAt: '2026-07-05T10:00:00Z', board: null, bytes: 2048 },
    ],
    history: [{ at: '2026-07-05T10:00:00Z', kind: 'motor.spin', motor: 1, pwm: 1070 }],
    forensicUnits: [{ batch: 'default', label: 'U-01', status: 'DEAD', mcuId: 'abc', lastScanAt: '2026-06-01T00:00:00Z' }],
  });

  assert.equal(fleet.boards.length, 3);
  const acro = fleet.boards.find(b => b.board === 'ACROSKYF405');
  assert.equal(acro.backupCount, 2);
  assert.equal(acro.logCount, 1);
  assert.deepEqual(acro.crafts, ['FiveInchFreestyle']);
  // newest first
  assert.equal(acro.events[0].type, 'log');
  assert.equal(acro.lastSeen, '2026-07-04T10:00:00Z');
  assert.equal(acro.firstSeen, '2026-07-01T10:00:00Z');
  // diff pairs: newest backup vs the one before it
  assert.deepEqual(acro.diffPairs[0], { from: 'b1', to: 'b2', at: '2026-07-03T10:00:00Z' });

  const unident = fleet.boards.find(b => b.board === 'UNIDENTIFIED');
  assert.equal(unident.logCount, 1);

  assert.equal(fleet.benchActivity.length, 1);
  assert.equal(fleet.caseHistory[0].label, 'U-01');
});

test('buildFleet sorts boards by recency and handles empty input', () => {
  const empty = buildFleet({});
  assert.deepEqual(empty.boards, []);

  const fleet = buildFleet({
    backups: [
      { id: 'old', createdAt: '2026-01-01T00:00:00Z', boardName: 'OLDBOARD' },
      { id: 'new', createdAt: '2026-07-01T00:00:00Z', boardName: 'NEWBOARD' },
    ],
  });
  assert.equal(fleet.boards[0].board, 'NEWBOARD');
  assert.equal(fleet.boards[0].diffPairs.length, 0);
});

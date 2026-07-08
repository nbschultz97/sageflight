const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateLoadout, summarizeLoadout, verifyAgainstBench, checklistAirframe } = require('../lib/loadout');

const GOOD = {
  loadoutVersion: 1,
  name: 'Recon 5-inch — Build A',
  airframeClass: '5in-freestyle',
  firmware: { family: 'Betaflight', target: 'SPEEDYBEEF405V3', targetVersion: '4.5' },
  components: [
    { role: 'flight_controller', name: 'SpeedyBee F405 V3', part_number: 'SB-F405-V3' },
    { role: 'esc', name: 'BLS 50A 4-in-1', specs: { firmware_family: 'BLHeli_S' } },
    { role: 'motor', name: 'F60 Pro V', quantity: 4 },
  ],
};

test('validateLoadout accepts a well-formed loadout', () => {
  const v = validateLoadout(GOOD);
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test('validateLoadout rejects bad shapes with specific errors', () => {
  assert.equal(validateLoadout(null).ok, false);
  assert.equal(validateLoadout({}).ok, false);
  const badRole = validateLoadout({ ...GOOD, components: [{ role: 'warp_drive', name: 'x' }] });
  assert.equal(badRole.ok, false);
  assert.match(badRole.errors[0], /role/);
  const badQty = validateLoadout({ ...GOOD, components: [{ role: 'motor', name: 'm', quantity: 99 }] });
  assert.equal(badQty.ok, false);
});

test('summarizeLoadout pulls the bench-relevant facts', () => {
  const s = summarizeLoadout(GOOD);
  assert.equal(s.motorCount, 4);
  assert.equal(s.flightController, 'SpeedyBee F405 V3');
  assert.equal(s.firmware.target, 'SPEEDYBEEF405V3');
});

test('verifyAgainstBench passes a matching bench', () => {
  const r = verifyAgainstBench(GOOD, {
    scan: { boardName: 'SPEEDYBEEF405V3', fwVariant: 'Betaflight', firmware: '4.5.1' },
    escScan: { results: [0, 1, 2, 3].map(m => ({ motor: m, responsive: true, family: 'BLHeli_S' })) },
  });
  assert.equal(r.verdict, 'MATCHES_PLAN');
  assert.equal(r.failed, 0);
  assert.ok(r.passed >= 4);
});

test('verifyAgainstBench flags mismatches', () => {
  const r = verifyAgainstBench(GOOD, {
    scan: { boardName: 'MATEKF722', fwVariant: 'INAV', firmware: '7.1.0' },
    escScan: { results: [{ motor: 0, responsive: true, family: 'AM32' }, { motor: 1, responsive: false }] },
  });
  assert.equal(r.verdict, 'MISMATCH');
  const byName = Object.fromEntries(r.checks.map(c => [c.check, c.status]));
  assert.equal(byName['FC board target'], 'fail');
  assert.equal(byName['Firmware family'], 'fail');
  assert.equal(byName['Responsive ESC slots'], 'fail');
  assert.equal(byName['ESC firmware family'], 'fail');
});

test('verifyAgainstBench degrades to unknown without bench data', () => {
  const r = verifyAgainstBench(GOOD, {});
  assert.equal(r.verdict, 'INSUFFICIENT_DATA');
  assert.ok(r.checks.every(c => c.status === 'unknown'));
});

test('checklistAirframe maps loadout classes onto checklist sets', () => {
  assert.equal(checklistAirframe({ airframeClass: '5in-freestyle' }), 'freestyle5');
  assert.equal(checklistAirframe({ airframeClass: 'Tiny Whoop 65mm' }), 'whoop');
  assert.equal(checklistAirframe({ airframeClass: 'cinewhoop' }), 'cinewhoop');
  assert.equal(checklistAirframe({ airframeClass: '7-inch long range' }), 'longrange7');
  assert.equal(checklistAirframe({ airframeClass: 'fixed-wing' }), null);
  assert.equal(checklistAirframe(null), null);
});

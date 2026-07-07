const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const fdb = require('../lib/forensic-db');

function makeForensicRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sageflight-fdb-'));
  const batch = path.join(root, 'data', 'batches', 'default');
  fs.mkdirSync(batch, { recursive: true });
  fs.writeFileSync(path.join(batch, 'units.json'), JSON.stringify({
    version: 3, scanCount: 2,
    units: [{
      unitNumber: 1, label: 'UNIT-001', status: 'DEAD', mcuId: '0x123ABC',
      notes: 'no VCP enumeration',
      scans: [
        { timestamp: '2026-01-01T00:00:00Z', data: {} },
        { timestamp: '2026-02-01T00:00:00Z', data: {} },
      ],
    }],
  }));
  fs.writeFileSync(path.join(batch, 'escs.json'), JSON.stringify({
    version: 1, scanCount: 1,
    escs: [{
      escId: 1, label: 'ESC-001', manufacturer: 'SpeedyBee', model: 'BLS 50A',
      linkedFcUnitNumber: 1, linkedFcMcuId: '0x123ABC',
      powered: { stackStatus: 'PARTIAL', slotsResponsive: 3, uniqueSignatures: ['0xe8b2'] },
      electrical: { motors: [] },
    }],
  }));
  return root;
}

test('findUnitInDb matches MCU ids case- and punctuation-insensitively', () => {
  const units = [{ mcuId: '0x123ABC', label: 'x' }];
  assert.ok(fdb.findUnitInDb(units, '123abc'));
  assert.ok(fdb.findUnitInDb(units, '0X123abc'));
  assert.equal(fdb.findUnitInDb(units, '999'), null);
  assert.equal(fdb.findUnitInDb(units, ''), null);
});

test('summarizeUnit collapses scans into counts and timestamps', () => {
  const s = fdb.summarizeUnit({
    label: 'u', scans: [{ timestamp: 'a' }, { timestamp: 'b' }],
  });
  assert.equal(s.scanCount, 2);
  assert.equal(s.firstScanAt, 'a');
  assert.equal(s.lastScanAt, 'b');
  assert.equal('scans' in s, false);
});

test('findUnitByMcuId walks batches and attaches linked ESC records', () => {
  const root = makeForensicRoot();
  const rec = fdb.findUnitByMcuId('0x123abc', root);
  assert.ok(rec);
  assert.equal(rec.batch, 'default');
  assert.equal(rec.unit.label, 'UNIT-001');
  assert.equal(rec.unit.status, 'DEAD');
  assert.equal(rec.unit.scanCount, 2);
  assert.equal(rec.linkedEscs.length, 1);
  assert.equal(rec.linkedEscs[0].stackStatus, 'PARTIAL');
  assert.equal(fdb.findUnitByMcuId('deadbeef', root), null);
});

test('getStatus and listAllUnits report batch inventory', () => {
  const root = makeForensicRoot();
  const status = fdb.getStatus(root);
  assert.equal(status.available, true);
  assert.deepEqual(status.batches, [{ name: 'default', units: 1, escs: 1 }]);
  const units = fdb.listAllUnits(root);
  assert.equal(units.length, 1);
  assert.equal(units[0].mcuId, '0x123ABC');
});

test('getStatus fails soft when no install is found', () => {
  const status = fdb.getStatus(null);
  assert.equal(status.available, false);
  assert.match(status.hint, /STACK_FORENSIC_DIR/);
});

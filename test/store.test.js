const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Point the store at a throwaway dir BEFORE requiring it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'st-store-test-'));
process.env.STACK_DATA_DIR = tmp;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../lib/store');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('saveBackup / listBackups / readBackup roundtrip', () => {
  const { id } = store.saveBackup('# diff all\nset vbat_scale = 110\n', { boardName: 'KAKUTEH7' });
  assert.ok(id.includes('KAKUTEH7'));

  const list = store.listBackups();
  assert.equal(list.length, 1);
  assert.equal(list[0].boardName, 'KAKUTEH7');
  assert.ok(list[0].bytes > 0);

  const content = store.readBackup(id);
  assert.match(content, /vbat_scale = 110/);
});

test('readBackup refuses path traversal and unknown ids', () => {
  assert.equal(store.readBackup('../../etc/passwd'), null);
  assert.equal(store.readBackup('nope'), null);
});

test('appendHistory / readHistory returns newest first with timestamps', () => {
  store.appendHistory({ kind: 'motor.spin', motor: 1, sag: 0.12 });
  store.appendHistory({ kind: 'motor.spin', motor: 2, sag: 0.31 });

  const hist = store.readHistory(10);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].motor, 2); // newest first
  assert.ok(hist[0].at);
});

test('readHistory respects the limit', () => {
  for (let i = 0; i < 5; i++) store.appendHistory({ kind: 'motor.spin', motor: 3, i });
  assert.equal(store.readHistory(3).length, 3);
});

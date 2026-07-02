const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseVoltage, classifyCliCommand } = require('../lib/fc-cli');

test('parseVoltage handles the multiplier format', () => {
  assert.equal(parseVoltage('Voltage: 2451 * 0.01V (6S battery - OK)'), 24.51);
});

test('parseVoltage handles the plain format', () => {
  assert.equal(parseVoltage('Voltage: 16.80V'), 16.8);
});

test('parseVoltage returns null when no voltage line present', () => {
  assert.equal(parseVoltage('CPU:12% cycle time: 312'), null);
});

test('read commands classify as read', () => {
  for (const cmd of ['status', 'version', 'diff all', 'dump hardware', 'get gyro_lpf', 'tasks']) {
    assert.equal(classifyCliCommand(cmd).kind, 'read', cmd);
  }
});

test('bare set is a read, set with assignment is a write', () => {
  assert.equal(classifyCliCommand('set').kind, 'read');
  assert.equal(classifyCliCommand('set vbat_scale').kind, 'read');
  assert.equal(classifyCliCommand('set vbat_scale = 110').kind, 'write');
});

test('dual commands: bare/list/show are reads, args are writes', () => {
  assert.equal(classifyCliCommand('aux').kind, 'read');
  assert.equal(classifyCliCommand('feature list').kind, 'read');
  assert.equal(classifyCliCommand('resource show').kind, 'read');
  assert.equal(classifyCliCommand('aux 0 0 0 1700 2100').kind, 'write');
  assert.equal(classifyCliCommand('feature TELEMETRY').kind, 'write');
  assert.equal(classifyCliCommand('resource MOTOR 1 A02').kind, 'write');
});

test('save is a write', () => {
  assert.equal(classifyCliCommand('save').kind, 'write');
});

test('destructive commands are forbidden', () => {
  for (const cmd of ['defaults', 'flash_erase', 'motor 0 1200', 'bl', 'dfu', 'msc', 'serialpassthrough 1', 'reboot']) {
    assert.equal(classifyCliCommand(cmd).kind, 'forbidden', cmd);
  }
});

test('unrecognized commands are refused as unknown', () => {
  assert.equal(classifyCliCommand('frobnicate').kind, 'unknown');
  assert.equal(classifyCliCommand('').kind, 'invalid');
});

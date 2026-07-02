const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyPorts } = require('../lib/usb-detect');

test('STM32 VCP classifies as ALIVE with its port path', () => {
  const r = classifyPorts([
    { path: '/dev/ttyACM0', vendorId: '0483', productId: '5740', manufacturer: 'Betaflight' },
  ]);
  assert.equal(r.type, 'ALIVE');
  assert.equal(r.comPort, '/dev/ttyACM0');
});

test('native FC VCP is preferred over a generic UART bridge', () => {
  const r = classifyPorts([
    { path: 'COM7', vendorId: '10c4', productId: 'ea60', manufacturer: 'Silicon Labs' },
    { path: 'COM3', vendorId: '0483', productId: '5740', manufacturer: 'STMicroelectronics' },
  ]);
  assert.equal(r.comPort, 'COM3');
});

test('AT32 vendor id is recognized', () => {
  const r = classifyPorts([{ path: 'COM9', vendorId: '2E3C', productId: '5740' }]);
  assert.equal(r.type, 'ALIVE');
});

test('manufacturer string match works without a known vendor id', () => {
  const r = classifyPorts([{ path: 'COM4', manufacturer: 'STM32 Virtual COM Port' }]);
  assert.equal(r.type, 'ALIVE');
});

test('unrelated serial devices classify as NOT_FOUND', () => {
  const r = classifyPorts([{ path: '/dev/ttyUSB0', vendorId: 'dead', manufacturer: 'Arduino LLC' }]);
  assert.equal(r.type, 'NOT_FOUND');
  assert.equal(r.comPort, null);
});

test('empty port list classifies as NOT_FOUND', () => {
  assert.equal(classifyPorts([]).type, 'NOT_FOUND');
});

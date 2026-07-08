import { chromium } from 'playwright';

const state = {
  connected: true,
  suspended: false,
  comPort: 'COM7',
  variant: 'BTFL',
  telemetry: {
    attitude: { roll: -26.4, pitch: 3.8, yaw: 214 },
    analog: { voltage: 16.42, amperage: 0.74, rssi: 98, mahDrawn: 112 },
    status: {
      armed: false,
      cycleTime: 312,
      i2cErrors: 0,
      armingDisableBits: 0x108,
      armingDisable: [
        { bit: 1, name: 'MSP', meaning: 'A configurator is connected over USB', fix: 'Normal on the bench — clears the moment you unplug.' },
        { bit: 8, name: 'ANGLE', meaning: 'The craft is tilted past the arming angle limit', fix: 'Set it on a flat surface, or recalibrate the accelerometer in Sensors.' },
      ],
    },
  },
};

const scan = {
  ok: true,
  fc: {
    mcuId: '003A00243438510B34313939',
    boardName: 'MATEKF722SE',
    manufacturerId: 'MTKS',
    fwVariant: 'Betaflight',
    firmware: '4.5.1',
    mcuType: 'STM32F722',
    clock: '216 MHz',
    sensors: { gyro: 'MPU6000 (SPI)', acc: 'MPU6000', baro: 'BMP280', osd: 'AT7456E' },
    health: { vref: '3.31', coreTemp: '38', cpuLoad: '27', i2cErrors: 0, sdCard: 'none', cycleTime: '312' },
  },
};

const caseHistory = {
  ok: true,
  available: true,
  record: {
    unit: {
      unitNumber: 3,
      label: 'freestyle-5in-main',
      status: 'HEALTHY',
      scanCount: 4,
      lastScanAt: '2026-06-30T18:20:00Z',
      notes: 'Replaced M3 ESC after crash — bench-verified since.',
    },
    batch: '2025-Q4',
    linkedEscs: [
      { escId: 3, label: 'M3', manufacturer: 'T-Motor', model: 'F55A Pro II', stackStatus: 'replaced' },
    ],
  },
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'dark',
});

await page.route('**/api/detect', r => r.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({ type: 'ALIVE', description: 'STM32 Virtual COM Port (COM7)' }),
}));
await page.route('**/api/telemetry/stream', r => r.fulfill({
  status: 200,
  headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  body: 'retry: 60000\ndata: ' + JSON.stringify(state) + '\n\n',
}));
await page.route('**/api/scan', r => r.fulfill({
  contentType: 'application/json',
  body: JSON.stringify(scan),
}));
await page.route('**/api/forensic/unit/**', r => r.fulfill({
  contentType: 'application/json',
  body: JSON.stringify(caseHistory),
}));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.getByRole('button', { name: 'Scan FC' }).click();
await page.waitForTimeout(2500);

await page.screenshot({ path: 'setup-live.png' });
await page.screenshot({ path: 'setup-full.png', fullPage: true });
console.log('OK setup-live.png + setup-full.png');
await browser.close();

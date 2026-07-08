import { chromium } from 'playwright';

const DEFAULT_TABS = ['Setup', 'Presets', 'OSD', 'Blackbox', 'Checklists', 'AI Assistant', 'Firmware Flasher', 'Config / CLI'];
const TABS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TABS;
const APP_URL = process.env.SAGEFLIGHT_URL || 'http://localhost:5173/';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

// Strip real-bench artifacts (e.g. a half-plugged USB device's header pill)
// so captures show the product, not this particular desk.
async function hideBenchArtifacts() {
  await page.evaluate(() => {
    [...document.querySelectorAll('*')]
      .filter(e => e.children.length === 0 && /failed[ _]enum/i.test(e.textContent || ''))
      .forEach(e => e.remove());
  });
}

for (const label of TABS) {
  const item = page.locator('aside, nav, [class*="sidebar" i]').locator(`text="${label}"`).first();
  try {
    await item.click({ timeout: 4000 });
    await page.waitForTimeout(1800);
  } catch (e) {
    console.log(`SKIP ${label}: ${e.message.split('\n')[0]}`);
    continue;
  }
  await hideBenchArtifacts();
  const file = label.toLowerCase().replace(/[^a-z]+/g, '-') + '.png';
  await page.screenshot({ path: file });
  console.log(`OK ${label} -> ${file}`);
}
await browser.close();

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = 'http://127.0.0.1:3126/quantum-battery-xas-lab/';
const out = new URL('../test-results/review/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
  await page.goto(base);
  await page.waitForLoadState('networkidle');
  // Find each module-row-title link in showcase section and screenshot
  for (const [key, title] of [['showcase_beamline', 'XAS beamline'], ['showcase_spectra', 'Spectra studio'], ['showcase_quantum', 'Quantum dynamics']]) {
    const link = page.locator('a.module-row-title').filter({ hasText: title }).first();
    try {
      await link.scrollIntoViewIfNeeded();
      // scroll a bit more to show the iso-stage
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(600);
    } catch (e) { console.log('miss', key, e.message); }
    await page.screenshot({ path: out + name + '_' + key + '.png', fullPage: false });
  }
  await page.close();
}
await browser.close();

// The six reference views of the beamline twin for visual review (plan H10): the desktop page, transmission,
// optics, fluorescence and the whole beamline at 1600 x 1000, and the phone page at 390 x 844.
//   node scripts/visual-shots.mjs <site base URL> <output folder>
//   CHROME_PATH=<chrome.exe> to use a particular browser build.
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const [, , base = 'http://127.0.0.1:3000/quantum-battery-xas-lab/', out = 'visual-shots'] = process.argv;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = base + 'twin/?v=' + Date.now();
const shot = (page, locator, name) => (locator ? page.locator(locator) : page).screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 82 });
const ready = async page => { await page.goto(url, { waitUntil: 'load' }); await page.locator('.twin-scene:not([aria-busy="true"])').waitFor({ timeout: 60_000 }); await page.waitForTimeout(4000); };

const desk = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await ready(desk);
await shot(desk, null, '1-page');
await desk.keyboard.press('['); await desk.keyboard.press(']'); await desk.waitForTimeout(2500);
await shot(desk, '.hutch-stage', '2-transmission');
await desk.keyboard.press('5'); await desk.waitForTimeout(3000);
await shot(desk, '.hutch-stage', '3-optics');
await desk.keyboard.press('2'); await desk.waitForTimeout(3000);
await shot(desk, '.hutch-stage', '4-fluorescence');
await desk.getByRole('button', { name: 'Whole beamline', exact: true }).click(); await desk.waitForTimeout(3500);
await shot(desk, '.hutch-stage', '5-whole');

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ready(phone);
await shot(phone, null, '6-phone');
await browser.close();
console.log(`Wrote six views to ${out}`);

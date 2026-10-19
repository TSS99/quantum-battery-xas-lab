// Captures real XAS Lab panels from the built site for the landing-page module showcase.
// Usage: serve `out/` first (PORT=3126 node scripts/serve.mjs), then PORT=3126 node scripts/make-showcase.mjs
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const base = `http://127.0.0.1:${process.env.PORT || 3126}/quantum-battery-xas-lab/`;
const out = new URL('../public/showcase/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await mkdir(out, { recursive: true });

const browser = await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })).newPage();
const panel = title => page.locator('.panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first();

async function save(locator, name) {
  const png = await locator.screenshot({ animations: 'disabled' });
  // The layers are drawn at 8:5; crop from the top-left so the title and first controls stay in view.
  await sharp(png).resize(1280, 800, { fit: 'cover', position: 'left top' }).webp({ quality: 82 }).toFile(out + name + '.webp');
  console.log('saved', name);
}

await page.goto(base + 'beamline/');
await page.getByRole('heading', { name: 'Follow the X-ray beam' }).waitFor();
await page.waitForTimeout(800);
await save(page.locator('.beam-panel'), 'beamline-scene');
await save(page.locator('.beam-panel .plot-wrap'), 'beamline-scan');

await page.goto(base + 'spectra/');
await page.getByRole('heading', { name: 'Spectral comparison' }).waitFor();
await page.waitForTimeout(800);
await save(panel('Spectral comparison'), 'spectra-plot');
await page.getByRole('button', { name: 'Derivative', exact: true }).click();
await page.waitForTimeout(800);
await save(panel('Spectral comparison'), 'spectra-derivative');

await page.goto(base + 'quantum/');
await page.getByRole('button', { name: 'Research', exact: true }).click();
await page.getByRole('button', { name: 'Run simulation' }).click();
await page.getByText('Spectrum ready.').waitFor({ timeout: 30000 });
await page.waitForTimeout(800);
await save(panel('Kick, evolve, transform'), 'quantum-spectrum');
await save(panel('Inspect the product-formula circuit'), 'quantum-circuit');
await browser.close();



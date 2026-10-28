// The still of the 3D hutch shown while the model loads, rendered from the twin itself at 3840 x 2160 with its own
// "Save 4K image" button, in the Ultra view (4K textures, full-resolution shading), then saved at 4K and at 1280 x 720.
//   node scripts/make-poster.mjs <site base URL>
//   CHROME_PATH=<chrome.exe> to use a particular browser build. Needs the site served (npm start) and sharp-free:
//   the PNG is converted to WebP in the page by the browser's own encoder.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const [, , base = 'http://127.0.0.1:3000/quantum-battery-xas-lab/'] = process.argv;
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
await page.addInitScript(() => localStorage.setItem('xaslab-twin-ultra', 'on'));
await page.goto(base + 'twin/?v=' + Date.now(), { waitUntil: 'load' });
await page.locator('.twin-scene:not([aria-busy="true"])').waitFor({ timeout: 120_000 });
// Let the 4K textures arrive and the photons fill the line.
await page.waitForTimeout(12_000);
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.getByRole('button', { name: 'Save 4K image' }).click()]);
const png = await readFile(await download.path());
// Encode both sizes as WebP in the page, so no image library is needed here.
const encode = async (width, height, quality) => Buffer.from(await page.evaluate(async ({ data, width, height, quality }) => {
  const blob = await (await fetch('data:image/png;base64,' + data)).blob(), bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(width, height), g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.drawImage(bitmap, 0, 0, width, height);
  return [...new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp', quality })).arrayBuffer())];
}, { data: png.toString('base64'), width, height, quality }));
await writeFile('public/images/twin/hutch-poster-4k.webp', await encode(3840, 2160, 0.86));
await writeFile('public/images/twin/hutch-poster.webp', await encode(1280, 720, 0.82));
await browser.close();
console.log('Wrote hutch-poster-4k.webp (3840 x 2160) and hutch-poster.webp (1280 x 720) from', download.suggestedFilename());

// Renders the share images (public/og/*.png, 1200x630), apple-icon.png and favicon.ico
// from src/data/site-pages.json and src/app/icon.svg. Run after changing page titles:
//   PLAYWRIGHT_CHANNEL=chrome node scripts/make-share-assets.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const site = JSON.parse(await readFile('src/data/site-pages.json', 'utf8'));
const icon = await readFile('src/app/icon.svg', 'utf8');
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Illustrative absorption edge: flat pre-edge, small pre-edge peak, rise, white line, damped ripples.
const curve = Array.from({ length: 161 }, (_, i) => {
  const x = i / 160, e = (x - 0.38) * 40;
  const step = 1 / (1 + Math.exp(-e * 1.4));
  const pre = 0.08 * Math.exp(-(((x - 0.3) / 0.018) ** 2));
  const white = 0.45 * Math.exp(-(((x - 0.44) / 0.035) ** 2));
  const ripple = x > 0.44 ? 0.07 * Math.sin((x - 0.44) * 38) * Math.exp(-(x - 0.44) * 4) : 0;
  const y = 0.1 + pre + 0.62 * step + white * step + ripple;
  return `${i ? 'L' : 'M'}${(20 + x * 440).toFixed(1)},${(330 - y * 220).toFixed(1)}`;
}).join(' ');

const card = page => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=Space+Grotesk:wght@600&display=block" rel="stylesheet">
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#0f141a;color:#eef2f6;font-family:'IBM Plex Sans',sans-serif;display:flex;padding:64px 64px 56px 72px;gap:40px}
.text{flex:1;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:16px;font:600 30px 'Space Grotesk',sans-serif}
.brand svg{width:52px;height:52px}
h1{font:600 50px/1.1 'Space Grotesk',sans-serif;margin-top:40px;letter-spacing:-.01em}
p{font-size:23px;line-height:1.45;color:#c4ccd6;margin-top:20px}
.foot{margin-top:auto;display:flex;align-items:center;gap:18px;font-size:21px;color:#98a4b3}
.pill{border:2px solid #7fd8cf;color:#7fd8cf;border-radius:999px;padding:6px 18px;font-weight:500}
.plot{width:400px;flex:none;align-self:center;background:#151c24;border-radius:24px;padding:12px}
</style></head><body>
<div class="text">
<div class="brand">${icon.replace('<svg ', '<svg aria-hidden="true" ')}${escape(site.siteName)}</div>
<h1>${escape(page.title)}</h1>
<p>${escape(page.description)}</p>
<div class="foot"><span class="pill">${escape(page.name)}</span><span>tss99.github.io/quantum-battery-xas-lab</span></div>
</div>
<svg class="plot" viewBox="0 0 480 360" aria-hidden="true">
<path d="M20 330H460M20 330V40" stroke="#6b7a8c" stroke-width="2" fill="none"/>
<path d="M188 40V330" stroke="#7fd8cf" stroke-width="2" stroke-dasharray="6 8"/>
<path d="${curve}" stroke="#ffc46b" stroke-width="5" fill="none" stroke-linejoin="round"/>
<text x="240" y="356" fill="#98a4b3" font-size="18" text-anchor="middle" font-family="IBM Plex Sans">Photon energy</text>
</svg>
</body></html>`;

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await mkdir('public/og', { recursive: true });
for (const page of site.pages) {
  await tab.setContent(card(page), { waitUntil: 'networkidle' });
  await tab.evaluate(() => document.fonts.ready);
  const fits = await tab.evaluate(() => document.body.scrollHeight <= 630 && document.body.scrollWidth <= 1200);
  if (!fits) throw new Error(`Share card text overflows for "${page.name}". Shorten the title or description.`);
  await tab.screenshot({ path: `public/og/${page.slug || 'home'}.png` });
}

async function renderIcon(size) {
  await tab.setViewportSize({ width: size, height: size });
  await tab.setContent(`<html><body style="margin:0;background:transparent">${icon.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  return tab.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await writeFile('src/app/apple-icon.png', await renderIcon(180));
// favicon.ico holding one 32x32 PNG (valid ICO since Windows Vista; all current browsers accept it).
const png = await renderIcon(32);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt8(32, 6); header.writeUInt8(32, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await writeFile('src/app/favicon.ico', Buffer.concat([header, png]));
await browser.close();
console.log(`Wrote ${site.pages.length} share images, apple-icon.png and favicon.ico.`);

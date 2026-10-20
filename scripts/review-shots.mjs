import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = `http://127.0.0.1:${process.env.PORT || 3125}/quantum-battery-xas-lab/`;
const out = new URL('../out-shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
try {
  for (const [name, width] of [['desktop', 1440], ['mobile', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(base);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    // Scroll to the showcase section first.
    await page.evaluate(() => document.querySelector('.showcase')?.scrollIntoView());
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${out}${name}-showcase.png`, fullPage: false });
    // Scroll to validation cards.
    await page.evaluate(() => document.querySelector('.validation-section')?.scrollIntoView());
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}${name}-validation.png`, fullPage: false });
    const overflow = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, vw: innerWidth }));
    console.log(name, width, 'scrollWidth=' + overflow.content, 'vw=' + overflow.vw);
    await context.close();
  }
} finally { await browser.close(); }

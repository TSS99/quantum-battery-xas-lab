// The desktop app's icon: the site's icon.svg rendered at 1024 px, from which 'npx tauri icon' makes every size.
//   node scripts/make-app-icon.mjs src/app/icon.svg src-tauri/app-icon.png  (CHROME_PATH=<chrome.exe> for a browser)
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const svg = await readFile(process.argv[2], 'utf8');
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg', '<svg width="1024" height="1024"')}</body></html>`);
await page.screenshot({ path: process.argv[3], omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await browser.close();

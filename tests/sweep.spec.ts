import { expect, test } from '@playwright/test';
import { axeViolations } from './axe';

// Every page (the twin, Methods and the 404 page) at desktop and phone width: no console errors, no sideways scrolling, no broken maths and no
// axe violations.
const PAGES = ['', 'methods/', 'spectrum/'];
// A page of the old lab: the 404 page, whose own document answers 404, which the browser logs once.
const MISSING = 'spectrum/';

for (const width of [1440, 390]) {
  test(`every page is clean at ${width} px: console, overflow, maths and axe`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    for (const path of PAGES) {
      await page.goto('./' + path, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `/${path} sideways overflow`).toBeLessThanOrEqual(0);
      await expect(page.locator('.katex-error'), `/${path} maths`).toHaveCount(0);
      expect(await axeViolations(page), `/${path} axe`).toEqual([]);
      const notFound = path === MISSING ? errors.findIndex(e => e.includes('status of 404')) : -1;
      if (notFound >= 0) errors.splice(notFound, 1);
      expect(errors, `/${path} console`).toEqual([]);
    }
  });
}
